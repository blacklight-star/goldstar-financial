-- Independent one-minute market ticks for the selected MT5 Market Watch symbols.
-- Snapshot-linked legacy ticks remain untouched for backward compatibility.
CREATE TABLE IF NOT EXISTS mt5_live_ticks (
  account_login TEXT NOT NULL,
  symbol TEXT NOT NULL CHECK(length(symbol) BETWEEN 1 AND 32),
  time_msc INTEGER NOT NULL CHECK(time_msc > 0),
  bid REAL NOT NULL,
  ask REAL NOT NULL,
  last_price REAL NOT NULL,
  source_server TEXT NOT NULL,
  terminal_build INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(account_login, symbol, time_msc)
);

CREATE INDEX IF NOT EXISTS idx_mt5_live_ticks_symbol_time
  ON mt5_live_ticks(symbol, time_msc DESC);

CREATE INDEX IF NOT EXISTS idx_mt5_live_ticks_observed
  ON mt5_live_ticks(observed_at);
