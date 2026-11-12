-- CoinMarketCap crypto quote ingestion schema.
-- Apply only to goldstar_market_research_staging and its separately
-- provisioned production counterpart. Never apply to the NDS knowledge DB.

CREATE TABLE IF NOT EXISTS cmc_quotes (
  cmc_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  price REAL,
  volume_24h REAL,
  market_cap REAL,
  percent_change_1h REAL,
  percent_change_24h REAL,
  percent_change_7d REAL,
  cmc_rank INTEGER,
  quote_last_updated TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (cmc_id, quote_currency, quote_last_updated)
);

CREATE INDEX IF NOT EXISTS idx_cmc_quotes_symbol_updated
  ON cmc_quotes (symbol, quote_last_updated DESC);

CREATE INDEX IF NOT EXISTS idx_cmc_quotes_ingested_at
  ON cmc_quotes (ingested_at DESC);

CREATE TABLE IF NOT EXISTS cmc_ingestion_runs (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  symbols TEXT NOT NULL,
  records_written INTEGER NOT NULL DEFAULT 0,
  provider_status INTEGER,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_cmc_ingestion_runs_started_at
  ON cmc_ingestion_runs (started_at DESC);
