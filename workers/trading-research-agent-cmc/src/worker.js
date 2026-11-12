const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};
const MAX_BODY_BYTES = 4096;
const MAX_SYMBOLS = 20;
const SYMBOL_RE = /^[A-Z0-9]{1,12}$/;
const CURRENCY_RE = /^[A-Z]{3,5}$/;
const CMC_QUOTES_URL = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < length; index++) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

async function readBoundedJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw Object.assign(new Error("Content-Type must be application/json"), { status: 415 });
  }
  if (!request.body) throw Object.assign(new Error("Request body is required"), { status: 400 });
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw Object.assign(new Error("Request body is too large"), { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  if (total < 2) throw Object.assign(new Error("Request body is empty"), { status: 400 });
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw Object.assign(new Error("JSON body must be an object"), { status: 400 });
    }
    return value;
  } catch (error) {
    if (error && Number.isInteger(error.status)) throw error;
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function markRunFailed(db, runId, providerStatus, message) {
  try {
    await db.prepare(
      "UPDATE cmc_ingestion_runs SET status = 'failed', provider_status = ?, completed_at = ?, error_message = ? WHERE run_id = ?"
    ).bind(
      Number.isInteger(providerStatus) ? providerStatus : null,
      new Date().toISOString(),
      String(message || "ingestion_failed").slice(0, 500),
      runId
    ).run();
  } catch {
    // A failed audit update must not hide the original ingestion failure.
  }
}

async function handleQuotes(request, env) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed", allowed: ["POST"] }, 405);
  }

  if (!env.INGEST_AUTH_TOKEN || !env.CMC_API_KEY || !env.MARKET_DB ||
      typeof env.MARKET_DB.prepare !== "function" || typeof env.MARKET_DB.batch !== "function") {
    return json({ ok: false, error: "service_not_configured" }, 503);
  }
  const authorization = request.headers.get("authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!constantTimeEqual(suppliedToken, env.INGEST_AUTH_TOKEN)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let input;
  try {
    input = await readBoundedJson(request);
  } catch (error) {
    return json({ ok: false, error: error.message || "invalid_request" }, error.status || 400);
  }

  if (Object.keys(input).some(key => key !== "symbols" && key !== "convert")) {
    return json({ ok: false, error: "unsupported_request_field" }, 400);
  }

  const rawSymbols = input.symbols;
  if (!Array.isArray(rawSymbols) || rawSymbols.length < 1 || rawSymbols.length > MAX_SYMBOLS) {
    return json({ ok: false, error: "symbols_must_be_array_of_1_to_20" }, 400);
  }
  const symbols = rawSymbols.map(value => typeof value === "string" ? value.trim().toUpperCase() : "");
  if (symbols.some(symbol => !SYMBOL_RE.test(symbol)) || new Set(symbols).size !== symbols.length) {
    return json({ ok: false, error: "invalid_or_duplicate_symbols" }, 400);
  }

  const convert = input.convert === undefined ? "USD" :
    (typeof input.convert === "string" ? input.convert.trim().toUpperCase() : "");
  if (!CURRENCY_RE.test(convert)) {
    return json({ ok: false, error: "invalid_convert_currency" }, 400);
  }

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  let providerStatus = null;

  try {
    await env.MARKET_DB.prepare(
      "INSERT INTO cmc_ingestion_runs (run_id, status, symbols, records_written, provider_status, started_at, completed_at, error_message) VALUES (?, 'running', ?, 0, NULL, ?, NULL, NULL)"
    ).bind(runId, symbols.join(","), startedAt).run();

    const apiUrl = new URL(CMC_QUOTES_URL);
    apiUrl.searchParams.set("symbol", symbols.join(","));
    apiUrl.searchParams.set("convert", convert);
    const upstream = await fetch(apiUrl.toString(), {
      method: "GET",
      headers: {
        "X-CMC_PRO_API_KEY": env.CMC_API_KEY,
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(15000)
    });
    providerStatus = upstream.status;

    let payload;
    try {
      payload = await upstream.json();
    } catch {
      throw new Error("CMC returned a non-JSON response");
    }
    if (!upstream.ok || payload?.status?.error_code !== 0) {
      throw new Error("CMC request failed: " + String(payload?.status?.error_message || "provider_error").slice(0, 240));
    }

    const data = payload?.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("CMC response data is missing or invalid");
    }

    const ingestedAt = new Date().toISOString();
    const quoteStatements = [];
    const returnedSymbols = new Set();

    for (const requestedSymbol of symbols) {
      const candidates = data[requestedSymbol];
      const coins = Array.isArray(candidates) ? candidates : candidates ? [candidates] : [];
      for (const coin of coins) {
        const quote = coin?.quote?.[convert];
        if (!coin || !Number.isInteger(coin.id) || typeof coin.symbol !== "string" ||
            typeof coin.name !== "string" || !quote ||
            typeof quote.last_updated !== "string" ||
            !Number.isFinite(Date.parse(quote.last_updated))) continue;

        returnedSymbols.add(requestedSymbol);
        quoteStatements.push(env.MARKET_DB.prepare(
          "INSERT INTO cmc_quotes (cmc_id, symbol, name, quote_currency, price, volume_24h, market_cap, percent_change_1h, percent_change_24h, percent_change_7d, cmc_rank, quote_last_updated, ingested_at, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(cmc_id, quote_currency, quote_last_updated) DO UPDATE SET symbol = excluded.symbol, name = excluded.name, price = excluded.price, volume_24h = excluded.volume_24h, market_cap = excluded.market_cap, percent_change_1h = excluded.percent_change_1h, percent_change_24h = excluded.percent_change_24h, percent_change_7d = excluded.percent_change_7d, cmc_rank = excluded.cmc_rank, ingested_at = excluded.ingested_at, raw_json = excluded.raw_json"
        ).bind(
          coin.id,
          coin.symbol.toUpperCase(),
          coin.name,
          convert,
          numberOrNull(quote.price),
          numberOrNull(quote.volume_24h),
          numberOrNull(quote.market_cap),
          numberOrNull(quote.percent_change_1h),
          numberOrNull(quote.percent_change_24h),
          numberOrNull(quote.percent_change_7d),
          Number.isInteger(coin.cmc_rank) ? coin.cmc_rank : null,
          quote.last_updated,
          ingestedAt,
          JSON.stringify(coin)
        ));
      }
    }

    if (quoteStatements.length === 0) {
      throw new Error("CMC returned no valid quote records for requested symbols");
    }

    const completedAt = new Date().toISOString();
    const finalStatements = [
      ...quoteStatements,
      env.MARKET_DB.prepare(
        "UPDATE cmc_ingestion_runs SET status = 'success', provider_status = ?, records_written = ?, completed_at = ?, error_message = NULL WHERE run_id = ?"
      ).bind(providerStatus, quoteStatements.length, completedAt, runId)
    ];
    // Quotes and their successful audit status commit in one D1 batch.
    await env.MARKET_DB.batch(finalStatements);

    return json({
      ok: true,
      run_id: runId,
      provider: "coinmarketcap",
      provider_status: providerStatus,
      symbols,
      missing_symbols: symbols.filter(symbol => !returnedSymbols.has(symbol)),
      quote_currency: convert,
      records_written: quoteStatements.length,
      completed_at: completedAt
    }, 200);
  } catch (error) {
    await markRunFailed(env.MARKET_DB, runId, providerStatus, error?.message || "ingestion_failed");
    return json({
      ok: false,
      run_id: runId,
      provider_status: providerStatus,
      error: "ingestion_failed",
      message: String(error?.message || "Unknown ingestion error").slice(0, 300)
    }, 502);
  }
}


export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);
      return json({
        ok: true,
        service: "goldstar-cmc-ingest",
        storage: "dedicated_market_research_d1",
        cmc_configured: Boolean(env.CMC_API_KEY),
        ingest_auth_configured: Boolean(env.INGEST_AUTH_TOKEN),
        database_configured: Boolean(env.MARKET_DB && typeof env.MARKET_DB.prepare === "function")
      });
    }
    // The previous production version explicitly retired the legacy TradingView
    // discovery surface. Preserve that contract instead of silently changing it to 404.
    if (url.pathname === "/discover") {
      return json({ ok: false, error: "gone", message: "TradingView discovery endpoint has been retired." }, 410);
    }
    if (url.pathname === "/cmc/quotes") return handleQuotes(request, env);
    return json({ ok: false, error: "not_found" }, 404);
  }
};
