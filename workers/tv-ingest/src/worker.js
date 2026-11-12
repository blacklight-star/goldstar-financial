export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const reply = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    });

    if (request.method === "GET" && url.pathname === "/health") {
      return reply({ status: "ok", service: "tradingview-ingest", version: "1.2.0" });
    }
    if (url.pathname !== "/webhook") return reply({ error: "Not found" }, 404);
    if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);

    const declaredSize = Number(request.headers.get("content-length") || 0);
    if (declaredSize > 32768) return reply({ error: "Payload too large" }, 413);

    let raw;
    try {
      raw = await request.text();
    } catch {
      return reply({ error: "Bad request" }, 400);
    }
    if (new TextEncoder().encode(raw).byteLength > 32768) {
      return reply({ error: "Payload too large" }, 413);
    }

    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return reply({ error: "Expected JSON" }, 400);
    }
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      return reply({ error: "JSON object required" }, 400);
    }

    const expected = env.TV_WEBHOOK_SECRET;
    const supplied = event.token;
    if (typeof expected !== "string" || expected.length === 0 ||
        typeof supplied !== "string" || supplied.length !== expected.length) {
      return reply({ error: "Unauthorized" }, 401);
    }
    let diff = 0;
    for (let i = 0; i < supplied.length; i++) {
      diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    if (diff !== 0) return reply({ error: "Unauthorized" }, 401);

    if (!env.DB || typeof env.DB.prepare !== "function" ||
        typeof env.DB.batch !== "function") {
      return reply({ error: "Storage unavailable" }, 503);
    }

    const clean = { ...event };
    delete clean.token;
    const receivedAt = new Date().toISOString();
    const symbol = String(clean.symbol || clean.ticker || "").slice(0, 100) || null;
    const exchange = String(clean.exchange || "").slice(0, 100) || null;
    const timeframe = String(clean.timeframe || clean.interval || "").slice(0, 40) || null;
    const eventType = String(clean.event_type || clean.signal || clean.action || "alert").slice(0, 100);
    const eventId = typeof clean.event_id === "string" ? clean.event_id.trim().slice(0, 200) : "";
    const alertTime = clean.alert_time_ms == null ? "" : String(clean.alert_time_ms).slice(0, 40);
    const identity = eventId
      ? "event_id:" + eventId
      : alertTime
        ? "alert:" + [symbol || "", timeframe || "", eventType, alertTime].join("|")
        : "payload:" + JSON.stringify(clean);

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
    const eventHash = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
    const payloadJson = JSON.stringify(clean);

    try {
      // D1 batch is transactional: raw receipt and normalized projection commit together.
      const rawInsert = env.DB.prepare(
        "INSERT OR IGNORE INTO tv_events (id,event_hash,received_at,symbol,exchange_name,timeframe,event_type,payload_json) VALUES (?,?,?,?,?,?,?,?)"
      ).bind(crypto.randomUUID(), eventHash, receivedAt, symbol, exchange, timeframe, eventType, payloadJson);
      const normalizedInsert = env.DB.prepare(
        "INSERT OR IGNORE INTO gs_market_events (id,event_hash,received_at,symbol,timeframe,event_type,payload_json) SELECT id,event_hash,received_at,symbol,timeframe,event_type,payload_json FROM tv_events WHERE event_hash = ?"
      ).bind(eventHash);
      const results = await env.DB.batch([rawInsert, normalizedInsert]);
      const accepted = Number(results?.[0]?.meta?.changes || 0) > 0;
      return reply({ success: true, accepted, duplicate: !accepted, received_at: receivedAt }, 202);
    } catch {
      return reply({ error: "Storage temporarily unavailable" }, 503);
    }
  }
};
