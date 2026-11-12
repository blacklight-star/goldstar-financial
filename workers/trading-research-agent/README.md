# Goldstar Trading Research Agent — Staging

This source mirror was recovered from Cloudflare's isolated `trading-research-agent-staging` Candidate V3.

## Authentication separation

- `MQL5_MARKETDATA_API_KEY` is the upstream credential used only by this Worker when calling `https://www.metatrader.com/mcp`.
- `MQL5_GATEWAY_API_KEY` is a separate client-to-Worker credential used by `/mql5/tools` and `/mql5/call`.
- Never reuse the upstream MQL5 credential as the client gateway key.
- Both secrets must be configured in the staging Worker before MQL5 routes are enabled.

## Scope

- Only `marketdata_*` tools are exposed.
- The Worker is read-only; it does not expose order placement, account trading, or MT5 terminal control.
- CMC ingestion remains a separate authenticated route.
- D1 binding points only to `goldstar_market_research_staging`.
- Candidate versions must remain preview-only until the upstream MCP protocol and read-only tools pass live integration tests.

## Local tests

Run `npm test` from the repository root.
