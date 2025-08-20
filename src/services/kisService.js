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
  }

  // 접근 토큰 발급
  async getAccessToken() {
    try {
      if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
        return this.accessToken;
      }

      console.log('🔑 KIS 접근 토큰 발급 요청');

      const response = await axios.post(`${this.baseURL}/oauth2/tokenP`, {
        grant_type: 'client_credentials',
        appkey: this.appKey,
        appsecret: this.appSecret
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiry = new Date(Date.now() + (response.data.expires_in * 1000));

      console.log('✅ KIS 접근 토큰 발급 완료');
      return this.accessToken;
    } catch (error) {
      console.error('❌ KIS 접근 토큰 발급 실패:', error.response?.data || error.message);
      throw new Error('한국투자증권 인증에 실패했습니다.');
    }
  }

  // API 요청 헬퍼
  async makeRequest(method, endpoint, data = null, headers = {}) {
    try {
      const token = await this.getAccessToken();
      
      const config = {
        method,
        url: `${this.baseURL}${endpoint}`,
        headers: {
          'Content-Type': 'application/json',
          'authorization': `Bearer ${token}`,
          'appkey': this.appKey,
          'appsecret': this.appSecret,
          ...headers
        }
      };

      if (data) {
        if (method === 'GET') {
          config.params = data;
        } else {
          config.data = data;
        }
      }

      const response = await axios(config);
      return response.data;
    } catch (error) {
      console.error(`❌ KIS API 요청 실패 [${method} ${endpoint}]:`, error.response?.data || error.message);
      throw error;
    }
  }

  // 계좌 잔고 조회
  async getAccountBalance() {
    try {
      console.log('💰 계좌 잔고 조회 시작');

      const response = await this.makeRequest('GET', '/uapi/domestic-stock/v1/trading/inquire-balance', {
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
      }, {
        'tr_id': 'CTRP6548R'
      });

      if (response.rt_cd !== '0') {
        throw new Error(`계좌 조회 실패: ${response.msg1}`);
      }

      const output1 = response.output1[0];
      const output2 = response.output2;

      // 보유 종목들의 평가금액 합계
      const totalStockValue = output2.reduce((sum, stock) => {
        return sum + parseInt(stock.evlu_amt || 0);
      }, 0);

      const result = {
        availableAmount: parseInt(output1.dnca_tot_amt || 0), // 주문가능현금
        totalAssets: parseInt(output1.tot_evlu_amt || 0), // 총평가금액
        totalPnL: parseInt(output1.evlu_pfls_smtl_amt || 0), // 평가손익합계
        totalPnLPercent: parseFloat(output1.evlu_erng_rt || 0), // 평가수익률
        cashBalance: parseInt(output1.prvs_rcdl_excc_amt || 0), // 예수금
        stockValue: totalStockValue, // 주식평가금액
        stocks: output2.map(stock => ({
          code: stock.pdno,
          name: stock.prdt_name,
          quantity: parseInt(stock.hldg_qty || 0),
          avgPrice: parseInt(stock.pchs_avg_pric || 0),
          currentPrice: parseInt(stock.prpr || 0),
          evaluationAmount: parseInt(stock.evlu_amt || 0),
          profitLoss: parseInt(stock.evlu_pfls_amt || 0),
          profitLossRate: parseFloat(stock.evlu_pfls_rt || 0)
        })).filter(stock => stock.quantity > 0)
      };

      console.log('✅ 계좌 잔고 조회 완료:', {
        availableAmount: result.availableAmount,
        totalAssets: result.totalAssets,
        stockCount: result.stocks.length
      });

      return result;
    } catch (error) {
      console.error('❌ 계좌 잔고 조회 실패:', error);
      throw error;
    }
  }

  // 주식 현재가 조회
  async getStockPrice(stockCode) {
    try {
      console.log(`📈 주식 현재가 조회: ${stockCode}`);

      const response = await this.makeRequest('GET', '/uapi/domestic-stock/v1/quotations/inquire-price', {
        FID_COND_MRKT_DIV_CD: 'J',
        FID_INPUT_ISCD: stockCode
      }, {
        'tr_id': 'FHKST01010100'
      });

      if (response.rt_cd !== '0') {
        throw new Error(`현재가 조회 실패: ${response.msg1}`);
      }

      const output = response.output;
      
      const result = {
        stockCode,
        stockName: output.hts_kor_isnm,
        currentPrice: parseInt(output.stck_prpr),
        changeAmount: parseInt(output.prdy_vrss),
        changeRate: parseFloat(output.prdy_ctrt),
        volume: parseInt(output.acml_vol),
        tradingValue: parseInt(output.acml_tr_pbmn),
        marketCap: parseInt(output.hts_avls),
        high: parseInt(output.stck_hgpr),
        low: parseInt(output.stck_lwpr),
        open: parseInt(output.stck_oprc)
      };

      console.log(`✅ ${stockCode} 현재가 조회 완료:`, result.currentPrice);
      return result;
    } catch (error) {
      console.error(`❌ 주식 현재가 조회 실패 ${stockCode}:`, error);
      throw error;
    }
  }

  // 종목 검색
  async searchStock(keyword) {
    try {
      console.log(`🔍 종목 검색: ${keyword}`);

      // 종목코드로 직접 검색
      if (/^\d{6}$/.test(keyword)) {
        const stockInfo = await this.getStockPrice(keyword);
        return [{
          code: keyword,
          name: stockInfo.stockName,
          currentPrice: stockInfo.currentPrice,
          changeRate: stockInfo.changeRate
        }];
      }

      // 종목명으로 검색 (간단한 매핑 - 실제로는 KIS 종목 마스터 API 사용)
      const stockMapping = {
        '삼성전자': '005930',
        'SK하이닉스': '000660',
        'LG에너지솔루션': '373220',
        'NAVER': '035420',
        '카카오': '035720',
        '현대차': '005380',
        'LG화학': '051910',
        '셀트리온': '068270',
        '삼성바이오로직스': '207940',
        'POSCO홀딩스': '005490',
        'KB금융': '105560',
        '신한지주': '055550',
        '하나금융지주': '086790',
        '삼성물산': '028260',
        'LG전자': '066570'
      };

      const results = [];
      for (const [name, code] of Object.entries(stockMapping)) {
        if (name.includes(keyword) || keyword.includes(name)) {
          try {
            const stockInfo = await this.getStockPrice(code);
            results.push({
              code,
              name,
              currentPrice: stockInfo.currentPrice,
              changeRate: stockInfo.changeRate
            });
          } catch (error) {
            console.error(`종목 정보 조회 실패 ${code}:`, error);
          }
        }
      }

      console.log(`✅ 종목 검색 완료: ${results.length}개 결과`);
      return results;
    } catch (error) {
      console.error('❌ 종목 검색 실패:', error);
      throw error;
    }
  }

  // 주식 매수
  async buyStock(stockCode, quantity, orderType = 'market', price = 0) {
    try {
      console.log(`💰 매수 주문: ${stockCode} ${quantity}주 ${orderType}`);

      const orderData = {
        CANO: this.accountNo,
        ACNT_PRDT_CD: this.accountProductCd,
        PDNO: stockCode,
        ORD_DVSN: orderType === 'market' ? '01' : '00', // 01: 시장가, 00: 지정가
        ORD_QTY: quantity.toString(),
        ORD_UNPR: orderType === 'market' ? '0' : price.toString()
      };

      const response = await this.makeRequest('POST', '/uapi/domestic-stock/v1/trading/order-cash', orderData, {
        'tr_id': 'TTTC0802U'
      });

      if (response.rt_cd !== '0') {
        throw new Error(`매수 주문 실패: ${response.msg1}`);
      }

      const result = {
        orderId: response.output.KRX_FWDG_ORD_ORGNO + response.output.ODNO,
        status: 'pending',
        stockCode,
        quantity,
        orderType,
        price: orderType === 'market' ? 0 : price,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ 매수 주문 접수 완료: ${result.orderId}`);
      return result;
    } catch (error) {
      console.error('❌ 매수 주문 실패:', error);
      throw error;
    }
  }

  // 주식 매도
  async sellStock(stockCode, quantity, orderType = 'market', price = 0) {
    try {
      console.log(`💸 매도 주문: ${stockCode} ${quantity}주 ${orderType}`);

      const orderData = {
        CANO: this.accountNo,
        ACNT_PRDT_CD: this.accountProductCd,
        PDNO: stockCode,
        ORD_DVSN: orderType === 'market' ? '01' : '00',
        ORD_QTY: quantity.toString(),
        ORD_UNPR: orderType === 'market' ? '0' : price.toString()
      };

      const response = await this.makeRequest('POST', '/uapi/domestic-stock/v1/trading/order-cash', orderData, {
        'tr_id': 'TTTC0801U'
      });

      if (response.rt_cd !== '0') {
        throw new Error(`매도 주문 실패: ${response.msg1}`);
      }

      const result = {
        orderId: response.output.KRX_FWDG_ORD_ORGNO + response.output.ODNO,
        status: 'pending',
        stockCode,
        quantity,
        orderType,
        price: orderType === 'market' ? 0 : price,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ 매도 주문 접수 완료: ${result.orderId}`);
      return result;
    } catch (error) {
      console.error('❌ 매도 주문 실패:', error);
      throw error;
    }
  }

  // 포지션 조회 (계좌 잔고에서 보유 주식만 추출)
  async getPositions() {
    try {
      const accountInfo = await this.getAccountBalance();
      return accountInfo.stocks;
    } catch (error) {
      console.error('❌ 포지션 조회 실패:', error);
      throw error;
    }
  }

  // 시장 데이터 조회 (주요 종목들의 현재 상황)
  async getMarketData() {
    try {
      console.log('📊 시장 데이터 조회 시작');

      const majorStocks = [
        '005930', // 삼성전자
        '000660', // SK하이닉스
        '373220', // LG에너지솔루션
        '035420', // NAVER
        '035720', // 카카오
        '005380', // 현대차
        '051910', // LG화학
        '068270', // 셀트리온
        '207940', // 삼성바이오로직스
        '005490'  // POSCO홀딩스
      ];

      const marketData = await Promise.all(
        majorStocks.map(async (code) => {
          try {
            const stockInfo = await this.getStockPrice(code);
            return {
              code,
              name: stockInfo.stockName,
              currentPrice: stockInfo.currentPrice,
              changeRate: stockInfo.changeRate,
              volume: stockInfo.volume,
              marketCap: stockInfo.marketCap
            };
          } catch (error) {
            console.error(`시장 데이터 조회 실패 ${code}:`, error);
            return null;
          }
        })
      );

      const validData = marketData.filter(data => data !== null);
      console.log(`✅ 시장 데이터 조회 완료: ${validData.length}개 종목`);
      
      return validData;
    } catch (error) {
      console.error('❌ 시장 데이터 조회 실패:', error);
      throw error;
    }
  }

  // 주문 체결 내역 조회
  async getOrderHistory(startDate, endDate) {
    try {
      console.log(`📋 주문 체결 내역 조회: ${startDate} ~ ${endDate}`);

      const response = await this.makeRequest('GET', '/uapi/domestic-stock/v1/trading/inquire-daily-ccld', {
        CANO: this.accountNo,
        ACNT_PRDT_CD: this.accountProductCd,
        INQR_STRT_DT: startDate.replace(/-/g, ''),
        INQR_END_DT: endDate.replace(/-/g, ''),
        SLL_BUY_DVSN_CD: '00', // 00: 전체, 01: 매도, 02: 매수
        INQR_DVSN: '00',
        PDNO: '',
        CCLD_DVSN: '00',
        ORD_GNO_BRNO: '',
        ODNO: '',
        INQR_DVSN_3: '00',
        INQR_DVSN_1: '',
        CTX_AREA_FK100: '',
        CTX_AREA_NK100: ''
      }, {
        'tr_id': 'TTTC8001R'
      });

      if (response.rt_cd !== '0') {
        throw new Error(`주문 내역 조회 실패: ${response.msg1}`);
      }

      const orders = response.output1.map(order => ({
        orderId: order.odno,
        stockCode: order.pdno,
        stockName: order.prdt_name,
        orderType: order.sll_buy_dvsn_cd === '01' ? 'sell' : 'buy',
        quantity: parseInt(order.ord_qty),
        executedQuantity: parseInt(order.tot_ccld_qty),
        price: parseInt(order.ord_unpr),
        executedPrice: parseInt(order.avg_prvs),
        status: order.ord_dvsn_name,
        orderDate: order.ord_dt,
        orderTime: order.ord_tmd
      }));

      console.log(`✅ 주문 체결 내역 조회 완료: ${orders.length}건`);
      return orders;
    } catch (error) {
      console.error('❌ 주문 체결 내역 조회 실패:', error);
      throw error;
    }
  }
}

module.exports = new KISService();