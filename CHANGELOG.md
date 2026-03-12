# Changelog

## Unreleased - 2026-03-11

### Added
- Offline trainer now exposes a concrete `retrainExecutionPlan` with cadence, selected scopes, probation scopes, rollback-watch scopes, and an operator action so retraining can be scheduled and reviewed instead of inferred from readiness alone.
- Replay chaos summaries now include a `deterministicReplayPlan` that selects the next replay pack from paper misses, near-miss blocked setups, and probe winners for faster operator review.
- The README now documents a concrete codebase roadmap focused on retrain governance, deterministic replay, operator visibility, and rollback-safe promotion.
- Offline trainer now exposes a compact `retrainFocusPlan` that highlights the strongest and weakest retrain scopes, counts ready/building/warmup scopes, and recommends the next retrain action instead of only reporting raw readiness scores.
- Retrain governance now ranks concrete retrain scopes by family and regime, so paper/live history can point to which parts of the dataset are actually mature enough for broader retraining.
- Offline trainer now exposes a dedicated `retrainReadiness` layer for paper and live, using trade counts, strategy/regime diversity, record quality, lineage coverage, source/context coverage, and recorder bootstrap state to decide how mature broader retraining really is.
- The data recorder now has a historical bootstrap loader that reads recent stored decisions, trades, learning, news, contexts, and curated datasets on startup to build a warm-start summary for runtime and paper/governance views.
- Data-recorder quality is now tracked per record kind, including `news` and `context_*`, so it is easier to see whether historical learning, replay, or source-history data is the weakest part of the stored dataset.
- Data-recorder summary now tracks compact `sourceCoverage` and `contextCoverage` aggregates, so runtime, dashboard, and dataset curation can show which news providers and event context types actually dominate the stored history.
- Recorder frames now carry a compact `recordQuality` score for decision, trade, learning, and replay records, so later training and review loops can filter by completeness/confidence instead of treating all records equally.
- `status`, `doctor`, and dashboard snapshots now expose a cleaner recorder summary with average/latest record quality, lineage coverage, and hot/cold retention context instead of raw recorder state blobs.
- Historical `context_history` recorder frames for Binance announcements and macro/calendar summaries, so replay and offline analysis can now reuse event context instead of only generic news history.
- Data-recorder schema v4 with explicit `news_history` and `dataset_curation` frames, so historical news, datasource lineage, and curated training views are now stored alongside decision and replay data.
- Hot/cold feature-store retention with automatic archive compaction, allowing recent recorder data to stay fast while older files move into an archive tier before deletion.
- Recorder-level dataset curation summaries for paper learning, veto review, exit learning, execution learning, regime learning, and historical news coverage.
- Decision, trade, learning, and replay frames now persist richer datasource-lineage context including data quality, confidence breakdown, feature completeness, and fallback/degraded source state.
- A concrete data-storage roadmap in the README covering feature-store layers, lineage, historical news, dataset curation, retention, and replay-grade storage.
- Paper-learning summaries now expose `paper-to-live readiness` and a compact `counterfactual tuning` view, so the strongest paper scope and the current blocker/tuning direction are visible in runtime and dashboard output.
- Paper learning now exposes blocker groups (`safety`, `governance`, `learning`, `market`) plus per-scope readiness across strategy families, regimes, and sessions.
- A paper-only threshold sandbox now applies small, bounded scope-level threshold shifts in paper based on recent closed paper outcomes instead of changing the main policy globally.
- The dashboard paper-learning card now shows strongest paper scope, active threshold sandbox context, and automatic review-pack hints.
- A dedicated paper-mode roadmap v2 in the README covering experiment lanes, sandboxing, blocker splitting, scope readiness, review packs, and operator visibility.
- Paper probe-diversification now also tracks session usage, so probes can be spread across market hours instead of only strategy families and regimes.
- Replay/chaos summaries now build automatic replay packs for probe winners, paper misses, and near-miss blocked setups to speed up paper review loops.
- Paper-learning summaries now compute a dedicated readiness score/status, so paper can be read as `warmup`, `building`, or `paper_ready` instead of only lane counts.
- The dashboard system-status area now includes a compact paper-learning card with readiness, probation, top blocker, and top outcome for faster operator review.
- Paper replay/chaos summaries now count recent paper misses (`bad_trade`, `early_exit`, `late_exit`, `execution_drag`) as explicit replay review signals instead of only relying on blocked setups and trade stress.
- Paper-learning summaries now expose a lightweight probe probation state with `promote_candidate`, `rollback_watch`, or `observe`, so paper probes can be reviewed with clearer promotion intent.
- A concrete paper-mode roadmap in the README, plus paper-learning diversification limits per strategy family and regime so probes collect broader training data instead of clustering in the same scopes.
- Paper-learning runtime summaries now surface dominant blockers and the most common recent learning outcomes, making it easier to see why paper is blocked and what it is actually learning from.
- Closed paper trades now carry explainable `paperLearningOutcome` labels with entry, exit, risk, and execution quality buckets for faster paper-only tuning and review.
- A canonical `marketState` contract layered on top of the existing trend-state engine, with stable `direction`, `phase`, `trendMaturity`, `trendExhaustion`, `rangeAcceptance`, `trendFailure`, `dataConfidence`, and `featureCompleteness` fields for runtime, dashboard, backtest, and research consumers.
- Explicit scan-mode wrappers for `scanCandidatesReadOnly()`, `scanCandidatesForCycle()`, and `scanCandidatesForResearch()` so observability and production paths can stay readable without duplicating scan logic.
- A rate-limited exchange-truth refresh loop for non-cycle runtime paths, allowing `doctor`, `status`, and dashboard snapshots to refresh live reconcile truth without waiting for a full trading cycle.
- Discord and Telegram operator-alert delivery channels alongside the existing generic webhooks, keeping alert fan-out config-driven and still safe to mock in tests.
- Research-candidate governance fields `robustnessScore`, `uniquenessScore`, and `promotionStage`, so imported/genome strategies now surface paper-readiness with more explainable scoring.
- Stable decision/ops alias contracts for `marketState`, `riskPolicy`, `executionBudget`, and `capitalPolicy`, reducing dashboard/runtime contract drift without breaking existing payloads.
- Region-aware Binance capability resolution with a conservative Belgium profile, plus defensive bear-market handling for spot-only accounts.
- A new `bear_rally_reclaim` strategy path aimed at monetizing downtrends through spot-safe capitulation/reclaim setups instead of assuming shorting access.
- Persisted order-lifecycle, exchange-truth, shadow-trading, service, and operator-ops state in the runtime schema so restarts and dashboards can reason about position state instead of only raw open positions.
- Threshold-tuning recommendations, exit-learning scorecards, feature-decay tracking, calibration governance, and regime-deployment summaries in the offline trainer.
- Exchange-truth mismatch summaries that count runtime-vs-exchange inventory drift and can freeze new live entries when reconcile risk is too high.
- Position-level failure budgets that degrade repeated management failures into `protect_only` and `manual_review` states instead of retrying the same risky automation every cycle.
- Dashboard/operator views for lifecycle state, incident timeline, runbooks, performance-delta notes, shadow entries, threshold tuning, exit learning, and feature decay.
- Watchdog status-file output plus exponential restart backoff in `Run-BotService.ps1`.
- Crash-safe pending live action journaling so entries, exits, protective-order rebuilds, and exchange recovery steps survive restarts with explicit lifecycle state.
- Dashboard health and readiness endpoints that surface live blockers such as exchange-truth freezes, lifecycle manual-review states, and circuit-open health failures.
- Execution-calibration feedback that derives paper slippage, maker fill bias, latency, and queue-decay adjustments from recent live fill telemetry.
- Auto-applied threshold probation with scoped rollback rules, so high-confidence threshold recommendations can be trialed and reverted without manual intervention.
- CVaR, drawdown-budget, and regime kill-switch controls in the portfolio allocator alongside the existing exposure and factor budgeting.
- Safe strategy-DSL normalization and validation for imported strategy ideas, with hard blocks on unsafe patterns such as martingale, average-down, unlimited pyramiding, and unsupported execution styles.
- Automated strategy-research mining that combines whitelisted imports, native seed strategies, deterministic genome mutations, and Monte Carlo stress scoring into paper-ready candidate lists.
- A neural strategy meta-selector that learns preferred strategy families and execution styles per market context and feeds that guidance into entry sizing, threshold bias, and execution planning.
- Reference-venue confirmation summaries and capital-ladder staging that can downgrade sizing, keep live in shadow, or block entries when external price confirmation or deployment readiness falls behind.
- Parameter-governor scopes that learn bounded threshold, stop, take-profit, scale-out, hold-time, and execution-aggressiveness adjustments from closed-trade outcomes.
- Shared candidate insight summaries for `dataQuality`, `signalQuality`, and per-layer `confidenceBreakdown`, so runtime, risk, and dashboard all reason over the same explainable quality model.
- Shared trend-state phase classification with explicit `early_ignition`, `healthy_continuation`, `late_crowded`, `range_acceptance`, and transition labels.
- A central `capitalPolicy` snapshot that reuses existing allocator, governor, and ladder state to expose factor, cluster, regime, and family budget pressure without introducing a duplicate portfolio stack.
- Explicit lifecycle `recoveryAction` recommendations per tracked position and pending action, plus disappearance journaling when a pending exchange action vanishes without a terminal record.
- Semi-incident-response operator controls for `force reconcile`, `mark reviewed`, `allow probe-only`, and resolve-with-note flows across runtime, manager, dashboard API, and UI.
- Richer counterfactual labels (`good_veto`, `bad_veto`, `late_veto`, `right_direction_wrong_timing`) so blocker feedback can distinguish timing problems from clean vetoes.

### Improved
- Dashboard operations now surface retrain-batch and replay-pack context directly inside the paper-learning block, so the next retrain and replay actions are visible without digging through raw runtime payloads.
- Recorder frame counters now rebuild from actual feature-store files on disk instead of trusting persisted summary counters, so restores and manual recoveries stay aligned with file-truth state.
- Decision records now flow through the shared recorder write path, which means `recordQuality`, `averageRecordQuality`, and `qualityByKind` finally include decision history instead of only trade/learning/replay-style frames.
- Cached news and announcement/context reuses are now written once per cache snapshot to historical recorder storage, so offline review can distinguish fresh fetches from cached and fallback-backed runtime use.
- Calendar history capture now follows the same once-per-cache-snapshot pattern and its service constructor is runtime-dir safe, removing a fragile edge case during tests, restores, and lightweight service wiring.
- Paper-learning lane counts now survive dashboard refreshes by rebuilding `safe / probe / shadow` from same-day trades, open positions, and shadow-history instead of only the latest cycle decisions.
- Dataset curation summaries now also surface recorder data-quality state such as lineage coverage, archived file counts, and hot/cold retention windows.
- Normalized operator alerts around explicit `new`, `acked`, `silenced`, and `resolved` states, and surfaced those states directly in dashboard actions and payloads.
- Reused the canonical market-state wrapper in regime inference, strategy routing, risk, backtest, and research paths instead of leaving trend semantics implied by only raw trend-state fields.
- Strengthened runtime explainability so decision payloads now carry market-state aliases even when older consumers still depend on `trendState`.
- Hardened exchange-capability normalization so persisted string values like `"false"` no longer flip regional shorting flags back on in runtime summaries or downtrend guards.
- Split paper-mode leniency into `paper_exploration` versus `paper_recovery_probe`, so capital-governor recovery can keep learning with tiny probe sizing while market/data-quality blockers still stay hard.
- Deepened model-promotion governance so regime readiness now sits beside threshold, exit, calibration, and feature-health feedback instead of only paper/live scorecards.
- Extended replay cards with veto-chain and alternate-exit context so post-trade review shows more than entry/exit prices alone.
- Refreshed status serialization so live runtime output now includes lifecycle and operator layers end-to-end.
- Documented the new tuning and watchdog knobs in `.env.example`.
- Tightened exchange-truth reconciliation so open orders, order lists, stale protective state, and recent fills all participate in live freeze decisions and recovery guidance.
- Expanded operator dashboards with readiness summaries, active lifecycle actions, lifecycle journals, threshold probation context, and execution-calibration status.
- Deepened exit learning with strategy- and regime-scoped exit policies that tune scale-outs, trailing behavior, and hold windows per context.
- Expanded dashboard governance, research, and operations panels with imported-strategy scorecards, parameter-governor summaries, venue-confirmation status, and capital-ladder state.
- Clarified dashboard decision cards so paper-only candidates now show whether they were a generic warm-up or a capital-recovery probe, plus which guardrails were consciously relaxed.
- Kept imported strategy candidates as raw DSL records in runtime state instead of recycling scored seed/genome output, preventing governance refreshes from inflating or corrupting follow-up research inputs.
- Extended the execution planner so strategy-meta and governor signals can nudge maker preference and sizing without bypassing the existing safety clamps.
- Unified regime, strategy-routing, and risk tuning around the same shared trend-state summary instead of parallel heuristic branches with slightly different weights.
- Added explicit sideways/range-acceptance detection using directional persistence, structure, acceleration, VWAP acceptance, and breakout follow-through instead of treating range as only “not trend”.
- Expanded the indicator/feature layer with anchored VWAP acceptance/rejection, upside-versus-downside realized volatility split, trend failure scoring, and richer trend maturity/exhaustion signals.
- Added relative-strength signals versus BTC, ETH, cluster peers, and sector peers so continuation and relative-weakness context reaches runtime decisions without introducing a duplicate trend engine.
- Added close-location quality, breakout follow-through, volume acceptance, and replenishment-quality signals to the shared feature stack and regression coverage.
- Added explicit read-only scan isolation for preview/research paths so candidate scans no longer retarget the local-book universe while observing runtime state.
- Added replay/chaos scenario tagging for stale book, venue divergence, missing news, protection rebuild issues, and partial fills so failure patterns surface earlier in operator review.
- Added lifecycle invariant summaries and tuning-governance summaries to the dashboard snapshot so operators can see hard-stop lifecycle states and active threshold/governor promotion context in one place.
- Added richer operator-cockpit explanations on decision cards with explicit operator action, auto-recovery context, and degraded datasource labels.
- Improved dashboard decision visibility with explicit trend phase, confidence breakdown, signal-quality, data-quality, dominant source states, and clearer risk-layer blocker context.
- Applied the shared trend-state semantics to backtest and research contexts as well, reducing live-vs-offline feature drift without a broad refactor.
- Made doctor preview scans read-only and bounded candidate evaluation with concurrency limits, reducing accidental runtime/journal mutation and improving scan latency on larger universes.
- Tightened risk de-risking around crowded trends, fragile breakout follow-through, and healthy downtrend mean-reversion traps while keeping the new confidence layer bounded enough for paper warm-up entries.
- Expanded replay chaos output with recommended actions per active scenario, so stale book, divergence, protection, and partial-fill risks now surface as concrete operator follow-ups instead of only counts.
- Tightened operational readiness so unresolved critical alerts now require acknowledgement before the bot is considered re-enabled.
- Made `probe-only` a real runtime behavior by shrinking allowed entry sizing during operator-controlled recovery windows instead of only surfacing a dashboard label.
- Deepened paper, backtest, and research execution realism with session-biased fill delay, maker miss rate, queue refill/cancellation effects, and partial-fill recovery cost attribution.
- Surfaced the new capital-policy and lifecycle recovery context directly in dashboard operations cards and action rows for faster incident handling.
- Expanded offline veto learning so blocker scorecards now track late-veto and timing-issue patterns alongside classic good/bad veto counts.

### Fixed
- Wired the live `NewsService` into the recorder so fresh news fetches are actually written into historical storage instead of the new news-history path existing only on paper.
- Removed the leftover Reddit RSS provider implementation and its dead config hooks so paper/live news collection no longer risks noisy `429` Reddit warnings from stale code paths.
- Fixed operator-alert runtime state migration so restored runtimes now always carry the new `resolvedAtById` store without breaking older persisted JSON.
- Fixed dashboard/operator alert actions so alerts can now be resolved explicitly instead of only acknowledged or silenced.
- Fixed strategy-research summaries so newer robustness/uniqueness scoring survives serialization into runtime and dashboard snapshots.
- Closed a new threshold-policy bug where the `adjust` state could effectively never trigger because the shift floor was stricter than the maximum recommendation size.
- Prevented `openBestCandidate()` from crashing in lightweight prototype-based tests when `this.config` is absent.
- Kept recovered/rebuilt live positions explicitly marked as `reconcile_required` or `protected` so lifecycle state no longer goes stale after broker recovery paths.
- Fixed scale-out protection recovery so failed protective rebuilds now leave a clear reconcile state instead of silently falling back to a generic open position.
- Stopped per-position exchange sync failures from aborting the broader reconcile pass; failed symbols now degrade into `reconcile_required` while the rest of the book still updates.
- Cleared stale protective-order assumptions when exchange order-list truth disagrees, so later rebuilds can recover instead of believing a dead protective order still exists.
- Fixed strategy-research persistence so imported candidates no longer get replaced by summarized scorecards, which previously risked lossy rescoring and self-referential research growth across governance refreshes.
- Fixed candidate quality/explainability contract drift so live `once`/`status` output now carries trend-state, data-quality, signal-quality, and confidence summaries end-to-end instead of dashboard fields falling back to zeroed placeholders.
- Fixed doctor preview behavior so observability scans no longer mutate blocked-setup journals, universe runs, or latest-decision runtime state.
- Fixed the relative-strength candidate-scan path so runtime smoke runs no longer fail on a missing shared `average()` helper import while building peer-strength summaries.
- Fixed paper exploration regressions so `trade_size_below_minimum` can still be treated as a paper-only soft blocker during tiny warm-up probes instead of shutting exploration off entirely.
- Fixed dashboard/operator decision context so session, drift, and self-heal blockers also generate concrete operator guidance instead of silently missing the action layer.
- Fixed dashboard decision serialization to stay null-safe when lightweight test/runtime stubs do not yet carry the full `runtime.capitalPolicy` tree.
- Fixed lifecycle invariants so disappeared pending actions are now flagged explicitly instead of silently dropping out of operator visibility.

### Verified
- `node --check src/runtime/tradingBot.js`
- `node --check src/runtime/offlineTrainer.js`
- `node --check src/runtime/modelRegistry.js`
- `node --check src/execution/liveBroker.js`
- `node --check src/dashboard/public/app.js`
- `node --check test/run.js`
- `node test/run.js`
- `node src/cli.js status`
- `node src/cli.js once`
- `node src/cli.js once`
- Added regression coverage for the strategy DSL, strategy research miner, neural strategy meta selector, reference-venue confirmation, parameter governor, capital ladder, runtime state migration, and the new execution/risk integrations.
- Added regression coverage for candidate insight summaries, read-only doctor scans, shared trend-state dashboard serialization, and the new quality/confidence overlays in risk decisions.

## Unreleased - 2026-03-10

### Added
- TradingView-style ADX/DMI, Supertrend, Stoch RSI, MFI, CMF, and Keltner squeeze/release signals across the AI feature pipeline.
- Exit intelligence v2 with stronger hold, trim, trail, and close decisions wired into runtime and trade replay.
- Trade quality scoring, universe rotation, model promotion rules, and execution quality monitoring in the AI control loop.
- Richer feature-store learning frames so closed paper/live trades persist model, signal, rationale, and indicator context for retraining.
- Feature-store and persisted runtime schema versioning so recorder frames, runtime state, and journals can migrate forward without silent contract drift.
- Data quorum summaries that classify candidates as `ready`, `watch`, `degraded`, or `observe_only` based on local book, provider ops, pair health, divergence, and event quality checks.
- Offline trainer veto-feedback scorecards per blocker plus regime scorecards so counterfactual misses can directly inform governance and promotion readiness.
- Symbol-level risk guards for per-pair daily entry caps and cooldowns after recent losing exits.
- Clock sync quality telemetry with midpoint-sampled Binance time checks and fresher doctor output.
- Local order book bootstrap wait and warm-up tracking so startup depth confidence ramps in more cleanly.
- Cross-timeframe consensus between lower and higher timeframe market snapshots, wired into scoring, risk, and meta gating.
- Pair-health monitoring and quarantine scoring so symbols with repeated infra/data quality issues cool off automatically.
- Source reliability engine that degrades or cools down flaky news providers after rate limits, timeouts, or repeated failures.
- Live-vs-paper divergence monitoring, offline trainer readiness, and probation-aware model promotion governance.
- On-chain-lite stablecoin liquidity context plus counterfactual replay for blocked trade follow-up analysis.

### Fixed
- Restored recorder and backup manager state on restart so dashboard counts reflect files already on disk.
- Repaired light and dark theme application so both `html` and `body` switch together and persist correctly.
- Cleaned stale runtime `.tmp` files during boot to avoid orphaned state artifacts after interrupted saves.
- Migrated older runtime and journal files forward to the latest persisted shape so new quorum/governance fields do not disappear on pre-existing state.
- Blocked self-heal from auto-switching a live bot to paper while exchange positions are still open; the manager now stops instead of orphaning live inventory under a paper broker.
- Hardened live entry recovery so partially filled entries either auto-flatten immediately after downstream failures or stay under runtime management while further entries are blocked for that cycle.
- Fixed live protective-order lifecycle drift so canceled or `ALL_DONE`-without-fill OCOs clear stale IDs and can be rebuilt instead of leaving positions falsely marked as protected.
- Stopped stale websocket book tickers from overriding fresher market data after disconnects by expiring them and falling back to fresh local-book snapshots.
- Retried Binance non-JSON failure responses, including user-data listen-key endpoints, so transient HTML/empty `5xx` pages do not bypass the retry layer.
- Fixed portfolio ranking so stronger allocator scores now improve setup ordering instead of accidentally penalizing the best-shaped candidates.
- Synced dashboard/runtime summaries with the new indicator payloads and persisted learning telemetry.
- Fixed dashboard fold cards and nested detail panels so user collapse state survives polling refreshes instead of reopening every few seconds.
- Restored blocked-setup dashboard cards so self-heal, session, and drift safety flags survive the decision-view serialization layer.
- Fixed the trade-open pipeline so dashboard `Go` states no longer imply an order was sent; decisions now expose `opened`, `eligible`, `runtime_blocked`, `entry_failed`, and `standby` explicitly.
- Stopped paper mode from being unnecessarily blocked by live-only clock drift, funding settlement, self-heal low-risk, and symbol repeat guards so the bot can keep learning during paper runs.
- Reworked market snapshot prefetching to honor cache freshness, scan budgets, and concurrency limits, reducing timeout-driven fallback snapshots.
- Excluded stablecoin lookalikes such as `USD1` and `PYUSD` from the dynamic top-100 Binance watchlist so the bot focuses on real trading candidates.
- Stopped false `clock_drift_too_large` alerts caused by compensated Windows clock offset; health checks now judge effective sync uncertainty instead of raw offset.
- Smoothed local order book startup behavior by waiting for early depth packets, downgrading warm-up gaps, and clamping negative depth ages from exchange-ahead timestamps.

### Improved
- Reworked the dashboard into a simpler operator layout with a smaller top section, cleaner navigation, and one collapsed advanced analysis layer.
- Simplified top setup and open position cards so the AI explains why a trade is allowed or blocked with fewer, clearer signals.
- Reduced visible density by showing fewer setups, blocked trades, replay cards, and recent trades at once.
- Extended governance and blocked/setup views with veto-learning, regime-readiness, and data-quorum context instead of only aggregate promotion stats.
- Improved paper execution realism with queue-decay, spread-shock, and liquidity-shock penalties flowing into execution attribution.
- Isolated per-position management failures so one symbol can fail review without preventing the rest of the open book from being evaluated that cycle.
- Expanded portfolio allocation with factor budget and factor heat controls on top of the existing cluster/sector/family/regime exposure checks.
- Added persistent detail memory for dynamic setup, position, and replay cards so manual open-close choices stick across refreshes.
- Tightened universe, attribution, replay, and blocked-trade lists into a more compact operator view.
- Lowered the default live drift threshold to a meaningful sync-quality guard now that clock health uses RTT-aware sampling rather than raw offset magnitude.
- Expanded doctor/status/dashboard output with pair health, source reliability, divergence, offline trainer, and on-chain-lite summaries.
- Extended the feature pipeline and learning labels so paper/live outcomes can teach model quality, execution regret, and blocked-trade counterfactuals.

### Verified
- `node --check src/dashboard/public/app.js`
- `node --check src/runtime/tradingBot.js`
- `node --check src/config/index.js`
- `node --check src/runtime/sessionManager.js`
- `node --check src/risk/riskManager.js`
- `node --check src/runtime/watchlistResolver.js`
- `node --check src/news/newsService.js`
- `node --check src/config/validate.js`
- `node --check test/run.js`
- `npm.cmd test`
- `node test/run.js`
- `node --check src/runtime/botManager.js`
- `node --check src/execution/liveBroker.js`
- `node --check src/runtime/streamCoordinator.js`
- `node --check src/binance/client.js`
- `node --check src/runtime/tradingBot.js`
- `node src/cli.js once`
- `node src/cli.js status`
- `node src/cli.js doctor`
- Escalated runtime checks with real network access for `node src/cli.js doctor` and `node src/cli.js status`
- Dashboard API smoke test on `http://127.0.0.1:3011/api/snapshot`
- Dashboard homepage smoke test on `http://127.0.0.1:3011/`

## v0.1.0 - 2026-03-09

Initial public release of the Binance AI trading bot workspace.

### Added
- Binance Spot paper/live bot runtime with safety-first defaults.
- Event-driven market data, local order book tracking, and execution attribution.
- Multi-layer AI stack with strategy routing, transformer challenger, committee logic, and RL execution advice.
- News, official notices, futures structure, macro calendar, volatility, and sentiment context.
- Research lab, walk-forward analysis, strategy attribution, and governance views.
- Feature-store recorder, model registry, rollback scoring, and runtime backup manager.
- Local dashboard with trade reasoning, top setups, replay, why-not-trades, PnL attribution, and operations panels.

### Improved
- More realistic paper/backtest fills with latency, slippage, maker/taker, and partial-fill simulation.
- Better exit intelligence, universe selection, and portfolio-aware ranking.
- Stronger Windows setup flow with long-path guidance and watchdog/service scripts.
- Clearer documentation and operational runbooks for dashboard, doctor, research, and service mode.

### Verification
- `npm.cmd test`
- `node src/cli.js status`
- `node src/cli.js doctor`
- `node src/cli.js backtest BTCUSDT`
- `node src/cli.js research BTCUSDT`
- Dashboard API smoke test on `http://127.0.0.1:3011/api/snapshot`
## 2026-03-12

- tightened scoped threshold and missed-trade matching so strategy+regime experiments and governance scorecards no longer overcount unrelated history
- added `paper roadmap v3` features: active learning scoring, benchmark lanes, confidence miscalibration tracking, counterfactual branching, failure library, and recency-weighted paper readiness
- extended paper counterfactual queue resolution with alternative execution/size/exit branches
- preserved `probabilityAtEntry` on closed paper trades so paper-learning calibration can compare predicted conviction with realized outcomes
