import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432'),
  database: process.env.PG_DATABASE || 'openclaw',
  user: process.env.PG_USER || 'openclaw',
  password: process.env.PG_PASSWORD || 'openclaw',
  max: 10,
});

// ── Schema initialization ────────────────────────────────────────────
export async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_decisions (
        id            SERIAL PRIMARY KEY,
        decision_id   TEXT UNIQUE NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tier          TEXT NOT NULL,              -- 'groq', 'openclaw', 'fallback'
        reasoning     TEXT,
        snapshot_json JSONB,                      -- inventory state at decision time
        orders_json   JSONB NOT NULL DEFAULT '[]' -- [{itemId, quantity, reason}]
      );

      CREATE TABLE IF NOT EXISTS decision_orders (
        id              SERIAL PRIMARY KEY,
        decision_id     TEXT NOT NULL REFERENCES agent_decisions(decision_id),
        item_id         TEXT NOT NULL,
        quantity_ordered INT NOT NULL,
        quantity_arrived INT,                     -- filled when order delivers
        quantity_sold    INT DEFAULT 0,           -- units from this order that got sold
        quantity_expired INT DEFAULT 0,           -- units from this order that expired
        procurement_id   TEXT,                    -- links to the pending order orderId
        ordered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        arrived_at      TIMESTAMPTZ,
        resolved_at     TIMESTAMPTZ,              -- when all units sold or expired
        outcome         TEXT                      -- 'pending','delivered','partial_waste','full_waste','fully_sold'
      );

      CREATE TABLE IF NOT EXISTS agent_performance (
        id          SERIAL PRIMARY KEY,
        item_id     TEXT NOT NULL,
        computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        window_min  INT NOT NULL DEFAULT 10,      -- rolling window in minutes
        total_ordered   INT NOT NULL DEFAULT 0,
        total_arrived   INT NOT NULL DEFAULT 0,
        total_sold      INT NOT NULL DEFAULT 0,
        total_expired   INT NOT NULL DEFAULT 0,
        efficiency      REAL,                     -- sold / arrived
        waste_rate      REAL,                     -- expired / arrived
        avg_order_size  REAL
      );

      CREATE INDEX IF NOT EXISTS idx_decisions_created ON agent_decisions(created_at);
      CREATE INDEX IF NOT EXISTS idx_decision_orders_decision ON decision_orders(decision_id);
      CREATE INDEX IF NOT EXISTS idx_decision_orders_item ON decision_orders(item_id);
      CREATE INDEX IF NOT EXISTS idx_decision_orders_procurement ON decision_orders(procurement_id);
      CREATE INDEX IF NOT EXISTS idx_performance_item ON agent_performance(item_id, computed_at);
    `);
    console.log('[DB] Schema initialized');
  } finally {
    client.release();
  }
}

export function query(text, params) {
  return pool.query(text, params);
}

export async function getClient() {
  return pool.connect();
}

export default pool;
