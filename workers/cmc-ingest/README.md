# Goldstar CMC Ingestion — Staging candidate

This Worker is a dedicated CMC-to-market-research D1 ingestion service. It is kept separate from the NDS knowledge database and from the MQL5/MT5 gateway.

## Contract

- Public read-only health: `GET /health`.
- Authenticated ingest: `POST /cmc/quotes`.
- Authentication: `Authorization: Bearer <INGEST_AUTH_TOKEN>`.
- Provider credential: Cloudflare Worker Secret `CMC_API_KEY`.
- D1 binding: `MARKET_DB` → `goldstar_market_research_staging`.
- Request body: `{"symbols":["BTC","ETH"],"convert":"USD"}`; 1–20 unique ticker symbols.
- Provider quotes and successful ingestion audit status are committed in one D1 batch.
- Provider/storage errors are returned as failure and recorded in `cmc_ingestion_runs` when possible.

## Release boundary

- The Worker source, tests and Wrangler staging configuration are source-control artifacts only.
- No Worker version is uploaded or deployed by this change.
- No Secret is created, read, rotated or modified.
- No D1 migration or data write is performed by CI.
- Before an owner enables the Staging Worker, the two required secrets must be configured in Cloudflare. Their values must never be put in Git, chat, logs, or D1.
- No Cron is configured. Ingestion is manual/on-demand until a separate operating policy is approved.

## Current Preview instantiation

- The current Preview Candidate V9 is uploaded to the existing `trading-research-agent` Worker as a version-only Preview so its existing CMC provider and ingest secrets can be inherited without reading or rotating them.
- V9 binds `MARKET_DB` only to `goldstar_market_research_staging`; it does not inherit the old `DB` binding.
- Preview URL: `https://44b8705a-trading-research-agent.goldstar-nsl83.workers.dev`.
- `wrangler.cmc.staging.toml` describes the clean standalone Worker name for a future separated deployment. That new script has not been created or deployed. Do not run `wrangler deploy` with this config until a separate release is explicitly approved.
- The existing deployed `trading-research-agent` version remains unchanged. V9 is preview-only and the Worker has no Cron schedule.
