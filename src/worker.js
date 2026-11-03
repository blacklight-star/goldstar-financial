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
async function ai(env, prompt) {
  try {
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
  var results = await Promise.all([
    env.KNOWLEDGE.get("knowledge_ICT", { type: "json", cacheTtl: KV_CACHE_TTL }).catch(function() { return []; }),
    env.KNOWLEDGE.get("knowledge_RTM", { type: "json", cacheTtl: KV_CACHE_TTL }).catch(function() { return []; }),
    env.KNOWLEDGE.get("knowledge_NDS", { type: "json", cacheTtl: KV_CACHE_TTL }).catch(function() { return []; }),
  ]);
  var i = results[0] || [];
  var r = results[1] || [];
  var n = results[2] || [];
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
        endpoints: ["/health","/status","/strategy","/knowledge/:style","/training/progress","/training/sources","/strategy/synthesize","/analyze"]
      });

      if (path === "/status") {
        var k = await getRules(env);
        var strat = await env.STRATEGY.get("current_strategy", { cacheTtl: KV_CACHE_TTL }).catch(function() { return null; });
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
        return ok({ ict: k2.ict.length, rtm: k2.rtm.length, nds: k2.nds.length, approvedTotal: k2.all.length, legacy: k2.legacy, pendingNDS: (await env.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json" }).catch(function() { return []; }) || []).length });
      }

      if (path === "/training/pending" && method === "GET") {
        var pendingRules = await env.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json", cacheTtl: KV_CACHE_TTL }).catch(function() { return []; });
        if (!Array.isArray(pendingRules)) return err("Pending NDS store has invalid shape", 500);
        var limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 10)));
        return ok({ status: "pending_review", count: pendingRules.length, returned: Math.min(limit, pendingRules.length), rules: pendingRules.slice(0, limit) });
      }

      if (path === "/training/approve" && method === "POST" && !validBridge) return err("L1 bridge authorization required", 403);

      if (path === "/training/approve" && method === "POST") {
        var approvalBody;
        try { approvalBody = await body(request); } catch (e) { return err("Invalid approval payload", 400); }
        if (approvalBody.confirmation !== "APPROVE") return err("Explicit APPROVE confirmation is required", 400);
        if (!Array.isArray(approvalBody.ids) || approvalBody.ids.length < 1 || approvalBody.ids.length > 10) return err("Provide 1 to 10 pending rule IDs", 400);
        var ids = Array.from(new Set(approvalBody.ids.map(function(id) { return String(id || "").trim(); })));
        if (ids.length !== approvalBody.ids.length || ids.some(function(id) { return !id; })) return err("Rule IDs must be non-empty and unique", 400);
        var pending = await env.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json", cacheTtl: 60 }).catch(function() { return []; });
        var active = await env.KNOWLEDGE.get("knowledge_NDS", { type: "json", cacheTtl: 60 }).catch(function() { return []; });
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
        var approvalNote = String(approvalBody.approvalNote || "").trim().slice(0, 500);
        if (!approvalNote) return err("A non-empty approval note is required", 400);
        if (!env.DB || typeof env.DB.prepare !== "function") return err("Audit database binding unavailable; approval is disabled", 503);
        var now = new Date().toISOString();
        var promoted = selected.map(function(rule) {
          return Object.assign({}, rule, {
            validationStatus: "approved",
            approvedAt: now,
            approvedBy: "OWNER_L0_VIA_L1",
            approvalNote: approvalNote
          });
        });
        var remaining = pending.filter(function(rule) { return ids.indexOf(String(rule.id)) < 0; });
        var auditId = crypto.randomUUID();
        var auditDetails = {
          actor: "OWNER_L0_VIA_L1",
          channel: "L1_Telegram",
          approvalNote: approvalNote,
          ruleIds: ids,
          sourceEvidence: selected.map(function(rule) {
            return { id: String(rule.id), sourcePostUrl: rule.sourcePostUrl, sourceExcerptHash: rule.sourceExcerptHash };
          }),
          requestedAt: now
        };
        try {
          await env.DB.prepare("INSERT INTO gs_audit_log (event_id, actor_agent_id, event_type, resource_type, resource_id, outcome, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(auditId, "OWNER", "NDS_RULE_APPROVAL", "knowledge_NDS", ids.join(","), "requested", JSON.stringify(auditDetails)).run();
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
      }

      if (path === "/training/sources") return ok({ NDS: NDS_CHANNELS });

      if (path.startsWith("/knowledge/")) {
        var style = path.split("/")[2];
        var rules = await env.KNOWLEDGE.get("knowledge_" + style, { type: "json", cacheTtl: KV_CACHE_TTL }).catch(function() { return []; });
        return ok({ style: style, count: (rules || []).length, rules: rules || [] });
      }

      if (path === "/strategy") {
        var sArr = await Promise.all([
          env.STRATEGY.get("current_strategy", { cacheTtl: KV_CACHE_TTL }).catch(function() { return null; }),
          env.STRATEGY.get("strategy_updated", { cacheTtl: KV_CACHE_TTL }).catch(function() { return null; }),
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

      if (path === "/analyze" && method === "POST") {
        if (!MARKET_ANALYSIS_ENABLED) {
          return err("Market analysis is disabled until a verified market-data feed is connected, consumed, and validated. No directional signal was generated.", 503);
        }
        return err("Market analysis handler is not configured.", 503);
      }

      if (path === "/training/batch" && method === "POST") return err("NDS ingestion is owned by goldstar-trainer; this duplicate writer is disabled", 409);

      if (path === "/training/batch" && method === "POST") {
        if (!env.BROWSER) return err("BROWSER binding not active", 503);
        var results = [];
        var activeExisting = (await env.KNOWLEDGE.get("knowledge_NDS", { type: "json", cacheTtl: KV_CACHE_TTL }).catch(function() { return []; })) || [];
        var existing = (await env.KNOWLEDGE.get("knowledge_NDS_pending", { type: "json", cacheTtl: KV_CACHE_TTL }).catch(function() { return []; })) || [];
        if (!Array.isArray(activeExisting) || !Array.isArray(existing)) return err("NDS knowledge store has invalid shape; refusing to overwrite it", 500);
        var seen = new Set(activeExisting.concat(existing).map(function(r) {
          return String(r.rule || r.description || r.title || JSON.stringify(r)).trim().toLowerCase().replace(/\s+/g, " ");
        }));
        var additions = [];
        for (var ci = 0; ci < NDS_CHANNELS.length; ci++) {
          var ch = NDS_CHANNELS[ci];
          try {
            var browserResponse = await env.BROWSER.quickAction("content", {
              url: ch.url,
              gotoOptions: { waitUntil: "domcontentloaded", timeout: 30000 }
            });
            if (!browserResponse || !browserResponse.ok) {
              var browserError = browserResponse ? await browserResponse.text() : "";
              throw new Error("Browser Run content failed: HTTP " + (browserResponse ? browserResponse.status : "no response") + " " + browserError.substring(0, 200));
            }
            var browserPayload = await browserResponse.json();
            if (!browserPayload.success || typeof browserPayload.result !== "string") throw new Error("Browser Run returned unsuccessful content");
            var html = browserPayload.result;
            var text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            if (!text) throw new Error("Source content is empty");
            var raw2 = await ai(env, "Extract only explicit NDS trading rules from this source. Do not invent rules. Return JSON array [{category,rule,conditions,priority}]. Source: " + text.substring(0, 5000));
            var parsed = extractJSON(raw2);
            var rules2 = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.rules) ? parsed.rules : []);
            var addedForChannel = 0;
            for (var ri = 0; ri < rules2.length; ri++) {
              var item = rules2[ri];
              if (!item || typeof item !== "object") continue;
              var ruleText = String(item.rule || item.description || item.title || "").trim();
              if (!ruleText) continue;
              var fingerprint = ruleText.toLowerCase().replace(/\s+/g, " ");
              if (seen.has(fingerprint)) continue;
              seen.add(fingerprint);
              additions.push(Object.assign({}, item, {
                id: "nds_" + Date.now() + "_" + additions.length,
                style: "NDS",
                source: ch.url,
                sourceName: ch.name,
                collectedAt: new Date().toISOString(), validationStatus: "pending", sourceExcerpt: text.slice(-2500)
              }));
              addedForChannel++;
            }
            results.push({ channel: ch.name, rules: addedForChannel, status: "success" });
          } catch (e) {
            results.push({ channel: ch.name, rules: 0, status: "error", error: String(e.message || e) });
          }
        }
        if (additions.length) {
          await env.KNOWLEDGE.put("knowledge_NDS_pending", JSON.stringify(existing.concat(additions)));
        }
        var total = results.reduce(function(s, r) { return s + (r.rules || 0); }, 0);
        var failed = results.filter(function(r) { return r.status === "error"; }).length;
        return ok({ success: failed < results.length, channels: results, newRules: total, totalRules: total, existingRules: existing.length, storedTotal: existing.length + additions.length }, failed === results.length ? 502 : 200);
      }

      return err("Not found: " + path, 404);
    } catch (e) {
      return err("Server error: " + String(e.message || e), 500);
    }
  }
};
