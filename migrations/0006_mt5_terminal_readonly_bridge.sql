-- Demo-only, read-only local MT5 terminal snapshots. Apply to goldstar_market_research_staging.
CREATE TABLE IF NOT EXISTS mt5_terminal_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  account_login TEXT NOT NULL,
  account_server TEXT NOT NULL,
  currency TEXT NOT NULL,
  leverage INTEGER NOT NULL,
  balance REAL NOT NULL,
  equity REAL NOT NULL,
  margin REAL NOT NULL,
  free_margin REAL NOT NULL,
  margin_level REAL NOT NULL,
  terminal_connected INTEGER NOT NULL,
  trade_allowed INTEGER NOT NULL,
  positions_count INTEGER NOT NULL,
  ticks_count INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mt5_snapshots_received ON mt5_terminal_snapshots(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_mt5_snapshots_account ON mt5_terminal_snapshots(account_login, received_at DESC);

CREATE TABLE IF NOT EXISTS mt5_positions (
  snapshot_id TEXT NOT NULL,
  position_ticket TEXT NOT NULL,
  symbol TEXT NOT NULL,
  position_type TEXT NOT NULL,
  volume REAL NOT NULL,
  price_open REAL NOT NULL,
  price_current REAL NOT NULL,
  stop_loss REAL NOT NULL,
  take_profit REAL NOT NULL,
  profit REAL NOT NULL,
  swap REAL NOT NULL,
  opened_at TEXT,
  PRIMARY KEY(snapshot_id, position_ticket)
);
CREATE INDEX IF NOT EXISTS idx_mt5_positions_symbol ON mt5_positions(symbol, snapshot_id);

CREATE TABLE IF NOT EXISTS mt5_symbol_ticks (
  snapshot_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  bid REAL NOT NULL,
  ask REAL NOT NULL,
  last_price REAL NOT NULL,
  time_msc INTEGER NOT NULL,
  PRIMARY KEY(snapshot_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_mt5_ticks_symbol ON mt5_symbol_ticks(symbol, snapshot_id);
