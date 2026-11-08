# Goldstar Trainer — Staging source mirror

This folder contains a source-controlled mirror of the currently deployed `goldstar-trainer-staging` Worker, retrieved read-only from Cloudflare on 2026-11-06.

## Change in this branch

- Replaces the broad retrieval prefilter that treated generic ICT/SMC terms (Liquidity, Order Block, FVG, BOS, CHOCH, displacement, mitigation, entry, stop loss, etc.) as positive NDS signals.
- Requires an explicit NDS anchor or at least three NDS structural terms.
- Retains the 120-character minimum text threshold.
- Adds Node tests for English, Persian, short-title, generic ICT/SMC, and mixed-methodology examples.

## Authority and safety boundaries

- This classifier is only a **retrieval prefilter**. It does not validate a trading rule, establish source authority, or approve knowledge.
- Extracted rules must retain exact source-post evidence and remain pending for independent review.
- NDS remains the sole training methodology until the Technical Analysis Unit demonstrates full NDS mastery. ICT and other methodologies remain blocked until that gate is passed.
- This branch is source-control and test work only. It does not upload a Worker version, deploy, change Cron, mutate KV/D1, or change secrets.
- The current Staging Worker admin routes require `GOLDSTAR_BRIDGE_SECRET`; that binding was not present in the inspected Staging settings. This mirror does not add or alter secrets.

## Provenance

Baseline: Cloudflare Worker `goldstar-trainer-staging`, deployed version 9. No Production Worker source or Production data was changed.


## Preview route safety correction

- The unauthenticated `/__preview/dry-run` route is fetch-only. It can inspect public Telegram HTML but cannot invoke Workers AI or write KV, preventing anonymous AI-budget consumption.
- AI-backed extraction remains available only through the scheduled trainer path or authenticated admin route.


## Signed evidence requirement

- Each new pending trading-rule record must include a SHA-256 HMAC signature over its exact source-post identity, excerpt hash, full-post content hash, capture method, and verification flag.
- The secret `NDS_EVIDENCE_HMAC_KEY` must be configured on both this Trainer Worker and Financial L2. If it is missing, scheduled training fails closed before Telegram retrieval, AI inference, or candidate persistence.
- The same secret must never be exposed to clients or stored in KV/D1. Configure it as a Cloudflare Worker secret only.
