const { Pool } = require('pg');

let pool;

const connectDB = async () => {
  try {
    const config = {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      family: 4 // IPv4 강제

    };

    pool = new Pool(config);
    
    // 연결 테스트
    const client = await pool.connect();
    console.log('✅ PostgreSQL 데이터베이스 연결 성공');
    client.release();
    
    // 테이블 생성 및 업데이트
    await createTablesWithSafeUpdate();
  } catch (err) {
    console.error('❌ 데이터베이스 연결 실패:', err);
    process.exit(1);
  }
};

const createTablesWithSafeUpdate = async () => {
  try {
    const client = await pool.connect();
    
    console.log('🔍 기존 테이블 확인 및 안전한 업데이트...');

    // Users 테이블 생성 (IF NOT EXISTS 사용)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        google_id VARCHAR(255),
        kakao_id VARCHAR(255),
        email VARCHAR(255) UNIQUE,
        name VARCHAR(255) NOT NULL,
        avatar VARCHAR(500),
        phone VARCHAR(20),
        is_active BOOLEAN DEFAULT true,
        last_login_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 자동매매 세션 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS trading_sessions (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) UNIQUE NOT NULL,
        user_id INTEGER REFERENCES users(id),
        market_type VARCHAR(20) NOT NULL, -- 'domestic' or 'overseas'
        strategy_type VARCHAR(50) NOT NULL,
        investment_amount DECIMAL(15,2) NOT NULL,
        risk_level VARCHAR(20),
        selected_stocks JSONB,
        status VARCHAR(20) DEFAULT 'ACTIVE', -- 'ACTIVE', 'STOPPED', 'ERROR'
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP,
        final_profit DECIMAL(15,2) DEFAULT 0,
        total_orders INTEGER DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 거래 로그 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS trade_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        session_id VARCHAR(255),
        stock_code VARCHAR(20) NOT NULL,
        trade_type VARCHAR(10) NOT NULL, -- 'BUY' or 'SELL'
        quantity INTEGER NOT NULL,
        price DECIMAL(15,4) NOT NULL,
        order_number VARCHAR(255),
        profit_loss DECIMAL(15,2) DEFAULT 0,
        analysis_reason TEXT,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 계좌 로그 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS account_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        account_type VARCHAR(20) NOT NULL, -- 'domestic' or 'overseas'
        total_assets DECIMAL(15,2),
        available_cash DECIMAL(15,2),
        stock_value DECIMAL(15,2),
        profit_loss DECIMAL(15,2),
        logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // AI 추천 로그 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS recommendation_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        market_type VARCHAR(20) NOT NULL,
        investment_style VARCHAR(20) NOT NULL,
        recommendations JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 전략 분석 로그 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS strategy_analyses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        stock_code VARCHAR(20) NOT NULL,
        strategy_type VARCHAR(50) NOT NULL,
        analysis_result JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 인덱스 생성
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_trading_sessions_user_id ON trading_sessions(user_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_trade_logs_user_id ON trade_logs(user_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_trade_logs_session_id ON trade_logs(session_id);
    `);

    // Users 테이블에 제약조건 추가 (존재하지 않을 경우만)
    try {
      await client.query(`
        ALTER TABLE users 
        ADD CONSTRAINT uq_users_google_id UNIQUE (google_id);
      `);
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.log('⚠️ users google_id 제약조건 추가 실패:', err.message);
      }
    }

    try {
      await client.query(`
        ALTER TABLE users 
        ADD CONSTRAINT uq_users_kakao_id UNIQUE (kakao_id);
      `);
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.log('⚠️ users kakao_id 제약조건 추가 실패:', err.message);
      }
    }

    try {
      await client.query(`
        ALTER TABLE users 
        ADD CONSTRAINT ck_users_oauth CHECK (
          (google_id IS NOT NULL) OR (kakao_id IS NOT NULL)
        );
      `);
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.log('⚠️ users oauth 체크 제약조건 추가 실패:', err.message);
      }
    }

    client.release();
    console.log('✅ PostgreSQL 테이블 안전 업데이트 완료');
    
  } catch (err) {
    console.error('❌ 테이블 생성/업데이트 실패:', err);
    console.error('상세 오류:', err.message);
    throw err;
  }
};

const getPool = () => {
  if (!pool) {
    throw new Error('데이터베이스가 연결되지 않았습니다.');
  }
  return pool;
};

// PostgreSQL 쿼리 헬퍼 함수들
const query = async (text, params) => {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
};

module.exports = {
  connectDB,
  getPool,
  query
};