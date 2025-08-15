const axios = require('axios');

class KISMarketTimeService {
  constructor() {
    this.KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';
    this.marketStatusCache = new Map();
    this.cacheExpiry = 60 * 1000; // 1분 캐시
  }

  // KIS 토큰 가져오기 (기존 토큰 매니저 활용)
  async getKISToken() {
    try {
      // server.js의 kisTokenManager 사용
      if (typeof kisTokenManager !== 'undefined') {
        return await kisTokenManager.getToken();
      }
      
      // 직접 토큰 요청
      const response = await axios.post(`${this.KIS_BASE_URL}/oauth2/tokenP`, {
        grant_type: 'client_credentials',
        appkey: process.env.KIS_APP_KEY,
        appsecret: process.env.KIS_APP_SECRET
      });

      if (response.data && response.data.access_token) {
        return response.data.access_token;
      }
      
      throw new Error('토큰 획득 실패');
    } catch (error) {
      console.error('❌ KIS 토큰 획득 실패:', error.message);
      throw error;
    }
  }

  // 국내 시장 상태 확인 (KIS API)
  async checkKoreanMarketStatus() {
    try {
      console.log('🔍 KIS API로 국내 시장 상태 확인 중...');
      
      const token = await this.getKISToken();
      
      // 국내 시장 운영 시간 조회 API (FHKST66910000)
      const response = await axios.get(`${this.KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'appkey': process.env.KIS_APP_KEY,
          'appsecret': process.env.KIS_APP_SECRET,
          'tr_id': 'FHKST66910000',
          'custtype': 'P'
        },
        params: {
          FID_COND_MRKT_DIV_CODE: 'J',
          FID_INPUT_ISCD: '005930', // 삼성전자로 테스트
          FID_INPUT_DATE_1: '', // 현재 날짜
          FID_INPUT_DATE_2: '',
          FID_PERIOD_DIV_CODE: 'D'
        }
      });

      console.log('📊 KIS 국내 시장 응답:', response.data.rt_cd, response.data.msg1);
      
      if (response.data.rt_cd === '0') {
        // 성공적으로 데이터를 받았으면 시장이 열려있음
        return {
          isOpen: true,
          marketType: 'domestic',
          status: 'OPEN',
          message: '한국 시장 정규장 운영 중',
          checkedAt: new Date().toISOString(),
          source: 'KIS_API'
        };
      } else {
        // 데이터를 받지 못했으면 시장이 닫혀있거나 오류
        return {
          isOpen: false,
          marketType: 'domestic', 
          status: 'CLOSED',
          message: response.data.msg1 || '한국 시장 마감',
          checkedAt: new Date().toISOString(),
          source: 'KIS_API'
        };
      }

    } catch (error) {
      console.error('❌ KIS 국내 시장 상태 확인 실패:', error.message);
      
      // API 실패 시 시간 기반 추정
      return this.fallbackKoreanMarketCheck();
    }
  }

  // 해외 시장 상태 확인 (KIS API)
  async checkGlobalMarketStatus() {
    try {
      console.log('🔍 KIS API로 해외 시장 상태 확인 중...');
      
      const token = await this.getKISToken();
      
      // 해외 시장 현재가 조회로 시장 상태 확인
      const response = await axios.get(`${this.KIS_BASE_URL}/uapi/overseas-price/v1/quotations/price`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'appkey': process.env.KIS_APP_KEY,
          'appsecret': process.env.KIS_APP_SECRET,
          'tr_id': 'HHDFS00000300'
        },
        params: {
          AUTH: '',
          EXCD: 'NAS', // NASDAQ
          SYMB: 'AAPL' // 애플로 테스트
        }
      });

      console.log('📊 KIS 해외 시장 응답:', response.data.rt_cd, response.data.msg1);
      
      if (response.data.rt_cd === '0' && response.data.output) {
        const output = response.data.output;
        
        // 시장 상태 확인 (실제 거래가 이루어지고 있는지)
        // KIS API에서 제공하는 시장 상태 필드 확인
        const marketStatus = output.mket_stat || output.market_status;
        
        if (marketStatus === 'OPEN' || marketStatus === '1' || !marketStatus) {
          // 명시적으로 OPEN이거나, 데이터가 정상적으로 오면 열린 것으로 판단
          return {
            isOpen: true,
            marketType: 'global',
            status: 'OPEN',
            message: '미국 시장 정규장 운영 중',
            checkedAt: new Date().toISOString(),
            source: 'KIS_API',
            lastPrice: output.last || 0
          };
        } else {
          return {
            isOpen: false,
            marketType: 'global',
            status: 'CLOSED',
            message: '미국 시장 마감',
            checkedAt: new Date().toISOString(),
            source: 'KIS_API'
          };
        }
      } else {
        return {
          isOpen: false,
          marketType: 'global',
          status: 'CLOSED',
          message: response.data.msg1 || '미국 시장 마감 또는 API 오류',
          checkedAt: new Date().toISOString(),
          source: 'KIS_API'
        };
      }

    } catch (error) {
      console.error('❌ KIS 해외 시장 상태 확인 실패:', error.message);
      
      // API 실패 시 시간 기반 추정
      return this.fallbackGlobalMarketCheck();
    }
  }

  // 국내 시장 상태 체크 (KIS API 실패 시 백업)
  fallbackKoreanMarketCheck() {
    const now = new Date();
    const koreanTime = new Date(now.getTime() + (9 * 60 * 60 * 1000)); // UTC+9
    const dayOfWeek = koreanTime.getDay();
    const hours = koreanTime.getHours();
    const minutes = koreanTime.getMinutes();
    const currentTime = hours * 100 + minutes;

    console.log('⚠️ KIS API 실패 - 시간 기반 국내 시장 추정:', {
      현재시간: koreanTime.toLocaleString('ko-KR'),
      요일: dayOfWeek,
      시각: currentTime
    });

    // 주말
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return {
        isOpen: false,
        marketType: 'domestic',
        status: 'WEEKEND',
        message: '주말 - 한국 시장 마감',
        checkedAt: new Date().toISOString(),
        source: 'FALLBACK_TIME'
      };
    }

    // 정규 장시간 체크 (09:00-15:30, 점심시간 12:00-13:00 제외)
    const isMarketHours = (currentTime >= 900 && currentTime < 1200) || 
                         (currentTime >= 1300 && currentTime < 1530);

    return {
      isOpen: isMarketHours,
      marketType: 'domestic',
      status: isMarketHours ? 'OPEN' : 'CLOSED',
      message: isMarketHours ? '한국 시장 정규장 시간 (추정)' : '한국 시장 마감 시간 (추정)',
      checkedAt: new Date().toISOString(),
      source: 'FALLBACK_TIME'
    };
  }

  // 해외 시장 상태 체크 (KIS API 실패 시 백업)
  fallbackGlobalMarketCheck() {
    const now = new Date();
    const easternTime = new Date(now.getTime() - (5 * 60 * 60 * 1000)); // UTC-5 (단순화)
    const dayOfWeek = easternTime.getDay();
    const hours = easternTime.getHours();
    const minutes = easternTime.getMinutes();
    const currentTime = hours * 100 + minutes;

    console.log('⚠️ KIS API 실패 - 시간 기반 해외 시장 추정:', {
      현재시간: easternTime.toLocaleString('en-US'),
      요일: dayOfWeek,
      시각: currentTime
    });

    // 주말
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return {
        isOpen: false,
        marketType: 'global',
        status: 'WEEKEND',
        message: '주말 - 미국 시장 마감',
        checkedAt: new Date().toISOString(),
        source: 'FALLBACK_TIME'
      };
    }

    // 정규 장시간 체크 (09:30-16:00)
    const isMarketHours = currentTime >= 930 && currentTime < 1600;

    return {
      isOpen: isMarketHours,
      marketType: 'global',
      status: isMarketHours ? 'OPEN' : 'CLOSED',
      message: isMarketHours ? '미국 시장 정규장 시간 (추정)' : '미국 시장 마감 시간 (추정)',
      checkedAt: new Date().toISOString(),
      source: 'FALLBACK_TIME'
    };
  }

  // 메인 시장 상태 확인 메서드
  async getMarketStatus(region) {
    try {
      // 캐시 확인
      const cacheKey = region;
      const cachedData = this.marketStatusCache.get(cacheKey);
      
      if (cachedData && Date.now() - cachedData.timestamp < this.cacheExpiry) {
        console.log('📋 캐시된 시장 상태 사용:', region);
        return cachedData.data;
      }

      // 실제 API 호출
      let marketStatus;
      if (region === 'domestic') {
        marketStatus = await this.checkKoreanMarketStatus();
      } else if (region === 'global') {
        marketStatus = await this.checkGlobalMarketStatus();
      } else {
        throw new Error('알 수 없는 지역: ' + region);
      }

      // 캐시에 저장
      this.marketStatusCache.set(cacheKey, {
        data: marketStatus,
        timestamp: Date.now()
      });

      console.log('✅ 시장 상태 확인 완료:', marketStatus);
      return marketStatus;

    } catch (error) {
      console.error('❌ 시장 상태 확인 전체 오류:', error);
      
      // 최종 백업 - 항상 마감으로 처리
      return {
        isOpen: false,
        marketType: region,
        status: 'ERROR',
        message: 'API 오류로 인한 시장 상태 확인 실패',
        checkedAt: new Date().toISOString(),
        source: 'ERROR',
        error: error.message
      };
    }
  }

  // 자동매매 실행 가능 여부 확인
  async canExecuteTrading(region) {
    const marketStatus = await this.getMarketStatus(region);
    
    return {
      canExecute: marketStatus.isOpen,
      marketStatus: marketStatus,
      statusText: this.getStatusText(marketStatus)
    };
  }

  // 상태 텍스트 생성
  getStatusText(marketStatus) {
    const marketName = marketStatus.marketType === 'domestic' ? '한국 시장' : '미국 시장';
    const statusIcon = marketStatus.isOpen ? '🟢' : '🔴';
    const sourceText = marketStatus.source === 'KIS_API' ? ' (실시간)' : 
                      marketStatus.source === 'FALLBACK_TIME' ? ' (추정)' : ' (오류)';
    
    return `${statusIcon} ${marketName}: ${marketStatus.message}${sourceText}`;
  }

  // 캐시 클리어
  clearCache() {
    this.marketStatusCache.clear();
    console.log('🗑️ 시장 상태 캐시 클리어');
  }
}

module.exports = new KISMarketTimeService();