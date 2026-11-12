-- Validated broker-native MT5 OHLC history and quarantine.
-- Apply to goldstar_market_research_staging or goldstar_market_research_prod.
CREATE TABLE IF NOT EXISTS mt5_ohlc_bars (
  symbol TEXT NOT NULL CHECK(length(symbol) BETWEEN 1 AND 32),
  timeframe TEXT NOT NULL CHECK(timeframe IN ('M5','M15','H1','H4','D1')),
  bar_time_utc TEXT NOT NULL,
  time_msc INTEGER NOT NULL CHECK(time_msc > 0),
  open REAL NOT NULL CHECK(open > 0),
  high REAL NOT NULL CHECK(high > 0),
  low REAL NOT NULL CHECK(low > 0),
  close REAL NOT NULL CHECK(close > 0),
  tick_volume INTEGER NOT NULL CHECK(tick_volume >= 0),
  real_volume INTEGER NOT NULL CHECK(real_volume >= 0),
  spread_points INTEGER NOT NULL CHECK(spread_points >= 0),
  source_server TEXT NOT NULL,
  terminal_build INTEGER NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY(symbol,timeframe,bar_time_utc),
  CHECK(high >= open AND high >= close AND high >= low),
  CHECK(low <= open AND low <= close)
);

CREATE TABLE IF NOT EXISTS mt5_ohlc_quarantine (
  symbol TEXT,
  timeframe TEXT,
  bar_time_utc TEXT,
  time_msc INT,
  open REAL,
  high REAL,
  low REAL,
  close REAL,
  tick_volume INT,
  real_volume INT,
  spread_points INT,
  source_server TEXT,
  terminal_build INT,
  collected_at TEXT,
  quarantine_reason TEXT,
  quarantined_at TEXT
);
