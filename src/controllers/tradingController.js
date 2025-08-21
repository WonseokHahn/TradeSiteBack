// src/controllers/tradingController.js
const kisService = require('../services/kisService');
const TradingStrategies = require('../services/tradingStrategies');
const AIRecommendationService = require('../services/aiRecommendationService');
const { query } = require('../config/database');

// 활성 자동매매 세션 저장
const activeTradingSessions = new Map();

class TradingController {
  
  // 계좌 정보 조회
  static async getAccountInfo(req, res) {
    try {
      console.log('📊 계좌 정보 조회 요청:', req.user.email);
      
      const [domesticBalance, overseasBalance] = await Promise.allSettled([
        kisService.getAccountBalance(),
        kisService.getOverseasBalance()
      ]);

      const accountInfo = {
        domestic: domesticBalance.status === 'fulfilled' ? domesticBalance.value.data : null,
        overseas: overseasBalance.status === 'fulfilled' ? overseasBalance.value.data : null,
        lastUpdated: new Date().toISOString()
      };

      // 계좌 정보를 데이터베이스에 로그 저장
      await query(
        `INSERT INTO account_logs (user_id, account_type, total_assets, available_cash, logged_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [req.user.id, 'domestic', accountInfo.domestic?.totalAssets || 0, accountInfo.domestic?.availableCash || 0]
      );

      res.json({
        success: true,
        data: accountInfo
      });

    } catch (error) {
      console.error('❌ 계좌 정보 조회 실패:', error);
      res.status(500).json({
        success: false,
        message: '계좌 정보를 가져오는데 실패했습니다.',
        error: error.message
      });
    }
  }

  // AI 종목 추천 조회
  static async getRecommendations(req, res) {
    try {
      const { marketType = 'domestic', investmentStyle = 'balanced' } = req.query;
      
      console.log(`🤖 AI 종목 추천 요청: ${marketType}, ${investmentStyle}`);
      
      const recommendations = await AIRecommendationService.getAIRecommendedStocks(marketType, investmentStyle);
      
      // 추천 기록을 데이터베이스에 저장
      await query(
        `INSERT INTO recommendation_logs (user_id, market_type, investment_style, recommendations, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [req.user.id, marketType, investmentStyle, JSON.stringify(recommendations.data)]
      );

      res.json(recommendations);

    } catch (error) {
      console.error('❌ AI 추천 조회 실패:', error);
      res.status(500).json({
        success: false,
        message: 'AI 종목 추천을 가져오는데 실패했습니다.',
        error: error.message
      });
    }
  }

  // 전략 분석 실행
  static async analyzeStrategy(req, res) {
    try {
      const { stockCode, strategy } = req.body;
      
      if (!stockCode) {
        return res.status(400).json({
          success: false,
          message: '종목 코드가 필요합니다.'
        });
      }

      console.log(`📊 전략 분석 요청: ${stockCode}, ${strategy}`);

      let analysis;

      switch (strategy) {
        case 'movingAverage':
          analysis = await TradingStrategies.movingAverageCrossover(stockCode);
          break;
        case 'rsi':
          analysis = await TradingStrategies.rsiStrategy(stockCode);
          break;
        case 'bollingerBand':
          analysis = await TradingStrategies.bollingerBandStrategy(stockCode);
          break;
        case 'comprehensive':
        default:
          analysis = await TradingStrategies.comprehensiveAnalysis(stockCode);
          break;
      }

      // 분석 결과를 데이터베이스에 저장
      await query(
        `INSERT INTO strategy_analyses (user_id, stock_code, strategy_type, analysis_result, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [req.user.id, stockCode, strategy, JSON.stringify(analysis)]
      );

      res.json({
        success: true,
        data: analysis
      });

    } catch (error) {
      console.error('❌ 전략 분석 실패:', error);
      res.status(500).json({
        success: false,
        message: '전략 분석에 실패했습니다.',
        error: error.message
      });
    }
  }

  // 자동매매 시작
  static async startAutoTrading(req, res) {
    try {
      const {
        stocks,           // 선택된 종목들
        strategy,         // 매매 전략
        marketType,       // 국내/해외
        investmentAmount, // 투자 금액
        riskLevel        // 위험 수준
      } = req.body;

      const userId = req.user.id;
      const sessionId = `${userId}_${Date.now()}`;

      console.log(`🚀 자동매매 시작 요청:`, {
        sessionId,
        userId,
        stocks: stocks?.length || 0,
        strategy,
        marketType,
        investmentAmount
      });

      // 입력 검증
      if (!stocks || stocks.length === 0) {
        return res.status(400).json({
          success: false,
          message: '매매할 종목을 선택해주세요.'
        });
      }

      if (!investmentAmount || investmentAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: '투자 금액을 입력해주세요.'
        });
      }

      // 계좌 잔고 확인
      const accountBalance = marketType === 'domestic' 
        ? await kisService.getAccountBalance()
        : await kisService.getOverseasBalance();

      if (!accountBalance.success || accountBalance.data.availableCash < investmentAmount) {
        return res.status(400).json({
          success: false,
          message: '투자 가능한 금액이 부족합니다.'
        });
      }

      // 자동매매 세션 정보를 데이터베이스에 저장
      const sessionResult = await query(
        `INSERT INTO trading_sessions (
          session_id, user_id, market_type, strategy_type, 
          investment_amount, risk_level, selected_stocks, 
          status, started_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', CURRENT_TIMESTAMP)
        RETURNING id`,
        [sessionId, userId, marketType, strategy, investmentAmount, riskLevel, JSON.stringify(stocks)]
      );

      const dbSessionId = sessionResult.rows[0].id;

      // 자동매매 세션 시작
      const tradingSession = {
        sessionId,
        dbSessionId,
        userId,
        stocks,
        strategy,
        marketType,
        investmentAmount,
        riskLevel,
        status: 'ACTIVE',
        startTime: new Date(),
        positions: new Map(),
        orders: [],
        totalProfit: 0
      };

      activeTradingSessions.set(sessionId, tradingSession);

      // 비동기로 자동매매 실행
      this.executeAutoTrading(tradingSession);

      res.json({
        success: true,
        data: {
          sessionId,
          message: '자동매매가 시작되었습니다.',
          session: {
            sessionId,
            stocks: stocks.length,
            strategy,
            marketType,
            investmentAmount,
            status: 'ACTIVE',
            startTime: tradingSession.startTime
          }
        }
      });

    } catch (error) {
      console.error('❌ 자동매매 시작 실패:', error);
      res.status(500).json({
        success: false,
        message: '자동매매 시작에 실패했습니다.',
        error: error.message
      });
    }
  }

  // 자동매매 중지
  static async stopAutoTrading(req, res) {
    try {
      const { sessionId } = req.params;
      const userId = req.user.id;

      console.log(`⏹️ 자동매매 중지 요청: ${sessionId}`);

      const session = activeTradingSessions.get(sessionId);
      
      if (!session) {
        return res.status(404).json({
          success: false,
          message: '자동매매 세션을 찾을 수 없습니다.'
        });
      }

      if (session.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: '권한이 없습니다.'
        });
      }

      // 세션 상태 변경
      session.status = 'STOPPED';
      session.endTime = new Date();

      // 데이터베이스 업데이트
      await query(
        `UPDATE trading_sessions 
         SET status = 'STOPPED', ended_at = CURRENT_TIMESTAMP, 
             final_profit = $1, total_orders = $2
         WHERE session_id = $3`,
        [session.totalProfit, session.orders.length, sessionId]
      );

      // 미체결 주문 취소
      const pendingOrders = await kisService.getPendingOrders();
      if (pendingOrders.success) {
        for (const order of pendingOrders.data) {
          try {
            await kisService.cancelOrder(
              order.orderNumber,
              order.stockCode,
              order.remainingQuantity,
              order.orderPrice,
              '00'
            );
          } catch (cancelError) {
            console.error('❌ 주문 취소 실패:', cancelError);
          }
        }
      }

      activeTradingSessions.delete(sessionId);

      res.json({
        success: true,
        data: {
          message: '자동매매가 중지되었습니다.',
          sessionSummary: {
            sessionId,
            duration: session.endTime - session.startTime,
            totalOrders: session.orders.length,
            totalProfit: session.totalProfit,
            endTime: session.endTime
          }
        }
      });

    } catch (error) {
      console.error('❌ 자동매매 중지 실패:', error);
      res.status(500).json({
        success: false,
        message: '자동매매 중지에 실패했습니다.',
        error: error.message
      });
    }
  }

  // 자동매매 상태 조회
  static async getTradingStatus(req, res) {
    try {
      const userId = req.user.id;
      console.log(`📊 자동매매 상태 조회: userId=${userId}`);

      // 활성 세션 조회 (메모리에서)
      const activeSessions = Array.from(activeTradingSessions.values())
        .filter(session => session.userId === userId)
        .map(session => ({
          sessionId: session.sessionId,
          strategy: session.strategy,
          marketType: session.marketType,
          investmentAmount: session.investmentAmount,
          status: session.status,
          startTime: session.startTime,
          stockCount: session.stocks.length,
          orderCount: session.orders.length,
          totalProfit: session.totalProfit
        }));

      console.log(`💾 메모리 활성 세션: ${activeSessions.length}개`);

      // DB에서 세션 히스토리 조회 (에러 처리 강화)
      let historyResult = { rows: [] };
      
      try {
        // 먼저 테이블 존재 여부 확인
        const tableCheck = await query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'trading_sessions' 
          AND column_name IN ('market_type', 'strategy_type')
        `);
        
        console.log('🔍 테이블 컬럼 확인:', tableCheck.rows.map(r => r.column_name));

        if (tableCheck.rows.length >= 2) {
          // 컬럼이 모두 존재하는 경우
          historyResult = await query(`
            SELECT session_id, 
                   COALESCE(market_type, 'domestic') as market_type, 
                   COALESCE(strategy_type, 'comprehensive') as strategy_type, 
                   investment_amount,
                   status, started_at, ended_at, final_profit, total_orders
            FROM trading_sessions 
            WHERE user_id = $1 
            ORDER BY started_at DESC 
            LIMIT 10
          `, [userId]);
        } else {
          // 컬럼이 없는 경우 기본 쿼리
          console.log('⚠️ trading_sessions 테이블 컬럼 부족, 기본 조회');
          historyResult = await query(`
            SELECT session_id, 
                   'domestic' as market_type,
                   'comprehensive' as strategy_type,
                   COALESCE(investment_amount, 0) as investment_amount,
                   COALESCE(status, 'UNKNOWN') as status,
                   started_at, ended_at, 
                   COALESCE(final_profit, 0) as final_profit,
                   COALESCE(total_orders, 0) as total_orders
            FROM trading_sessions 
            WHERE user_id = $1 
            ORDER BY started_at DESC 
            LIMIT 10
          `, [userId]);
        }
        
        console.log(`✅ DB 세션 히스토리: ${historyResult.rows.length}개`);
        
      } catch (dbError) {
        console.error('❌ DB 세션 히스토리 조회 실패:', dbError);
        console.log('📝 세션 히스토리를 빈 배열로 설정');
        historyResult = { rows: [] };
      }

      res.json({
        success: true,
        data: {
          activeSessions,
          sessionHistory: historyResult.rows,
          totalActiveSessions: activeSessions.length,
          lastUpdated: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('❌ 자동매매 상태 조회 실패:', error);
      res.status(500).json({
        success: false,
        message: '자동매매 상태 조회에 실패했습니다.',
        error: process.env.NODE_ENV === 'development' ? error.message : '서버 오류',
        data: {
          activeSessions: [],
          sessionHistory: [],
          totalActiveSessions: 0,
          lastUpdated: new Date().toISOString()
        }
      });
    }
  }

  // 거래 내역 조회
  static async getTradingHistory(req, res) {
    try {
      const userId = req.user.id;
      const { sessionId, limit = 50, offset = 0 } = req.query;

      console.log(`📋 거래 내역 조회: userId=${userId}, sessionId=${sessionId}, limit=${limit}, offset=${offset}`);

      let queryText;
      let queryParams;

      // sessionId가 있는 경우와 없는 경우를 명확히 분리
      if (sessionId && sessionId.trim() !== '') {
        queryText = `
          SELECT id, user_id, session_id, stock_code, trade_type, quantity, 
                 price, order_number, profit_loss, analysis_reason, 
                 COALESCE(market_type, 'domestic') as market_type, executed_at
          FROM trade_logs 
          WHERE user_id = $1 AND session_id = $2
          ORDER BY executed_at DESC 
          LIMIT $3 OFFSET $4
        `;
        queryParams = [userId, sessionId, parseInt(limit), parseInt(offset)];
      } else {
        queryText = `
          SELECT id, user_id, session_id, stock_code, trade_type, quantity, 
                 price, order_number, profit_loss, analysis_reason, 
                 COALESCE(market_type, 'domestic') as market_type, executed_at
          FROM trade_logs 
          WHERE user_id = $1
          ORDER BY executed_at DESC 
          LIMIT $2 OFFSET $3
        `;
        queryParams = [userId, parseInt(limit), parseInt(offset)];
      }

      console.log('🔍 실행할 쿼리:', queryText);
      console.log('🔍 쿼리 파라미터:', queryParams);

      let result;
      try {
        result = await query(queryText, queryParams);
        console.log(`✅ 거래 내역 조회 성공: ${result.rows.length}개`);
      } catch (dbError) {
        console.error('❌ DB 쿼리 실행 실패:', dbError);
        console.log('⚠️ 거래 내역 조회 실패, 빈 배열 반환');
        result = { rows: [] };
      }

      res.json({
        success: true,
        data: {
          trades: result.rows,
          pagination: {
            limit: parseInt(limit),
            offset: parseInt(offset),
            total: result.rows.length,
            hasMore: result.rows.length === parseInt(limit)
          }
        }
      });

    } catch (error) {
      console.error('❌ 거래 내역 조회 실패:', error);
      res.status(500).json({
        success: false,
        message: '거래 내역 조회에 실패했습니다.',
        error: process.env.NODE_ENV === 'development' ? error.message : '서버 오류',
        data: {
          trades: [],
          pagination: {
            limit: parseInt(req.query.limit || 50),
            offset: parseInt(req.query.offset || 0),
            total: 0,
            hasMore: false
          }
        }
      });
    }
  }

  // 자동매매 실행 로직
  static async executeAutoTrading(session) {
    console.log(`🤖 자동매매 실행 시작: ${session.sessionId}`);

    try {
      const stockInvestmentAmount = session.investmentAmount / session.stocks.length;

      while (session.status === 'ACTIVE') {
        for (const stock of session.stocks) {
          if (session.status !== 'ACTIVE') break;

          try {
            // 전략 분석 실행
            const analysis = await TradingStrategies.comprehensiveAnalysis(stock.symbol);
            
            // 현재 포지션 확인
            const currentPosition = session.positions.get(stock.symbol);
            
            // 매매 신호에 따른 주문 실행
            if (analysis.finalSignal === 'BUY' && analysis.confidence >= 0.6) {
              await this.executeBuyOrder(session, stock, stockInvestmentAmount, analysis);
            } else if (analysis.finalSignal === 'SELL' && analysis.confidence >= 0.6 && currentPosition) {
              await this.executeSellOrder(session, stock, currentPosition, analysis);
            }

            // API 호출 제한을 위한 지연
            await new Promise(resolve => setTimeout(resolve, 1000));

          } catch (stockError) {
            console.error(`❌ ${stock.symbol} 매매 처리 실패:`, stockError);
          }
        }

        // 5분마다 실행
        await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
      }

    } catch (error) {
      console.error(`❌ 자동매매 실행 오류 [${session.sessionId}]:`, error);
      session.status = 'ERROR';
      
      // 에러 상태를 데이터베이스에 업데이트
      await query(
        `UPDATE trading_sessions 
         SET status = 'ERROR', ended_at = CURRENT_TIMESTAMP, error_message = $1
         WHERE session_id = $2`,
        [error.message, session.sessionId]
      );
    }
  }

  // 매수 주문 실행
  static async executeBuyOrder(session, stock, investmentAmount, analysis) {
    try {
      const priceData = session.marketType === 'domestic' 
        ? await kisService.getStockPrice(stock.symbol)
        : await kisService.getOverseasStockPrice(stock.symbol);

      if (!priceData.success) return;

      const currentPrice = priceData.data.currentPrice;
      const quantity = Math.floor(investmentAmount / currentPrice);

      if (quantity <= 0) return;

      console.log(`💰 매수 주문: ${stock.symbol}, 수량: ${quantity}, 가격: ${currentPrice}`);

      const orderResult = session.marketType === 'domestic'
        ? await kisService.buyStock(stock.symbol, quantity, currentPrice, '01') // 시장가
        : await kisService.buyStock(stock.symbol, quantity, currentPrice, '01'); // 해외는 별도 구현 필요

      if (orderResult.success) {
        // 포지션 업데이트
        session.positions.set(stock.symbol, {
          symbol: stock.symbol,
          quantity,
          avgPrice: currentPrice,
          orderTime: new Date(),
          analysis: analysis.reason
        });

        // 주문 기록
        session.orders.push({
          type: 'BUY',
          symbol: stock.symbol,
          quantity,
          price: currentPrice,
          time: new Date(),
          orderNumber: orderResult.orderNumber,
          analysis: analysis.reason
        });

        // 데이터베이스에 거래 로그 저장
        await query(
          `INSERT INTO trade_logs (
            user_id, session_id, stock_code, trade_type, quantity, 
            price, order_number, analysis_reason, executed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
          [
            session.userId, session.sessionId, stock.symbol, 'BUY',
            quantity, currentPrice, orderResult.orderNumber, analysis.reason
          ]
        );

        console.log(`✅ 매수 완료: ${stock.symbol}`);
      }

    } catch (error) {
      console.error(`❌ 매수 주문 실행 실패 [${stock.symbol}]:`, error);
    }
  }

  // 매도 주문 실행
  static async executeSellOrder(session, stock, position, analysis) {
    try {
      const priceData = session.marketType === 'domestic'
        ? await kisService.getStockPrice(stock.symbol)
        : await kisService.getOverseasStockPrice(stock.symbol);

      if (!priceData.success) return;

      const currentPrice = priceData.data.currentPrice;

      console.log(`💸 매도 주문: ${stock.symbol}, 수량: ${position.quantity}, 가격: ${currentPrice}`);

      const orderResult = session.marketType === 'domestic'
        ? await kisService.sellStock(stock.symbol, position.quantity, currentPrice, '01')
        : await kisService.sellStock(stock.symbol, position.quantity, currentPrice, '01');

      if (orderResult.success) {
        // 수익 계산
        const profit = (currentPrice - position.avgPrice) * position.quantity;
        session.totalProfit += profit;

        // 포지션 제거
        session.positions.delete(stock.symbol);

        // 주문 기록
        session.orders.push({
          type: 'SELL',
          symbol: stock.symbol,
          quantity: position.quantity,
          price: currentPrice,
          time: new Date(),
          orderNumber: orderResult.orderNumber,
          profit,
          analysis: analysis.reason
        });

        // 데이터베이스에 거래 로그 저장
        await query(
          `INSERT INTO trade_logs (
            user_id, session_id, stock_code, trade_type, quantity, 
            price, order_number, profit_loss, analysis_reason, executed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)`,
          [
            session.userId, session.sessionId, stock.symbol, 'SELL',
            position.quantity, currentPrice, orderResult.orderNumber, profit, analysis.reason
          ]
        );

        console.log(`✅ 매도 완료: ${stock.symbol}, 수익: ${profit.toLocaleString()}원`);
      }

    } catch (error) {
      console.error(`❌ 매도 주문 실행 실패 [${stock.symbol}]:`, error);
    }
  }

  // 실시간 주가 조회
  static async getStockPrice(req, res) {
    try {
      const { stockCode, marketType = 'domestic' } = req.query;

      if (!stockCode) {
        return res.status(400).json({
          success: false,
          message: '종목 코드가 필요합니다.'
        });
      }

      const priceData = marketType === 'domestic'
        ? await kisService.getStockPrice(stockCode)
        : await kisService.getOverseasStockPrice(stockCode);

      res.json(priceData);

    } catch (error) {
      console.error('❌ 실시간 주가 조회 실패:', error);
      res.status(500).json({
        success: false,
        message: '주가 조회에 실패했습니다.',
        error: error.message
      });
    }
  }
  
  // 해외주식 매수 (기존 buyStock에서 분리)
  static async buyOverseasStock(stockCode, quantity, price, orderType = '01') {
    try {
      const headers = await this.getHeaders('JTTT1002U');
      
      const response = await axios.post(`${this.baseURL}/uapi/overseas-stock/v1/trading/order`, {
        CANO: this.accountNo,
        ACNT_PRDT_CD: this.accountProductCd,
        OVRS_EXCG_CD: 'NASD', // 나스닥
        PDNO: stockCode,
        ORD_DVSN: orderType,
        ORD_QTY: quantity.toString(),
        OVRS_ORD_UNPR: price.toString(),
        SLL_TYPE: '00', // 매수
        ORD_SVR_DVSN_CD: '0'
      }, { headers });
  
      return {
        success: response.data.rt_cd === '0',
        message: response.data.msg1,
        orderNumber: response.data.output?.KRX_FWDG_ORD_ORGNO || '',
        data: response.data.output
      };
    } catch (error) {
      console.error('❌ 해외주식 매수 주문 실패:', error.response?.data || error.message);
      throw new Error('해외주식 매수 주문에 실패했습니다.');
    }
  }
  
  // 해외주식 매도 (기존 sellStock에서 분리)
  static async sellOverseasStock(stockCode, quantity, price, orderType = '01') {
    try {
      const headers = await this.getHeaders('JTTT1006U');
      
      const response = await axios.post(`${this.baseURL}/uapi/overseas-stock/v1/trading/order`, {
        CANO: this.accountNo,
        ACNT_PRDT_CD: this.accountProductCd,
        OVRS_EXCG_CD: 'NASD',
        PDNO: stockCode,
        ORD_DVSN: orderType,
        ORD_QTY: quantity.toString(),
        OVRS_ORD_UNPR: price.toString(),
        SLL_TYPE: '01', // 매도
        ORD_SVR_DVSN_CD: '0'
      }, { headers });
  
      return {
        success: response.data.rt_cd === '0',
        message: response.data.msg1,
        orderNumber: response.data.output?.KRX_FWDG_ORD_ORGNO || '',
        data: response.data.output
      };
    } catch (error) {
      console.error('❌ 해외주식 매도 주문 실패:', error.response?.data || error.message);
      throw new Error('해외주식 매도 주문에 실패했습니다.');
    }
  }
  
  // TradingController에 추가할 매수/매도 로직 수정
  static async executeBuyOrder(session, stock, investmentAmount, analysis) {
    try {
      const priceData = session.marketType === 'domestic' 
        ? await kisService.getStockPrice(stock.symbol)
        : await kisService.getOverseasStockPrice(stock.symbol);
  
      if (!priceData.success) return;
  
      const currentPrice = priceData.data.currentPrice;
      let quantity;
      
      // 해외주식인 경우 소수점 계산
      if (session.marketType === 'overseas') {
        quantity = Math.floor(investmentAmount / currentPrice);
      } else {
        quantity = Math.floor(investmentAmount / currentPrice);
      }
  
      if (quantity <= 0) return;
  
      console.log(`💰 매수 주문: ${stock.symbol}, 수량: ${quantity}, 가격: ${currentPrice}`);
  
      let orderResult;
      if (session.marketType === 'domestic') {
        orderResult = await kisService.buyStock(stock.symbol, quantity, currentPrice, '01');
      } else {
        orderResult = await this.buyOverseasStock(stock.symbol, quantity, currentPrice, '01');
      }
  
      if (orderResult.success) {
        // 포지션 업데이트
        session.positions.set(stock.symbol, {
          symbol: stock.symbol,
          quantity,
          avgPrice: currentPrice,
          orderTime: new Date(),
          analysis: analysis.reason,
          marketType: session.marketType
        });
  
        // 주문 기록
        session.orders.push({
          type: 'BUY',
          symbol: stock.symbol,
          quantity,
          price: currentPrice,
          time: new Date(),
          orderNumber: orderResult.orderNumber,
          analysis: analysis.reason,
          marketType: session.marketType
        });
  
        // 데이터베이스에 거래 로그 저장
        await query(
          `INSERT INTO trade_logs (
            user_id, session_id, stock_code, trade_type, quantity, 
            price, order_number, analysis_reason, market_type, executed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)`,
          [
            session.userId, session.sessionId, stock.symbol, 'BUY',
            quantity, currentPrice, orderResult.orderNumber, analysis.reason, session.marketType
          ]
        );
  
        console.log(`✅ 매수 완료: ${stock.symbol}`);
      }
  
    } catch (error) {
      console.error(`❌ 매수 주문 실행 실패 [${stock.symbol}]:`, error);
    }
  }
  
  // TradingController에 추가할 매도 로직 수정
  static async executeSellOrder(session, stock, position, analysis) {
    try {
      const priceData = session.marketType === 'domestic'
        ? await kisService.getStockPrice(stock.symbol)
        : await kisService.getOverseasStockPrice(stock.symbol);
  
      if (!priceData.success) return;
  
      const currentPrice = priceData.data.currentPrice;
  
      console.log(`💸 매도 주문: ${stock.symbol}, 수량: ${position.quantity}, 가격: ${currentPrice}`);
  
      let orderResult;
      if (session.marketType === 'domestic') {
        orderResult = await kisService.sellStock(stock.symbol, position.quantity, currentPrice, '01');
      } else {
        orderResult = await this.sellOverseasStock(stock.symbol, position.quantity, currentPrice, '01');
      }
  
      if (orderResult.success) {
        // 수익 계산
        const profit = (currentPrice - position.avgPrice) * position.quantity;
        session.totalProfit += profit;
  
        // 포지션 제거
        session.positions.delete(stock.symbol);
  
        // 주문 기록
        session.orders.push({
          type: 'SELL',
          symbol: stock.symbol,
          quantity: position.quantity,
          price: currentPrice,
          time: new Date(),
          orderNumber: orderResult.orderNumber,
          profit,
          analysis: analysis.reason,
          marketType: session.marketType
        });
  
        // 데이터베이스에 거래 로그 저장
        await query(
          `INSERT INTO trade_logs (
            user_id, session_id, stock_code, trade_type, quantity, 
            price, order_number, profit_loss, analysis_reason, market_type, executed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)`,
          [
            session.userId, session.sessionId, stock.symbol, 'SELL',
            position.quantity, currentPrice, orderResult.orderNumber, profit, analysis.reason, session.marketType
          ]
        );
  
        console.log(`✅ 매도 완료: ${stock.symbol}, 수익: ${profit.toLocaleString()}원`);
      }
  
    } catch (error) {
      console.error(`❌ 매도 주문 실행 실패 [${stock.symbol}]:`, error);
    }
  }
}


module.exports = TradingController;