const axios = require('axios');
const cron = require('node-cron');
const { getPool } = require('../config/database');

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
      
      return this.accessToken;
    } catch (error) {
      console.error('KIS 토큰 획득 실패:', error);
      throw error;
    }
  }

  // 주식 현재가 조회
  async getCurrentPrice(stockCode) {
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
      console.error('현재가 조회 실패:', error);
      throw error;
    }
  }

  // 주식 주문
  async placeOrder(stockCode, orderType, quantity, price = null) {
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
      console.error('주문 실행 실패:', error);
      throw error;
    }
  }

  // 자동매매 로직 실행
  async executeTrading(userId, strategy) {
    try {
      console.log(`사용자 ${userId}의 자동매매 실행: ${strategy.stockCode}`);
      
      const currentPrice = await this.getCurrentPrice(strategy.stockCode);
      
      // 간단한 매매 로직 (실제로는 더 복잡한 알고리즘 필요)
      const shouldBuy = this.shouldBuy(strategy.marketType, currentPrice);
      const shouldSell = this.shouldSell(strategy.marketType, currentPrice);

      const pool = getPool();

      if (shouldBuy) {
        // 매수 로직
        const quantity = Math.floor((10000000 * strategy.allocation / 100) / currentPrice); // 1천만원 기준
        
        if (quantity > 0) {
          const orderResult = await this.placeOrder(strategy.stockCode, 'BUY', quantity, currentPrice);
          
          // 주문 기록 저장
          await pool.request()
            .input('userId', userId)
            .input('strategyId', strategy.id)
            .input('stockCode', strategy.stockCode)
            .input('orderType', 'BUY')
            .input('quantity', quantity)
            .input('price', currentPrice)
            .input('status', orderResult.rt_cd === '0' ? 'SUCCESS' : 'FAILED')
            .query(`
              INSERT INTO TradingOrders (userId, strategyId, stockCode, orderType, quantity, price, status, executedAt)
              VALUES (@userId, @strategyId, @stockCode, @orderType, @quantity, @price, @status, GETDATE())
            `);
        }
      }

      if (shouldSell) {
        // 매도 로직 (보유 주식이 있는 경우에만)
        // 실제로는 보유 주식 수량을 조회해야 함
        const holdingQuantity = 10; // 예시
        
        if (holdingQuantity > 0) {
          const orderResult = await this.placeOrder(strategy.stockCode, 'SELL', holdingQuantity, currentPrice);
          
          await pool.request()
            .input('userId', userId)
            .input('strategyId', strategy.id)
            .input('stockCode', strategy.stockCode)
            .input('orderType', 'SELL')
            .input('quantity', holdingQuantity)
            .input('price', currentPrice)
            .input('status', orderResult.rt_cd === '0' ? 'SUCCESS' : 'FAILED')
            .query(`
              INSERT INTO TradingOrders (userId, strategyId, stockCode, orderType, quantity, price, status, executedAt)
              VALUES (@userId, @strategyId, @stockCode, @orderType, @quantity, @price, @status, GETDATE())
            `);
        }
      }

    } catch (error) {
      console.error('자동매매 실행 오류:', error);
    }
  }

  // 매수 판단 로직
  shouldBuy(marketType, currentPrice) {
    // 간단한 예시 로직
    if (marketType === 'bull') {
      // 상승장에서는 더 적극적으로 매수
      return Math.random() > 0.7;
    } else {
      // 하락장에서는 보수적으로 매수
      return Math.random() > 0.8;
    }
  }

  // 매도 판단 로직
  shouldSell(marketType, currentPrice) {
    // 간단한 예시 로직
    if (marketType === 'bear') {
      // 하락장에서는 더 빨리 매도
      return Math.random() > 0.6;
    } else {
      // 상승장에서는 보유
      return Math.random() > 0.9;
    }
  }
}

const tradingService = new TradingService();

// 자동매매 시작
const startTrading = async (userId, strategy) => {
  try {
    // 기존 작업이 있다면 중단
    if (activeTradingJobs.has(userId)) {
      activeTradingJobs.get(userId).destroy();
    }

    // 1분마다 자동매매 실행 (실제로는 더 긴 간격 권장)
    const job = cron.schedule('*/1 * * * *', async () => {
      await tradingService.executeTrading(userId, strategy);
    }, {
      scheduled: false
    });

    activeTradingJobs.set(userId, job);
    job.start();

    console.log(`사용자 ${userId}의 자동매매가 시작되었습니다.`);
  } catch (error) {
    console.error('자동매매 시작 오류:', error);
    throw error;
  }
};

// 자동매매 중단
const stopTrading = async (userId) => {
  try {
    if (activeTradingJobs.has(userId)) {
      activeTradingJobs.get(userId).destroy();
      activeTradingJobs.delete(userId);
    }

    // 데이터베이스에서 전략 비활성화
    const pool = getPool();
    await pool.request()
      .input('userId', userId)
      .query('UPDATE TradingStrategies SET isActive = 0 WHERE userId = @userId');

    console.log(`사용자 ${userId}의 자동매매가 중단되었습니다.`);
  } catch (error) {
    console.error('자동매매 중단 오류:', error);
    throw error;
  }
};

// 최적 전략 조회 (예시)
const getBestStrategy = async () => {
  try {
    // 실제로는 백테스팅 결과나 성과 데이터를 기반으로 결정
    return {
      marketType: 'bull',
      stockCode: '005930', // 삼성전자
      stockName: '삼성전자',
      allocation: 30,
      expectedReturn: 15.5,
      riskLevel: 'Medium'
    };
  } catch (error) {
    console.error('최적 전략 조회 오류:', error);
    throw error;
  }
};

module.exports = {
  startTrading,
  stopTrading,
  getBestStrategy,
  tradingService
};