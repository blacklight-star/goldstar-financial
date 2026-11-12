import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const L1_KEY = "l1-bridge-test-key";
function makeMarketDb() {
  const state = { queries: [] };
  const latest = { snapshot_id: "snap-001", received_at: "2026-11-12T20:58:58.459Z", account_login: "8096845", account_server: "AMarkets-Demo", currency: "USD", leverage: 100, balance: 10000, equity: 10000, margin: 0, free_margin: 10000, margin_level: 0, terminal_connected: 1, trade_allowed: 1, positions_count: 0, ticks_count: 30 };
  const DB = {
    prepare(sql) {
      const entry = { sql, params: [] };
      state.queries.push(entry);
      return {
        bind(...params) { entry.params = params; return this; },
        async first() {
          if (/COUNT\(\*\)/i.test(sql)) return { snapshots_total: 400, last_received_at: latest.received_at };
          if (/FROM mt5_terminal_snapshots/i.test(sql)) return latest;
          return null;
        },
        async all() {
          if (/FROM mt5_positions/i.test(sql)) return { results: [] };
          if (/FROM mt5_symbol_ticks/i.test(sql)) return { results: [{ symbol: "EURUSD", bid: 1.08, ask: 1.081, last_price: 1.0805, time_msc: 1794517138459 }] };
          if (/FROM mt5_ohlc_bars/i.test(sql)) return { results: [{ symbol: "XAUUSD", timeframe: "M15", bar_time_utc: "2026-11-12T20:45:00.000Z", time_msc: 1794516300000, open: 2000, high: 2010, low: 1990, close: 2005, tick_volume: 12, real_volume: 0, spread_points: 20, source_server: "AMarkets-Demo", terminal_build: 5000, collected_at: "2026-11-12T20:46:00.000Z" }] };
          return { results: [] };
        }
      };
    }
  };
  return { DB, state, latest };
}
function env(overrides = {}) {
  const market = makeMarketDb();
  return { market, bindings: { API_KEY: "l2-api-test-key", L1_BRIDGE_KEY: L1_KEY, MARKET_DB: market.DB, ...overrides } };
}
function get(path, headers = {}) {
  return new Request("https://financial.example" + path, { method: "GET", headers });
}

test("MT5 status is available to the L1 bridge and exposes snapshot counts", async () => {
  const { market, bindings } = env();
  const response = await worker.fetch(get("/mt5/status", { "X-Goldstar-Bridge-Key": L1_KEY }), bindings, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.snapshots_total, 400);
  assert.equal(body.mode, "demo_read_only");
  assert.equal(body.latest.account_login, "8096845");
  assert.ok(market.state.queries.every(q => /^SELECT\b/i.test(q.sql.trim())));
});

test("MT5 endpoints reject the general API key even when it is valid for other L2 routes", async () => {
  const { market, bindings } = env();
  const response = await worker.fetch(get("/mt5/status", { "X-API-Key": "l2-api-test-key" }), bindings, {});
  assert.equal(response.status, 401);
  assert.equal(market.state.queries.length, 0);
});

test("MT5 latest joins positions and ticks only to the newest snapshot", async () => {
  const { market, bindings } = env();
  const response = await worker.fetch(get("/mt5/latest", { "X-Goldstar-Bridge-Key": L1_KEY }), bindings, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.available, true);
  assert.equal(body.snapshot.snapshot_id, "snap-001");
  assert.equal(body.ticks.length, 1);
  assert.equal(body.positions.length, 0);
  assert.deepEqual(market.state.queries[1].params, ["snap-001"]);
  assert.deepEqual(market.state.queries[2].params, ["snap-001"]);
  assert.ok(market.state.queries.every(q => /^SELECT\b/i.test(q.sql.trim())));
});

test("MT5 history query validates symbol, timeframe and row limit before database access", async () => {
  const { market, bindings } = env();
  const invalid = await worker.fetch(get("/mt5/history?symbol=XAUUSD&timeframe=M1", { "X-Goldstar-Bridge-Key": L1_KEY }), bindings, {});
  assert.equal(invalid.status, 400);
  assert.equal(market.state.queries.length, 0);
  const response = await worker.fetch(get("/mt5/history?symbol=xauusd&timeframe=m15&limit=100", { "X-Goldstar-Bridge-Key": L1_KEY }), bindings, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.symbol, "XAUUSD");
  assert.equal(body.timeframe, "M15");
  assert.equal(body.returned, 1);
  assert.deepEqual(market.state.queries[0].params, ["XAUUSD", "M15", 100]);
  assert.match(market.state.queries[0].sql, /^SELECT\b/i);
});

test("MT5 reads fail closed without the dedicated Market DB binding", async () => {
  const { bindings } = env({ MARKET_DB: undefined });
  const response = await worker.fetch(get("/mt5/latest", { "X-Goldstar-Bridge-Key": L1_KEY }), bindings, {});
  assert.equal(response.status, 503);
});

test("MT5 read endpoints accept GET only", async () => {
  const { bindings } = env();
  const response = await worker.fetch(new Request("https://financial.example/mt5/status", { method: "POST", headers: { "X-Goldstar-Bridge-Key": L1_KEY } }), bindings, {});
  assert.equal(response.status, 405);
});

test("MT5 latest returns an explicit empty state when no snapshots exist", async () => {
  const { bindings } = env();
  bindings.MARKET_DB.prepare = (sql) => ({ async first() { return null; }, async all() { return { results: [] }; }, bind() { return this; } });
  const response = await worker.fetch(get("/mt5/latest", { "X-Goldstar-Bridge-Key": L1_KEY }), bindings, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.available, false);
  assert.deepEqual(body.positions, []);
  assert.deepEqual(body.ticks, []);
});
