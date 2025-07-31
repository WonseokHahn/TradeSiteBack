  const { Pool } = require('pg');

let pool;

const connectDB = async () => {
  try {
    const config = {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    };

    pool = new Pool(config);
    
    // 연결 테스트
    const client = await pool.connect();
    console.log('✅ PostgreSQL 데이터베이스 연결 성공');
    client.release();
    
    // 테이블 생성
    await createTables();
  } catch (err) {
    console.error('❌ 데이터베이스 연결 실패:', err);
    process.exit(1);
  }
};

const createTables = async () => {
  try {
    const client = await pool.connect();
    
    // Users 테이블
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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT uq_users_google_id UNIQUE (google_id),
        CONSTRAINT uq_users_kakao_id UNIQUE (kakao_id),
        CONSTRAINT ck_users_oauth CHECK (
          (google_id IS NOT NULL) OR (kakao_id IS NOT NULL)
        )
      );
    `);

    // TradingStrategies 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS trading_strategies (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        strategy_name VARCHAR(100),
        market_type VARCHAR(20) NOT NULL CHECK (market_type IN ('bull', 'bear')),
        stock_code VARCHAR(20) NOT NULL,
        stock_name VARCHAR(100),
        allocation DECIMAL(5,2) NOT NULL CHECK (allocation > 0 AND allocation <= 100),
        is_active BOOLEAN DEFAULT false,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        expected_return DECIMAL(8,4),
        risk_level VARCHAR(20) DEFAULT 'Medium' CHECK (risk_level IN ('Low', 'Medium', 'High')),
        description VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // TradingOrders 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS trading_orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        strategy_id INTEGER NOT NULL REFERENCES trading_strategies(id) ON DELETE CASCADE,
        stock_code VARCHAR(20) NOT NULL,
        stock_name VARCHAR(100),
        order_type VARCHAR(10) NOT NULL CHECK (order_type IN ('BUY', 'SELL')),
        order_method VARCHAR(20) DEFAULT 'MARKET' CHECK (order_method IN ('MARKET', 'LIMIT', 'STOP')),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        order_price DECIMAL(12,2),
        executed_price DECIMAL(12,2),
        executed_quantity INTEGER DEFAULT 0,
        total_amount DECIMAL(15,2),
        fees DECIMAL(10,2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED')),
        error_message VARCHAR(500),
        broker_order_id VARCHAR(100),
        order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        executed_at TIMESTAMP,
        cancelled_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Portfolios 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS portfolios (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stock_code VARCHAR(20) NOT NULL,
        stock_name VARCHAR(100),
        total_quantity INTEGER DEFAULT 0,
        available_quantity INTEGER DEFAULT 0,
        average_price DECIMAL(12,2) DEFAULT 0,
        current_price DECIMAL(12,2) DEFAULT 0,
        total_investment DECIMAL(15,2) DEFAULT 0,
        current_value DECIMAL(15,2) DEFAULT 0,
        unrealized_pnl DECIMAL(15,2) DEFAULT 0,
        realized_pnl DECIMAL(15,2) DEFAULT 0,
        return_rate DECIMAL(8,4) DEFAULT 0,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT uq_portfolios_user_stock UNIQUE (user_id, stock_code)
      );
    `);

    // StockMaster 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_master (
        id SERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL UNIQUE,
        stock_name VARCHAR(100) NOT NULL,
        market VARCHAR(20) NOT NULL CHECK (market IN ('KOSPI', 'KOSDAQ', 'KONEX')),
        sector VARCHAR(50),
        industry VARCHAR(100),
        listing_date DATE,
        is_active BOOLEAN DEFAULT true,
        description VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 인덱스 생성
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
      CREATE INDEX IF NOT EXISTS idx_users_kakao_id ON users(kakao_id);
      CREATE INDEX IF NOT EXISTS idx_trading_strategies_user_id ON trading_strategies(user_id);
      CREATE INDEX IF NOT EXISTS idx_trading_strategies_is_active ON trading_strategies(is_active);
      CREATE INDEX IF NOT EXISTS idx_trading_orders_user_id ON trading_orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_trading_orders_strategy_id ON trading_orders(strategy_id);
      CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON portfolios(user_id);
      CREATE INDEX IF NOT EXISTS idx_stock_master_stock_code ON stock_master(stock_code);
    `);

    client.release();
    console.log('✅ PostgreSQL 테이블 생성 완료');
    
  } catch (err) {
    console.error('❌ 테이블 생성 실패:', err);
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