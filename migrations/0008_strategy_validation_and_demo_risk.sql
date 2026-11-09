-- Staging-only strategy validation and fail-closed demo risk policy. Apply to goldstar_market_research_staging only.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS gs_strategy_hypotheses (
 hypothesis_id TEXT PRIMARY KEY, methodology TEXT NOT NULL, source_candidate_id TEXT, source_document_sha256 TEXT, statement TEXT NOT NULL, instrument_class TEXT NOT NULL, symbols_json TEXT NOT NULL, timeframe TEXT NOT NULL, session_scope TEXT, direction_scope TEXT, entry_rule_version TEXT NOT NULL, exit_rule_version TEXT NOT NULL, stop_rule_version TEXT NOT NULL, parameter_set_json TEXT NOT NULL, invalidation_conditions_json TEXT NOT NULL, trial_family_id TEXT NOT NULL, preregistered_at TEXT NOT NULL, owner_review_status TEXT NOT NULL, validation_status TEXT NOT NULL, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gs_strategy_backtest_protocols (
 protocol_id TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL, scope TEXT NOT NULL, methodology TEXT NOT NULL, validation_framework_json TEXT NOT NULL, data_quality_requirements_json TEXT NOT NULL, execution_cost_requirements_json TEXT NOT NULL, metrics_requirements_json TEXT NOT NULL, acceptance_gates_json TEXT NOT NULL, prohibitions_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(protocol_id,version)
);
CREATE TABLE IF NOT EXISTS gs_strategy_data_manifests (
 dataset_id TEXT PRIMARY KEY, provider TEXT NOT NULL, source_instrument TEXT NOT NULL, instrument_class TEXT NOT NULL, symbols_json TEXT NOT NULL, timeframe TEXT NOT NULL, start_utc TEXT, end_utc TEXT, row_count INTEGER NOT NULL DEFAULT 0, source_file_sha256 TEXT, raw_payload_sha256 TEXT, schema_version TEXT NOT NULL, timestamp_timezone TEXT NOT NULL, duplicate_count INTEGER, missing_bar_count INTEGER, invalid_ohlc_count INTEGER, corporate_action_policy TEXT, contract_spec_version TEXT, spread_source TEXT, commission_source TEXT, swap_or_funding_source TEXT, slippage_model TEXT, quality_status TEXT NOT NULL, eligibility_status TEXT NOT NULL, rejection_reasons_json TEXT NOT NULL, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gs_strategy_backtest_runs (
 run_id TEXT PRIMARY KEY, protocol_id TEXT NOT NULL, protocol_version INTEGER NOT NULL, hypothesis_id TEXT NOT NULL, dataset_id TEXT NOT NULL, code_commit_sha TEXT NOT NULL, config_sha256 TEXT NOT NULL, trial_family_id TEXT NOT NULL, split_plan_json TEXT NOT NULL, in_sample_start_utc TEXT, in_sample_end_utc TEXT, validation_start_utc TEXT, validation_end_utc TEXT, out_sample_start_utc TEXT, out_sample_end_utc TEXT, execution_cost_config_json TEXT NOT NULL, run_status TEXT NOT NULL, rejection_reason TEXT, started_at TEXT, completed_at TEXT, metadata_json TEXT NOT NULL, FOREIGN KEY(protocol_id,protocol_version) REFERENCES gs_strategy_backtest_protocols(protocol_id,version), FOREIGN KEY(hypothesis_id) REFERENCES gs_strategy_hypotheses(hypothesis_id), FOREIGN KEY(dataset_id) REFERENCES gs_strategy_data_manifests(dataset_id)
);
CREATE TABLE IF NOT EXISTS gs_strategy_backtest_metrics (
 run_id TEXT NOT NULL, metric_code TEXT NOT NULL, metric_value REAL, metric_unit TEXT NOT NULL, sample_count INTEGER, confidence_interval_json TEXT, scope TEXT NOT NULL, metadata_json TEXT NOT NULL, PRIMARY KEY(run_id,metric_code,scope), FOREIGN KEY(run_id) REFERENCES gs_strategy_backtest_runs(run_id)
);
CREATE TABLE IF NOT EXISTS gs_strategy_trial_log (
 trial_id TEXT PRIMARY KEY, trial_family_id TEXT NOT NULL, hypothesis_id TEXT NOT NULL, parameter_set_json TEXT NOT NULL, selection_metric TEXT, in_sample_result REAL, validation_result REAL, out_sample_result REAL, trial_status TEXT NOT NULL, recorded_at TEXT NOT NULL, FOREIGN KEY(hypothesis_id) REFERENCES gs_strategy_hypotheses(hypothesis_id)
);
CREATE TABLE IF NOT EXISTS gs_risk_policy_versions (
 policy_id TEXT NOT NULL, version INTEGER NOT NULL, environment TEXT NOT NULL, account_currency TEXT NOT NULL, starting_equity REAL NOT NULL, max_drawdown_pct REAL NOT NULL, risk_per_trade_pct REAL, daily_loss_limit_pct REAL, max_total_open_risk_pct REAL, max_correlated_exposure_pct REAL, max_positions INTEGER, high_water_mark_method TEXT NOT NULL, lot_sizing_method TEXT NOT NULL, required_broker_fields_json TEXT NOT NULL, kill_switch_action TEXT NOT NULL, order_execution_enabled INTEGER NOT NULL DEFAULT 0, live_trading_enabled INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, owner_approval_ref TEXT, effective_from TEXT, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(policy_id,version)
);
CREATE TABLE IF NOT EXISTS gs_risk_gate_checks (
 check_id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, policy_version INTEGER NOT NULL, environment TEXT NOT NULL, symbol TEXT, side TEXT, requested_volume REAL, entry_price REAL, stop_loss REAL, tick_size REAL, tick_value_loss REAL, volume_min REAL, volume_max REAL, volume_step REAL, commission_per_lot REAL, spread_cost_per_lot REAL, slippage_cost_per_lot REAL, currency_conversion_rate REAL, current_equity REAL, high_water_mark REAL, computed_risk_amount REAL, computed_volume REAL, decision TEXT NOT NULL, rejection_reasons_json TEXT NOT NULL, test_fixture_id TEXT, created_at TEXT NOT NULL, FOREIGN KEY(policy_id,policy_version) REFERENCES gs_risk_policy_versions(policy_id,version)
);
CREATE INDEX IF NOT EXISTS idx_strategy_runs_hypothesis ON gs_strategy_backtest_runs(hypothesis_id,run_status);
CREATE INDEX IF NOT EXISTS idx_strategy_runs_dataset ON gs_strategy_backtest_runs(dataset_id,run_status);
CREATE INDEX IF NOT EXISTS idx_strategy_trials_family ON gs_strategy_trial_log(trial_family_id,recorded_at);
CREATE INDEX IF NOT EXISTS idx_risk_checks_policy ON gs_risk_gate_checks(policy_id,policy_version,created_at);
INSERT OR IGNORE INTO gs_strategy_backtest_protocols VALUES (
 'GS-BT-STD',1,'GOLDSTAR Financial Strategy Validation Standard',
 'NDS-first Forex and Crypto research; ICT/RTM out of scope until NDS mastery gate',
 'Pre-register hypotheses; version data/code/config; chronological walk-forward; locked final OOS holdout; purging/embargo for overlapping labels; CSCV/PBO and Deflated Sharpe Ratio when selecting among multiple trials.',
 '{"chronological":true,"shuffle":false,"walk_forward":"expanding_or_rolling_pre_registered","final_holdout":"locked_until_parameters_frozen","purge":"remove training labels overlapping test label intervals","embargo":"predeclare where label horizon or residual dependence requires","random_kfold_prohibited":true,"multiple_testing":{"trial_log_required":true,"methods":["CSCV/PBO","Deflated Sharpe Ratio"]},"markets_tested_separately":["FOREX","CRYPTO"],"timeframes":["M15","M30","H1","D1"]}',
 '{"timezone":"UTC","checks":["provenance","symbol mapping","duplicates","missing bars","OHLC consistency","stale quotes","timezone/DST","rollovers/corporate actions","survivorship","contract specs"],"dataset_hash_required":true,"incomplete_data":"fail_closed"}',
 '{"required":["spread","commission","swap/rollover","crypto funding/fees","slippage","currency conversion","contract/tick/lot constraints"],"zero_cost_backtest_prohibited":true,"sensitivity_analysis_required":true}',
 '{"returns":["net_return","annualized_return_if_valid","volatility","sharpe","sortino","maximum_drawdown","drawdown_duration","calmar"],"trade":["trade_count","win_rate","average_win_loss","expectancy","profit_factor","average_holding_time"],"execution":["turnover","exposure","spread_paid","commission_paid","slippage_paid","swap_or_funding_paid"],"robustness":["per_fold_results","regime_slices","parameter_sensitivity","confidence_intervals","PBO_when_applicable","DSR_when_applicable"],"gross_and_net":true}',
 '{"gates":["source-linked rule","deterministic rule","independent review","eligible dataset","data quality pass","pre-registration","chronological split","leakage audit","complete cost model","baseline","all OOS folds","robustness","risk gate"],"release":"research_only_until_owner_approval"}',
 '["no look-ahead","no future candles","no random shuffling","no tuning final holdout","no omission of failed trials","no edge claim from one profitable sample","no backtest on one quote snapshot","no production promotion"]',
 'draft_staging','2026-11-09T15:04:00Z','2026-11-09T15:04:00Z'
);
INSERT OR IGNORE INTO gs_risk_policy_versions VALUES (
 'GS-RISK-DEMO',1,'DEMO_ONLY','USD',1000,5,NULL,NULL,NULL,NULL,NULL,
 'Peak equity since policy start; drawdown=(high_water_mark-current_equity)/high_water_mark*100.',
 'Floor-to-volume-step sizing from risk budget divided by stop ticks times loss tick value plus round-trip costs, converted to account currency; missing broker fields fail closed.',
 '["tick_size","tick_value_loss","volume_min","volume_max","volume_step","stop_loss","entry_price","round_trip_commission","round_trip_spread","round_trip_slippage","currency_conversion","contract_spec_version"]',
 'At drawdown >=5%, block new orders and alert owner; do not auto-close open positions.',
 0,0,'draft_staging_owner_review_required',NULL,NULL,
 '{"basis":"Owner-provided demo context: USD1000 and max drawdown 5%. Per-trade, daily-loss, aggregate-open-risk, correlated-exposure and max-position limits are unset; sizing fails closed.","no_trading_authorized":true,"source_lot_examples_not_reused":true}',
 '2026-11-09T15:04:00Z'
);
INSERT OR IGNORE INTO gs_strategy_data_manifests (
 dataset_id,provider,source_instrument,instrument_class,symbols_json,timeframe,start_utc,end_utc,row_count,schema_version,timestamp_timezone,duplicate_count,corporate_action_policy,quality_status,eligibility_status,rejection_reasons_json,metadata_json,created_at
) VALUES (
 'CMC-BTC-ONE-SNAPSHOT-20261108','CoinMarketCap','BTC/USD single quote snapshot','CRYPTO','["BTC"]','single_snapshot',
 '2026-11-08T20:37:04.000Z','2026-11-08T20:37:04.000Z',1,'cmc_quotes_v1','UTC',0,'not_applicable_to_single_snapshot',
 'snapshot_only_not_historical_OHLC','rejected_for_backtesting',
 '["Only one quote; no historical OHLC","No timeframe series","No spread/commission/slippage model","Cannot test entry/exit or drawdown"]',
 '{"ingestion_run":"preview-once-btc-usd-20261109-v10","provider_http_status":200,"quote_price":75765.75123612788,"quote_currency":"USD","quote_last_updated":"2026-11-08T20:37:04.000Z","ingested_at":"2026-11-08T20:38:10.690Z"}',
 '2026-11-09T15:04:00Z'
);
