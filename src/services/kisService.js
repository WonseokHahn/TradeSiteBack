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

      const response = await axios.post(`${this.baseURL}/oauth2/tokenP`, {
        grant_type: 'client_credentials',
        appkey: this.appKey,
        appsecret: this.appSecret
      }, {
        headers: {
          'content-type': 'application/json'
        }
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiry = new Date(Date.now() + (response.data.expires_in * 1000));
      
      console.log('✅ KIS 액세스 토큰 발급 완료');
      return this.accessToken;
    } catch (error) {
      console.error('❌ KIS 토큰 발급 실패:', error.response?.data || error.message);
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

  // 계좌잔고 조회
  async getAccountBalance() {
    try {
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
        }
      });

      const result = response.data.output1;
      const summary = response.data.output2[0];

      return {
        success: true,
        data: {
          totalAssets: parseInt(summary.tot_evlu_amt || 0), // 총 평가금액
          availableCash: parseInt(summary.dnca_tot_amt || 0), // 예수금 총액
          stockValue: parseInt(summary.scts_evlu_amt || 0), // 유가증권 평가금액
          profitLoss: parseInt(summary.evlu_pfls_smtl_amt || 0), // 평가손익합계
          profitRate: parseFloat(summary.evlu_erng_rt || 0), // 평가수익률
          holdings: result.map(stock => ({
            stockCode: stock.pdno,
            stockName: stock.prdt_name,
            quantity: parseInt(stock.hldg_qty),
            avgPrice: parseFloat(stock.pchs_avg_pric),
            currentPrice: parseFloat(stock.prpr),
            evaluationAmount: parseInt(stock.evlu_amt),
            profitLoss: parseInt(stock.evlu_pfls_amt),
            profitRate: parseFloat(stock.evlu_pfls_rt)
          }))
        }
      };
    } catch (error) {
      console.error('❌ 계좌잔고 조회 실패:', error.response?.data || error.message);
      throw new Error('계좌잔고 조회에 실패했습니다.');
    }
  }

  // 주식 현재가 조회
  async getStockPrice(stockCode) {
    try {
      const headers = await this.getHeaders('FHKST01010100');
      
      const response = await axios.get(`${this.baseURL}/uapi/domestic-stock/v1/quotations/inquire-price`, {
        headers,
        params: {
          fid_cond_mrkt_div_code: 'J',
          fid_input_iscd: stockCode
        }
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
      throw new Error('주식 현재가 조회에 실패했습니다.');
    }
  }

  // 주식 매수 주문
  async buyStock(stockCode, quantity, price, orderType = '00') {
    try {
      const headers = await this.getHeaders('TTTC0802U');
      
      const response = await axios.post(`${this.baseURL}/uapi/domestic-stock/v1/trading/order-cash`, {
        CANO: this.accountNo,
        ACNT_PRDT_CD: this.accountProductCd,
        PDNO: stockCode,
        ORD_DVSN: orderType, // 00: 지정가, 01: 시장가
        ORD_QTY: quantity.toString(),
        ORD_UNPR: price.toString()
      }, { headers });

      return {
        success: response.data.rt_cd === '0',
        message: response.data.msg1,
        orderNumber: response.data.output?.KRX_FWDG_ORD_ORGNO || '',
        data: response.data.output
      };
    } catch (error) {
      console.error('❌ 매수 주문 실패:', error.response?.data || error.message);
      throw new Error('매수 주문에 실패했습니다.');
    }
  }

  // 주식 매도 주문
  async sellStock(stockCode, quantity, price, orderType = '00') {
    try {
      const headers = await this.getHeaders('TTTC0801U');
      
      const response = await axios.post(`${this.baseURL}/uapi/domestic-stock/v1/trading/order-cash`, {
        CANO: this.accountNo,
        ACNT_PRDT_CD: this.accountProductCd,
        PDNO: stockCode,
        ORD_DVSN: orderType, // 00: 지정가, 01: 시장가
        ORD_QTY: quantity.toString(),
        ORD_UNPR: price.toString()
      }, { headers });

      return {
        success: response.data.rt_cd === '0',
        message: response.data.msg1,
        orderNumber: response.data.output?.KRX_FWDG_ORD_ORGNO || '',
        data: response.data.output
      };
    } catch (error) {
      console.error('❌ 매도 주문 실패:', error.response?.data || error.message);
      throw new Error('매도 주문에 실패했습니다.');
    }
  }

  // 주문 취소
  async cancelOrder(orderNumber, stockCode, quantity, price, orderType) {
    try {
      const headers = await this.getHeaders('TTTC0803U');
      
      const response = await axios.post(`${this.baseURL}/uapi/domestic-stock/v1/trading/order-rvsecncl`, {
        CANO: this.accountNo,
        ACNT_PRDT_CD: this.accountProductCd,
        KRX_FWDG_ORD_ORGNO: orderNumber,
        ORGN_ODNO: '',
        ORD_DVSN: orderType,
        RVSE_CNCL_DVSN_CD: '02', // 취소
        ORD_QTY: '0',
        ORD_UNPR: '0',
        QTY_ALL_ORD_YN: 'Y'
      }, { headers });

      return {
        success: response.data.rt_cd === '0',
        message: response.data.msg1,
        data: response.data.output
      };
    } catch (error) {
      console.error('❌ 주문 취소 실패:', error.response?.data || error.message);
      throw new Error('주문 취소에 실패했습니다.');
    }
  }

  // 미체결 주문 조회
  async getPendingOrders() {
    try {
      const headers = await this.getHeaders('TTTC8001R');
      
      const response = await axios.get(`${this.baseURL}/uapi/domestic-stock/v1/trading/inquire-daily-ccld`, {
        headers,
        params: {
          CANO: this.accountNo,
          ACNT_PRDT_CD: this.accountProductCd,
          INQR_STRT_DT: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
          INQR_END_DT: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
          SLL_BUY_DVSN_CD: '00', // 전체
          INQR_DVSN: '00',
          PDNO: '',
          CCLD_DVSN: '01', // 미체결
          ORD_GNO_BRNO: '',
          ODNO: '',
          INQR_DVSN_3: '00',
          INQR_DVSN_1: '',
          CTX_AREA_FK100: '',
          CTX_AREA_NK100: ''
        }
      });

      return {
        success: true,
        data: response.data.output1.map(order => ({
          orderNumber: order.odno,
          stockCode: order.pdno,
          stockName: order.prdt_name,
          orderType: order.sll_buy_dvsn_cd_name,
          orderQuantity: parseInt(order.ord_qty),
          orderPrice: parseInt(order.ord_unpr),
          executedQuantity: parseInt(order.tot_ccld_qty),
          remainingQuantity: parseInt(order.psbl_qty),
          orderTime: order.ord_tmd
        }))
      };
    } catch (error) {
      console.error('❌ 미체결 주문 조회 실패:', error.response?.data || error.message);
      throw new Error('미체결 주문 조회에 실패했습니다.');
    }
  }

  // 해외주식 잔고 조회 (미국)
  async getOverseasBalance() {
    try {
      const headers = await this.getHeaders('JTTT3012R');
      
      const response = await axios.get(`${this.baseURL}/uapi/overseas-stock/v1/trading/inquire-balance`, {
        headers,
        params: {
          CANO: this.accountNo,
          ACNT_PRDT_CD: this.accountProductCd,
          OVRS_EXCG_CD: 'NASD', // 나스닥
          TR_CRCY_CD: 'USD',
          CTX_AREA_FK200: '',
          CTX_AREA_NK200: ''
        }
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
      throw new Error('해외주식 잔고 조회에 실패했습니다.');
    }
  }

  // 해외주식 현재가 조회
  async getOverseasStockPrice(stockCode, exchange = 'NASD') {
    try {
      const headers = await this.getHeaders('HHDFS00000300');
      
      const response = await axios.get(`${this.baseURL}/uapi/overseas-price/v1/quotations/price`, {
        headers,
        params: {
          AUTH: '',
          EXCD: exchange,
          SYMB: stockCode
        }
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
      throw new Error('해외주식 현재가 조회에 실패했습니다.');
    }
  }
}

module.exports = new KISService();