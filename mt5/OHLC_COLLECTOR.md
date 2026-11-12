# Goldstar MT5 — incremental demo-only OHLC collector

## Purpose

`Goldstar_ReadOnly_OHLC_Collector.mq5` complements the one-shot account snapshot EA. It periodically reads **closed** candles from Market Watch and posts them to the staging `POST /mt5/history` endpoint. It has no trading or order-management functions.

- Timeframes: M5, M15, H1, H4 and D1.
- Symbols: the first 20 symbols in Market Watch.
- Initial catch-up: up to 30 closed bars per symbol/timeframe.
- Maximum payload: 20 × 5 × 30 = 3,000 bars, below the Worker limit of 4,000.
- Refresh interval: 300 seconds by default.
- The EA keeps an in-memory last-sent cursor per symbol/timeframe. It only sends newer closed bars after the first accepted batch. If a request fails, cursors are not advanced and the data is retried.
- The Worker uses `INSERT OR IGNORE` keyed by symbol/timeframe/bar time, so retries do not create duplicate bars.

## Destination and authentication

`https://26380461-trading-research-agent-staging.goldstar-nsl83.workers.dev/mt5/history`

The EA sends the staging `MT5_BRIDGE_KEY` only in the `X-Goldstar-MT5-Key` request header. Enter the key in EA Inputs; never commit it or paste it into chat, source code, screenshots or logs.

In MT5, add this exact host to **Tools → Options → Expert Advisors → Allow WebRequest for listed URL**:

`https://26380461-trading-research-agent-staging.goldstar-nsl83.workers.dev`

## Time normalization

MQL5 candle open times are broker-server clock values, not UTC. AMarkets documents GMT+3 between the last Sunday of October and the last Sunday of March, and GMT+2 during the rest of the year. The EA converts server time to UTC using that calendar rule. It skips the entire transition Sunday in March and October because the exact change hour is not stated in the public FAQ; it is safer to preserve a visible gap than to invent an offset for a bar.

Source: [AMarkets — What time is displayed in the trading platform?](https://www.amarkets.com/research-education/faq/trading/trading-platforms-metatrader-4-5/what-time-is-displayed-in-the-trading-platform/)

## Installation

1. Compile `Goldstar_ReadOnly_OHLC_Collector.mq5` in MetaEditor (F7).
2. In MT5, allow the staging URL above for WebRequest.
3. Attach the EA to one chart while connected to an AMarkets **Demo** account.
4. Set the staging `MT5_BRIDGE_KEY` in Inputs. Do not use a Real account.
5. Check the Experts tab for HTTP 202 messages showing accepted bars and series.
6. The EA runs on a five-minute timer; remove it from the chart to stop collection.

## Safety and limitations

- Every request is rejected locally unless the account is DEMO and the terminal is connected. The Worker independently enforces the same conditions.
- Only completed candles are exported; the currently forming candle is excluded.
- Invalid OHLC values, negative volume/spread and DST-transition-day candles are skipped.
- The initial bounded catch-up is not a substitute for a full historical export. Existing gaps remain gaps; this EA maintains recent data after it has been installed.
- No order-placement, modification, closing or live-trading API is called.
- This source has static CI contract tests but has **not** yet been compiled or run in the owner's local MetaEditor/MT5 terminal. A successful GitHub test does not replace that local compile and HTTP 202 acceptance check.
