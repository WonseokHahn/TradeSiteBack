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

    // StockMaster 테이블 - 안전한 생성 및 컬럼 추가
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_master (
        id SERIAL PRIMARY KEY,
        stock_code VARCHAR(20) NOT NULL,
        stock_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // stock_master 테이블에 누락된 컬럼들 안전하게 추가
    const columnsToAdd = [
      'region VARCHAR(20)',
      'market VARCHAR(20)',
      'sector VARCHAR(50)',
      'industry VARCHAR(100)', 
      'currency VARCHAR(10) DEFAULT \'KRW\'',
      'listing_date DATE',
      'is_active BOOLEAN DEFAULT true',
      'description VARCHAR(500)'
    ];

    for (const column of columnsToAdd) {
      try {
        await client.query(`ALTER TABLE stock_master ADD COLUMN IF NOT EXISTS ${column};`);
        console.log(`✅ stock_master에 컬럼 추가: ${column.split(' ')[0]}`);
      } catch (err) {
        console.log(`⚠️ stock_master 컬럼 추가 실패 (${column.split(' ')[0]}):`, err.message);
      }
    }

    // stock_master 제약조건 추가
    try {
      await client.query(`
        ALTER TABLE stock_master 
        ADD CONSTRAINT ck_stock_master_region 
        CHECK (region IN ('domestic', 'global'));
      `);
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.log('⚠️ stock_master region 제약조건 추가 실패:', err.message);
      }
    }

    try {
      await client.query(`
        ALTER TABLE stock_master 
        ADD CONSTRAINT uq_stock_master_code_region 
        UNIQUE (stock_code, region);
      `);
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.log('⚠️ stock_master 유니크 제약조건 추가 실패:', err.message);
      }
    }

    // TradingStrategies 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS trading_strategies (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        strategy_name VARCHAR(100),
        market_type VARCHAR(20) NOT NULL,
        region VARCHAR(20) NOT NULL,
        stocks JSONB NOT NULL,
        is_active BOOLEAN DEFAULT false,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        expected_return DECIMAL(8,4),
        risk_level VARCHAR(20) DEFAULT 'Medium',
        description VARCHAR(500),
        total_investment DECIMAL(15,2) DEFAULT 0,
        current_value DECIMAL(15,2) DEFAULT 0,
        total_return DECIMAL(15,2) DEFAULT 0,
        return_rate DECIMAL(8,4) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // trading_strategies 제약조건 추가
    try {
      await client.query(`
        ALTER TABLE trading_strategies 
        ADD CONSTRAINT fk_trading_strategies_user 
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
      `);
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.log('⚠️ trading_strategies 외래키 제약조건 추가 실패:', err.message);
      }
    }

    // TradingOrders 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS trading_orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        strategy_id INTEGER NOT NULL,
        stock_code VARCHAR(20) NOT NULL,
        stock_name VARCHAR(100),
        region VARCHAR(20) NOT NULL,
        order_type VARCHAR(10) NOT NULL,
        order_method VARCHAR(20) DEFAULT 'MARKET',
        quantity INTEGER NOT NULL,
        order_price DECIMAL(12,2),
        executed_price DECIMAL(12,2),
        executed_quantity INTEGER DEFAULT 0,
        total_amount DECIMAL(15,2),
        fees DECIMAL(10,2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'PENDING',
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
        user_id INTEGER NOT NULL,
        stock_code VARCHAR(20) NOT NULL,
        stock_name VARCHAR(100),
        region VARCHAR(20) NOT NULL,
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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ 모든 테이블 생성/업데이트 완료');

    // 기본 주식 데이터 삽입 (ON CONFLICT로 중복 방지)
    try {
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
        ON CONFLICT (stock_code, region) DO UPDATE SET
          stock_name = EXCLUDED.stock_name,
          market = EXCLUDED.market,
          sector = EXCLUDED.sector,
          currency = EXCLUDED.currency;
      `);
      console.log('✅ 기본 주식 데이터 삽입/업데이트 완료');
    } catch (err) {
      console.log('⚠️ 기본 주식 데이터 삽입 실패 (유니크 제약조건 미설정):', err.message);
      // 유니크 제약조건이 없을 수 있으므로 개별 INSERT 시도
      console.log('🔄 개별 INSERT로 재시도...');
      
      const stocks = [
        ['005930', '삼성전자', 'domestic', 'KOSPI', '반도체', 'KRW'],
        ['000660', 'SK하이닉스', 'domestic', 'KOSPI', '반도체', 'KRW'],
        ['AAPL', 'Apple Inc.', 'global', 'NASDAQ', 'Technology', 'USD'],
        ['MSFT', 'Microsoft Corp.', 'global', 'NASDAQ', 'Technology', 'USD']
      ];
      
      for (const [code, name, region, market, sector, currency] of stocks) {
        try {
          await client.query(`
            INSERT INTO stock_master (stock_code, stock_name, region, market, sector, currency) 
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [code, name, region, market, sector, currency]);
        } catch (insertErr) {
          // 중복 데이터는 무시
        }
      }
    }

    // 인덱스 생성 (존재하지 않을 경우만)
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
      'CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)', 
      'CREATE INDEX IF NOT EXISTS idx_users_kakao_id ON users(kakao_id)',
      'CREATE INDEX IF NOT EXISTS idx_trading_strategies_user_id ON trading_strategies(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_trading_strategies_is_active ON trading_strategies(is_active)',
      'CREATE INDEX IF NOT EXISTS idx_trading_orders_user_id ON trading_orders(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_trading_orders_strategy_id ON trading_orders(strategy_id)',
      'CREATE INDEX IF NOT EXISTS idx_trading_orders_stock_code ON trading_orders(stock_code)',
      'CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON portfolios(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_stock_master_code_region ON stock_master(stock_code, region)'
    ];

    for (const indexQuery of indexes) {
      try {
        await client.query(indexQuery);
      } catch (err) {
        console.log(`⚠️ 인덱스 생성 실패: ${err.message}`);
      }
    }

    // JSONB 인덱스는 별도 처리
    try {
      await client.query('CREATE INDEX IF NOT EXISTS idx_trading_strategies_stocks ON trading_strategies USING GIN (stocks)');
    } catch (err) {
      console.log('⚠️ JSONB 인덱스 생성 실패:', err.message);
    }

    console.log('✅ 인덱스 생성 완료');

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