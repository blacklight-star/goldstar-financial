import { simulateRiskGate } from "./risk.js";
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
  {url:"https://t.me/s/NDS4ALLVIDEOS",name:"NDS4ALLVIDEOS",sourceOriginType:"third_party_video_archive"},
  {url:"https://t.me/s/FuzzyLogic_NDS",name:"FuzzyLogic_NDS",sourceOriginType:"official_telegram_channel"},
  {url:"https://t.me/s/BNJ1I",name:"BNJ1I",sourceOriginType:"third_party_course_aggregator"},
  {url:"https://t.me/s/cottagends",name:"cottagends",sourceOriginType:"community_repost_channel"},
];
const NDS_PRIMARY_AUTHOR_DOCUMENTS = new Map([
  ["129627974", {
    path: "/129627974/NDS_Strategy_English_Version",
    sourceOriginType: "primary_author_published_source",
    sourceCaptureMethod: "academia_account_pdf_download",
    role: "primary_core_methodology"
  }],
  ["129628090", {
    path: "/129628090/NDS_farsi",
    sourceOriginType: "primary_author_published_source",
    sourceCaptureMethod: "academia_account_pdf_download",
    role: "primary_core_methodology"
  }],
  ["122576333", {
    path: "/122576333/Nodal_Displacement_Sequencing_NDS_New_Approach",
    sourceOriginType: "primary_author_published_source",
    sourceCaptureMethod: "academia_account_pdf_download",
    role: "primary_author_supplement"
  }],
  ["122966805", {
    path: "/122966805/Advanced_Money_Management_Strategy_Applicable_to_Nodal_Displacement_Geometry",
    sourceOriginType: "primary_author_published_source",
    sourceCaptureMethod: "academia_account_pdf_download",
    role: "primary_author_supplement"
  }],
  ["122832409", {
    path: "/122832409/Advanced_Quantitative_Trading_Integrating_Artificial_Intelligence_with_Nodal_Displacement_Sequencing",
    sourceOriginType: "primary_author_published_source",
    sourceCaptureMethod: "academia_account_pdf_download",
    role: "coauthored_author_supplement"
  }]
]);


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
async function boundedJson(req, maxBytes) {
  var declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxBytes) {
    var sizeError = new Error("Payload too large");
    sizeError.status = 413;
    throw sizeError;
  }
  if (!req.body) return {};
  var reader = req.body.getReader();
  var chunks = [];
  var total = 0;
  while (true) {
    var part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch (_) {}
      var streamError = new Error("Payload too large");
      streamError.status = 413;
      throw streamError;
    }
    chunks.push(part.value);
  }
  var bytes = new Uint8Array(total);
  var offset = 0;
  for (var i = 0; i < chunks.length; i++) {
    bytes.set(chunks[i], offset);
    offset += chunks[i].byteLength;
  }
  var raw = new TextDecoder().decode(bytes);
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); }
  catch (_) { throw new Error("JSON invalid"); }
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

const NDS_ONLY_MODE = true;

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
  return { ict: ai, rtm: ar, nds: an, all: NDS_ONLY_MODE ? an : ai.concat(ar, an), activeStyles: NDS_ONLY_MODE ? ["NDS"] : ["ICT", "RTM", "NDS"], legacy: legacy, legacyTotal: legacy.ict + legacy.rtm + legacy.nds };
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

function sourceEvidencePayload(rule) {
  var payload = {
    id: String(rule.id || ""),
    contentType: String(rule.contentType || ""),
    category: String(rule.category || ""),
    rule: String(rule.rule || rule.description || ""),
    conditions: Array.isArray(rule.conditions) ? rule.conditions.map(function(value) { return String(value); }) : [],
    priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : null,
    sourcePostId: String(rule.sourcePostId || ""),
    sourcePostUrl: String(rule.sourcePostUrl || ""),
    ...(rule.sourceArchiveUrl ? { sourceArchiveUrl: String(rule.sourceArchiveUrl) } : {}),
    sourceExcerptHash: String(rule.sourceExcerptHash || ""),
    sourcePostContentHash: String(rule.sourcePostContentHash || ""),
    sourceCaptureMethod: String(rule.sourceCaptureMethod || "")
  };
  if (rule.sourceDocumentFormat) payload.sourceDocumentFormat = String(rule.sourceDocumentFormat);
  if (rule.sourceDocumentSha256) payload.sourceDocumentSha256 = String(rule.sourceDocumentSha256).toLowerCase();
  if (rule.sourceOriginType) payload.sourceOriginType = String(rule.sourceOriginType);
  payload.sourceExcerptVerified = rule.sourceExcerptVerified === true;
  return payload;
}

async function hasVerifiedRuleEvidence(rule, env) {
  if (!rule || typeof rule !== "object" ||
      rule.validationStatus !== "pending" ||
      rule.contentType !== "trading_rule" ||
      rule.sourceExcerptVerified !== true) return false;
  var sourcePostId = String(rule.sourcePostId || "").trim();
  var sourcePostUrl = String(rule.sourcePostUrl || "").trim();
  var excerpt = String(rule.sourceExcerpt || "").trim();
  var expectedHash = String(rule.sourceExcerptHash || "").trim().toLowerCase();
  var contentHash = String(rule.sourcePostContentHash || "").trim().toLowerCase();
  var signature = String(rule.sourceEvidenceSignature || "").trim().toLowerCase();
  if (!sourcePostId || excerpt.length < 40 || excerpt.length > 2000 ||
      !/^[a-f0-9]{64}$/.test(expectedHash) ||
      !/^[a-f0-9]{64}$/.test(contentHash) ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      !env || typeof env.NDS_EVIDENCE_HMAC_KEY !== "string" ||
      env.NDS_EVIDENCE_HMAC_KEY.length < 32) return false;
  try {
    var sourceUrl = new URL(sourcePostUrl);
    if (sourceUrl.protocol !== "https:") return false;
    var captureMethod = String(rule.sourceCaptureMethod || "");
    var originType = String(rule.sourceOriginType || "");
    if (captureMethod === "telegram_public_post_html") {
      if (sourceUrl.hostname !== "t.me") return false;
      var telegramMatch = sourceUrl.pathname.match(/^\/s\/([A-Za-z0-9_]+)\/(\d+)$/);
      var telegramChannel = telegramMatch && NDS_CHANNELS.find(function(channel) {
        return channel.name.toLowerCase() === telegramMatch[1].toLowerCase();
      });
      // Untyped legacy records and third-party channels are never approval-eligible.
      if (!telegramChannel || telegramMatch[2] !== sourcePostId ||
          originType !== telegramChannel.sourceOriginType ||
          originType !== "official_telegram_channel") return false;
      // Verify the full captured post, not just a Boolean and an excerpt digest.
      var sourcePostText = String(rule.sourcePostText || "");
      if (sourcePostText.length < excerpt.length || sourcePostText.length > 12000 ||
          !sourcePostText.includes(excerpt) ||
          (await sha256Hex(sourcePostText)) !== contentHash) return false;
    } else if (captureMethod === "academia_account_pdf_download" &&
        originType === "primary_author_published_source") {
      var authorDoc = NDS_PRIMARY_AUTHOR_DOCUMENTS.get(sourcePostId);
      if (!authorDoc || !["academia.edu", "www.academia.edu"].includes(sourceUrl.hostname) ||
          sourceUrl.pathname.replace(/\/$/, "") !== authorDoc.path ||
          authorDoc.sourceOriginType !== originType ||
          authorDoc.sourceCaptureMethod !== captureMethod) return false;
      if (String(rule.sourceDocumentFormat || "") !== "application/pdf" ||
          !/^[a-f0-9]{64}$/.test(String(rule.sourceDocumentSha256 || "").toLowerCase())) return false;
    } else {
      return false;
    }
  } catch (_) {
    return false;
  }
  if ((await sha256Hex(excerpt)) !== expectedHash) return false;
  var key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.NDS_EVIDENCE_HMAC_KEY),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  var expectedSignature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(JSON.stringify(sourceEvidencePayload(rule))));
  var expectedSignatureHex = Array.from(new Uint8Array(expectedSignature), function(byte) { return byte.toString(16).padStart(2, "0"); }).join("");
  return constantTimeEqual(expectedSignatureHex, signature);
}

async function buildPreviewHmacParityRule(signature) {
  const sourceExcerpt = "Preview-only NDS HMAC parity fixture: Hook precedes Rally, and the Flag follows the Rally.";
  const sourcePostText = "Official FuzzyLogic_NDS NDS method sample: " + sourceExcerpt + " Additional source context for the fixed HMAC interoperability test.";
  return {
    id: "nds-preview-hmac-parity-v1",
    validationStatus: "pending",
    contentType: "trading_rule",
    category: "cycle",
    rule: "Preview sample: Hook precedes Rally; Flag follows Rally.",
    conditions: ["Hook precedes Rally", "Rally precedes Flag"],
    priority: 5,
    sourcePostId: "987654321",
    sourcePostUrl: "https://t.me/s/FuzzyLogic_NDS/987654321",
    sourceExcerpt,
    sourcePostText,
    sourceExcerptHash: await sha256Hex(sourceExcerpt),
    sourcePostContentHash: await sha256Hex(sourcePostText),
    sourceCaptureMethod: "telegram_public_post_html",
    sourceOriginType: "official_telegram_channel",
    sourceExcerptVerified: true,
    sourceEvidenceSignature: String(signature || "").trim().toLowerCase()
  };
}

function parseJsonSafe(value) {
  try { return JSON.parse(value); } catch (_) { return null; }
}

function financialRuleEvidencePayload(rule) {
  var payload = {
    id: String(rule.id || ""),
    validationStatus: String(rule.validationStatus || ""),
    contentType: String(rule.contentType || ""),
    category: String(rule.category || ""),
    rule: String(rule.rule || rule.description || ""),
    conditions: Array.isArray(rule.conditions) ? rule.conditions.map(function(value) { return String(value); }) : [],
    priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : null,
    sourcePostId: String(rule.sourcePostId || ""),
    sourcePostUrl: String(rule.sourcePostUrl || ""),
    ...(rule.sourceArchiveUrl ? { sourceArchiveUrl: String(rule.sourceArchiveUrl) } : {}),
    sourceExcerptHash: String(rule.sourceExcerptHash || ""),
    sourcePostContentHash: String(rule.sourcePostContentHash || ""),
    sourceCaptureMethod: String(rule.sourceCaptureMethod || "")
  };
  if (rule.sourceDocumentFormat) payload.sourceDocumentFormat = String(rule.sourceDocumentFormat);
  if (rule.sourceDocumentSha256) payload.sourceDocumentSha256 = String(rule.sourceDocumentSha256).toLowerCase();
  if (rule.sourceOriginType) payload.sourceOriginType = String(rule.sourceOriginType);
  payload.sourceEvidenceSignature = String(rule.sourceEvidenceSignature || "");
  payload.sourceExcerptVerified = rule.sourceExcerptVerified === true;
  return payload;
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

      // Fixed-fixture HMAC interoperability check. Only immutable version Preview
      // hostnames are accepted; this path reads no KV/D1 state and exposes no key.
      if (path === "/__preview/hmac-verify") {
        if (!/^[0-9a-f]{8}-goldstar-financial-v3\.goldstar-nsl83\.workers\.dev$/i.test(url.hostname)) {
          return err("Preview-only diagnostic", 404);
        }
        if (method !== "POST") return err("Method not allowed", 405);
        let input;
        try { input = await boundedJson(request, 1024); }
        catch (inputError) { return err(inputError.message || "Invalid request", inputError.status || 400); }
        if (!input || typeof input.signature !== "string" || Object.keys(input).length !== 1) {
          return err("Only a single signature field is accepted", 400);
        }
        const sample = await buildPreviewHmacParityRule(input.signature);
        const signatureValid = await hasVerifiedRuleEvidence(sample, env);
        return ok({ ok: true, signatureValid: signatureValid });
      }

      var bridgeKey = request.headers.get("X-Goldstar-Bridge-Key");
      // API keys are accepted only in headers; query-string credentials can leak through logs and history.
      var legacyKey = request.headers.get("X-API-Key");
      if (path !== "/health") {
        var validBridge = !!(bridgeKey && env.L1_BRIDGE_KEY && bridgeKey === env.L1_BRIDGE_KEY);
        var validLegacy = !!(legacyKey && env.API_KEY && legacyKey === env.API_KEY);
        if (!validBridge && !validLegacy) return err("Auth required", 401);
      }

      if (path === "/health") return ok({ status: "ok", version: "3.0.1", analysisEnabled: MARKET_ANALYSIS_ENABLED });

      if (path === "/mql5/tools" || path === "/mql5/call") {
        if (method !== "POST") return err("Method not allowed", 405);
        if (!validBridge) return err("L1 bridge authentication required", 403);
        if (!env.MQL5_GATEWAY_API_KEY || !env.MQL5_GATEWAY_URL) return err("MQL5 gateway is not configured", 503);
        var mql5Input;
        try { mql5Input = await boundedJson(request, 8192); }
        catch (inputError) { return err(inputError.message || "Invalid request", inputError.status || 400); }
        if (!mql5Input || typeof mql5Input !== "object" || Array.isArray(mql5Input)) return err("JSON object required", 400);
        if (path === "/mql5/call" && (typeof mql5Input.name !== "string" || !mql5Input.name.startsWith("marketdata_"))) {
          return err("Only read-only marketdata_* tools are permitted", 400);
        }
        try {
          var gatewayUrl = new URL(env.MQL5_GATEWAY_URL);
          if (gatewayUrl.protocol !== "https:") return err("MQL5 gateway URL must use HTTPS", 503);
          var upstream = await fetch(gatewayUrl.origin + gatewayUrl.pathname.replace(/\/$/, "") + path, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + env.MQL5_GATEWAY_API_KEY
            },
            body: JSON.stringify(mql5Input)
          });
          var upstreamText = await upstream.text();
          var upstreamData;
          try { upstreamData = JSON.parse(upstreamText); }
          catch (_) { return err("MQL5 gateway returned invalid JSON", 502); }
          return ok(upstreamData, upstream.status);
        } catch (gatewayError) {
          return err("MQL5 gateway request failed", 502);
        }
      }

      if (path === "/risk/policy") {
        if (method !== "GET") return err("Method not allowed", 405);
        if (!validBridge) return err("L1 bridge authentication required", 403);
        if (!env.MARKET_DB || typeof env.MARKET_DB.prepare !== "function") {
          return err("Market research database unavailable", 503);
        }
        try {
          var riskPolicy = await env.MARKET_DB.prepare(
            "SELECT policy_id, version, environment, account_currency, starting_equity, max_drawdown_pct, risk_per_trade_pct, daily_loss_limit_pct, max_total_open_risk_pct, max_correlated_exposure_pct, max_positions, high_water_mark_method, lot_sizing_method, required_broker_fields_json, kill_switch_action, order_execution_enabled, live_trading_enabled, status, owner_approval_ref, effective_from FROM gs_risk_policy_versions ORDER BY version DESC LIMIT 1"
          ).first();
          if (!riskPolicy) return ok({ available: false, mode: "demo_only", executionEnabled: false });
          return ok({
            available: true,
            mode: riskPolicy.environment,
            policy: riskPolicy,
            executionEnabled: false,
            liveTradingEnabled: false,
            note: "Read-only policy disclosure. This route cannot place, modify, or close orders."
          });
        } catch (_) {
          return err("Risk policy lookup failed closed", 503);
        }
      }

      if (path === "/risk/simulate") {
        if (method !== "POST") return err("Method not allowed", 405);
        if (!validBridge) return err("L1 bridge authentication required", 403);
        if (!env.MARKET_DB || typeof env.MARKET_DB.prepare !== "function") {
          return err("Market research database unavailable", 503);
        }
        var riskInput;
        try { riskInput = await boundedJson(request, 4096); }
        catch (inputError) { return err(inputError.message || "Invalid request", inputError.status || 400); }
        try {
          var activeRiskPolicy = await env.MARKET_DB.prepare(
            "SELECT policy_id, version, environment, account_currency, starting_equity, max_drawdown_pct, risk_per_trade_pct, daily_loss_limit_pct, max_total_open_risk_pct, max_correlated_exposure_pct, max_positions, order_execution_enabled, live_trading_enabled, status FROM gs_risk_policy_versions ORDER BY version DESC LIMIT 1"
          ).first();
          if (!activeRiskPolicy) return err("Risk policy is not configured", 503);
          var simulation = simulateRiskGate(activeRiskPolicy, riskInput);
          return ok({
            policyId: activeRiskPolicy.policy_id,
            policyVersion: Number(activeRiskPolicy.version),
            policyStatus: activeRiskPolicy.status,
            ...simulation,
            orderSubmitted: false,
            executionEnabled: false,
            timestamp: new Date().toISOString()
          }, simulation.ok ? 200 : 409);
        } catch (_) {
          return err("Risk simulation failed closed", 503);
        }
      }

      if (path === "/") return ok({
        name: "Goldstar L2", version: "3.0.1", analysisEnabled: MARKET_ANALYSIS_ENABLED, analysisMode: "disabled_until_verified_market_data",
        styles: ["ICT", "RTM", "NDS"],
        endpoints: ["/health","/status","/strategy","/knowledge/:style","/training/progress","/training/sources","/strategy/synthesize","/market-data/status","/market-data/latest","/market-data/crypto/latest","/mql5/tools","/mql5/call","/mt5/status","/mt5/latest","/risk/policy","/risk/simulate","/analyze"]
      });

      if (path === "/status") {
        var k = await getRules(env);
        var strat = await env.STRATEGY.get("current_strategy", { cacheTtl: KV_CACHE_TTL });
        var strategyRecord = parseStrategyRecord(strat);
        var strategyReady = await isApprovedStrategy(strat, k.all);
        var strategyStatus = strategyReady ? "approved" : (strategyRecord ? (strategyRecord.status || "unapproved") : (strat ? "legacy_unverified" : "not_created"));
        return ok({ totalRules: k.all.length, approvedRules: k.all.length, legacyRules: k.legacyTotal, legacy: k.legacy, strategyReady: strategyReady, strategyStatus: strategyStatus, analysisEnabled: MARKET_ANALYSIS_ENABLED, trainingMode: NDS_ONLY_MODE ? "NDS_ONLY" : "MULTI_STYLE", activeTrainingStyles: k.activeStyles, ict: k.ict.length, rtm: k.rtm.length, nds: k.nds.length });
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
        var pendingEligibility = await Promise.all(pendingRuleEntries.map(function(rule) { return hasVerifiedRuleEvidence(rule, env); }));
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
        var pendingEligibility = await Promise.all(pendingRuleEntries.map(function(rule) { return hasVerifiedRuleEvidence(rule, env); }));
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
          if (!(await hasVerifiedRuleEvidence(selected[ui], env))) unsupported.push(selected[ui]);
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
          var rollbackSucceeded = false;
          try {
            await env.KNOWLEDGE.put("knowledge_NDS", JSON.stringify(active));
            rollbackSucceeded = true;
          } catch (_) {}
          var failureDetails = Object.assign({}, auditDetails, {
            failure: "KV write failed",
            rollbackStatus: rollbackSucceeded ? "restored" : "failed",
            reconciliationRequired: !rollbackSucceeded
          });
          try {
            await env.DB.prepare("UPDATE gs_audit_log SET outcome = ?, details_json = ? WHERE event_id = ?")
              .bind(rollbackSucceeded ? "failed" : "reconciliation_required", JSON.stringify(failureDetails), auditId).run();
          } catch (_) {}
          return err(
            rollbackSucceeded
              ? "Approval storage failed; active knowledge rollback succeeded and the audit record was retained"
              : "Approval storage failed and rollback could not be confirmed; manual reconciliation is required",
            503
          );
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

      if (path === "/mt5/status") {
        if (method !== "GET") return err("Method not allowed", 405);
        if (!validBridge) return err("L1 bridge authentication required", 403);
        if (!env.MARKET_DB) return err("Market research database unavailable", 503);
        var mt5Status = await env.MARKET_DB.prepare("SELECT COUNT(*) AS snapshot_count, MAX(received_at) AS last_received_at FROM mt5_terminal_snapshots").first();
        var mt5Latest = await env.MARKET_DB.prepare("SELECT account_login, account_server, terminal_connected, trade_allowed, positions_count, ticks_count FROM mt5_terminal_snapshots ORDER BY received_at DESC LIMIT 1").first();
        return ok({
          mode: "demo_read_only",
          available: !!mt5Latest,
          snapshot_count: Number(mt5Status?.snapshot_count || 0),
          last_received_at: mt5Status?.last_received_at || null,
          account_login: mt5Latest?.account_login || null,
          account_server: mt5Latest?.account_server || null,
          terminal_connected: mt5Latest?.terminal_connected === 1,
          trade_allowed: mt5Latest?.trade_allowed === 1,
          positions_count: Number(mt5Latest?.positions_count || 0),
          ticks_count: Number(mt5Latest?.ticks_count || 0)
        });
      }

      if (path === "/mt5/latest") {
        if (method !== "GET") return err("Method not allowed", 405);
        if (!validBridge) return err("L1 bridge authentication required", 403);
        if (!env.MARKET_DB) return err("Market research database unavailable", 503);
        var mt5Snapshot = await env.MARKET_DB.prepare("SELECT snapshot_id, received_at, account_login, account_server, currency, leverage, balance, equity, margin, free_margin, margin_level, terminal_connected, trade_allowed, positions_count, ticks_count, payload_json FROM mt5_terminal_snapshots ORDER BY received_at DESC LIMIT 1").first();
        if (!mt5Snapshot) return ok({ mode: "demo_read_only", available: false, snapshot: null, positions: [], ticks: [] });
        var mt5Positions = await env.MARKET_DB.prepare("SELECT position_ticket, symbol, position_type, volume, price_open, price_current, stop_loss, take_profit, profit, swap, opened_at FROM mt5_positions WHERE snapshot_id = ? ORDER BY symbol, position_ticket").bind(mt5Snapshot.snapshot_id).all();
        var mt5Ticks = await env.MARKET_DB.prepare("SELECT symbol, bid, ask, last_price, time_msc FROM mt5_symbol_ticks WHERE snapshot_id = ? ORDER BY symbol").bind(mt5Snapshot.snapshot_id).all();
        return ok({
          mode: "demo_read_only",
          available: true,
          snapshot: mt5Snapshot,
          positions: mt5Positions.results || [],
          ticks: mt5Ticks.results || []
        });
      }

      if (path === "/market-data/status" && method === "GET") {
        if (!env.MARKET_DB || typeof env.MARKET_DB.prepare !== "function") return err("Dedicated market-data D1 binding unavailable", 503);
        try {
          var rawStatus = await env.MARKET_DB.prepare("SELECT COUNT(*) AS event_count, MAX(received_at) AS last_received_at FROM tv_events").first();
          var normalizedStatus = await env.MARKET_DB.prepare("SELECT COUNT(*) AS event_count, MAX(received_at) AS last_received_at FROM gs_market_events").first();
          var cmcStatus = await env.MARKET_DB.prepare("SELECT COUNT(*) AS quote_count, MAX(quote_last_updated) AS last_quote_updated FROM cmc_quotes").first();
          var rawEventCount = Number(rawStatus && rawStatus.event_count || 0);
          var normalizedEventCount = Number(normalizedStatus && normalizedStatus.event_count || 0);
          var cmcQuoteCount = Number(cmcStatus && cmcStatus.quote_count || 0);
          return ok({
            source: "dedicated market research D1",
            rawEventCount: rawEventCount,
            normalizedEventCount: normalizedEventCount,
            lastRawEventAt: rawStatus && rawStatus.last_received_at || null,
            lastNormalizedEventAt: normalizedStatus && normalizedStatus.last_received_at || null,
            cmcQuoteCount: cmcQuoteCount,
            lastCmcQuoteAt: cmcStatus && cmcStatus.last_quote_updated || null,
            cmcDataReady: cmcQuoteCount > 0,
            rawIngestionReady: rawEventCount > 0,
            marketDataReady: normalizedEventCount > 0 || cmcQuoteCount > 0,
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

      if (path === "/market-data/crypto/latest" && method === "GET") {
        if (!env.MARKET_DB || typeof env.MARKET_DB.prepare !== "function") return err("Dedicated market-data D1 binding unavailable", 503);
        var cryptoRequestedLimit = Number(url.searchParams.get("limit") || 25);
        var cryptoLimit = Number.isFinite(cryptoRequestedLimit) ? Math.min(100, Math.max(1, Math.floor(cryptoRequestedLimit))) : 25;
        var cryptoSymbol = String(url.searchParams.get("symbol") || "").trim().toUpperCase().slice(0, 12);
        var cryptoCurrency = String(url.searchParams.get("convert") || "USD").trim().toUpperCase();
        if (!/^[A-Z]{3,5}$/.test(cryptoCurrency)) return err("Invalid quote currency", 400);
        try {
          var cryptoResult = await env.MARKET_DB.prepare(
            "SELECT cmc_id, symbol, name, quote_currency, price, volume_24h, market_cap, percent_change_1h, percent_change_24h, percent_change_7d, cmc_rank, quote_last_updated, ingested_at FROM cmc_quotes WHERE (? = '' OR UPPER(symbol) = UPPER(?)) AND UPPER(quote_currency) = UPPER(?) ORDER BY quote_last_updated DESC LIMIT ?"
          ).bind(cryptoSymbol, cryptoSymbol, cryptoCurrency, cryptoLimit).all();
          var cryptoQuotes = cryptoResult && Array.isArray(cryptoResult.results) ? cryptoResult.results : [];
          return ok({
            source: "coinmarketcap",
            assetClass: "crypto",
            count: cryptoQuotes.length,
            filters: { symbol: cryptoSymbol || null, convert: cryptoCurrency },
            quotes: cryptoQuotes
          });
        } catch (_) {
          return err("CoinMarketCap quote query failed", 503);
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
