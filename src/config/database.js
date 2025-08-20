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

    // 자동매매 설정 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS auto_trading_configs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        strategy VARCHAR(50) NOT NULL,
        strategy_params JSONB,
        stocks JSONB NOT NULL,
        investment_amount BIGINT NOT NULL,
        allocation_method VARCHAR(20) DEFAULT 'equal',
        stop_loss DECIMAL(5,2),
        take_profit DECIMAL(5,2),
        status VARCHAR(20) DEFAULT 'stopped',
        started_at TIMESTAMP,
        stopped_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 거래 기록 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS trading_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        config_id INTEGER REFERENCES auto_trading_configs(id) ON DELETE SET NULL,
        stock_code VARCHAR(10) NOT NULL,
        stock_name VARCHAR(100) NOT NULL,
        trade_type VARCHAR(10) NOT NULL CHECK (trade_type IN ('buy', 'sell')),
        quantity INTEGER NOT NULL,
        price INTEGER NOT NULL,
        amount BIGINT NOT NULL,
        fee INTEGER DEFAULT 0,
        order_id VARCHAR(50),
        status VARCHAR(20) DEFAULT 'pending',
        reason VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 포트폴리오 스냅샷 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS portfolio_snapshots (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        total_assets BIGINT NOT NULL,
        cash_balance BIGINT NOT NULL,
        stock_value BIGINT NOT NULL,
        total_pnl BIGINT NOT NULL,
        total_pnl_percent DECIMAL(10,4) NOT NULL,
        snapshot_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, snapshot_date)
      );
    `);

    // AI 분석 결과 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_analysis_results (
        id SERIAL PRIMARY KEY,
        stock_code VARCHAR(10) NOT NULL,
        stock_name VARCHAR(100) NOT NULL,
        analysis_type VARCHAR(20) NOT NULL,
        score INTEGER NOT NULL,
        reason TEXT,
        technical_indicators JSONB,
        market_sentiment VARCHAR(20),
        risk_level VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 백테스트 결과 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS backtest_results (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        strategy VARCHAR(50) NOT NULL,
        strategy_params JSONB,
        stocks JSONB NOT NULL,
        period VARCHAR(20) NOT NULL,
        initial_capital BIGINT NOT NULL,
        final_capital BIGINT NOT NULL,
        total_return BIGINT NOT NULL,
        total_return_percent DECIMAL(10,4) NOT NULL,
        max_drawdown DECIMAL(10,4) NOT NULL,
        sharpe_ratio DECIMAL(10,4),
        total_trades INTEGER NOT NULL,
        win_rate DECIMAL(5,2) NOT NULL,
        profit_factor DECIMAL(10,4),
        detailed_results JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 인덱스 생성
    try {
      await client.query('CREATE INDEX IF NOT EXISTS idx_trading_history_user_date ON trading_history(user_id, created_at DESC)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_trading_history_stock_code ON trading_history(stock_code)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_auto_trading_configs_user_status ON auto_trading_configs(user_id, status)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_ai_analysis_stock_date ON ai_analysis_results(stock_code, created_at DESC)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user_date ON portfolio_snapshots(user_id, snapshot_date DESC)');
    } catch (error) {
      console.log('⚠️ 인덱스 생성 중 일부 오류 (무시 가능):', error.message);
    }

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