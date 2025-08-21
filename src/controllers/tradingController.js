// src/controllers/tradingController.js
console.log('📈 TradingController 로딩 중...');

// 활성 자동매매 세션 저장 (메모리)
const activeTradingSessions = new Map();

class TradingController {
  
  // 계좌 정보 조회
  static async getAccountInfo(req, res) {
    try {
      console.log('📊 계좌 정보 조회 요청:', req.user.email);
      
      // 임시 모의 데이터 (실제 KIS API 대신)
      const mockAccountData = {
        domestic: {
          totalAssets: 15000000,  // 1500만원
          availableCash: 8000000, // 800만원
          stockValue: 7000000,    // 700만원
          profitLoss: 500000,     // +50만원
          profitRate: 3.45        // +3.45%
        },
        overseas: {
          totalAssets: 5000,      // $5,000
          availableCash: 2000,    // $2,000
          stockValue: 3000,       // $3,000
          profitLoss: 150,        // +$150
          profitRate: 5.26        // +5.26%
        }
      };

      res.json({
        success: true,
        data: mockAccountData
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
      
      // 임시 모의 추천 데이터
      const mockRecommendations = {
        domestic: [
          {
            symbol: "005930",
            name: "삼성전자",
            sector: "반도체",
            reason: "AI 반도체와 메모리 수요 증가로 2025년 실적 개선이 예상됩니다.",
            currentPrice: 75300,
            targetPrice: 88000,
            changeRate: 2.1,
            riskLevel: "보통",
            timeHorizon: "6개월"
          },
          {
            symbol: "035420",
            name: "NAVER",
            sector: "IT서비스",
            reason: "AI 검색 기술과 클라우드 사업 확장으로 성장 모멘텀이 지속될 전망입니다.",
            currentPrice: 185000,
            targetPrice: 220000,
            changeRate: -0.8,
            riskLevel: "보통",
            timeHorizon: "9개월"
          },
          {
            symbol: "373220",
            name: "LG에너지솔루션",
            sector: "2차전지",
            reason: "전기차 시장 확대와 ESS 수요 증가로 중장기 성장이 기대됩니다.",
            currentPrice: 420000,
            targetPrice: 500000,
            changeRate: 1.7,
            riskLevel: "높음",
            timeHorizon: "12개월"
          },
          {
            symbol: "207940",
            name: "삼성바이오로직스",
            sector: "바이오",
            reason: "글로벌 바이오의약품 위탁생산(CDO) 시장의 지속적인 성장이 예상됩니다.",
            currentPrice: 850000,
            targetPrice: 950000,
            changeRate: 0.5,
            riskLevel: "높음",
            timeHorizon: "18개월"
          },
          {
            symbol: "003670",
            name: "포스코홀딩스",
            sector: "철강",
            reason: "2차전지 소재 사업과 수소 관련 신사업 진출로 포트폴리오가 다각화되고 있습니다.",
            currentPrice: 380000,
            targetPrice: 450000,
            changeRate: -1.2,
            riskLevel: "보통",
            timeHorizon: "12개월"
          }
        ],
        overseas: [
          {
            symbol: "AAPL",
            name: "Apple Inc.",
            sector: "Technology",
            reason: "AI 기능이 탑재된 새로운 iPhone과 서비스 수익 확대가 기대됩니다.",
            currentPrice: 189.50,
            targetPrice: 220.00,
            changeRate: 1.2,
            riskLevel: "낮음",
            timeHorizon: "12개월"
          },
          {
            symbol: "MSFT",
            name: "Microsoft Corporation",
            sector: "Technology",
            reason: "OpenAI와의 협력으로 AI 시장을 선도하며, 클라우드 사업도 지속 성장 중입니다.",
            currentPrice: 425.80,
            targetPrice: 480.00,
            changeRate: 0.8,
            riskLevel: "낮음",
            timeHorizon: "18개월"
          },
          {
            symbol: "NVDA",
            name: "NVIDIA Corporation",
            sector: "Semiconductors",
            reason: "AI 반도체 시장의 독점적 지위와 데이터센터 수요 폭증이 계속되고 있습니다.",
            currentPrice: 118.75,
            targetPrice: 150.00,
            changeRate: 2.5,
            riskLevel: "높음",
            timeHorizon: "6개월"
          },
          {
            symbol: "GOOGL",
            name: "Alphabet Inc.",
            sector: "Technology",
            reason: "AI 검색 기술 발전과 클라우드 서비스 강화로 수익성이 개선되고 있습니다.",
            currentPrice: 162.30,
            targetPrice: 185.00,
            changeRate: -0.5,
            riskLevel: "보통",
            timeHorizon: "12개월"
          },
          {
            symbol: "TSLA",
            name: "Tesla, Inc.",
            sector: "Automotive",
            reason: "전기차 시장 확대와 자율주행 기술 발전으로 장기 성장 동력이 확보되었습니다.",
            currentPrice: 248.50,
            targetPrice: 320.00,
            changeRate: 1.8,
            riskLevel: "높음",
            timeHorizon: "24개월"
          }
        ]
      };

      const selectedRecommendations = mockRecommendations[marketType] || mockRecommendations.domestic;

      res.json({
        success: true,
        data: {
          recommendations: selectedRecommendations,
          marketAnalysis: marketType === 'domestic' 
            ? "한국 시장은 AI와 2차전지 관련주를 중심으로 상승 모멘텀이 지속되고 있습니다." 
            : "미국 시장은 AI 기술주의 강세가 이어지며, 연준의 금리 정책 변화에 대한 기대감이 시장을 지지하고 있습니다.",
          investmentStrategy: investmentStyle === 'aggressive' 
            ? "높은 수익률을 위해 성장주 중심의 공격적 투자를 권장합니다."
            : investmentStyle === 'conservative'
            ? "안정적인 배당주와 대형주 중심의 보수적 포트폴리오를 구성하세요."
            : "성장성과 안정성을 균형있게 고려한 분산 투자를 추천합니다.",
          riskLevel: investmentStyle === 'aggressive' ? "높음" : investmentStyle === 'conservative' ? "낮음" : "보통",
          lastUpdated: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('❌ AI 추천 조회 실패:', error);
      res.status(500).json({
        success: false,
        message: 'AI 종목 추천을 가져오는데 실패했습니다.',
        error: error.message
      });
    }
  }

  // 자동매매 상태 조회 (데이터베이스 없이)
  static async getTradingStatus(req, res) {
    try {
      const userId = req.user.id;
      console.log(`📊 자동매매 상태 조회: 사용자 ${userId}`);

      // 메모리에서 활성 세션 조회
      const activeSessions = Array.from(activeTradingSessions.values())
        .filter(session => session.userId === userId)
        .map(session => ({
          sessionId: session.sessionId,
          strategy: session.strategy,
          marketType: session.marketType,
          investmentAmount: session.investmentAmount,
          status: session.status,
          startTime: session.startTime,
          stockCount: session.stocks?.length || 0,
          orderCount: session.orders?.length || 0,
          totalProfit: session.totalProfit || 0
        }));

      // 임시 세션 히스토리 (실제로는 데이터베이스에서)
      const sessionHistory = [
        {
          session_id: 'demo_session_1',
          market_type: 'domestic',
          strategy_type: 'comprehensive',
          investment_amount: 1000000,
          status: 'STOPPED',
          started_at: new Date(Date.now() - 86400000).toISOString(), // 1일 전
          ended_at: new Date(Date.now() - 43200000).toISOString(),   // 12시간 전
          final_profit: 45000,
          total_orders: 8
        }
      ];

      res.json({
        success: true,
        data: {
          activeSessions,
          sessionHistory,
          totalActiveSessions: activeSessions.length
        }
      });

    } catch (error) {
      console.error('❌ 자동매매 상태 조회 실패:', error);
      res.status(500).json({
        success: false,
        message: '자동매매 상태 조회에 실패했습니다.',
        error: error.message
      });
    }
  }

  // 거래 내역 조회 (데이터베이스 없이)
  static async getTradingHistory(req, res) {
    try {
      const userId = req.user.id;
      console.log(`📜 거래 내역 조회: 사용자 ${userId}`);

      // 임시 거래 내역 데이터
      const trades = [
        {
          id: 1,
          stock_code: '005930',
          trade_type: 'BUY',
          quantity: 10,
          price: 75000,
          profit_loss: null,
          executed_at: new Date(Date.now() - 7200000).toISOString() // 2시간 전
        },
        {
          id: 2,
          stock_code: '005930',
          trade_type: 'SELL',
          quantity: 10,
          price: 76500,
          profit_loss: 15000,
          executed_at: new Date(Date.now() - 3600000).toISOString() // 1시간 전
        }
      ];

      res.json({
        success: true,
        data: {
          trades,
          pagination: {
            limit: 50,
            offset: 0,
            total: trades.length
          }
        }
      });

    } catch (error) {
      console.error('❌ 거래 내역 조회 실패:', error);
      res.status(500).json({
        success: false,
        message: '거래 내역 조회에 실패했습니다.',
        error: error.message
      });
    }
  }

  // 전략 분석 실행
  static async analyzeStrategy(req, res) {
    res.json({
      success: true,
      message: "전략 분석 기능은 개발 중입니다.",
      data: {
        signal: "HOLD",
        confidence: 0.6,
        reason: "시장 분석 중입니다."
      }
    });
  }

  // 자동매매 시작
  static async startAutoTrading(req, res) {
    try {
      const { stocks, strategy, marketType, investmentAmount, riskLevel } = req.body;
      const userId = req.user.id;
      const sessionId = `${userId}_${Date.now()}`;

      console.log(`🚀 자동매매 시작: ${sessionId}`);

      // 메모리에 세션 저장
      const tradingSession = {
        sessionId,
        userId,
        stocks,
        strategy,
        marketType,
        investmentAmount,
        riskLevel,
        status: 'ACTIVE',
        startTime: new Date(),
        orders: [],
        totalProfit: 0
      };

      activeTradingSessions.set(sessionId, tradingSession);

      res.json({
        success: true,
        data: {
          sessionId,
          message: '자동매매가 시작되었습니다.',
          session: {
            sessionId,
            stocks: stocks?.length || 0,
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

      console.log(`⏹️ 자동매매 중지: ${sessionId}`);

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

      res.json({
        success: true,
        data: {
          message: '자동매매가 중지되었습니다.',
          sessionSummary: {
            sessionId,
            duration: session.endTime - session.startTime,
            totalOrders: session.orders?.length || 0,
            totalProfit: session.totalProfit || 0,
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

  // 실시간 주가 조회
  static async getStockPrice(req, res) {
    const { stockCode } = req.query;
    
    res.json({
      success: true,
      data: {
        stockCode,
        currentPrice: 75000 + Math.floor(Math.random() * 10000),
        changeAmount: Math.floor(Math.random() * 2000) - 1000,
        changeRate: (Math.random() * 4 - 2).toFixed(2),
        timestamp: new Date().toISOString()
      }
    });
  }
}

console.log('✅ TradingController 로딩 완료');
module.exports = TradingController;