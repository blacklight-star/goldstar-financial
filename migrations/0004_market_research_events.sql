-- Dedicated market-research event store.
-- Apply only to goldstar_market_research_staging (and later its separately
-- provisioned production counterpart). Do not apply to the NDS knowledge DB.
-- The TradingView ingest Worker must bind its DB to this same database before
-- the Financial L2 MARKET_DB binding is enabled.

CREATE TABLE IF NOT EXISTS tv_events (
  id TEXT PRIMARY KEY,
  event_hash TEXT NOT NULL UNIQUE,
  received_at TEXT NOT NULL,
  symbol TEXT,
  exchange_name TEXT,
  timeframe TEXT,
  event_type TEXT,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tv_events_received_at
  ON tv_events (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_tv_events_symbol_time
  ON tv_events (symbol, timeframe, received_at DESC);

CREATE TABLE IF NOT EXISTS gs_market_events (
  id TEXT PRIMARY KEY,
  event_hash TEXT,
  received_at TEXT,
  symbol TEXT,
  timeframe TEXT,
  event_type TEXT,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_gs_market_events_received_at
  ON gs_market_events (received_at DESC);
