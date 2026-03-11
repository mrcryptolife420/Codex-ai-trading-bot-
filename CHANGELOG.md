# Changelog

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
