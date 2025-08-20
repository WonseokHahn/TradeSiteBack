// src/services/tradingEngine.js
const kisService = require('./kisService');
const aiService = require('./aiService');
const { query } = require('../config/database');
const EventEmitter = require('events');

class TradingEngine extends EventEmitter {
  constructor() {
    super();
    this.activeTradings = new Map(); // userId -> trading config
    this.intervals = new Map(); // userId -> interval reference
    this.positions = new Map(); // userId -> positions
  }

  // 자동매매 시작
  async startTrading(userId, configId, config) {
    try {
      console.log(`🚀 자동매매 시작: 사용자 ${userId}, 설정 ${configId}`);

      // 기존 실행중인 매매가 있으면 중지
      if (this.activeTradings.has(userId)) {
        await this.stopTrading(userId, this.activeTradings.get(userId).configId);
      }

      // 설정 저장
      this.activeTradings.set(userId, {
        configId,
        ...config,
        startTime: new Date(),
        status: 'running'
      });

      // 초기 포지션 확인
      await this.updatePositions(userId);

      // 주식별 배분 계산
      const allocations = this.calculateAllocations(config);
      
      // 초기 매수 실행
      await this.executeInitialPurchases(userId, allocations);

      // 주기적 모니터링 시작 (30초마다)
      const interval = setInterval(async () => {
        try {
          await this.monitorAndTrade(userId);
        } catch (error) {
          console.error(`자동매매 모니터링 오류 (사용자 ${userId}):`, error);
          // 3번 연속 오류 시 자동 중지
          const tradingConfig = this.activeTradings.get(userId);
          if (tradingConfig) {
            tradingConfig.errorCount = (tradingConfig.errorCount || 0) + 1;
            if (tradingConfig.errorCount >= 3) {
              console.log(`연속 오류로 자동매매 중지: 사용자 ${userId}`);
              await this.stopTrading(userId, configId);
            }
          }
        }
      }, 30000);

      this.intervals.set(userId, interval);

      // 상태 업데이트
      await query(`
        UPDATE auto_trading_configs 
        SET status = 'running', started_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [configId]);

      console.log(`✅ 자동매매 시작 완료: 사용자 ${userId}`);
      this.emit('tradingStarted', { userId, configId });

    } catch (error) {
      console.error('자동매매 시작 실패:', error);
      throw error;
    }
  }

  // 자동매매 중지
  async stopTrading(userId, configId) {
    try {
      console.log(`⏹️ 자동매매 중지: 사용자 ${userId}`);

      // 인터벌 정리
      if (this.intervals.has(userId)) {
        clearInterval(this.intervals.get(userId));
        this.intervals.delete(userId);
      }

      // 활성 거래 정리
      this.activeTradings.delete(userId);
      this.positions.delete(userId);

      // 상태 업데이트
      if (configId) {
        await query(`
          UPDATE auto_trading_configs 
          SET status = 'stopped', stopped_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [configId]);
      }

      console.log(`✅ 자동매매 중지 완료: 사용자 ${userId}`);
      this.emit('tradingStopped', { userId, configId });

    } catch (error) {
      console.error('자동매매 중지 실패:', error);
      throw error;
    }
  }

  // 자동매매 일시정지
  async pauseTrading(userId, configId) {
    try {
      console.log(`⏸️ 자동매매 일시정지: 사용자 ${userId}`);

      const tradingConfig = this.activeTradings.get(userId);
      if (tradingConfig) {
        tradingConfig.status = 'paused';
      }

      await query(`
        UPDATE auto_trading_configs 
        SET status = 'paused'
        WHERE id = $1
      `, [configId]);

      console.log(`✅ 자동매매 일시정지 완료: 사용자 ${userId}`);
      this.emit('tradingPaused', { userId, configId });

    } catch (error) {
      console.error('자동매매 일시정지 실패:', error);
      throw error;
    }
  }

  // 주식별 투자 배분 계산
  calculateAllocations(config) {
    const { stocks, investmentAmount, allocationMethod } = config;
    const allocations = {};

    switch (allocationMethod) {
      case 'equal':
        const equalAmount = Math.floor(investmentAmount / stocks.length);
        stocks.forEach(stockCode => {
          allocations[stockCode] = equalAmount;
        });
        break;

      case 'weighted':
        // AI 신뢰도 기반 가중 배분 (구현 필요)
        const totalWeight = stocks.length;
        stocks.forEach(stockCode => {
          allocations[stockCode] = Math.floor(investmentAmount / totalWeight);
        });
        break;

      case 'custom':
        // 사용자 정의 배분 (추후 구현)
        const customAmount = Math.floor(investmentAmount / stocks.length);
        stocks.forEach(stockCode => {
          allocations[stockCode] = customAmount;
        });
        break;

      default:
        const defaultAmount = Math.floor(investmentAmount / stocks.length);
        stocks.forEach(stockCode => {
          allocations[stockCode] = defaultAmount;
        });
    }

    return allocations;
  }

  // 초기 매수 실행
  async executeInitialPurchases(userId, allocations) {
    try {
      console.log(`💰 초기 매수 실행: 사용자 ${userId}`);

      for (const [stockCode, amount] of Object.entries(allocations)) {
        try {
          const stockPrice = await kisService.getStockPrice(stockCode);
          const quantity = Math.floor(amount / stockPrice.currentPrice);

          if (quantity > 0) {
            console.log(`매수 주문: ${stockCode} ${quantity}주`);
            const orderResult = await kisService.buyStock(stockCode, quantity, 'market');

            // 거래 기록 저장
            await this.saveTradeRecord(userId, {
              stockCode,
              stockName: stockPrice.stockName,
              type: 'buy',
              quantity,
              price: stockPrice.currentPrice,
              amount: quantity * stockPrice.currentPrice,
              orderId: orderResult.orderId,
              status: 'pending'
            });
          }
        } catch (error) {
          console.error(`초기 매수 실패 ${stockCode}:`, error);
        }
      }

      console.log(`✅ 초기 매수 완료: 사용자 ${userId}`);
    } catch (error) {
      console.error('초기 매수 실행 실패:', error);
      throw error;
    }
  }

  // 모니터링 및 자동매매 실행
  async monitorAndTrade(userId) {
    try {
      const tradingConfig = this.activeTradings.get(userId);
      if (!tradingConfig || tradingConfig.status !== 'running') {
        return;
      }

      console.log(`🔍 모니터링: 사용자 ${userId}`);

      // 현재 포지션 업데이트
      await this.updatePositions(userId);

      // 각 보유 종목에 대해 매매 신호 확인
      const positions = this.positions.get(userId) || [];
      
      for (const position of positions) {
        try {
          await this.checkTradingSignals(userId, position, tradingConfig);
        } catch (error) {
          console.error(`매매 신호 확인 실패 ${position.code}:`, error);
        }
      }

      // 손절/익절 확인
      await this.checkStopLossAndTakeProfit(userId, tradingConfig);

      // 오류 카운트 리셋
      tradingConfig.errorCount = 0;

    } catch (error) {
      console.error(`모니터링 실패 (사용자 ${userId}):`, error);
      throw error;
    }
  }

  // 포지션 업데이트
  async updatePositions(userId) {
    try {
      const positions = await kisService.getPositions();
      this.positions.set(userId, positions);
      return positions;
    } catch (error) {
      console.error('포지션 업데이트 실패:', error);
      throw error;
    }
  }

  // 매매 신호 확인
  async checkTradingSignals(userId, position, tradingConfig) {
    try {
      const { strategy, strategyParams } = tradingConfig;
      
      // 기술적 지표 계산을 위한 과거 데이터 필요 (임시로 현재가만 사용)
      const currentPrice = await kisService.getStockPrice(position.code);
      
      // 간단한 신호 생성 (실제로는 과거 데이터 필요)
      const signals = this.generateSimpleSignals(currentPrice, position, strategy, strategyParams);

      if (signals.buy && !position.quantity) {
        // 신규 매수
        await this.executeBuyOrder(userId, position.code, tradingConfig);
      } else if (signals.sell && position.quantity > 0) {
        // 매도
        await this.executeSellOrder(userId, position.code, position.quantity);
      }

    } catch (error) {
      console.error('매매 신호 확인 실패:', error);
      throw error;
    }
  }

  // 간단한 매매 신호 생성
  generateSimpleSignals(currentPrice, position, strategy, params) {
    const signals = { buy: false, sell: false, hold: true };

    try {
      switch (strategy) {
        case 'moving_average':
          // 간단한 이동평균 신호 (실제로는 과거 데이터 필요)
          if (currentPrice.changeRate > 2) {
            signals.buy = true;
            signals.hold = false;
          } else if (currentPrice.changeRate < -2) {
            signals.sell = true;
            signals.hold = false;
          }
          break;

        case 'rsi_reversal':
          // RSI 기반 신호 (임시)
          if (currentPrice.changeRate < -3) {
            signals.buy = true;
            signals.hold = false;
          } else if (currentPrice.changeRate > 5) {
            signals.sell = true;
            signals.hold = false;
          }
          break;

        case 'bollinger_squeeze':
          // 볼린저 밴드 신호 (임시)
          if (Math.abs(currentPrice.changeRate) > 3) {
            if (currentPrice.changeRate > 0) {
              signals.sell = true;
            } else {
              signals.buy = true;
            }
            signals.hold = false;
          }
          break;
      }
    } catch (error) {
      console.error('신호 생성 실패:', error);
    }

    return signals;
  }

  // 손절/익절 확인
  async checkStopLossAndTakeProfit(userId, tradingConfig) {
    try {
      const positions = this.positions.get(userId) || [];
      const { stopLoss, takeProfit } = tradingConfig;

      for (const position of positions) {
        if (position.quantity <= 0) continue;

        const pnlPercent = position.pnlPercent || 0;

        // 손절 확인
        if (stopLoss && pnlPercent <= -stopLoss) {
          console.log(`🔻 손절 실행: ${position.name} (${pnlPercent}%)`);
          await this.executeSellOrder(userId, position.code, position.quantity, '손절');
        }
        // 익절 확인
        else if (takeProfit && pnlPercent >= takeProfit) {
          console.log(`🔺 익절 실행: ${position.name} (${pnlPercent}%)`);
          await this.executeSellOrder(userId, position.code, position.quantity, '익절');
        }
      }
    } catch (error) {
      console.error('손절/익절 확인 실패:', error);
      throw error;
    }
  }

  // 매수 주문 실행
  async executeBuyOrder(userId, stockCode, tradingConfig) {
    try {
      const stockPrice = await kisService.getStockPrice(stockCode);
      const allocatedAmount = Math.floor(tradingConfig.investmentAmount / tradingConfig.stocks.length);
      const quantity = Math.floor(allocatedAmount / stockPrice.currentPrice);

      if (quantity <= 0) return;

      console.log(`💰 매수 주문 실행: ${stockCode} ${quantity}주`);
      
      const orderResult = await kisService.buyStock(stockCode, quantity, 'market');

      await this.saveTradeRecord(userId, {
        stockCode,
        stockName: stockPrice.stockName,
        type: 'buy',
        quantity,
        price: stockPrice.currentPrice,
        amount: quantity * stockPrice.currentPrice,
        orderId: orderResult.orderId,
        status: 'pending',
        reason: '자동매매 신호'
      });

      console.log(`✅ 매수 주문 완료: ${stockCode}`);
    } catch (error) {
      console.error(`매수 주문 실패 ${stockCode}:`, error);
      throw error;
    }
  }

  // 매도 주문 실행
  async executeSellOrder(userId, stockCode, quantity, reason = '자동매매 신호') {
    try {
      console.log(`💸 매도 주문 실행: ${stockCode} ${quantity}주 (${reason})`);
      
      const stockPrice = await kisService.getStockPrice(stockCode);
      const orderResult = await kisService.sellStock(stockCode, quantity, 'market');

      await this.saveTradeRecord(userId, {
        stockCode,
        stockName: stockPrice.stockName,
        type: 'sell',
        quantity,
        price: stockPrice.currentPrice,
        amount: quantity * stockPrice.currentPrice,
        orderId: orderResult.orderId,
        status: 'pending',
        reason
      });

      console.log(`✅ 매도 주문 완료: ${stockCode}`);
    } catch (error) {
      console.error(`매도 주문 실패 ${stockCode}:`, error);
      throw error;
    }
  }

  // 거래 기록 저장
  async saveTradeRecord(userId, tradeData) {
    try {
      await query(`
        INSERT INTO trading_history (
          user_id, stock_code, stock_name, trade_type, quantity, 
          price, amount, order_id, status, reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        userId,
        tradeData.stockCode,
        tradeData.stockName,
        tradeData.type,
        tradeData.quantity,
        tradeData.price,
        tradeData.amount,
        tradeData.orderId,
        tradeData.status,
        tradeData.reason || '자동매매'
      ]);

      console.log(`💾 거래 기록 저장 완료: ${tradeData.type} ${tradeData.stockCode}`);
    } catch (error) {
      console.error('거래 기록 저장 실패:', error);
    }
  }

  // 백테스트 실행
  async runBacktest(config) {
    try {
      console.log('📊 백테스트 실행 시작');

      const { strategy, strategyParams, stocks, period } = config;
      
      // 임시 백테스트 결과 (실제로는 과거 데이터를 이용한 시뮬레이션 필요)
      const backtestResult = {
        strategy,
        period,
        initialCapital: 10000000, // 1천만원
        finalCapital: 0,
        totalReturn: 0,
        totalReturnPercent: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        totalTrades: 0,
        winRate: 0,
        profitFactor: 0,
        dailyReturns: [],
        trades: [],
        performance: {
          daily: [],
          monthly: [],
          yearly: []
        }
      };

      // 간단한 백테스트 시뮬레이션
      const startDate = this.getBacktestStartDate(period);
      const endDate = new Date();
      
      let capital = backtestResult.initialCapital;
      let maxCapital = capital;
      let minCapital = capital;
      const dailyCapital = [];

      // 각 종목에 대한 시뮬레이션
      for (const stockCode of stocks) {
        try {
          const stockResult = await this.simulateStockTrading(stockCode, strategy, strategyParams, startDate, endDate, capital / stocks.length);
          
          capital += stockResult.profit;
          backtestResult.totalTrades += stockResult.trades;
          backtestResult.trades.push(...stockResult.tradeHistory);

          dailyCapital.push(...stockResult.dailyValues);
          maxCapital = Math.max(maxCapital, capital);
          minCapital = Math.min(minCapital, capital);

        } catch (error) {
          console.error(`백테스트 실패 ${stockCode}:`, error);
        }
      }

      // 결과 계산
      backtestResult.finalCapital = capital;
      backtestResult.totalReturn = capital - backtestResult.initialCapital;
      backtestResult.totalReturnPercent = (backtestResult.totalReturn / backtestResult.initialCapital) * 100;
      backtestResult.maxDrawdown = ((maxCapital - minCapital) / maxCapital) * 100;

      // 승률 계산
      const winningTrades = backtestResult.trades.filter(trade => trade.profit > 0);
      backtestResult.winRate = backtestResult.totalTrades > 0 ? (winningTrades.length / backtestResult.totalTrades) * 100 : 0;

      // 샤프 비율 계산 (간단화)
      if (dailyCapital.length > 1) {
        const returns = dailyCapital.slice(1).map((value, index) => (value - dailyCapital[index]) / dailyCapital[index]);
        const avgReturn = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
        const returnStd = Math.sqrt(returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length);
        backtestResult.sharpeRatio = returnStd > 0 ? (avgReturn / returnStd) * Math.sqrt(252) : 0;
      }

      console.log('✅ 백테스트 실행 완료:', {
        totalReturn: backtestResult.totalReturnPercent.toFixed(2) + '%',
        winRate: backtestResult.winRate.toFixed(2) + '%',
        totalTrades: backtestResult.totalTrades
      });

      return backtestResult;
    } catch (error) {
      console.error('백테스트 실행 실패:', error);
      throw error;
    }
  }

  // 백테스트 시작 날짜 계산
  getBacktestStartDate(period) {
    const endDate = new Date();
    const startDate = new Date(endDate);

    switch (period) {
      case '1month':
        startDate.setMonth(endDate.getMonth() - 1);
        break;
      case '3months':
        startDate.setMonth(endDate.getMonth() - 3);
        break;
      case '6months':
        startDate.setMonth(endDate.getMonth() - 6);
        break;
      case '1year':
        startDate.setFullYear(endDate.getFullYear() - 1);
        break;
      default:
        startDate.setMonth(endDate.getMonth() - 3);
    }

    return startDate;
  }

  // 개별 종목 트레이딩 시뮬레이션
  async simulateStockTrading(stockCode, strategy, params, startDate, endDate, initialCapital) {
    try {
      // 실제로는 과거 데이터를 가져와야 하지만, 여기서는 간단한 시뮬레이션
      const result = {
        stockCode,
        profit: 0,
        trades: 0,
        tradeHistory: [],
        dailyValues: []
      };

      // 현재가 기준으로 간단한 수익률 계산
      const currentPrice = await kisService.getStockPrice(stockCode);
      const simulatedReturn = this.getSimulatedReturn(strategy, currentPrice.changeRate);
      
      result.profit = initialCapital * (simulatedReturn / 100);
      result.trades = Math.floor(Math.random() * 10) + 5; // 5-15 거래
      
      // 가상의 거래 기록 생성
      for (let i = 0; i < result.trades; i++) {
        const tradeDate = new Date(startDate.getTime() + (Math.random() * (endDate.getTime() - startDate.getTime())));
        const tradeProfit = (Math.random() - 0.5) * initialCapital * 0.1; // -5% ~ +5%
        
        result.tradeHistory.push({
          date: tradeDate,
          type: tradeProfit > 0 ? 'buy' : 'sell',
          profit: tradeProfit,
          stockCode
        });
      }

      // 일별 자본 변화 (간단화)
      const days = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24));
      for (let i = 0; i <= days; i++) {
        const dailyReturn = simulatedReturn / days;
        result.dailyValues.push(initialCapital * (1 + (dailyReturn * i) / 100));
      }

      return result;
    } catch (error) {
      console.error(`종목 시뮬레이션 실패 ${stockCode}:`, error);
      return {
        stockCode,
        profit: 0,
        trades: 0,
        tradeHistory: [],
        dailyValues: [initialCapital]
      };
    }
  }

  // 전략별 시뮬레이션 수익률 계산
  getSimulatedReturn(strategy, currentChangeRate) {
    const baseReturn = currentChangeRate || 0;
    
    switch (strategy) {
      case 'moving_average':
        return baseReturn * 1.2 + (Math.random() - 0.5) * 10; // 기본 수익률 + 랜덤
      case 'rsi_reversal':
        return baseReturn * 1.5 + (Math.random() - 0.5) * 15; // 더 높은 변동성
      case 'bollinger_squeeze':
        return baseReturn * 1.3 + (Math.random() - 0.5) * 12;
      default:
        return baseReturn + (Math.random() - 0.5) * 8;
    }
  }

  // 실행 중인 자동매매 상태 조회
  getTradingStatus(userId) {
    return this.activeTradings.get(userId) || null;
  }

  // 모든 실행 중인 자동매매 조회
  getAllActiveTradingUsers() {
    return Array.from(this.activeTradings.keys());
  }

  // 긴급 정지 (모든 자동매매 중지)
  async emergencyStopAll() {
    try {
      console.log('🚨 모든 자동매매 긴급 정지');
      
      const activeUsers = this.getAllActiveTradingUsers();
      
      for (const userId of activeUsers) {
        try {
          const config = this.activeTradings.get(userId);
          await this.stopTrading(userId, config?.configId);
        } catch (error) {
          console.error(`긴급 정지 실패 (사용자 ${userId}):`, error);
        }
      }

      console.log('✅ 모든 자동매매 긴급 정지 완료');
    } catch (error) {
      console.error('긴급 정지 실패:', error);
      throw error;
    }
  }

  // 시스템 상태 확인
  getSystemStatus() {
    return {
      activeTradings: this.activeTradings.size,
      totalPositions: Array.from(this.positions.values()).reduce((sum, positions) => sum + positions.length, 0),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new TradingEngine();