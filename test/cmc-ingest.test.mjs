import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker from "../workers/cmc-ingest/src/worker.js";

function makeDb({ failBatch = false } = {}) {
  const prepared = [];
  const executed = [];
  const batches = [];
  const db = {
    prepare(sql) {
      const statement = {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        async run() { executed.push(this); return { success: true }; }
      };
      prepared.push(statement);
      return statement;
    },
    async batch(items) {
      batches.push(items);
      if (failBatch) throw new Error("simulated D1 batch failure");
      return items.map(() => ({ success: true, meta: { changes: 1 } }));
    }
  };
  return { db, prepared, executed, batches };
}

function makeRequest(path, method = "GET", body, headers = {}) {
  return new Request("https://cmc-ingest.example" + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function validPayload() {
  return {
    status: { error_code: 0 },
    data: {
      BTC: {
        id: 1,
        name: "Bitcoin",
        symbol: "BTC",
        cmc_rank: 1,
        quote: {
          USD: {
            price: 65000,
            volume_24h: 1000,
            market_cap: 1200000,
            percent_change_1h: 0.2,
            percent_change_24h: 1.1,
            percent_change_7d: 3.2,
            last_updated: "2026-11-08T10:00:00.000Z"
          }
        }
      }
    }
  };
}

function makeEnv(options = {}) {
  const state = makeDb(options);
  return {
    state,
    env: {
      CMC_API_KEY: "unit-test-cmc-provider-key",
      INGEST_AUTH_TOKEN: "unit-test-ingest-token",
      MARKET_DB: state.db
    }
  };
}

test("health is public but only reports configuration presence", async () => {
  const { env } = makeEnv();
  const response = await worker.fetch(makeRequest("/health"), env);
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.storage, "dedicated_market_research_d1");
  assert.equal(result.cmc_configured, true);
  assert.equal(result.ingest_auth_configured, true);
  assert.equal(result.database_configured, true);
  assert.equal(JSON.stringify(result).includes("unit-test"), false);
});

test("unknown paths and methods are rejected", async () => {
  const { env } = makeEnv();
  assert.equal((await worker.fetch(makeRequest("/unknown"), env)).status, 404);
  assert.equal((await worker.fetch(makeRequest("/cmc/quotes"), env)).status, 405);
});

test("missing or incorrect ingest token is rejected before D1 or upstream access", async () => {
  const { env, state } = makeEnv();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error("must not fetch"); };
  try {
    const response = await worker.fetch(makeRequest("/cmc/quotes", "POST", { symbols: ["BTC"] }), env);
    assert.equal(response.status, 401);
    assert.equal(state.prepared.length, 0);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("missing provider, ingest, or dedicated market D1 configuration fails closed", async () => {
  for (const patch of [
    { CMC_API_KEY: "" },
    { INGEST_AUTH_TOKEN: "" },
    { MARKET_DB: undefined }
  ]) {
    const { env } = makeEnv();
    Object.assign(env, patch);
    const response = await worker.fetch(makeRequest("/cmc/quotes", "POST", { symbols: ["BTC"] }, {
      authorization: "Bearer unit-test-ingest-token"
    }), env);
    assert.equal(response.status, 503);
  }
});

test("invalid JSON, unsupported fields, invalid currencies, and bad symbols are rejected", async () => {
  const { env } = makeEnv();
  const auth = { authorization: "Bearer unit-test-ingest-token" };
  const invalidJson = await worker.fetch(new Request("https://cmc-ingest.example/cmc/quotes", {
    method: "POST", headers: { "content-type": "application/json", ...auth }, body: "{"
  }), env);
  assert.equal(invalidJson.status, 400);
  assert.equal((await worker.fetch(makeRequest("/cmc/quotes", "POST", { symbols: ["BTC"], extra: true }, auth), env)).status, 400);
  assert.equal((await worker.fetch(makeRequest("/cmc/quotes", "POST", { symbols: ["BTC", "BTC"] }, auth), env)).status, 400);
  assert.equal((await worker.fetch(makeRequest("/cmc/quotes", "POST", { symbols: ["BTC"], convert: "US D" }, auth), env)).status, 400);
});

test("oversized payload is rejected before provider access", async () => {
  const { env, state } = makeEnv();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error("must not fetch"); };
  try {
    const response = await worker.fetch(new Request("https://cmc-ingest.example/cmc/quotes", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer unit-test-ingest-token" },
      body: JSON.stringify({ symbols: ["BTC"], padding: "x".repeat(5000) })
    }), env);
    assert.equal(response.status, 413); // Body-size limit is enforced before parsing or provider calls.
    assert.equal(state.prepared.length, 0);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("valid CMC quotes are written to MARKET_DB with success audit in one D1 batch", async () => {
  const { env, state } = makeEnv();
  const originalFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), apiKey: init.headers["X-CMC_PRO_API_KEY"], method: init.method };
    return new Response(JSON.stringify(validPayload()), {
      status: 200, headers: { "content-type": "application/json" }
    });
  };
  try {
    const response = await worker.fetch(makeRequest("/cmc/quotes", "POST", { symbols: ["btc"] }, {
      authorization: "Bearer unit-test-ingest-token"
    }), env);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.provider, "coinmarketcap");
    assert.equal(result.records_written, 1);
    assert.deepEqual(result.missing_symbols, []);
    assert.equal(captured.method, "GET");
    assert.equal(captured.apiKey, env.CMC_API_KEY);
    assert.match(captured.url, /symbol=BTC/);
    assert.match(captured.url, /convert=USD/);
    assert.equal(state.prepared.length, 3); // running audit, quote upsert, and successful audit
    assert.equal(state.batches.length, 1);
    assert.equal(state.batches[0].length, 2);
    assert.match(state.batches[0][0].sql, /INSERT INTO cmc_quotes/);
    assert.match(state.batches[0][0].sql, /ON CONFLICT/);
    assert.match(state.batches[0][1].sql, /status = 'success'/);
    assert.equal(state.batches[0][0].args[0], 1);
    assert.equal(state.batches[0][0].args[1], "BTC");
    assert.equal(JSON.stringify(result).includes(env.CMC_API_KEY), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider errors are recorded as failed runs and no quotes are committed", async () => {
  const { env, state } = makeEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: { error_code: 1001, error_message: "invalid API key" }
  }), { status: 401, headers: { "content-type": "application/json" } });
  try {
    const response = await worker.fetch(makeRequest("/cmc/quotes", "POST", { symbols: ["BTC"] }, {
      authorization: "Bearer unit-test-ingest-token"
    }), env);
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.error, "ingestion_failed");
    assert.equal(state.batches.length, 0);
    assert.equal(state.prepared.length, 2); // running + failed audit
    assert.match(state.prepared[1].sql, /status = 'failed'/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("D1 commit failure does not claim that quotes were ingested", async () => {
  const { env, state } = makeEnv({ failBatch: true });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(validPayload()), {
    status: 200, headers: { "content-type": "application/json" }
  });
  try {
    const response = await worker.fetch(makeRequest("/cmc/quotes", "POST", { symbols: ["BTC"] }, {
      authorization: "Bearer unit-test-ingest-token"
    }), env);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "ingestion_failed");
    assert.equal(state.batches.length, 1);
    assert.match(state.prepared.at(-1).sql, /status = 'failed'/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Staging Wrangler config uses only the dedicated market D1 and no Cron", async () => {
  const config = await readFile(new URL("../wrangler.cmc.staging.toml", import.meta.url), "utf8");
  assert.match(config, /name = "goldstar-cmc-ingest-staging"/);
  assert.match(config, /binding = "MARKET_DB"/);
  assert.match(config, /database_name = "goldstar_market_research_staging"/);
  assert.match(config, /database_id = "e5978640-6035-41fe-8947-4e6fc58c5a92"/);
  assert.doesNotMatch(config, /goldstar_nds_staging/);
  assert.doesNotMatch(config, /crons\s*=/i);
});
