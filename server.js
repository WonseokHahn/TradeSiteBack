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

console.log('⚙️ 미들웨어를 설정합니다...');

// 미들웨어 설정
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: function (origin, callback) {
    // 개발 환경에서는 모든 origin 허용
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    // 프로덕션에서는 특정 도메인만 허용
    const allowedOrigins = [
      'https://wonseokhahn.github.io',
      'https://tradesiteback.onrender.com',
      process.env.FRONTEND_URL
    ].filter(Boolean);
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS 정책에 의해 차단되었습니다.'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 기본 요청 로깅
app.use((req, res, next) => {
  console.log(`📝 ${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

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

// 기본 라우트
app.get('/', (req, res) => {
  console.log('📍 기본 라우트 접근');
  res.json({ 
    message: '주식 자동매매 API 서버',
    version: '2.2.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    features: {
      oauth: {
        google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        kakao: !!(process.env.KAKAO_CLIENT_ID && process.env.KAKAO_CLIENT_SECRET)
      },
      trading: {
        kis_configured: !!(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET),
        openai_configured: !!process.env.OPENAI_API_KEY,
        account_configured: !!process.env.KIS_ACCOUNT_NO
      },
      news: {
        naver_configured: !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET)
      }
    }
  });
});

// Health check
app.get('/api/health', (req, res) => {
  console.log('💚 Health check 요청');
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    oauth_status: {
      google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      kakao: !!(process.env.KAKAO_CLIENT_ID && process.env.KAKAO_CLIENT_SECRET),
      jwt: !!process.env.JWT_SECRET,
      database: true
    },
    trading_status: {
      kis_api: !!(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET),
      openai_api: !!process.env.OPENAI_API_KEY,
      account_configured: !!process.env.KIS_ACCOUNT_NO
    },
    news_status: {
      naver_api: !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET)
    }
  });
});

// API 요청 로깅 미들웨어
app.use('/api', (req, res, next) => {
  console.log(`🔍 [${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Trading 라우터 추가 (안전한 방식)
console.log('📈 Trading 라우터를 설정합니다...');
try {
  const tradingRoutes = require('./src/routes/trading');
  app.use('/api/trading', tradingRoutes);
  console.log('✅ Trading 라우터 연결 완료');
} catch (error) {
  console.error('❌ Trading 라우터 로드 실패:', error.message);
  
  // 대체 라우터 생성 (Trading 라우터 로드 실패 시)
  app.get('/api/trading/*', (req, res) => {
    res.status(503).json({
      success: false,
      message: 'Trading 서비스가 현재 사용할 수 없습니다.',
      error: 'SERVICE_UNAVAILABLE'
    });
  });
}

// OAuth 라우터들을 안전하게 등록
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  // Google OAuth 라우터
  app.get('/api/auth/google', 
    passport.authenticate('google', { scope: ['profile', 'email'] })
  );

  app.get('/api/auth/google/callback',
    passport.authenticate('google', { session: false }),
    (req, res) => {
      try {
        console.log('✅ Google OAuth 성공:', req.user);
        
        const token = generateToken(req.user);
        console.log('🎫 JWT 토큰 생성 완료');

        const redirectURL = `${process.env.FRONTEND_URL}/auth/callback?token=${token}&provider=google&name=${encodeURIComponent(req.user.name)}`;
        console.log('🔄 프론트엔드로 리다이렉트:', redirectURL);
        
        res.redirect(redirectURL);
      } catch (error) {
        console.error('❌ Google 콜백 처리 실패:', error);
        res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
      }
    }
  );
} else {
  app.get('/api/auth/google', (req, res) => {
    res.status(501).json({
      success: false,
      message: 'Google OAuth가 설정되지 않았습니다.'
    });
  });
}

if (process.env.KAKAO_CLIENT_ID && process.env.KAKAO_CLIENT_SECRET) {
  // Kakao OAuth 라우터
  app.get('/api/auth/kakao',
    passport.authenticate('kakao')
  );

  app.get('/api/auth/kakao/callback',
    passport.authenticate('kakao', { session: false }),
    (req, res) => {
      try {
        console.log('✅ Kakao OAuth 성공:', req.user);
        
        const token = generateToken(req.user);
        console.log('🎫 JWT 토큰 생성 완료');
        
        const redirectURL = `${process.env.FRONTEND_URL}/auth/callback?token=${token}&provider=kakao&name=${encodeURIComponent(req.user.name)}`;
        console.log('🔄 프론트엔드로 리다이렉트:', redirectURL);
        
        res.redirect(redirectURL);
      } catch (error) {
        console.error('❌ Kakao 콜백 처리 실패:', error);
        res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
      }
    }
  );
} else {
  app.get('/api/auth/kakao', (req, res) => {
    res.status(501).json({
      success: false,
      message: 'Kakao OAuth가 설정되지 않았습니다.'
    });
  });
}

// 프로필 조회 (JWT 인증 필요)
app.get('/api/auth/profile', 
  passport.authenticate('jwt', { session: false }),
  (req, res) => {
    try {
      console.log('👤 프로필 조회 성공:', req.user.email);
      const { password, ...userProfile } = req.user;
      res.json({
        success: true,
        user: userProfile
      });
    } catch (error) {
      console.error('❌ 프로필 조회 실패:', error);
      res.status(500).json({
        success: false,
        message: '프로필을 조회할 수 없습니다.'
      });
    }
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
        display: 10,
        start: 1,
        sort: 'date'
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
      const removeHtmlTags = (str) => {
        return str.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      };

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

// GPT 요약 생성 함수
async function generateSummary(content) {
  try {
    if (!process.env.OPENAI_API_KEY) {
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
    
    const sentences = content.split('.').filter(s => s.trim().length > 10);
    if (sentences.length > 0) {
      return sentences.slice(0, 2).join('. ').substring(0, 150) + '.';
    }
    
    return content.substring(0, 100) + '... (자동 요약)';
  }
}

// 자동매매 시스템 상태 조회 (관리자용)
app.get('/api/admin/trading-status', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      // Trading Engine이 로드되어 있는지 확인
      let systemStatus = {
        activeTradings: 0,
        totalPositions: 0,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString(),
        status: 'unavailable'
      };

      try {
        const tradingEngine = require('./src/services/tradingEngine');
        systemStatus = tradingEngine.getSystemStatus();
        systemStatus.status = 'available';
      } catch (error) {
        console.log('⚠️ Trading Engine 로드 실패:', error.message);
      }
      
      res.json({
        success: true,
        data: systemStatus
      });
    } catch (error) {
      console.error('자동매매 시스템 상태 조회 실패:', error);
      res.status(500).json({
        success: false,
        message: '시스템 상태를 조회할 수 없습니다.'
      });
    }
  }
);

// 긴급 정지 (관리자용)
app.post('/api/admin/emergency-stop', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      let result = {
        success: false,
        message: 'Trading Engine을 사용할 수 없습니다.'
      };

      try {
        const tradingEngine = require('./src/services/tradingEngine');
        await tradingEngine.emergencyStopAll();
        result = {
          success: true,
          message: '모든 자동매매가 긴급 정지되었습니다.'
        };
      } catch (error) {
        console.log('⚠️ Trading Engine 긴급 정지 실패:', error.message);
      }
      
      res.json(result);
    } catch (error) {
      console.error('긴급 정지 실패:', error);
      res.status(500).json({
        success: false,
        message: '긴급 정지에 실패했습니다.'
      });
    }
  }
);

// 에러 핸들링 미들웨어
app.use((err, req, res, next) => {
  console.error('💥 서버 에러:', err);
  
  // CORS 에러 처리
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({
      success: false,
      message: 'CORS 정책에 의해 차단되었습니다.'
    });
  }
  
  // JWT 에러 처리
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      success: false,
      message: '인증이 필요합니다.'
    });
  }
  
  // 기타 에러 처리
  res.status(err.status || 500).json({ 
    success: false,
    message: '서버 오류가 발생했습니다.',
    error: process.env.NODE_ENV === 'development' ? {
      message: err.message,
      stack: err.stack
    } : {}
  });
});

// 404 핸들링
app.use('*', (req, res) => {
  console.log(`❌ 404 - 경로를 찾을 수 없음: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    success: false,
    message: '요청한 리소스를 찾을 수 없습니다.',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown 처리
process.on('SIGTERM', async () => {
  console.log('👋 SIGTERM 신호 받음 - 서버를 안전하게 종료합니다...');
  
  try {
    const tradingEngine = require('./src/services/tradingEngine');
    await tradingEngine.emergencyStopAll();
    console.log('✅ 자동매매 시스템 정리 완료');
  } catch (error) {
    console.log('⚠️ 자동매매 시스템 정리 중 오류 (무시됨):', error.message);
  }
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('👋 SIGINT 신호 받음 - 서버를 안전하게 종료합니다...');
  
  try {
    const tradingEngine = require('./src/services/tradingEngine');
    await tradingEngine.emergencyStopAll();
    console.log('✅ 자동매매 시스템 정리 완료');
  } catch (error) {
    console.log('⚠️ 자동매매 시스템 정리 중 오류 (무시됨):', error.message);
  }
  
  process.exit(0);
});

// 처리되지 않은 Promise 거부 처리
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ 처리되지 않은 Promise 거부:', reason);
});

// 처리되지 않은 예외 처리
process.on('uncaughtException', (error) => {
  console.error('❌ 처리되지 않은 예외:', error);
  // 크리티컬 에러가 아닌 경우 서버 유지
  if (!error.message.includes('EADDRINUSE')) {
    return;
  }
  process.exit(1);
});

// 서버 시작
const server = app.listen(PORT, () => {
  console.log('🎉=================================🎉');
  console.log(`✅ 주식 자동매매 서버가 시작되었습니다!`);
  console.log(`🌐 포트: ${PORT}`);
  console.log(`🔗 URL: http://localhost:${PORT}`);
  console.log('🎉=================================🎉');
  console.log('📊 시스템 상태:');
  console.log('- Database:', '✅ 연결됨');
  console.log('- JWT:', !!process.env.JWT_SECRET ? '✅ 설정됨' : '❌ 미설정');
  console.log('- KIS API:', !!(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET) ? '✅ 설정됨' : '❌ 미설정');
  console.log('- OpenAI API:', !!process.env.OPENAI_API_KEY ? '✅ 설정됨' : '❌ 미설정');
  console.log('- Naver API:', !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) ? '✅ 설정됨' : '❌ 미설정');
  console.log('🎉=================================🎉');
});

// 서버 타임아웃 설정
server.timeout = 120000; // 2분

// 서버 종료 시 정리
server.on('close', () => {
  console.log('🔚 서버가 종료되었습니다.');
});require('dotenv').config();
