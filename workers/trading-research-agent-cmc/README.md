# CMC ingestion Worker — production data isolation

## Service

Cloudflare Worker name: `trading-research-agent`

Source: `workers/trading-research-agent-cmc/src/worker.js`

Production configuration: `wrangler.cmc.production.toml`

Production D1:
- Database: `goldstar_market_research_prod`
- Database ID: `7703d149-e28e-4105-87a3-1f86e86b962a`
- Jurisdiction: EU

Bindings:
- `MARKET_DB`: dedicated production market-data D1
- `CMC_API_KEY`: existing encrypted secret; never commit or print
- `INGEST_AUTH_TOKEN`: existing encrypted secret; never commit or print

The Worker exposes public `GET /health` and authenticated `POST /cmc/quotes`.
The bearer token is accepted only in the Authorization header. No query-string credentials are accepted. Quotes and their successful ingestion audit row are committed in one D1 batch.

## Isolation repair and current rollout state

Cloudflare's active production deployment before this repair was version 8. Its D1 binding pointed at `goldstar_nds_staging`, which also contains the NDS source corpus. That D1 had six NDS source documents, 202 extracted page chunks, and 16 rule candidates. Its CMC quote and CMC ingestion-run tables were both empty at the time of inspection; no CMC rows were found in the NDS database.

A dedicated EU production market-data D1 was created with separate `tv_events`, `gs_market_events`, `cmc_quotes`, and `cmc_ingestion_runs` tables and supporting indexes. No staging or NDS rows were copied into it.

Cloudflare preview version 12 was then created against the dedicated production D1. It retains the existing `secret_text` bindings by type without reading or exposing their values. The unauthenticated CMC endpoint returned HTTP 401 in GitHub Actions, the retired public one-shot endpoint returned HTTP 404, and the preview health check confirmed both secret bindings and the new D1 binding exist.

**Version 11 remains Preview-only. Version 8 remains the 100% Production deployment.** The new code removes a public one-shot validation route and changes the CMC Worker source from the older version. Before promoting it, compare all routes and behavior from active version 8 against version 12 to confirm that any previously supported TradingView discovery or other compatibility routes are deliberately preserved or retired. Do not deploy merely because the preview health check passes.

A separate version 11 Preview of `tv-ingest` was also created against the same dedicated production market D1. Its existing `TV_WEBHOOK_SECRET` binding is preserved, and invalid webhook tokens are rejected before any D1 write. The active `tv-ingest` version 8 remains on its original `tradingview_events` database until the preview checks pass and an intentional promotion is approved.

## Deployment gates

1. Confirm route parity and backward compatibility with the active version.
2. Confirm the existing CMC and ingest credentials still validate without exposing either secret.
3. Run one authenticated, owner-authorized BTC/USD quote ingestion against the preview and verify one quote plus one successful audit record in the dedicated production D1.
4. Only then promote version 12 to 100% Production.
5. Verify the active deployment references the dedicated production D1 and that NDS/staging row counts remain unchanged.

Do not enable trade execution, change risk-policy approvals, or submit orders as part of CMC data-ingestion deployment.
