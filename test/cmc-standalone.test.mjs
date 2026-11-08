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
