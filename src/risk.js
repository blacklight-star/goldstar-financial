function numericValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finitePositive(value) {
  const number = numericValue(value);
  return number !== null && number > 0;
}

function finiteNonNegative(value) {
  const number = numericValue(value);
  return number !== null && number >= 0;
}

function decimalPlaces(value) {
  const [mantissa, exponentText] = String(value).toLowerCase().split("e");
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const dot = mantissa.indexOf(".");
  const fractionDigits = dot < 0 ? 0 : mantissa.length - dot - 1;
  return Math.max(0, Math.min(10, fractionDigits - exponent));
}

function volumeAtBrokerStep(rawVolume, volumeMin, volumeMax, volumeStep) {
  const precision = Math.max(
    decimalPlaces(volumeMin),
    decimalPlaces(volumeMax),
    decimalPlaces(volumeStep)
  );
  const scale = 10 ** precision;
  const minUnits = Math.round(volumeMin * scale);
  const maxUnits = Math.round(volumeMax * scale);
  const stepUnits = Math.round(volumeStep * scale);

  if (!Number.isSafeInteger(minUnits) || !Number.isSafeInteger(maxUnits) ||
      !Number.isSafeInteger(stepUnits) || stepUnits < 1 || maxUnits < minUnits) {
    return null;
  }

  // MT5 volume steps are increments from the broker's minimum volume,
  // not necessarily multiples from zero (e.g. min=0.10, step=0.20).
  const maxSteps = Math.floor((maxUnits - minUnits + 1e-9) / stepUnits);
  const maxValidUnits = minUnits + maxSteps * stepUnits;
  const rawUnits = Math.floor(rawVolume * scale + 1e-9);
  if (rawUnits < minUnits) return null;

  const cappedUnits = Math.min(rawUnits, maxValidUnits);
  const steps = Math.floor((cappedUnits - minUnits + 1e-9) / stepUnits);
  const volumeUnits = minUnits + steps * stepUnits;
  return Number((volumeUnits / scale).toFixed(precision));
}

/**
 * Pure, side-effect-free risk simulation.
 * It never submits, modifies, or closes an order.
 * Tick value and all three round-trip cost fields are expressed in profit
 * currency; currencyConversionRate converts the resulting loss to account
 * currency. Missing cost fields are rejected; explicit zero is allowed.
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

  if (!policy || !input || typeof input !== "object" || Array.isArray(input)) {
    return reject("invalid_policy_or_input");
  }
  if (policy.environment !== "DEMO_ONLY") return reject("demo_environment_required");

  // Missing/null execution switches must never be interpreted as disabled.
  const liveTradingEnabled = numericValue(policy.live_trading_enabled);
  const orderExecutionEnabled = numericValue(policy.order_execution_enabled);
  if (liveTradingEnabled !== 0) return reject("live_trading_forbidden");
  if (orderExecutionEnabled !== 0) return reject("order_execution_disabled");

  const startingEquity = numericValue(policy.starting_equity);
  const maxDrawdownPct = numericValue(policy.max_drawdown_pct);
  const riskPerTradePct = numericValue(policy.risk_per_trade_pct);
  const dailyLossLimitPct = numericValue(policy.daily_loss_limit_pct);
  const maxTotalOpenRiskPct = numericValue(policy.max_total_open_risk_pct);
  const maxCorrelatedExposurePct = numericValue(policy.max_correlated_exposure_pct);
  const maxPositions = numericValue(policy.max_positions);

  if (!finitePositive(startingEquity) || !finitePositive(maxDrawdownPct) ||
      maxDrawdownPct >= 100) {
    return reject("invalid_risk_policy");
  }

  const currentEquity = numericValue(input.currentEquity);
  const highWaterMark = numericValue(input.highWaterMark);
  if (!finitePositive(currentEquity) || !finitePositive(highWaterMark)) {
    return reject("current_equity_and_high_water_mark_required");
  }
  if (highWaterMark < currentEquity) {
    return reject("high_water_mark_below_current_equity");
  }

  const drawdownPct = (highWaterMark - currentEquity) / highWaterMark * 100;
  if (drawdownPct >= maxDrawdownPct) {
    return reject("maximum_drawdown_reached", {
      drawdownPct,
      maxDrawdownPct,
      riskHalt: true,
      action: "block_new_orders_and_alert_owner"
    });
  }

  if (!finitePositive(riskPerTradePct)) {
    return reject("risk_per_trade_limit_not_configured", { drawdownPct });
  }
  if (riskPerTradePct >= maxDrawdownPct) {
    return reject("risk_per_trade_must_be_below_max_drawdown", { drawdownPct });
  }
  if (!finitePositive(dailyLossLimitPct) || dailyLossLimitPct >= 100) {
    return reject("daily_loss_limit_not_configured", { drawdownPct });
  }
  if (!finitePositive(maxTotalOpenRiskPct) || maxTotalOpenRiskPct >= 100) {
    return reject("max_total_open_risk_not_configured", { drawdownPct });
  }
  if (!finitePositive(maxCorrelatedExposurePct) || maxCorrelatedExposurePct >= 100) {
    return reject("correlated_exposure_limit_not_configured", { drawdownPct });
  }
  if (maxPositions === null || !Number.isInteger(maxPositions) || maxPositions < 1) {
    return reject("maximum_positions_not_configured", { drawdownPct });
  }

  const policyStatus = String(policy.status || "").trim().toLowerCase();
  const ownerApprovalRef = String(policy.owner_approval_ref || "").trim();
  const effectiveFrom = Date.parse(String(policy.effective_from || ""));
  if (policyStatus !== "approved" || !ownerApprovalRef ||
      !Number.isFinite(effectiveFrom) || effectiveFrom > Date.now()) {
    return reject("risk_policy_not_owner_approved_or_effective", { drawdownPct });
  }

  const currentDailyLossPct = numericValue(input.currentDailyLossPct);
  const currentOpenRiskPct = numericValue(input.currentOpenRiskPct);
  const currentCorrelatedExposurePct = numericValue(input.currentCorrelatedExposurePct);
  const currentOpenPositions = numericValue(input.currentOpenPositions);
  if (!finiteNonNegative(currentDailyLossPct)) {
    return reject("current_daily_loss_required", { drawdownPct });
  }
  if (!finiteNonNegative(currentOpenRiskPct)) {
    return reject("current_open_risk_required", { drawdownPct });
  }
  if (!finiteNonNegative(currentCorrelatedExposurePct)) {
    return reject("current_correlated_exposure_required", { drawdownPct });
  }
  if (currentOpenPositions === null || !Number.isInteger(currentOpenPositions) ||
      currentOpenPositions < 0) {
    return reject("current_open_positions_required", { drawdownPct });
  }
  if (currentDailyLossPct >= dailyLossLimitPct) {
    return reject("daily_loss_limit_reached", { drawdownPct });
  }
  if (currentOpenRiskPct >= maxTotalOpenRiskPct) {
    return reject("aggregate_open_risk_limit_reached", { drawdownPct });
  }
  if (currentCorrelatedExposurePct >= maxCorrelatedExposurePct) {
    return reject("correlated_exposure_limit_reached", { drawdownPct });
  }
  if (currentOpenPositions >= maxPositions) {
    return reject("maximum_open_positions_reached", { drawdownPct });
  }

  const entry = numericValue(input.entryPrice);
  const stop = numericValue(input.stopLoss);
  const side = String(input.side || "").toUpperCase();
  if (!finitePositive(entry) || !finitePositive(stop) || !["BUY", "SELL"].includes(side)) {
    return reject("valid_side_entry_and_stop_required", { drawdownPct });
  }
  if ((side === "BUY" && stop >= entry) || (side === "SELL" && stop <= entry)) {
    return reject("stop_loss_is_on_wrong_side_of_entry", { drawdownPct });
  }

  const tickSize = numericValue(input.tickSize);
  const tickValueLoss = numericValue(input.tickValueLoss);
  const volumeMin = numericValue(input.volumeMin);
  const volumeMax = numericValue(input.volumeMax);
  const volumeStep = numericValue(input.volumeStep);
  const conversionRate = numericValue(input.currencyConversionRate);
  const costs = ["commissionPerLot", "spreadCostPerLot", "slippageCostPerLot"];
  const costValues = costs.map(key => numericValue(input[key]));

  if (![tickSize, tickValueLoss, volumeMin, volumeMax, volumeStep, conversionRate].every(
        value => value !== null && value > 0
      ) ||
      !costValues.every(value => value !== null && value >= 0) ||
      volumeMin > volumeMax) {
    return reject("complete_broker_contract_and_cost_fields_required", { drawdownPct });
  }

  const riskBudget = currentEquity * riskPerTradePct / 100;
  const stopTicks = Math.abs(entry - stop) / tickSize;
  const priceLossPerLot = stopTicks * tickValueLoss;
  const costsPerLot = costValues.reduce((sum, value) => sum + value, 0);
  const lossPerLot = (priceLossPerLot + costsPerLot) * conversionRate;
  if (!finitePositive(riskBudget) || !finitePositive(lossPerLot) || !Number.isFinite(stopTicks)) {
    return reject("risk_budget_or_loss_per_lot_is_invalid", { drawdownPct });
  }

  const rawVolume = riskBudget / lossPerLot;
  const volume = volumeAtBrokerStep(
    Math.min(rawVolume, volumeMax),
    volumeMin,
    volumeMax,
    volumeStep
  );
  if (volume === null || !finitePositive(volume) || volume < volumeMin || volume > volumeMax) {
    return reject("calculated_volume_below_broker_minimum", {
      drawdownPct, riskBudget, lossPerLot, rawVolume, volumeMin, volumeMax, volumeStep
    });
  }

  const estimatedRisk = volume * lossPerLot;
  if (!Number.isFinite(estimatedRisk) || estimatedRisk <= 0 ||
      estimatedRisk > riskBudget + 1e-8) {
    return reject("rounded_volume_exceeds_risk_budget", {
      drawdownPct, riskBudget, estimatedRisk, volume
    });
  }

  // Check the proposed position against remaining headroom, not only the
  // account's pre-trade exposure. The new position is conservatively added to
  // daily loss, aggregate open risk, and correlated exposure.
  const estimatedRiskPct = estimatedRisk / currentEquity * 100;
  const drawdownLossLimit = highWaterMark * maxDrawdownPct / 100;
  const drawdownLossUsed = highWaterMark - currentEquity;
  const remainingDrawdownBudget = Math.max(0, drawdownLossLimit - drawdownLossUsed);
  if (estimatedRisk > remainingDrawdownBudget + 1e-8) {
    return reject("risk_exceeds_remaining_drawdown_budget", {
      drawdownPct, estimatedRisk, estimatedRiskPct, remainingDrawdownBudget
    });
  }

  const projectedDailyLossPct = currentDailyLossPct + estimatedRiskPct;
  if (projectedDailyLossPct > dailyLossLimitPct + 1e-8) {
    return reject("proposed_trade_would_exceed_daily_loss_limit", {
      drawdownPct, estimatedRiskPct, projectedDailyLossPct, dailyLossLimitPct
    });
  }

  const projectedOpenRiskPct = currentOpenRiskPct + estimatedRiskPct;
  if (projectedOpenRiskPct > maxTotalOpenRiskPct + 1e-8) {
    return reject("proposed_trade_would_exceed_aggregate_open_risk_limit", {
      drawdownPct, estimatedRiskPct, projectedOpenRiskPct, maxTotalOpenRiskPct
    });
  }

  const projectedCorrelatedExposurePct = currentCorrelatedExposurePct + estimatedRiskPct;
  if (projectedCorrelatedExposurePct > maxCorrelatedExposurePct + 1e-8) {
    return reject("proposed_trade_would_exceed_correlated_exposure_limit", {
      drawdownPct, estimatedRiskPct, projectedCorrelatedExposurePct, maxCorrelatedExposurePct
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
    estimatedRiskPct,
    remainingDrawdownBudget,
    projectedDailyLossPct,
    projectedOpenRiskPct,
    projectedCorrelatedExposurePct,
    volumeClippedToBrokerMaximum: rawVolume > volumeMax,
    reasons: ["simulation_only", "order_execution_disabled", "owner_approval_not_granted"]
  };
}
