import test from "node:test";
import assert from "node:assert/strict";
import { simulateRiskGate } from "../src/risk.js";

function policy(overrides = {}) {
  return {
    environment: "DEMO_ONLY",
    account_currency: "USD",
    starting_equity: 1000,
    max_drawdown_pct: 5,
    risk_per_trade_pct: 1,
    daily_loss_limit_pct: 2,
    max_total_open_risk_pct: 3,
    max_correlated_exposure_pct: 4,
    max_positions: 3,
    order_execution_enabled: 0,
    live_trading_enabled: 0,
    ...overrides
  };
}

function validInput(overrides = {}) {
  return {
    side: "BUY",
    entryPrice: 1.1000,
    stopLoss: 1.0950,
    currentEquity: 10000,
    highWaterMark: 10000,
    currentDailyLossPct: 0,
    currentOpenRiskPct: 0,
    currentCorrelatedExposurePct: 0,
    currentOpenPositions: 0,
    tickSize: 0.0001,
    tickValueLoss: 10,
    volumeMin: 0.01,
    volumeMax: 100,
    volumeStep: 0.01,
    commissionPerLot: 2,
    spreadCostPerLot: 1,
    slippageCostPerLot: 1,
    currencyConversionRate: 1,
    ...overrides
  };
}

test("risk simulation estimates lot size from broker tick values and rounds down to volume step", () => {
  const result = simulateRiskGate(policy(), validInput());
  assert.equal(result.ok, true);
  assert.equal(result.decision, "simulation_only_not_executable");
  assert.equal(result.orderSubmitted, false);
  assert.equal(result.executionEligible, false);
  assert.equal(result.riskBudget, 100);
  assert.ok(Math.abs(result.lossPerLot - 504) < 1e-8);
  assert.equal(result.calculatedVolume, 0.19);
  assert.ok(result.estimatedRisk <= result.riskBudget);
});

test("5 percent maximum drawdown halts new orders at the threshold", () => {
  const result = simulateRiskGate(policy(), validInput({
    currentEquity: 9500,
    highWaterMark: 10000
  }));
  assert.equal(result.ok, false);
  assert.equal(result.riskHalt, true);
  assert.equal(result.decision, "reject");
  assert.ok(result.reasons.includes("maximum_drawdown_reached"));
  assert.equal(result.action, "block_new_orders_and_alert_owner");
});

test("missing per-trade risk limit fails closed", () => {
  const result = simulateRiskGate(policy({ risk_per_trade_pct: null }), validInput());
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("risk_per_trade_limit_not_configured"));
});

test("missing daily, aggregate, correlation or position limits fail closed", () => {
  for (const override of [
    { daily_loss_limit_pct: null },
    { max_total_open_risk_pct: null },
    { max_correlated_exposure_pct: null },
    { max_positions: null }
  ]) {
    const result = simulateRiskGate(policy(override), validInput());
    assert.equal(result.ok, false);
  }
});

test("missing stop-loss and a stop on the wrong side are rejected", () => {
  assert.ok(simulateRiskGate(policy(), validInput({ stopLoss: null })).reasons.includes("valid_side_entry_and_stop_required"));
  assert.ok(simulateRiskGate(policy(), validInput({ side: "BUY", stopLoss: 1.1010 })).reasons.includes("stop_loss_is_on_wrong_side_of_entry"));
  assert.ok(simulateRiskGate(policy(), validInput({ side: "SELL", stopLoss: 1.0990 })).reasons.includes("stop_loss_is_on_wrong_side_of_entry"));
});

test("incomplete broker specification and zero-cost assumptions are rejected", () => {
  assert.ok(simulateRiskGate(policy(), validInput({ tickValueLoss: null })).reasons.includes("complete_broker_contract_and_cost_fields_required"));
  assert.ok(simulateRiskGate(policy(), validInput({ volumeStep: 0 })).reasons.includes("complete_broker_contract_and_cost_fields_required"));
  assert.ok(simulateRiskGate(policy(), validInput({ currencyConversionRate: null })).reasons.includes("complete_broker_contract_and_cost_fields_required"));
});

test("aggregate limits and maximum position count are enforced", () => {
  assert.ok(simulateRiskGate(policy(), validInput({ currentDailyLossPct: 2 })).reasons.includes("daily_loss_limit_reached"));
  assert.ok(simulateRiskGate(policy(), validInput({ currentOpenRiskPct: 3 })).reasons.includes("aggregate_open_risk_limit_reached"));
  assert.ok(simulateRiskGate(policy(), validInput({ currentCorrelatedExposurePct: 4 })).reasons.includes("correlated_exposure_limit_reached"));
  assert.ok(simulateRiskGate(policy(), validInput({ currentOpenPositions: 3 })).reasons.includes("maximum_open_positions_reached"));
});

test("volume below broker minimum is rejected and volume above maximum is capped", () => {
  const belowMin = simulateRiskGate(policy(), validInput({
    risk_per_trade_pct: 0.01,
    entryPrice: 1.1000,
    stopLoss: 1.0000,
    volumeMin: 0.1,
    volumeStep: 0.1
  }));
  assert.equal(belowMin.ok, false);
  assert.ok(belowMin.reasons.includes("calculated_volume_below_broker_minimum"));

  const capped = simulateRiskGate(policy(), validInput({
    tickValueLoss: 1,
    volumeMax: 0.05,
    volumeStep: 0.01
  }));
  assert.equal(capped.ok, true);
  assert.equal(capped.calculatedVolume, 0.05);
  assert.equal(capped.volumeClippedToBrokerMaximum, true);
  assert.ok(capped.estimatedRisk <= capped.riskBudget);
});

test("non-demo environment and enabled live trading are rejected", () => {
  assert.ok(simulateRiskGate(policy({ environment: "LIVE" }), validInput()).reasons.includes("demo_environment_required"));
  assert.ok(simulateRiskGate(policy({ live_trading_enabled: 1 }), validInput()).reasons.includes("live_trading_forbidden"));
  assert.ok(simulateRiskGate(policy({ order_execution_enabled: 1 }), validInput()).reasons.includes("order_execution_disabled"));
});

test("risk simulation never submits, changes, or closes an order", () => {
  const result = simulateRiskGate(policy(), validInput());
  assert.equal(result.orderSubmitted, false);
  assert.equal(result.executionEligible, false);
});
