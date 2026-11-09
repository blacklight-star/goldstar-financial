# GOLDSTAR Financial: backtest protocol and demo risk gate (staging)

This document describes the staging-only protocol and the fail-closed risk simulation implemented for PR #4. It is not an authorization to trade or deploy.

## Strategy validation

All strategy hypotheses must be registered before examining the final holdout. Each hypothesis records its source candidate, exact rule/version, instrument class and symbols, timeframe, direction, entry/exit/stop definitions, parameters, invalidation conditions and trial family. Every parameter or strategy trial is retained in the trial log, including failed variants.

Time-series evaluation is chronological. Use expanding or rolling walk-forward windows selected and recorded before a run. Do not randomly shuffle candles. Keep the final out-of-sample holdout locked until the rule and parameters are frozen. When label intervals overlap, purge training samples whose label intervals overlap the test period and predeclare an embargo where the label horizon or residual dependence requires it.

When many strategies or parameter sets are explored, report selection-bias measures, not only the best Sharpe:
- Combinatorially Symmetric Cross-Validation / Probability of Backtest Overfitting (CSCV/PBO): Bailey, Borwein, Lopez de Prado and Zhu, *The Probability of Backtest Overfitting* (2015), https://papers.ssrn.com/sol3/Papers.cfm?abstract_id=2326253
- Deflated Sharpe Ratio (DSR): Bailey and Lopez de Prado, *The Deflated Sharpe Ratio* (2014), DOI 10.3905/jpm.2014.40.5.094.

These tests complement, but do not replace, chronological out-of-sample and walk-forward evaluation. They do not create evidence where there is no sufficiently complete market dataset.

## Data gate

A dataset requires provider/source provenance, a symbol/instrument mapping, UTC timestamps, timeframe, date range, row count, stable SHA-256, duplicate/missing-bar diagnostics, OHLC consistency checks and a versioned execution-cost/contract specification. Forex and cryptocurrency datasets are evaluated separately. No historical dataset is presumed available merely because a provider returned a current quote.

The current CoinMarketCap BTC record is one quote snapshot only. It is explicitly marked `rejected_for_backtesting`: it has no OHLC history, no candle sequence and no execution-cost path. No NDS backtest may use it.

## Cost and performance reporting

At minimum, model spread, commission, slippage, FX swap/rollover or crypto funding/fees where applicable, currency conversion and broker contract/tick/lot constraints. Zero-cost backtests are prohibited. Show gross and net results, every out-of-sample fold, drawdown and duration, expectancy, profit factor, trade count, exposure, turnover and execution costs. Report confidence intervals or an appropriate resampling assessment where the data permits. Do not infer statistical significance from a small number of trades or one profitable period.

## Risk policy and sizing

The staged policy records only the owner-provided demo assumptions: USD 1,000 initial equity and 5% maximum drawdown. It does **not** invent a per-trade risk fraction, daily loss limit, aggregate-open-risk limit, correlated-exposure limit or maximum-position count. These remain NULL, so the sizing simulation must reject until all required controls are defined.

Drawdown is measured from the policy high-water mark. At or above 5%, new order submission is blocked and the owner is alerted. The code does not auto-close positions. This needs a separately reviewed safe-exit procedure before any future execution integration.

Sizing uses broker tick size, loss tick value, volume minimum/maximum/step, entry and stop, round-trip commission, spread and slippage, plus profit-currency-to-account-currency conversion. Monetary values supplied to the engine are in profit currency and converted once. Volume is rounded down to the broker step. Missing or inconsistent contract fields fail closed. The source's illustrative 0.4-lot example is not reused.

The `/risk/policy` and `/risk/simulate` endpoints are L1-bridge-only. Simulation is side-effect-free and can never submit, modify or close an order. The present policy keeps both `order_execution_enabled=0` and `live_trading_enabled=0`; even a successful calculation is explicitly non-executable.

## Current status

- Protocol: `GS-BT-STD` v1, `draft_staging`.
- Risk policy: `GS-RISK-DEMO` v1, `draft_staging_owner_review_required`.
- The market dataset registry contains one rejected BTC quote snapshot and no eligible historical OHLC datasets.
- Per-trade/daily/aggregate/correlation/position limits and AMarkets contract specifications remain unconfigured.
- Candidate Worker V37 is Preview-only. No Production deployment, Cron schedule, approval, live/demo order or automatic execution was enabled.
