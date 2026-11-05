import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import worker from "../src/worker.js";

function makeKv(initial = {}, options = {}) {
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
      if ((options.failPutKeys || []).includes(key)) throw new Error("simulated KV write failure");
      values.set(key, String(value));
    }
  };
}

function makeDb(options = {}) {
  const rows = new Map();
  const locks = new Map();
  const budgets = new Map();
  const events = [];
  const queries = [];
  return {
    rows,
    locks,
    budgets,
    events,
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
          return { results: events.slice(0, Number(args[4] || 100)) };
        }
      };
      return statement;
    }
  };
}

function makeEnv({ pending = [], active = [], strategy = null, withDb = true, dbOptions = {}, kvOptions = {} } = {}) {
  const KNOWLEDGE = makeKv({
    knowledge_NDS_pending: pending,
    knowledge_NDS: active
  }, kvOptions);
  const STRATEGY = makeKv(strategy === null ? {} : { current_strategy: strategy });
  const DB = withDb ? makeDb(dbOptions) : undefined;
  return {
    env: {
      API_KEY: "general-api-key",
      L1_BRIDGE_KEY: "dedicated-l1-bridge-key",
      KNOWLEDGE,
      STRATEGY,
      DB,
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
