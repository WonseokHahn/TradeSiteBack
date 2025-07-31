const express = require('express');
const { 
  getStrategies, 
  createStrategy, 
  startAutoTrading, 
  stopAutoTrading, 
  getBestStrategies,
  getTradingStatus 
} = require('../controllers/tradingController');
const { authenticateJWT } = require('../middleware/auth');

const router = express.Router();

// 모든 트레이딩 관련 라우트는 로그인 필요
router.use(authenticateJWT);

// 전략 관련
router.get('/strategies', getStrategies);
router.post('/strategies', createStrategy);
router.get('/strategies/best', getBestStrategies);

// 자동매매 관련
router.post('/start', startAutoTrading);
router.post('/stop', stopAutoTrading);
router.get('/status', getTradingStatus);

module.exports = router;