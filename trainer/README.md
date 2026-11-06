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
