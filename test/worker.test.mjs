import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import worker from "../src/worker.js";

function makeKv(initial = {}, kvOptions = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [
    key,
    typeof value === "string" ? value : JSON.stringify(value)
  ]));
  let putCalls = 0;
  return {
    values,
    async get(key, options = {}) {
      if ((kvOptions.failGetKeys || []).includes(key)) throw new Error("simulated KV read failure");
      const value = values.get(key);
      if (value === undefined) return null;
      return options.type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value) {
      putCalls++;
      if ((kvOptions.failPutKeys || []).includes(key) || (kvOptions.failPutCalls || []).includes(putCalls)) {
        throw new Error("simulated KV write failure");
      }
      values.set(key, String(value));
    }
  };
}

function makeDb(options = {}) {
  const rows = new Map();
  const locks = new Map();
  const budgets = new Map();
  const events = [];
  const cmcQuotes = options.cmcQuotes || [];
  const queries = [];
  return {
    rows,
    locks,
    budgets,
    events,
    cmcQuotes,
    queries,
    prepare(sql) {
      let args = [];
      const statement = {
        bind(...boundArgs) {
          args = boundArgs;
          queries.push({ sql, args });
          return statement;
        },
        async run() {
          if (sql.startsWith("DELETE FROM gs_worker_locks")) {
            const row = locks.get(args[0]);
            if (row && row.owner_token === args[1]) locks.delete(args[0]);
          } else if (sql.startsWith("INSERT INTO gs_audit_log")) {
            if (options.failInsert) throw new Error("simulated audit insert failure");
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
            if (options.failUpdate) throw new Error("simulated audit update failure");
            const row = rows.get(args[2]);
            if (row) {
              row.outcome = args[0];
              row.details_json = args[1];
            }
          }
          return { success: true, meta: { changes: 1 } };
        },
        async first() {
          if (sql.startsWith("INSERT INTO gs_ai_daily_budget")) {
            const [day, neurons, updatedAt, limit] = args;
            const current = budgets.get(day) || 0;
            if (current + neurons <= limit) {
              budgets.set(day, current + neurons);
              return { reserved_neurons: current + neurons };
            }
            return null;
          }
          if (sql.startsWith("INSERT INTO gs_worker_locks")) {
            const [lockName, ownerToken, leaseUntilMs, updatedAt, nowMs] = args;
            const existing = locks.get(lockName);
            if (!existing || existing.lease_until_ms <= nowMs) {
              locks.set(lockName, { lock_name: lockName, owner_token: ownerToken, lease_until_ms: leaseUntilMs, updated_at: updatedAt });
              return { owner_token: ownerToken };
            }
            return null;
          }
          if (sql.includes("FROM mt5_terminal_snapshots") && sql.includes("COUNT(*)")) return options.mt5Status || { snapshot_count: 0, last_received_at: null };
          if (sql.includes("FROM mt5_terminal_snapshots")) return options.mt5Snapshot || null;
          if (sql.includes("FROM cmc_quotes") && sql.includes("COUNT(*)")) return { quote_count: cmcQuotes.length, last_quote_updated: cmcQuotes[0]?.quote_last_updated || null };
          if (sql.includes("FROM tv_events")) {
            return { event_count: events.length, last_received_at: events[0]?.received_at || null };
          }
          if (sql.includes("FROM gs_market_events")) {
            return { event_count: 0, last_received_at: null };
          }
          if (sql.includes("FROM gs_audit_log")) {
            return rows.get(args[0]) || null;
          }
          return null;
        },
        async all() {
          if (sql.includes("FROM cmc_quotes")) {
            const [symbol, , currency, limit] = args;
            const filtered = cmcQuotes.filter(row => (!symbol || String(row.symbol).toUpperCase() === String(symbol).toUpperCase()) && String(row.quote_currency).toUpperCase() === String(currency).toUpperCase());
            return { results: filtered.slice(0, Number(limit || 100)) };
          }
          if (sql.includes("FROM mt5_positions")) return { results: options.mt5Positions || [] };
          if (sql.includes("FROM mt5_symbol_ticks")) return { results: options.mt5Ticks || [] };
          return { results: events.slice(0, Number(args[4] || 100)) };
        }
      };
      return statement;
    }
  };
}

function makeEnv({ pending = [], active = [], otherKnowledge = {}, strategy = null, withDb = true, withMarketDb = true, dbOptions = {}, kvOptions = {}, strategyKvOptions = {} } = {}) {
  const KNOWLEDGE = makeKv({
    knowledge_NDS_pending: pending,
    knowledge_NDS: active,
    ...otherKnowledge
  }, kvOptions);
  const STRATEGY = makeKv(strategy === null ? {} : { current_strategy: strategy }, strategyKvOptions);
  const DB = withDb ? makeDb(dbOptions) : undefined;
  const MARKET_DB = withMarketDb ? makeDb(dbOptions) : undefined;
  return {
    env: {
      API_KEY: "general-api-key",
      L1_BRIDGE_KEY: "dedicated-l1-bridge-key",
      MQL5_GATEWAY_API_KEY: "mql5-client-gateway-secret",
      MQL5_GATEWAY_URL: "https://mql5-readonly-v4-trading-research-agent-staging.goldstar-nsl83.workers.dev",
      NDS_EVIDENCE_HMAC_KEY: TEST_NDS_EVIDENCE_KEY,
      KNOWLEDGE,
      STRATEGY,
      DB,
      MARKET_DB,
      AI: {
        calls: 0,
        async run() {
          this.calls++;
          return { response: "Research candidate only; assumptions and invalidation conditions." };
        }
      }
    },
    KNOWLEDGE,
    STRATEGY,
    DB,
    MARKET_DB
  };
}

const TEST_NDS_EVIDENCE_KEY = "unit-test-nds-evidence-key-32-bytes-minimum";

function sourceEvidencePayloadForTest(rule) {
  return {
    id: String(rule.id || ""),
    contentType: String(rule.contentType || ""),
    category: String(rule.category || ""),
    rule: String(rule.rule || rule.description || ""),
    conditions: Array.isArray(rule.conditions) ? rule.conditions.map(value => String(value)) : [],
    priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : null,
    sourcePostId: String(rule.sourcePostId || ""),
    sourcePostUrl: String(rule.sourcePostUrl || ""),
    sourceExcerptHash: String(rule.sourceExcerptHash || ""),
    sourcePostContentHash: String(rule.sourcePostContentHash || ""),
    sourceCaptureMethod: String(rule.sourceCaptureMethod || ""),
    sourceExcerptVerified: rule.sourceExcerptVerified === true
  };
}

function evidenceRule(overrides = {}) {
  const sourceExcerpt = "The market forms a completed positive cycle after the two hooks and two rallies, followed by the flag.";
  const sourceExcerptHash = createHash("sha256").update(sourceExcerpt).digest("hex");
  const rule = {
    id: "rule-001",
    style: "NDS",
    category: "cycle",
    rule: "A completed positive cycle requires the two hooks and two rallies before the flag.",
    conditions: ["Two hooks and two rallies must precede the flag."],
    priority: 1,
    validationStatus: "pending",
    contentType: "trading_rule",
    sourcePostId: "123",
    sourcePostUrl: "https://t.me/s/NDS4ALLVIDEOS/123",
    sourceExcerpt,
    sourceExcerptHash,
    sourceExcerptVerified: true,
    sourcePostContentHash: createHash("sha256").update(sourceExcerpt).digest("hex"),
    sourceCaptureMethod: "telegram_public_post_html",
    ...overrides
  };
  rule.sourceEvidenceSignature = createHmac("sha256", TEST_NDS_EVIDENCE_KEY)
    .update(JSON.stringify(sourceEvidencePayloadForTest(rule))).digest("hex");
  return rule;
}

function approvalRulePayload(rule) {
  return {
    id: String(rule.id || ""),
    validationStatus: String(rule.validationStatus || ""),
    contentType: String(rule.contentType || ""),
    category: String(rule.category || ""),
    rule: String(rule.rule || rule.description || ""),
    conditions: Array.isArray(rule.conditions) ? rule.conditions.map(value => String(value)) : [],
    priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : null,
    sourcePostId: String(rule.sourcePostId || ""),
    sourcePostUrl: String(rule.sourcePostUrl || ""),
    sourceExcerptHash: String(rule.sourceExcerptHash || ""),
    sourcePostContentHash: String(rule.sourcePostContentHash || ""),
    sourceCaptureMethod: String(rule.sourceCaptureMethod || ""),
    sourceEvidenceSignature: String(rule.sourceEvidenceSignature || ""),
    sourceExcerptVerified: rule.sourceExcerptVerified === true
  };
}

function makeApprovalBody(ids, rules, overrides = {}) {
  const issuedAt = overrides.issuedAt ?? Date.now();
  const expiresAt = overrides.expiresAt ?? issuedAt + 300000;
  const entries = rules.map(rule => ({
    id: String(rule.id),
    contentHash: createHash("sha256").update(JSON.stringify(approvalRulePayload(rule))).digest("hex")
  })).sort((left, right) => left.id.localeCompare(right.id));
  const payload = {
    ids: ids.map(String).sort(),
    confirmation: overrides.confirmation ?? "APPROVE",
    approvalNote: overrides.approvalNote ?? "Owner review",
    approverId: overrides.approverId ?? "71007767",
    requestId: overrides.requestId ?? randomUUID(),
    issuedAt,
    expiresAt,
    ruleSetHash: overrides.ruleSetHash ?? createHash("sha256").update(JSON.stringify(entries)).digest("hex")
  };
  const approvalPayloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return { ...payload, approvalPayloadHash: overrides.approvalPayloadHash ?? approvalPayloadHash };
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
  const response = await worker.fetch(makeRequest("/training/approve", makeApprovalBody([rule.id], [rule]), { "X-API-Key": "general-api-key" }), state.env, ctx);

  assert.equal(response.status, 403);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json" })).length, 1);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS", { type: "json" })).length, 0);
});

test("MT5 snapshot routes are L1-only and expose only the latest demo snapshot", async () => {
  const state = makeEnv({ dbOptions: {
    mt5Status: { snapshot_count: 3, last_received_at: "2026-11-08T09:00:00.000Z" },
    mt5Snapshot: { snapshot_id: "snap-1", received_at: "2026-11-08T09:00:00.000Z", account_login: "12345678", account_server: "AMarkets-Demo", currency: "USD", leverage: 100, balance: 1000, equity: 1010, margin: 10, free_margin: 1000, margin_level: 10100, terminal_connected: 1, trade_allowed: 1, positions_count: 1, ticks_count: 1, payload_json: "{}" },
    mt5Positions: [{ position_ticket: "987654321", symbol: "EURUSD", position_type: "BUY", volume: 0.1 }],
    mt5Ticks: [{ symbol: "EURUSD", bid: 1.08, ask: 1.081, last_price: 1.0805, time_msc: 1794128400000 }]
  }});
  const unauthorized = await worker.fetch(makeRequest("/mt5/status", undefined, { "X-API-Key": "general-api-key" }), state.env, ctx);
  assert.equal(unauthorized.status, 403);
  const headers = { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" };
  const status = await worker.fetch(makeRequest("/mt5/status", undefined, headers), state.env, ctx);
  assert.equal(status.status, 200);
  const statusBody = await status.json();
  assert.equal(statusBody.mode, "demo_read_only");
  assert.equal(statusBody.available, true);
  assert.equal(statusBody.snapshot_count, 3);
  const latest = await worker.fetch(makeRequest("/mt5/latest", undefined, headers), state.env, ctx);
  assert.equal(latest.status, 200);
  const latestBody = await latest.json();
  assert.equal(latestBody.snapshot.snapshot_id, "snap-1");
  assert.equal(latestBody.positions.length, 1);
  assert.equal(latestBody.ticks.length, 1);
});

test("MT5 snapshot routes fail closed when research D1 is missing", async () => {
  const state = makeEnv({ withMarketDb: false });
  const response = await worker.fetch(makeRequest("/mt5/status", undefined, {
    "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key"
  }), state.env, ctx);
  assert.equal(response.status, 503);
});

test("MQL5 proxy requires L1 bridge authentication, even with general API key", async () => {
  const state = makeEnv();
  const response = await worker.fetch(makeRequest("/mql5/tools", {}, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(response.status, 403);
});

test("MQL5 proxy forwards only marketdata calls with its separate gateway secret", async () => {
  const state = makeEnv();
  const originalFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), authorization: init.headers.Authorization, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ ok: true, result: { tool: "marketdata_get_symbol_info" } }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  };
  try {
    const response = await worker.fetch(makeRequest("/mql5/call", {
      name: "marketdata_get_symbol_info", arguments: { symbol: "EURUSD" }
    }, { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" }), state.env, ctx);
    assert.equal(response.status, 200);
    assert.equal(captured.authorization, "Bearer mql5-client-gateway-secret");
    assert.equal(captured.url, state.env.MQL5_GATEWAY_URL + "/mql5/call");
    assert.equal(captured.body.name, "marketdata_get_symbol_info");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MQL5 proxy rejects trading tools and missing gateway configuration", async () => {
  const state = makeEnv();
  const headers = { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" };
  const denied = await worker.fetch(makeRequest("/mql5/call", {
    name: "trade_place_order", arguments: { symbol: "EURUSD" }
  }, headers), state.env, ctx);
  assert.equal(denied.status, 400);
  const missing = makeEnv();
  missing.env.MQL5_GATEWAY_API_KEY = "";
  const unavailable = await worker.fetch(makeRequest("/mql5/tools", {}, headers), missing.env, ctx);
  assert.equal(unavailable.status, 503);
});

test("MQL5 proxy bounds request size and returns 4xx validation statuses", async () => {
  const state = makeEnv();
  const response = await worker.fetch(new Request("https://l2.example/mql5/call", {
    method: "POST",
    headers: { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key", "content-length": "9000" },
    body: JSON.stringify({ name: "marketdata_get_symbol_info" })
  }), state.env, ctx);
  assert.equal(response.status, 413);
});

test("all knowledge and strategy read failures fail closed instead of reporting empty state", async () => {
  const knowledgeState = makeEnv({ kvOptions: { failGetKeys: ["knowledge_NDS"] } });
  const knowledgeResponse = await worker.fetch(makeRequest("/knowledge/NDS", undefined, {
    "X-API-Key": "general-api-key"
  }), knowledgeState.env, ctx);
  assert.equal(knowledgeResponse.status, 500);

  const strategyState = makeEnv({ strategyKvOptions: { failGetKeys: ["current_strategy"] } });
  const strategyResponse = await worker.fetch(makeRequest("/strategy", undefined, {
    "X-API-Key": "general-api-key"
  }), strategyState.env, ctx);
  assert.equal(strategyResponse.status, 500);
});

test("approval fails closed if either pending or active KV read fails", async () => {
  const rule = evidenceRule();
  const headers = { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" };
  for (const key of ["knowledge_NDS_pending", "knowledge_NDS"]) {
    const state = makeEnv({ pending: [rule], kvOptions: { failGetKeys: [key] } });
    const pendingBefore = state.KNOWLEDGE.values.get("knowledge_NDS_pending");
    const activeBefore = state.KNOWLEDGE.values.get("knowledge_NDS");
    const response = await worker.fetch(makeRequest("/training/approve", makeApprovalBody([rule.id], [rule]), headers), state.env, ctx);
    assert.equal(response.status, 500);
    assert.equal(state.DB.rows.size, 0);
    assert.equal(state.KNOWLEDGE.values.get("knowledge_NDS_pending"), pendingBefore);
    assert.equal(state.KNOWLEDGE.values.get("knowledge_NDS"), activeBefore);
    assert.equal(state.DB.locks.size, 0);
  }
});

test("source evidence HMAC is mandatory and tamper-evident", async () => {
  const headers = { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" };
  const valid = evidenceRule();
  const noKey = makeEnv({ pending: [valid] });
  noKey.env.NDS_EVIDENCE_HMAC_KEY = "";
  const noKeyResponse = await worker.fetch(makeRequest("/training/approve", makeApprovalBody([valid.id], [valid]), headers), noKey.env, ctx);
  assert.equal(noKeyResponse.status, 409);

  const tampered = evidenceRule();
  tampered.sourcePostContentHash = "0".repeat(64);
  const tamperedExpectedSignature = createHmac("sha256", TEST_NDS_EVIDENCE_KEY)
    .update(JSON.stringify(sourceEvidencePayloadForTest(tampered))).digest("hex");
  assert.notEqual(tampered.sourceEvidenceSignature, tamperedExpectedSignature);
  const tamperedState = makeEnv({ pending: [tampered] });
  const tamperedResponse = await worker.fetch(makeRequest("/training/approve", makeApprovalBody([tampered.id], [tampered]), headers), tamperedState.env, ctx);
  assert.equal(tamperedResponse.status, 409);

  for (const change of [
    { rule: "A different rule text with the original source signature." },
    { category: "tampered-category" },
    { conditions: ["tampered condition"] },
    { priority: 9 }
  ]) {
    const altered = { ...evidenceRule(), ...change };
    const alteredState = makeEnv({ pending: [altered] });
    const alteredResponse = await worker.fetch(makeRequest("/training/approve", makeApprovalBody([altered.id], [altered]), headers), alteredState.env, ctx);
    assert.equal(alteredResponse.status, 409);
    assert.equal((await alteredState.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json" })).length, 1);
  }

  const wrongCapture = evidenceRule({ sourceCaptureMethod: "untrusted_import" });
  const wrongCaptureState = makeEnv({ pending: [wrongCapture] });
  const wrongCaptureResponse = await worker.fetch(makeRequest("/training/approve", makeApprovalBody([wrongCapture.id], [wrongCapture]), headers), wrongCaptureState.env, ctx);
  assert.equal(wrongCaptureResponse.status, 409);
});

test("approval requires the explicit confirmation and unique IDs", async () => {
  const rule = evidenceRule();
  const state = makeEnv({ pending: [rule] });
  const headers = { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" };

  const noConfirmation = await worker.fetch(makeRequest("/training/approve", makeApprovalBody([rule.id], [rule], { confirmation: "YES" }), headers), state.env, ctx);
  assert.equal(noConfirmation.status, 400);

  const duplicateIds = await worker.fetch(makeRequest("/training/approve", makeApprovalBody([rule.id, rule.id], [rule]), headers), state.env, ctx);
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
  const response = await worker.fetch(makeRequest("/training/approve", makeApprovalBody([rule.id], [rule]), { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" }), state.env, ctx);

  assert.equal(response.status, 409);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json" })).length, 1);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS", { type: "json" })).length, 0);
});

test("verified owner approval writes approved rules and a D1 audit record", async () => {
  const rule = evidenceRule();
  const state = makeEnv({ pending: [rule] });
  const response = await worker.fetch(makeRequest("/training/approve", makeApprovalBody([rule.id], [rule], { approvalNote: "Reviewed source post and approved by owner." }), { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" }), state.env, ctx);

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.approved, 1);

  const active = await state.KNOWLEDGE.get("knowledge_NDS", { type: "json" });
  const pending = await state.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json" });
  assert.equal(active.length, 1);
  assert.equal(active[0].validationStatus, "approved");
  assert.equal(active[0].approvedBy, "OWNER_L0_VIA_L1:71007767");
  assert.equal(pending.length, 0);

  assert.equal(state.DB.rows.size, 1);
  const audit = [...state.DB.rows.values()][0];
  assert.equal(audit.event_type, "NDS_RULE_APPROVAL");
  assert.equal(audit.outcome, "approved");
  assert.equal(audit.actor_agent_id, "OWNER:71007767");
});

test("approval request ID is single-use across rule sets", async () => {
  const firstRule = evidenceRule({ id: "rule-first" });
  const secondRule = evidenceRule({ id: "rule-second" });
  const requestId = randomUUID();
  const state = makeEnv({ pending: [firstRule, secondRule] });
  const headers = { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" };

  const firstBody = makeApprovalBody([firstRule.id], [firstRule], { requestId });
  const firstResponse = await worker.fetch(makeRequest("/training/approve", firstBody, headers), state.env, ctx);
  assert.equal(firstResponse.status, 200);

  const secondBody = makeApprovalBody([secondRule.id], [secondRule], { requestId });
  const secondResponse = await worker.fetch(makeRequest("/training/approve", secondBody, headers), state.env, ctx);
  assert.equal(secondResponse.status, 409);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json" })).length, 1);
});

test("invalid excerpt hash and non-allowlisted source URL are rejected", async () => {
  const headers = { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" };
  for (const override of [
    { sourceExcerptHash: "0".repeat(64) },
    { sourcePostUrl: "https://evil.example/s/NDS4ALLVIDEOS/123" }
  ]) {
    const rule = evidenceRule(override);
    const state = makeEnv({ pending: [rule] });
    const response = await worker.fetch(makeRequest("/training/approve", {
      confirmation: "APPROVE",
      ids: [rule.id],
      approvalNote: "Owner review"
    }, headers), state.env, ctx);
    assert.equal(response.status, 409);
    assert.equal((await state.KNOWLEDGE.get("knowledge_NDS", { type: "json" })).length, 0);
  }
});

test("already active rule IDs cannot be re-approved", async () => {
  const rule = evidenceRule();
  const active = [{ ...rule, validationStatus: "approved" }];
  const state = makeEnv({ pending: [rule], active });
  const response = await worker.fetch(makeRequest("/training/approve", makeApprovalBody([rule.id], [rule]), { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" }), state.env, ctx);
  assert.equal(response.status, 409);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS", { type: "json" })).length, 1);
});

test("approval requires a fresh owner payload hash and five-minute expiry", async () => {
  const rule = evidenceRule();
  const headers = { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" };
  const expired = makeApprovalBody([rule.id], [rule], {
    issuedAt: Date.now() - 600000,
    expiresAt: Date.now() - 300000
  });
  const state = makeEnv({ pending: [rule] });
  const expiredResponse = await worker.fetch(makeRequest("/training/approve", expired, headers), state.env, ctx);
  assert.equal(expiredResponse.status, 409);

  const badHash = makeApprovalBody([rule.id], [rule], {
    approvalPayloadHash: "0".repeat(64)
  });
  const badHashResponse = await worker.fetch(makeRequest("/training/approve", badHash, headers), state.env, ctx);
  assert.equal(badHashResponse.status, 403);
});

test("material rule changes invalidate the reviewed rule-set hash", async () => {
  const rule = evidenceRule();
  const body = makeApprovalBody([rule.id], [rule], { ruleSetHash: "0".repeat(64) });
  const state = makeEnv({ pending: [rule] });
  const response = await worker.fetch(makeRequest("/training/approve", body, {
    "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key"
  }), state.env, ctx);
  assert.equal(response.status, 409);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json" })).length, 1);
});

test("approval rejects a non-owner actor even with a correctly hashed payload", async () => {
  const rule = evidenceRule();
  const body = makeApprovalBody([rule.id], [rule], { approverId: "12345" });
  const state = makeEnv({ pending: [rule] });
  const response = await worker.fetch(makeRequest("/training/approve", body, {
    "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key"
  }), state.env, ctx);
  assert.equal(response.status, 403);
});

test("audit insert failure leaves pending and active knowledge unchanged", async () => {
  const rule = evidenceRule();
  const state = makeEnv({ pending: [rule], dbOptions: { failInsert: true } });
  const response = await worker.fetch(makeRequest("/training/approve", makeApprovalBody([rule.id], [rule]), { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" }), state.env, ctx);
  assert.equal(response.status, 503);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json" })).length, 1);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS", { type: "json" })).length, 0);
});

test("partial KV approval failure rolls back active rules and retains a failed audit", async () => {
  const rule = evidenceRule();
  const state = makeEnv({ pending: [rule], kvOptions: { failPutKeys: ["knowledge_NDS_pending"] } });
  const response = await worker.fetch(makeRequest("/training/approve", makeApprovalBody([rule.id], [rule]), {
    "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key"
  }), state.env, ctx);
  assert.equal(response.status, 503);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS", { type: "json" })).length, 0);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json" })).length, 1);
  assert.equal([...state.DB.rows.values()][0].outcome, "failed");
});

test("failed rollback is recorded as reconciliation_required", async () => {
  const rule = evidenceRule();
  const state = makeEnv({ pending: [rule], kvOptions: { failPutCalls: [2, 3] } });
  const response = await worker.fetch(makeRequest("/training/approve", makeApprovalBody([rule.id], [rule]), {
    "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key"
  }), state.env, ctx);
  assert.equal(response.status, 503);
  const audit = [...state.DB.rows.values()][0];
  assert.equal(audit.outcome, "reconciliation_required");
  const details = JSON.parse(audit.details_json);
  assert.equal(details.rollbackStatus, "failed");
  assert.equal(details.reconciliationRequired, true);
});

test("audit update failure is surfaced as pending reconciliation", async () => {
  const rule = evidenceRule();
  const state = makeEnv({ pending: [rule], dbOptions: { failUpdate: true } });
  const response = await worker.fetch(makeRequest("/training/approve", makeApprovalBody([rule.id], [rule]), { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" }), state.env, ctx);
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.equal(result.auditStatus, "pending_reconciliation");
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS", { type: "json" })).length, 1);
  assert.equal([...state.DB.rows.values()][0].outcome, "requested");
});

test("approval fails closed when the audit D1 binding is absent", async () => {
  const rule = evidenceRule();
  const state = makeEnv({ pending: [rule], withDb: false });
  const response = await worker.fetch(makeRequest("/training/approve", makeApprovalBody([rule.id], [rule]), { "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key" }), state.env, ctx);

  assert.equal(response.status, 503);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json" })).length, 1);
});

test("NDS-only mode excludes approved ICT and RTM rules from strategy synthesis", async () => {
  const state = makeEnv({
    otherKnowledge: {
      knowledge_ICT: [{ id: "ict-approved-1", validationStatus: "approved", rule: "ICT rule" }],
      knowledge_RTM: [{ id: "rtm-approved-1", validationStatus: "approved", rule: "RTM rule" }]
    }
  });
  const response = await worker.fetch(makeRequest("/strategy/synthesize", {}, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(response.status, 409);
  assert.equal(state.env.AI.calls, 0);
  const statusResponse = await worker.fetch(makeRequest("/status", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.trainingMode, "NDS_ONLY");
  assert.deepEqual(status.activeTrainingStyles, ["NDS"]);
  assert.equal(status.ict, 1);
  assert.equal(status.rtm, 1);
  assert.equal(status.nds, 0);
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
  assert.equal(result.cmcQuoteCount, 0);
  assert.equal(result.cmcDataReady, false);
  assert.equal(result.marketDataReady, false);
  assert.equal(result.marketAnalysisEnabled, false);
});

test("market-data latest returns parsed raw TradingView events with bounded filters", async () => {
  const state = makeEnv();
  state.MARKET_DB.events.push({
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
  assert.deepEqual(state.MARKET_DB.queries.at(-1).args, ["eurusd", "eurusd", "15", "15", 10]);
});

test("market-data routes fail closed when dedicated MARKET_DB is not bound, even if the NDS DB exists", async () => {
  const state = makeEnv({ withMarketDb: false, withDb: true });
  const response = await worker.fetch(makeRequest("/market-data/status", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(response.status, 503);
  const latest = await worker.fetch(makeRequest("/market-data/latest", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(latest.status, 503);
  const cryptoLatest = await worker.fetch(makeRequest("/market-data/crypto/latest", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(cryptoLatest.status, 503);
});

test("market-data routes do not depend on the NDS/audit DB when MARKET_DB is explicitly bound", async () => {
  const state = makeEnv({ withDb: false, withMarketDb: true });
  const response = await worker.fetch(makeRequest("/market-data/status", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(response.status, 200);
});

test("market-data status reports CoinMarketCap crypto quote availability separately", async () => {
  const state = makeEnv();
  state.MARKET_DB.cmcQuotes.push({
    cmc_id: 1, symbol: "BTC", name: "Bitcoin", quote_currency: "USD",
    price: 65000, volume_24h: 1000, market_cap: 1200000,
    percent_change_1h: 0.2, percent_change_24h: 1.1, percent_change_7d: 3.2,
    cmc_rank: 1, quote_last_updated: "2026-11-08T10:00:00.000Z", ingested_at: "2026-11-08T10:00:01.000Z"
  });
  const response = await worker.fetch(makeRequest("/market-data/status", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.cmcQuoteCount, 1);
  assert.equal(result.cmcDataReady, true);
  assert.equal(result.marketAnalysisEnabled, false);
});

test("market-data crypto latest returns bounded CoinMarketCap quotes without raw payloads", async () => {
  const state = makeEnv();
  state.MARKET_DB.cmcQuotes.push({
    cmc_id: 1, symbol: "BTC", name: "Bitcoin", quote_currency: "USD",
    price: 65000, volume_24h: 1000, market_cap: 1200000,
    percent_change_1h: 0.2, percent_change_24h: 1.1, percent_change_7d: 3.2,
    cmc_rank: 1, quote_last_updated: "2026-11-08T10:00:00.000Z", ingested_at: "2026-11-08T10:00:01.000Z"
  });
  const response = await worker.fetch(makeRequest("/market-data/crypto/latest?symbol=btc&convert=USD&limit=10", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.source, "coinmarketcap");
  assert.equal(result.assetClass, "crypto");
  assert.equal(result.count, 1);
  assert.equal(result.quotes[0].symbol, "BTC");
  assert.equal("raw_json" in result.quotes[0], false);
  assert.deepEqual(state.MARKET_DB.queries.at(-1).args, ["BTC", "BTC", "USD", 10]);
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

test("approval acquires and releases the shared D1 knowledge lock", async () => {
  const state = makeEnv();
  const response = await worker.fetch(makeRequest("/training/approve", {
    confirmation: "NO",
    ids: []
  }, {
    "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key"
  }), state.env, ctx);

  assert.equal(response.status, 400);
  assert.equal(state.DB.locks.size, 0);
  assert.ok(state.DB.queries.some(query => query.sql.startsWith("INSERT INTO gs_worker_locks")));
});

test("approval fails closed while another knowledge writer holds the shared lock", async () => {
  const rule = evidenceRule();
  const state = makeEnv({ pending: [rule] });
  state.DB.locks.set("knowledge-write", {
    lock_name: "knowledge-write",
    owner_token: "other-writer",
    lease_until_ms: Date.now() + 60000,
    updated_at: new Date().toISOString()
  });
  const response = await worker.fetch(makeRequest("/training/approve", makeApprovalBody([rule.id], [rule]), {
    "X-Goldstar-Bridge-Key": "dedicated-l1-bridge-key"
  }), state.env, ctx);

  assert.equal(response.status, 409);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json" })).length, 1);
  assert.equal((await state.KNOWLEDGE.get("knowledge_NDS", { type: "json" })).length, 0);
});

test("pending review excludes metadata placeholders and reports verified trading-rule eligibility", async () => {
  const metadata = {
    id: "metadata-1",
    validationStatus: "pending",
    category: "YouTube Uploads",
    source: "https://t.me/s/NDS4ALLVIDEOS",
    sourcePostIds: ["NDS4ALLVIDEOS/235"],
    sourceExcerpt: "Channel-level content metadata, not a trading rule."
  };
  const validRule = evidenceRule({ id: "valid-rule-1" });
  const unverifiedRule = evidenceRule({
    id: "unverified-rule-1",
    sourceExcerptVerified: false
  });
  const state = makeEnv({ pending: [metadata, validRule, unverifiedRule] });
  const response = await worker.fetch(makeRequest("/training/pending", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.totalPendingEntries, 3);
  assert.equal(result.excludedNonRuleCount, 1);
  assert.equal(result.count, 2);
  assert.equal(result.approvalEligibleCount, 1);
  assert.equal(result.rules.find(rule => rule.id === "valid-rule-1").approvalEligible, true);
  assert.equal(result.rules.find(rule => rule.id === "unverified-rule-1").approvalEligible, false);

  const progressResponse = await worker.fetch(makeRequest("/training/progress", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  const progress = await progressResponse.json();
  assert.equal(progress.pendingNDS, 2);
  assert.equal(progress.pendingNDSNonRule, 1);
  assert.equal(progress.pendingNDSApprovalEligible, 1);
});

test("missing pending KV key is treated as an empty queue, not a server error", async () => {
  const state = makeEnv();
  state.KNOWLEDGE.values.delete("knowledge_NDS_pending");
  const pendingResponse = await worker.fetch(makeRequest("/training/pending?limit=1", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(pendingResponse.status, 200);
  const pending = await pendingResponse.json();
  assert.equal(pending.count, 0);
  assert.deepEqual(pending.rules, []);

  const progressResponse = await worker.fetch(makeRequest("/training/progress", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(progressResponse.status, 200);
  const progress = await progressResponse.json();
  assert.equal(progress.pendingNDS, 0);
});

test("knowledge KV read failures never masquerade as empty approved stores", async () => {
  const state = makeEnv({ kvOptions: { failGetKeys: ["knowledge_NDS"] } });
  const response = await worker.fetch(makeRequest("/status", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(response.status, 500);
});

test("pending queue read failures return an error instead of an empty queue", async () => {
  const state = makeEnv({ kvOptions: { failGetKeys: ["knowledge_NDS_pending"] } });
  const response = await worker.fetch(makeRequest("/training/pending?limit=1", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(response.status, 500);
});

test("training progress fails visibly when pending KV cannot be read", async () => {
  const state = makeEnv({ kvOptions: { failGetKeys: ["knowledge_NDS_pending"] } });
  const response = await worker.fetch(makeRequest("/training/progress", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(response.status, 500);
});

test("strategy KV read failures are not reported as a missing or legacy strategy", async () => {
  const state = makeEnv({ strategyKvOptions: { failGetKeys: ["current_strategy"] } });
  const response = await worker.fetch(makeRequest("/status", undefined, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);
  assert.equal(response.status, 500);
});

test("strategy synthesis reserves the shared daily AI budget before inference", async () => {
  const state = makeEnv({ active: [{ id: "approved-1", validationStatus: "approved", rule: "Wait for a confirmed market-structure shift." }] });
  const response = await worker.fetch(makeRequest("/strategy/synthesize", {}, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);

  assert.equal(response.status, 200);
  assert.equal(state.env.AI.calls, 1);
  assert.ok([...state.DB.budgets.values()][0] > 0);
});

test("strategy synthesis is blocked when the shared daily AI budget is exhausted", async () => {
  const state = makeEnv({ active: [{ id: "approved-1", validationStatus: "approved", rule: "Wait for a confirmed market-structure shift." }] });
  state.DB.budgets.set(new Date().toISOString().slice(0, 10), 3000);
  const response = await worker.fetch(makeRequest("/strategy/synthesize", {}, {
    "X-API-Key": "general-api-key"
  }), state.env, ctx);

  assert.notEqual(response.status, 200);
  assert.equal(state.env.AI.calls, 0);
});

test("L2 has one disabled NDS writer and no Browser Run fallback", async () => {
  const source = await readFile(new URL("../src/worker.js", import.meta.url), "utf8");
  assert.match(source, /NDS ingestion is owned by goldstar-trainer; this duplicate writer is disabled/);
  assert.doesNotMatch(source, /BROWSER/);
  assert.equal(source.split('path === "/training/batch"').length - 1, 1);
});

test("migrations define shared controls and isolate market-research event tables", async () => {
  const lockMigration = await readFile(new URL("../migrations/0002_shared_worker_lock.sql", import.meta.url), "utf8");
  const supportMigration = await readFile(new URL("../migrations/0003_staging_support_tables.sql", import.meta.url), "utf8");
  const marketMigration = await readFile(new URL("../migrations/0004_market_research_events.sql", import.meta.url), "utf8");
  const cmcMigration = await readFile(new URL("../migrations/0007_coinmarketcap_quotes.sql", import.meta.url), "utf8");
  assert.match(lockMigration, /gs_worker_locks/);
  assert.match(lockMigration, /gs_ai_daily_budget/);
  assert.match(supportMigration, /gs_audit_log/);
  assert.match(marketMigration, /CREATE TABLE IF NOT EXISTS tv_events/);
  assert.match(cmcMigration, /CREATE TABLE IF NOT EXISTS cmc_quotes/);
  assert.match(cmcMigration, /CREATE TABLE IF NOT EXISTS cmc_ingestion_runs/);
  assert.match(marketMigration, /CREATE TABLE IF NOT EXISTS gs_market_events/);
  assert.match(marketMigration, /goldstar_market_research_staging/);
});

test("staging Wrangler config cannot target Production or enable a Cron", async () => {
  const config = await readFile(new URL("../wrangler.staging.toml", import.meta.url), "utf8");
  assert.match(config, /name = "goldstar-financial-v3-staging"/);
  assert.doesNotMatch(config, /crons\s*=/i);
});
