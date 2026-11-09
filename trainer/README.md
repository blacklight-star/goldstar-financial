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
- [Trainer V26 source gate](https://github.com/blacklight-star/goldstar-financial/actions/runs/42533488887) — unit tests and health/parser/HMAC/TG.ME metadata checks passed; final strict configured-source gate remains red because three official Telegram archives are unavailable.
- [Financial L2 V35 CI](https://github.com/blacklight-star/goldstar-financial/actions/runs/42533340596) — 75/75 tests and all immutable Preview health checks passed.

No AI calls, KV/D1 writes, training, approvals, Cron changes, active deployments, or Production changes were performed. Trainer Staging Cron remains empty; Trainer Staging active deployment remains V9; L2 active deployment remains the pre-existing version. All new Worker versions are Preview-only.

## Live source-readiness result (2026-11-09)

Latest Preview validation after the Academia authority correction:
- Trainer V27 unit tests: **27/27 passed**.
- Financial L2 V36 unit tests: **75/75 passed**.
- Trainer V27 health and parser self-test passed.
- Cross-Worker HMAC parity passed between Trainer V27 and Financial L2 V36.
- Academia primary-source catalog check passed: five author-listed PDFs are classified as primary; no Academia request was made by the Worker.
- Six TG.ME individual post pages were checked for IDs/canonical links/captions. All six exposed zero video tags, source tags, or direct media URLs; they remain metadata-only.
- The strict configured Telegram-source gate remains red by design: NDS4ALLVIDEOS returned 20 posts; FuzzyLogic_NDS, BNJ1I, and cottagends returned zero parsed posts.

CI:
- [Trainer V27 source gate](https://github.com/blacklight-star/goldstar-financial/actions/runs/42534405204) — unit tests, health, parser, HMAC, Academia primary-source catalog, and TG.ME metadata checks passed; final official Telegram gate remains blocked.
- [Financial L2 V36 CI](https://github.com/blacklight-star/goldstar-financial/actions/runs/42534412570) — 75/75 tests and Preview health passed.

Preview and deployment boundary:
- Trainer V27 and L2 V36 are immutable Preview versions only.
- Trainer Staging active deployment remains V9; Trainer Staging schedule remains empty.
- L2 active deployment remains the previously deployed version; L2 schedule remains empty.
- Both PRs remain Draft and unmerged.
- No AI call, KV/D1 write, NDS training run, rule approval, Cron change, active deployment, or Production change was performed.

## NDS Source Authority & Acquisition Policy (2026-11-09)

### Priority 1 — Academia: primary author-published NDS source

Academia is the organization's **primary NDS knowledge source**, not a secondary independent archive.

Core primary documents:
- **NDS Strategy English Version** — Dr. Iraj Jafarian, document 129627974: https://www.academia.edu/129627974/NDS_Strategy_English_Version
- **NDS farsi** — Dr. Iraj Jafarian, document 129628090: https://www.academia.edu/129628090/NDS_farsi

The author's Academia profile lists both works under "Papers by Dr Iraj Jafarian"; the NDS Farsi description explicitly says NDS was designed by Dr Iraj Jafarian. Other author-listed documents are catalogued as primary-author supplements, with the AI/quantitative paper marked co-authored.

**Account entitlement:** Academia's current Help Center says an individual PDF can be downloaded at no cost with a free account; Premium is not required for a single-paper download. The owner already has a free account. Source: https://support.academia.edu/hc/en-us/articles/29325571934359-How-do-I-download-papers-for-free-on-Academia

**Acquisition boundary:** the current Academia Terms of Use prohibit scraping/crawling, bots, and automated access/download outside Academia-provided interfaces or ordinary browsers. Therefore the Trainer must not crawl Academia or replay hidden endpoints. Acquisition is user-initiated through the normal logged-in Academia interface, then the downloaded PDF is imported into the controlled Trainer pipeline. Source: https://www.academia.edu/terms (last updated May 20, 2026).

**Evidence chain for each imported PDF:**
1. Exact Academia document ID and canonical page URL.
2. File type `application/pdf`, page count, original-file SHA-256.
3. Text extracted from the downloaded PDF with page-level references.
4. Excerpt hash and extracted-text hash.
5. Trainer HMAC signature including origin type, capture method, PDF hash, and NDS rule content.
6. Independent L2 verification of the exact author-document allowlist and signature.

The source is primary by authorship/provenance; that does not by itself prove trading performance claims. Do not fine-tune model weights or redistribute source PDFs. Broader/commercial use requires the applicable author/platform permissions to be checked.

### Priority 2 — Official Telegram sources

The configured channels remain unchanged: NDS4ALLVIDEOS, FuzzyLogic_NDS, BNJ1I, and cottagends. Their strict public-post extraction gate remains separate from Academia acquisition.

### Priority 3 — Third-party archives

TG.ME provides indexed post identifiers and caption metadata for FuzzyLogic_NDS, but the sampled HTML did not expose lesson video/transcript content. Telemetr remains a historical cross-reference. These archives do not displace Academia or the original Telegram source and are not eligible for rule extraction on metadata alone.

### Current readiness

- Academia: **primary authority confirmed; manual first-party PDF acquisition/import path pending**. HTTP 403 from the unauthenticated Worker was an access-method limitation, not an authority finding.
- TG.ME: metadata index only; no video/media URLs found in six sampled posts.
- Telegram: NDS4ALLVIDEOS returned 20 posts; the other three configured channels returned zero parsed posts in the last strict run.
- No AI call, KV/D1 write, training, approval, Cron change, active deployment, or Production change was performed by the source-catalog correction.
- L1 remains the final approval authority; L2 verifies evidence; Trainer only extracts and signs candidate evidence.


## Staged first-party PDF intake (2026-11-09)

The owner-supplied PDF files were imported into the isolated `goldstar_nds_staging` D1 registry. This supersedes the earlier “manual PDF import pending” status above.

- Five documents matched the author-linked Academia catalog by document ID/title/author and were SHA-256 verified: English NDS Strategy (44 pages), NDS Farsi (125 pages), NDS New Approach (12 pages), Advanced Quantitative Trading (7 pages), and Advanced Money Management (6 pages).
- One additional 2019 Multifractal PDF was registered separately as owner-supplied with publication-platform provenance unverified; it is quarantined and is **not** attributed to Academia.
- Intake contains 202 page records: 190 text pages and 12 visual-only pages. The 12 visual-only pages were inspected as images; OCR was not run. Each text page has its own SHA-256 hash and page reference.
- Six source records, 23 technical/provenance review flags, 12 curriculum modules and 10 page-linked rule/risk candidates were registered. All chunks remain `not_rule_validated`. The 10 rule/risk candidates are `not_approved` and `execution_eligible=0`; none was signed, approved, promoted or written to Knowledge KV.
- The Farsi source's page 2 risk disclaimer, including its author-attributed warning about cryptocurrency volatility, is preserved for the Risk curriculum and must not be recast as independent statistical proof.
- The quantitative paper, money-management paper and 2019 multifractal supplement carry open reproducibility/formula flags. In particular, the 86% target expression and lot-sizing formula are not cleared for executable MT5 sizing.

The Trainer exposes authenticated, read-only staging endpoints: `GET /admin/source-documents`, `GET /admin/source-pages?sourceId=...&from=...&to=...` (maximum 10 pages per request), and `GET /admin/source-review-flags`. They require the staging `GOLDSTAR_BRIDGE_SECRET`, perform SELECTs only, and must never invoke AI, write KV/D1, approve rules, or promote source content. These routes are candidate code only until Preview CI/runtime tests pass; no active Worker deployment or Cron activation is implied.


### Curriculum and rule-candidate staging (2026-11-09)

- Twelve ordered NDS learning modules have been mapped to exact English/Farsi source pages, prerequisites, competency outcomes and assessment plans. The mapping follows the source's progression from terminology/Nodes and five pillars through cycles, Hooks, Rallies, Flags, Fractals, Symmetry, Sequencing, trading rules and risk/position sizing.
- Ten source-linked rule/risk candidates have been entered with full page text, document and page SHA-256 references, source origin and extraction method. Every candidate remains unapproved and non-executable (execution_eligible=0).
- Twenty-three review flags cover source conflicts, incomplete operational definitions, cryptocurrency risk caveat, stop/target units, node/pivot confirmation, 86.4% retracement anchors and position scaling risk.
- The author-published Farsi material contains a specific warning against cryptocurrency trading because of volatility. This remains attributed to the author and is not presented as independent statistical evidence.
- The English source contains conflicting wording/diagram context for Rule 2 on page 41, and differing timeframe examples across English/Farsi sections. These are blocked for clarification rather than silently normalized.
- No AI calls, Knowledge KV writes, approvals, automatic training, scheduled execution or Production deployment were performed by this intake/curriculum step.
