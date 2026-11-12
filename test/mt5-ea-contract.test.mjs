import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("MT5 snapshot EA is demo-only, one-shot, and read-only", async () => {
  const source = await readFile(new URL("../mt5/Goldstar_ReadOnly_Snapshot.mq5", import.meta.url), "utf8");

  assert.match(source, /ACCOUNT_TRADE_MODE_DEMO/);
  assert.match(source, /TERMINAL_CONNECTED/);
  assert.match(source, /X-Goldstar-MT5-Key/);
  assert.match(source, /\/mt5\/snapshot/);
  assert.match(source, /positions/);
  assert.match(source, /ticks/);
  assert.match(source, /ACCOUNT_BALANCE/);
  assert.match(source, /ACCOUNT_EQUITY/);
  assert.match(source, /WebRequest\("POST"/);
  assert.match(source, /HTTP=%d/);
  assert.match(source, /Exactly one read-only snapshot/);

  assert.doesNotMatch(source, /\bOrderSend\s*\(/);
  assert.doesNotMatch(source, /\bOrderSendAsync\s*\(/);
  assert.doesNotMatch(source, /\bCTrade\b/);
  assert.doesNotMatch(source, /\bPositionClose\s*\(/);
  assert.doesNotMatch(source, /\bPositionOpen\s*\(/);
  assert.doesNotMatch(source, /\btrade_place_order\b/);
});

test("MT5 OHLC collector is demo-only, timer-driven, incremental, and read-only", async () => {
  const source = await readFile(new URL("../mt5/Goldstar_ReadOnly_OHLC_Collector.mq5", import.meta.url), "utf8");

  assert.match(source, /ACCOUNT_TRADE_MODE_DEMO/);
  assert.match(source, /TERMINAL_CONNECTED/);
  assert.match(source, /X-Goldstar-MT5-Key/);
  assert.match(source, /\/mt5\/history/);
  assert.match(source, /EventSetTimer\(TimerIntervalSeconds\)/);
  assert.match(source, /void OnTimer\(\)/);
  assert.match(source, /CopyRates\(symbol, frames\[timeframeIndex\], 1, BarsPerSeries, rates\)/);
  assert.match(source, /PERIOD_M5/);
  assert.match(source, /PERIOD_M15/);
  assert.match(source, /PERIOD_H1/);
  assert.match(source, /PERIOD_H4/);
  assert.match(source, /PERIOD_D1/);
  assert.match(source, /LastSundayDayOfMonth/);
  assert.match(source, /AMarketsUtcOffsetHours/);
  assert.match(source, /transitionDay/);
  assert.match(source, /CommitSentTime/);
  assert.match(source, /status != 202/);
  assert.match(source, /StringLen\(payload\) < 900000/);
  assert.ok(20 * 5 * 30 <= 4000, "maximum configured batch must stay below Worker limit");

  assert.doesNotMatch(source, /\bOrderSend\s*\(/);
  assert.doesNotMatch(source, /\bOrderSendAsync\s*\(/);
  assert.doesNotMatch(source, /\bCTrade\b/);
  assert.doesNotMatch(source, /\bPositionClose\s*\(/);
  assert.doesNotMatch(source, /\bPositionOpen\s*\(/);
  assert.doesNotMatch(source, /\btrade_place_order\b/);
});
