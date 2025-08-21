// src/services/kisService.js
const axios = require('axios');

class KISService {
  constructor() {
    this.baseURL = 'https://openapi.koreainvestment.com:9443';
    this.appKey = process.env.KIS_APP_KEY;
    this.appSecret = process.env.KIS_APP_SECRET;
    this.accountNo = process.env.KIS_ACCOUNT_NO;
    this.accountProductCd = process.env.KIS_ACCOUNT_PRODUCT_CD;
    this.accessToken = null;
    this.tokenExpiry = null;
    this.lastTokenRequest = null; // 마지막 토큰 요청 시간
  }

  // 접근 토큰 발급 (1분 제한 적용)
  async getAccessToken() {
    try {
      const now = Date.now();
      
      // 기존 토큰이 유효하면 재사용
      if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
        return this.accessToken;
      }

      // 1분 제한 확인
      if (this.lastTokenRequest && (now - this.lastTokenRequest) < 60000) {
        const waitTime = 60000 - (now - this.lastTokenRequest);
        console.log(`⏰ KIS 토큰 발급 제한으로 ${Math.ceil(waitTime/1000)}초 대기 중...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      this.lastTokenRequest = now;

      const response = await axios.post(`${this.baseURL}/oauth2/tokenP`, {
        grant_type: 'client_credentials',
        appkey: this.appKey,
        appsecret: this.appSecret
      }, {
        headers: {
          'content-type': 'application/json'
        },
        timeout: 10000
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiry = new Date(Date.now() + (response.data.expires_in * 1000));
      
      console.log('✅ KIS 액세스 토큰 발급 완료');
      return this.accessToken;
    } catch (error) {
      console.error('❌ KIS 토큰 발급 실패:', error.response?.data || error.message);
      
      // 토큰 발급 실패시 모의 토큰 반환 (개발용)
      if (process.env.NODE_ENV === 'development') {
        console.log('🔧 개발 모드: 모의 토큰 사용');
        this.accessToken = 'mock_token_for_development';
        this.tokenExpiry = new Date(Date.now() + 3600000); // 1시간 후 만료
        return this.accessToken;
      }
      
      throw new Error('한국투자증권 인증에 실패했습니다.');
    }
  }

  // API 요청 공통 헤더
  async getHeaders(trId) {
    const token = await this.getAccessToken();
    return {
      'content-type': 'application/json; charset=utf-8',
      'authorization': `Bearer ${token}`,
      'appkey': this.appKey,
      'appsecret': this.appSecret,
      'tr_id': trId,
      'custtype': 'P'
    };
  }

  // 계좌잔고 조회 (모의 데이터 포함)
  async getAccountBalance() {
    try {
      // 개발 모드에서는 모의 데이터 즉시 반환
      if (process.env.NODE_ENV === 'development' || !this.appKey) {
        return this.getMockAccountBalance();
      }

      const headers = await this.getHeaders('TTTC8434R');
      
      const response = await axios.get(`${this.baseURL}/uapi/domestic-stock/v1/trading/inquire-balance`, {
        headers,
        params: {
          CANO: this.accountNo,
          ACNT_PRDT_CD: this.accountProductCd,
          AFHR_FLPR_YN: 'N',
          OFL_YN: '',
          INQR_DVSN: '02',
          UNPR_DVSN: '01',
          FUND_STTL_ICLD_YN: 'N',
          FNCG_AMT_AUTO_RDPT_YN: 'N',
          PRCS_DVSN: '01',
          CTX_AREA_FK100: '',
          CTX_AREA_NK100: ''
        },
        timeout: 10000
      });

      if (!response.data.output2 || !response.data.output2[0]) {
        console.log('⚠️ KIS API 응답 구조 이상, 모의 데이터 사용');
        return this.getMockAccountBalance();
      }

      const result = response.data.output1;
      const summary = response.data.output2[0];

      return {
        success: true,
        data: {
          totalAssets: parseInt(summary.tot_evlu_amt || 0),
          availableCash: parseInt(summary.dnca_tot_amt || 0),
          stockValue: parseInt(summary.scts_evlu_amt || 0),
          profitLoss: parseInt(summary.evlu_pfls_smtl_amt || 0),
          profitRate: parseFloat(summary.evlu_erng_rt || 0),
          holdings: result ? result.map(stock => ({
            stockCode: stock.pdno,
            stockName: stock.prdt_name,
            quantity: parseInt(stock.hldg_qty),
            avgPrice: parseFloat(stock.pchs_avg_pric),
            currentPrice: parseFloat(stock.prpr),
            evaluationAmount: parseInt(stock.evlu_amt),
            profitLoss: parseInt(stock.evlu_pfls_amt),
            profitRate: parseFloat(stock.evlu_pfls_rt)
          })) : []
        }
      };
    } catch (error) {
      console.error('❌ 계좌잔고 조회 실패:', error.response?.data || error.message);
      console.log('🔧 모의 데이터로 대체합니다.');
      return this.getMockAccountBalance();
    }
  }

  // 모의 계좌 잔고 데이터
  getMockAccountBalance() {
    return {
      success: true,
      data: {
        totalAssets: 10000000, // 1천만원
        availableCash: 5000000, // 5백만원
        stockValue: 5000000,   // 5백만원
        profitLoss: 500000,    // 50만원 수익
        profitRate: 5.0,       // 5% 수익률
        holdings: [
          {
            stockCode: '005930',
            stockName: '삼성전자',
            quantity: 50,
            avgPrice: 75000,
            currentPrice: 78000,
            evaluationAmount: 3900000,
            profitLoss: 150000,
            profitRate: 4.0
          },
          {
            stockCode: '000660',
            stockName: 'SK하이닉스',
            quantity: 20,
            avgPrice: 105000,
            currentPrice: 110000,
            evaluationAmount: 2200000,
            profitLoss: 100000,
            profitRate: 4.76
          }
        ]
      }
    };
  }

  // 주식 현재가 조회 (모의 데이터 포함)
  async getStockPrice(stockCode) {
    try {
      if (process.env.NODE_ENV === 'development' || !this.appKey) {
        return this.getMockStockPrice(stockCode);
      }

      const headers = await this.getHeaders('FHKST01010100');
      
      const response = await axios.get(`${this.baseURL}/uapi/domestic-stock/v1/quotations/inquire-price`, {
        headers,
        params: {
          fid_cond_mrkt_div_code: 'J',
          fid_input_iscd: stockCode
        },
        timeout: 10000
      });

      const data = response.data.output;
      
      return {
        success: true,
        data: {
          stockCode: stockCode,
          stockName: data.hts_kor_isnm,
          currentPrice: parseInt(data.stck_prpr),
          changeAmount: parseInt(data.prdy_vrss),
          changeRate: parseFloat(data.prdy_ctrt),
          openPrice: parseInt(data.stck_oprc),
          highPrice: parseInt(data.stck_hgpr),
          lowPrice: parseInt(data.stck_lwpr),
          volume: parseInt(data.acml_vol),
          tradingValue: parseInt(data.acml_tr_pbmn)
        }
      };
    } catch (error) {
      console.error('❌ 주식 현재가 조회 실패:', error.response?.data || error.message);
      return this.getMockStockPrice(stockCode);
    }
  }

  // 모의 주식 가격 데이터
  getMockStockPrice(stockCode) {
    const stockNames = {
      '005930': '삼성전자',
      '000660': 'SK하이닉스',
      '035420': 'NAVER',
      '373220': 'LG에너지솔루션',
      '207940': '삼성바이오로직스'
    };

    const basePrice = {
      '005930': 75000,
      '000660': 110000,
      '035420': 200000,
      '373220': 400000,
      '207940': 850000
    }[stockCode] || Math.floor(Math.random() * 100000) + 10000;

    const changeRate = (Math.random() - 0.5) * 10; // -5% ~ +5%
    const changeAmount = Math.floor(basePrice * changeRate / 100);

    return {
      success: true,
      data: {
        stockCode: stockCode,
        stockName: stockNames[stockCode] || `종목${stockCode}`,
        currentPrice: basePrice + changeAmount,
        changeAmount: changeAmount,
        changeRate: changeRate,
        openPrice: basePrice,
        highPrice: basePrice + Math.abs(changeAmount),
        lowPrice: basePrice - Math.abs(changeAmount),
        volume: Math.floor(Math.random() * 1000000) + 100000,
        tradingValue: Math.floor(Math.random() * 10000000000)
      }
    };
  }

  // 해외주식 잔고 조회
  async getOverseasBalance() {
    try {
      if (process.env.NODE_ENV === 'development' || !this.appKey) {
        return this.getMockOverseasBalance();
      }

      const headers = await this.getHeaders('JTTT3012R');
      
      const response = await axios.get(`${this.baseURL}/uapi/overseas-stock/v1/trading/inquire-balance`, {
        headers,
        params: {
          CANO: this.accountNo,
          ACNT_PRDT_CD: this.accountProductCd,
          OVRS_EXCG_CD: 'NASD',
          TR_CRCY_CD: 'USD',
          CTX_AREA_FK200: '',
          CTX_AREA_NK200: ''
        },
        timeout: 10000
      });

      return {
        success: true,
        data: {
          totalAssets: parseFloat(response.data.output2[0]?.tot_evlu_pfls_amt || 0),
          availableCash: parseFloat(response.data.output2[0]?.frcr_buy_psbl_amt1 || 0),
          holdings: response.data.output1.map(stock => ({
            stockCode: stock.ovrs_pdno,
            stockName: stock.ovrs_item_name,
            quantity: parseInt(stock.ovrs_cblc_qty),
            avgPrice: parseFloat(stock.pchs_avg_pric),
            currentPrice: parseFloat(stock.now_pric2),
            evaluationAmount: parseFloat(stock.ovrs_stck_evlu_amt),
            profitLoss: parseFloat(stock.frcr_evlu_pfls_amt),
            currency: 'USD'
          }))
        }
      };
    } catch (error) {
      console.error('❌ 해외주식 잔고 조회 실패:', error.response?.data || error.message);
      return this.getMockOverseasBalance();
    }
  }

  // 모의 해외주식 잔고
  getMockOverseasBalance() {
    return {
      success: true,
      data: {
        totalAssets: 50000,
        availableCash: 25000,
        holdings: [
          {
            stockCode: 'AAPL',
            stockName: 'Apple Inc.',
            quantity: 50,
            avgPrice: 180,
            currentPrice: 185,
            evaluationAmount: 9250,
            profitLoss: 250,
            currency: 'USD'
          },
          {
            stockCode: 'MSFT',
            stockName: 'Microsoft Corporation',
            quantity: 30,
            avgPrice: 400,
            currentPrice: 420,
            evaluationAmount: 12600,
            profitLoss: 600,
            currency: 'USD'
          }
        ]
      }
    };
  }

  // 해외주식 현재가 조회
  async getOverseasStockPrice(stockCode, exchange = 'NASD') {
    try {
      if (process.env.NODE_ENV === 'development' || !this.appKey) {
        return this.getMockOverseasStockPrice(stockCode);
      }

      const headers = await this.getHeaders('HHDFS00000300');
      
      const response = await axios.get(`${this.baseURL}/uapi/overseas-price/v1/quotations/price`, {
        headers,
        params: {
          AUTH: '',
          EXCD: exchange,
          SYMB: stockCode
        },
        timeout: 10000
      });

      const data = response.data.output;
      
      return {
        success: true,
        data: {
          stockCode: stockCode,
          currentPrice: parseFloat(data.last),
          changeAmount: parseFloat(data.diff),
          changeRate: parseFloat(data.rate),
          openPrice: parseFloat(data.open),
          highPrice: parseFloat(data.high),
          lowPrice: parseFloat(data.low),
          volume: parseInt(data.tvol),
          currency: 'USD'
        }
      };
    } catch (error) {
      console.error('❌ 해외주식 현재가 조회 실패:', error.response?.data || error.message);
      return this.getMockOverseasStockPrice(stockCode);
    }
  }

  // 모의 해외주식 가격
  getMockOverseasStockPrice(stockCode) {
    const stockData = {
      'AAPL': { name: 'Apple Inc.', basePrice: 185 },
      'MSFT': { name: 'Microsoft Corporation', basePrice: 420 },
      'GOOGL': { name: 'Alphabet Inc.', basePrice: 140 },
      'TSLA': { name: 'Tesla, Inc.', basePrice: 250 },
      'NVDA': { name: 'NVIDIA Corporation', basePrice: 700 }
    };

    const stock = stockData[stockCode] || { name: stockCode, basePrice: Math.random() * 200 + 50 };
    const changeRate = (Math.random() - 0.5) * 8;
    const changeAmount = stock.basePrice * changeRate / 100;

    return {
      success: true,
      data: {
        stockCode: stockCode,
        stockName: stock.name,
        currentPrice: parseFloat((stock.basePrice + changeAmount).toFixed(2)),
        changeAmount: parseFloat(changeAmount.toFixed(2)),
        changeRate: parseFloat(changeRate.toFixed(2)),
        openPrice: stock.basePrice,
        highPrice: stock.basePrice + Math.abs(changeAmount),
        lowPrice: stock.basePrice - Math.abs(changeAmount),
        volume: Math.floor(Math.random() * 10000000),
        currency: 'USD'
      }
    };
  }

  // 주식 매수 주문 (모의)
  async buyStock(stockCode, quantity, price, orderType = '00') {
    try {
      console.log(`💰 모의 매수 주문: ${stockCode}, 수량: ${quantity}, 가격: ${price}`);
      
      // 실제 환경에서는 KIS API 호출
      if (process.env.NODE_ENV === 'production' && this.appKey) {
        const headers = await this.getHeaders('TTTC0802U');
        
        const response = await axios.post(`${this.baseURL}/uapi/domestic-stock/v1/trading/order-cash`, {
          CANO: this.accountNo,
          ACNT_PRDT_CD: this.accountProductCd,
          PDNO: stockCode,
          ORD_DVSN: orderType,
          ORD_QTY: quantity.toString(),
          ORD_UNPR: price.toString()
        }, { headers });

        return {
          success: response.data.rt_cd === '0',
          message: response.data.msg1,
          orderNumber: response.data.output?.KRX_FWDG_ORD_ORGNO || '',
          data: response.data.output
        };
      }

      // 개발 모드에서는 모의 주문
      return {
        success: true,
        message: '모의 매수 주문이 체결되었습니다.',
        orderNumber: `MOCK_${Date.now()}`,
        data: {
          stockCode,
          quantity,
          price,
          orderType,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('❌ 매수 주문 실패:', error.response?.data || error.message);
      throw new Error('매수 주문에 실패했습니다.');
    }
  }

  // 주식 매도 주문 (모의)
  async sellStock(stockCode, quantity, price, orderType = '00') {
    try {
      console.log(`💸 모의 매도 주문: ${stockCode}, 수량: ${quantity}, 가격: ${price}`);
      
      if (process.env.NODE_ENV === 'production' && this.appKey) {
        const headers = await this.getHeaders('TTTC0801U');
        
        const response = await axios.post(`${this.baseURL}/uapi/domestic-stock/v1/trading/order-cash`, {
          CANO: this.accountNo,
          ACNT_PRDT_CD: this.accountProductCd,
          PDNO: stockCode,
          ORD_DVSN: orderType,
          ORD_QTY: quantity.toString(),
          ORD_UNPR: price.toString()
        }, { headers });

        return {
          success: response.data.rt_cd === '0',
          message: response.data.msg1,
          orderNumber: response.data.output?.KRX_FWDG_ORD_ORGNO || '',
          data: response.data.output
        };
      }

      return {
        success: true,
        message: '모의 매도 주문이 체결되었습니다.',
        orderNumber: `MOCK_${Date.now()}`,
        data: {
          stockCode,
          quantity,
          price,
          orderType,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('❌ 매도 주문 실패:', error.response?.data || error.message);
      throw new Error('매도 주문에 실패했습니다.');
    }
  }

  // 미체결 주문 조회
  async getPendingOrders() {
    try {
      return {
        success: true,
        data: [] // 모의 환경에서는 빈 배열 반환
      };
    } catch (error) {
      console.error('❌ 미체결 주문 조회 실패:', error);
      return { success: true, data: [] };
    }
  }

  // 주문 취소
  async cancelOrder(orderNumber, stockCode, quantity, price, orderType) {
    try {
      console.log(`❌ 모의 주문 취소: ${orderNumber}`);
      return {
        success: true,
        message: '모의 주문이 취소되었습니다.',
        data: { orderNumber, stockCode }
      };
    } catch (error) {
      console.error('❌ 주문 취소 실패:', error);
      throw new Error('주문 취소에 실패했습니다.');
    }
  }
}

module.exports = new KISService();