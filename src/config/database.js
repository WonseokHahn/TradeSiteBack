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

    // TradingStrategies 테이블 (수정된 버전)
    await client.query(`
      CREATE TABLE IF NOT EXISTS trading_strategies (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        strategy_name VARCHAR(100),
        market_type VARCHAR(20) NOT NULL CHECK (market_type IN ('bull', 'bear')),
        region VARCHAR(20) NOT NULL CHECK (region IN ('domestic', 'global')),
        stocks JSONB NOT NULL, -- 여러 종목 정보를 JSON으로 저장
        is_active BOOLEAN DEFAULT false,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        expected_return DECIMAL(8,4),
        risk_level VARCHAR(20) DEFAULT 'Medium' CHECK (risk_level IN ('Low', 'Medium', 'High')),
        description VARCHAR(500),
        total_investment DECIMAL(15,2) DEFAULT 0,
        current_value DECIMAL(15,2) DEFAULT 0,
        total_return DECIMAL(15,2) DEFAULT 0,
        return_rate DECIMAL(8,4) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // TradingOrders 테이블 (수정된 버전)
    await client.query(`
      CREATE TABLE IF NOT EXISTS trading_orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        strategy_id INTEGER NOT NULL REFERENCES trading_strategies(id) ON DELETE CASCADE,
        stock_code VARCHAR(20) NOT NULL,
        stock_name VARCHAR(100),
        region VARCHAR(20) NOT NULL CHECK (region IN ('domestic', 'global')),
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

    // Portfolios 테이블 (수정된 버전)
    await client.query(`
      CREATE TABLE IF NOT EXISTS portfolios (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stock_code VARCHAR(20) NOT NULL,
        stock_name VARCHAR(100),
        region VARCHAR(20) NOT NULL CHECK (region IN ('domestic', 'global')),
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
        
        CONSTRAINT uq_portfolios_user_stock UNIQUE (user_id, stock_code, region)
      );
    `);

    // StockMaster 테이블 (수정된 버전)
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_master (
        id SERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        stock_name VARCHAR(100) NOT NULL,
        region VARCHAR(20) NOT NULL CHECK (region IN ('domestic', 'global')),
        market VARCHAR(20), -- KOSPI, KOSDAQ, NYSE, NASDAQ 등
        sector VARCHAR(50),
        industry VARCHAR(100),
        currency VARCHAR(10) DEFAULT 'KRW',
        listing_date DATE,
        is_active BOOLEAN DEFAULT true,
        description VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT uq_stock_master_code_region UNIQUE (stock_code, region)
      );
    `);

    // 기본 주식 데이터 삽입
    await client.query(`
      INSERT INTO stock_master (stock_code, stock_name, region, market, sector, currency) VALUES
      ('005930', '삼성전자', 'domestic', 'KOSPI', '반도체', 'KRW'),
      ('000660', 'SK하이닉스', 'domestic', 'KOSPI', '반도체', 'KRW'),
      ('035420', 'NAVER', 'domestic', 'KOSPI', '인터넷', 'KRW'),
      ('051910', 'LG화학', 'domestic', 'KOSPI', '화학', 'KRW'),
      ('006400', '삼성SDI', 'domestic', 'KOSPI', '배터리', 'KRW'),
      ('035720', '카카오', 'domestic', 'KOSPI', '인터넷', 'KRW'),
      ('207940', '삼성바이오로직스', 'domestic', 'KOSPI', '바이오', 'KRW'),
      ('373220', 'LG에너지솔루션', 'domestic', 'KOSPI', '배터리', 'KRW'),
      ('000270', '기아', 'domestic', 'KOSPI', '자동차', 'KRW'),
      ('068270', '셀트리온', 'domestic', 'KOSPI', '바이오', 'KRW'),
      
      ('AAPL', 'Apple Inc.', 'global', 'NASDAQ', 'Technology', 'USD'),
      ('MSFT', 'Microsoft Corp.', 'global', 'NASDAQ', 'Technology', 'USD'),
      ('GOOGL', 'Alphabet Inc.', 'global', 'NASDAQ', 'Technology', 'USD'),
      ('AMZN', 'Amazon.com Inc.', 'global', 'NASDAQ', 'E-commerce', 'USD'),
      ('TSLA', 'Tesla Inc.', 'global', 'NASDAQ', 'Automotive', 'USD'),
      ('META', 'Meta Platforms Inc.', 'global', 'NASDAQ', 'Social Media', 'USD'),
      ('NVDA', 'NVIDIA Corp.', 'global', 'NASDAQ', 'Semiconductors', 'USD'),
      ('NFLX', 'Netflix Inc.', 'global', 'NASDAQ', 'Entertainment', 'USD')
      ON CONFLICT (stock_code, region) DO NOTHING;
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
      CREATE INDEX IF NOT EXISTS idx_trading_orders_stock_code ON trading_orders(stock_code);
      CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON portfolios(user_id);
      CREATE INDEX IF NOT EXISTS idx_stock_master_code_region ON stock_master(stock_code, region);
      CREATE INDEX IF NOT EXISTS idx_trading_strategies_stocks ON trading_strategies USING GIN (stocks);
    `);

    client.release();
    console.log('✅ PostgreSQL 테이블 생성 및 기본 데이터 삽입 완료');
    
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