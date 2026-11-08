# Goldstar MT5 — read-only Demo snapshot EA

## Purpose

\`Goldstar_ReadOnly_Snapshot.mq5\` sends exactly one snapshot when attached to an MT5 chart. It has no order-placement, modification, or close functions and sends data only when the account mode is DEMO and the terminal is connected.

## Destination

\`https://05931c07-trading-research-agent-staging.goldstar-nsl83.workers.dev/mt5/snapshot\`

This is the immutable Preview hostname for MQL5/MT5 Worker Candidate V5. The request is authenticated with the staging \`MT5_BRIDGE_KEY\` in the \`X-Goldstar-MT5-Key\` header.

## Data sent

- Demo account metadata: login, server, currency, leverage, balance, equity, margin, free margin, margin level, terminal connection status, trade permission flag, and terminal build.
- Up to 30 currently open positions.
- Up to 30 Market Watch symbol ticks.
- The Worker accepts only \`trade_mode=DEMO\` and \`terminal_connected=true\`, and writes snapshot/position/tick records to the isolated market-research D1 using one D1 batch.

## Owner-side setup

1. Compile the EA in MetaEditor (F7). Do not attach it to a Real account.
2. In MT5, open Tools → Options → Expert Advisors and add this exact allowed URL:
   \`https://05931c07-trading-research-agent-staging.goldstar-nsl83.workers.dev\`
3. Attach the EA to one chart while connected to a Demo account.
4. In EA Inputs, enter the staging \`MT5_BRIDGE_KEY\`. Never place the key in source code, screenshots, logs, Git, or chat.
5. The EA sends one snapshot only. Remove and re-attach it when a fresh snapshot is explicitly required.
6. Check the Experts tab for HTTP 202 and the returned snapshot ID. HTTP 401 means the key is wrong; 403 means the account is not DEMO/connected; WebRequest error 4014 usually means the URL is not allowlisted or the call is running outside an EA/script context.

## Safety

- Keep the MT5 account in Demo mode.
- Keep AutoTrading disabled; this EA contains no trading functions.
- Do not use the Strategy Tester for this request: MQL5 WebRequest is unavailable in Strategy Tester.
- No live account, orders, or trading actions are supported.
- The first successful HTTP 202 writes one real snapshot to \`goldstar_market_research_staging\`; obtain owner approval before performing that test.

## Verification status

- The EA source is checked into the repository and has a static safety-contract test.
- It has **not** yet been compiled by MetaEditor or run against a Demo terminal. Those two steps require the owner's local MT5 Desktop installation.
