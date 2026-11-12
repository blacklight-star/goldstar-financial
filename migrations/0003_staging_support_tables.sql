CREATE TABLE IF NOT EXISTS gs_audit_log (
  event_id TEXT PRIMARY KEY,
  actor_agent_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gs_audit_log_resource
  ON gs_audit_log (resource_type, resource_id, created_at);

CREATE TABLE IF NOT EXISTS tv_events (
  id TEXT PRIMARY KEY,
  event_hash TEXT UNIQUE,
  received_at TEXT NOT NULL,
  symbol TEXT,
  exchange_name TEXT,
  timeframe TEXT,
  event_type TEXT,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tv_events_received_at
  ON tv_events (received_at);

CREATE TABLE IF NOT EXISTS gs_market_events (
  id TEXT PRIMARY KEY,
  event_hash TEXT,
  received_at TEXT NOT NULL,
  symbol TEXT,
  timeframe TEXT,
  event_type TEXT,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gs_market_events_received_at
  ON gs_market_events (received_at);
