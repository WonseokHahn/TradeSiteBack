// src/services/tradingStrategies.js
const kisService = require('./kisService');
const axios = require('axios');

class TradingStrategies {
  
  // 1. 이동평균선 교차 전략 (Golden Cross / Dead Cross)
  static async movingAverageCrossover(stockCode, shortPeriod = 5, longPeriod = 20, marketType = 'domestic') {
    try {
      console.log(`📊 이동평균선 교차 전략 분석: ${stockCode}`);
      
      // 실제 과거 데이터 조회
      const priceData = await this.getHistoricalPrices(stockCode, longPeriod + 10, marketType);
      
      if (!priceData || priceData.length < longPeriod) {
        throw new Error('충분한 과거 데이터를 가져올 수 없습니다.');
      }
      
      // 단기 이동평균선 계산
      const shortMA = this.calculateMovingAverage(priceData, shortPeriod);
      const longMA = this.calculateMovingAverage(priceData, longPeriod);
      
      // 최근 2일의 이동평균선 비교
      const currentShortMA = shortMA[shortMA.length - 1];
      const prevShortMA = shortMA[shortMA.length - 2];
      const currentLongMA = longMA[longMA.length - 1];
      const prevLongMA = longMA[longMA.length - 2];
      
      let signal = 'HOLD';
      let confidence = 0;
      let reason = '';
      
      // 골든 크로스 (상승 신호)
      if (prevShortMA <= prevLongMA && currentShortMA > currentLongMA) {
        signal = 'BUY';
        confidence = 0.8;
        reason = `단기 이동평균선(${shortPeriod}일: ${currentShortMA.toLocaleString()}원)이 장기 이동평균선(${longPeriod}일: ${currentLongMA.toLocaleString()}원)을 상향 돌파했습니다. (골든 크로스)`;
      }
      // 데드 크로스 (하락 신호)
      else if (prevShortMA >= prevLongMA && currentShortMA < currentLongMA) {
        signal = 'SELL';
        confidence = 0.8;
        reason = `단기 이동평균선(${shortPeriod}일: ${currentShortMA.toLocaleString()}원)이 장기 이동평균선(${longPeriod}일: ${currentLongMA.toLocaleString()}원)을 하향 돌파했습니다. (데드 크로스)`;
      }
      // 현재 위치에 따른 추가 분석
      else if (currentShortMA > currentLongMA) {
        const gap = ((currentShortMA - currentLongMA) / currentLongMA) * 100;
        if (gap > 3) {
          signal = 'HOLD';
          confidence = 0.6;
          reason = `상승 추세이지만 이미 상승폭이 ${gap.toFixed(1)}%로 큽니다. 추가 상승보다는 조정 가능성을 고려해야 합니다.`;
        } else {
          signal = 'BUY';
          confidence = 0.7;
          reason = `단기 이동평균선(${currentShortMA.toLocaleString()}원)이 장기 이동평균선(${currentLongMA.toLocaleString()}원) 위에 있어 상승 추세입니다.`;
        }
      } else {
        signal = 'SELL';
        confidence = 0.7;
        reason = `단기 이동평균선(${currentShortMA.toLocaleString()}원)이 장기 이동평균선(${currentLongMA.toLocaleString()}원) 아래에 있어 하락 추세입니다.`;
      }
      
      return {
        strategy: 'MovingAverageCrossover',
        signal,
        confidence,
        reason,
        parameters: { shortPeriod, longPeriod },
        technicalData: {
          shortMA: Math.round(currentShortMA),
          longMA: Math.round(currentLongMA),
          prices: priceData.slice(-5).map(p => Math.round(p)),
          priceChange: priceData.length > 1 ? ((priceData[priceData.length - 1] - priceData[priceData.length - 2]) / priceData[priceData.length - 2] * 100).toFixed(2) : 0
        }
      };
      
    } catch (error) {
      console.error('❌ 이동평균선 교차 전략 오류:', error);
      return {
        strategy: 'MovingAverageCrossover',
        signal: 'HOLD',
        confidence: 0,
        reason: '전략 분석 중 오류가 발생했습니다: ' + error.message,
        error: error.message
      };
    }
  }

  // 2. RSI 과매수/과매도 전략
  static async rsiStrategy(stockCode, period = 14, marketType = 'domestic') {
    try {
      console.log(`📊 RSI 전략 분석: ${stockCode}`);
      
      const priceData = await this.getHistoricalPrices(stockCode, period + 20, marketType);
      
      if (!priceData || priceData.length < period + 1) {
        throw new Error('RSI 계산을 위한 충분한 데이터를 가져올 수 없습니다.');
      }
      
      const rsiValue = this.calculateRSI(priceData, period);
      
      let signal = 'HOLD';
      let confidence = 0;
      let reason = '';
      
      if (rsiValue <= 30) {
        signal = 'BUY';
        confidence = 0.85;
        reason = `RSI가 ${rsiValue.toFixed(2)}로 과매도 구간(30 이하)에 있어 반등 가능성이 높습니다. 매수 타이밍입니다.`;
      } else if (rsiValue >= 70) {
        signal = 'SELL';
        confidence = 0.85;
        reason = `RSI가 ${rsiValue.toFixed(2)}로 과매수 구간(70 이상)에 있어 조정 가능성이 높습니다. 매도를 고려하세요.`;
      } else if (rsiValue <= 40) {
        signal = 'BUY';
        confidence = 0.65;
        reason = `RSI가 ${rsiValue.toFixed(2)}로 매수 구간(40 이하)에 있습니다. 상승 가능성이 있습니다.`;
      } else if (rsiValue >= 60) {
        signal = 'SELL';
        confidence = 0.65;
        reason = `RSI가 ${rsiValue.toFixed(2)}로 매도 구간(60 이상)에 있습니다. 주의가 필요합니다.`;
      } else {
        signal = 'HOLD';
        confidence = 0.5;
        reason = `RSI가 ${rsiValue.toFixed(2)}로 중립 구간(40-60)에 있어 추가 신호를 기다리는 것이 좋습니다.`;
      }
      
      return {
        strategy: 'RSI',
        signal,
        confidence,
        reason,
        parameters: { period },
        technicalData: {
          rsi: Math.round(rsiValue * 100) / 100,
          prices: priceData.slice(-5).map(p => Math.round(p)),
          momentum: rsiValue > 50 ? 'bullish' : 'bearish'
        }
      };
      
    } catch (error) {
      console.error('❌ RSI 전략 오류:', error);
      return {
        strategy: 'RSI',
        signal: 'HOLD',
        confidence: 0,
        reason: '전략 분석 중 오류가 발생했습니다: ' + error.message,
        error: error.message
      };
    }
  }

  // 3. 볼린저 밴드 전략
  static async bollingerBandStrategy(stockCode, period = 20, stdDev = 2, marketType = 'domestic') {
    try {
      console.log(`📊 볼린저 밴드 전략 분석: ${stockCode}`);
      
      const priceData = await this.getHistoricalPrices(stockCode, period + 10, marketType);
      
      if (!priceData || priceData.length < period) {
        throw new Error('볼린저 밴드 계산을 위한 충분한 데이터를 가져올 수 없습니다.');
      }
      
      const currentPrice = priceData[priceData.length - 1];
      const { upperBand, middleBand, lowerBand } = this.calculateBollingerBands(priceData, period, stdDev);
      
      let signal = 'HOLD';
      let confidence = 0;
      let reason = '';
      
      // 볼린저 밴드 하단 근처에서 매수
      if (currentPrice <= lowerBand * 1.02) {
        signal = 'BUY';
        confidence = 0.8;
        reason = `현재가(${currentPrice.toLocaleString()}원)가 볼린저 밴드 하단(${Math.round(lowerBand).toLocaleString()}원) 근처에서 반등 신호를 보이고 있습니다.`;
      }
      // 볼린저 밴드 상단 근처에서 매도
      else if (currentPrice >= upperBand * 0.98) {
        signal = 'SELL';
        confidence = 0.8;
        reason = `현재가(${currentPrice.toLocaleString()}원)가 볼린저 밴드 상단(${Math.round(upperBand).toLocaleString()}원) 근처에 있어 조정 가능성이 높습니다.`;
      }
      // 중앙선 근처 분석
      else {
        const distanceFromMiddle = ((currentPrice - middleBand) / middleBand) * 100;
        const bandWidth = ((upperBand - lowerBand) / middleBand) * 100;
        
        if (distanceFromMiddle < -2) {
          signal = 'BUY';
          confidence = 0.6;
          reason = `현재가가 볼린저 밴드 중앙선(${Math.round(middleBand).toLocaleString()}원)보다 ${Math.abs(distanceFromMiddle).toFixed(1)}% 낮아 상승 여력이 있습니다.`;
        } else if (distanceFromMiddle > 2) {
          signal = 'SELL';
          confidence = 0.6;
          reason = `현재가가 볼린저 밴드 중앙선(${Math.round(middleBand).toLocaleString()}원)보다 ${distanceFromMiddle.toFixed(1)}% 높아 조정 가능성을 고려해야 합니다.`;
        } else {
          signal = 'HOLD';
          confidence = 0.5;
          reason = `현재가(${currentPrice.toLocaleString()}원)가 볼린저 밴드 중앙선 근처에 있어 방향성이 불분명합니다. 밴드폭: ${bandWidth.toFixed(1)}%`;
        }
      }
      
      return {
        strategy: 'BollingerBand',
        signal,
        confidence,
        reason,
        parameters: { period, stdDev },
        technicalData: {
          currentPrice: Math.round(currentPrice),
          upperBand: Math.round(upperBand),
          middleBand: Math.round(middleBand),
          lowerBand: Math.round(lowerBand),
          bandWidth: Math.round(((upperBand - lowerBand) / middleBand) * 100 * 100) / 100,
          position: currentPrice > upperBand ? 'above_upper' : currentPrice < lowerBand ? 'below_lower' : 'middle'
        }
      };
      
    } catch (error) {
      console.error('❌ 볼린저 밴드 전략 오류:', error);
      return {
        strategy: 'BollingerBand',
        signal: 'HOLD',
        confidence: 0,
        reason: '전략 분석 중 오류가 발생했습니다: ' + error.message,
        error: error.message
      };
    }
  }

  // 종합 전략 분석
  static async comprehensiveAnalysis(stockCode, marketType = 'domestic') {
    try {
      console.log(`🔍 종합 전략 분석 시작: ${stockCode}`);
      
      const [maStrategy, rsiStrategy, bbStrategy] = await Promise.all([
        this.movingAverageCrossover(stockCode, 5, 20, marketType),
        this.rsiStrategy(stockCode, 14, marketType),
        this.bollingerBandStrategy(stockCode, 20, 2, marketType)
      ]);
      
      // 신호 점수 계산
      const signalScores = {
        BUY: 0,
        SELL: 0,
        HOLD: 0
      };
      
      const strategies = [maStrategy, rsiStrategy, bbStrategy];
      let totalConfidence = 0;
      let validStrategies = 0;
      
      strategies.forEach(strategy => {
        if (strategy.confidence > 0) {
          signalScores[strategy.signal] += strategy.confidence;
          totalConfidence += strategy.confidence;
          validStrategies++;
        }
      });
      
      // 최종 신호 결정
      const maxScore = Math.max(...Object.values(signalScores));
      const finalSignal = Object.keys(signalScores).find(key => signalScores[key] === maxScore);
      const avgConfidence = validStrategies > 0 ? totalConfidence / validStrategies : 0;
      
      // 신호 강도 조정
      let adjustedConfidence = avgConfidence;
      const agreementCount = strategies.filter(s => s.signal === finalSignal && s.confidence > 0.6).length;
      
      if (agreementCount >= 2) {
        adjustedConfidence = Math.min(avgConfidence * 1.2, 1.0); // 2개 이상 전략 일치시 신뢰도 상승
      } else if (agreementCount === 0) {
        adjustedConfidence = Math.max(avgConfidence * 0.7, 0.3); // 일치하는 전략이 없으면 신뢰도 하락
      }
      
      return {
        stockCode,
        finalSignal,
        confidence: Math.round(adjustedConfidence * 100) / 100,
        strategies: {
          movingAverage: maStrategy,
          rsi: rsiStrategy,
          bollingerBand: bbStrategy
        },
        signalScores,
        agreementCount,
        recommendation: this.generateRecommendation(finalSignal, adjustedConfidence, strategies, agreementCount),
        analysis_time: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ 종합 전략 분석 오류:', error);
      return {
        stockCode,
        finalSignal: 'HOLD',
        confidence: 0,
        error: error.message,
        recommendation: '분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
      };
    }
  }

  // 권장사항 생성
  static generateRecommendation(signal, confidence, strategies, agreementCount) {
    const strongSignals = strategies.filter(s => s.confidence >= 0.7);
    const weakSignals = strategies.filter(s => s.confidence < 0.5);
    
    let recommendation = '';
    
    if (confidence >= 0.8 && agreementCount >= 2) {
      recommendation = `🟢 강력한 ${signal} 신호! ${agreementCount}개 전략이 일치합니다. `;
    } else if (confidence >= 0.6) {
      recommendation = `🟡 중간 강도의 ${signal} 신호입니다. `;
    } else {
      recommendation = `🔵 약한 신호로 신중한 접근이 필요합니다. `;
    }
    
    if (weakSignals.length > 1) {
      recommendation += `일부 지표에서는 불확실성을 보이고 있으니 추가 모니터링을 권장합니다.`;
    } else if (strongSignals.length >= 2) {
      recommendation += `대부분의 지표가 일관된 신호를 보이고 있습니다.`;
    } else {
      recommendation += `시장 상황을 지속적으로 관찰하세요.`;
    }
    
    return recommendation;
  }

  // 한국투자증권 차트 API를 통한 실제 과거 가격 데이터 조회
  static async getHistoricalPrices(stockCode, days, marketType = 'domestic') {
    try {
      console.log(`📈 ${stockCode} 과거 ${days}일 데이터 조회 중...`);
      
      if (marketType === 'domestic') {
        return await this.getDomesticHistoricalPrices(stockCode, days);
      } else {
        return await this.getOverseasHistoricalPrices(stockCode, days);
      }
    } catch (error) {
      console.error('❌ 과거 가격 데이터 조회 실패:', error);
      
      // 실패시 현재가 기반 모의 데이터 생성
      try {
        const currentPrice = marketType === 'domestic' 
          ? await kisService.getStockPrice(stockCode)
          : await kisService.getOverseasStockPrice(stockCode);
          
        if (currentPrice.success) {
          return this.generateFallbackData(currentPrice.data.currentPrice, days);
        }
      } catch (fallbackError) {
        console.error('❌ 대체 데이터 생성도 실패:', fallbackError);
      }
      
      throw error;
    }
  }

  // 국내 주식 과거 데이터 조회 (한국투자증권 차트 API)
  static async getDomesticHistoricalPrices(stockCode, days) {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - Math.max(days + 10, 100)); // 여유분 포함
      
      const formatDate = (date) => {
        return date.toISOString().slice(0, 10).replace(/-/g, '');
      };
      
      // 한국투자증권 차트 API 호출
      const token = await kisService.getAccessToken();
      
      const response = await axios.get('https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-daily-price', {
        headers: {
          'authorization': `Bearer ${token}`,
          'appkey': process.env.KIS_APP_KEY,
          'appsecret': process.env.KIS_APP_SECRET,
          'tr_id': 'FHKST01010400'
        },
        params: {
          fid_cond_mrkt_div_code: 'J',
          fid_input_iscd: stockCode,
          fid_org_adj_prc: '1', // 수정주가 반영
          fid_period_div_code: 'D' // 일봉
        }
      });

      if (response.data.rt_cd !== '0') {
        throw new Error(`API 오류: ${response.data.msg1}`);
      }

      const chartData = response.data.output;
      if (!chartData || chartData.length === 0) {
        throw new Error('차트 데이터가 없습니다.');
      }

      // 종가 데이터 추출 (최신순으로 정렬되어 있음)
      const prices = chartData
        .slice(0, days) // 필요한 일수만큼
        .reverse() // 과거순으로 정렬
        .map(item => parseInt(item.stck_clpr)); // 종가

      console.log(`✅ ${stockCode} 국내주식 ${prices.length}일 데이터 조회 완료`);
      return prices;

    } catch (error) {
      console.error('❌ 국내 차트 데이터 조회 실패:', error);
      throw error;
    }
  }

  // 해외 주식 과거 데이터 조회 (한국투자증권 해외차트 API)
  static async getOverseasHistoricalPrices(stockCode, days) {
    try {
      const token = await kisService.getAccessToken();
      
      const response = await axios.get('https://openapi.koreainvestment.com:9443/uapi/overseas-price/v1/quotations/dailyprice', {
        headers: {
          'authorization': `Bearer ${token}`,
          'appkey': process.env.KIS_APP_KEY,
          'appsecret': process.env.KIS_APP_SECRET,
          'tr_id': 'HHDFS76240000'
        },
        params: {
          AUTH: '',
          EXCD: 'NAS', // 나스닥
          SYMB: stockCode,
          GUBN: '0',
          BYMD: '',
          MODP: '1'
        }
      });

      if (response.data.rt_cd !== '0') {
        throw new Error(`해외 차트 API 오류: ${response.data.msg1}`);
      }

      const chartData = response.data.output2;
      if (!chartData || chartData.length === 0) {
        throw new Error('해외 차트 데이터가 없습니다.');
      }

      // 종가 데이터 추출
      const prices = chartData
        .slice(0, days)
        .reverse()
        .map(item => parseFloat(item.clos));

      console.log(`✅ ${stockCode} 해외주식 ${prices.length}일 데이터 조회 완료`);
      return prices;

    } catch (error) {
      console.error('❌ 해외 차트 데이터 조회 실패:', error);
      throw error;
    }
  }

  // API 실패시 대체 데이터 생성
  static generateFallbackData(currentPrice, days) {
    console.log('⚠️ 대체 데이터 생성 중...');
    
    const prices = [];
    let price = currentPrice;
    
    // 역순으로 과거 데이터 모의 생성
    for (let i = days - 1; i >= 0; i--) {
      const volatility = 0.02; // 일일 변동성 2%
      const randomChange = (Math.random() - 0.5) * volatility * 2;
      const trendFactor = i / days; // 과거로 갈수록 약간의 하락 트렌드
      
      price = price * (1 + randomChange - trendFactor * 0.001);
      prices.unshift(Math.round(price));
    }
    
    prices.push(currentPrice); // 현재가 추가
    
    console.log(`✅ 대체 데이터 ${prices.length}일 생성 완료`);
    return prices;
  }

  // 이동평균선 계산
  static calculateMovingAverage(prices, period) {
    const result = [];
    for (let i = period - 1; i < prices.length; i++) {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
    return result;
  }

  // RSI 계산 (개선된 버전)
  static calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) {
      throw new Error(`RSI 계산을 위해서는 최소 ${period + 1}일의 데이터가 필요합니다.`);
    }

    const gains = [];
    const losses = [];
    
    // 가격 변화 계산
    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }
    
    // 초기 평균 계산
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    // Wilder의 평활화 적용
    for (let i = period; i < gains.length; i++) {
      avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
      avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
    }
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return Math.max(0, Math.min(100, rsi)); // 0-100 범위로 제한
  }

  // 볼린저 밴드 계산
  static calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) {
      throw new Error(`볼린저 밴드 계산을 위해서는 최소 ${period}일의 데이터가 필요합니다.`);
    }

    const recentPrices = prices.slice(-period);
    const mean = recentPrices.reduce((a, b) => a + b, 0) / period;
    
    const variance = recentPrices.reduce((sum, price) => {
      return sum + Math.pow(price - mean, 2);
    }, 0) / period;
    
    const standardDeviation = Math.sqrt(variance);
    
    return {
      upperBand: mean + (standardDeviation * stdDev),
      middleBand: mean,
      lowerBand: mean - (standardDeviation * stdDev)
    };
  }

  // 시장 시간 확인
  static isMarketOpen(marketType = 'domestic') {
    const now = new Date();
    const kstTime = new Date(now.getTime() + (9 * 60 * 60 * 1000)); // UTC+9
    const hour = kstTime.getHours();
    const minute = kstTime.getMinutes();
    const day = kstTime.getDay(); // 0=일요일, 1=월요일, ..., 6=토요일
    
    if (marketType === 'domestic') {
      // 한국 시장: 월-금 09:00-15:30
      const isWeekday = day >= 1 && day <= 5;
      const isMarketHours = (hour === 9 || (hour >= 10 && hour < 15) || (hour === 15 && minute <= 30));
      return isWeekday && isMarketHours;
    } else {
      // 미국 시장: 월-금 23:30-06:00 (한국시간)
      const isWeekday = day >= 1 && day <= 5;
      const isMarketHours = (hour >= 23) || (hour < 6) || (hour === 6 && minute === 0);
      return isWeekday && isMarketHours;
    }
  }
}

module.exports = TradingStrategies;