const { getPool } = require('../config/database');
const { startTrading, stopTrading, getBestStrategy } = require('../services/tradingService');

const getStrategies = async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .input('userId', req.user.id)
      .query(`
        SELECT * FROM TradingStrategies 
        WHERE userId = @userId 
        ORDER BY createdAt DESC
      `);

    res.json({
      success: true,
      data: result.recordset
    });
  } catch (error) {
    console.error('전략 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '전략 조회 중 오류가 발생했습니다.'
    });
  }
};

const createStrategy = async (req, res) => {
  try {
    const { marketType, stockCode, allocation } = req.body;
    
    if (!marketType || !stockCode || !allocation) {
      return res.status(400).json({
        success: false,
        message: '필수 정보가 누락되었습니다.'
      });
    }

    const pool = getPool();
    
    // 기존 활성 전략 비활성화
    await pool.request()
      .input('userId', req.user.id)
      .query('UPDATE TradingStrategies SET isActive = 0 WHERE userId = @userId');

    // 새 전략 생성
    const result = await pool.request()
      .input('userId', req.user.id)
      .input('marketType', marketType)
      .input('stockCode', stockCode)
      .input('allocation', allocation)
      .query(`
        INSERT INTO TradingStrategies (userId, marketType, stockCode, allocation, isActive)
        OUTPUT INSERTED.*
        VALUES (@userId, @marketType, @stockCode, @allocation, 1)
      `);

    res.json({
      success: true,
      data: result.recordset[0],
      message: '전략이 생성되었습니다.'
    });
  } catch (error) {
    console.error('전략 생성 오류:', error);
    res.status(500).json({
      success: false,
      message: '전략 생성 중 오류가 발생했습니다.'
    });
  }
};

const startAutoTrading = async (req, res) => {
  try {
    const { strategyId } = req.body;
    
    const pool = getPool();
    const strategyResult = await pool.request()
      .input('strategyId', strategyId)
      .input('userId', req.user.id)
      .query(`
        SELECT * FROM TradingStrategies 
        WHERE id = @strategyId AND userId = @userId
      `);

    if (strategyResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: '전략을 찾을 수 없습니다.'
      });
    }

    const strategy = strategyResult.recordset[0];
    
    // 자동매매 시작
    await startTrading(req.user.id, strategy);

    res.json({
      success: true,
      message: '자동매매가 시작되었습니다.'
    });
  } catch (error) {
    console.error('자동매매 시작 오류:', error);
    res.status(500).json({
      success: false,
      message: '자동매매 시작 중 오류가 발생했습니다.'
    });
  }
};

const stopAutoTrading = async (req, res) => {
  try {
    await stopTrading(req.user.id);

    res.json({
      success: true,
      message: '자동매매가 중단되었습니다.'
    });
  } catch (error) {
    console.error('자동매매 중단 오류:', error);
    res.status(500).json({
      success: false,
      message: '자동매매 중단 중 오류가 발생했습니다.'
    });
  }
};

const getBestStrategies = async (req, res) => {
  try {
    const bestStrategy = await getBestStrategy();
    
    res.json({
      success: true,
      data: bestStrategy
    });
  } catch (error) {
    console.error('최적 전략 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '최적 전략 조회 중 오류가 발생했습니다.'
    });
  }
};

const getTradingStatus = async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request()
      .input('userId', req.user.id)
      .query(`
        SELECT TOP 1 * FROM TradingStrategies 
        WHERE userId = @userId AND isActive = 1
        ORDER BY createdAt DESC
      `);

    res.json({
      success: true,
      data: {
        isActive: result.recordset.length > 0,
        strategy: result.recordset[0] || null
      }
    });
  } catch (error) {
    console.error('트레이딩 상태 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '트레이딩 상태 조회 중 오류가 발생했습니다.'
    });
  }
};

module.exports = {
  getStrategies,
  createStrategy,
  startAutoTrading,
  stopAutoTrading,
  getBestStrategies,
  getTradingStatus
};