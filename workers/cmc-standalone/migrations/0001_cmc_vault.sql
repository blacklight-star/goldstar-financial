CREATE TABLE IF NOT EXISTS cmc_bootstrap_tokens (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE IF NOT EXISTS cmc_admin_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cmc_credentials (
  provider TEXT PRIMARY KEY,
  ciphertext_b64 TEXT NOT NULL,
  iv_b64 TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
