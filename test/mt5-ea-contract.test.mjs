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
