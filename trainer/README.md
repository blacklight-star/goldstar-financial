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

- `/__preview/dry-run`, `/__preview/parser-selftest`, and `/__preview/source-diagnostics` are fetch-only diagnostics. They must never call Workers AI or write KV/D1. The scheduled path renews its D1 lease between external operations and journals grouped KV writes before applying them; a later run replays an interrupted journal idempotently. Deferred post records use bounded exponential retry backoff and are reconsidered when due or when source content changes. No transcript provider is currently configured, so video-only posts remain explicitly deferred rather than being treated as extracted text.
- Candidate V17 used `https://45c03d2b-goldstar-trainer-staging.goldstar-nsl83.workers.dev`. A live check confirmed V17 health responds, but its `/__preview/parser-selftest` route returns HTTP 404. Version V17 is immutable and cannot be patched in place. Candidate V21 is the current diagnostic Preview at `https://21339fb8-goldstar-trainer-staging.goldstar-nsl83.workers.dev`; it includes lease renewal, recoverable KV commit journaling, deferred-post retry backoff, and configured-source success semantics. CI checks V21 health, parser self-test, actual extraction from all four configured channels, separately reported diagnostic-only channels, and fetch-only Telegram dry-run. The V17-host unit test is a simulation of host-allowlist logic, not a live V17 test. Future immutable versions are accepted only when the hostname matches the exact eight-hex-prefix Trainer Staging pattern.
- Preview host allowlisting is explicit. Labels/aliases are not assumed to create DNS routes.
- The Staging Cron remains paused. There is no automatic training run.
- Authenticated admin execution requires the Staging-only `GOLDSTAR_BRIDGE_SECRET`. No secret values belong in Git, KV, D1, logs, or chat.

## Staging resources

- Staging D1: `goldstar_nds_staging`.
- Staging KV binding ID: `77b13f4018e3465ebd5e754482d3c5a2`.
- HMAC signing key binding: `NDS_EVIDENCE_HMAC_KEY`.
- This source branch changes code, tests, and documentation. Candidates V18 and V19 were uploaded as immutable Preview versions only; V19 was not deployed. No Cron was activated, no KV/D1 data was mutated, no secrets were changed, no rules were approved, and Production was not altered.
