const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, X-Goldstar-Bridge-Key",
};
const AI_MODEL = "@cf/zai-org/glm-4.7-flash";
// Fail closed until a verified market-data consumer is connected and tested.
const MARKET_ANALYSIS_ENABLED = false;
const KV_CACHE_TTL = 60;
const NDS_CHANNELS = [
  {url:"https://t.me/s/NDS4ALLVIDEOS",name:"NDS4ALLVIDEOS"},
  {url:"https://t.me/s/FuzzyLogic_NDS",name:"FuzzyLogic_NDS"},
  {url:"https://t.me/s/BNJ1I",name:"BNJ1I"},
  {url:"https://t.me/s/cottagends",name:"cottagends"},
];

function ok(data, s) {
  if (!s) s = 200;
  return new Response(JSON.stringify(data, null, 2), {
    status: s,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}
function err(msg, s) {
  if (!s) s = 400;
  return ok({ error: msg, success: false, timestamp: Date.now() }, s);
}
async function body(req) {
  try {
    var t = await req.text();
    return t ? JSON.parse(t) : {};
  } catch (e) {
    throw new Error("JSON invalid");
  }
}
function extractJSON(t) {
  if (!t) return null;
  try { return JSON.parse(t); } catch (e) {}
  var bt = String.fromCharCode(96) + String.fromCharCode(96) + String.fromCharCode(96);
  var idx1 = t.indexOf(bt);
  if (idx1 >= 0) {
    var afterFirst = t.substring(idx1 + 3);
    if (afterFirst.startsWith("json")) afterFirst = afterFirst.substring(4);
    var idx2 = afterFirst.indexOf(bt);
    if (idx2 >= 0) {
      try { return JSON.parse(afterFirst.substring(0, idx2).trim()); } catch (e) {}
    }
  }
  var a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a > -1 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {}
  }
  var c = t.indexOf("["), d = t.lastIndexOf("]");
  if (c > -1 && d > c) {
    try { return JSON.parse(t.slice(c, d + 1)); } catch (e) {}
  }
  return null;
}
const AI_DAILY_BUDGET_NEURONS = 3000;
const AI_INPUT_NEURONS_PER_MILLION = 5500;
const AI_OUTPUT_NEURONS_PER_MILLION = 36400;

async function reserveAiBudget(env, prompt, maxTokens) {
  if (!env.DB || typeof env.DB.prepare !== "function") throw new Error("AI budget D1 binding unavailable; inference blocked");
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const inputTokens = Math.ceil(String(prompt || "").length / 2);
  const estimatedNeurons = Math.max(1, Math.ceil(
    ((inputTokens * AI_INPUT_NEURONS_PER_MILLION) + (maxTokens * AI_OUTPUT_NEURONS_PER_MILLION)) / 1000000 * 1.5
  ));
  const reserved = await env.DB.prepare(
    "INSERT INTO gs_ai_daily_budget (day_utc, reserved_neurons, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(day_utc) DO UPDATE SET reserved_neurons = gs_ai_daily_budget.reserved_neurons + excluded.reserved_neurons, updated_at = excluded.updated_at " +
    "WHERE gs_ai_daily_budget.reserved_neurons + excluded.reserved_neurons <= ? RETURNING reserved_neurons"
  ).bind(day, estimatedNeurons, now.toISOString(), AI_DAILY_BUDGET_NEURONS).first();
  if (!reserved) throw new Error("AI daily safety budget reached; inference skipped to prevent overage");
  return reserved.reserved_neurons;
}

async function ai(env, prompt) {
  try {
    await reserveAiBudget(env, prompt, 1024);
    var r = await env.AI.run(AI_MODEL, { prompt: prompt, max_tokens: 1024 });
    if (r && r.response) return r.response;
    if (r && r.choices && r.choices[0] && r.choices[0].text) return r.choices[0].text;
    if (typeof r === "string") return r;
    return JSON.stringify(r);
  } catch (e) {
    throw new Error("AI error: " + String(e.message || e));
  }
}

async function getRules(env) {
  // A missing key is a valid empty store; a KV read failure is not.
  // Never turn an unavailable knowledge store into an apparently empty/healthy state.
  var results = await Promise.all([
    env.KNOWLEDGE.get("knowledge_ICT", { type: "json", cacheTtl: KV_CACHE_TTL }),
    env.KNOWLEDGE.get("knowledge_RTM", { type: "json", cacheTtl: KV_CACHE_TTL }),
    env.KNOWLEDGE.get("knowledge_NDS", { type: "json", cacheTtl: KV_CACHE_TTL }),
  ]);
  var i = results[0] === null ? [] : results[0];
  var r = results[1] === null ? [] : results[1];
  var n = results[2] === null ? [] : results[2];
  if (![i, r, n].every(Array.isArray)) throw new Error("Knowledge KV returned an invalid store shape");
  var approved = function(list) { return list.filter(function(rule) { return rule && rule.validationStatus === "approved"; }); };
  var ai = approved(i); var ar = approved(r); var an = approved(n);
  var legacy = { ict: i.length - ai.length, rtm: r.length - ar.length, nds: n.length - an.length };
  return { ict: ai, rtm: ar, nds: an, all: ai.concat(ar, an), legacy: legacy, legacyTotal: legacy.ict + legacy.rtm + legacy.nds };
}

function parseStrategyRecord(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

async function isApprovedStrategy(raw, approvedRules) {
  var record = parseStrategyRecord(raw);
  if (!(record &&
    record.status === "approved" &&
    typeof record.sourceRulesHash === "string" &&
    record.sourceRulesHash.length === 64 &&
    Array.isArray(record.sourceRuleIds) &&
    record.sourceRuleIds.length > 0 &&
    !!record.approvedAt &&
    !!record.approvedBy)) return false;
  var ids = record.sourceRuleIds.map(function(id) { return String(id); });
  if (new Set(ids).size !== ids.length) return false;
  var byId = new Map((approvedRules || []).map(function(rule) { return [String(rule.id), rule]; }));
  var sourceRules = ids.map(function(id) { return byId.get(id); });
  if (sourceRules.some(function(rule) { return !rule; })) return false;
  return (await sha256Hex(JSON.stringify(sourceRules))) === record.sourceRulesHash;
}

async function sha256Hex(value) {
  var digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), function(byte) {
    return byte.toString(16).padStart(2, "0");
  }).join("");
}

async function hasVerifiedRuleEvidence(rule) {
  if (!rule || typeof rule !== "object" ||
      rule.validationStatus !== "pending" ||
      rule.contentType !== "trading_rule" ||
      rule.sourceExcerptVerified !== true) return false;
  var sourcePostId = String(rule.sourcePostId || "").trim();
  var sourcePostUrl = String(rule.sourcePostUrl || "").trim();
  var excerpt = String(rule.sourceExcerpt || "").trim();
  var expectedHash = String(rule.sourceExcerptHash || "").trim().toLowerCase();
  if (!sourcePostId || excerpt.length < 40 || excerpt.length > 2000 ||
      !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  try {
    var sourceUrl = new URL(sourcePostUrl);
    if (sourceUrl.protocol !== "https:" || sourceUrl.hostname !== "t.me") return false;
    var match = sourceUrl.pathname.match(/^\/s\/([A-Za-z0-9_]+)\/(\d+)$/);
    if (!match || match[2] !== sourcePostId) return false;
    if (!NDS_CHANNELS.some(function(channel) { return channel.name === match[1]; })) return false;
  } catch (_) {
    return false;
  }
  return (await sha256Hex(excerpt)) === expectedHash;
}

function parseJsonSafe(value) {
  try { return JSON.parse(value); } catch (_) { return null; }
}

function financialRuleEvidencePayload(rule) {
  return {
    id: String(rule.id || ""),
    validationStatus: String(rule.validationStatus || ""),
    contentType: String(rule.contentType || ""),
    category: String(rule.category || ""),
    rule: String(rule.rule || rule.description || ""),
    conditions: Array.isArray(rule.conditions) ? rule.conditions.map(function(value) { return String(value); }) : [],
    priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : null,
    sourcePostId: String(rule.sourcePostId || ""),
    sourcePostUrl: String(rule.sourcePostUrl || ""),
    sourceExcerptHash: String(rule.sourceExcerptHash || ""),
    sourcePostContentHash: String(rule.sourcePostContentHash || ""),
    sourceExcerptVerified: rule.sourceExcerptVerified === true
  };
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  var difference = 0;
  for (var i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

const KNOWLEDGE_WRITE_LOCK_NAME = "knowledge-write";
const KNOWLEDGE_WRITE_LOCK_LEASE_MS = 10 * 60 * 1000;

async function withKnowledgeWriteLock(env, operation) {
  if (!env.DB || typeof env.DB.prepare !== "function") return err("Knowledge write lock D1 binding is unavailable", 503);
  const ownerToken = crypto.randomUUID();
  const now = Date.now();
  let acquired;
  try {
    acquired = await env.DB.prepare(
      "INSERT INTO gs_worker_locks (lock_name, owner_token, lease_until_ms, updated_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(lock_name) DO UPDATE SET owner_token = excluded.owner_token, lease_until_ms = excluded.lease_until_ms, updated_at = excluded.updated_at " +
      "WHERE gs_worker_locks.lease_until_ms <= ? RETURNING owner_token"
    ).bind(KNOWLEDGE_WRITE_LOCK_NAME, ownerToken, now + KNOWLEDGE_WRITE_LOCK_LEASE_MS, new Date(now).toISOString(), now).first();
  } catch (error) {
    return err("Knowledge write lock unavailable; operation failed closed", 503);
  }
  if (!acquired || acquired.owner_token !== ownerToken) return err("Knowledge store is busy; retry shortly", 409);
  try {
    return await operation();
  } finally {
    try {
      await env.DB.prepare("DELETE FROM gs_worker_locks WHERE lock_name = ? AND owner_token = ?")
        .bind(KNOWLEDGE_WRITE_LOCK_NAME, ownerToken).run();
    } catch (error) {
      // The lease expires automatically if a release fails.
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      var url = new URL(request.url);
      var path = url.pathname;
      var method = request.method;
      if (method === "OPTIONS") return new Response(null, { headers: CORS });

      var bridgeKey = request.headers.get("X-Goldstar-Bridge-Key");
      // API keys are accepted only in headers; query-string credentials can leak through logs and history.
      var legacyKey = request.headers.get("X-API-Key");
      if (path !== "/health") {
        var validBridge = !!(bridgeKey && env.L1_BRIDGE_KEY && bridgeKey === env.L1_BRIDGE_KEY);
        var validLegacy = !!(legacyKey && env.API_KEY && legacyKey === env.API_KEY);
        if (!validBridge && !validLegacy) return err("Auth required", 401);
      }

      if (path === "/health") return ok({ status: "ok", version: "3.0.1", analysisEnabled: MARKET_ANALYSIS_ENABLED });

      if (path === "/") return ok({
        name: "Goldstar L2", version: "3.0.1", analysisEnabled: MARKET_ANALYSIS_ENABLED, analysisMode: "disabled_until_verified_market_data",
        styles: ["ICT", "RTM", "NDS"],
        endpoints: ["/health","/status","/strategy","/knowledge/:style","/training/progress","/training/sources","/strategy/synthesize","/market-data/status","/market-data/latest","/analyze"]
      });

      if (path === "/status") {
        var k = await getRules(env);
        var strat = await env.STRATEGY.get("current_strategy", { cacheTtl: KV_CACHE_TTL });
        var strategyRecord = parseStrategyRecord(strat);
        var strategyReady = await isApprovedStrategy(strat, k.all);
        var strategyStatus = strategyReady ? "approved" : (strategyRecord ? (strategyRecord.status || "unapproved") : (strat ? "legacy_unverified" : "not_created"));
        return ok({ totalRules: k.all.length, approvedRules: k.all.length, legacyRules: k.legacyTotal, legacy: k.legacy, strategyReady: strategyReady, strategyStatus: strategyStatus, analysisEnabled: MARKET_ANALYSIS_ENABLED, ict: k.ict.length, rtm: k.rtm.length, nds: k.nds.length });
      }

      if (path === "/training/load-prebuilt" && method === "POST") {
        var prebuilt = await getRules(env);
        if (!prebuilt.ict.length && !prebuilt.rtm.length) {
          return err("No approved ICT/RTM rules. Legacy records blocked from strategy use: ICT="+prebuilt.legacy.ict+", RTM="+prebuilt.legacy.rtm+". They lack source provenance and validation status.", 409);
        }
        return ok({
          success: true,
          ictRules: prebuilt.ict.length,
          rtmRules: prebuilt.rtm.length,
          message: "Existing ICT/RTM knowledge was verified; no external source was imported."
        });
      }

      if (path === "/training/progress") {
        var k2 = await getRules(env);
        var pendingProgress = await env.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json" });
        if (pendingProgress !== null && !Array.isArray(pendingProgress)) return err("Pending NDS store has invalid shape", 500);
        var pendingEntries = pendingProgress === null ? [] : pendingProgress;
        var pendingRuleEntries = pendingEntries.filter(function(rule) { return rule && rule.contentType === "trading_rule"; });
        var pendingEligibility = await Promise.all(pendingRuleEntries.map(hasVerifiedRuleEvidence));
        return ok({
          ict: k2.ict.length, rtm: k2.rtm.length, nds: k2.nds.length,
          approvedTotal: k2.all.length, legacy: k2.legacy,
          pendingNDS: pendingRuleEntries.length,
          pendingNDSNonRule: pendingEntries.length - pendingRuleEntries.length,
          pendingNDSApprovalEligible: pendingEligibility.filter(Boolean).length
        });
      }

      if (path === "/training/pending" && method === "GET") {
        var pendingRaw = await env.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json", cacheTtl: KV_CACHE_TTL });
        var pendingEntries = pendingRaw === null ? [] : pendingRaw;
        if (!Array.isArray(pendingEntries)) return err("Pending NDS store has invalid shape", 500);
        var pendingRuleEntries = pendingEntries.filter(function(rule) { return rule && rule.contentType === "trading_rule"; });
        var pendingEligibility = await Promise.all(pendingRuleEntries.map(hasVerifiedRuleEvidence));
        var reviewRules = pendingRuleEntries.map(function(rule, index) {
          return Object.assign({}, rule, { approvalEligible: pendingEligibility[index] });
        });
        var limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 10)));
        return ok({
          status: "pending_review",
          count: reviewRules.length,
          totalPendingEntries: pendingEntries.length,
          excludedNonRuleCount: pendingEntries.length - reviewRules.length,
          approvalEligibleCount: pendingEligibility.filter(Boolean).length,
          returned: Math.min(limit, reviewRules.length),
          rules: reviewRules.slice(0, limit)
        });
      }

      if (path === "/training/approve" && method === "POST" && !validBridge) return err("L1 bridge authorization required", 403);

      if (path === "/training/approve" && method === "POST") {
        return await withKnowledgeWriteLock(env, async () => {
        var approvalBody;
        try { approvalBody = await body(request); } catch (e) { return err("Invalid approval payload", 400); }
        if (approvalBody.confirmation !== "APPROVE") return err("Explicit APPROVE confirmation is required", 400);
        if (!Array.isArray(approvalBody.ids) || approvalBody.ids.length < 1 || approvalBody.ids.length > 10) return err("Provide 1 to 10 pending rule IDs", 400);
        var ids = Array.from(new Set(approvalBody.ids.map(function(id) { return String(id || "").trim(); })));
        if (ids.length !== approvalBody.ids.length || ids.some(function(id) { return !id; })) return err("Rule IDs must be non-empty and unique", 400);
        var pending = await env.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json", cacheTtl: 60 });
        var active = await env.KNOWLEDGE.get("knowledge_NDS", { type: "json", cacheTtl: 60 });
        if (!Array.isArray(pending) || !Array.isArray(active)) return err("Knowledge store has invalid shape; no changes made", 500);
        var selected = pending.filter(function(rule) { return ids.indexOf(String(rule.id)) >= 0; });
        var missing = ids.filter(function(id) { return !selected.some(function(rule) { return String(rule.id) === id; }); });
        if (missing.length) return err("Some IDs are not pending: " + missing.join(", "), 404);
        var unsupported = [];
        for (var ui = 0; ui < selected.length; ui++) {
          if (!(await hasVerifiedRuleEvidence(selected[ui]))) unsupported.push(selected[ui]);
        }
        if (unsupported.length) return err("Selected rules lack verified, rule-specific source evidence; no changes made", 409);
        var activeIds = new Set(active.map(function(rule) { return String(rule.id); }));
        var alreadyActive = selected.filter(function(rule) { return activeIds.has(String(rule.id)); });
        if (alreadyActive.length) return err("One or more selected IDs are already active; no changes made", 409);
        var rawApprovalNote = String(approvalBody.approvalNote || "").trim();
        if (!rawApprovalNote || rawApprovalNote.length > 500) return err("A non-empty approval note of at most 500 characters is required", 400);
        var approvalNote = rawApprovalNote;
        var approverId = String(approvalBody.approverId || "").trim();
        var requestId = String(approvalBody.requestId || "").trim();
        var issuedAt = Number(approvalBody.issuedAt);
        var expiresAt = Number(approvalBody.expiresAt);
        var ruleSetHash = String(approvalBody.ruleSetHash || "").trim().toLowerCase();
        var approvalPayloadHash = String(approvalBody.approvalPayloadHash || "").trim().toLowerCase();
        var nowMs = Date.now();
        if (approverId !== "71007767") return err("Approval actor is not the configured L0 owner", 403);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) return err("A valid one-time approval request ID is required", 400);
        if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) ||
            issuedAt > nowMs + 30000 || issuedAt < nowMs - 300000 ||
            expiresAt <= nowMs || expiresAt <= issuedAt || expiresAt - issuedAt > 300000) {
          return err("Approval request is expired or outside the permitted time window", 409);
        }
        if (!/^[a-f0-9]{64}$/.test(ruleSetHash) || !/^[a-f0-9]{64}$/.test(approvalPayloadHash)) return err("Approval payload hashes are missing or malformed", 400);
        var canonicalApproval = {
          ids: ids.map(String).sort(),
          confirmation: "APPROVE",
          approvalNote: approvalNote,
          approverId: approverId,
          requestId: requestId,
          issuedAt: issuedAt,
          expiresAt: expiresAt,
          ruleSetHash: ruleSetHash
        };
        var computedApprovalHash = await sha256Hex(JSON.stringify(canonicalApproval));
        if (!constantTimeEqual(computedApprovalHash, approvalPayloadHash)) return err("Approval payload hash mismatch", 403);
        var evidenceHashes = [];
        for (var ri = 0; ri < selected.length; ri++) {
          evidenceHashes.push({
            id: String(selected[ri].id),
            contentHash: await sha256Hex(JSON.stringify(financialRuleEvidencePayload(selected[ri])))
          });
        }
        evidenceHashes.sort(function(left, right) { return left.id.localeCompare(right.id); });
        var computedRuleSetHash = await sha256Hex(JSON.stringify(evidenceHashes));
        if (!constantTimeEqual(computedRuleSetHash, ruleSetHash)) return err("Pending rule content changed since owner review; refresh /finpending", 409);
        if (!env.DB || typeof env.DB.prepare !== "function") return err("Audit database binding unavailable; approval is disabled", 503);
        try {
          var priorAudit = await env.DB.prepare("SELECT event_id FROM gs_audit_log WHERE event_id = ?").bind(requestId).first();
          if (priorAudit) return err("Approval request ID has already been used", 409);
        } catch (_) {
          return err("Approval replay check unavailable; approval is disabled", 503);
        }
        var now = new Date().toISOString();
        var promoted = selected.map(function(rule) {
          return Object.assign({}, rule, {
            validationStatus: "approved",
            approvedAt: now,
            approvedBy: "OWNER_L0_VIA_L1:" + approverId,
            approvalNote: approvalNote
          });
        });
        var remaining = pending.filter(function(rule) { return ids.indexOf(String(rule.id)) < 0; });
        var auditId = requestId;
        var auditDetails = {
          actor: "OWNER_L0_VIA_L1",
          approverId: approverId,
          channel: "L1_Telegram",
          requestId: requestId,
          issuedAt: issuedAt,
          expiresAt: expiresAt,
          approvalPayloadHash: approvalPayloadHash,
          ruleSetHash: ruleSetHash,
          approvalNote: approvalNote,
          ruleIds: ids,
          sourceEvidence: selected.map(function(rule) {
            return { id: String(rule.id), sourcePostUrl: rule.sourcePostUrl, sourceExcerptHash: rule.sourceExcerptHash };
          }),
          requestedAt: now
        };
        try {
          await env.DB.prepare("INSERT INTO gs_audit_log (event_id, actor_agent_id, event_type, resource_type, resource_id, outcome, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(auditId, "OWNER:" + approverId, "NDS_RULE_APPROVAL", "knowledge_NDS", ids.join(","), "requested", JSON.stringify(auditDetails)).run();
        } catch (_) {
          return err("Approval audit could not be recorded; no knowledge changes made", 503);
        }
        try {
          await env.KNOWLEDGE.put("knowledge_NDS", JSON.stringify(active.concat(promoted)));
          await env.KNOWLEDGE.put("knowledge_NDS_pending", JSON.stringify(remaining));
        } catch (_) {
          try {
            await env.KNOWLEDGE.put("knowledge_NDS", JSON.stringify(active));
            await env.DB.prepare("UPDATE gs_audit_log SET outcome = ?, details_json = ? WHERE event_id = ?")
              .bind("failed", JSON.stringify(Object.assign({}, auditDetails, { failure: "KV write failed; rollback attempted" })), auditId).run();
          } catch (_) {}
          return err("Approval storage failed; rollback was attempted and the audit record was retained", 503);
        }
        try {
          await env.DB.prepare("UPDATE gs_audit_log SET outcome = ?, details_json = ? WHERE event_id = ?")
            .bind("approved", JSON.stringify(Object.assign({}, auditDetails, { approvedAt: new Date().toISOString() })), auditId).run();
        } catch (_) {
          return ok({ success: false, approved: promoted.length, approvedIds: ids, auditStatus: "pending_reconciliation", auditId: auditId, message: "Knowledge was updated but final audit confirmation failed; reconcile before further approvals." }, 503);
        }
        return ok({ success: true, approved: promoted.length, approvedIds: ids, pendingRemaining: remaining.length, auditId: auditId, approvedTotal: active.filter(function(rule) { return rule.validationStatus === "approved"; }).length + promoted.length });
      
        });
      }

      if (path === "/training/sources") return ok({ NDS: NDS_CHANNELS });

      if (path.startsWith("/knowledge/")) {
        var style = path.split("/")[2];
        var rules = await env.KNOWLEDGE.get("knowledge_" + style, { type: "json", cacheTtl: KV_CACHE_TTL });
        if (rules !== null && !Array.isArray(rules)) return err("Knowledge store has invalid shape", 500);
        var knowledgeRules = rules === null ? [] : rules;
        return ok({ style: style, count: knowledgeRules.length, rules: knowledgeRules });
      }

      if (path === "/strategy") {
        var sArr = await Promise.all([
          env.STRATEGY.get("current_strategy", { cacheTtl: KV_CACHE_TTL }),
          env.STRATEGY.get("strategy_updated", { cacheTtl: KV_CACHE_TTL }),
        ]);
        var rawStrategy = sArr[0];
        if (!rawStrategy) return ok({ status: "not_created", approved: false, strategy: null, lastUpdated: sArr[1] });
        var strategyRecord = parseStrategyRecord(rawStrategy);
        if (!strategyRecord) return ok({ status: "legacy_unverified", approved: false, strategy: null, legacyBytes: String(rawStrategy).length, lastUpdated: sArr[1] });
        var strategyRulesState = await getRules(env);
        var strategyApproved = await isApprovedStrategy(rawStrategy, strategyRulesState.all);
        return ok({
          status: strategyApproved ? "approved" : (strategyRecord.status || "candidate"),
          approved: strategyApproved,
          strategy: strategyRecord.strategy || null,
          ruleCount: strategyRecord.ruleCount || 0,
          sourceRuleIds: strategyRecord.sourceRuleIds || [],
          lastUpdated: sArr[1]
        });
      }

      if (path === "/strategy/synthesize" && method === "POST") {
        var k3 = await getRules(env);
        if (!k3.all.length) return err("No approved rules; legacy records are excluded from synthesis", 409);
        var strategyRules = k3.all.slice(0, 10);
        var sourceRules = JSON.stringify(strategyRules);
        var sourceRulesHash = await sha256Hex(sourceRules);
        var sourceRuleIds = strategyRules.map(function(rule) { return String(rule.id); });
        var prompt = "You are a trading research assistant. Produce a research candidate only; do not describe it as backtested, validated, approved, or executable. Combine these approved rules and state assumptions, conflicts, invalidation conditions, and missing data. Rules:\n" + JSON.stringify(strategyRules);
        var strategy = await ai(env, prompt);
        if (!strategy) return err("AI empty response", 502);
        var candidate = {
          schemaVersion: 1,
          status: "candidate",
          strategy: strategy,
          generatedAt: new Date().toISOString(),
          ruleCount: strategyRules.length,
          sourceRuleIds: sourceRuleIds,
          sourceRulesHash: sourceRulesHash
        };
        ctx.waitUntil(Promise.all([
          env.STRATEGY.put("current_strategy", JSON.stringify(candidate)),
          env.STRATEGY.put("strategy_updated", candidate.generatedAt)
        ]));
        return ok({ success: true, status: "candidate_unvalidated", approved: false, strategyLength: strategy.length, ruleCount: strategyRules.length, totalApprovedRules: k3.all.length, sourceRulesHash: sourceRulesHash, strategy: strategy });
      }

      if (path === "/market-data/status" && method === "GET") {
        if (!env.MARKET_DB || typeof env.MARKET_DB.prepare !== "function") return err("Dedicated market-data D1 binding unavailable", 503);
        try {
          var rawStatus = await env.MARKET_DB.prepare("SELECT COUNT(*) AS event_count, MAX(received_at) AS last_received_at FROM tv_events").first();
          var normalizedStatus = await env.MARKET_DB.prepare("SELECT COUNT(*) AS event_count, MAX(received_at) AS last_received_at FROM gs_market_events").first();
          var rawEventCount = Number(rawStatus && rawStatus.event_count || 0);
          var normalizedEventCount = Number(normalizedStatus && normalizedStatus.event_count || 0);
          return ok({
            source: "TradingView webhook D1",
            rawEventCount: rawEventCount,
            normalizedEventCount: normalizedEventCount,
            lastRawEventAt: rawStatus && rawStatus.last_received_at || null,
            lastNormalizedEventAt: normalizedStatus && normalizedStatus.last_received_at || null,
            rawIngestionReady: rawEventCount > 0,
            marketDataReady: normalizedEventCount > 0,
            marketAnalysisEnabled: MARKET_ANALYSIS_ENABLED
          });
        } catch (_) {
          return err("Market-data status query failed", 503);
        }
      }

      if (path === "/market-data/latest" && method === "GET") {
        if (!env.MARKET_DB || typeof env.MARKET_DB.prepare !== "function") return err("Dedicated market-data D1 binding unavailable", 503);
        var requestedLimit = Number(url.searchParams.get("limit") || 25);
        var marketLimit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 25;
        var marketSymbol = String(url.searchParams.get("symbol") || "").trim().slice(0, 100);
        var marketTimeframe = String(url.searchParams.get("timeframe") || "").trim().slice(0, 40);
        try {
          var marketResult = await env.MARKET_DB.prepare(
            "SELECT id, event_hash, received_at, symbol, exchange_name, timeframe, event_type, payload_json FROM tv_events WHERE (? = '' OR UPPER(symbol) = UPPER(?)) AND (? = '' OR UPPER(timeframe) = UPPER(?)) ORDER BY received_at DESC LIMIT ?"
          ).bind(marketSymbol, marketSymbol, marketTimeframe, marketTimeframe, marketLimit).all();
          var marketEvents = (marketResult && Array.isArray(marketResult.results) ? marketResult.results : []).map(function(row) {
            var event = Object.assign({}, row, { payload: parseJsonSafe(row.payload_json) });
            delete event.payload_json;
            return event;
          });
          return ok({
            source: "tv_events",
            count: marketEvents.length,
            filters: { symbol: marketSymbol || null, timeframe: marketTimeframe || null },
            events: marketEvents
          });
        } catch (_) {
          return err("Market-data event query failed", 503);
        }
      }

      if (path === "/analyze" && method === "POST") {
        if (!MARKET_ANALYSIS_ENABLED) {
          return err("Market analysis is disabled until a verified market-data feed is connected, consumed, and validated. No directional signal was generated.", 503);
        }
        return err("Market analysis handler is not configured.", 503);
      }

      if (path === "/training/batch" && method === "POST") return err("NDS ingestion is owned by goldstar-trainer; this duplicate writer is disabled", 409);

            return err("Not found: " + path, 404);
    } catch (e) {
      return err("Server error: " + String(e.message || e), 500);
    }
  }
};
