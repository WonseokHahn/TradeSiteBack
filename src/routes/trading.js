// src/routes/trading.js
const express = require('express');
const TradingController = require('../controllers/tradingController');
const { authenticateJWT } = require('../middleware/auth');

const router = express.Router();

// 모든 자동매매 API는 로그인 필요
router.use(authenticateJWT);

// 계좌 정보 조회
router.get('/account', TradingController.getAccountInfo);

// AI 종목 추천 조회
router.get('/recommendations', TradingController.getRecommendations);

// 전략 분석 실행
router.post('/analyze', TradingController.analyzeStrategy);

// 실시간 주가 조회
router.get('/price', TradingController.getStockPrice);

// 자동매매 시작
router.post('/start', TradingController.startAutoTrading);

// 자동매매 중지
router.post('/stop/:sessionId', TradingController.stopAutoTrading);

// 자동매매 상태 조회
router.get('/status', TradingController.getTradingStatus);

// 거래 내역 조회
router.get('/history', TradingController.getTradingHistory);

module.exports = router;