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

The latest Preview CI confirms:
- Trainer V26 health and parser self-test passed.
- Trainer/L2 fixed-fixture HMAC parity passed between Trainer V26 and Financial L2 V35.
- Trainer unit tests: 28/28 passed.
- Financial L2 unit tests: 75/75 passed.
- Six TG.ME post pages were retrieved and their individual IDs/canonical Telegram links and captions were matched. All six exposed **zero** video tags, source tags, or direct media URLs in the fetched HTML; this is therefore a metadata index, not lesson-content intake.
- The strict official Telegram source gate still fails as intended: NDS4ALLVIDEOS returned 20 posts; FuzzyLogic_NDS, BNJ1I, and cottagends returned zero parsed posts. One diagnostic-only source returned 3 posts, but diagnostic-only sources cannot substitute for configured official sources.

CI run:
- [Trainer V26 source gate](https://github.com/blacklight-star/goldstar-financial/actions/runs/42533383964) — unit tests and health/parser/HMAC/TG.ME metadata checks passed; final strict configured-source gate remains red because three official Telegram archives are unavailable.
- [Financial L2 V35 CI](https://github.com/blacklight-star/goldstar-financial/actions/runs/42533340596) — 75/75 tests and all immutable Preview health checks passed.

No AI calls, KV/D1 writes, training, approvals, Cron changes, active deployments, or Production changes were performed. Trainer Staging Cron remains empty; Trainer Staging active deployment remains V9; L2 active deployment remains the pre-existing version. All new Worker versions are Preview-only.

## Independent NDS source registry (2026-11-09)

These sources are indexed separately from the four configured Telegram channels. No independent archive silently replaces an official source.

### 1. Academia — author-linked document, currently blocked for automated fetch

- **NDS Strategy English Version**, Dr. Iraj Jafarian; document ID `129627974`.
- Provenance: `author_linked_independent_platform`.
- Retrieval method: `academia_author_published_document_html`.
- The official NDS Learning Hub channel points users to Dr. Jafarian's Academia profile, and the profile lists this document under his work. This supports author-linked attribution and NDS relevance, not independent validation of performance claims.
- **Runtime result:** the Trainer Preview fetch returned HTTP 403. It is allowlisted as a catalogued author-linked source but is not currently ingestion-enabled.

### 2. TG.ME — individually indexed third-party mirror posts, metadata only

- Channel: `@fuzzylogic_nds` / NDS Learning Hub.
- Provenance: `third_party_telegram_archive`.
- Capture method: `tgme_public_post_html`.
- TG.ME provides stable IDs and individual page permalinks that point back to original Telegram post URLs. It is a third-party presentation layer, not Telegram itself.
- The current validation establishes post identity and caption/title metadata only. It does **not** establish access to the complete lesson video, transcript, or full teaching content. Therefore the source is indexed for cross-reference, but **not ingested into the Trainer's AI/rule-extraction pipeline and not eligible for L2 rule review or approval**.
- Indexed post/lesson pairs: `983→65`, `972→64`, `967→63-2`, `965→63-1`, `958→62`, `944→61`, `937→60`, `936→59`, `935→58`, `934→57`, `933→56`, `931→55`, `930→54`, `929→53`, `926→52`, `924→50`, `922→49`, `921→48`, `919→47`, `907→45`, `906→44`, `905→43`.
- Before any ingestion, each post still needs retrievable lesson media or a reliable transcript, content-hash capture, provenance validation, and L2 verifier support for the exact archive provenance.

### 3. Telemetr — historical cross-reference only

- Public archive: https://telemetr.io/en/channels/1645847716-fuzzylogic_nds/posts
- Provenance: `third_party_telegram_archive`.
- Catalog-only. No stable, individually verified post evidence chain has been established for Trainer intake.

### 4. Further author-listed Academia material

NDS Farsi (129628090), Advanced Money Management (122966805), Advanced Quantitative Trading with AI (122832409), and NDS New Approach (122576333) remain identified by profile metadata only; full-text extraction and document integrity review are pending.

### Source-readiness boundary

- The four official Telegram sources remain unchanged. The strict official-source gate still requires actual post content from all four; independent catalogues do not turn that gate green.
- Academia is blocked by HTTP 403; TG.ME is metadata-only; Telemetr is cross-reference only.
- No independent archive content has been admitted to rule extraction or training.
- L2 eligibility is not rule validation or approval; L1 remains the final owner-approval gate.
- All Preview diagnostics are fetch-only: no AI invocation, KV/D1 write, training run, approval, Cron change, active deployment, or Production change.
