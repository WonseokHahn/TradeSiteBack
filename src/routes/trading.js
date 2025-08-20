// src/routes/trading.js
const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const tradingController = require('../controllers/tradingController');

// 모든 trading 라우트는 인증 필요
router.use(authenticateJWT);

// 계좌 정보
router.get('/account', tradingController.getAccountInfo);

// AI 종목 추천
router.get('/ai-recommendations', tradingController.getAIRecommendations);

// 종목 검색
router.get('/search-stock', tradingController.searchStock);

// 현재 포지션 조회
router.get('/positions', tradingController.getPositions);

// 거래 기록 조회
router.get('/history', tradingController.getTradingHistory);

// 자동매매 시작
router.post('/start', tradingController.startAutoTrading);

// 자동매매 중지
router.post('/stop', tradingController.stopAutoTrading);

// 자동매매 일시정지
router.post('/pause', tradingController.pauseAutoTrading);

// 포지션 매도
router.post('/sell-position', tradingController.sellPosition);

// 실시간 가격 조회
router.get('/realtime-price/:stockCode', tradingController.getRealtimePrice);

// 전략 백테스트
router.post('/backtest', tradingController.runBacktest);

module.exports = router;