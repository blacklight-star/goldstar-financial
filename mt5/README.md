# Goldstar local MT5 bridge — DEMO/read-only

This Expert Advisor sends a periodic snapshot from a locally running MetaTrader 5 Desktop terminal to the isolated Cloudflare research Worker. It does not execute orders.

## Operating model

- No VPS, inbound port, public IP, APK, or Cloudflare Tunnel is required.
- MT5 Desktop runs on the user's own Windows Surface. The PC and MT5 must remain powered on and connected for continuous updates.
- The EA makes outbound HTTPS WebRequest calls every 60 seconds to the Cloudflare Worker.
- The EA refuses to initialize unless the MT5 account mode is DEMO.
- Only account metrics, open positions, and Market Watch bid/ask/last ticks are sent.
- The Worker stores the snapshot in the isolated goldstar_market_research_staging D1 database.
- No order placement, modification, cancellation, or account-control endpoint exists.

## Install on Windows MT5

1. Copy GoldstarLocalBridgeEA.mq5 into the terminal's MQL5/Experts/ directory.
2. Open MetaEditor from MT5, open the file, and compile it. Confirm there are no compile errors.
3. In MT5, open Tools → Options → Expert Advisors and enable Allow WebRequest for listed URL.
4. Add exactly: https://mt5-readonly-v5-trading-research-agent-staging.goldstar-nsl83.workers.dev
5. Attach GoldstarLocalBridgeEA to one chart on the AMarkets DEMO account.
6. In EA Inputs, paste the separately issued MT5_BRIDGE_KEY into BridgeKey; keep the 60-second interval.
7. Confirm the Experts tab reports “demo snapshot accepted”.

## Credential handling

- MT5_BRIDGE_KEY is a dedicated ingestion token, not an AMarkets password or MQL5 API key.
- It is stored as a Cloudflare Worker secret and entered only in the EA Inputs on the user's PC.
- Never place the key in the source file, Git, or a TradingView alert.
