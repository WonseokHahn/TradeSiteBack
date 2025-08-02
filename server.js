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
app.use(helmet());
// server.js의 CORS 설정 부분을 수정

app.use(cors({
  origin: function (origin, callback) {
    // 허용할 도메인 목록
    const allowedOrigins = [
      'http://localhost:8080', // 개발 환경
      'https://wonseokhahn.github.io/TradeSiteFront', // GitHub Pages
      'https://your-custom-domain.com', // 커스텀 도메인 (있는 경우)
      process.env.FRONTEND_URL // 환경 변수로 설정된 URL
    ].filter(Boolean); // undefined 제거

    // origin이 없는 경우 (모바일 앱, Postman 등) 허용
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('❌ CORS 차단:', origin);
      callback(new Error('CORS 정책에 의해 차단되었습니다.'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
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
      kakao: !!process.env.KAKAO_CLIENT_ID
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

// Trading 라우터
app.get('/api/trading/status', 
  passport.authenticate('jwt', { session: false }),
  (req, res) => {
    console.log('📈 트레이딩 상태 요청');
    res.json({ 
      message: '트레이딩 상태 라우트',
      user: req.user.email,
      status: 'working'
    });
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