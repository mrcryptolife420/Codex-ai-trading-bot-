# Binance AI Trading Bot

Een safety-first Binance Spot trading bot met een lokaal webdashboard voor paper trading, live trading, AI-uitleg per positie, multi-source crypto-news en portfolio-statistieken.

## Wat er nu in zit

- Paper trading als standaard met persistente state in `data/runtime`
- Binance Spot REST-integratie met retries, `serverTime` sync, signed requests en symbol filters
- Event-driven marktdata via Binance public streams, diff-depth local orderbook, futures liquidation stream en optionele user-data stream in live mode
- Coin-specifieke news ingestie via Google News RSS, CoinDesk RSS, Cointelegraph RSS, Decrypt RSS, Blockworks RSS en Reddit search RSS
- Officiele Binance announcements en maintenance notices als aparte event-feed
- Strengere news reliability scoring met bron-whitelist, source-quality scoring, social weighting en event-type decay
- Futures market-structure signalen via funding, basis, open interest, taker bias, global/top-trader long-short ratios, leverage buildup en live liquidation pressure
- Event-calendar laag voor macro-events via BLS ICS plus eigen events via `data/runtime/event-calendar.json`
- Technische features uit candles, orderboekdata, microstructure, pattern detection, trade flow en regime-detectie
- Warm-start AI-model met champion/challenger logica, calibration en online updates na gesloten trades
- Meerdere strategieen tegelijk: breakout, mean reversion en trend following, met een strategy-router die per marktregime de beste aanpak kiest
- Transformer-style multi-horizon challenger, specialist multi-agent committee en RL execution policy voor slimmere entry/execution-beslissingen
- Harde risk gates voor spread, volatiliteit, cooldowns, exposure caps, loss streaks, orderbook pressure, calendar risk en official notice risk
- Live broker met exchange-native OCO protectie, pegged maker-orders, keep-priority amends, STP-telemetry en runtime reconciliation
- Dashboard met start/stop, live-paper switch, losse cyclus, rolling stats, session/drift/self-heal monitoring, stable-model backup zichtbaarheid, pair-search in Top AI setups, compactere why-trade uitleg, why-not-trade blockers, trade replay, strategy-keuze, transformer/committee/RL/meta-gate uitleg, scale-out context, universe focus, strategy attribution, research-registry governance, PnL attribution, operations/recovery panels en research-lab triggers
- Windows 11 install-, dashboard- en watchdog/service-scripts

## Belangrijk

Dit project garandeert geen winst. Het is gebouwd om risico's te beperken, niet om winst te beloven.

Live mode staat alleen toe als je expliciet bevestigt dat je het risico begrijpt:

```env
LIVE_TRADING_ACKNOWLEDGED=I_UNDERSTAND_LIVE_TRADING_RISK
```

Daarnaast vereist live mode:

- geldige `BINANCE_API_KEY` en `BINANCE_API_SECRET`
- `ENABLE_EXCHANGE_PROTECTION=true`
- een account dat `canTrade=true` en `SPOT` permission teruggeeft

## Dashboard

Start het dashboard met:

```powershell
node src/cli.js dashboard
```

Of op Windows 11 simpeler via:

```powershell
.\Start-Dashboard.cmd
```

Daarin kun je:

- wisselen tussen `paper` en `live`
- de bot starten en stoppen
- een losse cyclus draaien
- analyse handmatig verversen
- open posities inclusief entry-redenen, bullish/bearish drivers, social sentiment, official notices, orderbook pressure, execution-attributie en kalender-events bekijken
- winst/verlies per open en recente gesloten trade zien, inclusief execution-style, slippage en maker/taker-context
- statistieken bekijken voor vandaag, 7 dagen, 15 dagen, 30 dagen en all-time
- funding, basis, open interest, global/top-trader long-short ratios, liquidaties, fear/greed, option-vol context, social sentiment, pattern-context, lokale book-health, execution-stats en portfolio-exposure volgen
- zien welke checks de AI per trade wel of niet haalde
- geblokkeerde setups en why-not-trade redenen per pair bekijken
- trade replay zien met entry-, exit- en scale-out context
- vanuit het dashboard een research-run starten en walk-forward samenvattingen terugzien
- current session-, drift- en self-heal status volgen inclusief low-liquidity, funding windows, cooldowns en rollback-backups
- PnL attribution bekijken per strategie, regime, execution-style en nieuwsbron
- operations/recovery volgen met feature-store activiteit, model registry en state backups

Standaard draait het dashboard lokaal op `http://127.0.0.1:3011`. Pas dit aan met `DASHBOARD_PORT` in [`.env.example`](/C:/Users/highlife/Documents/Playground/.env.example).

## Windows 11 installatie

1. Zet Git long-path support aan: `git config --global core.longpaths true`.
2. Clone de repo bij voorkeur naar een kort pad, bijvoorbeeld `C:\code\Codex-ai-trading-bot`.
3. Installeer Node.js 22 of nieuwer.
4. Voer [Install-Windows11.cmd](/C:/Users/highlife/Documents/Playground/Install-Windows11.cmd) uit.
5. Vul daarna je Binance API keys in `.env` in als je live wilt traden.
6. Start het dashboard met [Start-Dashboard.cmd](/C:/Users/highlife/Documents/Playground/Start-Dashboard.cmd) of de watchdog met [Start-BotService.cmd](/C:/Users/highlife/Documents/Playground/Start-BotService.cmd).

Het installscript:

- maakt automatisch een `.env` aan als die ontbreekt
- zet `git config --global core.longpaths true` als Git aanwezig is
- maakt `data/runtime`, `data/runtime/feature-store` en `data/runtime/backups` aan
- draait `npm.cmd test`
- draait `node src/cli.js doctor`

## Snelle start

1. Maak een `.env` op basis van [`.env.example`](/C:/Users/highlife/Documents/Playground/.env.example) als die nog niet bestaat.
2. Laat `BOT_MODE=paper` staan voor de eerste tests.
3. Draai eerst de preflight:

```powershell
node src/cli.js doctor
```

4. Bekijk actuele status:

```powershell
node src/cli.js status
```

5. Draai een enkele handelscyclus:

```powershell
node src/cli.js once
```

6. Start daarna het dashboard of de continue loop:

```powershell
node src/cli.js dashboard
node src/cli.js run
```

## Handige commando's

```powershell
npm.cmd test
node src/cli.js doctor
node src/cli.js status
node src/cli.js once
node src/cli.js report
node src/cli.js backtest BTCUSDT
node src/cli.js research BTCUSDT
node src/cli.js dashboard
node src/cli.js run
npm.cmd run service:windows
Start-BotService.cmd
```

## Hoe de AI beslist

- Het model combineert technische signalen, orderboekdruk, microprice/book pressure, candlestick patterns, trade flow, nieuws-sentiment, social sentiment, official notices, futures market-structure, macro/agendarisico en een transformer-style multi-horizon challenger.
- Daarbovenop draait een specialistische multi-agent committee-laag (model, transformer, strategy-router, news, orderflow, structure, portfolio en execution) plus een RL execution policy voor maker/market, patience en sizing-advies.
- Regime-detectie kiest tussen `trend`, `range`, `breakout`, `high_vol` en `event_risk`.
- Probability calibration en een abstain-zone voorkomen dat zwakke of onzekere setups automatisch live worden uitgevoerd.
- Een extra meta decision gate bewaakt dagelijkse risicobudgetten, canary live sizing, history-confidence en trade frequency voordat een setup echt door mag.
- Een universe selector kiest eerst de sterkste watchlist-kandidaten op spread, depth, activity en volatility-fit voordat de volledige AI-scan draait.
- Exit intelligence beslist apart over hold, trim en exit, zodat winstneming en risicoreductie slimmer verlopen dan alleen vaste stops.
- Strategy attribution en een research registry houden bij welke strategieen, families, regimes en symbols daadwerkelijk werken en welke modellen promotie of observatie verdienen.
- Champion/challenger deployment zorgt dat online learning niet meteen blind live wordt gepromoveerd.
- Per trade bewaart de bot de sterkste bullish/bearish signalen, nieuwsdrivers, social context, notice-checks, orderbook/pattern reasons, market-structure reasons, kalender-events, scale-out plannen en execution-attributie.
- In het dashboard zie je precies waarom een positie is geopend, waarom een kandidaattrade is geblokkeerd en hoe een replay/backtest of research-window uitpakte.

## Officiele notices en agenda

De bot gebruikt nu drie extra contextlagen naast normale nieuwsfeeds:

- Officiele Binance CMS notices voor exchange-nieuws en maintenance-updates
- Gratis futures market-structure data van Binance voor funding, OI, basis, taker bias en long-short crowding
- Macro/agendadata via BLS ICS en optionele eigen JSON-events in `data/runtime/event-calendar.json`

Je kunt handmatig eigen events toevoegen in [event-calendar.json](/C:/Users/highlife/Documents/Playground/data/runtime/event-calendar.json). Voorbeeld:

```json
[
  {
    "title": "ETH unlock",
    "at": "2026-03-20T12:00:00.000Z",
    "type": "unlock",
    "impact": 0.8,
    "bias": -0.35,
    "symbols": ["ETH", "ETHUSDT"],
    "scope": "symbol",
    "source": "Manual"
  }
]
```

## Projectstructuur

- `src/binance`: REST-client, signing, clock sync, symbol filters en futures public data
- `src/news`: news ingestie, Reddit/news parsing, eventclassificatie en sentiment/reliability scoring
- `src/events`: Binance notices en kalenderservices
- `src/market`: market-structure samenvatting voor funding, OI, basis en liquidaties
- `src/strategy`: indicatoren en feature engineering
- `src/ai`: online model, regime model, calibration en adaptive deployment
- `src/risk`: risk rules, sizing, exposure caps en portfolio intelligence
- `src/execution`: paper broker en live broker met OCO protectie
- `src/runtime`: bot-loop, streams, doctor, rapportage, research, feature-store recorder, model registry, backups en manager
- `src/dashboard`: lokale dashboardserver en frontend
- `src/storage`: model, runtime en journal persistence

## Runtime opslag en herstel

Nieuwe productie-hardened lagen:

- `data/runtime/feature-store`: JSONL-opslag van cycles, decisions, trades en research-runs voor replay en retraining
- `data/runtime/backups`: automatische runtime-backups voor crash recovery en rollback
- model registry: quality scoring per modelsnapshot met rollback-kandidaat in dashboard en doctor-output
- Windows watchdog: [Run-BotService.ps1](/C:/Users/highlife/Documents/Playground/Run-BotService.ps1) herstart de bot-loop automatisch als die crasht, met restart-limiet per uur

Start de watchdog lokaal met:

```powershell
Start-BotService.cmd
npm.cmd run service:windows
```

## Belangrijkste extra env-keys

Zie [`.env.example`](/C:/Users/highlife/Documents/Playground/.env.example) voor alle opties. De belangrijkste groepen zijn:

- Adaptive AI: `CHALLENGER_*`, `MIN_CALIBRATION_CONFIDENCE`, `MIN_REGIME_CONFIDENCE`, `ABSTAIN_BAND`, `MAX_MODEL_DISAGREEMENT`
- Event-driven data: `ENABLE_EVENT_DRIVEN_DATA`, `ENABLE_LOCAL_ORDER_BOOK`, `STREAM_TRADE_BUFFER_SIZE`, `STREAM_DEPTH_LEVELS`, `STREAM_DEPTH_SNAPSHOT_LIMIT`, `MAX_DEPTH_EVENT_AGE_MS`, `LOCAL_BOOK_BOOTSTRAP_WAIT_MS`, `LOCAL_BOOK_WARMUP_MS`, `BINANCE_FUTURES_API_BASE_URL`
- Smart execution: `ENABLE_SMART_EXECUTION`, `ENABLE_PEGGED_ORDERS`, `DEFAULT_PEG_OFFSET_LEVELS`, `MAX_PEGGED_IMPACT_BPS`, `ENABLE_STP_TELEMETRY_QUERY`, `STP_TELEMETRY_LIMIT`, `MAKER_MIN_SPREAD_BPS`, `BASE_MAKER_PATIENCE_MS`, `MAX_MAKER_PATIENCE_MS`
- Social sentiment: `ENABLE_REDDIT_SENTIMENT`, `REDDIT_SENTIMENT_SUBREDDITS`
- Market structure: `MARKET_STRUCTURE_CACHE_MINUTES`, `MARKET_STRUCTURE_LOOKBACK_POINTS`
- Macro sentiment: `ENABLE_MARKET_SENTIMENT_CONTEXT`, `MARKET_SENTIMENT_CACHE_MINUTES`, `ALTERNATIVE_API_BASE_URL`, `COINGECKO_API_BASE_URL`
- Volatility context: `ENABLE_VOLATILITY_CONTEXT`, `VOLATILITY_CACHE_MINUTES`, `DERIBIT_API_BASE_URL`
- Official notices: `ANNOUNCEMENT_LOOKBACK_HOURS`, `ANNOUNCEMENT_CACHE_MINUTES`
- Event calendar: `CALENDAR_LOOKBACK_DAYS`, `CALENDAR_CACHE_MINUTES`
- News reliability: `NEWS_MIN_SOURCE_QUALITY`, `NEWS_MIN_RELIABILITY_SCORE`, `NEWS_STRICT_WHITELIST`
- Risk guards: `MAX_LOSS_STREAK`, `MAX_SYMBOL_LOSS_STREAK`, `SYMBOL_LOSS_COOLDOWN_MINUTES`, `MAX_ENTRIES_PER_SYMBOL_PER_DAY`, `MIN_BOOK_PRESSURE_FOR_ENTRY`, `EXIT_ON_SPREAD_SHOCK_BPS`
- Session intelligence: `ENABLE_SESSION_LOGIC`, `SESSION_*`, `BLOCK_WEEKEND_HIGH_RISK_STRATEGIES`
- Drift monitoring: `ENABLE_DRIFT_MONITORING`, `DRIFT_*`, `MAX_SERVER_TIME_DRIFT_MS`, `CLOCK_SYNC_SAMPLE_COUNT`, `CLOCK_SYNC_MAX_AGE_MS`, `CLOCK_SYNC_MAX_RTT_MS`
- Self-heal and rollback: `SELF_HEAL_*`, `STABLE_MODEL_*`
- Meta gate, canary en scale-out: `ENABLE_META_DECISION_GATE`, `META_*`, `ENABLE_CANARY_LIVE_MODE`, `CANARY_*`, `DAILY_RISK_BUDGET_FLOOR`, `MAX_ENTRIES_PER_DAY`, `MAX_ENTRIES_PER_SYMBOL_PER_DAY`, `SCALE_OUT_*`
- Universe selector, exit AI en attribution: `ENABLE_UNIVERSE_SELECTOR`, `UNIVERSE_*`, `UNIVERSE_ROTATION_*`, `ENABLE_EXIT_INTELLIGENCE`, `EXIT_INTELLIGENCE_*`, `TRADE_QUALITY_*`, `STRATEGY_ATTRIBUTION_MIN_TRADES`
- Research lab en governance: `RESEARCH_*`, `RESEARCH_PROMOTION_*`, `MODEL_PROMOTION_*`
- Execution realism: `PAPER_LATENCY_MS`, `PAPER_MAKER_FILL_FLOOR`, `PAPER_PARTIAL_FILL_MIN_RATIO`, `BACKTEST_LATENCY_MS`, `BACKTEST_SYNTHETIC_DEPTH_USD`
- Recorder / registry / backups: `DATA_RECORDER_*`, `MODEL_REGISTRY_*`, `STATE_BACKUP_*`
- Windows watchdog: `SERVICE_RESTART_DELAY_SECONDS`, `SERVICE_MAX_RESTARTS_PER_HOUR`, `GIT_SHORT_CLONE_PATH`
- Portfolio intelligence: `TARGET_ANNUALIZED_VOLATILITY`, `MAX_PAIR_CORRELATION`, `MAX_CLUSTER_POSITIONS`, `MAX_SECTOR_POSITIONS`

## Arbitrage roadmap

Cross-exchange arbitrage is bewust nog geen live feature. Daarvoor is een aparte execution-laag nodig met meerdere exchange-connectors, fee/netting-logica, inventory per venue, transfer/settlement awareness en latency-aware order routing.

## Verificatie

Lokaal geverifieerd met:

- `npm.cmd test`
- `node src/cli.js status`
- `node src/cli.js doctor`
- `node src/cli.js once`
- `node src/cli.js backtest BTCUSDT`
- `node src/cli.js research BTCUSDT`
- dashboard smoke test op `http://127.0.0.1:3011/api/snapshot`

## Officiele documentatie en publieke bronnen

- [Binance Spot REST API](https://developers.binance.com/docs/binance-spot-api-docs/rest-api)
- [Binance Trading endpoints](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/trading-endpoints)
- [Binance User Data Stream](https://developers.binance.com/docs/binance-spot-api-docs/user-data-stream)
- [Binance WebSocket Streams](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams)
- [CoinDesk RSS](https://www.coindesk.com/arc/outboundfeeds/rss/)
- [Cointelegraph RSS](https://cointelegraph.com/rss)
- [Decrypt RSS](https://decrypt.co/feed)
- [Blockworks RSS](https://blockworks.com/feed)
- [BLS release calendar](https://www.bls.gov/schedule/news_release/)









