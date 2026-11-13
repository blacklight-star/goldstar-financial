const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const MAX_BODY_BYTES = 4096;
const MAX_SYMBOLS = 20;
const SYMBOL_RE = /^[A-Z0-9]{1,12}$/;
const MT5_TICK_BATCH_MAX = 100; // Per-request transport batch, not a Market Watch symbol cap.
const MT5_HISTORY_BATCH_MAX = 500;
const MT5_HISTORY_TARGETS = Object.freeze({ M5: 20000, M15: 12000, H1: 12000, H4: 3000, D1: 2000 });
const MT5_SYMBOL_RE = /^[A-Za-z0-9._-]{1,32}$/;
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS }); }
function constantTimeEqual(a, b) { if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
async function readBoundedJson(request, maxBytes = MAX_BODY_BYTES) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) throw Object.assign(new Error("Content-Type must be application/json"), { status: 415 });
  if (!request.body) throw Object.assign(new Error("Request body is required"), { status: 400 });
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw Object.assign(new Error("Request body is too large"), { status: 413 });
      }
      chunks.push(value);
    }
  } finally { try { reader.releaseLock(); } catch {} }
  if (total < 2) throw Object.assign(new Error("Request body is empty"), { status: 400 });
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw Object.assign(new Error("Invalid JSON body"), { status: 400 }); }
}
function numberOrNull(value) { return typeof value === "number" && Number.isFinite(value) ? value : null; }

function parseMcpBody(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") {
      try { return JSON.parse(parsed); } catch {}
    }
    return parsed;
  } catch {}

  // Streamable HTTP may return one SSE event whose JSON body is split
  // across multiple "data:" lines. Per the SSE format, join those lines
  // with newline characters before parsing the JSON-RPC message.
  const events = text.split(/\r?\n\r?\n/);
  for (const event of events.reverse()) {
    const dataLines = event.split(/\r?\n/).filter(line => line.startsWith("data:"));
    if (!dataLines.length) continue;
    const payload = dataLines.map(line => line.slice(5).replace(/^ /, "")).join("\n").trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload);
      if (typeof parsed === "string") {
        try { return JSON.parse(parsed); } catch {}
      }
      return parsed;
    } catch {}
  }

  // Fallback for SSE responses that omit a blank line between events.
  const dataLines = text.split(/\r?\n/).filter(line => line.startsWith("data:"));
  if (dataLines.length) {
    const payload = dataLines.map(line => line.slice(5).replace(/^ /, "")).join("\n").trim();
    try {
      const parsed = JSON.parse(payload);
      if (typeof parsed === "string") {
        try { return JSON.parse(parsed); } catch {}
      }
      return parsed;
    } catch {}
  }
  return null;
}

async function mql5Rpc(env, payload, sessionId) {
  const headers = { "authorization": "Bearer " + env.MQL5_MARKETDATA_API_KEY, "content-type": "application/json", "accept": "application/json, text/event-stream" };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const response = await fetch("https://www.metatrader.com/mcp", { method: "POST", headers, body: JSON.stringify(payload) });
  const session = response.headers.get("mcp-session-id");
  const text = await response.text();
  const data = parseMcpBody(text);
  if (!response.ok) throw new Error("MQL5 MCP HTTP " + response.status + ": " + String(text).slice(0, 400));
  if (data?.error) throw new Error("MQL5 MCP error: " + JSON.stringify(data.error).slice(0, 400));
  return { data, sessionId: session, httpStatus: response.status, contentType: response.headers.get("content-type") || "", bodyLength: text.length, bodyPreview: data ? "" : text.slice(0, 320).replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]") };
}
async function mql5Tools(env) {
  const init = await mql5Rpc(env, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "goldstar-trading-research", version: "1.0.0" } } });
  await mql5Rpc(env, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, init.sessionId);
  const listed = await mql5Rpc(env, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, init.sessionId);
  const tools = listed.data?.result?.tools;
  if (!Array.isArray(tools)) throw new Error("MQL5 MCP tools/list returned an invalid schema");
  return { tools: tools.filter(t => typeof t.name === "string" && t.name.startsWith("marketdata_")), protocolVersion: init.data?.result?.protocolVersion || "unknown" };
}
function summarizeMcpResponse(step, r) {
  const d = r && r.data;
  const result = d && d.result;
  const tools = result && result.tools;
  const resultIsObject = result !== null && typeof result === "object";
  return {
    step,
    httpStatus: r && r.httpStatus,
    contentType: r && r.contentType,
    sessionHeaderReceived: !!(r && r.sessionId),
    bodyLength: r && r.bodyLength,
    bodyPreview: r && r.bodyPreview ? r.bodyPreview : undefined,
    responseParsed: !!d,
    responseType: Array.isArray(d) ? "array" : typeof d,
    topLevelKeys: d && typeof d === "object" && !Array.isArray(d) ? Object.keys(d).slice(0, 20) : [],
    jsonrpc: d && d.jsonrpc || null,
    responseId: d && d.id !== undefined ? d.id : null,
    resultType: result === null ? "null" : Array.isArray(result) ? "array" : typeof result,
    resultKeys: resultIsObject && !Array.isArray(result) ? Object.keys(result).slice(0, 30) : [],
    toolsType: Array.isArray(tools) ? "array" : typeof tools,
    toolsCount: Array.isArray(tools) ? tools.length : 0,
    toolNames: Array.isArray(tools) ? tools.slice(0, 30).map(t => t && t.name).filter(n => typeof n === "string") : []
  };
}
async function mql5Diagnostics(env) {
  const steps = [];
  try {
    const init = await mql5Rpc(env, { jsonrpc: "2.0", id: 71, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "goldstar-trading-research-diagnostic", version: "1.0.0" } } });
    steps.push(summarizeMcpResponse("initialize", init));
    const notified = await mql5Rpc(env, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, init.sessionId);
    steps.push(summarizeMcpResponse("notifications/initialized", notified));
    const listed = await mql5Rpc(env, { jsonrpc: "2.0", id: 72, method: "tools/list", params: {} }, init.sessionId);
    steps.push(summarizeMcpResponse("tools/list", listed));
    return { ok: Array.isArray(listed.data && listed.data.result && listed.data.result.tools), steps };
  } catch (error) {
    return { ok: false, steps, error: String(error && error.message || error).slice(0, 400) };
  }
}

async function mql5ToolCall(env, name, args) {
  const available = await mql5Tools(env);
  if (!available.tools.some(t => t.name === name)) throw new Error("Tool is not exposed by the MQL5 Market Data server");
  const init = await mql5Rpc(env, { jsonrpc: "2.0", id: 11, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "goldstar-trading-research", version: "1.0.0" } } });
  await mql5Rpc(env, { jsonrpc: "2.0", method: "notifications/initialized", params: {} }, init.sessionId);
  const result = await mql5Rpc(env, { jsonrpc: "2.0", id: 12, method: "tools/call", params: { name, arguments: args || {} } }, init.sessionId);
  return { tool: name, result: result.data?.result ?? result.data };
}

async function markRunFailed(db, runId, providerStatus, message) {
  try { await db.prepare("UPDATE cmc_ingestion_runs SET status = 'failed', provider_status = ?, completed_at = ?, error_message = ? WHERE run_id = ?").bind(providerStatus ?? null, new Date().toISOString(), String(message).slice(0, 500), runId).run(); } catch {}
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
      return json({ ok: true, service: "trading-research-agent", account: "manager-level-2", purpose: "read-only financial data ingestion", mode: "demo_read_only", cmc_configured: Boolean(env.CMC_API_KEY), ingest_auth_configured: Boolean(env.INGEST_AUTH_TOKEN), mql5_configured: Boolean(env.MQL5_MARKETDATA_API_KEY && env.MQL5_GATEWAY_API_KEY), mt5_demo_bridge_configured: Boolean(env.MT5_BRIDGE_KEY), database_configured: Boolean(env.DB) });
    }
    if (url.pathname === "/discover") return json({ ok: false, error: "endpoint_retired" }, 410);

    if (url.pathname === "/mt5/snapshot") {
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
      if (!env.MT5_BRIDGE_KEY || !env.DB) return json({ ok: false, error: "mt5_bridge_not_configured" }, 503);
      const supplied = request.headers.get("x-goldstar-mt5-key") || "";
      if (!constantTimeEqual(supplied, env.MT5_BRIDGE_KEY)) return json({ ok: false, error: "unauthorized" }, 401);
      let input;
      try { input = await readBoundedJson(request, 65536); }
      catch (error) { return json({ ok: false, error: error.message || "invalid_request" }, error.status || 400); }
      const account = input?.account;
      const positions = input?.positions;
      const ticks = input?.ticks;
      if (!account || typeof account !== "object" || Array.isArray(account) ||
          account.trade_mode !== "DEMO" || account.terminal_connected !== true) {
        return json({ ok: false, error: "demo_connected_terminal_required" }, 403);
      }
      const login = String(account.login || "").trim();
      const server = String(account.server || "").trim();
      const currency = String(account.currency || "").trim().toUpperCase();
      const leverage = Number(account.leverage);
      if (!/^[0-9]{1,20}$/.test(login) || !server || server.length > 128 ||
          !/^[A-Z]{3,5}$/.test(currency) || !Number.isInteger(leverage) || leverage < 1 || leverage > 100000) {
        return json({ ok: false, error: "invalid_demo_account_metadata" }, 400);
      }
      const accountNumbers = ["balance", "equity", "margin", "free_margin", "margin_level"];
      if (accountNumbers.some(key => !Number.isFinite(Number(account[key])))) {
        return json({ ok: false, error: "invalid_account_metrics" }, 400);
      }
      if (!Array.isArray(positions) || positions.length > 30 || !Array.isArray(ticks) || ticks.length > 30) {
        return json({ ok: false, error: "positions_and_ticks_must_be_arrays_of_at_most_30" }, 400);
      }
      const cleanPositions = [];
      for (const p of positions) {
        if (!p || typeof p !== "object" || !/^[0-9]{1,24}$/.test(String(p.ticket || "")) ||
            typeof p.symbol !== "string" || !/^[A-Za-z0-9._-]{1,32}$/.test(p.symbol) ||
            !["BUY", "SELL"].includes(p.type) ||
            !["volume", "price_open", "price_current", "stop_loss", "take_profit", "profit", "swap"].every(key => Number.isFinite(Number(p[key])))) {
          return json({ ok: false, error: "invalid_position_record" }, 400);
        }
        cleanPositions.push({
          ticket: String(p.ticket), symbol: p.symbol, type: p.type,
          volume: Number(p.volume), price_open: Number(p.price_open), price_current: Number(p.price_current),
          stop_loss: Number(p.stop_loss), take_profit: Number(p.take_profit), profit: Number(p.profit),
          swap: Number(p.swap), opened_at: String(p.opened_at || "").slice(0, 32)
        });
      }
      const cleanTicks = [];
      for (const tick of ticks) {
        if (!tick || typeof tick !== "object" ||
            typeof tick.symbol !== "string" || !/^[A-Za-z0-9._-]{1,32}$/.test(tick.symbol) ||
            !["bid", "ask", "last"].every(key => Number.isFinite(Number(tick[key]))) ||
            !Number.isFinite(Number(tick.time_msc))) {
          return json({ ok: false, error: "invalid_symbol_tick" }, 400);
        }
        cleanTicks.push({ symbol: tick.symbol, bid: Number(tick.bid), ask: Number(tick.ask), last: Number(tick.last), time_msc: Number(tick.time_msc) });
      }
      const snapshotId = crypto.randomUUID();
      const receivedAt = new Date().toISOString();
      const safeAccount = {
        login, server, currency, leverage,
        balance: Number(account.balance), equity: Number(account.equity), margin: Number(account.margin),
        free_margin: Number(account.free_margin), margin_level: Number(account.margin_level),
        terminal_connected: true, trade_allowed: account.trade_allowed === true,
        terminal_version: String(account.terminal_version || "").slice(0, 40), trade_mode: "DEMO"
      };
      const statements = [
        env.DB.prepare("INSERT INTO mt5_terminal_snapshots (snapshot_id, received_at, account_login, account_server, currency, leverage, balance, equity, margin, free_margin, margin_level, terminal_connected, trade_allowed, positions_count, ticks_count, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)")
          .bind(snapshotId, receivedAt, login, server, currency, leverage, safeAccount.balance, safeAccount.equity, safeAccount.margin, safeAccount.free_margin, safeAccount.margin_level, safeAccount.trade_allowed ? 1 : 0, cleanPositions.length, cleanTicks.length, JSON.stringify(safeAccount))
      ];
      for (const p of cleanPositions) {
        statements.push(env.DB.prepare("INSERT INTO mt5_positions (snapshot_id, position_ticket, symbol, position_type, volume, price_open, price_current, stop_loss, take_profit, profit, swap, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(snapshotId, p.ticket, p.symbol, p.type, p.volume, p.price_open, p.price_current, p.stop_loss, p.take_profit, p.profit, p.swap, p.opened_at));
      }
      for (const tick of cleanTicks) {
        statements.push(env.DB.prepare("INSERT INTO mt5_symbol_ticks (snapshot_id, symbol, bid, ask, last_price, time_msc) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(snapshotId, tick.symbol, tick.bid, tick.ask, tick.last, tick.time_msc));
      }
      try {
        await env.DB.batch(statements);
        // Retention is based on server receipt time, not broker quote time.
        const snapshotCutoff = new Date(Date.now() - 90 * 86400000).toISOString();
        const legacyTickCutoff = new Date(Date.now() - 30 * 86400000).toISOString();
        try {
          await env.DB.batch([
            env.DB.prepare("DELETE FROM mt5_positions WHERE snapshot_id IN (SELECT snapshot_id FROM mt5_terminal_snapshots WHERE received_at < ?)").bind(snapshotCutoff),
            env.DB.prepare("DELETE FROM mt5_symbol_ticks WHERE snapshot_id IN (SELECT snapshot_id FROM mt5_terminal_snapshots WHERE received_at < ?)").bind(legacyTickCutoff),
            env.DB.prepare("DELETE FROM mt5_live_ticks WHERE observed_at < ?").bind(legacyTickCutoff),
            env.DB.prepare("DELETE FROM mt5_terminal_snapshots WHERE received_at < ?").bind(snapshotCutoff)
          ]);
        } catch (retentionError) {
          console.log("MT5 snapshot retention cleanup deferred:", String(retentionError?.message || retentionError).slice(0, 160));
        }
        return json({ ok: true, mode: "demo_read_only", snapshot_id: snapshotId, received_at: receivedAt, positions: cleanPositions.length, ticks: cleanTicks.length }, 202);
      } catch {
        return json({ ok: false, error: "snapshot_storage_failed" }, 503);
      }
    }


    if (url.pathname === "/mt5/ticks") {
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed", allowed: ["POST"] }, 405);
      if (!env.MT5_BRIDGE_KEY || !env.DB) return json({ ok: false, error: "mt5_bridge_not_configured" }, 503);
      const supplied = request.headers.get("x-goldstar-mt5-key") || "";
      if (!constantTimeEqual(supplied, env.MT5_BRIDGE_KEY)) return json({ ok: false, error: "unauthorized" }, 401);
      let input;
      try { input = await readBoundedJson(request, 262144); }
      catch (error) { return json({ ok: false, error: error.message || "invalid_request" }, error.status || 400); }
      const account = input?.account;
      const ticks = input?.ticks;
      if (!account || typeof account !== "object" || Array.isArray(account) ||
          account.trade_mode !== "DEMO" || account.terminal_connected !== true) {
        return json({ ok: false, error: "demo_connected_terminal_required" }, 403);
      }
      const login = String(account.login || "").trim();
      const server = String(account.server || "").trim();
      const terminalBuild = Number(account.terminal_build);
      if (!/^[0-9]{1,20}$/.test(login) || !server || server.length > 128 ||
          !Number.isInteger(terminalBuild) || terminalBuild < 1) {
        return json({ ok: false, error: "invalid_terminal_metadata" }, 400);
      }
      if (!Array.isArray(ticks) || ticks.length < 1 || ticks.length > MT5_TICK_BATCH_MAX) {
        return json({ ok: false, error: "ticks_must_contain_1_to_100_records_per_batch" }, 400);
      }
      const clean = [];
      const seen = new Set();
      const now = Date.now();
      for (const tick of ticks) {
        const symbol = String(tick?.symbol || "");
        const timeMsc = Number(tick?.time_msc);
        const prices = ["bid", "ask", "last"].map(key => Number(tick?.[key]));
        if (!MT5_SYMBOL_RE.test(symbol) || !Number.isSafeInteger(timeMsc) || timeMsc <= 0 ||
            timeMsc > now + 300000 || prices.some(value => !Number.isFinite(value) || value < 0)) {
          return json({ ok: false, error: "invalid_symbol_tick" }, 400);
        }
        const key = symbol + "|" + timeMsc;
        if (seen.has(key)) return json({ ok: false, error: "duplicate_tick_in_request" }, 400);
        seen.add(key);
        clean.push({ symbol, timeMsc, bid: prices[0], ask: prices[1], last: prices[2] });
      }
      const observedAt = new Date().toISOString();
      const statements = clean.map(tick => env.DB.prepare(
        "INSERT OR IGNORE INTO mt5_live_ticks (account_login,symbol,time_msc,bid,ask,last_price,source_server,terminal_build,observed_at) VALUES (?,?,?,?,?,?,?,?,?)"
      ).bind(login,tick.symbol,tick.timeMsc,tick.bid,tick.ask,tick.last,server,terminalBuild,observedAt));
      try {
        const results = await env.DB.batch(statements);
        const inserted = results.reduce((sum, result) => sum + Number(result?.meta?.changes || 0), 0);
        // Run expiry cleanup at most once per UTC hour; data age uses observed_at.
        if (new Date().getUTCMinutes() === 0) {
          const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
          try { await env.DB.prepare("DELETE FROM mt5_live_ticks WHERE observed_at < ?").bind(cutoff).run(); }
          catch (retentionError) { console.log("MT5 live tick retention cleanup deferred:", String(retentionError?.message || retentionError).slice(0, 160)); }
        }
        return json({ ok: true, mode: "demo_read_only", received: clean.length, inserted,
          duplicates: clean.length - inserted, symbols: [...new Set(clean.map(t => t.symbol))], observed_at: observedAt }, 202);
      } catch (error) {
        return json({ ok: false, error: "tick_storage_failed", message: String(error?.message || error).slice(0, 240) }, 503);
      }
    }

    if (url.pathname === "/mt5/history/status") {
      if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed", allowed: ["GET"] }, 405);
      if (!env.MT5_BRIDGE_KEY || !env.DB) return json({ ok: false, error: "mt5_bridge_not_configured" }, 503);
      const supplied = request.headers.get("x-goldstar-mt5-key") || "";
      if (!constantTimeEqual(supplied, env.MT5_BRIDGE_KEY)) return json({ ok: false, error: "unauthorized" }, 401);
      const symbol = String(url.searchParams.get("symbol") || "").trim();
      const timeframe = String(url.searchParams.get("timeframe") || "").trim().toUpperCase();
      const target = MT5_HISTORY_TARGETS[timeframe];
      if (!MT5_SYMBOL_RE.test(symbol) || !target) return json({ ok: false, error: "valid_symbol_and_timeframe_required" }, 400);
      try {
        const row = await env.DB.prepare(
          "SELECT COUNT(*) AS stored_bars, MIN(time_msc) AS oldest_time_msc, MAX(time_msc) AS newest_time_msc FROM mt5_ohlc_bars WHERE symbol = ? AND timeframe = ?"
        ).bind(symbol,timeframe).first();
        const stored = Number(row?.stored_bars || 0);
        return json({ ok: true, mode: "demo_read_only", symbol, timeframe, target_bars: target,
          stored_bars: stored, remaining_bars: Math.max(0, target - stored), complete: stored >= target,
          oldest_time_msc: row?.oldest_time_msc == null ? null : Number(row.oldest_time_msc),
          newest_time_msc: row?.newest_time_msc == null ? null : Number(row.newest_time_msc) });
      } catch (error) {
        return json({ ok: false, error: "history_status_failed", message: String(error?.message || error).slice(0, 200) }, 503);
      }
    }

    if (url.pathname === "/mt5/history") {
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed", allowed: ["POST"] }, 405);
      if (!env.MT5_BRIDGE_KEY || !env.DB) return json({ ok: false, error: "mt5_bridge_not_configured" }, 503);
      const supplied = request.headers.get("x-goldstar-mt5-key") || "";
      if (!constantTimeEqual(supplied, env.MT5_BRIDGE_KEY)) return json({ ok: false, error: "unauthorized" }, 401);
      let input;
      try { input = await readBoundedJson(request, 262144); }
      catch (error) { return json({ ok: false, error: error.message || "invalid_request" }, error.status || 400); }
      const account = input?.account;
      const bars = input?.bars;
      if (!account || typeof account !== "object" || Array.isArray(account) ||
          account.trade_mode !== "DEMO" || account.terminal_connected !== true) {
        return json({ ok: false, error: "demo_connected_terminal_required" }, 403);
      }
      const sourceServer = String(account.server || "").trim();
      const terminalBuild = Number(account.terminal_build);
      if (!sourceServer || sourceServer.length > 128 || !Number.isInteger(terminalBuild) || terminalBuild < 1) {
        return json({ ok: false, error: "invalid_terminal_metadata" }, 400);
      }
      if (!Array.isArray(bars) || bars.length < 1 || bars.length > MT5_HISTORY_BATCH_MAX) {
        return json({ ok: false, error: "bars_must_contain_1_to_500_records_per_batch" }, 400);
      }
      const seen = new Set();
      const clean = [];
      const now = Date.now();
      for (const bar of bars) {
        if (!bar || typeof bar !== "object" || Array.isArray(bar)) return json({ ok: false, error: "invalid_bar_record" }, 400);
        const symbol = String(bar.symbol || "");
        const timeframe = String(bar.timeframe || "");
        if (!MT5_SYMBOL_RE.test(symbol) || !MT5_HISTORY_TARGETS[timeframe]) return json({ ok: false, error: "invalid_symbol_or_timeframe" }, 400);
        const timeMsc = Number(bar.time_msc);
        const prices = ["open", "high", "low", "close"].map(key => Number(bar[key]));
        const volumes = [Number(bar.tick_volume), Number(bar.real_volume), Number(bar.spread_points)];
        if (!Number.isSafeInteger(timeMsc) || timeMsc <= 0 || timeMsc % 1000 !== 0 || timeMsc > now + 300000 ||
            prices.some(value => !Number.isFinite(value) || value <= 0) ||
            volumes.some(value => !Number.isSafeInteger(value) || value < 0)) {
          return json({ ok: false, error: "invalid_bar_fields" }, 400);
        }
        const [open, high, low, close] = prices;
        if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
          return json({ ok: false, error: "invalid_ohlc_relationship" }, 400);
        }
        const key = symbol + "|" + timeframe + "|" + timeMsc;
        if (seen.has(key)) return json({ ok: false, error: "duplicate_bar_in_request" }, 400);
        seen.add(key);
        clean.push({ symbol, timeframe, timeMsc, barTime: new Date(timeMsc).toISOString(), open, high, low, close,
          tickVolume: volumes[0], realVolume: volumes[1], spreadPoints: volumes[2] });
      }

      const collectedAt = new Date().toISOString();
      let inserted = 0;
      try {
        for (let offset = 0; offset < clean.length; offset += MT5_HISTORY_BATCH_MAX) {
          const chunk = clean.slice(offset, offset + MT5_HISTORY_BATCH_MAX);
          const statements = chunk.map(bar => env.DB.prepare(
            "INSERT OR IGNORE INTO mt5_ohlc_bars (symbol,timeframe,bar_time_utc,time_msc,open,high,low,close,tick_volume,real_volume,spread_points,source_server,terminal_build,collected_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
          ).bind(bar.symbol,bar.timeframe,bar.barTime,bar.timeMsc,bar.open,bar.high,bar.low,bar.close,bar.tickVolume,bar.realVolume,bar.spreadPoints,sourceServer,terminalBuild,collectedAt));
          const results = await env.DB.batch(statements);
          inserted += results.reduce((sum, result) => sum + Number(result?.meta?.changes || 0), 0);
        }
        // Retain the newest configured window independently for every symbol/timeframe pair.
        const groupedPairs = [...new Map(clean.map(bar => [bar.symbol + "|" + bar.timeframe, { symbol: bar.symbol, timeframe: bar.timeframe }])).values()];
        const pairs = [];
        for (const pair of groupedPairs) {
          const target = MT5_HISTORY_TARGETS[pair.timeframe];
          await env.DB.prepare(
            "DELETE FROM mt5_ohlc_bars WHERE symbol = ? AND timeframe = ? AND time_msc NOT IN (SELECT time_msc FROM mt5_ohlc_bars WHERE symbol = ? AND timeframe = ? ORDER BY time_msc DESC LIMIT ?)"
          ).bind(pair.symbol,pair.timeframe,pair.symbol,pair.timeframe,target).run();
          const state = await env.DB.prepare(
            "SELECT COUNT(*) AS stored_bars, MIN(time_msc) AS oldest_time_msc, MAX(time_msc) AS newest_time_msc FROM mt5_ohlc_bars WHERE symbol = ? AND timeframe = ?"
          ).bind(pair.symbol,pair.timeframe).first();
          const stored = Number(state?.stored_bars || 0);
          pairs.push({ symbol: pair.symbol, timeframe: pair.timeframe, target_bars: target,
            stored_bars: stored, remaining_bars: Math.max(0,target-stored), complete: stored >= target,
            oldest_time_msc: state?.oldest_time_msc == null ? null : Number(state.oldest_time_msc),
            newest_time_msc: state?.newest_time_msc == null ? null : Number(state.newest_time_msc) });
        }
        const response = { ok: true, mode: "demo_read_only", received: clean.length,
          inserted, duplicates: clean.length - inserted, pairs, collected_at: collectedAt };
        if (pairs.length === 1) Object.assign(response, pairs[0]);
        return json(response, 202);
      } catch (error) {
        return json({ ok: false, error: "history_storage_failed", message: String(error?.message || error).slice(0, 240),
          received: clean.length, inserted_before_failure: inserted }, 503);
      }
    }

    if (url.pathname === "/mql5/tools" || url.pathname === "/mql5/call" || url.pathname === "/mql5/diagnostics") {
      if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed", allowed: ["POST"] }, 405);
      // Client authentication and upstream MQL5 authentication must use separate secrets.
      if (!env.MQL5_GATEWAY_API_KEY || !env.MQL5_MARKETDATA_API_KEY) return json({ ok: false, error: "mql5_gateway_not_configured" }, 503);
      const authorization = request.headers.get("authorization") || "";
      const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!constantTimeEqual(supplied, env.MQL5_GATEWAY_API_KEY)) return json({ ok: false, error: "unauthorized" }, 401);
      let input;
      try {
        input = await readBoundedJson(request);
      } catch (error) {
        return json({ ok: false, error: error.message || "invalid_request" }, error.status || 400);
      }
      try {
        if (url.pathname === "/mql5/diagnostics") {
          const diagnostic = await mql5Diagnostics(env);
          return json({ ok: true, diagnostic });
        }
        if (url.pathname === "/mql5/tools") {
          const listing = await mql5Tools(env);
          return json({ ok: true, protocol_version: listing.protocolVersion, tools: listing.tools });
        }
        const name = input && input.name, args = input && input.arguments;
        if (typeof name !== "string" || !name.startsWith("marketdata_") || (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args)))) return json({ ok: false, error: "invalid_tool_request" }, 400);
        const callId = crypto.randomUUID(), started = Date.now();
        const result = await mql5ToolCall(env, name, args || {});
        const finished = new Date().toISOString();
        await env.DB.prepare("INSERT INTO mql5_marketdata_calls (call_id, tool_name, arguments_json, status, http_status, duration_ms, result_json, error_message, created_at) VALUES (?, ?, ?, 'success', 200, ?, ?, NULL, ?)").bind(callId, name, JSON.stringify(args || {}), Date.now() - started, JSON.stringify(result), finished).run();
        return json({ ok: true, call_id: callId, result });
      } catch (error) { return json({ ok: false, error: "mql5_call_failed", message: String(error?.message || error).slice(0, 400) }, 502); }
    }

    if (url.pathname !== "/cmc/quotes") return json({ ok: false, error: "not_found" }, 404);
    if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed", allowed: ["POST"] }, 405);
    if (!env.INGEST_AUTH_TOKEN || !env.CMC_API_KEY || !env.DB) return json({ ok: false, error: "service_not_configured" }, 503);
    const authorization = request.headers.get("authorization") || "";
    const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!constantTimeEqual(suppliedToken, env.INGEST_AUTH_TOKEN)) return json({ ok: false, error: "unauthorized" }, 401);
    let input;
    try { input = await readBoundedJson(request); } catch (error) { return json({ ok: false, error: error.message || "invalid_request" }, error.status || 400); }
    const rawSymbols = input && input.symbols;
    if (!Array.isArray(rawSymbols) || rawSymbols.length < 1 || rawSymbols.length > MAX_SYMBOLS) return json({ ok: false, error: "symbols_must_be_array_of_1_to_20" }, 400);
    const symbols = [...new Set(rawSymbols.map(value => typeof value === "string" ? value.trim().toUpperCase() : ""))];
    if (symbols.length !== rawSymbols.length || symbols.some(symbol => !SYMBOL_RE.test(symbol))) return json({ ok: false, error: "invalid_or_duplicate_symbols" }, 400);
    const convert = input.convert === undefined ? "USD" : (typeof input.convert === "string" ? input.convert.trim().toUpperCase() : "");
    if (!/^[A-Z]{3,5}$/.test(convert)) return json({ ok: false, error: "invalid_convert_currency" }, 400);
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    let providerStatus = null;
    try {
      await env.DB.prepare("INSERT INTO cmc_ingestion_runs (run_id, status, symbols, records_written, provider_status, started_at, completed_at, error_message) VALUES (?, 'running', ?, 0, NULL, ?, NULL, NULL)").bind(runId, symbols.join(","), startedAt).run();
      const apiUrl = new URL("https://pro-api.coinmarketcap.com/v3/cryptocurrency/quotes/latest");
      apiUrl.searchParams.set("symbol", symbols.join(","));
      apiUrl.searchParams.set("convert", convert);
      const upstream = await fetch(apiUrl.toString(), { method: "GET", headers: { "X-CMC_PRO_API_KEY": env.CMC_API_KEY, "Accept": "application/json" } });
      providerStatus = upstream.status;
      let payload;
      try { payload = await upstream.json(); } catch { throw new Error("CMC returned a non-JSON response"); }
      if (!upstream.ok || payload?.status?.error_code !== 0) throw new Error("CMC error: " + String(payload?.status?.error_message || "CMC request failed").slice(0, 300));
      const data = payload?.data;
      if (!Array.isArray(data)) throw new Error("CMC V3 response data must be an array");
      const ingestedAt = new Date().toISOString();
      const completedAt = new Date().toISOString();
      const quoteStatements = [];
      for (const coin of data) {
        const symbol = String(coin?.symbol || "").trim().toUpperCase();
        if (!symbols.includes(symbol) || !Number.isInteger(coin?.id)) continue;
        const quoteList = Array.isArray(coin.quote)
          ? coin.quote
          : (coin.quote && typeof coin.quote === "object" && coin.quote[convert] ? [coin.quote[convert]] : []);
        const quote = quoteList.find(item => String(item?.symbol || convert).trim().toUpperCase() === convert);
        if (!quote || typeof quote.last_updated !== "string" || !Number.isFinite(Date.parse(quote.last_updated))) continue;
        quoteStatements.push(env.DB.prepare("INSERT INTO cmc_quotes (cmc_id, symbol, name, quote_currency, price, volume_24h, market_cap, percent_change_1h, percent_change_24h, percent_change_7d, cmc_rank, quote_last_updated, ingested_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(cmc_id, quote_currency, quote_last_updated) DO UPDATE SET symbol=excluded.symbol, name=excluded.name, price=excluded.price, volume_24h=excluded.volume_24h, market_cap=excluded.market_cap, percent_change_1h=excluded.percent_change_1h, percent_change_24h=excluded.percent_change_24h, percent_change_7d=excluded.percent_change_7d, cmc_rank=excluded.cmc_rank, ingested_at=excluded.ingested_at, raw_json=excluded.raw_json").bind(coin.id, symbol, String(coin.name || ""), convert, numberOrNull(quote.price), numberOrNull(quote.volume_24h), numberOrNull(quote.market_cap), numberOrNull(quote.percent_change_1h), numberOrNull(quote.percent_change_24h), numberOrNull(quote.percent_change_7d), Number.isInteger(coin.cmc_rank) ? coin.cmc_rank : null, quote.last_updated, ingestedAt, JSON.stringify(coin)));
      }
      if (quoteStatements.length === 0) throw new Error("CMC returned no valid quote records for requested symbols");
      const finalStatements = [...quoteStatements, env.DB.prepare("UPDATE cmc_ingestion_runs SET status = 'success', provider_status = ?, records_written = ?, completed_at = ?, error_message = NULL WHERE run_id = ?").bind(providerStatus, quoteStatements.length, completedAt, runId)];
      await env.DB.batch(finalStatements);
      return json({ ok: true, run_id: runId, provider: "coinmarketcap", provider_status: providerStatus, symbols, quote_currency: convert, records_written: quoteStatements.length, completed_at: completedAt });
    } catch (error) {
      await markRunFailed(env.DB, runId, providerStatus, error?.message || "ingestion_failed");
      return json({ ok: false, run_id: runId, provider_status: providerStatus, error: "ingestion_failed", message: String(error?.message || "Unknown ingestion error").slice(0, 300) }, 502);
    }
  }
};