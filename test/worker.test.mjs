import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import worker from "../src/worker.js";

function makeKv(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [
    key,
    typeof value === "string" ? value : JSON.stringify(value)
  ]));
  return {
    values,
    async get(key, options = {}) {
      const value = values.get(key);
      if (value === undefined) return null;
      return options.type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value) {
      values.set(key, String(value));
    }
  };
}

function makeDb() {
  const rows = new Map();
  const events = [];
  const queries = [];
  return {
    rows,
    events,
    queries,
    prepare(sql) {
      return {
        bind(...args) {
          queries.push({ sql, args });
          return {
            async run() {
              if (sql.startsWith("INSERT INTO gs_audit_log")) {
                rows.set(args[0], {
                  event_id: args[0],
                  actor_agent_id: args[1],
                  event_type: args[2],
                  resource_type: args[3],
                  resource_id: args[4],
                  outcome: args[5],
                  details_json: args[6]
                });
              } else if (sql.startsWith("UPDATE gs_audit_log")) {
                const row = rows.get(args[2]);
                if (row) {
                  row.outcome = args[0];
                  row.details_json = args[1];
                }
              }
              return { success: true, meta: { changes: 1 } };
            },
            async first() {
              if (sql.includes("FROM tv_events")) {
                return { event_count: events.length, last_received_at: events[0]?.received_at || null };
              }
              if (sql.includes("FROM gs_market_events")) {
                return { event_count: 0, last_received_at: null };
              }
              return null;
            },
            async all() {
              return { results: events.slice(0, Number(args[4] || 100)) };
            }
          };
        }
      };
    }
  };
}

function makeEnv({ pending = [], active = [], strategy = null, withDb = true } = {}) {
  const KNOWLEDGE = makeKv({
    knowledge_NDS_pending: pending,
    knowledge_NDS: active
  });
  const STRATEGY = makeKv(strategy === null ? {} : { current_strategy: strategy });
  const DB = withDb ? makeDb() : undefined;
  return {
    env: {
      API_KEY: "general-api-key",
      L1_BRIDGE_KEY: "dedicated-l1-bridge-key",
      KNOWLEDGE,
      STRATEGY,
      DB
    },
    KNOWLEDGE,
    STRATEGY,
    DB
  };
}

function evidenceRule(overrides = {}) {
  const sourceExcerpt = "The market forms a completed positive cycle after the two hooks and two rallies, followed by the flag.";
  const sourceExcerptHash = createHash("sha256").update(sourceExcerpt).digest("hex");
  return {
    id: "rule-001",
    style: "NDS",
    category: "cycle",
    rule: "A completed positive cycle requires the two hooks and two rallies before the flag.",
    validationStatus: "pending",
    contentType: "trading_rule",
    sourcePostId: "123",
    sourcePostUrl: "https://t.me/s/NDS4ALLVIDEOS/123",
    sourceExcerpt,
    sourceExcerptHash,
    sourceExcerptVerified: true,
    ...overrides
  };
}

function makeRequest(path, body, headers = {}) {
  return new Request("https://financial.test" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const ctx = { waitUntil() {} };

test("general API key cannot approve NDS rules", async () => {
  const rule = evidenceRule();
  const state = makeEnv({ pending: [rule] });
  const response = await worker.fetch(makeRequest("/training/approve", {
    confirmation: "APPROVE",
    ids: [rule.id],
    approvalNote: "Owner review"
  }, { "X-API-Key": "general-api-key" }), state.env, ctx);

  assert.equal(response.status, 403);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json" })).length, 1);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS", { type: "json" })).length, 0);
});

test("approval requires the explicit confirmation and unique IDs", async () => {
  const rule = evidenceRule();
  const state = makeEnv({ pending: [rule] });
  const headers = { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" };

  const noConfirmation = await worker.fetch(makeRequest("/training/approve", {
    confirmation: "YES",
    ids: [rule.id],
    approvalNote: "Owner review"
  }, headers), state.env, ctx);
  assert.equal(noConfirmation.status, 400);

  const duplicateIds = await worker.fetch(makeRequest("/training/approve", {
    confirmation: "APPROVE",
    ids: [rule.id, rule.id],
    approvalNote: "Owner review"
  }, headers), state.env, ctx);
  assert.equal(duplicateIds.status, 400);
});

test("rules without rule-specific verified source evidence cannot be approved", async () => {
  const rule = {
    id: "legacy-pending",
    validationStatus: "pending",
    source: "https://t.me/s/NDS4ALLVIDEOS",
    sourceExcerpt: "A non-empty page excerpt that is not tied to a specific post."
  };
  const state = makeEnv({ pending: [rule] });
  const response = await worker.fetch(makeRequest("/training/approve", {
    confirmation: "APPROVE",
    ids: [rule.id],
    approvalNote: "Owner review"
  }, { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" }), state.env, ctx);

  assert.equal(response.status, 409);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json" })).length, 1);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS", { type: "json" })).length, 0);
});

test("verified owner approval writes approved rules and a D1 audit record", async () => {
  const rule = evidenceRule();
  const state = makeEnv({ pending: [rule] });
  const response = await worker.fetch(makeRequest("/training/approve", {
    confirmation: "APPROVE",
    ids: [rule.id],
    approvalNote: "Reviewed source post and approved by owner."
  }, { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" }), state.env, ctx);

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.approved, 1);

  const active = await state.KNOWLEDGE.get("knowledge_NDS", { type: "json" });
  const pending = await state.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json" });
  assert.equal(active.length, 1);
  assert.equal(active[0].validationStatus, "approved");
  assert.equal(active[0].approvedBy, "OWNER_L0_VIA_L1");
  assert.equal(pending.length, 0);

  assert.equal(state.DB.rows.size, 1);
  const audit = [...state.DB.rows.values()][0];
  assert.equal(audit.event_type, "NDS_RULE_APPROVAL");
  assert.equal(audit.outcome, "approved");
  assert.equal(audit.actor_agent_id, "OWNER");
});

test("approval fails closed when the audit D1 binding is absent", async () => {
  const rule = evidenceRule();
  const state = makeEnv({ pending: [rule], withDb: false });
  const response = await worker.fetch(makeRequest("/training/approve", {
    confirmation: "APPROVE",
    ids: [rule.id],
    approvalNote: "Owner review"
  }, { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" }), state.env, ctx);

  assert.equal(response.status, 503);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json" })).length, 1);
});

test("duplicate NDS ingestion route is disabled to enforce a single writer", async () => {
  const state = makeEnv({ pending: [{ id: "keep-me" }] });
  const response = await worker.fetch(makeRequest("/training/batch", {}, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);

  assert.equal(response.status, 409);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json" })).length, 1);
});

test("market-data status reads raw and normalized D1 counts but remains fail-closed", async () => {
  const state = makeEnv();
  const response = await worker.fetch(makeRequest("/market-data/status", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.rawEventCount, 0);
  assert.equal(result.normalizedEventCount, 0);
  assert.equal(result.marketDataReady, false);
  assert.equal(result.marketAnalysisEnabled, false);
});

test("market-data latest returns parsed raw TradingView events with bounded filters", async () => {
  const state = makeEnv();
  state.DB.events.push({
    id: "event-1",
    event_hash: "hash-1",
    received_at: "2026-11-04T10:00:00.000Z",
    symbol: "EURUSD",
    exchange_name: "OANDA",
    timeframe: "15",
    event_type: "alert",
    payload_json: JSON.stringify({ signal: "breakout" })
  });
  const response = await worker.fetch(makeRequest("/market-data/latest?symbol=eurusd&timeframe=15&limit=10", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.count, 1);
  assert.equal(result.events[0].payload.signal, "breakout");
  assert.equal("payload_json" in result.events[0], false);
  assert.deepEqual(state.DB.queries.at(-1).args, ["eurusd", "eurusd", "15", "15", 10]);
});

test("market-data routes fail closed when D1 is not bound", async () => {
  const state = makeEnv({ withDb: false });
  const response = await worker.fetch(makeRequest("/market-data/status", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(response.status, 503);
});

test("market analysis remains disabled even when the read-only event store is bound", async () => {
  const state = makeEnv();
  const response = await worker.fetch(makeRequest("/analyze", {}, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(response.status, 503);
});

test("malformed legacy strategy is never reported as ready", async () => {
  const state = makeEnv({ strategy: "[legacy strategy payload that is not a strategy record]" });
  const response = await worker.fetch(makeRequest("/status", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.strategyReady, false);
  assert.equal(result.strategyStatus, "legacy_unverified");
  assert.equal(result.approvedRules, 0);
});
