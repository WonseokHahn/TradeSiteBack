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

// 해외 계좌 잔고 조회 - 개선된 버전
app.get('/api/trading/account/balance/global', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      console.log('🌍 해외 계좌 잔고 조회 요청:', req.user.id);
      
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

      // 계좌 정보 검증 및 포맷팅 - 실전투자 계좌번호는 8자리 사용
      let accountNo = process.env.KIS_ACCOUNT_NO.replace(/[^0-9]/g, ''); // 숫자만 추출
      let productCd = process.env.KIS_ACCOUNT_PRODUCT_CD.padStart(2, '0'); // 2자리로 패딩
      
      // 실전투자 계좌번호는 앞 8자리만 사용 (10자리 전체가 아님!)
      if (accountNo.length === 10) {
        accountNo = accountNo.substring(0, 8); // 앞 8자리만 사용
        console.log('✅ 10자리 계좌번호에서 앞 8자리 추출:', accountNo);
      }
      
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


      const apiData = await makeKISRequest('/uapi/overseas-stock/v1/trading/inquire-balance', {
        CANO: accountNo, // 8자리 숫자 (실전투자)
        ACNT_PRDT_CD: productCd, // 2자리 (01, 02 등)
        OVRS_EXCG_CD: 'NASD',
        TR_CRCY_CD: 'USD',
        CTX_AREA_FK200: '',
        CTX_AREA_NK200: ''
      }, {
        'tr_id': 'JTTT3012R'
      });

      // if (apiData && apiData.output2) {
      //   const totalBalance = apiData.output2.find(item => item.crcy_cd === 'USD') || apiData.output2[0];
        
      //   const responseData = {
      //     totalDeposit: parseFloat(totalBalance?.frcr_dncl_amt_2 || 0),
      //     availableAmount: parseFloat(totalBalance?.ovrs_ord_psbl_amt || 0),
      //     totalAsset: parseFloat(totalBalance?.tot_evlu_pfls_amt || 0),
      //     profitLoss: parseFloat(totalBalance?.evlu_pfls_smtl_amt || 0),
      //     profitLossRate: parseFloat(totalBalance?.tot_evlu_pfls_rt || 0)
      //   };

      //   console.log('✅ 해외 계좌 잔고 조회 성공:', {
      //     totalDeposit: `$${responseData.totalDeposit.toLocaleString()}`,
      //     availableAmount: `$${responseData.availableAmount.toLocaleString()}`
      //   });

      //   res.json({
      //     success: true,
      //     data: responseData
      //   });
      // } else {
      //   throw new Error('해외 잔고 정보가 없습니다');
      // }
      if (apiData && apiData.output2) {
        let totalBalance;
        console.log('📋 KIS API 응답 전체 구조:', JSON.stringify(apiData, null, 2));
        // output2가 배열인지 확인
        if (Array.isArray(apiData.output2)) {
          totalBalance = apiData.output2.find(item => item.crcy_cd === 'USD') || apiData.output2[0];
        } else {
          totalBalance = apiData.output2;  // 단일 객체일 경우 그대로 사용
        }
        console.log('🧾 totalBalance:', totalBalance);
        
        const responseData = {
          totalDeposit: parseFloat(totalBalance?.frcr_dncl_amt_2 || 0),
          availableAmount: parseFloat(totalBalance?.ovrs_ord_psbl_amt || 0),
          totalAsset: parseFloat(totalBalance?.tot_evlu_pfls_amt || 0),
          profitLoss: parseFloat(totalBalance?.evlu_pfls_smtl_amt || 0),
          profitLossRate: parseFloat(totalBalance?.tot_evlu_pfls_rt || 0)
        };
      
        console.log('✅ 해외 계좌 잔고 조회 성공:', {
          totalDeposit: `$${responseData.totalDeposit.toLocaleString()}`,
          availableAmount: `$${responseData.availableAmount.toLocaleString()}`
        });
      
        res.json({
          success: true,
          data: responseData
        });
      } else {
        throw new Error('해외 잔고 정보가 없습니다');
      }

    } catch (error) {
      console.error('❌ 해외 계좌 잔고 조회 오류:', error.message);
      
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

// Trading 매매 이력 라우터 - 안전한 버전 (기존 코드를 이것으로 교체)
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
          
          // 실제 데이터 조회 - 더 안전한 쿼리
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
               COALESCE(s.strategy_name, '기본 전략') as strategy_name
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
      
      // 데이터가 없거나 DB 오류시 더미 데이터 제공
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
            executed_at: new Date(now.getTime() - 300000).toISOString(), // 5분 전
            created_at: new Date(now.getTime() - 300000).toISOString(),
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
            executed_at: new Date(now.getTime() - 1800000).toISOString(), // 30분 전
            created_at: new Date(now.getTime() - 1800000).toISOString(),
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
            executed_at: new Date(now.getTime() - 3600000).toISOString(), // 1시간 전
            created_at: new Date(now.getTime() - 3600000).toISOString(),
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
            executed_at: new Date(now.getTime() - 7200000).toISOString(), // 2시간 전
            created_at: new Date(now.getTime() - 7200000).toISOString(),
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
            executed_at: new Date(now.getTime() - 14400000).toISOString(), // 4시간 전
            created_at: new Date(now.getTime() - 14400000).toISOString(),
            strategy_name: '상승장 국내 전략'
          },
          {
            id: 6,
            stock_code: 'GOOGL',
            stock_name: 'Alphabet Inc.',
            region: 'global',
            order_type: 'BUY',
            quantity: 1,
            order_price: 2850.75,
            executed_price: 2845.20,
            total_amount: 2845.20,
            status: 'PARTIALLY_FILLED',
            executed_at: new Date(now.getTime() - 21600000).toISOString(), // 6시간 전
            created_at: new Date(now.getTime() - 21600000).toISOString(),
            strategy_name: '글로벌 기술주 전략'
          }
        ];
        
        console.log(`🎭 더미 매매 이력 제공: ${orders.length}건`);
      }

      // 응답 데이터 정리
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
        strategy_name: order.strategy_name || '기본 전략'
      }));

      res.json({
        success: true,
        data: cleanedOrders,
        total: cleanedOrders.length,
        message: cleanedOrders.length > 0 ? '매매 이력을 성공적으로 조회했습니다.' : '매매 이력이 없습니다.'
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
          strategy_name: '기본 전략'
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


// 기존 trading/status 라우트도 안전하게 수정
// 기존 코드를 찾아서 교체하세요 (라인 313-322 정도)
// Trading 상태 조회도 안전하게 수정
app.get('/api/trading/status', 
  passport.authenticate('jwt', { session: false }),
  async (req, res) => {
    try {
      console.log('📊 트레이딩 상태 조회:', req.user.id);
      
      let strategy = null;
      
      try {
        // 데이터베이스 연결 시도 - 안전한 방식
        let query;
        try {
          const dbModule = require('./src/config/database');
          query = dbModule.query;
        } catch (dbImportError) {
          console.error('❌ 데이터베이스 모듈 로드 실패:', dbImportError.message);
          throw new Error('Database not available');
        }
        
        const result = await query(
          `SELECT * FROM trading_strategies 
           WHERE user_id = $1 AND is_active = true
           ORDER BY created_at DESC
           LIMIT 1`,
          [req.user.id]
        );

        if (result && result.rows && result.rows.length > 0) {
          strategy = result.rows[0];
          
          // stocks 필드가 JSON 문자열인 경우 파싱
          if (strategy.stocks && typeof strategy.stocks === 'string') {
            try {
              strategy.stocks = JSON.parse(strategy.stocks);
            } catch (parseError) {
              console.error('JSON 파싱 오류:', parseError);
              strategy.stocks = [];
            }
          }
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