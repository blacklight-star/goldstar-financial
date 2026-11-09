function finitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function roundDownToStep(value, step) {
  const precision = Math.max(0, Math.min(10, (String(step).split(".")[1] || "").length));
  const units = Math.floor((value + Number.EPSILON * Math.max(1, value)) / step);
  return Number((units * step).toFixed(precision));
}

/**
 * Pure, side-effect-free risk simulation.
 * It never submits, modifies, or closes an order.
 * Tick value and the total round-trip broker costs are expressed in profit currency;
 * currencyConversionRate converts that amount to the account currency.
 */
export function simulateRiskGate(policy, input) {
  const reject = (reason, extra = {}) => ({
    ok: false,
    decision: "reject",
    executionEligible: false,
    orderSubmitted: false,
    reasons: [reason],
    ...extra
  });

  if (!policy || !input || typeof input !== "object") return reject("invalid_policy_or_input");
  if (policy.environment !== "DEMO_ONLY") return reject("demo_environment_required");
  if (Number(policy.live_trading_enabled) !== 0) return reject("live_trading_forbidden");
  if (Number(policy.order_execution_enabled) !== 0) return reject("order_execution_disabled");
  if (!finitePositive(policy.starting_equity) || !finitePositive(policy.max_drawdown_pct)) {
    return reject("invalid_risk_policy");
  }

  const currentEquity = Number(input.currentEquity);
  const highWaterMark = Number(input.highWaterMark);
  if (!finitePositive(currentEquity) || !finitePositive(highWaterMark)) {
    return reject("current_equity_and_high_water_mark_required");
  }
  const drawdownPct = Math.max(0, (highWaterMark - currentEquity) / highWaterMark * 100);
  if (drawdownPct >= Number(policy.max_drawdown_pct)) {
    return reject("maximum_drawdown_reached", {
      drawdownPct,
      maxDrawdownPct: Number(policy.max_drawdown_pct),
      riskHalt: true,
      action: "block_new_orders_and_alert_owner"
    });
  }

  const riskPerTradePct = Number(policy.risk_per_trade_pct);
  if (!finitePositive(riskPerTradePct)) return reject("risk_per_trade_limit_not_configured", { drawdownPct });
  if (riskPerTradePct >= Number(policy.max_drawdown_pct)) return reject("risk_per_trade_must_be_below_max_drawdown", { drawdownPct });
  if (!finitePositive(policy.daily_loss_limit_pct)) return reject("daily_loss_limit_not_configured", { drawdownPct });
  if (!finitePositive(policy.max_total_open_risk_pct)) return reject("max_total_open_risk_not_configured", { drawdownPct });
  if (!finitePositive(policy.max_correlated_exposure_pct)) return reject("correlated_exposure_limit_not_configured", { drawdownPct });
  if (!Number.isInteger(Number(policy.max_positions)) || Number(policy.max_positions) < 1) {
    return reject("maximum_positions_not_configured", { drawdownPct });
  }
  if (!finitePositive(input.currentDailyLossPct) && Number(input.currentDailyLossPct) !== 0) {
    return reject("current_daily_loss_required", { drawdownPct });
  }
  if (!finitePositive(input.currentOpenRiskPct) && Number(input.currentOpenRiskPct) !== 0) {
    return reject("current_open_risk_required", { drawdownPct });
  }
  if (!finitePositive(input.currentCorrelatedExposurePct) && Number(input.currentCorrelatedExposurePct) !== 0) {
    return reject("current_correlated_exposure_required", { drawdownPct });
  }
  if (!Number.isInteger(Number(input.currentOpenPositions)) || Number(input.currentOpenPositions) < 0) {
    return reject("current_open_positions_required", { drawdownPct });
  }
  if (Number(input.currentDailyLossPct) >= Number(policy.daily_loss_limit_pct)) {
    return reject("daily_loss_limit_reached", { drawdownPct });
  }
  if (Number(input.currentOpenRiskPct) >= Number(policy.max_total_open_risk_pct)) {
    return reject("aggregate_open_risk_limit_reached", { drawdownPct });
  }
  if (Number(input.currentCorrelatedExposurePct) >= Number(policy.max_correlated_exposure_pct)) {
    return reject("correlated_exposure_limit_reached", { drawdownPct });
  }
  if (Number(input.currentOpenPositions) >= Number(policy.max_positions)) {
    return reject("maximum_open_positions_reached", { drawdownPct });
  }

  const entry = Number(input.entryPrice);
  const stop = Number(input.stopLoss);
  const side = String(input.side || "").toUpperCase();
  if (!finitePositive(entry) || !finitePositive(stop) || !["BUY", "SELL"].includes(side)) {
    return reject("valid_side_entry_and_stop_required", { drawdownPct });
  }
  if ((side === "BUY" && stop >= entry) || (side === "SELL" && stop <= entry)) {
    return reject("stop_loss_is_on_wrong_side_of_entry", { drawdownPct });
  }

  const tickSize = Number(input.tickSize);
  const tickValueLoss = Number(input.tickValueLoss);
  const volumeMin = Number(input.volumeMin);
  const volumeMax = Number(input.volumeMax);
  const volumeStep = Number(input.volumeStep);
  const conversionRate = Number(input.currencyConversionRate);
  const costs = ["commissionPerLot", "spreadCostPerLot", "slippageCostPerLot"];
  if (![tickSize, tickValueLoss, volumeMin, volumeMax, volumeStep, conversionRate].every(finitePositive) ||
      !costs.every(key => Number.isFinite(Number(input[key])) && Number(input[key]) >= 0) ||
      volumeMin > volumeMax || volumeStep > volumeMax) {
    return reject("complete_broker_contract_and_cost_fields_required", { drawdownPct });
  }

  const riskBudget = currentEquity * riskPerTradePct / 100;
  const stopTicks = Math.abs(entry - stop) / tickSize;
  const priceLossPerLot = stopTicks * tickValueLoss;
  const costsPerLot = Number(input.commissionPerLot) +
    Number(input.spreadCostPerLot) + Number(input.slippageCostPerLot);
  const lossPerLot = (priceLossPerLot + costsPerLot) * conversionRate;
  if (!finitePositive(riskBudget) || !finitePositive(lossPerLot)) {
    return reject("risk_budget_or_loss_per_lot_is_invalid", { drawdownPct });
  }

  const rawVolume = riskBudget / lossPerLot;
  const boundedVolume = Math.min(rawVolume, volumeMax);
  const volume = roundDownToStep(boundedVolume, volumeStep);
  if (!finitePositive(volume) || volume < volumeMin) {
    return reject("calculated_volume_below_broker_minimum", {
      drawdownPct, riskBudget, lossPerLot, rawVolume, volumeMin
    });
  }
  const estimatedRisk = volume * lossPerLot;
  if (estimatedRisk > riskBudget + 1e-8) {
    return reject("rounded_volume_exceeds_risk_budget", {
      drawdownPct, riskBudget, estimatedRisk, volume
    });
  }

  return {
    ok: true,
    decision: "simulation_only_not_executable",
    executionEligible: false,
    orderSubmitted: false,
    riskHalt: false,
    drawdownPct,
    riskBudget,
    stopTicks,
    lossPerLot,
    rawVolume,
    calculatedVolume: volume,
    estimatedRisk,
    volumeClippedToBrokerMaximum: rawVolume > volumeMax,
    reasons: ["simulation_only", "order_execution_disabled", "owner_approval_not_granted"]
  };
}
