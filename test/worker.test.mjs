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
  return {
    rows,
    prepare(sql) {
      return {
        bind(...args) {
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
