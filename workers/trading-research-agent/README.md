# Goldstar Trading Research Agent

The Worker is the read-only market-data ingestion boundary for Goldstar's Level 2 financial-markets manager.

## Endpoints

- `GET /health` — reports configuration flags only; it does not expose secrets.
- `POST /mt5/snapshot` — accepts a bounded account/positions/Market Watch snapshot from a connected DEMO terminal.
- `POST /mt5/history` — accepts bounded OHLC bars for M5, M15, H1, H4 and D1.
- `POST /mql5/tools` and `POST /mql5/call` — proxy only upstream `marketdata_*` tools.
- `POST /cmc/quotes` — separate authenticated CoinMarketCap ingestion route.

There are no order placement, modification, cancellation, command-polling or terminal-control routes.

## Credential separation

- `MT5_BRIDGE_KEY` is the dedicated shared secret for local MT5 ingestion. The terminal sends it in `X-Goldstar-MT5-Key`.
- `MQL5_GATEWAY_API_KEY` authenticates clients calling the MQL5 gateway.
- `MQL5_MARKETDATA_API_KEY` is used only by this Worker when calling `https://www.metatrader.com/mcp`.
- `INGEST_AUTH_TOKEN` authenticates the CMC ingestion route.
- `CMC_API_KEY` authenticates this Worker to CoinMarketCap.

Never reuse broker, investor/read-only, MQL5 upstream, L2 API, or L1 bridge credentials as the MT5 ingestion key. Secret values belong only in the encrypted Cloudflare Worker secret fields and the local terminal's EA Inputs; never commit or paste them into source control or chat.

## Database isolation

- Staging Worker: `DB` points to `goldstar_market_research_staging`.
- Production Worker: `DB` points to `goldstar_market_research_prod`.
- Neither Worker should bind its research database to the NDS/training database.

Migration `0006_mt5_terminal_readonly_bridge.sql` creates account snapshots, positions and symbol ticks. Migration `0007_mt5_ohlc_history.sql` creates validated OHLC storage and its quarantine table. Both migrations are idempotent and must be applied to the corresponding research D1 before activating the relevant Worker.

## Local terminal operation

The user's currently installed read-only EA is already delivering demo snapshots to the canonical staging hostname. Keep its existing URL and Inputs unchanged while the Worker and L2 code are reviewed. Continuous collection requires the Windows PC and MT5 terminal to remain on and connected. A VPS, inbound port, public IP or Cloudflare Tunnel is not required.

The `/mt5/history` ingestion endpoint is available for a compatible read-only collector, but its presence does not prove that the currently installed EA is sending historical OHLC batches. Verify history freshness in D1 before treating it as a current data feed.

## Promotion gates

1. Pass repository CI and the isolated L2 Preview checks.
2. Provision the production `MT5_BRIDGE_KEY` as an encrypted Cloudflare secret using the same locally held value already configured in the EA; never disclose the value in chat.
3. Upload a Production Worker candidate retaining the current CMC/MQL5 secrets and Production D1 binding.
4. Verify a real demo snapshot and corresponding tick rows in `goldstar_market_research_prod`.
5. Verify L1-only L2 status/latest/history reads against Production D1.

No promotion, live trading, order execution or schedule activation is implied by passing unit tests.