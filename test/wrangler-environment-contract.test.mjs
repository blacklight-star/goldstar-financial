import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("production and staging D1 bindings remain isolated", async () => {
  const production = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
  const staging = await readFile(new URL("../wrangler.staging.toml", import.meta.url), "utf8");

  assert.match(production, /binding = "DB"\s+database_name = "goldstar_nds_prod"\s+database_id = "17b4c44d-d9c4-4574-86e6-f36cfce911aa"/);
  assert.match(production, /binding = "MARKET_DB"\s+database_name = "goldstar_market_research_prod"\s+database_id = "7703d149-e28e-4105-87a3-1f86e86b962a"/);
  assert.doesNotMatch(production, /goldstar_nds_staging|goldstar_market_research_staging|tradingview_events/);

  assert.match(staging, /binding = "DB"\s+database_name = "goldstar_nds_staging"\s+database_id = "274a18a3-0d7e-402c-9ae8-904aa16cd0ff"/);
  assert.match(staging, /binding = "MARKET_DB"\s+database_name = "goldstar_market_research_staging"\s+database_id = "e5978640-6035-41fe-8947-4e6fc58c5a92"/);
  assert.doesNotMatch(staging, /goldstar_nds_prod|goldstar_market_research_prod/);

  const tvProduction = await readFile(new URL("../wrangler.tv-ingest.production.toml", import.meta.url), "utf8");
  const cmcProduction = await readFile(new URL("../wrangler.cmc.production.toml", import.meta.url), "utf8");

  assert.match(tvProduction, /name = "tv-ingest"/);
  assert.match(tvProduction, /binding = "DB"\s+database_name = "goldstar_market_research_prod"\s+database_id = "7703d149-e28e-4105-87a3-1f86e86b962a"/);
  assert.match(tvProduction, /TV_WEBHOOK_SECRET/);

  assert.match(cmcProduction, /name = "trading-research-agent"/);
  assert.match(cmcProduction, /binding = "MARKET_DB"\s+database_name = "goldstar_market_research_prod"\s+database_id = "7703d149-e28e-4105-87a3-1f86e86b962a"/);
  assert.match(cmcProduction, /CMC_API_KEY/);
  assert.match(cmcProduction, /INGEST_AUTH_TOKEN/);
});
