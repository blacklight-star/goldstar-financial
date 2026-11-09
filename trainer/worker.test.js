import test from "node:test";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import worker, { isNdsRelevantText, signSourceEvidence, renewKnowledgeWriteLock, recoverPendingKnowledgeCommit, persistKnowledgeCommit, isDeferredRetryDue, buildDeferredRecord } from "./worker.js";

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


test("NDS source registry endpoints reject missing and incorrect bridge credentials before D1 access", async () => {
  const calls = { db: 0, ai: 0, kvWrites: 0 };
  const env = {
    GOLDSTAR_BRIDGE_SECRET: "correct-source-registry-secret",
    DB: { prepare() { calls.db++; throw new Error("unauthorized request reached D1"); } },
    KNOWLEDGE: { async get() { return null; }, async put() { calls.kvWrites++; } },
    AI: { async run() { calls.ai++; } }
  };
  const routes = [
    "/admin/source-documents",
    "/admin/source-pages?sourceId=academia-nds-farsi&from=1&to=2",
    "/admin/source-review-flags"
  ];
  for (const path of routes) {
    const missing = await worker.fetch(new Request("https://trainer.example" + path), env);
    assert.equal(missing.status, 401, path + " must reject missing credentials");
    const incorrect = await worker.fetch(new Request("https://trainer.example" + path, {
      headers: { authorization: "Bearer wrong-secret" }
    }), env);
    assert.equal(incorrect.status, 401, path + " must reject incorrect credentials");
  }
  assert.deepEqual(calls, { db: 0, ai: 0, kvWrites: 0 });
});

test("NDS source registry admin reads are bounded, authenticated, and side-effect free", async () => {
  const calls = { dbReads: 0, dbWrites: 0, ai: 0, kvWrites: 0 };
  const secret = "unit-test-source-registry-secret";
  const source = {
    source_id: "academia-nds-farsi",
    title: "NDS Farsi",
    authority_tier: "primary_author_source",
    status: "staging_ingested_quarantined",
    technical_review_status: "core_methodology_validation_pending"
  };
  const pageRows = [
    { source_id: source.source_id, page_number: 2, content_type: "text", content: "risk disclaimer", content_sha256: "a".repeat(64) },
    { source_id: source.source_id, page_number: 3, content_type: "text", content: "introduction", content_sha256: "b".repeat(64) }
  ];
  const flagRows = [
    { review_id: "NDS-FA-CRYPTO-001", source_id: source.source_id, severity: "medium", status: "open" }
  ];
  const db = {
    prepare(sql) {
      const query = {
        params: [],
        bind(...params) { this.params = params; return this; },
        async all() {
          calls.dbReads++;
          if (sql.includes("FROM gs_source_documents")) {
            if (sql.includes("WHERE source_id")) return { results: [source] };
            return { results: [source] };
          }
          if (sql.includes("FROM gs_source_chunks")) return { results: pageRows };
          if (sql.includes("FROM gs_source_review_flags")) return { results: flagRows };
          throw new Error("Unexpected source registry query: " + sql);
        },
        async run() { calls.dbWrites++; return { success: true }; }
      };
      return query;
    }
  };
  const env = {
    GOLDSTAR_BRIDGE_SECRET: secret,
    DB: db,
    KNOWLEDGE: { async get() { return null; }, async put() { calls.kvWrites++; } },
    AI: { async run() { calls.ai++; throw new Error("Source registry reads must not call AI"); } }
  };
  const headers = { authorization: "Bearer " + secret };

  const docsResponse = await worker.fetch(new Request("https://trainer.example/admin/source-documents", { headers }), env);
  assert.equal(docsResponse.status, 200);
  const docs = await docsResponse.json();
  assert.equal(docs.ok, true);
  assert.equal(docs.readOnly, true);
  assert.equal(docs.aiCalled, false);
  assert.equal(docs.persisted, false);
  assert.equal(docs.count, 1);
  assert.equal(docs.documents[0].source_id, source.source_id);

  const pagesResponse = await worker.fetch(new Request(
    "https://trainer.example/admin/source-pages?sourceId=academia-nds-farsi&from=2&to=3", { headers }
  ), env);
  assert.equal(pagesResponse.status, 200);
  const pages = await pagesResponse.json();
  assert.equal(pages.readOnly, true);
  assert.deepEqual(pages.pages.map(page => page.page_number), [2, 3]);
  assert.equal(pages.pages[0].content, "risk disclaimer");

  const flagsResponse = await worker.fetch(new Request(
    "https://trainer.example/admin/source-review-flags?sourceId=academia-nds-farsi&limit=5", { headers }
  ), env);
  assert.equal(flagsResponse.status, 200);
  const flags = await flagsResponse.json();
  assert.equal(flags.readOnly, true);
  assert.equal(flags.flags[0].review_id, "NDS-FA-CRYPTO-001");

  const rejectedRange = await worker.fetch(new Request(
    "https://trainer.example/admin/source-pages?sourceId=academia-nds-farsi&from=1&to=20", { headers }
  ), env);
  assert.equal(rejectedRange.status, 400);

  assert.equal(calls.dbReads, 4);
  assert.equal(calls.dbWrites, 0);
  assert.equal(calls.ai, 0);
  assert.equal(calls.kvWrites, 0);
});

test("NDS source page access rejects unknown documents before reading their chunks", async () => {
  const queries = [];
  const secret = "unit-test-source-registry-secret";
  const env = {
    GOLDSTAR_BRIDGE_SECRET: secret,
    DB: {
      prepare(sql) {
        const query = { bind(...params) { query.params = params; return query; }, params: [], async all() {
          queries.push({ sql, params: query.params });
          return { results: [] };
        } };
        return query;
      }
    }
  };
  const response = await worker.fetch(new Request(
    "https://trainer.example/admin/source-pages?sourceId=unknown-nds-source&from=1&to=1",
    { headers: { authorization: "Bearer " + secret } }
  ), env);
  assert.equal(response.status, 404);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /FROM gs_source_documents/);
});

test("Preview source registry diagnostics confirm the staged primary NDS corpus without side effects", async () => {
  const calls = { dbReads: 0, dbWrites: 0, ai: 0, kvWrites: 0 };
  const docs = [
    { source_id: "academia-nds-strategy-english-v1", source_document_id: "129627974", title: "NDS Strategy English Version", authority_tier: "primary_author_source", page_count: 44, imported_pages: 44, text_chunks: 44, visual_chunks: 0 },
    { source_id: "academia-nds-farsi", source_document_id: "129628090", title: "NDS Farsi", authority_tier: "primary_author_source", page_count: 125, imported_pages: 125, text_chunks: 114, visual_chunks: 11 },
    { source_id: "academia-nds-new-approach", source_document_id: "122576333", title: "NDS New Approach", authority_tier: "primary_author_source", page_count: 12, imported_pages: 12, text_chunks: 11, visual_chunks: 1 },
    { source_id: "academia-nds-ai-quant", source_document_id: "122832409", title: "Advanced Quantitative Trading", authority_tier: "primary_author_source", page_count: 7, imported_pages: 7, text_chunks: 7, visual_chunks: 0 },
    { source_id: "academia-nds-money-management", source_document_id: "122966805", title: "Advanced Money Management", authority_tier: "primary_author_source", page_count: 6, imported_pages: 6, text_chunks: 6, visual_chunks: 0 },
    { source_id: "owner-supplied-nds-multifractal-2019", source_document_id: null, title: "2019 Multifractal Supplement", authority_tier: "unverified_supplement", page_count: 8, imported_pages: 8, text_chunks: 8, visual_chunks: 0 }
  ];
  const flagGroups = [
    { severity: "critical", status: "open", count: 2 },
    { severity: "high", status: "open", count: 17 },
    { severity: "medium", status: "open", count: 4 }
  ];
  const moduleGroups = [
    { status: "source_mapped", count: 9 },
    { status: "source_mapped_risk_gate", count: 1 },
    { status: "source_mapped_validation_required", count: 1 },
    { status: "source_mapped_with_conflicts", count: 1 }
  ];
  const candidateSummary = [
    { total: 10, unapproved: 10, execution_ineligible: 10 }
  ];
  const env = {
    DB: {
      prepare(sql) {
        return {
          async all() {
            calls.dbReads++;
            if (sql.includes("FROM gs_source_documents")) return { results: docs };
            if (sql.includes("FROM gs_source_review_flags")) return { results: flagGroups };
            if (sql.includes("FROM gs_nds_curriculum_modules")) return { results: moduleGroups };
            if (sql.includes("FROM gs_nds_rule_candidates")) return { results: candidateSummary };
            throw new Error("Unexpected query");
          },
          async run() { calls.dbWrites++; return { success: true }; }
        };
      }
    },
    KNOWLEDGE: { async get() { return null; }, async put() { calls.kvWrites++; } },
    AI: { async run() { calls.ai++; throw new Error("Diagnostics must not invoke AI"); } }
  };
  const response = await worker.fetch(new Request(
    "https://deadbeef-goldstar-trainer-staging.goldstar-nsl83.workers.dev/__preview/source-registry-diagnostics"
  ), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.persisted, false);
  assert.equal(result.aiCalled, false);
  assert.equal(result.fetchedFromAcademia, false);
  assert.equal(result.documents, 6);
  assert.equal(result.primaryAuthorDocuments, 5);
  assert.equal(result.ownerSuppliedQuarantinedDocuments, 1);
  assert.deepEqual(result.pageTotals, { pages: 202, imported: 202, text: 190, visual: 12 });
  assert.equal(result.reviewFlags.total, 23);
  assert.equal(result.curriculum.total, 12);
  assert.deepEqual(result.ruleCandidates, { total: 10, unapproved: 10, executionIneligible: 10 });
  assert.equal(calls.dbReads, 4);
  assert.equal(calls.dbWrites, 0);
  assert.equal(calls.ai, 0);
  assert.equal(calls.kvWrites, 0);
});

test("Preview source registry diagnostics fail closed on missing chunks or wrong corpus totals", async () => {
  const env = {
    DB: {
      prepare(sql) {
        return { async all() {
          if (sql.includes("FROM gs_source_documents")) return { results: [] };
          return { results: [] };
        } };
      }
    }
  };
  const response = await worker.fetch(new Request(
    "https://deadbeef-goldstar-trainer-staging.goldstar-nsl83.workers.dev/__preview/source-registry-diagnostics"
  ), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, false);
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
