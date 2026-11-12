import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("CMC ingestion uses dedicated D1, bearer authorization, and no public one-shot route", async () => {
  const source = await readFile(new URL("../workers/trading-research-agent-cmc/src/worker.js", import.meta.url), "utf8");
  const config = await readFile(new URL("../wrangler.cmc.production.toml", import.meta.url), "utf8");

  assert.match(source, /env\.MARKET_DB/);
  assert.match(source, /INSERT INTO cmc_ingestion_runs/);
  assert.match(source, /INSERT INTO cmc_quotes/);
  assert.match(source, /env\.MARKET_DB\.batch/);
  assert.match(source, /headers\.get\("authorization"\)/);
  assert.match(source, /Bearer /);
  assert.match(source, /constantTimeEqual/);
  assert.match(source, /url\.pathname === "\/cmc\/quotes"/);
  assert.match(source, /url\.pathname === "\/discover"/);
  assert.match(source, /TradingView discovery endpoint has been retired/);
  assert.match(source, /}, 410\)/);
  assert.doesNotMatch(source, /handlePreviewOnceBtc/);
  assert.doesNotMatch(source, /cmc\/quotes-once/);
  assert.doesNotMatch(source, /env\.DB/);
  assert.doesNotMatch(source, /searchParams\.get\(["']key["']\)/);

  assert.match(config, /name = "trading-research-agent"/);
  assert.match(config, /binding = "MARKET_DB"/);
  assert.match(config, /goldstar_market_research_prod/);
  assert.match(config, /7703d149-e28e-4105-87a3-1f86e86b962a/);
  assert.match(config, /CMC_API_KEY/);
  assert.match(config, /INGEST_AUTH_TOKEN/);
});
