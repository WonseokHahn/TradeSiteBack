// src/services/aiService.js
const axios = require('axios');

class AIService {
  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY;
  }

  // 시장 데이터 분석 및 종목 추천
  async analyzeAndRecommend(marketData) {
    try {
      console.log('🤖 AI 종목 분석 및 추천 시작');

      // 기본 추천 종목 (GPT 사용 불가능할 때)
      const defaultRecommendations = [
        {
          code: '005930',
          name: '삼성전자',
          aiScore: 85,
          aiReason: '반도체 업계 리더, 안정적인 수익성과 글로벌 경쟁력',
          category: 'tech',
          riskLevel: 'medium'
        },
        {
          code: '373220',
          name: 'LG에너지솔루션',
          aiScore: 78,
          aiReason: '전기차 배터리 시장 성장과 함께 높은 성장 가능성',
          category: 'battery',
          riskLevel: 'medium-high'
        },
        {
          code: '035420',
          name: 'NAVER',
          aiScore: 82,
          aiReason: 'AI, 클라우드 사업 확장과 안정적인 플랫폼 수익',
          category: 'platform',
          riskLevel: 'medium'
        },
        {
          code: '068270',
          name: '셀트리온',
          aiScore: 75,
          aiReason: '바이오의약품 분야 성장과 글로벌 진출 확대',
          category: 'bio',
          riskLevel: 'high'
        },
        {
          code: '000660',
          name: 'SK하이닉스',
          aiScore: 80,
          aiReason: '메모리 반도체 시장 회복과 AI 수요 증가',
          category: 'tech',
          riskLevel: 'medium-high'
        }
      ];

      // OpenAI가 사용 가능한 경우 AI 분석 수행
      if (this.openaiApiKey && marketData && marketData.length > 0) {
        try {
          const aiAnalysis = await this.performAIAnalysis(marketData);
          if (aiAnalysis && aiAnalysis.length > 0) {
            console.log('✅ AI 분석 완료, 개인화된 추천 제공');
            return aiAnalysis;
          }
        } catch (error) {
          console.error('AI 분석 실패, 기본 추천 사용:', error);
        }
      }

      // 기본 추천에 현재 시장 상황 반영
      const enhancedRecommendations = this.enhanceWithMarketData(defaultRecommendations, marketData);
      
      console.log('✅ 기본 종목 추천 완료');
      return enhancedRecommendations;
    } catch (error) {
      console.error('❌ AI 종목 추천 실패:', error);
      throw error;
    }
  }

  // OpenAI를 이용한 심화 분석
  async performAIAnalysis(marketData) {
    try {
      if (!this.openaiApiKey) {
        return null;
      }

      const marketSummary = this.createMarketSummary(marketData);
      
      const prompt = `
당신은 전문적인 주식 투자 분석가입니다. 다음 한국 주식 시장 데이터를 분석하고 투자 추천을 해주세요.

시장 데이터:
${marketSummary}

다음 기준으로 분석해주세요:
1. 기술적 분석 (가격 변동, 거래량)
2. 업종별 전망
3. 리스크 평가
4. 투자 타이밍

5개 종목을 추천하고, 각 종목에 대해 다음 정보를 JSON 형식으로 제공해주세요:
- code: 종목코드
- name: 종목명  
- aiScore: 추천점수 (1-100)
- aiReason: 추천 이유 (50자 이내)
- category: 업종 카테고리
- riskLevel: 리스크 수준 (low/medium/high)

응답은 반드시 JSON 배열 형식만 제공하세요.
`;

      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "당신은 한국 주식 시장 전문 투자 분석가입니다. 정확하고 신뢰할 수 있는 투자 조언을 제공합니다."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 1500,
        temperature: 0.7,
      }, {
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      const aiResponse = response.data.choices[0].message.content.trim();
      
      try {
        const recommendations = JSON.parse(aiResponse);
        if (Array.isArray(recommendations) && recommendations.length > 0) {
          return recommendations.slice(0, 5); // 최대 5개
        }
      } catch (parseError) {
        console.error('AI 응답 파싱 실패:', parseError);
      }

      return null;
    } catch (error) {
      console.error('OpenAI API 호출 실패:', error.response?.data || error.message);
      return null;
    }
  }

  // 시장 데이터 요약 생성
  createMarketSummary(marketData) {
    if (!marketData || marketData.length === 0) {
      return '시장 데이터 없음';
    }

    return marketData.map(stock => 
      `${stock.name}(${stock.code}): ${stock.currentPrice.toLocaleString()}원, ` +
      `변동률: ${stock.changeRate >= 0 ? '+' : ''}${stock.changeRate}%, ` +
      `거래량: ${stock.volume.toLocaleString()}`
    ).join('\n');
  }

  // 기본 추천에 시장 데이터 반영
  enhanceWithMarketData(recommendations, marketData) {
    if (!marketData || marketData.length === 0) {
      return recommendations;
    }

    return recommendations.map(rec => {
      const marketStock = marketData.find(stock => stock.code === rec.code);
      if (marketStock) {
        // 변동률에 따른 점수 조정
        let scoreAdjustment = 0;
        if (marketStock.changeRate > 5) {
          scoreAdjustment = -5; // 과도한 상승 시 점수 하락
        } else if (marketStock.changeRate > 0) {
          scoreAdjustment = 2; // 적당한 상승 시 점수 상승
        } else if (marketStock.changeRate > -3) {
          scoreAdjustment = 1; // 소폭 하락 시 매수 기회
        } else {
          scoreAdjustment = -3; // 큰 하락 시 점수 하락
        }

        // 거래량에 따른 조정
        if (marketStock.volume > 1000000) {
          scoreAdjustment += 2; // 높은 거래량은 관심도 증가
        }

        return {
          ...rec,
          aiScore: Math.max(1, Math.min(100, rec.aiScore + scoreAdjustment)),
          currentPrice: marketStock.currentPrice,
          changeRate: marketStock.changeRate,
          volume: marketStock.volume,
          aiReason: rec.aiReason + ` (현재 ${marketStock.changeRate >= 0 ? '+' : ''}${marketStock.changeRate}%)`
        };
      }
      return rec;
    });
  }

  // 뉴스 기반 시장 센티먼트 분석
  async analyzeSentiment(newsData) {
    try {
      if (!this.openaiApiKey || !newsData || newsData.length === 0) {
        return { sentiment: 'neutral', confidence: 0.5 };
      }

      const newsText = newsData.slice(0, 5).map(article => 
        `${article.title}: ${article.description}`
      ).join('\n');

      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "당신은 주식 시장의 뉴스 센티먼트를 분석하는 전문가입니다."
          },
          {
            role: "user",
            content: `다음 뉴스들을 분석하여 주식 시장 센티먼트를 평가해주세요:\n\n${newsText}\n\n결과를 JSON 형식으로 제공해주세요: {"sentiment": "positive/neutral/negative", "confidence": 0.0-1.0, "reason": "이유"}`
          }
        ],
        max_tokens: 300,
        temperature: 0.3,
      }, {
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      const analysis = JSON.parse(response.data.choices[0].message.content.trim());
      return analysis;
    } catch (error) {
      console.error('센티먼트 분석 실패:', error);
      return { sentiment: 'neutral', confidence: 0.5, reason: '분석 불가' };
    }
  }

  // 기술적 지표 계산
  calculateTechnicalIndicators(priceData) {
    try {
      if (!priceData || priceData.length < 20) {
        return null;
      }

      const prices = priceData.map(d => d.close);
      
      // 이동평균선 계산
      const sma5 = this.calculateSMA(prices, 5);
      const sma20 = this.calculateSMA(prices, 20);
      const sma60 = this.calculateSMA(prices, 60);

      // RSI 계산
      const rsi = this.calculateRSI(prices, 14);

      // 볼린저 밴드 계산
      const bollingerBands = this.calculateBollingerBands(prices, 20, 2);

      // MACD 계산
      const macd = this.calculateMACD(prices);

      return {
        sma5: sma5[sma5.length - 1],
        sma20: sma20[sma20.length - 1],
        sma60: sma60[sma60.length - 1],
        rsi: rsi[rsi.length - 1],
        bollingerBands: {
          upper: bollingerBands.upper[bollingerBands.upper.length - 1],
          middle: bollingerBands.middle[bollingerBands.middle.length - 1],
          lower: bollingerBands.lower[bollingerBands.lower.length - 1]
        },
        macd: {
          line: macd.line[macd.line.length - 1],
          signal: macd.signal[macd.signal.length - 1],
          histogram: macd.histogram[macd.histogram.length - 1]
        }
      };
    } catch (error) {
      console.error('기술적 지표 계산 실패:', error);
      return null;
    }
  }

  // 단순 이동평균 계산
  calculateSMA(prices, period) {
    const sma = [];
    for (let i = period - 1; i < prices.length; i++) {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma.push(sum / period);
    }
    return sma;
  }

  // RSI 계산
  calculateRSI(prices, period = 14) {
    const gains = [];
    const losses = [];
    
    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);
    }

    const rsi = [];
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < gains.length; i++) {
      const rs = avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
      
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }

    return rsi;
  }

  // 볼린저 밴드 계산
  calculateBollingerBands(prices, period = 20, multiplier = 2) {
    const sma = this.calculateSMA(prices, period);
    const upper = [];
    const lower = [];

    for (let i = 0; i < sma.length; i++) {
      const slice = prices.slice(i, i + period);
      const mean = sma[i];
      const variance = slice.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / period;
      const stdDev = Math.sqrt(variance);
      
      upper.push(mean + (stdDev * multiplier));
      lower.push(mean - (stdDev * multiplier));
    }

    return {
      upper,
      middle: sma,
      lower
    };
  }

  // MACD 계산
  calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const ema12 = this.calculateEMA(prices, fastPeriod);
    const ema26 = this.calculateEMA(prices, slowPeriod);
    
    const macdLine = [];
    const startIndex = Math.max(ema12.length, ema26.length) - Math.min(ema12.length, ema26.length);
    
    for (let i = startIndex; i < Math.min(ema12.length, ema26.length); i++) {
      macdLine.push(ema12[i] - ema26[i]);
    }

    const signalLine = this.calculateEMA(macdLine, signalPeriod);
    const histogram = [];

    for (let i = 0; i < signalLine.length; i++) {
      histogram.push(macdLine[macdLine.length - signalLine.length + i] - signalLine[i]);
    }

    return {
      line: macdLine,
      signal: signalLine,
      histogram
    };
  }

  // 지수 이동평균 계산
  calculateEMA(prices, period) {
    const ema = [];
    const multiplier = 2 / (period + 1);
    ema[0] = prices[0];

    for (let i = 1; i < prices.length; i++) {
      ema[i] = (prices[i] * multiplier) + (ema[i - 1] * (1 - multiplier));
    }

    return ema;
  }

  // 투자 전략 신호 생성
  generateTradingSignals(indicators, strategy, params) {
    try {
      const signals = {
        buy: false,
        sell: false,
        hold: false,
        confidence: 0,
        reason: ''
      };

      switch (strategy) {
        case 'moving_average':
          return this.generateMASignals(indicators, params);
        case 'rsi_reversal':
          return this.generateRSISignals(indicators, params);
        case 'bollinger_squeeze':
          return this.generateBollingerSignals(indicators, params);
        default:
          signals.hold = true;
          signals.reason = '알 수 없는 전략';
          return signals;
      }
    } catch (error) {
      console.error('거래 신호 생성 실패:', error);
      return { buy: false, sell: false, hold: true, confidence: 0, reason: '신호 생성 실패' };
    }
  }

  // 이동평균선 신호 생성
  generateMASignals(indicators, params) {
    const signals = { buy: false, sell: false, hold: false, confidence: 0, reason: '' };
    
    if (!indicators || !indicators.sma5 || !indicators.sma20) {
      signals.hold = true;
      signals.reason = '데이터 부족';
      return signals;
    }

    const shortMA = indicators.sma5;
    const longMA = indicators.sma20;

    if (shortMA > longMA) {
      const gap = ((shortMA - longMA) / longMA) * 100;
      if (gap > 0.5 && gap < 5) {
        signals.buy = true;
        signals.confidence = Math.min(0.9, gap / 5);
        signals.reason = `단기 이평선이 장기 이평선을 돌파 (${gap.toFixed(2)}% 차이)`;
      } else if (gap >= 5) {
        signals.hold = true;
        signals.reason = '과도한 상승으로 관망';
      }
    } else {
      const gap = ((longMA - shortMA) / longMA) * 100;
      if (gap > 3) {
        signals.sell = true;
        signals.confidence = Math.min(0.8, gap / 5);
        signals.reason = `단기 이평선이 장기 이평선 아래로 하락`;
      }
    }

    if (!signals.buy && !signals.sell) {
      signals.hold = true;
      signals.reason = '이동평균선 신호 없음';
    }

    return signals;
  }

  // RSI 신호 생성
  generateRSISignals(indicators, params) {
    const signals = { buy: false, sell: false, hold: false, confidence: 0, reason: '' };
    
    if (!indicators || indicators.rsi === undefined) {
      signals.hold = true;
      signals.reason = 'RSI 데이터 부족';
      return signals;
    }

    const rsi = indicators.rsi;
    const oversoldLevel = params.oversold_level || 30;
    const overboughtLevel = params.overbought_level || 70;

    if (rsi < oversoldLevel) {
      signals.buy = true;
      signals.confidence = (oversoldLevel - rsi) / oversoldLevel;
      signals.reason = `RSI 과매도 구간 (${rsi.toFixed(1)})`;
    } else if (rsi > overboughtLevel) {
      signals.sell = true;
      signals.confidence = (rsi - overboughtLevel) / (100 - overboughtLevel);
      signals.reason = `RSI 과매수 구간 (${rsi.toFixed(1)})`;
    } else {
      signals.hold = true;
      signals.reason = `RSI 중립 구간 (${rsi.toFixed(1)})`;
    }

    return signals;
  }

  // 볼린저 밴드 신호 생성
  generateBollingerSignals(indicators, params) {
    const signals = { buy: false, sell: false, hold: false, confidence: 0, reason: '' };
    
    if (!indicators || !indicators.bollingerBands) {
      signals.hold = true;
      signals.reason = '볼린저 밴드 데이터 부족';
      return signals;
    }

    const { upper, middle, lower } = indicators.bollingerBands;
    const currentPrice = indicators.currentPrice || middle;
    
    const bandWidth = (upper - lower) / middle;
    const pricePosition = (currentPrice - lower) / (upper - lower);

    if (bandWidth < (params.squeeze_threshold || 0.1)) {
      if (pricePosition < 0.2) {
        signals.buy = true;
        signals.confidence = 0.7;
        signals.reason = '볼린저 밴드 수축 후 하단 근접';
      } else if (pricePosition > 0.8) {
        signals.sell = true;
        signals.confidence = 0.7;
        signals.reason = '볼린저 밴드 수축 후 상단 근접';
      } else {
        signals.hold = true;
        signals.reason = '볼린저 밴드 수축 중 - 대기';
      }
    } else {
      if (currentPrice <= lower) {
        signals.buy = true;
        signals.confidence = 0.8;
        signals.reason = '볼린저 밴드 하단 터치';
      } else if (currentPrice >= upper) {
        signals.sell = true;
        signals.confidence = 0.8;
        signals.reason = '볼린저 밴드 상단 터치';
      } else {
        signals.hold = true;
        signals.reason = '볼린저 밴드 중간 구간';
      }
    }

    return signals;
  }
}

module.exports = new AIService();// src/services/aiService.js
const { Configuration, OpenAIApi } = require('openai');
const axios = require('axios');

class AIService {
  constructor() {
    if (process.env.OPENAI_API_KEY) {
      const configuration = new Configuration({
        apiKey: process.env.OPENAI_API_KEY,
      });
      this.openai = new OpenAIApi(configuration);
    }
  }

  // 시장 데이터 분석 및 종목 추천
  async analyzeAndRecommend(marketData) {
    try {
      console.log('🤖 AI 종목 분석 및 추천 시작');

      // 기본 추천 종목 (GPT 사용 불가능할 때)
      const defaultRecommendations = [
        {
          code: '005930',
          name: '삼성전자',
          aiScore: 85,
          aiReason: '반도체 업계 리더, 안정적인 수익성과 글로벌 경쟁력',
          category: 'tech',
          riskLevel: 'medium'
        },
        {
          code: '373220',
          name: 'LG에너지솔루션',
          aiScore: 78,
          aiReason: '전기차 배터리 시장 성장과 함께 높은 성장 가능성',
          category: 'battery',
          riskLevel: 'medium-high'
        },
        {
          code: '035420',
          name: 'NAVER',
          aiScore: 82,
          aiReason: 'AI, 클라우드 사업 확장과 안정적인 플랫폼 수익',
          category: 'platform',
          riskLevel: 'medium'
        },
        {
          code: '068270',
          name: '셀트리온',
          aiScore: 75,
          aiReason: '바이오의약품 분야 성장과 글로벌 진출 확대',
          category: 'bio',
          riskLevel: 'high'
        },
        {
          code: '000660',
          name: 'SK하이닉스',
          aiScore: 80,
          aiReason: '메모리 반도체 시장 회복과 AI 수요 증가',
          category: 'tech',
          riskLevel: 'medium-high'
        }
      ];

      // OpenAI가 사용 가능한 경우 AI 분석 수행
      if (this.openai && marketData && marketData.length > 0) {
        try {
          const aiAnalysis = await this.performAIAnalysis(marketData);
          if (aiAnalysis && aiAnalysis.length > 0) {
            console.log('✅ AI 분석 완료, 개인화된 추천 제공');
            return aiAnalysis;
          }
        } catch (error) {
          console.error('AI 분석 실패, 기본 추천 사용:', error);
        }
      }

      // 기본 추천에 현재 시장 상황 반영
      const enhancedRecommendations = this.enhanceWithMarketData(defaultRecommendations, marketData);
      
      console.log('✅ 기본 종목 추천 완료');
      return enhancedRecommendations;
    } catch (error) {
      console.error('❌ AI 종목 추천 실패:', error);
      throw error;
    }
  }

  // OpenAI를 이용한 심화 분석
  async performAIAnalysis(marketData) {
    try {
      const marketSummary = this.createMarketSummary(marketData);
      
      const prompt = `
당신은 전문적인 주식 투자 분석가입니다. 다음 한국 주식 시장 데이터를 분석하고 투자 추천을 해주세요.

시장 데이터:
${marketSummary}

다음 기준으로 분석해주세요:
1. 기술적 분석 (가격 변동, 거래량)
2. 업종별 전망
3. 리스크 평가
4. 투자 타이밍

5개 종목을 추천하고, 각 종목에 대해 다음 정보를 JSON 형식으로 제공해주세요:
- code: 종목코드
- name: 종목명  
- aiScore: 추천점수 (1-100)
- aiReason: 추천 이유 (50자 이내)
- category: 업종 카테고리
- riskLevel: 리스크 수준 (low/medium/high)

응답은 반드시 JSON 배열 형식만 제공하세요.
`;

      const response = await this.openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "당신은 한국 주식 시장 전문 투자 분석가입니다. 정확하고 신뢰할 수 있는 투자 조언을 제공합니다."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 1500,
        temperature: 0.7,
      });

      const aiResponse = response.data.choices[0].message.content.trim();
      
      try {
        const recommendations = JSON.parse(aiResponse);
        if (Array.isArray(recommendations) && recommendations.length > 0) {
          return recommendations.slice(0, 5); // 최대 5개
        }
      } catch (parseError) {
        console.error('AI 응답 파싱 실패:', parseError);
      }

      return null;
    } catch (error) {
      console.error('OpenAI API 호출 실패:', error);
      return null;
    }
  }

  // 시장 데이터 요약 생성
  createMarketSummary(marketData) {
    if (!marketData || marketData.length === 0) {
      return '시장 데이터 없음';
    }

    return marketData.map(stock => 
      `${stock.name}(${stock.code}): ${stock.currentPrice.toLocaleString()}원, ` +
      `변동률: ${stock.changeRate >= 0 ? '+' : ''}${stock.changeRate}%, ` +
      `거래량: ${stock.volume.toLocaleString()}`
    ).join('\n');
  }

  // 기본 추천에 시장 데이터 반영
  enhanceWithMarketData(recommendations, marketData) {
    if (!marketData || marketData.length === 0) {
      return recommendations;
    }

    return recommendations.map(rec => {
      const marketStock = marketData.find(stock => stock.code === rec.code);
      if (marketStock) {
        // 변동률에 따른 점수 조정
        let scoreAdjustment = 0;
        if (marketStock.changeRate > 5) {
          scoreAdjustment = -5; // 과도한 상승 시 점수 하락
        } else if (marketStock.changeRate > 0) {
          scoreAdjustment = 2; // 적당한 상승 시 점수 상승
        } else if (marketStock.changeRate > -3) {
          scoreAdjustment = 1; // 소폭 하락 시 매수 기회
        } else {
          scoreAdjustment = -3; // 큰 하락 시 점수 하락
        }

        // 거래량에 따른 조정
        if (marketStock.volume > 1000000) {
          scoreAdjustment += 2; // 높은 거래량은 관심도 증가
        }

        return {
          ...rec,
          aiScore: Math.max(1, Math.min(100, rec.aiScore + scoreAdjustment)),
          currentPrice: marketStock.currentPrice,
          changeRate: marketStock.changeRate,
          volume: marketStock.volume,
          aiReason: rec.aiReason + ` (현재 ${marketStock.changeRate >= 0 ? '+' : ''}${marketStock.changeRate}%)`
        };
      }
      return rec;
    });
  }

  // 뉴스 기반 시장 센티먼트 분석
  async analyzeSentiment(newsData) {
    try {
      if (!this.openai || !newsData || newsData.length === 0) {
        return { sentiment: 'neutral', confidence: 0.5 };
      }

      const newsText = newsData.slice(0, 5).map(article => 
        `${article.title}: ${article.description}`
      ).join('\n');

      const response = await this.openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "당신은 주식 시장의 뉴스 센티먼트를 분석하는 전문가입니다."
          },
          {
            role: "user",
            content: `다음 뉴스들을 분석하여 주식 시장 센티먼트를 평가해주세요:\n\n${newsText}\n\n결과를 JSON 형식으로 제공해주세요: {"sentiment": "positive/neutral/negative", "confidence": 0.0-1.0, "reason": "이유"}`
          }
        ],
        max_tokens: 300,
        temperature: 0.3,
      });

      const analysis = JSON.parse(response.data.choices[0].message.content.trim());
      return analysis;
    } catch (error) {
      console.error('센티먼트 분석 실패:', error);
      return { sentiment: 'neutral', confidence: 0.5, reason: '분석 불가' };
    }
  }

  // 기술적 지표 계산
  calculateTechnicalIndicators(priceData) {
    try {
      if (!priceData || priceData.length < 20) {
        return null;
      }

      const prices = priceData.map(d => d.close);
      
      // 이동평균선 계산
      const sma5 = this.calculateSMA(prices, 5);
      const sma20 = this.calculateSMA(prices, 20);
      const sma60 = this.calculateSMA(prices, 60);

      // RSI 계산
      const rsi = this.calculateRSI(prices, 14);

      // 볼린저 밴드 계산
      const bollingerBands = this.calculateBollingerBands(prices, 20, 2);

      // MACD 계산
      const macd = this.calculateMACD(prices);

      return {
        sma5: sma5[sma5.length - 1],
        sma20: sma20[sma20.length - 1],
        sma60: sma60[sma60.length - 1],
        rsi: rsi[rsi.length - 1],
        bollingerBands: {
          upper: bollingerBands.upper[bollingerBands.upper.length - 1],
          middle: bollingerBands.middle[bollingerBands.middle.length - 1],
          lower: bollingerBands.lower[bollingerBands.lower.length - 1]
        },
        macd: {
          line: macd.line[macd.line.length - 1],
          signal: macd.signal[macd.signal.length - 1],
          histogram: macd.histogram[macd.histogram.length - 1]
        }
      };
    } catch (error) {
      console.error('기술적 지표 계산 실패:', error);
      return null;
    }
  }

  // 단순 이동평균 계산
  calculateSMA(prices, period) {
    const sma = [];
    for (let i = period - 1; i < prices.length; i++) {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma.push(sum / period);
    }
    return sma;
  }

  // RSI 계산
  calculateRSI(prices, period = 14) {
    const gains = [];
    const losses = [];
    
    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);
    }

    const rsi = [];
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < gains.length; i++) {
      const rs = avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
      
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }

    return rsi;
  }

  // 볼린저 밴드 계산
  calculateBollingerBands(prices, period = 20, multiplier = 2) {
    const sma = this.calculateSMA(prices, period);
    const upper = [];
    const lower = [];

    for (let i = 0; i < sma.length; i++) {
      const slice = prices.slice(i, i + period);
      const mean = sma[i];
      const variance = slice.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / period;
      const stdDev = Math.sqrt(variance);
      
      upper.push(mean + (stdDev * multiplier));
      lower.push(mean - (stdDev * multiplier));
    }

    return {
      upper,
      middle: sma,
      lower
    };
  }

  // MACD 계산
  calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const ema12 = this.calculateEMA(prices, fastPeriod);
    const ema26 = this.calculateEMA(prices, slowPeriod);
    
    const macdLine = [];
    const startIndex = Math.max(ema12.length, ema26.length) - Math.min(ema12.length, ema26.length);
    
    for (let i = startIndex; i < Math.min(ema12.length, ema26.length); i++) {
      macdLine.push(ema12[i] - ema26[i]);
    }

    const signalLine = this.calculateEMA(macdLine, signalPeriod);
    const histogram = [];

    for (let i = 0; i < signalLine.length; i++) {
      histogram.push(macdLine[macdLine.length - signalLine.length + i] - signalLine[i]);
    }

    return {
      line: macdLine,
      signal: signalLine,
      histogram
    };
  }

  // 지수 이동평균 계산
  calculateEMA(prices, period) {
    const ema = [];
    const multiplier = 2 / (period + 1);
    ema[0] = prices[0];

    for (let i = 1; i < prices.length; i++) {
      ema[i] = (prices[i] * multiplier) + (ema[i - 1] * (1 - multiplier));
    }

    return ema;
  }

  // 투자 전략 신호 생성
  generateTradingSignals(indicators, strategy, params) {
    try {
      const signals = {
        buy: false,
        sell: false,
        hold: false,
        confidence: 0,
        reason: ''
      };

      switch (strategy) {
        case 'moving_average':
          return this.generateMASignals(indicators, params);
        case 'rsi_reversal':
          return this.generateRSISignals(indicators, params);
        case 'bollinger_squeeze':
          return this.generateBollingerSignals(indicators, params);
        default:
          signals.hold = true;
          signals.reason = '알 수 없는 전략';
          return signals;
      }
    } catch (error) {
      console.error('거래 신호 생성 실패:', error);
      return { buy: false, sell: false, hold: true, confidence: 0, reason: '신호 생성 실패' };
    }
  }

  // 이동평균선 신호 생성
  generateMASignals(indicators, params) {
    const signals = { buy: false, sell: false, hold: false, confidence: 0, reason: '' };
    
    if (!indicators || !indicators.sma5 || !indicators.sma20) {
      signals.hold = true;
      signals.reason = '데이터 부족';
      return signals;
    }

    const shortMA = indicators.sma5;
    const longMA = indicators.sma20;

    if (shortMA > longMA) {
      const gap = ((shortMA - longMA) / longMA) * 100;
      if (gap > 0.5 && gap < 5) {
        signals.buy = true;
        signals.confidence = Math.min(0.9, gap / 5);
        signals.reason = `단기 이평선이 장기 이평선을 돌파 (${gap.toFixed(2)}% 차이)`;
      } else if (gap >= 5) {
        signals.hold = true;
        signals.reason = '과도한 상승으로 관망';
      }
    } else {
      const gap = ((longMA - shortMA) / longMA) * 100;
      if (gap > 3) {
        signals.sell = true;
        signals.confidence = Math.min(0.8, gap / 5);
        signals.reason = `단기 이평선이 장기 이평선 아래로 하락`;
      }
    }

    if (!signals.buy && !signals.sell) {
      signals.hold = true;
      signals.reason = '이동평균선 신호 없음';
    }

    return signals;
  }

  // RSI 신호 생성
  generateRSISignals(indicators, params) {
    const signals = { buy: false, sell: false, hold: false, confidence: 0, reason: '' };
    
    if (!indicators || indicators.rsi === undefined) {
      signals.hold = true;
      signals.reason = 'RSI 데이터 부족';
      return signals;
    }

    const rsi = indicators.rsi;
    const oversoldLevel = params.oversold_level || 30;
    const overboughtLevel = params.overbought_level || 70;

    if (rsi < oversoldLevel) {
      signals.buy = true;
      signals.confidence = (oversoldLevel - rsi) / oversoldLevel;
      signals.reason = `RSI 과매도 구간 (${rsi.toFixed(1)})`;
    } else if (rsi > overboughtLevel) {
      signals.sell = true;
      signals.confidence = (rsi - overboughtLevel) / (100 - overboughtLevel);
      signals.reason = `RSI 과매수 구간 (${rsi.toFixed(1)})`;
    } else {
      signals.hold = true;
      signals.reason = `RSI 중립 구간 (${rsi.toFixed(1)})`;
    }

    return signals;
  }

  // 볼린저 밴드 신호 생성
  generateBollingerSignals(indicators, params) {
    const signals = { buy: false, sell: false, hold: false, confidence: 0, reason: '' };
    
    if (!indicators || !indicators.bollingerBands) {
      signals.hold = true;
      signals.reason = '볼린저 밴드 데이터 부족';
      return signals;
    }

    const { upper, middle, lower } = indicators.bollingerBands;
    const currentPrice = indicators.currentPrice || middle;
    
    const bandWidth = (upper - lower) / middle;
    const pricePosition = (currentPrice - lower) / (upper - lower);

    if (bandWidth < (params.squeeze_threshold || 0.1)) {
      if (pricePosition < 0.2) {
        signals.buy = true;
        signals.confidence = 0.7;
        signals.reason = '볼린저 밴드 수축 후 하단 근접';
      } else if (pricePosition > 0.8) {
        signals.sell = true;
        signals.confidence = 0.7;
        signals.reason = '볼린저 밴드 수축 후 상단 근접';
      } else {
        signals.hold = true;
        signals.reason = '볼린저 밴드 수축 중 - 대기';
      }
    } else {
      if (currentPrice <= lower) {
        signals.buy = true;
        signals.confidence = 0.8;
        signals.reason = '볼린저 밴드 하단 터치';
      } else if (currentPrice >= upper) {
        signals.sell = true;
        signals.confidence = 0.8;
        signals.reason = '볼린저 밴드 상단 터치';
      } else {
        signals.hold = true;
        signals.reason = '볼린저 밴드 중간 구간';
      }
    }

    return signals;
  }
}

module.exports = new AIService();