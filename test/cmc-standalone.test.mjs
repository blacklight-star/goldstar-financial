import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import worker from "../workers/cmc-standalone/src/worker.js";

const origin = "https://cmc-staging.example";
const token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abc";
const tokenHash = createHash("sha256").update(token).digest("hex");

function makeVaultDb({ alreadyConsumed = false, valid = true } = {}) {
  const state = { consumed: alreadyConsumed, sessions: [], firstCalls: 0, runCalls: 0, sql: [] };
  const db = {
    prepare(sql) {
      const statement = { sql, args: [], bind(...args) { this.args = args; return this; } };
      state.sql.push(sql);
      statement.first = async () => {
        state.firstCalls++;
        if (sql.startsWith("SELECT token_hash FROM cmc_bootstrap_tokens")) {
          return valid && !state.consumed && statement.args[0] === tokenHash
            ? { token_hash: tokenHash } : null;
        }
        if (sql.startsWith("UPDATE cmc_bootstrap_tokens")) {
          if (!valid || state.consumed || statement.args[1] !== tokenHash) return null;
          state.consumed = true;
          return { token_hash: tokenHash };
        }
        return null;
      };
      statement.run = async () => {
        state.runCalls++;
        if (sql.startsWith("INSERT INTO cmc_admin_sessions")) state.sessions.push(statement.args);
        return { success: true };
      };
      return statement;
    }
  };
  return { db, state };
}

function getRequest(path) {
  return new Request(origin + path, { method: "GET" });
}
function postRequest(path, body, requestOrigin = origin) {
  return new Request(origin + path, {
    method: "POST",
    headers: { "content-type": "application/json", origin: requestOrigin },
    body: JSON.stringify(body)
  });
}

test("bootstrap GET is read-only and renders an explicit confirmation", async () => {
  const vault = makeVaultDb();
  const response = await worker.fetch(getRequest("/bootstrap/" + token), { VAULT_DB: vault.db });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /تأیید و ورود به پنل/);
  assert.match(html, /bootstrap\/activate/);
  assert.equal(vault.state.consumed, false);
  assert.equal(vault.state.runCalls, 0);
  assert.equal(vault.state.firstCalls, 1);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("explicit same-origin POST consumes bootstrap once and creates a secure session", async () => {
  const vault = makeVaultDb();
  const response = await worker.fetch(postRequest("/bootstrap/activate", { token }), { VAULT_DB: vault.db });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/console");
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(vault.state.consumed, true);
  assert.equal(vault.state.sessions.length, 1);
});

test("bootstrap activation rejects cross-origin requests without consuming the token", async () => {
  const vault = makeVaultDb();
  const response = await worker.fetch(postRequest("/bootstrap/activate", { token }, "https://attacker.example"), { VAULT_DB: vault.db });
  assert.equal(response.status, 403);
  assert.equal(vault.state.consumed, false);
  assert.equal(vault.state.runCalls, 0);
});

test("bootstrap activation rejects replay and does not create a second session", async () => {
  const vault = makeVaultDb();
  const first = await worker.fetch(postRequest("/bootstrap/activate", { token }), { VAULT_DB: vault.db });
  const replay = await worker.fetch(postRequest("/bootstrap/activate", { token }), { VAULT_DB: vault.db });
  assert.equal(first.status, 303);
  assert.equal(replay.status, 410);
  assert.equal(vault.state.sessions.length, 1);
});


function makeSecureMocks(sessionToken) {
  const sessionHash = createHash("sha256").update(sessionToken).digest("hex");
  const vaultState = { sessionHash, credential: null, consumed: false, sessionWrites: 0 };
  const vault = {
    prepare(sql) {
      const statement = { sql, args: [], bind(...args) { this.args = args; return this; } };
      statement.first = async () => {
        if (sql.startsWith("UPDATE cmc_admin_sessions")) {
          return statement.args[1] === vaultState.sessionHash ? { token_hash: vaultState.sessionHash } : null;
        }
        if (sql.startsWith("SELECT ciphertext_b64,iv_b64 FROM cmc_credentials")) {
          return vaultState.credential;
        }
        return null;
      };
      statement.run = async () => {
        if (sql.startsWith("INSERT INTO cmc_credentials")) {
          vaultState.credential = {
            ciphertext_b64: statement.args[0],
            iv_b64: statement.args[1],
            updated_at: statement.args[2]
          };
        }
        if (sql.startsWith("INSERT INTO cmc_admin_sessions")) vaultState.sessionWrites++;
        return { success: true };
      };
      return statement;
    }
  };

  const marketState = { prepared: [], batches: [] };
  const market = {
    prepare(sql) {
      const statement = { sql, args: [], bind(...args) { this.args = args; return this; } };
      marketState.prepared.push(statement);
      statement.run = async () => ({ success: true });
      return statement;
    },
    async batch(statements) {
      marketState.batches.push(statements);
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    }
  };
  return { vault, market, vaultState, marketState };
}

test("CMC owner credential is validated, AES-GCM encrypted at rest, and reused for ingestion", async () => {
  const sessionToken = "session-cookie-test-value-with-entropy-123456";
  const apiKey = "test-cmc-api-key-never-store-plaintext-12345";
  const mocks = makeSecureMocks(sessionToken);
  const env = {
    VAULT_DB: mocks.vault,
    MARKET_DB: mocks.market,
    CREDENTIAL_VAULT_KEY: Buffer.alloc(32, 9).toString("base64")
  };
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    if (String(url).includes("/v1/key/info")) {
      return new Response(JSON.stringify({ status: { error_code: 0 } }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify(validPayload()), {
      status: 200, headers: { "content-type": "application/json" }
    });
  };

  const request = (path, body) => new Request(origin + path, {
    method: "POST",
    headers: {
      origin,
      cookie: "goldstar_cmc_admin=" + sessionToken,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  try {
    const saveResponse = await worker.fetch(request("/api/cmc/credential", { apiKey }), env);
    assert.equal(saveResponse.status, 200, JSON.stringify(await saveResponse.clone().json()));
    const saveResult = await saveResponse.json();
    assert.equal(saveResult.ok, true);
    assert.equal(saveResult.credential_validated, true);
    assert.equal(saveResult.credential_stored_encrypted, true);
    assert.equal(mocks.vaultState.credential !== null, true);
    assert.equal(mocks.vaultState.credential.ciphertext_b64.includes(apiKey), false);
    assert.equal(mocks.marketState.batches.length, 1);
    assert.equal(calls.filter(c => c.url.includes("/v1/key/info")).length, 1);

    const quoteResponse = await worker.fetch(request("/api/cmc/quotes", { symbols: ["BTC"], convert: "USD" }), env);
    assert.equal(quoteResponse.status, 200);
    const quoteResult = await quoteResponse.json();
    assert.equal(quoteResult.ok, true);
    assert.equal(quoteResult.records_written, 1);
    assert.equal(mocks.marketState.batches.length, 2);
    assert.equal(calls.filter(c => c.url.includes("/cryptocurrency/quotes/latest")).length, 2);
    assert.equal(calls.at(-1).headers["X-CMC_PRO_API_KEY"], apiKey);
    assert.equal(JSON.stringify(saveResult).includes(apiKey), false);
    assert.equal(JSON.stringify(quoteResult).includes(apiKey), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invalid CMC credential is rejected before vault storage or quote ingestion", async () => {
  const sessionToken = "session-cookie-test-value-with-entropy-123456";
  const apiKey = "invalid-cmc-api-key-never-store-plaintext-12345";
  const mocks = makeSecureMocks(sessionToken);
  const env = {
    VAULT_DB: mocks.vault,
    MARKET_DB: mocks.market,
    CREDENTIAL_VAULT_KEY: Buffer.alloc(32, 9).toString("base64")
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: { error_code: 1001, error_message: "invalid key" }
  }), { status: 401, headers: { "content-type": "application/json" } });
  try {
    const response = await worker.fetch(new Request(origin + "/api/cmc/credential", {
      method: "POST",
      headers: {
        origin,
        cookie: "goldstar_cmc_admin=" + sessionToken,
        "content-type": "application/json"
      },
      body: JSON.stringify({ apiKey })
    }), env);
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error, "cmc_key_validation_failed");
    assert.equal(mocks.vaultState.credential, null);
    assert.equal(mocks.marketState.batches.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
