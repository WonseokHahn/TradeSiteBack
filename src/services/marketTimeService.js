// src/services/marketTimeService.js
class MarketTimeService {
  constructor() {
    this.marketHours = {
      // 한국 주식시장 시간 (KST)
      domestic: {
        open: { hour: 9, minute: 0 },
        close: { hour: 15, minute: 30 },
        lunchStart: { hour: 11, minute: 30 },
        lunchEnd: { hour: 12, minute: 30 }
      },
      // 미국 주식시장 시간 (EST/EDT 고려)
      us: {
        // 여름시간 (3월 둘째주 일요일 ~ 11월 첫째주 일요일)
        summer: {
          open: { hour: 22, minute: 30 }, // 한국시간 기준
          close: { hour: 5, minute: 0 }   // 다음날 한국시간
        },
        // 겨울시간
        winter: {
          open: { hour: 23, minute: 30 },
          close: { hour: 6, minute: 0 }
        }
      }
    };

    this.holidays = [
      // 2025년 한국 주식시장 휴장일
      '2025-01-01', // 신정
      '2025-01-28', // 설날 연휴
      '2025-01-29', // 설날
      '2025-01-30', // 설날 연휴
      '2025-03-01', // 삼일절
      '2025-05-05', // 어린이날
      '2025-05-06', // 대체공휴일
      '2025-06-06', // 현충일
      '2025-08-15', // 광복절
      '2025-09-06', // 추석 연휴
      '2025-09-08', // 추석
      '2025-09-09', // 추석 연휴
      '2025-10-03', // 개천절
      '2025-10-09', // 한글날
      '2025-12-25'  // 성탄절
    ];
  }

  // 현재 한국 시장이 열려있는지 확인
  isKoreanMarketOpen() {
    const now = new Date();
    const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000)); // UTC+9
    
    // 주말 확인
    const dayOfWeek = kst.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) { // 일요일(0) 또는 토요일(6)
      return false;
    }

    // 공휴일 확인
    const dateString = kst.toISOString().split('T')[0];
    if (this.holidays.includes(dateString)) {
      return false;
    }

    // 시간 확인
    const hour = kst.getHours();
    const minute = kst.getMinutes();
    const currentTime = hour * 60 + minute;

    const openTime = this.marketHours.domestic.open.hour * 60 + this.marketHours.domestic.open.minute;
    const closeTime = this.marketHours.domestic.close.hour * 60 + this.marketHours.domestic.close.minute;
    const lunchStart = this.marketHours.domestic.lunchStart.hour * 60 + this.marketHours.domestic.lunchStart.minute;
    const lunchEnd = this.marketHours.domestic.lunchEnd.hour * 60 + this.marketHours.domestic.lunchEnd.minute;

    // 장 시간 내이고 점심시간이 아닌 경우
    return (currentTime >= openTime && currentTime <= closeTime) &&
           !(currentTime >= lunchStart && currentTime < lunchEnd);
  }

  // 현재 미국 시장이 열려있는지 확인
  isUSMarketOpen() {
    const now = new Date();
    
    // 미국 동부시간 계산
    const estOffset = this.isDST(now) ? -4 : -5; // EDT(-4) 또는 EST(-5)
    const est = new Date(now.getTime() + (estOffset * 60 * 60 * 1000));
    
    // 주말 확인 (미국 기준)
    const dayOfWeek = est.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return false;
    }

    // 시간 확인 (미국 동부시간 기준)
    const hour = est.getHours();
    const minute = est.getMinutes();
    const currentTime = hour * 60 + minute;

    // 9:30 AM - 4:00 PM EST/EDT
    const openTime = 9 * 60 + 30; // 9:30
    const closeTime = 16 * 60;    // 4:00 PM

    return currentTime >= openTime && currentTime <= closeTime;
  }

  // 서머타임(DST) 확인
  isDST(date) {
    const year = date.getFullYear();
    
    // 3월 둘째주 일요일
    const marchSecondSunday = this.getNthDayOfMonth(year, 2, 0, 2); // 3월(2) 둘째주(2) 일요일(0)
    
    // 11월 첫째주 일요일
    const novemberFirstSunday = this.getNthDayOfMonth(year, 10, 0, 1); // 11월(10) 첫째주(1) 일요일(0)
    
    return date >= marchSecondSunday && date < novemberFirstSunday;
  }

  // 특정 월의 N번째 특정 요일 계산
  getNthDayOfMonth(year, month, dayOfWeek, n) {
    const firstDay = new Date(year, month, 1);
    const firstDayOfWeek = firstDay.getDay();
    
    let daysToAdd = (dayOfWeek - firstDayOfWeek + 7) % 7;
    daysToAdd += (n - 1) * 7;
    
    return new Date(year, month, 1 + daysToAdd);
  }

  // 다음 한국 시장 개장 시간 계산
  getNextKoreanMarketOpen() {
    const now = new Date();
    const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    
    let nextOpen = new Date(kst);
    
    // 현재 시간이 장 마감 후라면 다음날로
    const hour = kst.getHours();
    const minute = kst.getMinutes();
    const currentTime = hour * 60 + minute;
    const closeTime = this.marketHours.domestic.close.hour * 60 + this.marketHours.domestic.close.minute;
    
    if (currentTime >= closeTime) {
      nextOpen.setDate(nextOpen.getDate() + 1);
    }
    
    // 주말이면 다음 주 월요일로
    while (nextOpen.getDay() === 0 || nextOpen.getDay() === 6) {
      nextOpen.setDate(nextOpen.getDate() + 1);
    }
    
    // 공휴일이면 다음 영업일로
    while (this.holidays.includes(nextOpen.toISOString().split('T')[0])) {
      nextOpen.setDate(nextOpen.getDate() + 1);
      
      // 주말 체크
      while (nextOpen.getDay() === 0 || nextOpen.getDay() === 6) {
        nextOpen.setDate(nextOpen.getDate() + 1);
      }
    }
    
    // 시간을 장 시작 시간으로 설정
    nextOpen.setHours(this.marketHours.domestic.open.hour);
    nextOpen.setMinutes(this.marketHours.domestic.open.minute);
    nextOpen.setSeconds(0);
    nextOpen.setMilliseconds(0);
    
    return nextOpen;
  }

  // 시장 상태 문자열 반환
  getMarketStatus() {
    const koreanOpen = this.isKoreanMarketOpen();
    const usOpen = this.isUSMarketOpen();
    
    if (koreanOpen && usOpen) {
      return 'both_open';
    } else if (koreanOpen) {
      return 'korean_open';
    } else if (usOpen) {
      return 'us_open';
    } else {
      return 'closed';
    }
  }

  // 시장 상태 상세 정보
  getMarketStatusDetails() {
    const now = new Date();
    const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    
    return {
      korean: {
        isOpen: this.isKoreanMarketOpen(),
        nextOpen: this.getNextKoreanMarketOpen(),
        currentTime: kst
      },
      us: {
        isOpen: this.isUSMarketOpen(),
        isDST: this.isDST(now)
      },
      overall: this.getMarketStatus()
    };
  }

  // 자동매매 가능 시간인지 확인
  isTradingAllowed() {
    // 한국 시장이 열려있을 때만 자동매매 허용
    return this.isKoreanMarketOpen();
  }

  // 장 마감까지 남은 시간 (분 단위)
  getMinutesUntilMarketClose() {
    if (!this.isKoreanMarketOpen()) {
      return 0;
    }

    const now = new Date();
    const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    
    const hour = kst.getHours();
    const minute = kst.getMinutes();
    const currentTime = hour * 60 + minute;
    
    const closeTime = this.marketHours.domestic.close.hour * 60 + this.marketHours.domestic.close.minute;
    
    return Math.max(0, closeTime - currentTime);
  }

  // 점심시간인지 확인
  isLunchTime() {
    if (!this.isKoreanMarketOpen()) {
      return false;
    }

    const now = new Date();
    const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    
    const hour = kst.getHours();
    const minute = kst.getMinutes();
    const currentTime = hour * 60 + minute;
    
    const lunchStart = this.marketHours.domestic.lunchStart.hour * 60 + this.marketHours.domestic.lunchStart.minute;
    const lunchEnd = this.marketHours.domestic.lunchEnd.hour * 60 + this.marketHours.domestic.lunchEnd.minute;
    
    return currentTime >= lunchStart && currentTime < lunchEnd;
  }
}

module.exports = new MarketTimeService();