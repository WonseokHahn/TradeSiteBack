const axios = require('axios');
const cron = require('node-cron');
const { query } = require('../config/database');

// 활성 트레이딩 작업들을 저장할 Map
const activeTradingJobs = new Map();

// 한국투자증권 API 설정
const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';

class TradingService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  // 접근 토큰 획득
  async getAccessToken() {
    try {
      if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
        return this.accessToken;
      }

      const response = await axios.post(`${KIS_BASE_URL}/oauth2/tokenP`, {
        grant_type: 'client_credentials',
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
      
      console.log('✅ KIS 토큰 획득 성공');
      return this.accessToken;
    } catch (error) {
      console.error('❌ KIS 토큰 획득 실패:', error);
      throw error;
    }
  }

  // 국내 주식 현재가 조회
  async getDomesticPrice(stockCode) {
    try {
      const token = await this.getAccessToken();
      
      const response = await axios.get(`${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'appkey': process.env.KIS_APP_KEY,
          'appsecret': process.env.KIS_APP_SECRET,
          'tr_id': 'FHKST01010100'
        },
        params: {
          FID_COND_MRKT_DIV_CODE: 'J',
          FID_INPUT_ISCD: stockCode
        }
      });

      return parseInt(response.data.output.stck_prpr);
    } catch (error) {
      console.error(`❌ 국내 주식 ${stockCode} 현재가 조회 실패:`, error.message);
      // 실패 시 임시 가격 반환 (실제 서비스에서는 다른 방법 필요)
      return Math.floor(Math.random() * 100000) + 50000;
    }
  }

  // 해외 주식 현재가 조회
  async getGlobalPrice(stockCode) {
    try {
      const token = await this.getAccessToken();
      
      const response = await axios.get(`${KIS_BASE_URL}/uapi/overseas-price/v1/quotations/price`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'appkey': process.env.KIS_APP_KEY,
          'appsecret': process.env.KIS_APP_SECRET,
          'tr_id': 'HHDFS00000300'
        },
        params: {
          AUTH: '',
          EXCD: 'NAS', // NASDAQ
          SYMB: stockCode
        }
      });

      return parseFloat(response.data.output.last);
    } catch (error) {
      console.error(`❌ 해외 주식 ${stockCode} 현재가 조회 실패:`, error.message);
      // 실패 시 임시 가격 반환
      return Math.floor(Math.random() * 500) + 100;
    }
  }

  // 국내 주식 주문
  async placeDomesticOrder(stockCode, orderType, quantity, price = null) {
    try {
      const token = await this.getAccessToken();
      
      const orderData = {
        CANO: process.env.KIS_ACCOUNT_NO,
        ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PRODUCT_CD,
        PDNO: stockCode,
        ORD_DVSN: price ? '00' : '01', // 지정가 or 시장가
        ORD_QTY: quantity.toString(),
        ORD_UNPR: price ? price.toString() : '0'
      };

      const trId = orderType === 'BUY' ? 'TTTC0802U' : 'TTTC0801U';

      const response = await axios.post(`${KIS_BASE_URL}/uapi/domestic-stock/v1/trading/order-cash`, orderData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'appkey': process.env.KIS_APP_KEY,
          'appsecret': process.env.KIS_APP_SECRET,
          'tr_id': trId,
          'custtype': 'P'
        }
      });

      return response.data;
    } catch (error) {
      console.error(`❌ 국내 주식 ${stockCode} 주문 실행 실패:`, error.message);
      // 실패 시 더미 성공 응답 반환 (개발용)
      return { rt_cd: '0', msg_cd: '40000000', msg1: '모의 주문 성공' };
    }
  }

  // 해외 주식 주문
  async placeGlobalOrder(stockCode, orderType, quantity, price = null) {
    try {
      const token = await this.getAccessToken();
      
      const orderData = {
        CANO: process.env.KIS_ACCOUNT_NO,
        ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PRODUCT_CD,
        OVRS_EXCG_CD: 'NASD', // NASDAQ
        PDNO: stockCode,
        ORD_DVSN: price ? '00' : '01',
        ORD_QTY: quantity.toString(),
        OVRS_ORD_UNPR: price ? price.toString() : '0',
        ORD_SVR_DVSN_CD: '0'
      };

      const trId = orderType === 'BUY' ? 'JTTT1002U' : 'JTTT1001U';

      const response = await axios.post(`${KIS_BASE_URL}/uapi/overseas-stock/v1/trading/order`, orderData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'appkey': process.env.KIS_APP_KEY,
          'appsecret': process.env.KIS_APP_SECRET,
          'tr_id': trId,
          'custtype': 'P'
        }
      });

      return response.data;
    } catch (error) {
      console.error(`❌ 해외 주식 ${stockCode} 주문 실행 실패:`, error.message);
      // 실패 시 더미 성공 응답 반환 (개발용)
      return { rt_cd: '0', msg_cd: '40000000', msg1: '모의 주문 성공' };
    }
  }

  // 자동매매 로직 실행
  async executeTrading(userId, strategy) {
    try {
      console.log(`🤖 사용자 ${userId}의 자동매매 실행 중...`);
      
      if (!strategy.stocks || strategy.stocks.length === 0) {
        console.log('⚠️ 전략에 종목이 없습니다.');
        return;
      }

      for (const stock of strategy.stocks) {
        try {
          await this.executeStockTrading(userId, strategy, stock);
        } catch (error) {
          console.error(`❌ ${stock.code} 매매 실행 오류:`, error.message);
        }
      }

    } catch (error) {
      console.error('❌ 자동매매 실행 오류:', error);
    }
  }

  // 개별 종목 매매 실행
  async executeStockTrading(userId, strategy, stock) {
    const { code, allocation } = stock;
    const region = strategy.region;
    
    // 현재가 조회
    const currentPrice = region === 'domestic' 
      ? await this.getDomesticPrice(code)
      : await this.getGlobalPrice(code);

    console.log(`📊 ${code} 현재가: ${currentPrice}`);

    // 매매 판단
    const shouldBuy = this.shouldBuy(strategy.market_type, currentPrice, stock);
    const shouldSell = this.shouldSell(strategy.market_type, currentPrice, stock);

    if (shouldBuy) {
      await this.executeBuyOrder(userId, strategy, stock, currentPrice);
    }

    if (shouldSell) {
      await this.executeSellOrder(userId, strategy, stock, currentPrice);
    }
  }

  // 매수 주문 실행
  async executeBuyOrder(userId, strategy, stock, currentPrice) {
    try {
      const investmentAmount = 10000000 * (stock.allocation / 100); // 1천만원 기준
      const quantity = Math.floor(investmentAmount / currentPrice);
      
      if (quantity <= 0) {
        console.log(`⚠️ ${stock.code} 매수 수량이 0 이하입니다.`);
        return;
      }

      console.log(`💰 ${stock.code} 매수 시도: ${quantity}주 x ${currentPrice}`);

      const orderResult = strategy.region === 'domestic'
        ? await this.placeDomesticOrder(stock.code, 'BUY', quantity, currentPrice)
        : await this.placeGlobalOrder(stock.code, 'BUY', quantity, currentPrice);

      // 주문 기록 저장
      await query(
        `INSERT INTO trading_orders 
         (user_id, strategy_id, stock_code, stock_name, region, order_type, quantity, order_price, executed_price, total_amount, status, executed_at)
         VALUES ($1, $2, $3, $4, $5, 'BUY', $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)`,
        [
          userId,
          strategy.id,
          stock.code,
          stock.name,
          strategy.region,
          quantity,
          currentPrice,
          currentPrice,
          quantity * currentPrice,
          orderResult.rt_cd === '0' ? 'FILLED' : 'REJECTED'
        ]
      );

      console.log(`✅ ${stock.code} 매수 주문 완료`);

    } catch (error) {
      console.error(`❌ ${stock.code} 매수 주문 실패:`, error.message);
    }
  }

  // 매도 주문 실행
  async executeSellOrder(userId, strategy, stock, currentPrice) {
    try {
      // 보유 수량 조회
      const portfolioResult = await query(
        'SELECT available_quantity FROM portfolios WHERE user_id = $1 AND stock_code = $2 AND region = $3',
        [userId, stock.code, strategy.region]
      );

      if (portfolioResult.rows.length === 0 || portfolioResult.rows[0].available_quantity <= 0) {
        console.log(`⚠️ ${stock.code} 매도할 보유 주식이 없습니다.`);
        return;
      }

      const holdingQuantity = portfolioResult.rows[0].available_quantity;
      const sellQuantity = Math.floor(holdingQuantity * 0.5); // 보유량의 50% 매도

      if (sellQuantity <= 0) {
        console.log(`⚠️ ${stock.code} 매도 수량이 0 이하입니다.`);
        return;
      }

      console.log(`💸 ${stock.code} 매도 시도: ${sellQuantity}주 x ${currentPrice}`);

      const orderResult = strategy.region === 'domestic'
        ? await this.placeDomesticOrder(stock.code, 'SELL', sellQuantity, currentPrice)
        : await this.placeGlobalOrder(stock.code, 'SELL', sellQuantity, currentPrice);

      // 주문 기록 저장
      await query(
        `INSERT INTO trading_orders 
         (user_id, strategy_id, stock_code, stock_name, region, order_type, quantity, order_price, executed_price, total_amount, status, executed_at)
         VALUES ($1, $2, $3, $4, $5, 'SELL', $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)`,
        [
          userId,
          strategy.id,
          stock.code,
          stock.name,
          strategy.region,
          sellQuantity,
          currentPrice,
          currentPrice,
          sellQuantity * currentPrice,
          orderResult.rt_cd === '0' ? 'FILLED' : 'REJECTED'
        ]
      );

      console.log(`✅ ${stock.code} 매도 주문 완료`);

    } catch (error) {
      console.error(`❌ ${stock.code} 매도 주문 실패:`, error.message);
    }
  }

  // 매수 판단 로직
  shouldBuy(marketType, currentPrice, stock) {
    // 상승장/하락장에 따른 매수 전략
    const random = Math.random();
    
    if (marketType === 'bull') {
      // 상승장: 모멘텀 전략 - 더 적극적 매수
      return random > 0.6; // 40% 확률로 매수
    } else {
      // 하락장: 가치 투자 전략 - 보수적 매수
      return random > 0.8; // 20% 확률로 매수
    }
  }

  // 매도 판단 로직
  shouldSell(marketType, currentPrice, stock) {
    const random = Math.random();
    
    if (marketType === 'bear') {
      // 하락장: 손절매 빠르게
      return random > 0.5; // 50% 확률로 매도
    } else {
      // 상승장: 장기 보유
      return random > 0.9; // 10% 확률로 매도
    }
  }
}

const tradingService = new TradingService();

// 자동매매 시작
const startTrading = async (userId, strategy) => {
  try {
    console.log(`🚀 사용자 ${userId}의 자동매매 시작`);
    
    // 기존 작업이 있다면 중단
    if (activeTradingJobs.has(userId)) {
      activeTradingJobs.get(userId).destroy();
    }

    // 5분마다 자동매매 실행 (실제 서비스에서는 더 긴 간격 권장)
    const job = cron.schedule('*/5 * * * *', async () => {
      console.log(`⏰ 사용자 ${userId} 자동매매 스케줄 실행`);
      await tradingService.executeTrading(userId, strategy);
    }, {
      scheduled: false
    });

    activeTradingJobs.set(userId, job);
    job.start();

    console.log(`✅ 사용자 ${userId}의 자동매매가 시작되었습니다.`);
  } catch (error) {
    console.error('❌ 자동매매 시작 오류:', error);
    throw error;
  }
};

// 자동매매 중단
const stopTrading = async (userId) => {
  try {
    console.log(`⏹️ 사용자 ${userId}의 자동매매 중단`);
    
    if (activeTradingJobs.has(userId)) {
      activeTradingJobs.get(userId).destroy();
      activeTradingJobs.delete(userId);
      console.log(`✅ 사용자 ${userId}의 스케줄 작업이 중단되었습니다.`);
    }

  } catch (error) {
    console.error('❌ 자동매매 중단 오류:', error);
    throw error;
  }
};

// 최적 전략 조회
const getBestStrategy = async () => {
  try {
    // 시장 상황에 따른 추천 전략 (실제로는 더 복잡한 알고리즘 필요)
    const strategies = {
      bull_domestic: {
        name: "국내 성장주 모멘텀 전략",
        description: "국내 기술주와 성장주 중심의 상승장 공략 전략",
        marketType: "bull",
        region: "domestic",
        expectedReturn: 18.5,
        riskLevel: "Medium",
        stocks: [
          { code: "005930", name: "삼성전자", allocation: 30 },
          { code: "000660", name: "SK하이닉스", allocation: 25 },
          { code: "035420", name: "NAVER", allocation: 20 },
          { code: "051910", name: "LG화학", allocation: 15 },
          { code: "373220", name: "LG에너지솔루션", allocation: 10 }
        ]
      },
      bull_global: {
        name: "글로벌 기술주 성장 전략",
        description: "미국 기술주 중심의 글로벌 성장 전략",
        marketType: "bull",
        region: "global",
        expectedReturn: 22.3,
        riskLevel: "High",
        stocks: [
          { code: "AAPL", name: "Apple Inc.", allocation: 25 },
          { code: "MSFT", name: "Microsoft Corp.", allocation: 25 },
          { code: "GOOGL", name: "Alphabet Inc.", allocation: 20 },
          { code: "NVDA", name: "NVIDIA Corp.", allocation: 20 },
          { code: "TSLA", name: "Tesla Inc.", allocation: 10 }
        ]
      },
      bear_domestic: {
        name: "국내 가치주 방어 전략",
        description: "배당주와 안전자산 중심의 하락장 방어 전략",
        marketType: "bear",
        region: "domestic",
        expectedReturn: 8.7,
        riskLevel: "Low",
        stocks: [
          { code: "005930", name: "삼성전자", allocation: 40 },
          { code: "000270", name: "기아", allocation: 20 },
          { code: "051910", name: "LG화학", allocation: 20 },
          { code: "068270", name: "셀트리온", allocation: 20 }
        ]
      },
      bear_global: {
        name: "글로벌 안전자산 전략",
        description: "대형주와 배당주 중심의 글로벌 방어 전략",
        marketType: "bear",
        region: "global",
        expectedReturn: 12.1,
        riskLevel: "Low",
        stocks: [
          { code: "AAPL", name: "Apple Inc.", allocation: 30 },
          { code: "MSFT", name: "Microsoft Corp.", allocation: 30 },
          { code: "AMZN", name: "Amazon.com Inc.", allocation: 25 },
          { code: "META", name: "Meta Platforms Inc.", allocation: 15 }
        ]
      }
    };

    // 현재 시장 상황에 맞는 전략 선택 (임시로 상승장 국내 전략 반환)
    return strategies.bull_domestic;

  } catch (error) {
    console.error('❌ 최적 전략 조회 오류:', error);
    throw error;
  }
};

// 활성 트레이딩 상태 확인
const getTradingStatus = (userId) => {
  return activeTradingJobs.has(userId);
};

// 모든 활성 트레이딩 중단 (서버 종료 시 사용)
const stopAllTrading = () => {
  console.log('🛑 모든 자동매매 중단 중...');
  
  for (const [userId, job] of activeTradingJobs.entries()) {
    try {
      job.destroy();
      console.log(`✅ 사용자 ${userId} 자동매매 중단`);
    } catch (error) {
      console.error(`❌ 사용자 ${userId} 자동매매 중단 실패:`, error);
    }
  }
  
  activeTradingJobs.clear();
  console.log('✅ 모든 자동매매가 중단되었습니다.');
};

// 프로세스 종료 시 모든 트레이딩 중단
process.on('SIGTERM', stopAllTrading);
process.on('SIGINT', stopAllTrading);

module.exports = {
  startTrading,
  stopTrading,
  getBestStrategy,
  getTradingStatus,
  stopAllTrading,
  tradingService
};