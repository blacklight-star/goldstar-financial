# Goldstar Trainer — Staging source mirror

This folder contains the source-controlled Trainer mirror derived from the Staging Worker and its immutable Preview candidates.

## NDS retrieval gate

- The retrieval filter requires at least 120 characters.
- It accepts explicit NDS anchors (the full methodology name, 123Flag, or the distinctive Hook-Hook-Rally sequence).
- Without an explicit anchor, it requires at least two distinct, sentence-local NDS structural relationships (for example Hook↔Node, Hook→Rally, Rally→Flag, Flag↔Lip, or Node hierarchy/priority).
- Mere co-occurrence of generic terms such as nodes, flags, rally, sequence, fractal, or symmetry is rejected.
- Persian text is Unicode-normalized before relationship evaluation.
- This remains a retrieval prefilter; it does not establish correctness, source authority, validation, approval, or promotion.

## Source evidence and approval boundary

- Each extracted rule candidate must preserve the Telegram post ID, canonical URL, exact verbatim excerpt, excerpt hash, full-post content hash, capture method, and verification flag.
- The Trainer signs the exact rule content and provenance with HMAC. Financial L2 must independently verify the signature before a rule becomes approval-eligible.
- Extracted rules remain pending. Retrieval, AI extraction, evidence signing, and independent L1 approval are distinct stages.
- NDS remains the only permitted training methodology until the Technical Analysis Unit demonstrates full NDS mastery. ICT, RTM, and other methods remain blocked.

## Preview safety

- `/__preview/dry-run`, `/__preview/parser-selftest`, and `/__preview/source-diagnostics` are fetch-only diagnostics. They must never call Workers AI or write KV/D1. The Preview HMAC sample route returns a deterministic signed test fixture, never the signing key; CI forwards only the signature to Financial L2 Preview V31, which returns a Boolean verification result. The scheduled path renews its D1 lease between external operations and journals grouped KV writes before applying them; a later run replays an interrupted journal idempotently. Deferred post records use bounded exponential retry backoff and are reconsidered when due or when source content changes. No transcript provider is currently configured, so video-only posts remain explicitly deferred rather than being treated as extracted text.
- Candidate V17 used `https://45c03d2b-goldstar-trainer-staging.goldstar-nsl83.workers.dev`. A live check confirmed V17 health responds, but its `/__preview/parser-selftest` route returns HTTP 404. Version V17 is immutable and cannot be patched in place. Candidate V22 is the current diagnostic Preview at `https://e61db611-goldstar-trainer-staging.goldstar-nsl83.workers.dev`; it additionally uses the canonical lowercase Telegram handle `fuzzylogic_nds` for the FuzzyLogic_NDS source. It retains lease renewal, recoverable KV commit journaling, deferred-post retry backoff, and strict configured-source success semantics. CI checks V21 health, parser self-test, actual extraction from all four configured channels, separately reported diagnostic-only channels, and fetch-only Telegram dry-run. The V17-host unit test is a simulation of host-allowlist logic, not a live V17 test. Future immutable versions are accepted only when the hostname matches the exact eight-hex-prefix Trainer Staging pattern.
- Preview host allowlisting is explicit. Labels/aliases are not assumed to create DNS routes.
- The Staging Cron remains paused. There is no automatic training run.
- Authenticated admin execution requires the Staging-only `GOLDSTAR_BRIDGE_SECRET`. No secret values belong in Git, KV, D1, logs, or chat.

## Staging resources

- Staging D1: `goldstar_nds_staging`.
- Staging KV binding ID: `77b13f4018e3465ebd5e754482d3c5a2`.
- HMAC signing key binding: `NDS_EVIDENCE_HMAC_KEY`.
- This source branch changes code, tests, and documentation. Candidates V18 and V19 were uploaded as immutable Preview versions only; V19 was not deployed. No Cron was activated, no KV/D1 data was mutated, no secrets were changed, no rules were approved, and Production was not altered.


## Live source-readiness result (2026-11-09)

The latest live run confirmed the reliability and HMAC gates, but **source readiness is still blocked**:

| Configured source | Live public retrieval | Result |
|---|---:|---|
| NDS4ALLVIDEOS | 20 posts | Retrieved |
| FuzzyLogic_NDS | 0 posts | Telegram redirects from the public archive route to the channel page |
| BNJ1I | 0 posts | Telegram redirects from the public archive route to the channel page |
| cottagends | 0 posts | Telegram redirects from the public archive route to the channel page |

The four remaining diagnostic-only channels are reported separately; one of them returned 3 posts. They are not silently substituted for the configured sources. A successful HTTP 200 response without Telegram post wrappers is not counted as source retrieval.

Latest verified technical results:
- Trainer unit tests: 24/24 passed.
- L2 unit tests: 73/73 passed.
- Cross-Worker HMAC parity: passed between Trainer V23 and Financial L2 V32 using the fixed Preview fixture.
- Trainer health and parser self-test: passed.
- No AI calls, KV/D1 writes, Cron changes, approvals, active deployments, or Production changes.

Do not remove the strict source gate to make CI green. Source replacement or alternate ingestion must be explicitly authorized and provenance-labelled.

## Independent NDS source registry (2026-11-09)

Independent-platform ingestion is separate from the four configured Telegram channels. It does not replace or silently reclassify them.

### Ingestion-enabled, author-linked source

- **NDS Strategy English Version** — Dr. Iraj Jafarian, Academia document 129627974.
- Canonical URL: https://www.academia.edu/129627974/NDS_Strategy_English_Version
- Origin type: **author_linked_independent_platform**.
- Capture method: **academia_author_published_document_html**.
- Basis: the public NDS Learning Hub Telegram post points readers to Dr. Jafarian's Academia profile for NDS articles; that profile lists this document under his papers. The document exposes definitions, the five NDS pillars, cycle structure, and trading-rule sections.
- Scope: foundational NDS source material only. Author attribution is source provenance, **not independent validation of predictive performance**.
- Intake requires the final URL to remain on Academia, the exact document ID and title/author identity to match the allowlist, and at least 1,200 characters of readable source text. Trainer records and signs the origin type and capture method; Financial L2 independently checks the exact document allowlist and signature.

### Independent archive, cross-reference only

- **Telemetr public archive for @fuzzylogic_nds** — https://telemetr.io/en/channels/1645847716-fuzzylogic_nds/posts
- Origin type: **third_party_telegram_archive**.
- Status: **catalog_only_not_ingestion_ready**.
- Use: compare historical availability and identify missing lesson posts. It is a third-party copy, not the original author platform. Its currently verified archive view does not yet provide a stable, individually validated post identity suitable for the Trainer evidence chain; therefore it is not automatically ingested or approval-eligible.

### Additional author-listed documents

The Academia profile also lists NDS Farsi (document 129628090), Advanced Money Management (document 122966805), Advanced Quantitative Trading with AI (document 122832409), and NDS New Approach (document 122576333). These are catalogued for later full-text review; they are not ingestion-enabled by this change.

### Source-readiness boundary

- The Telegram diagnostics remain separate and continue to require all four configured Telegram channels to expose actual public post wrappers.
- A successful Academia archive check does not turn the official Telegram source gate green and does not substitute for Telegram post availability.
- All independently captured material remains pending. L2 source eligibility is not rule validation or approval; L1 remains the final owner approval gate.
- Preview diagnostics are fetch-only: no AI invocation, KV/D1 write, training run, approval, Cron change, active deployment, or Production change.
