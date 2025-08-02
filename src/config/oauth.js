console.log('🔐 OAuth 설정 파일이 로딩되었습니다');

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const KakaoStrategy = require('passport-kakao').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const { query } = require('./database');

// 환경 변수 확인
console.log('🔍 OAuth 환경 변수 확인:');
console.log('- GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? '✅ 설정됨' : '❌ 미설정');
console.log('- GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? '✅ 설정됨' : '❌ 미설정');
console.log('- KAKAO_CLIENT_ID:', process.env.KAKAO_CLIENT_ID ? '✅ 설정됨' : '❌ 미설정');

// // Google OAuth Strategy
// if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
//   console.log('🔧 Google OAuth 전략을 설정합니다...');
  
//   passport.use(new GoogleStrategy({
//     clientID: process.env.GOOGLE_CLIENT_ID,
//     clientSecret: process.env.GOOGLE_CLIENT_SECRET,
//     callbackURL: "/api/auth/google/callback"
//   }, async (accessToken, refreshToken, profile, done) => {
//     try {
//       console.log('🔍 Google 사용자 정보 수신:', {
//         id: profile.id,
//         name: profile.displayName,
//         email: profile.emails?.[0]?.value
//       });
      
//       // 기존 사용자 확인
//       const existingUser = await query(
//         'SELECT * FROM users WHERE google_id = $1',
//         [profile.id]
//       );
      
//       if (existingUser.rows.length > 0) {
//         console.log('✅ 기존 Google 사용자 로그인:', existingUser.rows[0].email);
        
//         // 마지막 로그인 시간 업데이트
//         await query(
//           'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
//           [existingUser.rows[0].id]
//         );
        
//         return done(null, existingUser.rows[0]);
//       }
      
//       // 새 사용자 생성
//       console.log('🆕 새 Google 사용자 생성 중...');
//       const newUser = await query(
//         `INSERT INTO users (google_id, email, name, avatar, last_login_at)
//          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
//          RETURNING *`,
//         [
//           profile.id,
//           profile.emails?.[0]?.value || null,
//           profile.displayName,
//           profile.photos?.[0]?.value || null
//         ]
//       );
      
//       console.log('✅ 새 Google 사용자 생성 완료:', newUser.rows[0].email);
//       done(null, newUser.rows[0]);
      
//     } catch (error) {
//       console.error('❌ Google OAuth 데이터베이스 처리 실패:', error);
//       done(error, null);
//     }
//   }));
  
//   console.log('✅ Google OAuth 전략 설정 완료');
// }

// // Kakao OAuth Strategy
// if (process.env.KAKAO_CLIENT_ID) {
//   console.log('🔧 Kakao OAuth 전략을 설정합니다...');
  
//   passport.use(new KakaoStrategy({
//     clientID: process.env.KAKAO_CLIENT_ID,
//     callbackURL: "/api/auth/kakao/callback"
//   }, async (accessToken, refreshToken, profile, done) => {
//     try {
//       console.log('🔍 Kakao 사용자 정보 수신:', {
//         id: profile.id,
//         name: profile.displayName,
//         email: profile._json.kakao_account?.email
//       });
      
//       // 기존 사용자 확인
//       const existingUser = await query(
//         'SELECT * FROM users WHERE kakao_id = $1',
//         [profile.id.toString()]
//       );
      
//       if (existingUser.rows.length > 0) {
//         console.log('✅ 기존 Kakao 사용자 로그인:', existingUser.rows[0].email);
        
//         // 마지막 로그인 시간 업데이트
//         await query(
//           'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
//           [existingUser.rows[0].id]
//         );
        
//         return done(null, existingUser.rows[0]);
//       }
      
//       // 새 사용자 생성
//       console.log('🆕 새 Kakao 사용자 생성 중...');
//       const newUser = await query(
//         `INSERT INTO users (kakao_id, email, name, avatar, last_login_at)
//          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
//          RETURNING *`,
//         [
//           profile.id.toString(),
//           profile._json.kakao_account?.email || null,
//           profile.displayName,
//           profile._json.kakao_account?.profile?.profile_image_url || null
//         ]
//       );
      
//       console.log('✅ 새 Kakao 사용자 생성 완료:', newUser.rows[0].email);
//       done(null, newUser.rows[0]);
      
//     } catch (error) {
//       console.error('❌ Kakao OAuth 데이터베이스 처리 실패:', error);
//       done(error, null);
//     }
//   }));
  
//   console.log('✅ Kakao OAuth 전략 설정 완료');
// }
// server.js의 OAuth 콜백 부분을 수정

app.get('/api/auth/google/callback',
  passport.authenticate('google', { session: false }),
  (req, res) => {
    try {
      console.log('✅ Google OAuth 성공:', req.user);
      
      // JWT 토큰 생성
      const token = generateToken(req.user);
      console.log('🎫 JWT 토큰 생성 완료');
      
      // FRONTEND_URL이 이미 /TradeSiteFront를 포함하고 있음
      const frontendUrl = process.env.FRONTEND_URL || 'https://wonseokhahn.github.io/TradeSiteFront';
      const redirectURL = `${frontendUrl}/auth/callback?token=${token}&provider=google&name=${encodeURIComponent(req.user.name)}`;
      
      console.log('🔄 프론트엔드로 리다이렉트:', redirectURL);
      
      res.redirect(redirectURL);
    } catch (error) {
      console.error('❌ Google 콜백 처리 실패:', error);
      const frontendUrl = process.env.FRONTEND_URL || 'https://wonseokhahn.github.io/TradeSiteFront';
      res.redirect(`${frontendUrl}/login?error=auth_failed`);
    }
  }
);

app.get('/api/auth/kakao/callback',
  passport.authenticate('kakao', { session: false }),
  (req, res) => {
    try {
      console.log('✅ Kakao OAuth 성공:', req.user);
      
      // JWT 토큰 생성
      const token = generateToken(req.user);
      console.log('🎫 JWT 토큰 생성 완료');
      
      // FRONTEND_URL이 이미 /TradeSiteFront를 포함하고 있음
      const frontendUrl = process.env.FRONTEND_URL || 'https://wonseokhahn.github.io/TradeSiteFront';
      const redirectURL = `${frontendUrl}/auth/callback?token=${token}&provider=kakao&name=${encodeURIComponent(req.user.name)}`;
      
      console.log('🔄 프론트엔드로 리다이렉트:', redirectURL);
      
      res.redirect(redirectURL);
    } catch (error) {
      console.error('❌ Kakao 콜백 처리 실패:', error);
      const frontendUrl = process.env.FRONTEND_URL || 'https://wonseokhahn.github.io/TradeSiteFront';
      res.redirect(`${frontendUrl}/login?error=auth_failed`);
    }
  }
);


// JWT Strategy
if (process.env.JWT_SECRET) {
  console.log('🔧 JWT 전략을 설정합니다...');
  
  passport.use(new JwtStrategy({
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: process.env.JWT_SECRET
  }, async (payload, done) => {
    try {
      console.log('🔍 JWT 페이로드 검증:', { id: payload.id, email: payload.email });
      
      const result = await query(
        'SELECT * FROM users WHERE id = $1',
        [payload.id]
      );
      
      if (result.rows.length > 0) {
        console.log('✅ JWT 사용자 인증 성공:', result.rows[0].email);
        return done(null, result.rows[0]);
      }
      
      console.log('❌ JWT 사용자를 찾을 수 없음');
      return done(null, false);
    } catch (error) {
      console.error('❌ JWT 검증 실패:', error);
      return done(error, false);
    }
  }));
  
  console.log('✅ JWT 전략 설정 완료');
}

console.log('✅ OAuth 설정 파일 로딩 완료');

module.exports = passport;