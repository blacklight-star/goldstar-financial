CREATE TABLE IF NOT EXISTS gs_worker_locks (
  lock_name TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL,
  lease_until_ms INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
