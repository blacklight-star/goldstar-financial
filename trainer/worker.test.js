import test from "node:test";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import worker, { isNdsRelevantText, signSourceEvidence } from "./worker.js";

const long = (text) => text + " This extended explanation contains enough context to exceed the minimum source-text threshold and represents a complete public post rather than a short title.";

test("rejects generic ICT/SMC vocabulary without NDS structure", () => {
  assert.equal(isNdsRelevantText(long("Liquidity sweep, stop hunt, order block, fair value gap, FVG, BOS, CHOCH, MSS, displacement, mitigation, entry, stop loss and take profit.")), false);
});

test("rejects generic market vocabulary without NDS-specific structure", () => {
  assert.equal(isNdsRelevantText(long("Market structure, support, resistance, risk, entry, exit and price action are discussed here.")), false);
});

test("rejects generic cycle/fractal analysis and low-volume spikes as standalone anchors", () => {
  assert.equal(isNdsRelevantText(long("Cycle analysis describes recurring price behavior in the market.")), false);
  assert.equal(isNdsRelevantText(long("Fractal analysis studies self-similar patterns in financial time series.")), false);
  assert.equal(isNdsRelevantText(long("A low-volume spike appears near a resistance level.")), false);
});

test("rejects short titles even when they contain NDS terminology", () => {
  assert.equal(isNdsRelevantText("NDS 123Flag Hook"), false);
});

test("accepts explicit NDS methodology anchors", () => {
  assert.equal(isNdsRelevantText(long("Nodal Displacement Sequencing explains the market cycle and its node sequence.")), true);
  assert.equal(isNdsRelevantText(long("A 123Flag forms after the Hook-Hook-Rally sequence and a low-volume spike.")), true);
});

test("accepts NDS-specific component combinations", () => {
  assert.equal(isNdsRelevantText(long("The positive Hook contains three Nodes, followed by a Rally and a Flag.")), true);
});

test("accepts Persian NDS terminology", () => {
  assert.equal(isNdsRelevantText(long("در استراتژی NDS، هوک، رالی، فلگ، سکانس، گره و تقارن اجزای ساختار چرخه هستند.")), true);
});

test("does not reject an NDS post merely because it also mentions ICT terms", () => {
  assert.equal(isNdsRelevantText(long("NDS Hook and Flag sequencing is distinct from an order block or liquidity sweep; the 123Flag remains the entry structure.")), true);
});

test("public preview dry-run endpoint is fetch-only and never calls AI or writes KV", async () => {
  const originalFetch = globalThis.fetch;
  const html = '<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="NDS4ALLVIDEOS/125"><div class="tgme_widget_message_text">Nodal Displacement Sequencing uses a Hook, a Flag and a Rally sequence to define the structure of a market move with sufficient explanatory detail for the source threshold.</div></div></div>';
  globalThis.fetch = async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  const calls = { ai: 0, writes: 0 };
  const env = {
    KNOWLEDGE: {
      async get() { return null; },
      async put() { calls.writes++; }
    },
    AI: {
      async run() { calls.ai++; throw new Error("AI must not be called from a public preview route"); }
    }
  };
  try {
    const request = new Request("https://goldstar-trainer-staging.goldstar-nsl83.workers.dev/__preview/dry-run");
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.dryRun, true);
    assert.equal(result.fetchOnly, true);
    assert.equal(result.persisted, false);
    assert.equal(calls.ai, 0);
    assert.equal(calls.writes, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("candidate preview hostname can access the fetch-only parser diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  const html = '<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="NDS4ALLVIDEOS/126"><div class="tgme_widget_message_text">A long public Telegram sample containing Nodal Displacement Sequencing, Hook, Flag and Rally structural terms for the parser smoke test.</div></div></div>';
  globalThis.fetch = async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  try {
    const request = new Request("https://nds-gate-v12-goldstar-trainer-staging.goldstar-nsl83.workers.dev/__preview/dry-run");
    const response = await worker.fetch(request, { KNOWLEDGE: { async get() { return null; }, async put() { throw new Error("must not write"); } }, AI: { async run() { throw new Error("must not call AI"); } } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).fetchOnly, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Trainer signs exact source evidence with the shared HMAC key", async () => {
  const rule = {
    id: "nds_test",
    contentType: "trading_rule",
    category: "cycle",
    rule: "A completed cycle requires two hooks and two rallies.",
    conditions: ["Two hooks and two rallies precede the flag."],
    priority: 1,
    sourcePostId: "123",
    sourcePostUrl: "https://t.me/s/NDS4ALLVIDEOS/123",
    sourceExcerptHash: "a".repeat(64),
    sourcePostContentHash: "b".repeat(64),
    sourceCaptureMethod: "telegram_public_post_html",
    sourceExcerptVerified: true
  };
  const secret = "unit-test-nds-evidence-key-32-bytes-minimum";
  const signature = await signSourceEvidence({ NDS_EVIDENCE_HMAC_KEY: secret }, rule);
  const payload = {
    id: rule.id,
    contentType: rule.contentType,
    category: rule.category,
    rule: rule.rule,
    conditions: rule.conditions,
    priority: rule.priority,
    sourcePostId: rule.sourcePostId,
    sourcePostUrl: rule.sourcePostUrl,
    sourceExcerptHash: rule.sourceExcerptHash,
    sourcePostContentHash: rule.sourcePostContentHash,
    sourceCaptureMethod: rule.sourceCaptureMethod,
    sourceExcerptVerified: rule.sourceExcerptVerified
  };
  const expected = createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");
  assert.equal(signature, expected);
  for (const change of [
    { rule: "Tampered rule text." },
    { category: "tampered" },
    { conditions: ["tampered condition"] },
    { priority: 2 }
  ]) {
    const altered = { ...rule, ...change };
    const alteredSignature = await signSourceEvidence({ NDS_EVIDENCE_HMAC_KEY: secret }, altered);
    assert.notEqual(alteredSignature, signature);
  }
});

test("scheduled training refuses to run or write candidates without the signing key", async () => {
  const calls = { reads: 0, writes: 0, ai: 0, fetch: 0 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls.fetch++; throw new Error("should not fetch"); };
  const env = {
    KNOWLEDGE: {
      async get() { calls.reads++; return null; },
      async put(key, value) { calls.writes++; assert.equal(key, "trainer:last_run"); assert.match(value, /evidence_signing_key_missing/); }
    },
    AI: { async run() { calls.ai++; throw new Error("should not call AI"); } }
  };
  try {
    await worker.scheduled({}, env);
    assert.deepEqual(calls, { reads: 0, writes: 1, ai: 0, fetch: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
