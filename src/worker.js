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

      if (path === "/mql5/tools" || path === "/mql5/call") {
        if (method !== "POST") return err("POST required", 405);
        if (!env.MQL5_GATEWAY_URL || !env.MQL5_GATEWAY_API_KEY) return err("MQL5 gateway not configured", 503);
        var gatewayBase;
        try { gatewayBase = new URL(env.MQL5_GATEWAY_URL); }
        catch (e) { return err("MQL5 gateway URL invalid", 503); }
        if (gatewayBase.protocol !== "https:") return err("MQL5 gateway must use HTTPS", 503);
        try {
          var gatewayResponse = await fetch(gatewayBase.origin + path, {
            method: "POST",
            headers: {
              "content-type": request.headers.get("content-type") || "application/json",
              "accept": "application/json",
              "authorization": "Bearer " + env.MQL5_GATEWAY_API_KEY
            },
            body: await request.text()
          });
          var gatewayText = await gatewayResponse.text();
          return new Response(gatewayText, {
            status: gatewayResponse.status,
            headers: {
              "Content-Type": gatewayResponse.headers.get("Content-Type") || "application/json; charset=utf-8",
              ...CORS
            }
          });
        } catch (e) {
          return err("MQL5 gateway unavailable", 502);
        }
      }


      if (path === "/") return ok({
        name: "Goldstar L2", version: "3.0.1", analysisEnabled: MARKET_ANALYSIS_ENABLED, analysisMode: "disabled_until_verified_market_data",
        styles: ["ICT", "RTM", "NDS"],
        endpoints: ["/health","/status","/mql5/tools","/mql5/call","/strategy","/knowledge/:style","/training/progress","/training/sources","/training/batch","/strategy/synthesize","/analyze"]
      });

      if (path === "/status") {
        var k = await getRules(env);
        var strat = await env.STRATEGY.get("current_strategy", { cacheTtl: KV_CACHE_TTL }).catch(function() { return null; });
        return ok({ totalRules: k.all.length, approvedRules: k.all.length, legacyRules: k.legacyTotal, legacy: k.legacy, strategyReady: !!strat, analysisEnabled: MARKET_ANALYSIS_ENABLED, ict: k.ict.length, rtm: k.rtm.length, nds: k.nds.length });
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
        var unsupported = selected.filter(function(rule) { return rule.validationStatus !== "pending" || !rule.source || !rule.sourceExcerpt; });
        if (unsupported.length) return err("Selected rules lack pending status or source evidence; no changes made", 409);
        var activeIds = new Set(active.map(function(rule) { return String(rule.id); }));
        var now = new Date().toISOString();
        var promoted = selected.filter(function(rule) { return !activeIds.has(String(rule.id)); }).map(function(rule) {
          return Object.assign({}, rule, {
            validationStatus: "approved",
            approvedAt: now,
            approvedBy: "goldstar-level0-via-level1",
            approvalNote: String(approvalBody.approvalNote || "Manual approval through Goldstar Level 1").slice(0, 500)
          });
        });
        var remaining = pending.filter(function(rule) { return ids.indexOf(String(rule.id)) < 0; });
        if (promoted.length) await env.KNOWLEDGE.put("knowledge_NDS", JSON.stringify(active.concat(promoted)));
        await env.KNOWLEDGE.put("knowledge_NDS_pending", JSON.stringify(remaining));
        return ok({ success: true, approved: promoted.length, approvedIds: ids, pendingRemaining: remaining.length, approvedTotal: active.filter(function(rule) { return rule.validationStatus === "approved"; }).length + promoted.length });
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
        return ok({ strategy: sArr[0] || "not created", lastUpdated: sArr[1] });
      }

      if (path === "/strategy/synthesize" && method === "POST") {
        var k3 = await getRules(env);
        if (!k3.all.length) return err("Load rules first");
        var prompt = "You are a trading strategist. Combine these rules into a strategy. Rules:\n" + JSON.stringify(k3.all.slice(0, 10));
        var strategy = await ai(env, prompt);
        if (!strategy) return err("AI empty response", 502);
        ctx.waitUntil(Promise.all([
          env.STRATEGY.put("current_strategy", strategy),
          env.STRATEGY.put("strategy_updated", new Date().toISOString())
        ]));
        return ok({ success: true, strategyLength: strategy.length, strategy: strategy });
      }

      if (path === "/analyze" && method === "POST") {
        if (!MARKET_ANALYSIS_ENABLED) {
          return err("Market analysis is disabled until a verified market-data feed is connected, consumed, and validated. No directional signal was generated.", 503);
        }
        return err("Market analysis handler is not configured.", 503);
      }

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
