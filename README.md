# Binance AI Trading Bot

Een safety-first crypto trading bot voor Binance Spot met:

- paper trading als standaard
- live trading met extra governance en protection
- AI-gestuurde setup-selectie
- lokaal dashboard voor operatorzicht
- explainable beslissingen, risk gates en recovery-status

De bot is gebouwd om eerst veilig en uitlegbaar te zijn, daarna pas agressief.

## Belangrijk

Dit project garandeert geen winst.

Live trading blijft risicovol. De bot probeert slechte situaties te vermijden, maar kan verlies niet uitsluiten.

Live mode wordt alleen geactiveerd als je expliciet bevestigt dat je het risico begrijpt:

```env
LIVE_TRADING_ACKNOWLEDGED=I_UNDERSTAND_LIVE_TRADING_RISK
```

Voor live mode zijn ook nodig:

- geldige `BINANCE_API_KEY`
- geldige `BINANCE_API_SECRET`
- `ENABLE_EXCHANGE_PROTECTION=true`
- een account dat `canTrade=true` en `SPOT` permissions teruggeeft

## Wat de bot doet

De bot combineert meerdere lagen:

- technische indicatoren en candle-structuur
- local order book en microstructure
- regime-detectie zoals `trend`, `range`, `breakout`, `high_vol`
- news, announcements en marktsentiment
- market-structure data zoals funding, basis, open interest en liquidaties
- AI- en governance-lagen voor threshold, calibration en position sizing
- risk controls voor spread, volatility, order book quality, cooldowns en drawdown
- paper en live execution met lifecycle-, protection- en reconcile-logica

## Data-roadmap

De volgende datalaag is nu actief en vormt de basis voor beter leren, historisch onderzoek en replay:

1. `Feature-store lagen`
- aparte buckets voor cycles, decisions, trades, learning, research, snapshots, news-history en dataset-curation

2. `Datasource lineage`
- decision- en learning-frames bewaren nu ook:
  - data quality
  - confidence breakdown
  - feature completeness
  - fallback/degraded datasource context

3. `Historische news-store`
- nieuwsfetches worden nu als eigen frames opgeslagen met:
  - symbol
  - headlines
  - provider/source
  - event type
  - betrouwbaarheid
  - cache/fetch status

4. `Historische event-store`
- exchange announcements en macro/calendar samenvattingen worden nu ook als eigen context-frames opgeslagen
- zo blijft later zichtbaar welke maintenance-, delisting- of macro-eventcontext meespeelde bij een beslissing

5. `Dataset curation`
- de recorder bouwt nu aparte curation-samenvattingen voor:
  - paper learning
  - veto review
  - exit learning
  - execution learning
  - regime learning
  - news-history dekking

6. `Hot/cold retention`
- recente recorderdata blijft direct in de hot store
- oudere recorderdata schuift automatisch naar een archive-laag
- te oude bestanden worden daarna verwijderd

7. `Replay-grade opslag`
- snapshot manifests, trade replay frames en news-history leveren samen een betere basis om te reconstrueren wat de bot wist op het moment van een beslissing

8. `Record quality`
- elk decision-, trade-, learning- en replay-record krijgt nu ook een compacte `recordQuality`
- die score vat samen:
  - completeness
  - confidence
  - fallback-penalty
  - degraded-penalty
- zo kun je later trainingsdata filteren op kwaliteit in plaats van alles even zwaar te behandelen

9. `Recorder-overzicht in runtime`
- `status`, `doctor` en dashboard krijgen nu een compact recorder-overzicht met:
  - schema-versie
  - frame-aantallen
  - lineage coverage
  - gemiddelde recordkwaliteit
  - hot/cold retention
  - laatste recordkwaliteit

10. `Bron- en contextdekking`
- de recorder houdt nu ook compacte aggregaten bij voor:
  - top news/providers
  - channel-verdeling
  - announcement/calendar contexttypes
  - high-impact eventdekking
- zo zie je sneller of je historische dataset vooral op een paar bronnen leunt of breed genoeg gespreid is

## Snelle start

1. Maak een `.env` op basis van [`.env.example`](/mnt/c/Users/highlife/Documents/Playground/.env.example).
2. Laat `BOT_MODE=paper` staan voor de eerste tests.
3. Draai:

```powershell
node src/cli.js doctor
node src/cli.js status
node src/cli.js once
node src/cli.js dashboard
```

Op Windows kun je ook gebruiken:

- [Start-Dashboard.cmd](/mnt/c/Users/highlife/Documents/Playground/Start-Dashboard.cmd)
- [Start-BotService.cmd](/mnt/c/Users/highlife/Documents/Playground/Start-BotService.cmd)
- [Start-Everything.cmd](/mnt/c/Users/highlife/Documents/Playground/Start-Everything.cmd)

## Dashboard

Het dashboard draait standaard lokaal op:

`http://127.0.0.1:3011`

De huidige dashboard-opzet is bewust compact en toont alleen de kern:

- boven: status en acties
- midden links: top signalen
- midden rechts: open posities
- onder: risico en recente trades

### Dashboard-acties

- `Start`: start de bot-loop
- `Stop`: stopt de bot-loop
- `Paper`: zet de bot in paper mode
- `Live`: zet de bot in live mode
- `Refresh`: haalt direct een nieuwe snapshot op

### Dashboard-topbalk

De bovenste statuschips geven de globale toestand weer.

`Paper` of `Live`
- In welke mode de bot nu draait.

`Running` of `Stopped`
- Of de bot-loop actief is.

`Ready`, `Degraded`, `Blocked`
- De algemene readiness om nieuwe entries te nemen.

`Refresh dd/mm/jj uu:mm · data dd/mm/jj uu:mm`
- `Refresh`: wanneer het dashboard de laatste snapshot ontving.
- `data`: wanneer de onderliggende runtime-data voor het laatst is bijgewerkt.

### Operator-samenvatting bovenaan

Bovenaan zie je korte pillen zoals:

- `Equity`
- `Beste kans`
- `Blokkade`
- `Actie`
- `Herstelt vanzelf`

Betekenis:

`Equity`
- Totale paper/live accountwaarde volgens de runtime-state.

`Beste kans`
- Het sterkste huidige signaal uit de topbeslissingen.

`Blokkade`
- De zwaarste reden waarom de bot nu geen entry opent.

`Actie`
- Wat jij of de operator idealiter nu moet doen.

`Herstelt vanzelf`
- Wat de bot waarschijnlijk zelf oplost zonder handmatige ingreep.

## Dashboard-secties

### 1. Top signalen

Hier zie je de belangrijkste setups van de huidige scan.

Per kaart zie je:

`Tradebaar` of `Geblokkeerd`
- Of de bot deze setup nu daadwerkelijk mag openen.

`Type`
- Wat voor soort setup dit is.
- Voorbeelden: `Trend Following`, `Breakout`, `Mean Reversion`, `Liquidity Sweep`.

`Kans`
- De door de bot berekende kansscore voor deze setup.
- Dit is niet hetzelfde als winstgarantie.

`Confidence`
- Hoe zeker de bot is over deze setup na model-, data-, market- en execution-checks.

`Risk`
- De dominante risk/governance-context.
- Bijvoorbeeld `Normal`, `Blocked`, `Recovery`, `Observe Only`.

`Waarom wel`
- Korte uitleg waarom deze setup tradebaar is.

`Waarom niet`
- De voornaamste blocker waardoor deze setup niet wordt geopend.

`Actie`
- Wat de operator of de bot nu moet doen.

#### Voorbeelduitleg

`Type: Trend Following`
- De bot ziet een setup die bedoeld is om met een bestaande trend mee te gaan.
- Dat betekent meestal: trend bevestiging, continuation-karakter en minder mean-reversion logica.

`Waarom niet: Controleer veto-feedback en counterfactual scorecards voor deze setup.`
- Deze setup is waarschijnlijk door een governance- of committee-veto tegengehouden.
- De bot zegt hier eigenlijk: kijk of deze veto historisch terecht was of dat dit type setup te vaak onterecht wordt geblokkeerd.
- `counterfactual scorecards` betekenen: “wat was er gebeurd als we deze trade wél genomen hadden?”

`Actie: Datasources in herstel: news, announcements.`
- Een of meer databronnen zijn tijdelijk zwak, leeg, vertraagd of aan het herstellen.
- In dit voorbeeld gaat het om:
  - `news`: normale nieuwsfeeds
  - `announcements`: exchange- of officiële notices
- De bot kan soms nog doorgaan, maar doet dat voorzichtiger omdat de dataset niet volledig betrouwbaar is.

### 2. Open posities

Hier staan actieve posities.

Per positie zie je:

- `Entry`
- `Nu`
- `Rendement`
- lifecycle-tags zoals `Manual review` of `Reconcile`

Betekenis:

`Entry`
- De instapprijs.

`Nu`
- De actuele prijs die de runtime gebruikt voor markering.

`Rendement`
- Het huidige ongerealiseerde resultaat in procent.

`Manual review`
- Deze positie vraagt extra menselijke controle.
- Meestal door een lifecycle-probleem, execution-afwijking of recovery-pad.

`Reconcile`
- Lokale state en verwachte exchange-truth moeten opnieuw vergeleken worden.

### 3. Systeemstatus

Hier zie je operationele gezondheid, risk en herstelstatus.

Belangrijke labels:

`Readiness`
- De globale entry-status.

`Ready`
- Nieuwe entries zijn in principe toegestaan.

`Degraded`
- De bot draait nog, maar met actieve voorzichtigheid of blokkades.

`Blocked`
- Nieuwe entries zijn effectief geblokkeerd.

`Operator Ack Required`
- Er staat een alert open die eerst bevestigd moet worden.
- In paper mode kan dit voor governance-alerts soms zachter zijn dan in live mode.

`Alerts`
- Aantal actieve waarschuwingen.

`Lifecycle`
- Aantal open pending actions of lifecycle-items.

`Capital`
- Samenvatting van capital-governor en capital-policy status.

#### Veelvoorkomende meldingen

`Capital Blocked`
- De capital governor wil nieuwe entries afremmen of stoppen.
- Vaak door recente drawdown, verliesritme of recovery-mode.

`Entries toegestaan`
- Ondanks een capital- of governance-status mogen nog beperkte entries of probes door.
- In paper mode zie je dit vaker dan in live mode.

`Paper Calibration Probe Actief`
- De bot zit in een voorzichtige leerstand.
- Kleine probe-trades mogen nog lopen om nieuwe data te verzamelen terwijl calibration herstelt.

`Execution Cost Budget Te Duur`
- De bot denkt dat spread, slippage of fill-kwaliteit te duur zijn voor een gezonde entry.

`market heeft momenteel de duurste execution-cost profile`
- De huidige marktcondities zijn ongunstig voor goedkope execution.
- Zelfs een goede setup kan dan worden tegengehouden.

`Capital governor blokkeert nieuwe entries tot het verliesritme afneemt`
- De bot heeft recent te veel of te snel verlies gezien en wil eerst stabiliseren.

`Datasources in herstel`
- Een of meer datalagen zijn teruggevallen of aan het herstellen.
- De bot blijft soms draaien, maar met lagere confidence of strengere gates.

### 4. Recente trades

Toont de laatste gesloten trades met:

- `Coin`
- `Open`
- `Sluit`
- `Reden`
- `P/L`
- `Rendement`

`Reden`
- Waarom de trade gesloten werd.
- Voorbeelden:
  - `time_stop`
  - `stop_loss`
  - `trailing_stop`
  - `orderbook_reversal_pressure`

## Betekenis van veelgebruikte dashboardtermen

### Trade-status

`Tradebaar`
- De setup passeert de huidige gates en mag worden geopend.

`Geblokkeerd`
- De setup werd gezien, maar tegengehouden door risk, governance, market quality of execution.

### Markt- en setuptermen

`Trend Following`
- Setup die met de trend mee probeert te gaan.

`Breakout`
- Setup die inzet op een uitbraak uit range of compressie.

`Mean Reversion`
- Setup die inzet op terugkeer naar gemiddelde of range-midden.

`Liquidity Sweep`
- Setup rond stop-hunts, wick-structuur of sweep/reclaim gedrag.

`Range Acceptance`
- Markt zit eerder in een zijwaartse, geaccepteerde range dan in een schone trend.

`Healthy Continuation`
- Trend is aanwezig en nog niet duidelijk uitgeput.

`Late Crowded`
- Trend lijkt laat in de move te zitten en mogelijk te druk of te duur.

`Capitulation Bounce Risk`
- Kans op harde bounce na neerwaartse capitulatie.

### Confidence- en quality-termen

`Data Confidence`
- Hoe bruikbaar en compleet de databronnen zijn.

`Feature Completeness`
- Hoe volledig de feature-set voor deze setup was.

`Signal Quality`
- Samenvatting van setup fit, structuurkwaliteit, execution viability, news cleanliness en quorum quality.

`Confidence Breakdown`
- Opgesplitste zekerheid van:
  - market confidence
  - data confidence
  - execution confidence
  - model confidence

### Risk- en governance-termen

`Observe Only`
- Bot mag observeren en leren, maar geen echte entry nemen.

`Probe Only`
- Alleen kleine proefentries toegestaan.

`Recovery`
- De bot zit in herstelmodus na slechte performance, calibration issues of governance-druk.

`Manual Review`
- Handmatige controle aanbevolen.

`Reconcile Required`
- Runtime-state en truth-state moeten opnieuw worden gesynchroniseerd.

`Committee Veto`
- Een governance- of modelcommittee heeft de setup tegengehouden.

`Counterfactual`
- Wat het resultaat geweest zou zijn als een geblokkeerde setup wel genomen was.

## Waarom een trade niet opent

Als de bot geen trade opent, is dat meestal een combinatie van:

- market quality te zwak
- spread of slippage te duur
- capital governor actief
- committee of meta-gate veto
- timeframe conflict
- data quorum degraded
- self-heal of calibration probe actief

In het dashboard zie je dat terug in:

- `Blokkade`
- `Waarom niet`
- `Actie`
- `Herstelt vanzelf`
- `Systeemstatus`

## Paper mode versus live mode

### Paper mode

Paper mode is bedoeld om:

- veilig te testen
- sneller te leren
- nieuwe regimes of features te observeren
- probe-entries toe te laten zonder echt kapitaalrisico

Paper mode kan soms soepeler zijn bij:

- governance-alerts
- capital recovery
- execution-cost caution

Maar paper blijft hard blokkeren bij echte safety-risico's zoals:

- lifecycle-problemen
- health circuit open
- exchange-truth mismatch
- ernstige data-integrity issues

### Live mode

Live mode is veel strenger.

Daar blijven onder meer hard:

- unresolved critical alerts
- protection issues
- exchange-truth mismatches
- reconcile-problemen
- hard capital blocks

## Paper mode roadmap

De beste volgende uitbreidingen voor paper mode zijn:

1. `Learning value scoring`
- Niet alleen kijken naar winstkans, maar ook naar hoeveel nieuwe informatie een setup oplevert.
- De bot weegt daarom beter mee of een setup:
  - dicht bij de threshold zit
  - nuttige disagreement heeft
  - voldoende kwaliteit heeft
  - in een nog weinig geziene scope valt

2. `Probe sampling per family en regime`
- Paper moet niet 10 keer dezelfde soort probe-trade openen.
- Daarom is het nuttig om probe-learning te spreiden over:
  - strategy families
  - regimes
- Zo leert de bot sneller en evenwichtiger.

3. `Safe / probe / shadow lanes`
- `safe`: normale paper entries
- `probe`: kleine leerentries met beperkte sizing
- `shadow`: geen echte positie, wel meekijken wat er gebeurd zou zijn

4. `Learning budget per dag`
- Een apart dagbudget voor probes en shadow-learning voorkomt dat paper te chaotisch wordt.

5. `Novelty en diversity`
- Als een family of regime vandaag al vaak aan bod kwam, levert nóg een gelijkaardige probe minder leerwaarde op.

6. `Paper-only relaxed blockers`
- Sommige governance-remmen mogen in paper zachter zijn dan in live, zolang echte safety-risico's hard blijven.

7. `Outcome labeling`
- Label paper-uitkomsten als:
  - good trade
  - bad trade
  - good veto
  - bad veto
  - late entry
  - early exit

8. `Replay vanuit paper missers`
- Sterke missers en near-miss setups automatisch opnemen in replay en chaos-scenario's.

9. `Paper learning dashboard`
- Aparte samenvatting van:
  - safe/probe/shadow counts
  - budgetgebruik
  - novelty
  - vaakst voorkomende blockers

10. `Probation en promotie`
- Sterke paper-probes niet meteen breed promoten, maar eerst via duidelijke probation- en rollbackregels.

### Wat nu al is toegevoegd

In de huidige versie zit nu al:

- `safe / probe / shadow` lanes
- daily learning budgets
- learning value scoring
- probe caps per strategy-family en regime
- novelty scoring zodat paper minder snel in dezelfde scopes blijft hangen
- paper learning summary in runtime/dashboard payloads
- paper outcome labeling op gesloten paper trades
- paper samenvattingen met vaakste blockers en meest voorkomende leeruitkomsten
- replay/chaos gebruikt nu ook recente paper-missers als extra review-signaal
- lichte paper probation-samenvatting voor probe-trades met promote/rollback watch
- paper readiness score in runtime/dashboard
- compacte paper learning kaart in het dashboard met lanes, readiness, probation, top blocker en top outcome
- probe-diversificatie over sessies zodat paper niet te veel in dezelfde markturen blijft leren
- automatische replay-packs met probe winners, paper misses en near-miss blocked setups
- paper blocker-splitting tussen `safety`, `governance`, `learning` en `market`
- scope-readiness per strategy-family, regime en session
- paper-only threshold sandbox met kleine scope-gebonden threshold shifts
- review-packs voor beste probe, zwakste probe en top gemiste setup

### Paper roadmap v2

1. `Experiment lanes`
- Houd `safe`, `probe` en `shadow` expliciet apart.

2. `Learning value`
- Waardeer zeldzame en ondervertegenwoordigde scopes hoger.

3. `Probe sampling`
- Spreid probes over family, regime en session.

4. `Threshold sandbox`
- Laat paper kleine, begrensde threshold-experimenten doen per scope.

5. `Blocker splitting`
- Splits blockers in `safety`, `governance`, `learning` en `market`.

6. `Outcome labeling`
- Blijf paper trades en veto's labelen als leerinput.

7. `Replay & review packs`
- Bundel beste probes, zwakke probes en gemiste setups automatisch.

8. `Scope readiness`
- Meet paper readiness niet alleen globaal, maar ook per family, regime en session.

9. `Counterfactual tuning`
- Gebruik gemiste winnaars en slechte veto's als gerichte tuning-input.

10. `Operator visibility`
- Toon paper readiness, sandbox, review-packs en gemiste-trade analyse duidelijk in runtime/dashboard.

### Verder afgewerkt

De paper-roadmap toont nu ook:
- `paper-to-live readiness` per sterkste scope
- `counterfactual tuning` met top blocker en eventuele threshold-richting
- extra dashboardcontext voor welke scope nu het dichtst bij een volgende probationstap zit

## Projectstructuur

- `src/binance`: REST-client, signing, clock sync en exchange data
- `src/news`: news ingestie, parsing en reliability scoring
- `src/events`: notices en kalenderlogica
- `src/market`: market-structure, sentiment, volatility en on-chain-lite context
- `src/strategy`: indicatoren, features en market/trend-state
- `src/ai`: adaptive model, regime model, calibration en governance
- `src/risk`: risk manager, portfolio logic en capital policies
- `src/execution`: paper broker, live broker en execution engine
- `src/runtime`: bot-loop, self-heal, replay, research, alerts, reports en state orchestration
- `src/dashboard`: lokale dashboardserver en frontend
- `src/storage`: runtime-, model- en journal-persistence

## Windows 11 installatie

1. Zet long paths aan:

```powershell
git config --global core.longpaths true
```

2. Installeer Node.js 22 of nieuwer.
3. Voer [Install-Windows11.cmd](/mnt/c/Users/highlife/Documents/Playground/Install-Windows11.cmd) uit.
4. Vul je `.env` in.
5. Start met:

- [Start-Dashboard.cmd](/mnt/c/Users/highlife/Documents/Playground/Start-Dashboard.cmd)
- of [Start-Everything.cmd](/mnt/c/Users/highlife/Documents/Playground/Start-Everything.cmd)

De `.cmd` bestanden zijn op Windows de bedoelde entrypoints.

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
Start-Dashboard.cmd
Start-BotService.cmd
Start-Everything.cmd
```

## Verificatie

Lokaal geverifieerd met:

- `npm.cmd test`
- `node src/cli.js status`
- `node src/cli.js doctor`
- `node src/cli.js once`
