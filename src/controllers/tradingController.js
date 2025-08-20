// src/controllers/tradingController.js
const kisService = require('../services/kisService');
const aiService = require('../services/aiService');
const tradingEngine = require('../services/tradingEngine');
const { query } = require('../config/database');

// 계좌 정보 조회
const getAccountInfo = async (req, res) => {
  try {
    console.log('📊 계좌 정보 조회 요청:', req.user.id);
    
    const accountInfo = await kisService.getAccountBalance();
    
    res.json({
      success: true,
      data: {
        accountNo: process.env.KIS_ACCOUNT_NO,
        balance: accountInfo.availableAmount,
        totalAssets: accountInfo.totalAssets,
        totalPnL: accountInfo.totalPnL,
        totalPnLPercent: accountInfo.totalPnLPercent
      }
    });
  } catch (error) {
    console.error('❌ 계좌 정보 조회 실패:', error);
    res.status(500).json({
      success: false,
      message: '계좌 정보를 조회할 수 없습니다.',
      error: error.message
    });
  }
};

// AI 종목 추천
const getAIRecommendations = async (req, res) => {
  try {
    console.log('🤖 AI 종목 추천 요청:', req.user.id);
    
    // 시장 데이터 수집
    const marketData = await kisService.getMarketData();
    
    // AI 분석 및 추천
    const recommendations = await aiService.analyzeAndRecommend(marketData);
    
    // 실시간 가격 정보 추가
    const stocksWithPrice = await Promise.all(
      recommendations.map(async (stock) => {
        try {
          const priceInfo = await kisService.getStockPrice(stock.code);
          return {
            ...stock,
            currentPrice: priceInfo.currentPrice,
            changeRate: priceInfo.changeRate,
            changeAmount: priceInfo.changeAmount,
            volume: priceInfo.volume
          };
        } catch (error) {
          console.error(`가격 조회 실패 ${stock.code}:`, error);
          return stock;
        }
      })
    );
    
    res.json({
      success: true,
      data: stocksWithPrice
    });
  } catch (error) {
    console.error('❌ AI 종목 추천 실패:', error);
    res.status(500).json({
      success: false,
      message: 'AI 종목 추천을 받을 수 없습니다.',
      error: error.message
    });
  }
};

// 종목 검색
const searchStock = async (req, res) => {
  try {
    const { keyword } = req.query;
    
    if (!keyword || keyword.trim() === '') {
      return res.status(400).json({
        success: false,
        message: '검색 키워드를 입력해주세요.'
      });
    }
    
    console.log(`🔍 종목 검색 요청: ${keyword}`);
    
    const searchResults = await kisService.searchStock(keyword);
    
    res.json({
      success: true,
      data: searchResults
    });
  } catch (error) {
    console.error('❌ 종목 검색 실패:', error);
    res.status(500).json({
      success: false,
      message: '종목 검색에 실패했습니다.',
      error: error.message
    });
  }
};

// 현재 포지션 조회
const getPositions = async (req, res) => {
  try {
    console.log('📋 포지션 조회 요청:', req.user.id);
    
    const positions = await kisService.getPositions();
    
    // 각 포지션의 실시간 평가손익 계산
    const positionsWithPnL = await Promise.all(
      positions.map(async (position) => {
        try {
          const currentPrice = await kisService.getStockPrice(position.code);
          const pnl = (currentPrice.currentPrice - position.avgPrice) * position.quantity;
          const pnlPercent = ((currentPrice.currentPrice - position.avgPrice) / position.avgPrice * 100).toFixed(2);
          
          return {
            ...position,
            currentPrice: currentPrice.currentPrice,
            pnl: Math.round(pnl),
            pnlPercent: parseFloat(pnlPercent)
          };
        } catch (error) {
          console.error(`포지션 가격 조회 실패 ${position.code}:`, error);
          return position;
        }
      })
    );
    
    res.json({
      success: true,
      data: positionsWithPnL
    });
  } catch (error) {
    console.error('❌ 포지션 조회 실패:', error);
    res.status(500).json({
      success: false,
      message: '포지션을 조회할 수 없습니다.',
      error: error.message
    });
  }
};

// 거래 기록 조회
const getTradingHistory = async (req, res) => {
  try {
    const { filter = 'today' } = req.query;
    const userId = req.user.id;
    
    console.log(`📚 거래 기록 조회 요청: ${userId}, 필터: ${filter}`);
    
    let dateCondition = '';
    const today = new Date();
    
    switch (filter) {
      case 'today':
        dateCondition = `AND DATE(created_at) = CURRENT_DATE`;
        break;
      case 'week':
        dateCondition = `AND created_at >= CURRENT_DATE - INTERVAL '7 days'`;
        break;
      case 'month':
        dateCondition = `AND created_at >= CURRENT_DATE - INTERVAL '30 days'`;
        break;
    }
    
    const result = await query(`
      SELECT 
        id,
        stock_code,
        stock_name,
        trade_type as type,
        quantity,
        price,
        fee,
        status,
        created_at as timestamp
      FROM trading_history 
      WHERE user_id = $1 ${dateCondition}
      ORDER BY created_at DESC
      LIMIT 100
    `, [userId]);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ 거래 기록 조회 실패:', error);
    res.status(500).json({
      success: false,
      message: '거래 기록을 조회할 수 없습니다.',
      error: error.message
    });
  }
};

// 자동매매 시작
const startAutoTrading = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      strategy,
      strategyParams,
      stocks,
      investmentAmount,
      allocationMethod,
      stopLoss,
      takeProfit
    } = req.body;
    
    console.log('🚀 자동매매 시작 요청:', {
      userId,
      strategy,
      stocks: stocks.length,
      investmentAmount
    });
    
    // 입력값 검증
    if (!strategy || !stocks || stocks.length === 0 || !investmentAmount) {
      return res.status(400).json({
        success: false,
        message: '필수 정보가 누락되었습니다.'
      });
    }
    
    // 잔고 확인
    const accountInfo = await kisService.getAccountBalance();
    if (investmentAmount > accountInfo.availableAmount) {
      return res.status(400).json({
        success: false,
        message: '투자 금액이 사용 가능 잔고를 초과합니다.'
      });
    }
    
    // 자동매매 설정 저장
    const configResult = await query(`
      INSERT INTO auto_trading_configs (
        user_id, strategy, strategy_params, stocks, 
        investment_amount, allocation_method, stop_loss, take_profit, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'running')
      RETURNING id
    `, [
      userId,
      strategy,
      JSON.stringify(strategyParams),
      JSON.stringify(stocks),
      investmentAmount,
      allocationMethod,
      stopLoss,
      takeProfit
    ]);
    
    const configId = configResult.rows[0].id;
    
    // 자동매매 엔진 시작
    await tradingEngine.startTrading(userId, configId, {
      strategy,
      strategyParams,
      stocks,
      investmentAmount,
      allocationMethod,
      stopLoss,
      takeProfit
    });
    
    res.json({
      success: true,
      message: '자동매매가 시작되었습니다.',
      data: { configId }
    });
  } catch (error) {
    console.error('❌ 자동매매 시작 실패:', error);
    res.status(500).json({
      success: false,
      message: '자동매매 시작에 실패했습니다.',
      error: error.message
    });
  }
};

// 자동매매 중지
const stopAutoTrading = async (req, res) => {
  try {
    const userId = req.user.id;
    
    console.log('⏹️ 자동매매 중지 요청:', userId);
    
    // 실행 중인 자동매매 설정 찾기
    const configResult = await query(`
      SELECT id FROM auto_trading_configs 
      WHERE user_id = $1 AND status = 'running'
      ORDER BY created_at DESC 
      LIMIT 1
    `, [userId]);
    
    if (configResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: '실행 중인 자동매매가 없습니다.'
      });
    }
    
    const configId = configResult.rows[0].id;
    
    // 자동매매 엔진 중지
    await tradingEngine.stopTrading(userId, configId);
    
    // 상태 업데이트
    await query(`
      UPDATE auto_trading_configs 
      SET status = 'stopped', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [configId]);
    
    res.json({
      success: true,
      message: '자동매매가 중지되었습니다.'
    });
  } catch (error) {
    console.error('❌ 자동매매 중지 실패:', error);
    res.status(500).json({
      success: false,
      message: '자동매매 중지에 실패했습니다.',
      error: error.message
    });
  }
};

// 자동매매 일시정지
const pauseAutoTrading = async (req, res) => {
  try {
    const userId = req.user.id;
    
    console.log('⏸️ 자동매매 일시정지 요청:', userId);
    
    // 실행 중인 자동매매 설정 찾기
    const configResult = await query(`
      SELECT id FROM auto_trading_configs 
      WHERE user_id = $1 AND status = 'running'
      ORDER BY created_at DESC 
      LIMIT 1
    `, [userId]);
    
    if (configResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: '실행 중인 자동매매가 없습니다.'
      });
    }
    
    const configId = configResult.rows[0].id;
    
    // 자동매매 엔진 일시정지
    await tradingEngine.pauseTrading(userId, configId);
    
    // 상태 업데이트
    await query(`
      UPDATE auto_trading_configs 
      SET status = 'paused', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [configId]);
    
    res.json({
      success: true,
      message: '자동매매가 일시정지되었습니다.'
    });
  } catch (error) {
    console.error('❌ 자동매매 일시정지 실패:', error);
    res.status(500).json({
      success: false,
      message: '자동매매 일시정지에 실패했습니다.',
      error: error.message
    });
  }
};

// 포지션 매도
const sellPosition = async (req, res) => {
  try {
    const { stockCode, quantity } = req.body;
    const userId = req.user.id;
    
    console.log('💰 매도 주문 요청:', { userId, stockCode, quantity });
    
    if (!stockCode || !quantity) {
      return res.status(400).json({
        success: false,
        message: '종목 코드와 수량을 입력해주세요.'
      });
    }
    
    // 보유 수량 확인
    const positions = await kisService.getPositions();
    const position = positions.find(p => p.code === stockCode);
    
    if (!position) {
      return res.status(400).json({
        success: false,
        message: '해당 종목을 보유하고 있지 않습니다.'
      });
    }
    
    if (quantity > position.quantity) {
      return res.status(400).json({
        success: false,
        message: '보유 수량을 초과하여 매도할 수 없습니다.'
      });
    }
    
    // 매도 주문 실행
    const orderResult = await kisService.sellStock(stockCode, quantity, 'market');
    
    // 거래 기록 저장
    await query(`
      INSERT INTO trading_history (
        user_id, stock_code, stock_name, trade_type, quantity, price, fee, status, order_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      userId,
      stockCode,
      position.name,
      'sell',
      quantity,
      orderResult.price || 0,
      orderResult.fee || 0,
      orderResult.status,
      orderResult.orderId
    ]);
    
    res.json({
      success: true,
      message: `${position.name} ${quantity}주 매도 주문이 접수되었습니다.`,
      data: orderResult
    });
  } catch (error) {
    console.error('❌ 매도 주문 실패:', error);
    res.status(500).json({
      success: false,
      message: '매도 주문에 실패했습니다.',
      error: error.message
    });
  }
};

// 실시간 가격 조회
const getRealtimePrice = async (req, res) => {
  try {
    const { stockCode } = req.params;
    
    console.log(`💹 실시간 가격 조회: ${stockCode}`);
    
    const priceInfo = await kisService.getStockPrice(stockCode);
    
    res.json({
      success: true,
      data: priceInfo
    });
  } catch (error) {
    console.error('❌ 실시간 가격 조회 실패:', error);
    res.status(500).json({
      success: false,
      message: '실시간 가격을 조회할 수 없습니다.',
      error: error.message
    });
  }
};

// 전략 백테스트
const runBacktest = async (req, res) => {
  try {
    const { strategy, strategyParams, stocks, period } = req.body;
    
    console.log('📊 백테스트 실행 요청:', { strategy, stocks: stocks.length, period });
    
    const backtestResult = await tradingEngine.runBacktest({
      strategy,
      strategyParams,
      stocks,
      period
    });
    
    res.json({
      success: true,
      data: backtestResult
    });
  } catch (error) {
    console.error('❌ 백테스트 실행 실패:', error);
    res.status(500).json({
      success: false,
      message: '백테스트 실행에 실패했습니다.',
      error: error.message
    });
  }
};

module.exports = {
  getAccountInfo,
  getAIRecommendations,
  searchStock,
  getPositions,
  getTradingHistory,
  startAutoTrading,
  stopAutoTrading,
  pauseAutoTrading,
  sellPosition,
  getRealtimePrice,
  runBacktest
};