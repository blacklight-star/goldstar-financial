CREATE TABLE IF NOT EXISTS gs_worker_locks (
  lock_name TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL,
  lease_until_ms INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gs_ai_daily_budget (
  day_utc TEXT PRIMARY KEY,
  reserved_neurons INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
