import test from "node:test";
import assert from "node:assert/strict";
import worker from "../workers/trading-research-agent/src/worker.js";

function makeEnv({ key = "mt5-bridge-test-key", failBatch = false, storedBars = 1 } = {}) {
  const state = { batches: [], runs: [], queries: [] };
  const DB = {
    prepare(sql) {
      const statement = { sql, args: [], bind(...args) { this.args = args; return this; },
        async run() { state.runs.push({ sql, args: this.args }); return { success: true, meta: { changes: 0 } }; },
        async first() {
          state.queries.push({ sql, args: this.args });
          if (/COUNT\(\*\).*FROM mt5_ohlc_bars/i.test(sql)) return { stored_bars: storedBars, oldest_time_msc: 1700000000000, newest_time_msc: 1790000000000 };
          return null;
        },
        async all() { state.queries.push({ sql, args: this.args }); return { results: [] }; }
      };
      return statement;
    },
    async batch(statements) {
      if (failBatch) throw new Error("simulated D1 failure");
      state.batches.push(statements);
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    }
  };
  return { state, env: { MT5_BRIDGE_KEY: key, DB } };
}

const account = {
  login: "8096845", server: "AMarkets-Demo", currency: "USD", leverage: 100,
  balance: 10000, equity: 10000, margin: 0, free_margin: 10000, margin_level: 0,
  terminal_connected: true, trade_allowed: true, terminal_version: "5000", trade_mode: "DEMO",
  terminal_build: 5000
};
const tick = { symbol: "EURUSD", bid: 1.0809, ask: 1.081, last: 1.08095, time_msc: Date.now() };
function post(path, body, key = "mt5-bridge-test-key") {
  return new Request("https://research.example" + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goldstar-mt5-key": key },
    body: JSON.stringify(body)
  });
}

test("MT5 health reports the dedicated bridge binding without exposing it", async () => {
  const { env } = makeEnv();
  const response = await worker.fetch(new Request("https://research.example/health"), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mt5_demo_bridge_configured, true);
  assert.equal(JSON.stringify(body).includes("mt5-bridge-test-key"), false);
});

test("snapshot endpoint rejects missing or incorrect bridge authentication", async () => {
  const { env, state } = makeEnv();
  const response = await worker.fetch(post("/mt5/snapshot", { account, positions: [], ticks: [tick] }, "wrong-key"), env);
  assert.equal(response.status, 401);
  assert.equal(state.batches.length, 0);
});

test("snapshot endpoint rejects live or disconnected terminals", async () => {
  const { env, state } = makeEnv();
  const live = await worker.fetch(post("/mt5/snapshot", { account: { ...account, trade_mode: "REAL" }, positions: [], ticks: [tick] }), env);
  const disconnected = await worker.fetch(post("/mt5/snapshot", { account: { ...account, terminal_connected: false }, positions: [], ticks: [tick] }), env);
  assert.equal(live.status, 403);
  assert.equal(disconnected.status, 403);
  assert.equal(state.batches.length, 0);
});

test("valid demo snapshot writes account and ticks atomically", async () => {
  const { env, state } = makeEnv();
  const response = await worker.fetch(post("/mt5/snapshot", { account, positions: [], ticks: [tick] }), env);
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.mode, "demo_read_only");
  assert.equal(body.positions, 0);
  assert.equal(body.ticks, 1);
  assert.equal(state.batches.length, 2); // snapshot write plus best-effort retention cleanup
  assert.equal(state.batches[0].length, 2);
  assert.equal(state.batches[1].length, 4);
  assert.match(state.batches[1][2].sql, /DELETE FROM mt5_live_ticks WHERE observed_at/);
  assert.match(state.batches[0][0].sql, /INSERT INTO mt5_terminal_snapshots/);
  assert.match(state.batches[0][1].sql, /INSERT INTO mt5_symbol_ticks/);
});

test("history endpoint stores validated OHLC bars in D1 batches", async () => {
  const { env, state } = makeEnv();
  const time = Math.floor((Date.now() - 60000) / 1000) * 1000;
  const bar = { symbol: "XAUUSD", timeframe: "M15", time_msc: time, open: 2000, high: 2010, low: 1990, close: 2005, tick_volume: 12, real_volume: 0, spread_points: 20 };
  const response = await worker.fetch(post("/mt5/history", { account, bars: [bar] }), env);
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.mode, "demo_read_only");
  assert.equal(body.received, 1);
  assert.equal(body.inserted, 1);
  assert.equal(state.batches.length, 1);
  assert.equal(state.batches[0].length, 1);
  assert.match(state.batches[0][0].sql, /INSERT OR IGNORE INTO mt5_ohlc_bars/);
  assert.equal(state.batches[0][0].args[0], "XAUUSD");
  assert.equal(state.batches[0][0].args[1], "M15");
});

test("history endpoint rejects invalid OHLC relationships before writes", async () => {
  const { env, state } = makeEnv();
  const time = Math.floor((Date.now() - 60000) / 1000) * 1000;
  const badBar = { symbol: "XAUUSD", timeframe: "M15", time_msc: time, open: 2000, high: 1990, low: 1980, close: 2005, tick_volume: 12, real_volume: 0, spread_points: 20 };
  const response = await worker.fetch(post("/mt5/history", { account, bars: [badBar] }), env);
  assert.equal(response.status, 400);
  assert.equal(state.batches.length, 0);
});

test("MT5 routes require POST and unknown order routes remain absent", async () => {
  const { env } = makeEnv();
  const get = await worker.fetch(new Request("https://research.example/mt5/snapshot", { method: "GET" }), env);
  const order = await worker.fetch(new Request("https://research.example/mt5/order", { method: "POST" }), env);
  assert.equal(get.status, 405);
  assert.equal(order.status, 404);
});

test("snapshot storage failure returns 503 without claiming acceptance", async () => {
  const { env } = makeEnv({ failBatch: true });
  const response = await worker.fetch(post("/mt5/snapshot", { account, positions: [], ticks: [tick] }), env);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "snapshot_storage_failed");
});


test("independent tick endpoint accepts more than the legacy 30-symbol snapshot cap", async () => {
  const { env, state } = makeEnv();
  const ticks = Array.from({ length: 45 }, (_, i) => ({
    symbol: "SYM" + String(i).padStart(2, "0"),
    bid: 1.1 + i / 100000,
    ask: 1.2 + i / 100000,
    last: 1.15 + i / 100000,
    time_msc: Date.now() - i
  }));
  const response = await worker.fetch(post("/mt5/ticks", { account, ticks }), env);
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.received, 45);
  assert.equal(body.inserted, 45);
  assert.equal(state.batches.length, 1);
  assert.equal(state.batches[0].length, 45);
  assert.match(state.batches[0][0].sql, /INSERT OR IGNORE INTO mt5_live_ticks/);
});

test("tick endpoint rejects more than one transport batch but does not impose a total symbol cap", async () => {
  const { env, state } = makeEnv();
  const ticks = Array.from({ length: 101 }, (_, i) => ({
    symbol: "SYM" + String(i).padStart(3, "0"), bid: 1, ask: 2, last: 1.5, time_msc: Date.now() - i
  }));
  const response = await worker.fetch(post("/mt5/ticks", { account, ticks }), env);
  assert.equal(response.status, 400);
  assert.equal(state.batches.length, 0);
});

test("history status returns the server-side target and resumable oldest cursor", async () => {
  const { env, state } = makeEnv({ storedBars: 1000 });
  const response = await worker.fetch(new Request(
    "https://research.example/mt5/history/status?symbol=XAUUSD&timeframe=M15",
    { method: "GET", headers: { "x-goldstar-mt5-key": "mt5-bridge-test-key" } }
  ), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.target_bars, 12000);
  assert.equal(body.stored_bars, 1000);
  assert.equal(body.remaining_bars, 11000);
  assert.equal(body.complete, false);
  assert.equal(body.oldest_time_msc, 1700000000000);
  assert.deepEqual(state.queries[0].args, ["XAUUSD", "M15"]);
});

test("history ingestion accepts multiple symbol/timeframe pairs in one bounded request", async () => {
  const { env, state } = makeEnv({ storedBars: 1 });
  const time = Math.floor((Date.now() - 60000) / 1000) * 1000;
  const bars = [
    { symbol: "XAUUSD", timeframe: "M15", time_msc: time, open: 2000, high: 2010, low: 1990, close: 2005, tick_volume: 12, real_volume: 0, spread_points: 20 },
    { symbol: "EURUSD", timeframe: "H1", time_msc: time + 1000, open: 1, high: 1.1, low: 0.9, close: 1.05, tick_volume: 10, real_volume: 0, spread_points: 2 }
  ];
  const response = await worker.fetch(post("/mt5/history", { account, bars }), env);
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.received, 2);
  assert.equal(body.pairs.length, 2);
  assert.deepEqual(body.pairs.map(pair => [pair.symbol, pair.timeframe, pair.target_bars]), [
    ["XAUUSD", "M15", 12000], ["EURUSD", "H1", 12000]
  ]);
  assert.equal(state.batches.length, 1);
  assert.equal(state.batches[0].length, 2);
  assert.equal(state.runs.length, 2);
});

test("history ingestion applies the timeframe-specific rolling target after inserts", async () => {
  const { env, state } = makeEnv({ storedBars: 12000 });
  const time = Math.floor((Date.now() - 60000) / 1000) * 1000;
  const bar = { symbol: "EURUSD", timeframe: "M15", time_msc: time, open: 1, high: 1.1, low: 0.9, close: 1.05, tick_volume: 10, real_volume: 0, spread_points: 2 };
  const response = await worker.fetch(post("/mt5/history", { account, bars: [bar] }), env);
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.target_bars, 12000);
  assert.equal(body.complete, true);
  assert.equal(state.runs.length, 1);
  assert.match(state.runs[0].sql, /ORDER BY time_msc DESC LIMIT/);
});
