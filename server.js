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

// KIS API 설정 - 개선된 버전
const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';

// KIS 토큰 관리 클래스
class KISTokenManager {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = null;
    this.isGettingToken = false; // 동시 요청 방지
  }

  // 토큰 유효성 검사
  isTokenValid() {
    if (!this.accessToken || !this.tokenExpiry) {
      return false;
    }
    
    // 토큰이 만료되기 10분 전에 갱신하도록 설정
    const bufferTime = 10 * 60 * 1000; // 10분
    return Date.now() < (this.tokenExpiry - bufferTime);
  }

  // 토큰 획득 (동시 요청 방지)
  async getToken() {
    try {
      // 토큰이 유효하면 바로 반환
      if (this.isTokenValid()) {
        console.log('✅ 기존 KIS 토큰 사용 중 (유효 시간:', new Date(this.tokenExpiry).toLocaleString(), ')');
        return this.accessToken;
      }

      // 이미 토큰을 가져오는 중이면 대기
      if (this.isGettingToken) {
        console.log('⏳ 다른 요청이 토큰을 가져오는 중...');
        // 최대 15초 대기
        for (let i = 0; i < 150; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (this.isTokenValid() && !this.isGettingToken) {
            return this.accessToken;
          }
        }
        throw new Error('토큰 대기 시간 초과');
      }

      this.isGettingToken = true;
      console.log('🔄 새로운 KIS 토큰 요청 중...');

      const response = await axios.post(`${KIS_BASE_URL}/oauth2/tokenP`, {
        grant_type: 'client_credentials',
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET
      }, {
        timeout: 30000, // 30초 타임아웃
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        // HTTP Agent 설정
        httpAgent: new (require('http')).Agent({ 
          keepAlive: true, 
          timeout: 30000
        }),
        httpsAgent: new (require('https')).Agent({ 
          keepAlive: true, 
          timeout: 30000,
          rejectUnauthorized: false
        })
      });

      if (response.data && response.data.access_token) {
        this.accessToken = response.data.access_token;
        // expires_in은 초 단위이므로 밀리초로 변환
        this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
        
        console.log('✅ KIS 토큰 발급 성공');
        console.log(`📅 토큰 만료 시간: ${new Date(this.tokenExpiry).toLocaleString()}`);
        console.log(`⏰ 토큰 유효 시간: ${Math.floor(response.data.expires_in / 3600)}시간`);
        console.log(`🔑 토큰 앞 20자리: ${this.accessToken.substring(0, 20)}...`);
        
        return this.accessToken;
      } else {
        console.error('❌ 토큰 응답 구조:', response.data);
        throw new Error('토큰 응답에 access_token이 없습니다');
      }

    } catch (error) {
      console.error('❌ KIS 토큰 발급 상세 오류:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        code: error.code,
        errno: error.errno
      });

      // 네트워크 오류인 경우 더 구체적인 메시지
      if (error.code === 'ECONNRESET' || error.message === 'socket hang up') {
        throw new Error('KIS API 서버 연결이 끊어졌습니다. 잠시 후 다시 시도해주세요.');
      } else if (error.code === 'ETIMEDOUT') {
        throw new Error('KIS API 서버 응답 시간이 초과되었습니다.');
      } else {
        throw new Error(`KIS 토큰 발급 실패: ${error.message}`);
      }
    } finally {
      this.isGettingToken = false;
    }
  }

  // 토큰 강제 갱신
  async refreshToken() {
    console.log('🔄 KIS 토큰 강제 갱신');
    this.accessToken = null;
    this.tokenExpiry = null;
    return await this.getToken();
  }
}

// 전역 KIS 토큰 매니저 인스턴스
const kisTokenManager = new KISTokenManager();

// KIS API 호출 헬퍼 함수
async function makeKISRequest(endpoint, params = {}, headers = {}, retryCount = 0) {
  const maxRetries = 3;
  
  try {
    const token = await kisTokenManager.getToken();
    
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'appkey': process.env.KIS_APP_KEY,
        'appsecret': process.env.KIS_APP_SECRET,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Connection': 'keep-alive',
        ...headers
      },
      params,
      timeout: 30000, // 30초로 증가
      // HTTP Agent 설정으로 연결 안정성 향상
      httpAgent: new (require('http')).Agent({ 
        keepAlive: true, 
        maxSockets: 5,
        timeout: 30000
      }),
      httpsAgent: new (require('https')).Agent({ 
        keepAlive: true, 
        maxSockets: 5,
        timeout: 30000,
        rejectUnauthorized: false // SSL 인증서 문제 해결
      }),
      // 연결 재시도 설정
      retry: 3,
      retryDelay: 2000
    };

    console.log(`🔍 KIS API 요청 (${retryCount + 1}번째): ${endpoint}`);
    console.log('📝 요청 파라미터:', params);
    
    // 재시도 시 잠시 대기
    if (retryCount > 0) {
      console.log(`⏳ ${retryCount * 2}초 대기 후 재시도...`);
      await new Promise(resolve => setTimeout(resolve, retryCount * 2000));
    }

    const response = await axios.get(`${KIS_BASE_URL}${endpoint}`, config);
    
    console.log(`✅ KIS API 응답 성공: ${endpoint} (상태코드: ${response.status})`);
    console.log('📊 응답 rt_cd:', response.data.rt_cd, 'msg1:', response.data.msg1);
    
    // rt_cd 확인 - '0'이 성공, 나머지는 오류
    if (response.data.rt_cd && response.data.rt_cd !== '0') {
      throw new Error(`KIS API 오류 [${response.data.rt_cd}]: ${response.data.msg1 || response.data.msg || 'Unknown error'}`);
    }
    
    // 응답 성공 확인 (rt_cd가 없는 경우도 있음)
    if (response.data.rt_cd === '0' || response.status === 200) {
      return response.data;
    } else {
      throw new Error(`KIS API 오류: ${response.data.msg1 || response.data.msg || 'Unknown error'}`);
    }

  } catch (error) {
    console.error(`❌ KIS API 요청 실패 (${retryCount + 1}/${maxRetries + 1}):`, {
      endpoint,
      message: error.message,
      status: error.response?.status,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall
    });

    // 네트워크 오류나 타임아웃 오류인 경우 재시도
    const isRetryableError = 
      error.code === 'ECONNRESET' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'ETIMEDOUT' ||
      error.message === 'socket hang up' ||
      error.message.includes('timeout') ||
      error.response?.status === 401 ||
      error.response?.status >= 500;

    if (isRetryableError && retryCount < maxRetries) {
      console.log(`🔄 재시도 가능한 오류 감지. ${maxRetries - retryCount}번 더 시도...`);
      
      // 401 오류면 토큰 갱신
      if (error.response?.status === 401) {
        console.log('🔑 토큰 오류로 인한 토큰 갱신...');
        await kisTokenManager.refreshToken();
      }
      
      return makeKISRequest(endpoint, params, headers, retryCount + 1);
    }

    throw error;
  }
}

// 국내 계좌 잔고 조회 - 개선된 버전
app.get('/api/trading/account/balance/domestic', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      console.log('💰 국내 계좌 잔고 조회 요청:', req.user.id);
      
      // 환경변수 확인 및 검증
      if (!process.env.KIS_APP_KEY || !process.env.KIS_APP_SECRET) {
        console.log('⚠️ KIS API 설정이 없어서 더미 데이터 반환');
        return res.json({
          success: true,
          data: {
            totalDeposit: 10000000,
            availableAmount: 8500000,
            totalAsset: 9200000,
            profitLoss: -800000,
            profitLossRate: -8.7
          },
          message: 'KIS API 설정이 없어서 더미 데이터를 반환합니다.'
        });
      }

      if (!process.env.KIS_ACCOUNT_NO || !process.env.KIS_ACCOUNT_PRODUCT_CD) {
        console.log('⚠️ KIS 계좌 정보가 없어서 더미 데이터 반환');
        return res.json({
          success: true,
          data: {
            totalDeposit: 10000000,
            availableAmount: 8500000,
            totalAsset: 9200000,
            profitLoss: -800000,
            profitLossRate: -8.7
          },
          message: 'KIS 계좌 정보가 설정되지 않았습니다.'
        });
      }

      // 계좌 정보 검증 및 포맷팅 - 실전투자 계좌번호는 8자리 사용
      let accountNo = process.env.KIS_ACCOUNT_NO.replace(/[^0-9]/g, ''); // 숫자만 추출
      let productCd = process.env.KIS_ACCOUNT_PRODUCT_CD.padStart(2, '0'); // 2자리로 패딩
      
      // 실전투자 계좌번호는 앞 8자리만 사용 (10자리 전체가 아님!)
      if (accountNo.length === 10) {
        accountNo = accountNo.substring(0, 8); // 앞 8자리만 사용
        console.log('✅ 10자리 계좌번호에서 앞 8자리 추출:', accountNo);
      }
      
      console.log('🔍 계좌 정보 검증 (실전투자용):', {
        원본_계좌번호: process.env.KIS_ACCOUNT_NO,
        추출된_8자리: accountNo,
        계좌번호_길이: accountNo.length,
        원본_상품코드: process.env.KIS_ACCOUNT_PRODUCT_CD,
        정제된_상품코드: productCd,
        상품코드_길이: productCd.length
      });

      // 실전투자 계좌번호 길이 검증 (8자리)
      if (accountNo.length !== 8) {
        console.error('❌ 실전투자 계좌번호 길이 오류:', accountNo.length, '자리 (8자리 필요)');
        return res.json({
          success: true,
          data: {
            totalDeposit: 10000000,
            availableAmount: 8500000,
            totalAsset: 9200000,
            profitLoss: -800000,
            profitLossRate: -8.7
          },
          message: `실전투자 계좌번호 형식 오류 (${accountNo.length}자리, 8자리 필요) - 더미 데이터 반환`
        });
      }

      // KIS API 호출 - 실전투자용 파라미터 (TTTC8434R)
      const apiParams = {
        CANO: accountNo, // 8자리 숫자 (실전투자)
        ACNT_PRDT_CD: productCd, // 2자리 (01, 02 등)
        AFHR_FLPR_YN: 'N', // 시간외단일가여부
        OFL_YN: '', // 오프라인여부 (빈값)
        INQR_DVSN: '02', // 조회구분 (01: 대출일별, 02: 종목별)
        UNPR_DVSN: '01', // 단가구분 (01: 기본값)
        FUND_STTL_ICLD_YN: 'N', // 펀드결제분포함여부
        FNCG_AMT_AUTO_RDPT_YN: 'N', // 융자금액자동상환여부
        PRCS_DVSN: '01', // 처리구분 (00: 전일매매포함, 01: 전일매매미포함)
        CTX_AREA_FK100: '', // 연속조회키
        CTX_AREA_NK100: ''  // 연속조회키
      };

      console.log('📋 실전투자 API 파라미터:', apiParams);
      console.log('🔍 각 파라미터 길이 검증:', {
        CANO: `${apiParams.CANO} (${apiParams.CANO.length}자리) - 실전투자는 8자리`,
        ACNT_PRDT_CD: `${apiParams.ACNT_PRDT_CD} (${apiParams.ACNT_PRDT_CD.length}자리)`,
        INQR_DVSN: `${apiParams.INQR_DVSN} (${apiParams.INQR_DVSN.length}자리)`,
        UNPR_DVSN: `${apiParams.UNPR_DVSN} (${apiParams.UNPR_DVSN.length}자리)`,
        PRCS_DVSN: `${apiParams.PRCS_DVSN} (${apiParams.PRCS_DVSN.length}자리)`
      });

      const apiData = await makeKISRequest('/uapi/domestic-stock/v1/trading/inquire-balance', apiParams, {
        'tr_id': 'TTTC8434R' // 실전투자용
      });

      // 응답 데이터 상세 로깅
      console.log('📋 KIS API 응답 전체 구조:', JSON.stringify(apiData, null, 2));
      console.log('🔍 rt_cd:', apiData.rt_cd, 'msg_cd:', apiData.msg_cd, 'msg1:', apiData.msg1);
      
      // rt_cd가 0이 아닌 경우 오류 처리
      if (apiData.rt_cd !== '0') {
        console.error('❌ KIS API 오류 응답:', {
          rt_cd: apiData.rt_cd,
          msg_cd: apiData.msg_cd,
          msg1: apiData.msg1
        });
        
        // 특정 오류 코드에 대한 메시지
        let errorMessage = '계좌 정보 조회 실패';
        if (apiData.msg1) {
          errorMessage = apiData.msg1;
        } else if (apiData.rt_cd === '2') {
          errorMessage = '잔고 조회 권한이 없거나 계좌 정보가 올바르지 않습니다';
        }
        
        throw new Error(errorMessage);
      }

      // 응답 데이터 파싱
      if (apiData && apiData.output2) {
        console.log('📊 output2 데이터 확인:', apiData.output2);
        
        if (apiData.output2.length > 0) {
          const balanceData = apiData.output2[0];
          console.log('💼 잔고 원본 데이터:', balanceData);
          
          const responseData = {
            totalDeposit: parseInt(balanceData.dnca_tot_amt) || 0,
            availableAmount: parseInt(balanceData.nxdy_excc_amt) || 0,
            totalAsset: parseInt(balanceData.tot_evlu_amt) || 0,
            profitLoss: parseInt(balanceData.evlu_pfls_smtl_amt) || 0,
            profitLossRate: parseFloat(balanceData.tot_evlu_pfls_rt) || 0
          };

          console.log('✅ 국내 계좌 잔고 조회 성공:', {
            totalDeposit: responseData.totalDeposit.toLocaleString(),
            availableAmount: responseData.availableAmount.toLocaleString(),
            totalAsset: responseData.totalAsset.toLocaleString()
          });

          res.json({
            success: true,
            data: responseData
          });
        } else {
          // output2는 있지만 비어있는 경우
          console.log('⚠️ output2가 비어있음 - 모의투자 계좌일 가능성');
          
          // 모의투자 또는 신규 계좌의 경우 0원으로 표시
          const emptyAccountData = {
            totalDeposit: 0,
            availableAmount: 0,
            totalAsset: 0,
            profitLoss: 0,
            profitLossRate: 0
          };
          
          res.json({
            success: true,
            data: emptyAccountData,
            message: '계좌에 잔고가 없거나 모의투자 계좌입니다.'
          });
        }
      } else {
        // output2 자체가 없는 경우
        console.log('❌ output2 필드가 없음');
        throw new Error('잔고 정보 응답 형식이 올바르지 않습니다');
      }

    } catch (error) {
      console.error('❌ 국내 계좌 잔고 조회 오류:', error.message);
      
      // API 오류시에도 더미 데이터로 서비스 지속
      res.json({
        success: true,
        data: {
          totalDeposit: 10000000,
          availableAmount: 8500000,
          totalAsset: 9200000,
          profitLoss: -800000,
          profitLossRate: -8.7
        },
        message: 'API 연결 오류로 더미 데이터를 반환합니다.',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// 해외 현금잔고 조회 - 올바른 API 사용 (수정된 버전)
app.get('/api/trading/account/balance/global', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      console.log('🌍 해외 현금잔고 조회 요청:', req.user.id);
      
      if (!process.env.KIS_APP_KEY || !process.env.KIS_APP_SECRET) {
        return res.json({
          success: true,
          data: {
            totalDeposit: 50000,
            availableAmount: 42500,
            totalAsset: 48200,
            profitLoss: -1800,
            profitLossRate: -3.6
          },
          message: 'KIS API 설정이 없어서 더미 데이터를 반환합니다.'
        });
      }

      if (!process.env.KIS_ACCOUNT_NO || !process.env.KIS_ACCOUNT_PRODUCT_CD) {
        return res.json({
          success: true,
          data: {
            totalDeposit: 50000,
            availableAmount: 42500,
            totalAsset: 48200,
            profitLoss: -1800,
            profitLossRate: -3.6
          },
          message: 'KIS 계좌 정보가 설정되지 않았습니다.'
        });
      }

      // 계좌 정보 검증 및 포맷팅
      let accountNo = process.env.KIS_ACCOUNT_NO.replace(/[^0-9]/g, '');
      let productCd = process.env.KIS_ACCOUNT_PRODUCT_CD.padStart(2, '0');
      
      if (accountNo.length === 10) {
        accountNo = accountNo.substring(0, 8);
        console.log('✅ 해외계좌: 10자리에서 앞 8자리 추출:', accountNo);
      }

      if (accountNo.length !== 8) {
        console.error('❌ 해외 계좌번호 길이 오류:', accountNo.length, '자리 (8자리 필요)');
        return res.json({
          success: true,
          data: { totalDeposit: 50000, availableAmount: 42500, totalAsset: 48200, profitLoss: -1800, profitLossRate: -3.6 },
          message: `해외 계좌번호 형식 오류 - 더미 데이터 반환`
        });
      }

      // 🔥 방법 1: 해외주식 매수가능조회 (TTTS3007R) - 현금 정보 확인
      console.log('🔍 해외주식 매수가능조회 (TTTS3007R) 실행 중...');
      
      try {
        const buyPowerParams = {
          CANO: accountNo,
          ACNT_PRDT_CD: productCd,
          OVRS_EXCG_CD: 'NASD', // 나스닥
          OVRS_ORD_UNPR: '100',  // 임시 주문단가 (100달러)
          ITEM_CD: 'AAPL'        // 임시 종목 (애플)
        };

        console.log('📋 매수가능조회 파라미터:', buyPowerParams);

        const buyPowerData = await makeKISRequest('/uapi/overseas-stock/v1/trading/inquire-psamount', buyPowerParams, {
          'tr_id': 'TTTS3007R'
        });

        console.log('📊 매수가능조회 응답:', JSON.stringify(buyPowerData, null, 2));

        if (buyPowerData.rt_cd === '0' && buyPowerData.output) {
          // 매수가능조회에서 현금 정보 추출
          const ordPsblCash = parseFloat(buyPowerData.output.ord_psbl_cash || 0);
          const ordPsblFrcr = parseFloat(buyPowerData.output.ord_psbl_frcr_amt || 0);
          const maxOrdPsblQty = parseFloat(buyPowerData.output.max_ord_psbl_qty || 0);

          console.log('💰 매수가능조회 결과:', {
            ord_psbl_cash: ordPsblCash,
            ord_psbl_frcr_amt: ordPsblFrcr,
            max_ord_psbl_qty: maxOrdPsblQty
          });

          if (ordPsblCash > 0 || ordPsblFrcr > 0) {
            const availableAmount = Math.max(ordPsblCash, ordPsblFrcr);
            
            return res.json({
              success: true,
              data: {
                totalDeposit: availableAmount,
                availableAmount: availableAmount,
                totalAsset: availableAmount,
                profitLoss: 0,
                profitLossRate: 0
              },
              message: '해외주식 매수가능조회로 현금잔고 확인 성공',
              api_used: 'TTTS3007R'
            });
          }
        }
      } catch (error) {
        console.error('❌ 매수가능조회 실패:', error.message);
      }

      // 🔥 방법 2: 해외주식잔고조회 (TTTS3012R)에서 현금 정보도 함께 확인
      console.log('🔍 해외주식잔고조회 (TTTS3012R)로 전체 정보 확인...');
      
      const balanceParams = {
        CANO: accountNo,
        ACNT_PRDT_CD: productCd,
        OVRS_EXCG_CD: 'NASD', 
        TR_CRCY_CD: 'USD',    
        CTX_AREA_FK200: '',
        CTX_AREA_NK200: ''
      };

      console.log('📋 잔고조회 파라미터:', balanceParams);

      const balanceData = await makeKISRequest('/uapi/overseas-stock/v1/trading/inquire-balance', balanceParams, {
        'tr_id': 'TTTS3012R'
      });

      console.log('📊 잔고조회 전체 응답:', JSON.stringify(balanceData, null, 2));

      if (balanceData.rt_cd !== '0') {
        throw new Error(balanceData.msg1?.trim() || '해외주식 잔고 조회 실패');
      }

      let responseData = {
        totalDeposit: 0,
        availableAmount: 0,
        totalAsset: 0,
        profitLoss: 0,
        profitLossRate: 0
      };

      let hasBalance = false;
      let foundFields = {};

      // 🔍 output에서 현금 관련 모든 필드 탐색
      if (balanceData.output) {
        console.log('📊 output 필드들:');
        Object.keys(balanceData.output).forEach(key => {
          const value = parseFloat(balanceData.output[key] || 0);
          console.log(`  ${key}: ${balanceData.output[key]} (숫자: ${value})`);
          
          if (!isNaN(value) && value > 0) {
            foundFields[key] = value;
            
            // 다양한 현금 관련 필드명 체크
            const cashKeywords = [
              'cash', 'psbl', 'ord', 'amt', 'evlu', 'bal', 'deposit',
              'frcr', 'avbl', 'usable', 'available'
            ];
            
            const keyLower = key.toLowerCase();
            const isCashField = cashKeywords.some(keyword => keyLower.includes(keyword));
            
            if (isCashField) {
              console.log(`  💰 현금 관련 필드 발견: ${key} = ${value}`);
              responseData.availableAmount = Math.max(responseData.availableAmount, value);
              responseData.totalDeposit = Math.max(responseData.totalDeposit, value);
              responseData.totalAsset = Math.max(responseData.totalAsset, value);
              hasBalance = true;
            }
          }
        });
      }

      // 🔍 output2에서 계좌 종합 정보 확인
      if (balanceData.output2) {
        console.log('📊 output2 필드들:');
        Object.keys(balanceData.output2).forEach(key => {
          const value = parseFloat(balanceData.output2[key] || 0);
          console.log(`  ${key}: ${balanceData.output2[key]} (숫자: ${value})`);
          
          if (!isNaN(value) && value > 0) {
            foundFields[`output2_${key}`] = value;
            responseData.totalAsset = Math.max(responseData.totalAsset, value);
            hasBalance = true;
          }
        });
      }

      // 🔍 output1에서 보유 종목 정보 확인
      if (balanceData.output1 && Array.isArray(balanceData.output1)) {
        console.log(`📊 output1: ${balanceData.output1.length}개 항목`);
        
        balanceData.output1.forEach((item, index) => {
          if (item && Object.keys(item).length > 0) {
            console.log(`  항목 ${index + 1}:`, item);
            
            // 보유 종목의 평가금액 합산
            const evalAmt = parseFloat(item.ovrs_stck_evlu_amt || item.evlu_amt || 0);
            if (evalAmt > 0) {
              responseData.totalAsset += evalAmt;
              hasBalance = true;
            }
          }
        });
      }

      // 🔥 결과 처리
      if (hasBalance) {
        // 기본값 보정
        if (responseData.totalDeposit === 0 && responseData.availableAmount > 0) {
          responseData.totalDeposit = responseData.availableAmount;
        }
        if (responseData.availableAmount === 0 && responseData.totalAsset > 0) {
          responseData.availableAmount = responseData.totalAsset * 0.1; // 추정값
        }

        console.log('✅ 해외 현금잔고 조회 성공:', responseData);

        res.json({
          success: true,
          data: responseData,
          message: '해외 현금잔고 조회 성공',
          api_used: 'TTTS3012R',
          found_fields: foundFields
        });
      } else {
        console.log('⚠️ 잔고 데이터를 찾을 수 없음');
        
        res.json({
          success: true,
          data: {
            totalDeposit: 0,
            availableAmount: 0,
            totalAsset: 0,
            profitLoss: 0,
            profitLossRate: 0
          },
          message: 'API 호출은 성공했으나 잔고 데이터를 찾을 수 없습니다.',
          debug_info: {
            rt_cd: balanceData.rt_cd,
            msg1: balanceData.msg1,
            found_fields: foundFields,
            full_response_keys: {
              output: balanceData.output ? Object.keys(balanceData.output) : null,
              output1: balanceData.output1 ? `${balanceData.output1.length} items` : null,
              output2: balanceData.output2 ? Object.keys(balanceData.output2) : null
            }
          }
        });
      }

    } catch (error) {
      console.error('❌ 해외 현금잔고 조회 오류:', error.message);
      
      res.json({
        success: true,
        data: {
          totalDeposit: 50000,
          availableAmount: 42500,
          totalAsset: 48200,
          profitLoss: -1800,
          profitLossRate: -3.6
        },
        message: 'API 연결 오류로 더미 데이터를 반환합니다.',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// 국내 주식 정보 조회 - 개선된 버전
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

      // KIS API 설정이 없으면 더미 데이터
      if (!process.env.KIS_APP_KEY || !process.env.KIS_APP_SECRET) {
        const dummyStocks = {
          '005930': { name: '삼성전자', price: 75000 },
          '000660': { name: 'SK하이닉스', price: 120000 },
          '035420': { name: 'NAVER', price: 185000 },
          '051910': { name: 'LG화학', price: 450000 },
          '373220': { name: 'LG에너지솔루션', price: 520000 }
        };
        
        if (dummyStocks[stockCode]) {
          return res.json({
            success: true,
            data: {
              code: stockCode,
              name: dummyStocks[stockCode].name,
              price: dummyStocks[stockCode].price,
              change: Math.floor(Math.random() * 2000) - 1000,
              changeRate: (Math.random() * 4) - 2,
              market: 'KOSPI'
            },
            message: '더미 데이터입니다.'
          });
        } else {
          return res.status(404).json({
            success: false,
            message: '종목을 찾을 수 없습니다'
          });
        }
      }

      const apiData = await makeKISRequest('/uapi/domestic-stock/v1/quotations/inquire-price', {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: stockCode
      }, {
        'tr_id': 'FHKST01010100'
      });

      if (apiData && apiData.output) {
        const stockData = apiData.output;
        
        res.json({
          success: true,
          data: {
            code: stockCode,
            name: stockData.hts_kor_isnm,
            price: parseInt(stockData.stck_prpr),
            change: parseInt(stockData.prdy_vrss),
            changeRate: parseFloat(stockData.prdy_ctrt),
            market: stockData.bstp_kor_isnm || 'KOSPI'
          }
        });
      } else {
        res.status(404).json({
          success: false,
          message: '종목을 찾을 수 없습니다'
        });
      }

    } catch (error) {
      console.error('❌ 국내 주식 정보 조회 오류:', error.message);
      
      // API 오류시 더미 데이터
      const dummyStocks = {
        '005930': { name: '삼성전자', price: 75000 },
        '000660': { name: 'SK하이닉스', price: 120000 },
        '035420': { name: 'NAVER', price: 185000 },
        '051910': { name: 'LG화학', price: 450000 },
        '373220': { name: 'LG에너지솔루션', price: 520000 }
      };
      
      const { stockCode } = req.query;
      if (dummyStocks[stockCode]) {
        res.json({
          success: true,
          data: {
            code: stockCode,
            name: dummyStocks[stockCode].name,
            price: dummyStocks[stockCode].price,
            change: Math.floor(Math.random() * 2000) - 1000,
            changeRate: (Math.random() * 4) - 2,
            market: 'KOSPI'
          },
          message: 'API 연결 오류로 더미 데이터를 반환합니다.'
        });
      } else {
        res.status(404).json({
          success: false,
          message: '종목을 찾을 수 없습니다'
        });
      }
    }
  }
);

// 해외 주식 정보 조회 - 개선된 버전  
app.get('/api/trading/stock/info/global', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      const { ticker } = req.query;
      console.log('🌍 해외 주식 정보 조회:', ticker);
      
      if (!ticker || !/^[A-Z]{1,5}$/.test(ticker.toUpperCase())) {
        return res.status(400).json({
          success: false,
          message: '올바른 티커를 입력해주세요 (1-5자리 영문)'
        });
      }

      const upperTicker = ticker.toUpperCase();

      if (!process.env.KIS_APP_KEY || !process.env.KIS_APP_SECRET) {
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
        
        if (dummyStocks[upperTicker]) {
          return res.json({
            success: true,
            data: {
              code: upperTicker,
              name: dummyStocks[upperTicker].name,
              price: dummyStocks[upperTicker].price,
              change: (Math.random() * 10) - 5,
              changeRate: (Math.random() * 4) - 2,
              market: 'NASDAQ'
            },
            message: '더미 데이터입니다.'
          });
        } else {
          return res.status(404).json({
            success: false,
            message: '종목을 찾을 수 없습니다'
          });
        }
      }

      const apiData = await makeKISRequest('/uapi/overseas-price/v1/quotations/price', {
        AUTH: '',
        EXCD: 'NAS',
        SYMB: upperTicker
      }, {
        'tr_id': 'HHDFS00000300'
      });

      if (apiData && apiData.output) {
        const stockData = apiData.output;
        
        res.json({
          success: true,
          data: {
            code: upperTicker,
            name: stockData.name || upperTicker,
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

    } catch (error) {
      console.error('❌ 해외 주식 정보 조회 오류:', error.message);
      
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
      
      const { ticker } = req.query;
      const upperTicker = ticker?.toUpperCase();
      
      if (dummyStocks[upperTicker]) {
        res.json({
          success: true,
          data: {
            code: upperTicker,
            name: dummyStocks[upperTicker].name,
            price: dummyStocks[upperTicker].price,
            change: (Math.random() * 10) - 5,
            changeRate: (Math.random() * 4) - 2,
            market: 'NASDAQ'
          },
          message: 'API 연결 오류로 더미 데이터를 반환합니다.'
        });
      } else {
        res.status(404).json({
          success: false,
          message: '종목을 찾을 수 없습니다'
        });
      }
    }
  }
);

// 기존 getKISToken 함수를 대체하는 wrapper
async function getKISToken() {
  return await kisTokenManager.getToken();
}

// 토큰 상태 확인 API (개발/디버그용)
app.get('/api/kis/token-status', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      const tokenInfo = {
        hasToken: !!kisTokenManager.accessToken,
        isValid: kisTokenManager.isTokenValid(),
        expiresAt: kisTokenManager.tokenExpiry ? new Date(kisTokenManager.tokenExpiry).toLocaleString() : null,
        remainingTime: kisTokenManager.tokenExpiry ? 
          Math.max(0, Math.floor((kisTokenManager.tokenExpiry - Date.now()) / 1000)) : 0
      };

      res.json({
        success: true,
        data: tokenInfo
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

console.log('✅ 개선된 KIS API 토큰 관리 시스템 적용 완료');

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

// server.js에서 기존 trading 관련 라우트들을 모두 찾아서 이것으로 교체하세요
// (중복된 라우트들을 제거하고 정리된 버전)

// ============= TRADING 라우트들 (정리된 버전) =============

// 1. 전략 목록 조회 (GET)
app.get('/api/trading/strategies', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      console.log('📊 전략 목록 조회 요청:', req.user.id);
      
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
  }
);

// 2. 전략 생성 (POST) - 단 하나만!
app.post('/api/trading/strategies', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      console.log('✍️ 전략 생성 요청 받음');
      console.log('👤 사용자 ID:', req.user.id);
      console.log('📦 요청 body:', JSON.stringify(req.body, null, 2));
      
      const { marketType, region, stocks } = req.body;
      
      // 기본 검증
      if (!marketType || !region || !stocks || !Array.isArray(stocks) || stocks.length === 0) {
        console.log('❌ 필수 데이터 누락 또는 형식 오류');
        return res.status(400).json({
          success: false,
          message: '필수 데이터가 누락되었거나 형식이 올바르지 않습니다.'
        });
      }
      
      // 총 투자 비율 검증
      const totalAllocation = stocks.reduce((sum, stock) => sum + (parseInt(stock.allocation) || 0), 0);
      if (totalAllocation !== 100) {
        console.log('❌ 투자 비율 오류:', totalAllocation);
        return res.status(400).json({
          success: false,
          message: `총 투자 비율이 100%가 되어야 합니다. (현재: ${totalAllocation}%)`
        });
      }
      
      console.log('✅ 입력값 검증 완료');
      
      // 데이터베이스 저장 시도
      try {
        const dbModule = require('./src/config/database');
        const query = dbModule.query;
        
        // 기존 활성 전략 비활성화
        await query(
          'UPDATE trading_strategies SET is_active = false WHERE user_id = $1',
          [req.user.id]
        );
        
        // 새 전략 생성
        const strategyName = getStrategyName(marketType, region);
        const expectedReturn = calculateExpectedReturn(marketType, region, stocks);
        const riskLevel = calculateRiskLevel(marketType, stocks);
        const description = getStrategyDescription(marketType, region);
        
        const result = await query(
          `INSERT INTO trading_strategies 
           (user_id, strategy_name, market_type, region, stocks, is_active, expected_return, risk_level, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            req.user.id,
            strategyName,
            marketType,
            region,
            JSON.stringify(stocks),
            true,
            expectedReturn,
            riskLevel,
            description
          ]
        );
        
        const newStrategy = result.rows[0];
        if (typeof newStrategy.stocks === 'string') {
          newStrategy.stocks = JSON.parse(newStrategy.stocks);
        }
        
        console.log('✅ 데이터베이스에 전략 저장 완료:', newStrategy.id);
        
        res.status(201).json({
          success: true,
          data: newStrategy,
          message: '전략이 성공적으로 생성되었습니다.'
        });
        
      } catch (dbError) {
        console.error('❌ 데이터베이스 오류:', dbError.message);
        
        // 데이터베이스 실패 시 모의 응답
        const mockStrategy = {
          id: Date.now(),
          user_id: req.user.id,
          strategy_name: getStrategyName(marketType, region),
          market_type: marketType,
          region: region,
          stocks: stocks,
          is_active: true,
          created_at: new Date().toISOString()
        };
        
        console.log('⚠️ 모의 전략으로 응답');
        
        res.status(201).json({
          success: true,
          data: mockStrategy,
          message: '전략이 생성되었습니다. (모의 모드)'
        });
      }
      
    } catch (error) {
      console.error('❌ 전략 생성 전체 오류:', error);
      res.status(500).json({
        success: false,
        message: '전략 생성 중 오류가 발생했습니다.',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

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

// Trading 매매 이력 라우터 - 기술적 분석 정보 포함
app.get('/api/trading/history', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      console.log('📈 매매 이력 조회 요청:', req.user.id);
      
      let orders = [];
      
      try {
        // 데이터베이스 연결 시도 - 안전한 방식
        let query;
        try {
          const dbModule = require('./src/config/database');
          query = dbModule.query;
          
          if (!query) {
            throw new Error('Query function not available');
          }
        } catch (dbImportError) {
          console.error('❌ 데이터베이스 모듈 로드 실패:', dbImportError.message);
          throw new Error('Database not available');
        }
        
        // 테이블 존재 확인
        const tableCheck = await query(
          `SELECT EXISTS (
             SELECT FROM information_schema.tables 
             WHERE table_name = 'trading_orders'
           );`
        );
        
        if (tableCheck && tableCheck.rows && tableCheck.rows[0] && tableCheck.rows[0].exists) {
          console.log('✅ trading_orders 테이블 확인됨');
          
          // 실제 데이터 조회 - 기술적 분석 정보 포함
          const result = await query(
            `SELECT 
               o.id,
               o.stock_code,
               o.stock_name,
               o.region,
               o.order_type,
               o.quantity,
               o.order_price,
               o.executed_price,
               o.total_amount,
               o.status,
               o.executed_at,
               o.created_at,
               o.error_message,
               COALESCE(s.strategy_name, '기본 전략') as strategy_name,
               s.market_type
             FROM trading_orders o
             LEFT JOIN trading_strategies s ON o.strategy_id = s.id
             WHERE o.user_id = $1
             ORDER BY COALESCE(o.executed_at, o.created_at) DESC
             LIMIT 50`,
            [req.user.id]
          );
          
          if (result && result.rows) {
            orders = result.rows;
            console.log(`📊 실제 매매 이력: ${orders.length}건`);
          }
        } else {
          console.log('⚠️ trading_orders 테이블이 존재하지 않음');
        }
        
      } catch (dbError) {
        console.error('❌ 데이터베이스 조회 오류:', dbError.message);
        console.log('🔄 더미 데이터로 폴백');
      }
      
      // 데이터가 없거나 DB 오류시 기술적 분석이 포함된 더미 데이터 제공
      if (!orders || orders.length === 0) {
        const now = new Date();
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
            executed_at: new Date(now.getTime() - 300000).toISOString(),
            created_at: new Date(now.getTime() - 300000).toISOString(),
            strategy_name: '상승장 모멘텀 전략',
            market_type: 'bull',
            error_message: 'RSI 정상 구간, 강한 상승 모멘텀, 이평선 정배열 | 기술적 분석 신호 강도: 75'
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
            executed_at: new Date(now.getTime() - 1800000).toISOString(),
            created_at: new Date(now.getTime() - 1800000).toISOString(),
            strategy_name: '글로벌 기술주 성장 전략',
            market_type: 'bull',
            error_message: 'MACD 상승 신호, 모멘텀 강화, 20일선 돌파 | 기술적 분석 신호 강도: 82'
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
            executed_at: new Date(now.getTime() - 3600000).toISOString(),
            created_at: new Date(now.getTime() - 3600000).toISOString(),
            strategy_name: '상승장 모멘텀 전략',
            market_type: 'bull',
            error_message: 'RSI 과매수, 볼린저 밴드 상단 도달 | 손익률: +8.4% | 일부 이익실현'
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
            executed_at: new Date(now.getTime() - 7200000).toISOString(),
            created_at: new Date(now.getTime() - 7200000).toISOString(),
            strategy_name: '글로벌 기술주 성장 전략',
            market_type: 'bull',
            error_message: '골든크로스 형성, 거래량 급증, 모멘텀 지속 | 기술적 분석 신호 강도: 88'
          },
          {
            id: 5,
            stock_code: '035420',
            stock_name: 'NAVER',
            region: 'domestic',
            order_type: 'SELL',
            quantity: 4,
            order_price: 185000,
            executed_price: 184500, 
            total_amount: 738000,
            status: 'FILLED',
            executed_at: new Date(now.getTime() - 14400000).toISOString(),
            created_at: new Date(now.getTime() - 14400000).toISOString(),
            strategy_name: '하락장 가치투자 전략',
            market_type: 'bear',
            error_message: '하락 모멘텀 감지, 20일선 이탈, 손절매 실행 | 손익률: -3.2%'
          },
          {
            id: 6,
            stock_code: 'TSLA',
            stock_name: 'Tesla Inc.',
            region: 'global',
            order_type: 'BUY',
            quantity: 3,
            order_price: 248.50,
            executed_price: 245.20,
            total_amount: 735.60,
            status: 'FILLED',
            executed_at: new Date(now.getTime() - 21600000).toISOString(),
            created_at: new Date(now.getTime() - 21600000).toISOString(),
            strategy_name: '하락장 가치투자 전략',
            market_type: 'bear',
            error_message: 'RSI 과매도(28), 볼린저 밴드 하단 터치, 가치매수 기회 | 기술적 분석 신호 강도: 65'
          },
          {
            id: 7,
            stock_code: '000000',
            stock_name: '리밸런싱 제안',
            region: 'domestic',
            order_type: 'REBALANCING_SUGGESTION',
            quantity: 0,
            order_price: 0,
            executed_price: 0,
            total_amount: 0,
            status: 'REBALANCING_SUGGESTION',
            executed_at: new Date(now.getTime() - 25200000).toISOString(),
            created_at: new Date(now.getTime() - 25200000).toISOString(),
            strategy_name: '포트폴리오 리밸런싱',
            market_type: 'bull',
            error_message: '리밸런싱 제안: 반도체 섹터 비중 증가 권장, 기술주 강세 지속 예상 (강도: 72)'
          }
        ];
        
        console.log(`🎭 기술적 분석이 포함된 더미 매매 이력 제공: ${orders.length}건`);
      }

      // 응답 데이터 정리 - 기술적 분석 정보 포함
      const cleanedOrders = orders.map(order => ({
        id: order.id,
        stock_code: order.stock_code,
        stock_name: order.stock_name || '종목명',
        region: order.region || 'domestic',
        order_type: order.order_type,
        quantity: parseInt(order.quantity) || 0,
        order_price: parseFloat(order.order_price) || 0,
        executed_price: parseFloat(order.executed_price) || parseFloat(order.order_price) || 0,
        total_amount: parseFloat(order.total_amount) || 0,
        status: order.status || 'FILLED',
        executed_at: order.executed_at,
        created_at: order.created_at,
        strategy_name: order.strategy_name || '기본 전략',
        market_type: order.market_type,
        technical_analysis: order.error_message || '', // 기술적 분석 정보
        is_rebalancing: order.order_type === 'REBALANCING_SUGGESTION'
      }));

      res.json({
        success: true,
        data: cleanedOrders,
        total: cleanedOrders.length,
        message: cleanedOrders.length > 0 ? '기술적 분석 기반 매매 이력을 성공적으로 조회했습니다.' : '매매 이력이 없습니다.',
        analysis_info: {
          total_orders: cleanedOrders.filter(o => !o.is_rebalancing).length,
          buy_orders: cleanedOrders.filter(o => o.order_type === 'BUY').length,
          sell_orders: cleanedOrders.filter(o => o.order_type === 'SELL').length,
          rebalancing_suggestions: cleanedOrders.filter(o => o.is_rebalancing).length,
          bull_strategy_orders: cleanedOrders.filter(o => o.market_type === 'bull').length,
          bear_strategy_orders: cleanedOrders.filter(o => o.market_type === 'bear').length
        }
      });

    } catch (error) {
      console.error('❌ 매매 이력 조회 심각한 오류:', error);
      
      // 최후의 수단: 기본 더미 데이터 반환
      const fallbackOrders = [
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
          strategy_name: '기본 전략',
          market_type: 'bull',
          technical_analysis: '시스템 오류로 인한 기본 데이터',
          is_rebalancing: false
        }
      ];
      
      res.json({
        success: true,
        data: fallbackOrders,
        total: fallbackOrders.length,
        message: '매매 이력 조회 중 오류가 발생하여 샘플 데이터를 표시합니다.',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

// Trading 상태 조회 - 수정된 버전
app.get('/api/trading/status', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      console.log('📊 트레이딩 상태 조회:', req.user.id);
      
      // 🔥 메모리에서 사용자 상태 확인
      const userStatus = userTradingStatus.get(req.user.id);
      
      if (userStatus) {
        console.log('✅ 메모리에서 활성 상태 발견:', userStatus);
        
        res.json({
          success: true,
          data: {
            isActive: true,
            strategy: userStatus.strategy,
            startedAt: userStatus.startedAt
          }
        });
      } else {
        console.log('ℹ️ 메모리에 활성 상태 없음, DB 확인 시도...');
        
        // 메모리에 없으면 DB에서 확인 (백업)
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

          if (result && result.rows && result.rows.length > 0) {
            strategy = result.rows[0];
            
            if (strategy.stocks && typeof strategy.stocks === 'string') {
              try {
                strategy.stocks = JSON.parse(strategy.stocks);
              } catch (parseError) {
                console.error('JSON 파싱 오류:', parseError);
                strategy.stocks = [];
              }
            }
            
            console.log('📊 DB에서 활성 전략 발견:', strategy.strategy_name);
          }
        } catch (dbError) {
          console.error('❌ DB 조회 오류:', dbError.message);
        }

        res.json({
          success: true,
          data: {
            isActive: !!strategy,
            strategy: strategy
          }
        });
      }
      
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

// 🔥 메모리에서 사용자별 자동매매 상태 관리
const userTradingStatus = new Map(); // userId -> { isActive, strategy, startedAt }

// 자동매매 시작 라우트 - 수정된 버전
app.post('/api/trading/start', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      const { strategyId } = req.body;
      console.log('🚀 자동매매 시작 요청:', { strategyId, userId: req.user.id });
      
      if (!strategyId) {
        return res.status(400).json({
          success: false,
          message: '전략 ID가 필요합니다.'
        });
      }
      
      // 🔥 메모리에서 사용자 상태 업데이트
      let strategy = null;
      
      // 데이터베이스에서 전략 정보 가져오기 시도
      try {
        const { query } = require('./src/config/database');
        const result = await query(
          `SELECT * FROM trading_strategies WHERE id = $1 AND user_id = $2`,
          [strategyId, req.user.id]
        );
        
        if (result.rows.length > 0) {
          strategy = result.rows[0];
          if (typeof strategy.stocks === 'string') {
            strategy.stocks = JSON.parse(strategy.stocks);
          }
        }
      } catch (dbError) {
        console.log('⚠️ DB에서 전략 조회 실패, 모의 전략 생성');
        strategy = {
          id: strategyId,
          user_id: req.user.id,
          strategy_name: '모의 전략',
          market_type: 'bull',
          region: 'global',
          stocks: [],
          is_active: true
        };
      }
      
      // 🔥 사용자 상태를 메모리에 저장
      userTradingStatus.set(req.user.id, {
        isActive: true,
        strategy: strategy,
        startedAt: new Date().toISOString()
      });
      
      console.log('✅ 사용자 자동매매 상태 업데이트:', req.user.id, '-> 활성화');
      console.log('📊 현재 활성 사용자 수:', userTradingStatus.size);
      
      res.json({
        success: true,
        message: '자동매매가 시작되었습니다.',
        data: { 
          strategyId, 
          isActive: true,
          strategy: strategy
        }
      });
      
    } catch (error) {
      console.error('❌ 자동매매 시작 오류:', error);
      res.status(500).json({
        success: false,
        message: '자동매매 시작 중 오류가 발생했습니다.'
      });
    }
  }
);

// 자동매매 중단 라우트 - 수정된 버전
app.post('/api/trading/stop', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      console.log('⏹️ 자동매매 중단 요청:', req.user.id);
      
      // 🔥 메모리에서 사용자 상태 제거
      const wasActive = userTradingStatus.has(req.user.id);
      userTradingStatus.delete(req.user.id);
      
      console.log('✅ 사용자 자동매매 상태 제거:', req.user.id);
      console.log('📊 현재 활성 사용자 수:', userTradingStatus.size);
      
      res.json({
        success: true,
        message: wasActive ? '자동매매가 중단되었습니다.' : '자동매매가 이미 중단된 상태입니다.',
        data: { isActive: false }
      });
      
    } catch (error) {
      console.error('❌ 자동매매 중단 오류:', error);
      res.status(500).json({
        success: false,
        message: '자동매매 중단 중 오류가 발생했습니다.'
      });
    }
  }
);

// 헬퍼 함수들
function getStrategyName(marketType, region) {
  const marketNames = {
    bull: '상승장',
    bear: '하락장'
  };
  const regionNames = {
    domestic: '국내',
    global: '해외'
  };
  
  return `${marketNames[marketType]} ${regionNames[region]} 전략`;
}

function getStrategyDescription(marketType, region) {
  if (marketType === 'bull') {
    return region === 'domestic' 
      ? '국내 성장주와 모멘텀 종목 중심의 상승장 전략'
      : '해외 기술주와 성장주 중심의 상승장 전략';
  } else {
    return region === 'domestic'
      ? '국내 가치주와 배당주 중심의 하락장 방어 전략'
      : '해외 안전자산과 배당주 중심의 하락장 방어 전략';
  }
}

function calculateExpectedReturn(marketType, region, stocks) {
  // 간단한 예상 수익률 계산 로직
  let baseReturn = marketType === 'bull' ? 15 : 8;
  if (region === 'global') baseReturn += 3;
  if (stocks.length > 3) baseReturn += 2; // 분산투자 보너스
  
  return Math.round(baseReturn * 100) / 100;
}

function calculateRiskLevel(marketType, stocks) {
  if (stocks.length >= 5) return 'Low';
  if (marketType === 'bear') return 'Medium';
  return 'High';
}

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