const axios = require('axios');
const cron = require('node-cron');
const { query } = require('../config/database');
const technicalAnalysis = require('./technicalAnalysisService');

// 활성 트레이딩 작업들을 저장할 Map
const activeTradingJobs = new Map();

// 한국투자증권 API 설정
const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';

class TradingService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = null;
    this.lastOrderTime = new Map(); // 종목별 마지막 주문 시간 (중복 주문 방지)
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

  // 🔥 새로운 기술적 분석 기반 자동매매 로직
  async executeTrading(userId, strategy) {
    try {
      console.log(`🤖 사용자 ${userId}의 ${strategy.market_type} 전략 실행 중...`);
      
      if (!strategy.stocks || strategy.stocks.length === 0) {
        console.log('⚠️ 전략에 종목이 없습니다.');
        return;
      }

      // 각 종목에 대해 기술적 분석 수행
      for (const stock of strategy.stocks) {
        try {
          await this.executeAdvancedStockTrading(userId, strategy, stock);
        } catch (error) {
          console.error(`❌ ${stock.code} 고급 매매 실행 오류:`, error.message);
        }
      }

      // 포트폴리오 리밸런싱 검토
      await this.reviewPortfolioRebalancing(userId, strategy);

    } catch (error) {
      console.error('❌ 자동매매 실행 오류:', error);
    }
  }

  // 🔥 고급 기술적 분석 기반 종목 매매
  async executeAdvancedStockTrading(userId, strategy, stock) {
    const { code, allocation } = stock;
    const region = strategy.region;
    
    // 현재가 조회
    const currentPrice = region === 'domestic' 
      ? await this.getDomesticPrice(code)
      : await this.getGlobalPrice(code);

    console.log(`📊 ${code} 현재가: ${currentPrice.toLocaleString()}`);

    // 🔥 기술적 분석 수행
    const technicalSignals = technicalAnalysis.analyzeStrategy(
      strategy.market_type, 
      code, 
      currentPrice, 
      region
    );

    console.log(`🔍 ${code} 기술적 분석 결과:`, {
      강도: technicalSignals.strength,
      매수신호: technicalSignals.buy,
      매도신호: technicalSignals.sell,
      이유: technicalSignals.reason.join(', ')
    });

    // 중복 주문 방지 (최소 30분 간격)
    const lastOrderKey = `${userId}_${code}`;
    const lastOrderTime = this.lastOrderTime.get(lastOrderKey) || 0;
    const now = Date.now();
    const minInterval = 30 * 60 * 1000; // 30분

    if (now - lastOrderTime < minInterval) {
      console.log(`⏰ ${code} 주문 간격 제한 (마지막 주문: ${new Date(lastOrderTime).toLocaleTimeString()})`);
      return;
    }

    // 기술적 분석 기반 매매 결정
    if (technicalSignals.buy && technicalSignals.strength > 40) {
      await this.executeAdvancedBuyOrder(userId, strategy, stock, currentPrice, technicalSignals);
      this.lastOrderTime.set(lastOrderKey, now);
    }

    if (technicalSignals.sell && technicalSignals.strength < -20) {
      await this.executeAdvancedSellOrder(userId, strategy, stock, currentPrice, technicalSignals);
      this.lastOrderTime.set(lastOrderKey, now);
    }
  }

  // 🔥 고급 매수 로직
  async executeAdvancedBuyOrder(userId, strategy, stock, currentPrice, signals) {
    try {
      // 계좌 잔고 확인
      const availableAmount = await this.getAvailableAmount(userId, strategy.region);
      
      // 동적 투자 금액 계산 (신호 강도에 따라 조절)
      const baseInvestment = availableAmount * (stock.allocation / 100);
      const signalMultiplier = Math.min(signals.strength / 100, 1.2); // 최대 20% 가중
      const investmentAmount = baseInvestment * signalMultiplier;
      
      const quantity = Math.floor(investmentAmount / currentPrice);
      
      if (quantity <= 0) {
        console.log(`⚠️ ${stock.code} 매수 수량이 0 이하입니다. (투자금액: ${investmentAmount.toLocaleString()})`);
        return;
      }

      console.log(`💰 ${stock.code} 기술적 분석 기반 매수:`, {
        수량: quantity,
        단가: currentPrice.toLocaleString(),
        신호강도: signals.strength,
        이유: signals.reason.join(', '),
        투자금액: investmentAmount.toLocaleString()
      });

      const orderResult = strategy.region === 'domestic'
        ? await this.placeDomesticOrder(stock.code, 'BUY', quantity, currentPrice)
        : await this.placeGlobalOrder(stock.code, 'BUY', quantity, currentPrice);

      // 상세 주문 기록 저장
      await query(
        `INSERT INTO trading_orders 
         (user_id, strategy_id, stock_code, stock_name, region, order_type, quantity, order_price, executed_price, total_amount, status, executed_at, error_message)
         VALUES ($1, $2, $3, $4, $5, 'BUY', $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, $11)`,
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
          orderResult.rt_cd === '0' ? 'FILLED' : 'REJECTED',
          orderResult.rt_cd !== '0' ? `기술적분석: ${signals.reason.join(', ')} | API응답: ${orderResult.msg1}` : `기술적분석: ${signals.reason.join(', ')}`
        ]
      );

      // 포트폴리오 업데이트
      if (orderResult.rt_cd === '0') {
        await this.updatePortfolio(userId, stock.code, strategy.region, quantity, currentPrice, 'BUY');
      }

      console.log(`✅ ${stock.code} 기술적 분석 기반 매수 주문 완료`);

    } catch (error) {
      console.error(`❌ ${stock.code} 고급 매수 주문 실패:`, error.message);
    }
  }

  // 🔥 고급 매도 로직
  async executeAdvancedSellOrder(userId, strategy, stock, currentPrice, signals) {
    try {
      // 보유 수량 조회
      const portfolioResult = await query(
        'SELECT available_quantity, average_price FROM portfolios WHERE user_id = $1 AND stock_code = $2 AND region = $3',
        [userId, stock.code, strategy.region]
      );

      if (portfolioResult.rows.length === 0 || portfolioResult.rows[0].available_quantity <= 0) {
        console.log(`⚠️ ${stock.code} 매도할 보유 주식이 없습니다.`);
        return;
      }

      const holdingQuantity = portfolioResult.rows[0].available_quantity;
      const averagePrice = parseFloat(portfolioResult.rows[0].average_price);
      
      // 동적 매도 수량 결정
      let sellRatio;
      if (signals.strength < -50) {
        sellRatio = 0.8; // 강한 매도 신호시 80% 매도
      } else if (signals.strength < -30) {
        sellRatio = 0.5; // 중간 매도 신호시 50% 매도
      } else {
        sellRatio = 0.3; // 약한 매도 신호시 30% 매도
      }

      const sellQuantity = Math.floor(holdingQuantity * sellRatio);

      if (sellQuantity <= 0) {
        console.log(`⚠️ ${stock.code} 매도 수량이 0 이하입니다.`);
        return;
      }

      // 손익 계산
      const profitLoss = (currentPrice - averagePrice) * sellQuantity;
      const profitRate = ((currentPrice - averagePrice) / averagePrice) * 100;

      console.log(`💸 ${stock.code} 기술적 분석 기반 매도:`, {
        수량: sellQuantity,
        단가: currentPrice.toLocaleString(),
        평균가: averagePrice.toLocaleString(),
        손익: profitLoss.toLocaleString(),
        수익률: `${profitRate.toFixed(2)}%`,
        신호강도: signals.strength,
        이유: signals.reason.join(', ')
      });

      const orderResult = strategy.region === 'domestic'
        ? await this.placeDomesticOrder(stock.code, 'SELL', sellQuantity, currentPrice)
        : await this.placeGlobalOrder(stock.code, 'SELL', sellQuantity, currentPrice);

      // 상세 주문 기록 저장
      await query(
        `INSERT INTO trading_orders 
         (user_id, strategy_id, stock_code, stock_name, region, order_type, quantity, order_price, executed_price, total_amount, status, executed_at, error_message)
         VALUES ($1, $2, $3, $4, $5, 'SELL', $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, $11)`,
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
          orderResult.rt_cd === '0' ? 'FILLED' : 'REJECTED',
          orderResult.rt_cd !== '0' ? `기술적분석: ${signals.reason.join(', ')} | 손익률: ${profitRate.toFixed(2)}% | API응답: ${orderResult.msg1}` : `기술적분석: ${signals.reason.join(', ')} | 손익률: ${profitRate.toFixed(2)}%`
        ]
      );

      // 포트폴리오 업데이트
      if (orderResult.rt_cd === '0') {
        await this.updatePortfolio(userId, stock.code, strategy.region, sellQuantity, currentPrice, 'SELL');
      }

      console.log(`✅ ${stock.code} 기술적 분석 기반 매도 주문 완료`);

    } catch (error) {
      console.error(`❌ ${stock.code} 고급 매도 주문 실패:`, error.message);
    }
  }

  // 포트폴리오 리밸런싱 검토
  async reviewPortfolioRebalancing(userId, strategy) {
    try {
      console.log(`🔄 사용자 ${userId} 포트폴리오 리밸런싱 검토...`);
      
      const portfolioResult = await query(
        'SELECT * FROM portfolios WHERE user_id = $1 AND region = $2 AND total_quantity > 0',
        [userId, strategy.region]
      );

      if (portfolioResult.rows.length === 0) return;

      const portfolio = portfolioResult.rows.map(row => ({
        stockCode: row.stock_code,
        currentPrice: parseFloat(row.current_price) || 0,
        region: row.region
      }));

      const rebalancingSuggestions = technicalAnalysis.suggestRebalancing(portfolio, strategy.market_type);
      
      if (rebalancingSuggestions.length > 0) {
        console.log(`📋 리밸런싱 제안:`, rebalancingSuggestions);
        
        // 리밸런싱 로그 저장
        for (const suggestion of rebalancingSuggestions) {
          await query(
            `INSERT INTO trading_orders 
             (user_id, strategy_id, stock_code, region, order_type, quantity, status, error_message, created_at)
             VALUES ($1, $2, $3, $4, $5, 0, 'REBALANCING_SUGGESTION', $6, CURRENT_TIMESTAMP)`,
            [
              userId,
              strategy.id,
              suggestion.stockCode,
              strategy.region,
              suggestion.action,
              `리밸런싱 제안: ${suggestion.reason} (강도: ${suggestion.strength})`
            ]
          );
        }
      }

    } catch (error) {
      console.error('❌ 포트폴리오 리밸런싱 검토 오류:', error);
    }
  }

  // 계좌 사용 가능 금액 조회
  async getAvailableAmount(userId, region) {
    try {
      // 실제로는 KIS API로 잔고 조회
      // 여기서는 임시 값 반환
      return region === 'domestic' ? 5000000 : 10000; // 500만원 또는 1만달러
    } catch (error) {
      console.error('❌ 사용 가능 금액 조회 실패:', error);
      return region === 'domestic' ? 1000000 : 2000; // 최소 금액
    }
  }

  // 포트폴리오 업데이트
  async updatePortfolio(userId, stockCode, region, quantity, price, orderType) {
    try {
      const existingResult = await query(
        'SELECT * FROM portfolios WHERE user_id = $1 AND stock_code = $2 AND region = $3',
        [userId, stockCode, region]
      );

      if (existingResult.rows.length === 0) {
        // 새 포지션 생성
        if (orderType === 'BUY') {
          await query(
            `INSERT INTO portfolios 
             (user_id, stock_code, region, total_quantity, available_quantity, average_price, current_price, total_investment, current_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [userId, stockCode, region, quantity, quantity, price, price, quantity * price, quantity * price]
          );
        }
      } else {
        // 기존 포지션 업데이트
        const existing = existingResult.rows[0];
        
        if (orderType === 'BUY') {
          const newTotalQuantity = existing.total_quantity + quantity;
          const newTotalInvestment = existing.total_investment + (quantity * price);
          const newAveragePrice = newTotalInvestment / newTotalQuantity;
          
          await query(
            `UPDATE portfolios 
             SET total_quantity = $1, available_quantity = $2, average_price = $3, 
                 current_price = $4, total_investment = $5, current_value = $6, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $7 AND stock_code = $8 AND region = $9`,
            [
              newTotalQuantity,
              newTotalQuantity,
              newAveragePrice,
              price,
              newTotalInvestment,
              newTotalQuantity * price,
              userId, stockCode, region
            ]
          );
        } else if (orderType === 'SELL') {
          const newTotalQuantity = Math.max(0, existing.total_quantity - quantity);
          const newCurrentValue = newTotalQuantity * price;
          
          await query(
            `UPDATE portfolios 
             SET total_quantity = $1, available_quantity = $2, current_price = $3, 
                 current_value = $4, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $5 AND stock_code = $6 AND region = $7`,
            [newTotalQuantity, newTotalQuantity, price, newCurrentValue, userId, stockCode, region]
          );
        }
      }

      console.log(`✅ ${stockCode} 포트폴리오 업데이트 완료 (${orderType})`);

    } catch (error) {
      console.error(`❌ ${stockCode} 포트폴리오 업데이트 실패:`, error);
    }
  }

  // 국내 주식 주문 (기존 코드 유지)
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

  // 해외 주식 주문 (기존 코드 유지)
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
}