import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const GATEWAY_URL = "https://trading-research-agent.goldstar-nsl83.workers.dev";
function env(overrides = {}) {
  return {
    API_KEY: "l2-test-api-key",
    L1_BRIDGE_KEY: "l1-test-bridge-key",
    MQL5_GATEWAY_URL: GATEWAY_URL,
    MQL5_GATEWAY_API_KEY: "shared-gateway-secret",
    ...overrides
  };
}
function post(path, payload, headers = {}) {
  return new Request("https://l2.example" + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-API-Key": "l2-test-api-key",
      ...headers
    },
    body: JSON.stringify(payload)
  });
}

test("L2 MQL5 tools proxy authenticates caller and forwards to the production gateway", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, tools: [{ name: "marketdata_symbol_search" }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const response = await worker.fetch(post("/mql5/tools", {}), env(), {});
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.tools[0].name, "marketdata_symbol_search");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, GATEWAY_URL + "/mql5/tools");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.authorization, "Bearer shared-gateway-secret");
    assert.equal(calls[0].init.body, "{}");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("L2 MQL5 call proxy forwards only through the configured market-data gateway", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const requestBody = { name: "marketdata_symbol_search", arguments: { query: "EURUSD" } };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, call_id: "test-call", result: { symbols: ["EURUSD"] } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const response = await worker.fetch(post("/mql5/call", requestBody), env(), {});
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.deepEqual(JSON.parse(calls[0].init.body), requestBody);
    assert.equal(calls[0].url, GATEWAY_URL + "/mql5/call");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("L2 MQL5 routes reject unauthenticated callers before contacting the gateway", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response("{}", { status: 200 }); };
  try {
    const response = await worker.fetch(post("/mql5/tools", {}, { "X-API-Key": "wrong-key" }), env(), {});
    assert.equal(response.status, 401);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("L2 MQL5 routes fail closed when the gateway binding is missing", async () => {
  const response = await worker.fetch(post("/mql5/tools", {}), env({ MQL5_GATEWAY_API_KEY: "" }), {});
  assert.equal(response.status, 503);
});

test("L2 MQL5 routes accept POST only", async () => {
  const response = await worker.fetch(new Request("https://l2.example/mql5/tools", {
    method: "GET",
    headers: { "X-API-Key": "l2-test-api-key" }
  }), env(), {});
  assert.equal(response.status, 405);
});
