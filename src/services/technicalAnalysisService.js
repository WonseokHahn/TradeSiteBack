const axios = require('axios');

class TechnicalAnalysisService {
  constructor() {
    this.priceHistory = new Map(); // 종목별 가격 히스토리 저장
  }

  // RSI 계산 (14일 기준)
  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50; // 데이터 부족시 중간값

    let gains = 0;
    let losses = 0;

    // 초기 평균 gain/loss 계산
    for (let i = 1; i <= period; i++) {
      const difference = prices[i] - prices[i - 1];
      if (difference >= 0) {
        gains += difference;
      } else {
        losses -= difference;
      }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Smoothed RSI 계산
    for (let i = period + 1; i < prices.length; i++) {
      const difference = prices[i] - prices[i - 1];
      
      if (difference >= 0) {
        avgGain = (avgGain * (period - 1) + difference) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) - difference) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  // 이동평균선 계산
  calculateMA(prices, period) {
    if (prices.length < period) return prices[prices.length - 1];
    
    const sum = prices.slice(-period).reduce((acc, price) => acc + price, 0);
    return sum / period;
  }

  // 모멘텀 계산 (n일간 가격 변화율)
  calculateMomentum(prices, period = 10) {
    if (prices.length < period + 1) return 0;
    
    const currentPrice = prices[prices.length - 1];
    const pastPrice = prices[prices.length - 1 - period];
    
    return ((currentPrice - pastPrice) / pastPrice) * 100;
  }

  // 볼린저 밴드 계산
  calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) {
      const price = prices[prices.length - 1];
      return { upper: price * 1.1, middle: price, lower: price * 0.9 };
    }

    const ma = this.calculateMA(prices, period);
    const recentPrices = prices.slice(-period);
    
    // 표준편차 계산
    const variance = recentPrices.reduce((acc, price) => acc + Math.pow(price - ma, 2), 0) / period;
    const standardDeviation = Math.sqrt(variance);

    return {
      upper: ma + (standardDeviation * stdDev),
      middle: ma,
      lower: ma - (standardDeviation * stdDev)
    };
  }

  // MACD 계산
  calculateMACD(prices) {
    if (prices.length < 26) return { macd: 0, signal: 0, histogram: 0 };

    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macd = ema12 - ema26;

    // 시그널 라인 (MACD의 9일 EMA)
    const macdHistory = [macd]; // 실제로는 MACD 히스토리가 필요
    const signal = this.calculateEMA(macdHistory, 9);
    const histogram = macd - signal;

    return { macd, signal, histogram };
  }

  // 지수이동평균 계산
  calculateEMA(prices, period) {
    if (prices.length === 0) return 0;
    if (prices.length === 1) return prices[0];

    const multiplier = 2 / (period + 1);
    let ema = prices[0];

    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
    }

    return ema;
  }

  // 상승장 모멘텀 전략 분석
  analyzeBullMomentumStrategy(stockCode, currentPrice, priceHistory) {
    const prices = priceHistory || this.generateMockPriceHistory(currentPrice);
    
    const rsi = this.calculateRSI(prices);
    const momentum = this.calculateMomentum(prices);
    const ma20 = this.calculateMA(prices, 20);
    const ma5 = this.calculateMA(prices, 5);
    const macd = this.calculateMACD(prices);

    console.log(`📊 ${stockCode} 모멘텀 분석:`, {
      rsi: rsi.toFixed(2),
      momentum: momentum.toFixed(2),
      ma5: ma5.toFixed(0),
      ma20: ma20.toFixed(0),
      currentPrice,
      macd: macd.macd.toFixed(3)
    });

    // 상승장 모멘텀 전략 신호
    const signals = {
      buy: false,
      sell: false,
      strength: 0,
      reason: []
    };

    // 매수 신호들
    if (rsi < 70 && rsi > 30) { // RSI가 과매수/과매도 구간이 아님
      signals.strength += 20;
      signals.reason.push('RSI 정상 구간');
    }

    if (momentum > 5) { // 강한 상승 모멘텀
      signals.buy = true;
      signals.strength += 30;
      signals.reason.push('강한 상승 모멘텀');
    }

    if (currentPrice > ma5 && ma5 > ma20) { // 골든크로스 상태
      signals.buy = true;
      signals.strength += 25;
      signals.reason.push('이평선 정배열');
    }

    if (macd.macd > macd.signal && macd.histogram > 0) { // MACD 상승 신호
      signals.buy = true;
      signals.strength += 20;
      signals.reason.push('MACD 상승 신호');
    }

    // 매도 신호들
    if (rsi > 80) { // 과매수
      signals.sell = true;
      signals.strength -= 40;
      signals.reason.push('RSI 과매수');
    }

    if (momentum < -10) { // 강한 하락 모멘텀
      signals.sell = true;
      signals.strength -= 30;
      signals.reason.push('하락 모멘텀');
    }

    if (currentPrice < ma20) { // 장기 이평선 이탈
      signals.sell = true;
      signals.strength -= 25;
      signals.reason.push('20일선 이탈');
    }

    return signals;
  }

  // 하락장 가치투자 전략 분석
  analyzeBearValueStrategy(stockCode, currentPrice, priceHistory) {
    const prices = priceHistory || this.generateMockPriceHistory(currentPrice);
    
    const rsi = this.calculateRSI(prices);
    const ma50 = this.calculateMA(prices, 50);
    const bollinger = this.calculateBollingerBands(prices);
    const momentum = this.calculateMomentum(prices, 20); // 장기 모멘텀

    console.log(`📊 ${stockCode} 가치투자 분석:`, {
      rsi: rsi.toFixed(2),
      momentum: momentum.toFixed(2),
      ma50: ma50.toFixed(0),
      currentPrice,
      bollingerLower: bollinger.lower.toFixed(0)
    });

    const signals = {
      buy: false,
      sell: false,
      strength: 0,
      reason: []
    };

    // 가치투자 매수 신호들
    if (rsi < 30) { // 과매도
      signals.buy = true;
      signals.strength += 40;
      signals.reason.push('RSI 과매도');
    }

    if (currentPrice < bollinger.lower) { // 볼린저 밴드 하단 돌파
      signals.buy = true;
      signals.strength += 30;
      signals.reason.push('볼린저 밴드 하단');
    }

    if (currentPrice < ma50 * 0.9) { // 50일선 대비 10% 이상 하락
      signals.buy = true;
      signals.strength += 25;
      signals.reason.push('장기 이평선 대비 저평가');
    }

    if (momentum < -15) { // 과도한 하락 후 반등 기대
      signals.buy = true;
      signals.strength += 20;
      signals.reason.push('과도한 하락');
    }

    // 매도 신호들 (손절 및 이익실현)
    if (rsi > 70) { // 과매수 시 일부 이익실현
      signals.sell = true;
      signals.strength -= 20;
      signals.reason.push('RSI 과매수 - 일부 매도');
    }

    if (currentPrice > bollinger.upper) { // 볼린저 밴드 상단
      signals.sell = true;
      signals.strength -= 25;
      signals.reason.push('볼린저 밴드 상단 - 이익실현');
    }

    if (momentum < -25) { // 극심한 하락 시 손절
      signals.sell = true;
      signals.strength -= 50;
      signals.reason.push('극심한 하락 - 손절');
    }

    return signals;
  }

  // 종합 전략 분석
  analyzeStrategy(marketType, stockCode, currentPrice, region = 'domestic') {
    // 실제로는 API에서 가격 히스토리를 가져와야 하지만, 
    // 여기서는 모의 데이터 사용
    const priceHistory = this.getPriceHistory(stockCode, currentPrice);

    if (marketType === 'bull') {
      return this.analyzeBullMomentumStrategy(stockCode, currentPrice, priceHistory);
    } else {
      return this.analyzeBearValueStrategy(stockCode, currentPrice, priceHistory);
    }
  }

  // 가격 히스토리 가져오기 (실제로는 KIS API 또는 다른 데이터 소스 사용)
  getPriceHistory(stockCode, currentPrice) {
    // 캐시에서 가져오거나 새로 생성
    if (this.priceHistory.has(stockCode)) {
      const history = this.priceHistory.get(stockCode);
      // 최신 가격 추가
      history.push(currentPrice);
      // 최대 100개 가격만 유지
      if (history.length > 100) {
        history.shift();
      }
      return history;
    } else {
      // 새로 생성
      const history = this.generateMockPriceHistory(currentPrice);
      this.priceHistory.set(stockCode, history);
      return history;
    }
  }

  // 모의 가격 히스토리 생성 (테스트용)
  generateMockPriceHistory(currentPrice, days = 50) {
    const prices = [];
    let price = currentPrice * 0.8; // 50일 전 가격부터 시작
    
    for (let i = 0; i < days; i++) {
      // 랜덤 워크로 가격 변동 시뮬레이션
      const change = (Math.random() - 0.5) * 0.04; // ±2% 변동
      price = price * (1 + change);
      prices.push(Math.round(price));
    }
    
    // 마지막 가격을 현재가로 조정
    prices[prices.length - 1] = currentPrice;
    
    return prices;
  }

  // 포트폴리오 리밸런싱 제안
  suggestRebalancing(portfolio, marketType) {
    const suggestions = [];

    for (const holding of portfolio) {
      const signals = this.analyzeStrategy(marketType, holding.stockCode, holding.currentPrice, holding.region);
      
      if (signals.strength > 50) {
        suggestions.push({
          stockCode: holding.stockCode,
          action: 'INCREASE',
          reason: signals.reason.join(', '),
          strength: signals.strength
        });
      } else if (signals.strength < -30) {
        suggestions.push({
          stockCode: holding.stockCode,
          action: 'DECREASE',
          reason: signals.reason.join(', '),
          strength: signals.strength
        });
      }
    }

    return suggestions;
  }
}

module.exports = new TechnicalAnalysisService();