// src/services/aiRecommendationService.js
const axios = require('axios');
const kisService = require('./kisService');

class AIRecommendationService {
  
  // GPT를 활용한 종목 추천
  static async getAIRecommendedStocks(marketType = 'domestic', investmentStyle = 'balanced') {
    try {
      console.log(`🤖 AI 종목 추천 요청: ${marketType}, ${investmentStyle}`);
      
      if (!process.env.OPENAI_API_KEY) {
        console.log('⚠️ OpenAI API 키가 없어 기본 추천 종목을 반환합니다.');
        return this.getDefaultRecommendations(marketType);
      }

      const prompt = this.generateRecommendationPrompt(marketType, investmentStyle);
      
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "당신은 20년 경력의 전문 주식 애널리스트입니다. 현재 시장 상황을 분석하고 투자자에게 최적의 종목을 추천하는 전문가입니다. 추천 종목은 반드시 JSON 형태로 응답해주세요."
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
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      const aiResponse = response.data.choices[0].message.content;
      console.log('🤖 GPT 응답:', aiResponse);
      
      // JSON 파싱 시도
      let recommendations;
      try {
        // JSON 부분만 추출
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          recommendations = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('JSON 형태를 찾을 수 없습니다.');
        }
      } catch (parseError) {
        console.error('❌ GPT 응답 파싱 실패:', parseError);
        return this.getDefaultRecommendations(marketType);
      }

      // 추천 종목에 실시간 가격 정보 추가
      const enrichedRecommendations = await this.enrichRecommendationsWithPrices(
        recommendations.stocks || recommendations.recommendations || [],
        marketType
      );

      return {
        success: true,
        data: {
          recommendations: enrichedRecommendations,
          marketAnalysis: recommendations.marketAnalysis || "시장 분석 정보를 가져오는 중입니다.",
          investmentStrategy: recommendations.investmentStrategy || "투자 전략을 검토 중입니다.",
          riskLevel: recommendations.riskLevel || "중간",
          lastUpdated: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('❌ AI 종목 추천 실패:', error);
      return this.getDefaultRecommendations(marketType);
    }
  }

  // 프롬프트 생성
  static generateRecommendationPrompt(marketType, investmentStyle) {
    const currentDate = new Date().toLocaleDateString('ko-KR');
    
    const marketInfo = {
      domestic: {
        market: "한국 주식시장 (KOSPI, KOSDAQ)",
        currency: "KRW",
        tradingHours: "09:00-15:30 (KST)"
      },
      overseas: {
        market: "미국 주식시장 (NYSE, NASDAQ)",
        currency: "USD",
        tradingHours: "23:30-06:00 (KST, 다음날)"
      }
    };

    const styleInfo = {
      conservative: "안정성을 중시하는 보수적 투자",
      balanced: "성장성과 안정성의 균형",
      aggressive: "높은 수익률을 추구하는 공격적 투자"
    };

    return `
현재 날짜: ${currentDate}
투자 시장: ${marketInfo[marketType].market}
투자 성향: ${styleInfo[investmentStyle]}

다음 조건에 맞는 5개의 종목을 추천해주세요:

1. ${marketType === 'domestic' ? '한국' : '미국'} 시장의 우량 종목
2. ${styleInfo[investmentStyle]} 스타일에 적합
3. 현재 시장 상황을 고려한 투자 가치
4. 향후 3-6개월 전망이 긍정적인 종목

응답 형식 (반드시 JSON):
{
  "stocks": [
    {
      "symbol": "종목코드",
      "name": "회사명",
      "sector": "업종",
      "reason": "추천 이유 (100자 이내)",
      "targetPrice": "목표가격",
      "riskLevel": "위험도 (낮음/보통/높음)",
      "timeHorizon": "투자기간 권장"
    }
  ],
  "marketAnalysis": "현재 시장 상황 분석 (200자 이내)",
  "investmentStrategy": "투자 전략 조언 (150자 이내)",
  "riskLevel": "전체 위험도 (낮음/보통/높음)"
}

${marketType === 'domestic' ? 
  '한국 종목은 삼성전자(005930), LG에너지솔루션(373220), SK하이닉스(000660) 등을 고려하되, 다양한 업종에서 선별해주세요.' : 
  '미국 종목은 AAPL, MSFT, GOOGL, TSLA, AMZN 등을 고려하되, 다양한 섹터에서 선별해주세요.'
}
`;
  }

  // 기본 추천 종목 (AI API 실패시 대체)
  static getDefaultRecommendations(marketType) {
    const domestic = {
      recommendations: [
        {
          symbol: "005930",
          name: "삼성전자",
          sector: "반도체",
          reason: "글로벌 메모리 반도체 1위 기업으로 AI, HBM 수요 증가 수혜 예상",
          targetPrice: "85000",
          riskLevel: "보통",
          timeHorizon: "6개월"
        },
        {
          symbol: "373220",
          name: "LG에너지솔루션",
          sector: "2차전지",
          reason: "전기차 시장 성장과 ESS 수요 확대로 지속 성장 전망",
          targetPrice: "450000",
          riskLevel: "보통",
          timeHorizon: "12개월"
        },
        {
          symbol: "207940",
          name: "삼성바이오로직스",
          sector: "바이오",
          reason: "글로벌 바이오의약품 위탁생산 시장 확대 수혜",
          targetPrice: "900000",
          riskLevel: "높음",
          timeHorizon: "18개월"
        },
        {
          symbol: "035420",
          name: "NAVER",
          sector: "IT서비스",
          reason: "AI 기술 발전과 클라우드 사업 성장 동력 확보",
          targetPrice: "220000",
          riskLevel: "보통",
          timeHorizon: "9개월"
        },
        {
          symbol: "003670",
          name: "포스코홀딩스",
          sector: "철강",
          reason: "2차전지 소재 사업 확장과 수소 사업 진출로 미래 성장 동력 확보",
          targetPrice: "380000",
          riskLevel: "보통",
          timeHorizon: "12개월"
        }
      ],
      marketAnalysis: "한국 시장은 반도체와 2차전지 관련주가 강세를 보이고 있으며, AI와 전기차 관련 테마주에 대한 관심이 높아지고 있습니다.",
      investmentStrategy: "기술주 중심의 포트폴리오 구성과 함께 전통 산업의 디지털 전환 수혜주를 선별 투자하는 것을 권장합니다.",
      riskLevel: "보통"
    };

    const overseas = {
      recommendations: [
        {
          symbol: "AAPL",
          name: "Apple Inc.",
          sector: "Technology",
          reason: "AI 기능 탑재 iPhone과 서비스 수익 확대로 지속 성장 전망",
          targetPrice: "200",
          riskLevel: "낮음",
          timeHorizon: "12개월"
        },
        {
          symbol: "MSFT",
          name: "Microsoft Corporation",
          sector: "Technology",
          reason: "OpenAI와의 협력으로 AI 시장 선도, 클라우드 사업 성장 지속",
          targetPrice: "450",
          riskLevel: "낮음",
          timeHorizon: "18개월"
        },
        {
          symbol: "NVDA",
          name: "NVIDIA Corporation",
          sector: "Semiconductors",
          reason: "AI 반도체 시장 독점적 지위와 데이터센터 수요 폭증",
          targetPrice: "1000",
          riskLevel: "높음",
          timeHorizon: "6개월"
        },
        {
          symbol: "GOOGL",
          name: "Alphabet Inc.",
          sector: "Technology",
          reason: "AI 검색과 클라우드 서비스 강화로 수익성 개선 기대",
          targetPrice: "180",
          riskLevel: "보통",
          timeHorizon: "12개월"
        },
        {
          symbol: "TSLA",
          name: "Tesla, Inc.",
          sector: "Automotive",
          reason: "전기차 시장 확대와 자율주행 기술 발전으로 장기 성장 동력 확보",
          targetPrice: "300",
          riskLevel: "높음",
          timeHorizon: "24개월"
        }
      ],
      marketAnalysis: "미국 시장은 AI 관련 기술주가 강세를 이어가고 있으며, 연준의 금리 정책 변화에 대한 기대감이 시장을 지지하고 있습니다.",
      investmentStrategy: "AI와 클라우드 관련 대형 기술주 중심의 투자와 함께 전기차 등 미래 성장 산업에 대한 장기 투자를 권장합니다.",
      riskLevel: "보통"
    };

    return {
      success: true,
      data: {
        ...(marketType === 'domestic' ? domestic : overseas),
        lastUpdated: new Date().toISOString()
      }
    };
  }

  // 추천 종목에 실시간 가격 정보 추가
  static async enrichRecommendationsWithPrices(recommendations, marketType) {
    const enrichedStocks = [];

    for (const stock of recommendations) {
      try {
        let priceData;
        
        if (marketType === 'domestic') {
          priceData = await kisService.getStockPrice(stock.symbol);
        } else {
          priceData = await kisService.getOverseasStockPrice(stock.symbol);
        }

        if (priceData.success) {
          enrichedStocks.push({
            ...stock,
            currentPrice: priceData.data.currentPrice,
            changeAmount: priceData.data.changeAmount,
            changeRate: priceData.data.changeRate,
            volume: priceData.data.volume,
            lastUpdated: new Date().toISOString()
          });
        } else {
          // 가격 정보를 가져올 수 없는 경우 기본값 추가
          enrichedStocks.push({
            ...stock,
            currentPrice: 0,
            changeAmount: 0,
            changeRate: 0,
            volume: 0,
            priceError: "가격 정보를 가져올 수 없습니다.",
            lastUpdated: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error(`❌ ${stock.symbol} 가격 정보 조회 실패:`, error);
        enrichedStocks.push({
          ...stock,
          currentPrice: 0,
          changeAmount: 0,
          changeRate: 0,
          volume: 0,
          priceError: "가격 정보 조회 실패",
          lastUpdated: new Date().toISOString()
        });
      }

      // API 호출 제한을 위한 지연
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return enrichedStocks;
  }

  // 특정 종목에 대한 상세 분석
  static async getDetailedAnalysis(stockCode, marketType = 'domestic') {
    try {
      console.log(`🔍 상세 분석 요청: ${stockCode}`);

      if (!process.env.OPENAI_API_KEY) {
        return this.getBasicAnalysis(stockCode, marketType);
      }

      // 현재 가격 정보 조회
      let priceData;
      if (marketType === 'domestic') {
        priceData = await kisService.getStockPrice(stockCode);
      } else {
        priceData = await kisService.getOverseasStockPrice(stockCode);
      }

      const prompt = `
종목: ${stockCode} (${priceData.data?.stockName || '알 수 없음'})
현재가: ${priceData.data?.currentPrice || 0}
전일 대비: ${priceData.data?.changeAmount || 0} (${priceData.data?.changeRate || 0}%)

이 종목에 대한 상세한 투자 분석을 해주세요:

1. 기업 개요 및 사업 영역
2. 최근 실적 및 재무 상태
3. 업종 전망 및 경쟁력
4. 주요 리스크 요인
5. 투자 의견 및 목표가

응답 형식 (JSON):
{
  "companyOverview": "기업 개요",
  "financialStatus": "재무 상태",
  "industryOutlook": "업종 전망",
  "risks": ["리스크1", "리스크2"],
  "investmentOpinion": "투자의견",
  "targetPrice": "목표가",
  "rating": "등급 (매수/보유/매도)"
}
`;

      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "당신은 주식 분석 전문가입니다. 기업의 재무제표, 시장 동향, 업종 분석을 통해 정확하고 객관적인 투자 의견을 제시합니다."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 1000,
        temperature: 0.5,
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      const aiResponse = response.data.choices[0].message.content;
      const analysis = JSON.parse(aiResponse);

      return {
        success: true,
        data: {
          ...analysis,
          currentPrice: priceData.data?.currentPrice || 0,
          priceChange: priceData.data?.changeAmount || 0,
          priceChangeRate: priceData.data?.changeRate || 0,
          lastUpdated: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('❌ 상세 분석 실패:', error);
      return this.getBasicAnalysis(stockCode, marketType);
    }
  }

  // 기본 분석 (AI API 실패시 대체)
  static getBasicAnalysis(stockCode, marketType) {
    return {
      success: true,
      data: {
        companyOverview: "기업 정보를 분석하고 있습니다.",
        financialStatus: "재무 상태를 검토하고 있습니다.",
        industryOutlook: "업종 전망을 분석하고 있습니다.",
        risks: ["시장 변동성", "업종 리스크"],
        investmentOpinion: "추가 분석이 필요합니다.",
        targetPrice: "분석 중",
        rating: "보유",
        currentPrice: 0,
        priceChange: 0,
        priceChangeRate: 0,
        lastUpdated: new Date().toISOString()
      }
    };
  }
}

module.exports = AIRecommendationService;