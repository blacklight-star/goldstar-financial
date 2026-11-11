import test from "node:test";
import { createHash, createHmac } from "node:crypto";
import assert from "node:assert/strict";
import worker, { isNdsRelevantText, signSourceEvidence, renewKnowledgeWriteLock, recoverPendingKnowledgeCommit, persistKnowledgeCommit, isDeferredRetryDue, buildDeferredRecord, sourceOriginTypeForChannel } from "./worker.js";

test("health reports staging scheduler paused", async () => {
  const response = await worker.fetch(new Request("https://trainer.example/health"), {}, {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.mode, "staging-nds-ingestion");
  assert.equal(body.scheduler, "paused; no Cron triggers configured");
});

test("admin routes reject missing or incorrect bridge credentials without side effects", async () => {
  const calls = { reads: 0, writes: 0, ai: 0 };
  const env = {
    KNOWLEDGE: {
      async get() { calls.reads++; return null; },
      async put() { calls.writes++; }
    },
    AI: { async run() { calls.ai++; throw new Error("AI must not be called by rejected admin requests"); } }
  };
  const routes = [
    { path: "/admin/diagnostics", method: "POST" },
    { path: "/admin/status", method: "GET" },
    { path: "/admin/run-once", method: "POST" }
  ];
  for (const route of routes) {
    const missing = await worker.fetch(new Request("https://trainer.example" + route.path, { method: route.method }), env);
    assert.equal(missing.status, 401, route.path + " must reject a missing bridge secret");

    const incorrect = await worker.fetch(new Request("https://trainer.example" + route.path, {
      method: route.method,
      headers: { authorization: "Bearer incorrect-test-secret" }
    }), { ...env, GOLDSTAR_BRIDGE_SECRET: "correct-test-secret" });
    assert.equal(incorrect.status, 401, route.path + " must reject an incorrect bridge secret");
  }
  assert.deepEqual(calls, { reads: 0, writes: 0, ai: 0 });
});

test("authenticated admin diagnostics are read-only and do not invoke AI", async () => {
  const calls = { reads: 0, writes: 0, ai: 0 };
  const secret = "unit-test-trainer-bridge-secret";
  const env = {
    GOLDSTAR_BRIDGE_SECRET: secret,
    KNOWLEDGE: {
      async get() { calls.reads++; return null; },
      async put() { calls.writes++; }
    },
    AI: { async run() { calls.ai++; throw new Error("diagnostics must not invoke AI"); } }
  };
  const response = await worker.fetch(new Request("https://trainer.example/admin/diagnostics", {
    method: "POST",
    headers: { authorization: "Bearer " + secret }
  }), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.checks.auth, true);
  assert.equal(result.checks.kv.ok, true);
  assert.equal(result.note, "Read-only diagnostics. No training run was started.");
  assert.deepEqual(calls, { reads: 1, writes: 0, ai: 0 });
});

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

test("rejects lexical co-occurrence without NDS relationships", () => {
  assert.equal(isNdsRelevantText(long("Nodes, hooks, flags, rally, drop, sequence, fractal, symmetry and cycle are all words used in financial markets.")), false);
  assert.equal(isNdsRelevantText(long("A rally follows a resistance break, while a flag appears near a fractal support zone and a symmetry level.")), false);
});

test("accepts linked NDS structural relationships", () => {
  assert.equal(isNdsRelevantText(long("The Hook contains three Nodes, then the next Rally follows the completed Hook structure and the sequence ends with a Flag.")), true);
  assert.equal(isNdsRelevantText(long("The parent Node defines the child Node priority; the Hook then precedes the Rally before the Flag closes the cycle.")), true);
});

test("accepts Persian NDS relationships after Unicode and digit normalization", () => {
  assert.equal(isNdsRelevantText(long("در ساختار NDS، هوک پس از تشکیل گره‌ها شکل می‌گیرد؛ سپس رالی ایجاد می‌شود و پس از آن فلگ پایان چرخه را مشخص می‌کند.")), true);
  assert.equal(isNdsRelevantText(long("در این روش، گره والد اولویت گره فرزند را تعیین می‌کند و هوک پس از آن به رالی منتهی می‌شود.")), true);
});

test("rejects generic ICT vocabulary padded with NDS-like words", () => {
  assert.equal(isNdsRelevantText(long("Liquidity and order blocks are discussed with Nodes, Flags, Rally, Sequence and Fractal terms, but no structural NDS relationship is described.")), false);
});

test("accepts Persian NDS terminology when structural relationships are explicit", () => {
  assert.equal(isNdsRelevantText(long("در استراتژی NDS، هوک پس از تشکیل گره‌ها می‌آید؛ سپس رالی شکل می‌گیرد و در پایان فلگ چرخه را می‌بندد.")), true);
});

test("rejects software architecture text that borrows NDS component vocabulary", () => {
  assert.equal(isNdsRelevantText(long("The NDS strategy for software architecture describes components and structure. Nodes, hooks, flags, rally, sequence, cycles, fractals and symmetry are used as names for graph components, event callbacks, state flags and repeated test runs.")), false);
});

test("does not reject an NDS post merely because it also mentions ICT terms", () => {
  assert.equal(isNdsRelevantText(long("NDS Hook and Flag sequencing is distinct from an order block or liquidity sweep; the 123Flag remains the entry structure.")), true);
});

test("source-grounded NDS classifier fixtures meet explicit precision and recall acceptance criteria", () => {
  const fixtures = [
    {
      label: true,
      source: "NDS_farsi-libre.pdf p.11",
      text: "در تعریف نودهای NDS، Node N2 بالاتر از Node N1 تشکیل می‌شود و Node N3 بالاتر از N2 است؛ سپس قیمت پس از N3 ریزش می‌کند و ترتیب نودهای قله و دره در بازار شماره‌گذاری می‌شود."
    },
    {
      label: true,
      source: "NDS_farsi-libre.pdf p.13",
      text: "در NDS، سکانس Nodeها در چرخه بازار بر اصل توالی 123 استوار است؛ Cycle Analysis و Fractal Analysis ساختارهای کوچک‌تر را به چرخه بزرگ‌تر پیوند می‌دهند و ترتیب Nodeها نقض نمی‌شود."
    },
    {
      label: true,
      source: "NDS_Strategy_English_Version.pdf p.25",
      text: "A positive NDS cycle consists of two consecutive Hook patterns followed by two Rally patterns and a Flag; after the Flag, price drops to close the cycle at the terminal point. The sequence describes the internal structure rather than a generic market-cycle label."
    },
    {
      label: true,
      source: "NDS_Strategy_English_Version.pdf p.32",
      text: "Nodal Displacement Sequencing uses fractal analysis: smaller self-similar market patterns combine into larger structures across timeframes, while the higher timeframe influences the lower timeframe and the node sequence remains structurally related."
    },
    {
      label: false,
      source: "NDS_farsi-libre.pdf p.14",
      text: "The natural water cycle repeats when sunlight evaporates water, vapor condenses into clouds, rainfall returns water to land and rivers, and some water flows back to the sea. These stages describe weather and hydrology, not a trading methodology."
    },
    {
      label: false,
      source: "NDS_farsi-libre.pdf p.15",
      text: "Financial markets contain repeating cycles whose shapes vary with price, time and trading volume. This description discusses general market periodicity only and does not define nodes, hooks, rallies, flags or any NDS sequencing relationship."
    },
    {
      label: false,
      source: "hostile software architecture fixture",
      text: "The NDS strategy for software architecture describes components and structure. Nodes, hooks, flags, rally, sequence, cycles, fractals and symmetry are names for graph components, event callbacks, state flags and repeated test runs."
    },
    {
      label: false,
      source: "hostile numbered graph fixture",
      text: "The NDS graph subsystem labels software nodes N1, N2 and N3 and describes higher and lower node priority in a dependency graph. The paragraph describes software dependencies only."
    },
    {
      label: false,
      source: "hostile NDS schema fixture",
      text: "The NDS schema assigns node IDs N1, N2 and 123 to software components and describes their sequence in a graph. Market and price are field names in the unrelated database schema, not trading concepts."
    }
  ];
  const confusion = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const fixture of fixtures) {
    assert.ok(fixture.text.length >= NDS_MIN_SOURCE_LENGTH, fixture.source);
    const predicted = isNdsRelevantText(fixture.text);
    if (fixture.label && predicted) confusion.tp++;
    else if (!fixture.label && predicted) confusion.fp++;
    else if (!fixture.label && !predicted) confusion.tn++;
    else confusion.fn++;
  }
  const precision = confusion.tp / (confusion.tp + confusion.fp);
  const recall = confusion.tp / (confusion.tp + confusion.fn);
  assert.deepEqual(confusion, { tp: 4, fp: 0, tn: 5, fn: 0 });
  assert.equal(precision, 1);
  assert.equal(recall, 1);
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
    const request = new Request("https://45c03d2b-goldstar-trainer-staging.goldstar-nsl83.workers.dev/__preview/dry-run");
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
    const request = new Request("https://45c03d2b-goldstar-trainer-staging.goldstar-nsl83.workers.dev/__preview/dry-run");
    const response = await worker.fetch(request, { KNOWLEDGE: { async get() { return null; }, async put() { throw new Error("must not write"); } }, AI: { async run() { throw new Error("must not call AI"); } } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).fetchOnly, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Trainer signs exact source evidence with the shared HMAC key", async () => {
  const sourceExcerpt = "A completed positive NDS cycle requires two hooks and two rallies before the flag.";
  const sourcePostText = "Official FuzzyLogic_NDS training content: " + sourceExcerpt + " The source post includes the full structural explanation.";
  const rule = {
    id: "nds_test",
    contentType: "trading_rule",
    category: "cycle",
    rule: "A completed cycle requires two hooks and two rallies.",
    conditions: ["Two hooks and two rallies precede the flag."],
    priority: 1,
    sourcePostId: "123",
    sourcePostUrl: "https://t.me/s/FuzzyLogic_NDS/123",
    sourceExcerpt,
    sourcePostText,
    sourceExcerptHash: createHash("sha256").update(sourceExcerpt).digest("hex"),
    sourcePostContentHash: createHash("sha256").update(sourcePostText).digest("hex"),
    sourceCaptureMethod: "telegram_public_post_html",
    sourceOriginType: "official_telegram_channel",
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
    sourceOriginType: rule.sourceOriginType,
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

test("Trainer refuses to sign Telegram evidence when the excerpt, source hash or channel provenance does not match", async () => {
  const sourceExcerpt = "A completed positive NDS cycle requires two hooks and two rallies before the flag.";
  const sourcePostText = "Official FuzzyLogic_NDS training content: " + sourceExcerpt + " The source post includes the full structural explanation.";
  const baseRule = {
    id: "nds_test",
    contentType: "trading_rule",
    category: "cycle",
    rule: "A completed cycle requires two hooks and two rallies.",
    conditions: ["Two hooks and two rallies precede the flag."],
    priority: 1,
    sourcePostId: "123",
    sourcePostUrl: "https://t.me/s/FuzzyLogic_NDS/123",
    sourceExcerpt,
    sourcePostText,
    sourceExcerptHash: createHash("sha256").update(sourceExcerpt).digest("hex"),
    sourcePostContentHash: createHash("sha256").update(sourcePostText).digest("hex"),
    sourceCaptureMethod: "telegram_public_post_html",
    sourceOriginType: "official_telegram_channel",
    sourceExcerptVerified: true
  };
  const secret = "unit-test-nds-evidence-key-32-bytes-minimum";
  const excerptMissing = "A different captured Telegram post with enough text but without the quoted NDS excerpt.";
  await assert.rejects(
    signSourceEvidence({
      NDS_EVIDENCE_HMAC_KEY: secret
    }, {
      ...baseRule,
      sourcePostText: excerptMissing,
      sourcePostContentHash: createHash("sha256").update(excerptMissing).digest("hex")
    }),
    /content\/provenance/
  );
  await assert.rejects(
    signSourceEvidence({ NDS_EVIDENCE_HMAC_KEY: secret }, {
      ...baseRule,
      sourcePostUrl: "https://t.me/s/NDS4ALLVIDEOS/123"
    }),
    /content\/provenance/
  );
  await assert.rejects(
    signSourceEvidence({ NDS_EVIDENCE_HMAC_KEY: secret }, {
      ...baseRule,
      sourceOriginType: "third_party_video_archive"
    }),
    /content\/provenance/
  );
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

test("current candidate code accepts the previously issued V17 hostname in a fetch-only diagnostics unit simulation", async () => {
  const originalFetch = globalThis.fetch;
  const calls = { ai: 0, writes: 0, fetch: 0 };
  globalThis.fetch = async () => {
    calls.fetch++;
    return new Response("<html><body>No public posts</body></html>", { status: 200, headers: { "content-type": "text/html" } });
  };
  const env = {
    KNOWLEDGE: {
      async get() { return null; },
      async put() { calls.writes++; }
    },
    AI: { async run() { calls.ai++; throw new Error("diagnostics must not call AI"); } }
  };
  try {
    const base = "https://45c03d2b-goldstar-trainer-staging.goldstar-nsl83.workers.dev";
    const parser = await worker.fetch(new Request(base + "/__preview/parser-selftest"), env);
    assert.equal(parser.status, 200);
    assert.equal((await parser.json()).success, true);

    const diagnostics = await worker.fetch(new Request(base + "/__preview/source-diagnostics"), env);
    assert.equal(diagnostics.status, 200);
    const result = await diagnostics.json();
    assert.equal(result.dryRun, true);
    assert.equal(result.persisted, false);
    assert.equal(result.aiCalled, false);
    assert.equal(result.channels.length, 8);
    assert.equal(result.ok, false);
    assert.equal(result.channels.filter(channel => channel.sourceRole === "configured_source").length, 4);
    assert.equal(calls.ai, 0);
    assert.equal(calls.writes, 0);
    assert.equal(calls.fetch, 8);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("only the Trainer immutable-version hostname pattern is accepted for future candidates", async () => {
  const request = new Request("https://deadbeef-goldstar-trainer-staging.goldstar-nsl83.workers.dev/__preview/parser-selftest");
  const response = await worker.fetch(request, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);

  const unrelated = await worker.fetch(new Request("https://deadbeef-other.goldstar-nsl83.workers.dev/__preview/parser-selftest"), {});
  assert.equal(unrelated.status, 404);
});


function mockLeaseDb(owned = true) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              return owned ? { owner_token: args[3] } : null;
            },
            async run() { return { success: true }; }
          };
        }
      };
    }
  };
}

test("knowledge write lease renews only for the current unexpired owner", async () => {
  assert.equal(await renewKnowledgeWriteLock({ DB: mockLeaseDb(true) }, "owner-1"), true);
  await assert.rejects(
    renewKnowledgeWriteLock({ DB: mockLeaseDb(false) }, "owner-1"),
    /lease expired or ownership was lost/
  );
});

test("deferred posts are re-evaluated after backoff and stop after the retry cap", () => {
  const now = Date.UTC(2026, 10, 9, 12, 0, 0);
  assert.equal(isDeferredRetryDue({ retryCount: 0, nextRetryAt: new Date(now + 1000).toISOString() }, now), false);
  assert.equal(isDeferredRetryDue({ retryCount: 0, nextRetryAt: new Date(now - 1000).toISOString() }, now), true);
  assert.equal(isDeferredRetryDue({ retryCount: 5, nextRetryAt: new Date(now - 1000).toISOString() }, now), false);

  const post = {
    sourcePostId: "321",
    sourcePostUrl: "https://t.me/s/NDS4ALLVIDEOS/321",
    contentHash: "a".repeat(64),
    text: "A short post",
    links: [],
    youtubeLinks: [],
    videoUrls: [],
    deferredRetry: true
  };
  const previous = { contentHash: post.contentHash, retryCount: 2 };
  const next = buildDeferredRecord(post, previous, now);
  assert.equal(next.retryCount, 3);
  assert.equal(Date.parse(next.nextRetryAt), now + 24 * 60 * 60 * 1000 * 8);

  const edited = buildDeferredRecord({ ...post, contentHash: "b".repeat(64), deferredRetry: false }, previous, now);
  assert.equal(edited.retryCount, 0);
});

test("partial KV commit leaves a journal that the next owner can replay idempotently", async () => {
  const store = new Map();
  let failKey = "trainer:post_hashes:NDS4ALLVIDEOS";
  const env = {
    DB: mockLeaseDb(true),
    KNOWLEDGE: {
      async get(key) { return store.has(key) ? store.get(key) : null; },
      async put(key, value) {
        if (key === failKey) throw new Error("simulated KV outage");
        store.set(key, value);
      },
      async delete(key) { store.delete(key); }
    }
  };
  const writes = [
    { key: "knowledge_NDS_pending", value: JSON.stringify([{ id: "nds_test" }]) },
    { key: "trainer:post_hashes:NDS4ALLVIDEOS", value: JSON.stringify({ "321": "hash" }) }
  ];
  await assert.rejects(persistKnowledgeCommit(env, "owner-1", writes), /simulated KV outage/);
  assert.equal(store.has("trainer:commit_journal"), true);
  assert.equal(store.has("knowledge_NDS_pending"), true);
  assert.equal(store.has("trainer:post_hashes:NDS4ALLVIDEOS"), false);

  failKey = null;
  assert.equal(await recoverPendingKnowledgeCommit(env, "owner-2"), true);
  assert.deepEqual(JSON.parse(store.get("knowledge_NDS_pending")), [{ id: "nds_test" }]);
  assert.deepEqual(JSON.parse(store.get("trainer:post_hashes:NDS4ALLVIDEOS")), { "321": "hash" });
  assert.equal(store.has("trainer:commit_journal"), false);
});

test("commit journal rejects keys outside the Trainer write allowlist", async () => {
  const store = new Map([["trainer:commit_journal", JSON.stringify({
    version: 1,
    writes: [{ key: "some-unrelated-key", value: "bad" }]
  })]]);
  const env = {
    DB: mockLeaseDb(true),
    KNOWLEDGE: {
      async get(key) { return store.get(key) ?? null; },
      async put(key, value) { store.set(key, value); },
      async delete(key) { store.delete(key); }
    }
  };
  await assert.rejects(recoverPendingKnowledgeCommit(env, "owner-1"), /invalid or duplicate write/);
  assert.equal(store.has("some-unrelated-key"), false);
});


test("source diagnostics require all configured channels but not diagnostic-only channels", async () => {
  const originalFetch = globalThis.fetch;
  const configured = new Set(["NDS4ALLVIDEOS", "FuzzyLogic_NDS", "BNJ1I", "cottagends"]);
  const canonicalChannels = new Map([
    ["nds4allvideos", "NDS4ALLVIDEOS"],
    ["fuzzylogic_nds", "FuzzyLogic_NDS"],
    ["bnj1i", "BNJ1I"],
    ["cottagends", "cottagends"]
  ]);
  const calls = { ai: 0, writes: 0, fetch: 0 };
  globalThis.fetch = async input => {
    calls.fetch++;
    const url = new URL(typeof input === "string" ? input : input.url);
    const channel = canonicalChannels.get(url.pathname.split("/").pop().toLowerCase());
    if (!channel || !configured.has(channel)) {
      return new Response("<html><body>No public posts</body></html>", { status: 200, headers: { "content-type": "text/html" } });
    }
    const html = '<div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="' + channel + '/456"><div class="tgme_widget_message_text js-message_text">Nodal Displacement Sequencing contains a Hook, a Rally, and a Flag with sufficient source text for live-style diagnostics.</div></div></div>';
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  };
  const env = {
    KNOWLEDGE: { async get() { return null; }, async put() { calls.writes++; } },
    AI: { async run() { calls.ai++; throw new Error("diagnostics must not call AI"); } }
  };
  try {
    const base = "https://deadbeef-goldstar-trainer-staging.goldstar-nsl83.workers.dev";
    const response = await worker.fetch(new Request(base + "/__preview/source-diagnostics"), env);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.channels.length, 8);
    assert.deepEqual(result.channels.filter(item => item.sourceRole === "configured_source").map(item => item.channel).sort(), Array.from(configured).sort());
    assert.equal(result.channels.filter(item => item.sourceRole === "configured_source").every(item => item.success && item.postCount > 0), true);
    assert.equal(result.diagnosticOnly.total, 4);
    assert.equal(result.diagnosticOnly.successful, 0);
    assert.equal(calls.fetch, 8);
    assert.equal(calls.ai, 0);
    assert.equal(calls.writes, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("Preview-only fixed HMAC sample signs the cross-worker fixture without AI or KV writes", async () => {
  const key = "unit-test-trainer-hmac-key-32-bytes-minimum";
  const calls = { ai: 0, writes: 0 };
  const env = {
    NDS_EVIDENCE_HMAC_KEY: key,
    KNOWLEDGE: {
      async get() { return null; },
      async put() { calls.writes++; }
    },
    AI: { async run() { calls.ai++; throw new Error("Preview HMAC sample must not call AI"); } }
  };
  const host = "https://deadbeef-goldstar-trainer-staging.goldstar-nsl83.workers.dev";
  const response = await worker.fetch(new Request(host + "/__preview/hmac-sample"), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.sample.id, "nds-preview-hmac-parity-v1");
  assert.equal(result.sample.sourceCaptureMethod, "telegram_public_post_html");
  assert.equal(result.sample.sourceEvidenceSignature, await signSourceEvidence(env, result.sample));
  assert.equal(JSON.stringify(result).includes(key), false);
  assert.equal(calls.ai, 0);
  assert.equal(calls.writes, 0);

  const blocked = await worker.fetch(new Request(
    "https://trainer.example.com/__preview/hmac-sample"
  ), env);
  assert.equal(blocked.status, 404);
});


test("Academia is catalogued as the primary author source with first-party PDF acquisition only", async () => {
  const originalFetch = globalThis.fetch;
  const calls = { fetch: 0, ai: 0, writes: 0 };
  globalThis.fetch = async () => {
    calls.fetch++;
    throw new Error("Automated Academia access must not be attempted");
  };
  const env = {
    KNOWLEDGE: { async get() { return null; }, async put() { calls.writes++; } },
    AI: { async run() { calls.ai++; throw new Error("Catalog route must not invoke AI"); } }
  };
  try {
    const response = await worker.fetch(new Request(
      "https://deadbeef-goldstar-trainer-staging.goldstar-nsl83.workers.dev/__preview/primary-source-catalog"
    ), env);
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.fetchedFromAcademia, false);
    assert.equal(result.persisted, false);
    assert.equal(result.aiCalled, false);
    assert.equal(result.sources.length, 5);
    const english = result.sources.find(source => source.documentId === "129627974");
    const farsi = result.sources.find(source => source.documentId === "129628090");
    assert.ok(english);
    assert.ok(farsi);
    assert.equal(english.authorityTier, "primary");
    assert.equal(english.sourceOriginType, "primary_author_published_source");
    assert.equal(english.sourceCaptureMethod, "academia_account_pdf_download");
    assert.equal(english.format, "application/pdf");
    assert.equal(english.automatedSiteAccessAllowed, false);
    assert.equal(english.acquisitionMode, "user_initiated_first_party_download");
    assert.equal(farsi.authorityTier, "primary");
    assert.equal(calls.fetch, 0);
    assert.equal(calls.ai, 0);
    assert.equal(calls.writes, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TG.ME independent archive preserves the canonical Telegram post ID and has no side effects", async () => {
  const originalFetch = globalThis.fetch;
  const calls = { fetch: 0, ai: 0, writes: 0 };
  globalThis.fetch = async url => {
    calls.fetch++;
    const match = String(url).match(/^https:\/\/tg\.me\/fuzzylogic_nds\/(\d+)$/);
    assert.ok(match);
    const id = match[1];
    const lessonById = { "983": "۶۵", "972": "۶۴", "967": "۶۳", "965": "۶۳", "958": "۶۲", "944": "۶۱" };
    const lesson = lessonById[id];
    assert.ok(lesson);
    const html = `<!doctype html><html><head><title>آموزش استراتژی NDS جلسه شماره ${lesson} — NDS Learning Hub — TG.ME</title></head><body>
      <main><h1>NDS Learning Hub</h1><p>💎 آموزش استراتژی NDS 📚 جلسه شماره ${lesson} 🎓 توسط جناب آقای دکتر ایرج جعفریان @FuzzyLogic_NDS</p>
      <a href="https://t.me/fuzzylogic_nds/${id}">original Telegram post</a></main></body></html>`;
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  };
  const env = {
    KNOWLEDGE: { async get() { return null; }, async put() { calls.writes++; } },
    AI: { async run() { calls.ai++; throw new Error("Preview diagnostics must not invoke AI"); } }
  };
  try {
    const response = await worker.fetch(new Request(
      "https://deadbeef-goldstar-trainer-staging.goldstar-nsl83.workers.dev/__preview/tgme-archive-diagnostics"
    ), env);
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.persisted, false);
    assert.equal(result.aiCalled, false);
    assert.equal(result.sampleCount, 6);
    assert.equal(result.sources.length, 6);
    assert.ok(result.sources.every(item => item.success === true));
    assert.ok(result.sources.every(item => item.sourceOriginType === "third_party_telegram_archive"));
    assert.ok(result.sources.every(item => item.sourceCaptureMethod === "tgme_public_post_html"));
    assert.ok(result.sources.every(item => item.canonicalPostUrl.includes("/fuzzylogic_nds/")));
    assert.equal(calls.fetch, 6);
    assert.equal(calls.ai, 0);
    assert.equal(calls.writes, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TG.ME archive rejects an individual post redirected outside its exact archive URL", async () => {
  const originalFetch = globalThis.fetch;
  const calls = { ai: 0, writes: 0 };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    url: "https://evil.example/fuzzylogic_nds/983",
    redirected: true,
    async text() { return "<html><body>NDS Learning Hub جلسه شماره ۶۵ https://t.me/fuzzylogic_nds/983</body></html>"; }
  });
  const env = {
    KNOWLEDGE: { async get() { return null; }, async put() { calls.writes++; } },
    AI: { async run() { calls.ai++; } }
  };
  try {
    const response = await worker.fetch(new Request(
      "https://deadbeef-goldstar-trainer-staging.goldstar-nsl83.workers.dev/__preview/tgme-archive-diagnostics"
    ), env);
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.ok, false);
    assert.ok(result.sources.every(item => item.success === false));
    assert.ok(result.sources.every(item => /redirected outside/.test(item.error)));
    assert.equal(calls.ai, 0);
    assert.equal(calls.writes, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("Telegram source origins are explicit and never default to official", () => {
  assert.equal(sourceOriginTypeForChannel("NDS4ALLVIDEOS"), "third_party_video_archive");
  assert.equal(sourceOriginTypeForChannel("FuzzyLogic_NDS"), "official_telegram_channel");
  assert.equal(sourceOriginTypeForChannel("BNJ1I"), "third_party_course_aggregator");
  assert.equal(sourceOriginTypeForChannel("cottagends"), "community_repost_channel");
  assert.equal(sourceOriginTypeForChannel("unknown-channel"), "unverified_telegram_source");
});
