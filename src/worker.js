const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
};
const AI_MODEL = "@cf/zai-org/glm-4.7-flash";
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
  return { ict: i, rtm: r, nds: n, all: i.concat(r, n) };
}
var Q = String.fromCharCode(34);

export default {
  async fetch(request, env, ctx) {
    try {
      var url = new URL(request.url);
      var path = url.pathname;
      var method = request.method;
      if (method === "OPTIONS") return new Response(null, { headers: CORS });

      var key = request.headers.get("X-API-Key") || url.searchParams.get("key");
      if (path !== "/health") {
        if (!key || key !== env.API_KEY) {
          return err("Auth required", 401);
        }
      }

      if (path === "/health") return ok({ status: "ok", version: "3.0-final" });

      if (path === "/") return ok({
        name: "Goldstar L2", version: "3.0-final",
        styles: ["ICT", "RTM", "NDS"],
        endpoints: ["/health","/status","/strategy","/knowledge/:style","/training/progress","/training/sources","/training/batch","/strategy/synthesize","/analyze"]
      });

      if (path === "/status") {
        var k = await getRules(env);
        var strat = await env.STRATEGY.get("current_strategy", { cacheTtl: KV_CACHE_TTL }).catch(function() { return null; });
        return ok({ totalRules: k.all.length, strategyReady: !!strat, ict: k.ict.length, rtm: k.rtm.length, nds: k.nds.length });
      }

      if (path === "/training/progress") {
        var k2 = await getRules(env);
        return ok({ ict: k2.ict.length, rtm: k2.rtm.length, nds: k2.nds.length });
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
        var b;
        try { b = await body(request); } catch (e) { return err(e.message); }
        if (!b.symbol || !b.timeframe) return err("symbol and timeframe required");
        var k4 = await getRules(env);
        var s4 = await env.STRATEGY.get("current_strategy", { cacheTtl: KV_CACHE_TTL }).catch(function() { return null; }) || "no strategy";
        var jsonExample = "{" + Q + "direction" + Q + ":" + Q + "LONG" + Q + "," + Q + "confidence" + Q + ":75," + Q + "reasoning" + Q + ":" + Q + "short" + Q + "}";
        var prompt2 = "You are a trading assistant. Market: " + b.symbol + " timeframe: " + b.timeframe + ". Strategy: " + s4.substring(0, 500) + ". Rules: " + JSON.stringify(k4.all.slice(0, 5)) + ". Respond ONLY as JSON: " + jsonExample;
        var raw = await ai(env, prompt2);
        if (!raw) return err("AI empty response", 502);
        var analysis = extractJSON(raw);
        return ok({ symbol: b.symbol, timeframe: b.timeframe, analysis: analysis || raw, timestamp: Date.now() });
      }

      if (path === "/training/batch" && method === "POST") {
        if (!env.BROWSER) return err("BROWSER binding not active", 503);
        var results = [];
        for (var ci = 0; ci < NDS_CHANNELS.length; ci++) {
          var ch = NDS_CHANNELS[ci];
          try {
            var br = await env.BROWSER.fetch("https://browser.cloudflare.com/content?url=" + encodeURIComponent(ch.url));
            var html = await br.text();
            var text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            var raw2 = await ai(env, "Extract NDS rules from: " + text.substring(0, 5000) + " as JSON: [{category,rule,conditions[],priority}]");
            var rules2 = extractJSON(raw2) || [];
            var existing = (await env.KNOWLEDGE.get("knowledge_NDS", { type: "json", cacheTtl: KV_CACHE_TTL }).catch(function() { return []; })) || [];
            var newRules = rules2.map(function(r, i) { return Object.assign({}, r, { id: "nds_" + Date.now() + "_" + i, style: "NDS" }); });
            ctx.waitUntil(env.KNOWLEDGE.put("knowledge_NDS", JSON.stringify(existing.concat(newRules))));
            results.push({ channel: ch.name, rules: newRules.length, status: "success" });
          } catch (e) {
            results.push({ channel: ch.name, status: "error", error: String(e.message || e) });
          }
        }
        var total = results.reduce(function(s, r) { return s + (r.rules || 0); }, 0);
        return ok({ success: true, channels: results, totalRules: total });
      }

      return err("Not found: " + path, 404);
    } catch (e) {
      return err("Server error: " + String(e.message || e), 500);
    }
  }
};
