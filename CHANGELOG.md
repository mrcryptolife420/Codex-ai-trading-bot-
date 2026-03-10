# Changelog

## Unreleased - 2026-03-10

### Added
- TradingView-style ADX/DMI, Supertrend, Stoch RSI, MFI, CMF, and Keltner squeeze/release signals across the AI feature pipeline
- Richer feature-store learning frames so closed paper/live trades persist model, signal, rationale, and indicator context for retraining

### Fixed
- Restored recorder and backup manager state on restart so dashboard counts reflect files already on disk
- Cleaned stale runtime `.tmp` files during boot to avoid orphaned state artifacts after interrupted saves
- Synced dashboard/runtime summaries with the new indicator payloads and persisted learning telemetry

### Verified
- `npm.cmd test`
- `node src/cli.js once`
- `node src/cli.js status`
- Dashboard API smoke test on `http://127.0.0.1:3011/api/snapshot`

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
