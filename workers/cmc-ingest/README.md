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
