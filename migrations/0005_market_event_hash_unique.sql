-- Enforce one normalized projection per raw TradingView event.
-- Apply only to goldstar_market_research_staging.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gs_market_events_event_hash
  ON gs_market_events (event_hash)
  WHERE event_hash IS NOT NULL;
