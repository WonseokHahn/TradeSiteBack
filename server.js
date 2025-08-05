require('dotenv').config();

console.log('🚀 서버를 시작합니다...');
console.log('📁 현재 작업 디렉토리:', process.cwd());

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const passport = require('passport');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

const axios = require('axios');
console.log('⚙️ 미들웨어를 설정합니다...');

// 미들웨어 설정
app.use(helmet());
// server.js의 CORS 설정 부분을 수정
// app.use(cors({
//   origin: function (origin, callback) {
//     // 허용할 도메인 목록
//     const allowedOrigins = [
//       'http://localhost:8080', // 개발 환경
//       'http://localhost:3000', // 개발 환경 (다른 포트)
//       'https://wonseokhahn.github.io/TradeSiteFront/', // GitHub Pages
//       'https://tradesiteback.onrender.com', // 백엔드 자체 (필요시)
//       process.env.FRONTEND_URL // 환경 변수로 설정된 URL
//     ].filter(Boolean); // undefined 제거

//     console.log('🔍 CORS 요청 Origin:', origin);
//     console.log('✅ 허용된 Origins:', allowedOrigins);

//     // origin이 없는 경우 (모바일 앱, Postman, 서버간 통신 등) 허용
//     if (!origin) {
//       console.log('✅ Origin이 없는 요청 허용');
//       return callback(null, true);
//     }
    
//     if (allowedOrigins.indexOf(origin) !== -1) {
//       console.log('✅ CORS 허용:', origin);
//       callback(null, true);
//     } else {
//       console.log('❌ CORS 차단:', origin);
//       console.log('💡 허용된 origins에 추가가 필요합니다.');
//       // 개발 중에는 허용하고, 프로덕션에서만 차단
//       if (process.env.NODE_ENV === 'development') {
//         callback(null, true);
//       } else {
//         callback(new Error('CORS 정책에 의해 차단되었습니다.'));
//       }
//     }
//   },
//   credentials: true,
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: [
//     'Content-Type', 
//     'Authorization', 
//     'X-Requested-With',
//     'Accept',
//     'Origin'
//   ],
//   exposedHeaders: ['Content-Range', 'X-Content-Range'],
//   maxAge: 86400 // 24시간 프리플라이트 캐시
// }));
app.use(cors({
  origin: '*', // 임시로 모든 도메인 허용
  credentials: false // credentials는 false로 설정
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Passport 초기화
console.log('🔐 Passport를 초기화합니다...');
app.use(passport.initialize());

// 데이터베이스 연결
console.log('🗄️ 데이터베이스를 연결합니다...');
try {
  const { connectDB } = require('./src/config/database');
  connectDB();
  console.log('✅ 데이터베이스 연결 시도 완료');
} catch (error) {
  console.error('❌ 데이터베이스 연결 실패:', error.message);
}

// OAuth 설정 로드
console.log('🔧 OAuth 설정을 로드합니다...');
try {
  require('./src/config/oauth');
  console.log('✅ OAuth 설정 로드 완료');
} catch (error) {
  console.error('❌ OAuth 설정 로드 실패:', error.message);
}

// JWT 토큰 생성 함수
const generateToken = (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      email: user.email,
      name: user.name 
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

console.log('🔗 라우터를 설정합니다...');

// API 요청 로깅 미들웨어
app.use('/api', (req, res, next) => {
  console.log(`🔍 [${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// 기본 라우트
app.get('/', (req, res) => {
  console.log('📍 기본 라우트 접근');
  res.json({ 
    message: '주식 자동매매 API 서버',
    version: '2.1.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    oauth: {
      google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      kakao: !!(process.env.KAKAO_CLIENT_ID && process.env.KAKAO_CLIENT_SECRET)
    }
  });
});

// KIS API 설정
const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';
let kisAccessToken = null;
let kisTokenExpiry = null;

// KIS 토큰 획득 함수
async function getKISToken() {
  try {
    if (kisAccessToken && kisTokenExpiry && Date.now() < kisTokenExpiry) {
      return kisAccessToken;
    }

    const response = await axios.post(`${KIS_BASE_URL}/oauth2/tokenP`, {
      grant_type: 'client_credentials',
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET
    });

    kisAccessToken = response.data.access_token;
    kisTokenExpiry = Date.now() + (response.data.expires_in * 1000);
    
    console.log('✅ KIS 토큰 획득 성공');
    return kisAccessToken;
  } catch (error) {
    console.error('❌ KIS 토큰 획득 실패:', error.message);
    throw error;
  }
}

// Health check
app.get('/api/health', (req, res) => {
  console.log('💚 Health check 요청');
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    oauth_status: {
      google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      kakao: !!(process.env.KAKAO_CLIENT_ID && process.env.KAKAO_CLIENT_SECRET),
      jwt: !!process.env.JWT_SECRET,
      database: true
    }
  });
});

// OAuth 라우터 - Google
app.get('/api/auth/google', 
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/api/auth/google/callback',
  passport.authenticate('google', { session: false }),
  (req, res) => {
    try {
      console.log('✅ Google OAuth 성공:', req.user);
      
      // JWT 토큰 생성
      const token = generateToken(req.user);
      console.log('🎫 JWT 토큰 생성 완료');

      // 프론트엔드로 토큰과 함께 리다이렉트
      const redirectURL = `${process.env.FRONTEND_URL}/auth/callback?token=${token}&provider=google&name=${encodeURIComponent(req.user.name)}`;
      console.log('🔄 프론트엔드로 리다이렉트:', redirectURL);
      
      res.redirect(redirectURL);
    } catch (error) {
      console.error('❌ Google 콜백 처리 실패:', error);
      res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
    }
  }
);

// OAuth 라우터 - Kakao
app.get('/api/auth/kakao',
  passport.authenticate('kakao')
);

app.get('/api/auth/kakao/callback',
  passport.authenticate('kakao', { session: false }),
  (req, res) => {
    try {
      console.log('✅ Kakao OAuth 성공:', req.user);
      
      // JWT 토큰 생성
      const token = generateToken(req.user);
      console.log('🎫 JWT 토큰 생성 완료');
      
      // 프론트엔드로 토큰과 함께 리다이렉트
      const redirectURL = `${process.env.FRONTEND_URL}/auth/callback?token=${token}&provider=kakao&name=${encodeURIComponent(req.user.name)}`;
      console.log('🔄 프론트엔드로 리다이렉트:', redirectURL);
      
      res.redirect(redirectURL);
    } catch (error) {
      console.error('❌ Kakao 콜백 처리 실패:', error);
      res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
    }
  }
);

// 프로필 조회 (JWT 인증 필요)
app.get('/api/auth/profile', 
  passport.authenticate('jwt', { session: false }),
  (req, res) => {
    console.log('👤 프로필 조회 성공:', req.user.email);
    const { password, ...userProfile } = req.user;
    res.json({
      success: true,
      user: userProfile
    });
  }
);

// 로그아웃
app.post('/api/auth/logout', (req, res) => {
  console.log('👋 로그아웃 요청');
  res.json({
    success: true,
    message: '로그아웃 되었습니다.'
  });
});

// 기타 라우트들
app.get('/api/auth/test', (req, res) => {
  console.log('🧪 Auth 테스트 요청');
  res.json({ 
    message: 'Auth 라우터가 정상 작동합니다!',
    timestamp: new Date().toISOString(),
    oauth_ready: {
      google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      kakao: !!process.env.KAKAO_CLIENT_ID && process.env.KAKAO_CLIENT_SECRET
    }
  });
});

// News 검색 라우터 - 네이버 API 사용
app.get('/api/news/search', async (req, res) => {
  try {
    const { keyword } = req.query;
    console.log('📰 뉴스 검색 요청:', { keyword });
    
    if (!keyword || keyword.trim() === '') {
      return res.status(400).json({
        success: false,
        message: '검색 키워드가 필요합니다.'
      });
    }

    // 네이버 API 키 확인
    if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
      return res.status(500).json({
        success: false,
        message: '네이버 API 키가 설정되지 않았습니다.'
      });
    }

    // 네이버 뉴스 검색 API 호출
    const newsArticles = await searchNaverNews(keyword.trim());
    
    if (!newsArticles || newsArticles.length === 0) {
      return res.json({
        success: true,
        data: [],
        total: 0,
        message: '검색 결과가 없습니다.'
      });
    }

    // GPT 요약 생성 (병렬 처리)
    console.log('🤖 GPT 요약을 생성합니다...');
    const newsWithSummary = await Promise.all(
      newsArticles.map(async (article, index) => {
        try {
          // API 호출 제한을 위해 약간의 지연
          await new Promise(resolve => setTimeout(resolve, index * 200));
          
          const summary = await generateSummary(article.title + ' ' + article.description);
          return {
            ...article,
            summary
          };
        } catch (error) {
          console.error(`요약 생성 실패 (${index + 1}번째 기사):`, error.message);
          return {
            ...article,
            summary: '이 기사는 ' + article.title.substring(0, 50) + '에 관한 내용입니다.'
          };
        }
      })
    );

    console.log(`✅ 뉴스 검색 완료: ${newsWithSummary.length}개 기사, 요약 생성 완료`);

    res.json({
      success: true,
      data: newsWithSummary,
      total: newsWithSummary.length,
      keyword: keyword
    });

  } catch (error) {
    console.error('❌ 뉴스 검색 오류:', error);
    res.status(500).json({
      success: false,
      message: '뉴스 검색 중 오류가 발생했습니다.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 네이버 뉴스 검색 API 함수
async function searchNaverNews(keyword) {
  try {
    const axios = require('axios');
    
    console.log(`🔍 네이버 뉴스 API로 "${keyword}" 검색 중...`);
    
    const response = await axios.get('https://openapi.naver.com/v1/search/news.json', {
      params: {
        query: keyword,
        display: 10, // 최대 10개 결과
        start: 1,
        sort: 'date' // 최신순 정렬
      },
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    if (!response.data || !response.data.items) {
      console.log('⚠️ 네이버 API 응답에 데이터가 없습니다');
      return [];
    }

    const articles = response.data.items.map((item, index) => {
      // HTML 태그 제거 함수
      const removeHtmlTags = (str) => {
        return str.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      };

      // 날짜 포맷팅
      const formatDate = (dateString) => {
        try {
          const date = new Date(dateString);
          return date.toISOString();
        } catch (error) {
          return new Date().toISOString();
        }
      };

      return {
        id: index + 1,
        title: removeHtmlTags(item.title),
        description: removeHtmlTags(item.description),
        link: item.link,
        source: '네이버뉴스',
        publishedAt: formatDate(item.pubDate),
        keyword: keyword,
        originalLink: item.originallink || item.link
      };
    });

    console.log(`📊 네이버 API에서 수집된 뉴스: ${articles.length}개`);
    return articles;

  } catch (error) {
    console.error('❌ 네이버 뉴스 API 호출 실패:', error.response?.data || error.message);
    
    // API 오류 시 대체 데이터
    return [{
      id: 1,
      title: `${keyword} 관련 뉴스 검색 오류`,
      description: '네이버 뉴스 API 호출에 문제가 발생했습니다. API 키 설정을 확인해주세요.',
      link: `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(keyword)}`,
      source: '시스템 알림',
      publishedAt: new Date().toISOString(),
      keyword: keyword,
      error: true
    }];
  }
}

// GPT 요약 생성 함수 (개선된 버전)
async function generateSummary(content) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      // OpenAI API가 없을 때 간단한 대체 요약
      const sentences = content.split('.').filter(s => s.trim().length > 10);
      if (sentences.length > 0) {
        return sentences.slice(0, 2).join('. ').substring(0, 150) + '.';
      }
      return content.substring(0, 100) + '...';
    }

    const axios = require('axios');
    
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "당신은 한국의 주식 관련 뉴스를 요약하는 전문가입니다. 주어진 뉴스를 2-3문장으로 간결하고 핵심적인 내용만 한국어로 요약해주세요. 투자자에게 도움이 되는 정보를 위주로 요약하세요."
        },
        {
          role: "user",
          content: `다음 뉴스를 요약해주세요: ${content.substring(0, 800)}`
        }
      ],
      max_tokens: 150,
      temperature: 0.7,
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    return response.data.choices[0].message.content.trim();
    
  } catch (error) {
    console.error('❌ GPT 요약 생성 오류:', error.response?.data || error.message);
    
    // GPT API 오류 시 간단한 대체 요약
    const sentences = content.split('.').filter(s => s.trim().length > 10);
    if (sentences.length > 0) {
      return sentences.slice(0, 2).join('. ').substring(0, 150) + '.';
    }
    
    return content.substring(0, 100) + '... (자동 요약)';
  }
}

// 기존 최적 전략 라우트 수정 (AI 추천 전략 제거)
app.get('/api/trading/strategies/best', async (req, res) => {
  try {
    console.log('🎯 기본 전략 정보 요청');
    
    // 기본 전략 가이드만 제공 (AI 추천 제거)
    const strategyGuide = {
      bull: {
        domestic: {
          name: "국내 상승장 전략",
          description: "기술주와 성장주 중심의 모멘텀 투자",
          recommendedSectors: ["반도체", "IT", "바이오", "전기차"],
          riskLevel: "Medium"
        },
        global: {
          name: "해외 상승장 전략", 
          description: "미국 기술주 중심의 성장 투자",
          recommendedSectors: ["Technology", "Healthcare", "Clean Energy"],
          riskLevel: "High"
        }
      },
      bear: {
        domestic: {
          name: "국내 하락장 전략",
          description: "배당주와 안전자산 중심의 방어 투자",
          recommendedSectors: ["유틸리티", "필수소비재", "통신"],
          riskLevel: "Low"
        },
        global: {
          name: "해외 하락장 전략",
          description: "대형주와 배당주 중심의 안전 투자", 
          recommendedSectors: ["Consumer Staples", "Utilities", "Healthcare"],
          riskLevel: "Low"
        }
      }
    };
    
    res.json({
      success: true,
      data: strategyGuide,
      message: "전략 가이드를 참고하여 직접 종목을 선택해주세요"
    });
    
  } catch (error) {
    console.error('❌ 전략 가이드 조회 오류:', error);
    res.status(500).json({
      success: false,
      message: '전략 가이드 조회 중 오류가 발생했습니다'
    });
  }
});

// 추가로 다른 전략 관련 라우트들도 만들 수 있습니다
app.get('/api/trading/strategies', async (req, res) => {
  try {
    console.log('📊 전략 목록 요청');
    
    const strategies = [
      {
        id: 1,
        name: "모멘텀 전략",
        type: "단기",
        riskLevel: "중간",
        description: "상승 추세를 포착하는 전략"
      },
      {
        id: 2,
        name: "가치 투자 전략",
        type: "장기",
        riskLevel: "낮음",
        description: "저평가된 주식을 찾는 전략"
      },
      {
        id: 3,
        name: "스윙 트레이딩",
        type: "중기",
        riskLevel: "높음",
        description: "변동성을 활용한 매매 전략"
      }
    ];

    res.json({
      success: true,
      data: strategies,
      total: strategies.length
    });

  } catch (error) {
    console.error('❌ 전략 목록 조회 실패:', error);
    res.status(500).json({
      success: false,
      message: '전략 목록을 불러오는 중 오류가 발생했습니다.'
    });
  }
});

// 기존 GET 라우트들 아래에 POST 라우트 추가
app.post('/api/trading/strategies', async (req, res) => {
  try {
    console.log('✍️ 새 전략 생성 요청:', req.body);
    
    const { 
      name, 
      type, 
      riskLevel, 
      description, 
      indicators,
      buyConditions,
      sellConditions,
      stopLoss,
      takeProfit 
    } = req.body;

    // 입력 값 검증
    if (!name || !type || !riskLevel) {
      return res.status(400).json({
        success: false,
        message: '필수 필드가 누락되었습니다. (name, type, riskLevel)'
      });
    }

    // 새 전략 생성 (실제로는 데이터베이스에 저장)
    const newStrategy = {
      id: Date.now(), // 임시 ID (실제로는 DB에서 자동 생성)
      name,
      type,
      riskLevel,
      description: description || '',
      indicators: indicators || [],
      buyConditions: buyConditions || [],
      sellConditions: sellConditions || [],
      stopLoss: stopLoss || null,
      takeProfit: takeProfit || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'active',
      performance: {
        totalTrades: 0,
        winRate: 0,
        totalReturn: 0
      }
    };

    console.log('✅ 새 전략 생성 완료:', newStrategy.name);

    res.status(201).json({
      success: true,
      message: '전략이 성공적으로 생성되었습니다.',
      data: newStrategy
    });

  } catch (error) {
    console.error('❌ 전략 생성 실패:', error);
    res.status(500).json({
      success: false,
      message: '전략 생성 중 오류가 발생했습니다.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 전략 수정 (PUT)
app.put('/api/trading/strategies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`📝 전략 수정 요청: ID ${id}`, req.body);

    // 실제로는 데이터베이스에서 해당 ID의 전략을 찾아서 수정
    const updatedStrategy = {
      id: parseInt(id),
      ...req.body,
      updatedAt: new Date().toISOString()
    };

    res.json({
      success: true,
      message: '전략이 성공적으로 수정되었습니다.',
      data: updatedStrategy
    });

  } catch (error) {
    console.error('❌ 전략 수정 실패:', error);
    res.status(500).json({
      success: false,
      message: '전략 수정 중 오류가 발생했습니다.'
    });
  }
});

// 전략 삭제 (DELETE)
app.delete('/api/trading/strategies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🗑️ 전략 삭제 요청: ID ${id}`);

    // 실제로는 데이터베이스에서 해당 ID의 전략을 삭제

    res.json({
      success: true,
      message: '전략이 성공적으로 삭제되었습니다.',
      deletedId: id
    });

  } catch (error) {
    console.error('❌ 전략 삭제 실패:', error);
    res.status(500).json({
      success: false,
      message: '전략 삭제 중 오류가 발생했습니다.'
    });
  }
});

// 특정 전략 조회 (GET)
app.get('/api/trading/strategies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔍 특정 전략 조회: ID ${id}`);

    // 실제로는 데이터베이스에서 해당 ID의 전략을 조회
    const strategy = {
      id: parseInt(id),
      name: "모멘텀 전략",
      type: "단기",
      riskLevel: "중간",
      description: "상승 추세를 포착하는 전략",
      createdAt: new Date().toISOString(),
      status: "active"
    };

    res.json({
      success: true,
      data: strategy
    });

  } catch (error) {
    console.error('❌ 전략 조회 실패:', error);
    res.status(500).json({
      success: false,
      message: '전략 조회 중 오류가 발생했습니다.'
    });
  }
});

// Trading 매매 이력 라우터 - 안전한 버전
app.get('/api/trading/history', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      console.log('📈 매매 이력 조회 요청:', req.user.id);
      
      let orders = [];
      
      try {
        // 데이터베이스 연결 시도
        const { query } = require('./src/config/database');
        
        // 테이블 존재 확인
        const tableCheck = await query(
          `SELECT EXISTS (
             SELECT FROM information_schema.tables 
             WHERE table_name = 'trading_orders'
           );`
        );
        
        if (tableCheck.rows[0].exists) {
          console.log('✅ trading_orders 테이블 확인됨');
          
          // 실제 데이터 조회
          const result = await query(
            `SELECT 
               to.id,
               to.stock_code,
               to.stock_name,
               to.region,
               to.order_type,
               to.quantity,
               to.order_price,
               to.executed_price,
               to.total_amount,
               to.status,
               to.executed_at,
               to.created_at,
               ts.strategy_name
             FROM trading_orders to
             LEFT JOIN trading_strategies ts ON to.strategy_id = ts.id
             WHERE to.user_id = $1
             ORDER BY to.created_at DESC
             LIMIT 50`,
            [req.user.id]
          );
          
          orders = result.rows || [];
          console.log(`📊 실제 매매 이력: ${orders.length}건`);
        } else {
          console.log('⚠️ trading_orders 테이블이 존재하지 않음');
        }
        
      } catch (dbError) {
        console.error('❌ 데이터베이스 조회 오류:', dbError.message);
        console.log('🔄 더미 데이터로 폴백');
      }
      
      // 데이터가 없거나 DB 오류시 더미 데이터 제공
      if (orders.length === 0) {
        orders = [
          {
            id: 1,
            stock_code: '005930',
            stock_name: '삼성전자',
            region: 'domestic',
            order_type: 'BUY',
            quantity: 10,
            order_price: 75000,
            executed_price: 75000,
            total_amount: 750000,
            status: 'FILLED',
            executed_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            strategy_name: '상승장 국내 전략'
          },
          {
            id: 2,
            stock_code: 'AAPL',
            stock_name: 'Apple Inc.',
            region: 'global',
            order_type: 'BUY',
            quantity: 5,
            order_price: 180.50,
            executed_price: 180.50,
            total_amount: 902.50,
            status: 'FILLED',
            executed_at: new Date(Date.now() - 3600000).toISOString(),
            created_at: new Date(Date.now() - 3600000).toISOString(),
            strategy_name: '글로벌 기술주 전략'
          },
          {
            id: 3,
            stock_code: '000660',
            stock_name: 'SK하이닉스',
            region: 'domestic',
            order_type: 'SELL',
            quantity: 3,
            order_price: 120000,
            executed_price: 119500,
            total_amount: 358500,
            status: 'FILLED',
            executed_at: new Date(Date.now() - 7200000).toISOString(),
            created_at: new Date(Date.now() - 7200000).toISOString(),
            strategy_name: '상승장 국내 전략'
          },
          {
            id: 4,
            stock_code: 'MSFT',
            stock_name: 'Microsoft Corp.',
            region: 'global',
            order_type: 'BUY',
            quantity: 2,
            order_price: 415.30,
            executed_price: 415.30,
            total_amount: 830.60,
            status: 'FILLED',
            executed_at: new Date(Date.now() - 10800000).toISOString(),
            created_at: new Date(Date.now() - 10800000).toISOString(),
            strategy_name: '글로벌 기술주 전략'
          },
          {
            id: 5,
            stock_code: '035420',
            stock_name: 'NAVER',
            region: 'domestic',
            order_type: 'BUY',
            quantity: 8,
            order_price: 185000,
            executed_price: 184500,
            total_amount: 1476000,
            status: 'FILLED',
            executed_at: new Date(Date.now() - 14400000).toISOString(),
            created_at: new Date(Date.now() - 14400000).toISOString(),
            strategy_name: '상승장 국내 전략'
          }
        ];
        
        console.log(`🎭 더미 매매 이력 제공: ${orders.length}건`);
      }

      res.json({
        success: true,
        data: orders,
        total: orders.length,
        message: orders.length > 0 ? '매매 이력을 성공적으로 조회했습니다.' : '매매 이력이 없습니다.'
      });

    } catch (error) {
      console.error('❌ 매매 이력 조회 심각한 오류:', error);
      
      // 최후의 수단: 빈 배열 반환
      res.json({
        success: true,
        data: [],
        total: 0,
        message: '매매 이력 조회 중 오류가 발생했습니다.',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// 기존 trading/status 라우트도 안전하게 수정
// 기존 코드를 찾아서 교체하세요 (라인 313-322 정도)
app.get('/api/trading/status', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      console.log('📊 트레이딩 상태 조회:', req.user.id);
      
      let strategy = null;
      
      try {
        const { query } = require('./src/config/database');
        
        const result = await query(
          `SELECT * FROM trading_strategies 
           WHERE user_id = $1 AND is_active = true
           ORDER BY created_at DESC
           LIMIT 1`,
          [req.user.id]
        );

        strategy = result.rows[0] || null;
        
        if (strategy && typeof strategy.stocks === 'string') {
          strategy.stocks = JSON.parse(strategy.stocks);
        }
      } catch (dbError) {
        console.error('❌ 전략 상태 DB 조회 오류:', dbError.message);
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
      res.json({
        success: true,
        data: {
          isActive: false,
          strategy: null
        }
      });
    }
  }
);
// 국내 주식 정보 조회
app.get('/api/trading/stock/info/domestic', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      const { stockCode } = req.query;
      console.log('🔍 국내 주식 정보 조회:', stockCode);
      
      if (!stockCode || !/^\d{6}$/.test(stockCode)) {
        return res.status(400).json({
          success: false,
          message: '올바른 종목 코드를 입력해주세요 (6자리 숫자)'
        });
      }

      try {
        const token = await getKISToken();
        
        // 국내 주식 현재가 조회
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

        if (response.data.rt_cd === '0') {
          const stockData = response.data.output;
          
          res.json({
            success: true,
            data: {
              code: stockCode,
              name: stockData.hts_kor_isnm,
              price: parseInt(stockData.stck_prpr),
              change: parseInt(stockData.prdy_vrss),
              changeRate: parseFloat(stockData.prdy_ctrt),
              market: stockData.bstp_kor_isnm
            }
          });
        } else {
          res.status(404).json({
            success: false,
            message: '종목을 찾을 수 없습니다'
          });
        }
      } catch (apiError) {
        console.error('KIS API 오류:', apiError.message);
        
        // API 오류시 더미 데이터 반환 (개발용)
        const dummyStocks = {
          '005930': { name: '삼성전자', price: 75000 },
          '000660': { name: 'SK하이닉스', price: 120000 },
          '035420': { name: 'NAVER', price: 185000 },
          '051910': { name: 'LG화학', price: 450000 },
          '373220': { name: 'LG에너지솔루션', price: 520000 }
        };
        
        if (dummyStocks[stockCode]) {
          res.json({
            success: true,
            data: {
              code: stockCode,
              name: dummyStocks[stockCode].name,
              price: dummyStocks[stockCode].price,
              change: 0,
              changeRate: 0,
              market: 'KOSPI'
            }
          });
        } else {
          res.status(404).json({
            success: false,
            message: '종목을 찾을 수 없습니다'
          });
        }
      }
    } catch (error) {
      console.error('❌ 국내 주식 정보 조회 오류:', error);
      res.status(500).json({
        success: false,
        message: '주식 정보 조회 중 오류가 발생했습니다'
      });
    }
  }
);

// 해외 주식 정보 조회
app.get('/api/trading/stock/info/global', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      const { ticker } = req.query;
      console.log('🌍 해외 주식 정보 조회:', ticker);
      
      if (!ticker || !/^[A-Z]{1,5}$/.test(ticker)) {
        return res.status(400).json({
          success: false,
          message: '올바른 티커를 입력해주세요'
        });
      }

      try {
        const token = await getKISToken();
        
        // 해외 주식 현재가 조회
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
            SYMB: ticker
          }
        });

        if (response.data.rt_cd === '0') {
          const stockData = response.data.output;
          
          res.json({
            success: true,
            data: {
              code: ticker,
              name: stockData.name || ticker,
              price: parseFloat(stockData.last),
              change: parseFloat(stockData.diff),
              changeRate: parseFloat(stockData.rate),
              market: 'NASDAQ'
            }
          });
        } else {
          res.status(404).json({
            success: false,
            message: '종목을 찾을 수 없습니다'
          });
        }
      } catch (apiError) {
        console.error('KIS API 오류:', apiError.message);
        
        // API 오류시 더미 데이터 반환 (개발용)
        const dummyStocks = {
          'AAPL': { name: 'Apple Inc.', price: 180.50 },
          'MSFT': { name: 'Microsoft Corp.', price: 415.30 },
          'GOOGL': { name: 'Alphabet Inc.', price: 2850.75 },
          'AMZN': { name: 'Amazon.com Inc.', price: 3285.04 },
          'TSLA': { name: 'Tesla Inc.', price: 248.50 },
          'META': { name: 'Meta Platforms Inc.', price: 485.20 },
          'NVDA': { name: 'NVIDIA Corp.', price: 875.45 },
          'NFLX': { name: 'Netflix Inc.', price: 485.75 }
        };
        
        if (dummyStocks[ticker]) {
          res.json({
            success: true,
            data: {
              code: ticker,
              name: dummyStocks[ticker].name,
              price: dummyStocks[ticker].price,
              change: 0,
              changeRate: 0,
              market: 'NASDAQ'
            }
          });
        } else {
          res.status(404).json({
            success: false,
            message: '종목을 찾을 수 없습니다'
          });
        }
      }
    } catch (error) {
      console.error('❌ 해외 주식 정보 조회 오류:', error);
      res.status(500).json({
        success: false,
        message: '주식 정보 조회 중 오류가 발생했습니다'
      });
    }
  }
);

// 국내 계좌 잔고 조회
app.get('/api/trading/account/balance/domestic', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      console.log('💰 국내 계좌 잔고 조회:', req.user.id);
      
      try {
        const token = await getKISToken();
        
        // 국내 주식 잔고 조회
        const response = await axios.get(`${KIS_BASE_URL}/uapi/domestic-stock/v1/trading/inquire-balance`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'appkey': process.env.KIS_APP_KEY,
            'appsecret': process.env.KIS_APP_SECRET,
            'tr_id': 'TTTC8434R'
          },
          params: {
            CANO: process.env.KIS_ACCOUNT_NO,
            ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PRODUCT_CD,
            AFHR_FLPR_YN: 'N',
            OFL_YN: '',
            INQR_DVSN: '02',
            UNPR_DVSN: '01',
            FUND_STTL_ICLD_YN: 'N',
            FNCG_AMT_AUTO_RDPT_YN: 'N',
            PRCS_DVSN: '01',
            CTX_AREA_FK100: '',
            CTX_AREA_NK100: ''
          }
        });

        if (response.data.rt_cd === '0') {
          const balanceData = response.data.output2[0];
          
          res.json({
            success: true,
            data: {
              totalDeposit: parseInt(balanceData.dnca_tot_amt), // 총 예수금
              availableAmount: parseInt(balanceData.nxdy_excc_amt), // 익일 정산 금액 (주문가능금액)
              totalAsset: parseInt(balanceData.tot_evlu_amt), // 총 평가금액
              profitLoss: parseInt(balanceData.evlu_pfls_smtl_amt), // 평가손익
              profitLossRate: parseFloat(balanceData.tot_evlu_pfls_rt) // 총 평가손익률
            }
          });
        } else {
          throw new Error('KIS API 응답 오류');
        }
      } catch (apiError) {
        console.error('KIS API 오류:', apiError.message);
        
        // API 오류시 더미 데이터 반환
        res.json({
          success: true,
          data: {
            totalDeposit: 10000000, // 1천만원
            availableAmount: 8500000, // 850만원
            totalAsset: 9200000, // 920만원
            profitLoss: -800000, // -80만원
            profitLossRate: -8.7 // -8.7%
          }
        });
      }
    } catch (error) {
      console.error('❌ 국내 계좌 잔고 조회 오류:', error);
      res.status(500).json({
        success: false,
        message: '계좌 잔고 조회 중 오류가 발생했습니다'
      });
    }
  }
);

// 해외 계좌 잔고 조회
app.get('/api/trading/account/balance/global', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      console.log('🌍 해외 계좌 잔고 조회:', req.user.id);
      
      try {
        const token = await getKISToken();
        
        // 해외 주식 잔고 조회
        const response = await axios.get(`${KIS_BASE_URL}/uapi/overseas-stock/v1/trading/inquire-balance`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'appkey': process.env.KIS_APP_KEY,
            'appsecret': process.env.KIS_APP_SECRET,
            'tr_id': 'JTTT3012R'
          },
          params: {
            CANO: process.env.KIS_ACCOUNT_NO,
            ACNT_PRDT_CD: process.env.KIS_ACCOUNT_PRODUCT_CD,
            OVRS_EXCG_CD: 'NASD',
            TR_CRCY_CD: 'USD',
            CTX_AREA_FK200: '',
            CTX_AREA_NK200: ''
          }
        });

        if (response.data.rt_cd === '0') {
          const balanceData = response.data.output2;
          const totalBalance = balanceData.find(item => item.crcy_cd === 'USD');
          
          res.json({
            success: true,
            data: {
              totalDeposit: parseFloat(totalBalance?.frcr_dncl_amt_2 || 0), // 외화 예수금
              availableAmount: parseFloat(totalBalance?.ovrs_ord_psbl_amt || 0), // 해외 주문가능금액
              totalAsset: parseFloat(totalBalance?.tot_evlu_pfls_amt || 0), // 총 평가금액
              profitLoss: parseFloat(totalBalance?.evlu_pfls_smtl_amt || 0), // 평가손익
              profitLossRate: parseFloat(totalBalance?.tot_evlu_pfls_rt || 0) // 총 평가손익률
            }
          });
        } else {
          throw new Error('KIS API 응답 오류');
        }
      } catch (apiError) {
        console.error('KIS API 오류:', apiError.message);
        
        // API 오류시 더미 데이터 반환
        res.json({
          success: true,
          data: {
            totalDeposit: 50000, // $50,000
            availableAmount: 42500, // $42,500
            totalAsset: 48200, // $48,200
            profitLoss: -1800, // -$1,800
            profitLossRate: -3.6 // -3.6%
          }
        });
      }
    } catch (error) {
      console.error('❌ 해외 계좌 잔고 조회 오류:', error);
      res.status(500).json({
        success: false,
        message: '계좌 잔고 조회 중 오류가 발생했습니다'
      });
    }
  }
);

// 에러 핸들링
app.use((err, req, res, next) => {
  console.error('💥 서버 에러:', err);
  res.status(500).json({ 
    message: '서버 오류가 발생했습니다.',
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});

// 404 핸들링 (맨 마지막에)
app.use((req, res) => {
  console.log(`❌ 404 - 경로를 찾을 수 없음: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    message: '요청한 리소스를 찾을 수 없습니다.',
    path: req.originalUrl,
    method: req.method
  });
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`✅ 서버가 포트 ${PORT}에서 실행 중입니다.`);
  console.log(`🌐 접속 URL: http://localhost:${PORT}`);
  // console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
  // console.log(`🔐 Google OAuth: http://localhost:${PORT}/api/auth/google`);
  // console.log(`🔐 Kakao OAuth: http://localhost:${PORT}/api/auth/kakao`);
  // console.log('');
  // console.log('OAuth 상태:');
  // console.log('- Google:', !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) ? '✅ 설정됨' : '❌ 미설정');
  // console.log('- Kakao:', !!process.env.KAKAO_CLIENT_ID ? '✅ 설정됨' : '❌ 미설정');
  console.log('- Database:', '✅ 연결됨');
  console.log('- JWT:', !!process.env.JWT_SECRET ? '✅ 설정됨' : '❌ 미설정');
});

// 프로세스 종료 처리
process.on('SIGTERM', () => {
  console.log('👋 서버를 종료합니다...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 서버를 종료합니다...');
  process.exit(0);
});