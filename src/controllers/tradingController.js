const { query } = require('../config/database');
const { startTrading, stopTrading, getBestStrategy } = require('../services/tradingService');

const getStrategies = async (req, res) => {
  try {
    console.log('📊 전략 목록 조회 요청:', req.user.id);
    
    const result = await query(
      `SELECT * FROM trading_strategies 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    // stocks 필드가 JSON 문자열인 경우 파싱
    const strategies = result.rows.map(strategy => {
      if (typeof strategy.stocks === 'string') {
        try {
          strategy.stocks = JSON.parse(strategy.stocks);
        } catch (e) {
          strategy.stocks = [];
        }
      }
      return strategy;
    });

    res.json({
      success: true,
      data: strategies,
      total: strategies.length
    });
  } catch (error) {
    console.error('❌ 전략 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '전략 조회 중 오류가 발생했습니다.'
    });
  }
};

const createStrategy = async (req, res) => {
  try {
    const { marketType, region, stocks } = req.body;
    console.log('✍️ 새 전략 생성 요청:', { marketType, region, stocks: stocks?.length });
    
    if (!marketType || !region || !stocks || stocks.length === 0) {
      return res.status(400).json({
        success: false,
        message: '필수 정보가 누락되었습니다.'
      });
    }

    // 총 투자 비율 검증
    const totalAllocation = stocks.reduce((sum, stock) => sum + (parseInt(stock.allocation) || 0), 0);
    if (totalAllocation !== 100) {
      return res.status(400).json({
        success: false,
        message: '총 투자 비율이 100%가 되어야 합니다.'
      });
    }

    // 기존 활성 전략 비활성화
    await query(
      'UPDATE trading_strategies SET is_active = false WHERE user_id = $1',
      [req.user.id]
    );

    // 새 전략 생성
    const strategyName = getStrategyName(marketType, region);
    const expectedReturn = calculateExpectedReturn(marketType, region, stocks);
    const riskLevel = calculateRiskLevel(marketType, stocks);

    const result = await query(
      `INSERT INTO trading_strategies 
       (user_id, strategy_name, market_type, region, stocks, is_active, expected_return, risk_level, description)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8)
       RETURNING *`,
      [
        req.user.id,
        strategyName,
        marketType,
        region,
        JSON.stringify(stocks),
        expectedReturn,
        riskLevel,
        getStrategyDescription(marketType, region)
      ]
    );

    const newStrategy = result.rows[0];
    // stocks JSON 파싱
    if (typeof newStrategy.stocks === 'string') {
      newStrategy.stocks = JSON.parse(newStrategy.stocks);
    }

    console.log('✅ 새 전략 생성 완료:', newStrategy.strategy_name);

    res.status(201).json({
      success: true,
      data: newStrategy,
      message: '전략이 성공적으로 생성되었습니다.'
    });
  } catch (error) {
    console.error('❌ 전략 생성 오류:', error);
    res.status(500).json({
      success: false,
      message: '전략 생성 중 오류가 발생했습니다.'
    });
  }
};

const startAutoTrading = async (req, res) => {
  try {
    const { strategyId } = req.body;
    console.log('🚀 자동매매 시작 요청:', { strategyId, userId: req.user.id });
    
    if (!strategyId) {
      return res.status(400).json({
        success: false,
        message: '전략 ID가 필요합니다.'
      });
    }

    const strategyResult = await query(
      `SELECT * FROM trading_strategies 
       WHERE id = $1 AND user_id = $2`,
      [strategyId, req.user.id]
    );

    if (strategyResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: '전략을 찾을 수 없습니다.'
      });
    }

    const strategy = strategyResult.rows[0];
    
    // stocks JSON 파싱
    if (typeof strategy.stocks === 'string') {
      strategy.stocks = JSON.parse(strategy.stocks);
    }

    // 전략 활성화
    await query(
      `UPDATE trading_strategies 
       SET is_active = true, start_date = CURRENT_TIMESTAMP 
       WHERE id = $1`,
      [strategyId]
    );
    
    // 자동매매 시작
    await startTrading(req.user.id, strategy);

    console.log('✅ 자동매매 시작 완료');

    res.json({
      success: true,
      message: '자동매매가 시작되었습니다.'
    });
  } catch (error) {
    console.error('❌ 자동매매 시작 오류:', error);
    res.status(500).json({
      success: false,
      message: '자동매매 시작 중 오류가 발생했습니다.'
    });
  }
};

const stopAutoTrading = async (req, res) => {
  try {
    console.log('⏹️ 자동매매 중단 요청:', req.user.id);
    
    await stopTrading(req.user.id);

    // 모든 활성 전략 비활성화
    await query(
      `UPDATE trading_strategies 
       SET is_active = false, end_date = CURRENT_TIMESTAMP 
       WHERE user_id = $1 AND is_active = true`,
      [req.user.id]
    );

    console.log('✅ 자동매매 중단 완료');

    res.json({
      success: true,
      message: '자동매매가 중단되었습니다.'
    });
  } catch (error) {
    console.error('❌ 자동매매 중단 오류:', error);
    res.status(500).json({
      success: false,
      message: '자동매매 중단 중 오류가 발생했습니다.'
    });
  }
};

const getBestStrategies = async (req, res) => {
  try {
    console.log('🎯 최적 전략 조회 요청');
    
    const bestStrategy = await getBestStrategy();
    
    res.json({
      success: true,
      data: bestStrategy
    });
  } catch (error) {
    console.error('❌ 최적 전략 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '최적 전략 조회 중 오류가 발생했습니다.'
    });
  }
};

const getTradingStatus = async (req, res) => {
  try {
    console.log('📊 트레이딩 상태 조회:', req.user.id);
    
    const result = await query(
      `SELECT * FROM trading_strategies 
       WHERE user_id = $1 AND is_active = true
       ORDER BY created_at DESC
       LIMIT 1`,
      [req.user.id]
    );

    const strategy = result.rows[0] || null;
    if (strategy && typeof strategy.stocks === 'string') {
      strategy.stocks = JSON.parse(strategy.stocks);
    }

    res.json({
      success: true,
      data: {
        isActive: !!strategy,
        strategy: strategy
      }
    });
  } catch (error) {
    console.error('❌ 트레이딩 상태 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '트레이딩 상태 조회 중 오류가 발생했습니다.'
    });
  }
};

const getTradingHistory = async (req, res) => {
  try {
    console.log('📈 매매 이력 조회:', req.user.id);
    
    const result = await query(
      `SELECT to.*, ts.strategy_name, sm.stock_name
       FROM trading_orders to
       LEFT JOIN trading_strategies ts ON to.strategy_id = ts.id
       LEFT JOIN stock_master sm ON to.stock_code = sm.stock_code
       WHERE to.user_id = $1
       ORDER BY to.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: result.rows,
      total: result.rows.length
    });
  } catch (error) {
    console.error('❌ 매매 이력 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '매매 이력 조회 중 오류가 발생했습니다.'
    });
  }
};

// 헬퍼 함수들
const getStrategyName = (marketType, region) => {
  const marketNames = {
    bull: '상승장',
    bear: '하락장'
  };
  const regionNames = {
    domestic: '국내',
    global: '해외'
  };
  
  return `${marketNames[marketType]} ${regionNames[region]} 전략`;
};

const getStrategyDescription = (marketType, region) => {
  if (marketType === 'bull') {
    return region === 'domestic' 
      ? '국내 성장주와 모멘텀 종목 중심의 상승장 전략'
      : '해외 기술주와 성장주 중심의 상승장 전략';
  } else {
    return region === 'domestic'
      ? '국내 가치주와 배당주 중심의 하락장 방어 전략'
      : '해외 안전자산과 배당주 중심의 하락장 방어 전략';
  }
};

const calculateExpectedReturn = (marketType, region, stocks) => {
  // 간단한 예상 수익률 계산 로직
  let baseReturn = marketType === 'bull' ? 15 : 8;
  if (region === 'global') baseReturn += 3;
  if (stocks.length > 3) baseReturn += 2; // 분산투자 보너스
  
  return Math.round(baseReturn * 100) / 100;
};

const calculateRiskLevel = (marketType, stocks) => {
  if (stocks.length >= 5) return 'Low';
  if (marketType === 'bear') return 'Medium';
  return 'High';
};

module.exports = {
  getStrategies,
  createStrategy,
  startAutoTrading,
  stopAutoTrading,
  getBestStrategies,
  getTradingStatus,
  getTradingHistory
};