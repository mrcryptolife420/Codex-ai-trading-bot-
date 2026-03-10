# Changelog

## Unreleased - 2026-03-10

### Added
- TradingView-style ADX/DMI, Supertrend, Stoch RSI, MFI, CMF, and Keltner squeeze/release signals across the AI feature pipeline
- Exit intelligence v2 with stronger hold, trim, trail, and close decisions wired into runtime and trade replay
- Trade quality scoring, universe rotation, model promotion rules, and execution quality monitoring in the AI control loop
- Richer feature-store learning frames so closed paper/live trades persist model, signal, rationale, and indicator context for retraining`r`n- Symbol-level risk guards for per-pair daily entry caps and cooldowns after recent losing exits

### Fixed
- Restored recorder and backup manager state on restart so dashboard counts reflect files already on disk
- Repaired light and dark theme application so both `html` and `body` switch together and persist correctly
- Cleaned stale runtime `.tmp` files during boot to avoid orphaned state artifacts after interrupted saves
- Synced dashboard/runtime summaries with the new indicator payloads and persisted learning telemetry`r`n- Fixed dashboard fold cards and nested detail panels so user collapse state survives polling refreshes instead of reopening every few seconds

### Improved
- Reworked the dashboard into a simpler operator layout with a smaller top section, cleaner sidebar, and one collapsed advanced analysis layer
- Simplified top setup and open position cards so the AI explains why a trade is allowed or blocked with fewer, clearer signals
- Reduced visible density by showing fewer setups, fewer blocked trades, fewer replay cards, and a shorter recent-trades table at once
- Rebuilt the dashboard as a single-workspace layout with no sidebar, clearer top navigation, and calmer advanced sections`r`n- Added persistent detail memory for dynamic setup/position/replay cards so manual open-close choices stick across refreshes`r`n- Tightened advanced lists to show fewer universe, attribution, replay, and blocked-trade items at once for a more compact operator view

### Verified
- `node --check src/dashboard/public/app.js`
- `node --check src/runtime/tradingBot.js`
- `node --check src/ai/exitIntelligence.js`
- `node --check src/ai/metaDecisionGate.js`
- `node --check src/runtime/modelRegistry.js`
- `node --check src/runtime/universeSelector.js`
- `npm.cmd test`
- `node src/cli.js status`
- `node src/cli.js doctor`
- Dashboard API smoke test on `http://127.0.0.1:3011/api/snapshot`
- Dashboard homepage smoke test on `http://127.0.0.1:3011/`

## v0.1.0 - 2026-03-09

Initial public release of the Binance AI trading bot workspace.

### Added
- Binance Spot paper/live bot runtime with safety-first defaults
- Event-driven market data, local order book tracking, and execution attribution
- Multi-layer AI stack with strategy routing, transformer challenger, committee logic, and RL execution advice
- News, official notices, futures structure, macro calendar, volatility, and sentiment context
- Research lab, walk-forward analysis, strategy attribution, and governance views
- Feature-store recorder, model registry, rollback scoring, and runtime backup manager
- Local dashboard with trade reasoning, top setups, replay, why-not-trades, PnL attribution, and operations panels

### Improved
- More realistic paper/backtest fills with latency, slippage, maker/taker, and partial-fill simulation
- Better exit intelligence, universe selection, and portfolio-aware ranking
- Stronger Windows setup flow with long-path guidance and watchdog/service scripts
- Clearer documentation and operational runbooks for dashboard, doctor, research, and service mode

### Verification
- `npm.cmd test`
- `node src/cli.js status`
- `node src/cli.js doctor`
- `node src/cli.js backtest BTCUSDT`
- `node src/cli.js research BTCUSDT`
- Dashboard API smoke test on `http://127.0.0.1:3011/api/snapshot`

