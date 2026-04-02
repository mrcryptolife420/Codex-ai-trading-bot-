\# AGENTS.md



\## Mission

This repository is a safety-first crypto AI trading bot for Binance Spot with:

\- paper trading as the default operating mode

\- stricter live trading with governance and protections

\- AI-assisted setup selection and calibration

\- risk-first execution and recovery behavior

\- local operator dashboard

\- explainable decisions, blockers, and health status



The default goal is not to give high-level advice.

The default goal is to inspect the real code, identify root causes, apply high-confidence fixes, verify results, and clearly explain what changed.



\---



\## Core operating principles

\- Inspect before editing.

\- For any non-trivial task, start with a short plan.

\- Trace the actual call path before changing behavior.

\- Prefer evidence-based fixes over speculative edits.

\- Prefer minimal but complete fixes over broad rewrites.

\- Preserve architecture unless a structural change is clearly justified.

\- Do not stop at recommendations if the task asks for implementation.

\- After important changes, run the most relevant verification available.

\- If verification cannot be run, state exactly why.

\- Treat “the process is running” as different from “the system is functioning correctly”.

\- Be skeptical of silent returns, swallowed exceptions, stale caches, dead code, config drift, and backend/frontend state drift.

\- Keep diffs scoped to the task.

\- Avoid unrelated cleanup or cosmetic churn.



\---



\## Priority order in this repo

1\. Trading logic correctness

2\. Paper trading correctness

3\. Risk / veto / blocker correctness

4\. Dashboard correctness and backend↔frontend consistency

5\. Observability and silent-failure reduction

6\. Stability and performance directly related to the issue

7\. Cleanup only when it materially improves correctness or maintainability



\---



\## Required workflow for substantial tasks

For any meaningful debugging, implementation, audit, repair, or feature-completion task, follow this sequence:



1\. Create a short plan.

2\. Map the affected system from actual code.

3\. Identify the exact files/modules involved.

4\. Trace the end-to-end call path.

5\. Identify:

&#x20;  - confirmed bugs

&#x20;  - likely bugs

&#x20;  - incomplete code paths

&#x20;  - dead code

&#x20;  - silent failure points

&#x20;  - config mismatches

&#x20;  - state drift and stale-data risks

6\. Apply high-confidence fixes directly in code.

7\. Add observability where the system can fail silently.

8\. Run relevant verification.

9\. Report:

&#x20;  - plan

&#x20;  - files inspected

&#x20;  - confirmed root causes

&#x20;  - files changed

&#x20;  - fixes applied

&#x20;  - observability added

&#x20;  - validation performed

&#x20;  - remaining risks

&#x20;  - next manual checks



Do not jump from vague suspicion to edits without tracing the real path first.



\---



\## Repo routing guidance

Use the repository structure below as the default map unless the code proves otherwise:



\- `src/binance`

&#x20; - REST client

&#x20; - signing

&#x20; - clock sync

&#x20; - exchange data



\- `src/news`

&#x20; - news ingestion

&#x20; - parsing

&#x20; - reliability scoring



\- `src/events`

&#x20; - exchange notices

&#x20; - calendar logic

&#x20; - event context



\- `src/market`

&#x20; - market structure

&#x20; - sentiment

&#x20; - volatility

&#x20; - on-chain-lite context



\- `src/strategy`

&#x20; - indicators

&#x20; - features

&#x20; - trend / market state

&#x20; - setup construction



\- `src/ai`

&#x20; - adaptive model

&#x20; - regime model

&#x20; - calibration

&#x20; - governance



\- `src/risk`

&#x20; - risk manager

&#x20; - portfolio logic

&#x20; - capital policies



\- `src/execution`

&#x20; - paper broker

&#x20; - live broker

&#x20; - execution engine



\- `src/runtime`

&#x20; - bot loop

&#x20; - self-heal

&#x20; - replay

&#x20; - research

&#x20; - alerts

&#x20; - reports

&#x20; - state orchestration



\- `src/dashboard`

&#x20; - local dashboard server

&#x20; - frontend rendering

&#x20; - operator actions

&#x20; - dashboard data flow



\- `src/storage`

&#x20; - runtime persistence

&#x20; - model persistence

&#x20; - trade journal

&#x20; - snapshots

&#x20; - historical recorder data



When looking for issues, prioritize files in this order if relevant:

1\. execution / paper trading / live trading

2\. risk engine / veto / blocker logic

3\. strategy / model / scoring / threshold logic

4\. runtime orchestration and loop control

5\. persistence / journal / metrics

6\. dashboard backend feed / aggregation

7\. dashboard frontend rendering / polling / actions

8\. shared config / env / feature flags



If a bug appears in the dashboard, do not assume it is frontend-only.

If a bug appears in execution, do not assume the signal logic is correct.

Check the full chain.



\---



\## Build / run / verification commands

Use the repo’s real scripts and documented commands before inventing alternatives.



\### Primary npm scripts

\- Install dependencies: `npm install`

\- Start bot loop: `npm start`

\- Run single cycle: `npm run once`

\- Status: `npm run status`

\- Doctor: `npm run doctor`

\- Report: `npm run report`

\- Backtest: `npm run backtest`

\- Dashboard: `npm run dashboard`

\- Test: `npm test`



\### Direct node commands

\- `node src/cli.js run`

\- `node src/cli.js once`

\- `node src/cli.js status`

\- `node src/cli.js doctor`

\- `node src/cli.js report`

\- `node src/cli.js backtest BTCUSDT`

\- `node src/cli.js research BTCUSDT`

\- `node src/cli.js dashboard`



\### Windows helper commands

\- `Start-Dashboard.cmd`

\- `Start-BotService.cmd`

\- `Start-Everything.cmd`

\- `Install-Windows11.cmd`

\- `Start-BotService.cmd`

\- `Start-Dashboard.cmd`



\### Windows-specific notes

\- Prefer `npm.cmd` on Windows if shell resolution is flaky.

\- Long paths may matter on Windows. Respect existing project guidance for long path support.

\- The `.cmd` files are intended entrypoints on Windows when relevant.



If a needed script is missing, inspect `package.json` and the existing `.cmd` files before making assumptions.



\---



\## Trading-system rules

When a task touches trading behavior, always inspect the full path:



market/exchange data

\-> feature generation

\-> strategy/setup construction

\-> model/scoring

\-> confidence/threshold logic

\-> blocker/veto/governance logic

\-> risk sizing

\-> execution path

\-> persistence

\-> PnL / stats / monitoring

\-> dashboard/backend feed

\-> dashboard/frontend rendering



Always check whether:

\- market data is actually arriving and being consumed

\- features are valid and usable

\- signals or candidate setups are generated at all

\- signals are generated but rejected before execution

\- thresholds are unrealistically strict

\- veto or committee logic blocks too aggressively

\- calibration break disables entries too often or never resets

\- event/news blockers remain active too long

\- self-heal pause entries remains active too long

\- pair correlation logic rejects too many valid setups

\- cooldowns or duplicate-trade prevention block valid entries

\- session/time filters disable too much trading opportunity

\- risk sizing returns zero, null, NaN, or invalid size

\- execution is never invoked

\- execution is invoked but fails silently

\- trades are created but not persisted

\- trades are persisted but not reflected in stats/dashboard

\- live and paper paths use inconsistent assumptions, flags, or thresholds

\- PnL/stats drift from the actual trade lifecycle

\- the bot is technically alive but functionally inactive



Never change thresholds blindly.

First prove why the current logic fails.



\---



\## High-priority suspicious areas in this repo

Pay extra attention to logic involving:

\- committee veto

\- model confidence too low

\- calibration break

\- cross-timeframe misalignment

\- event risk

\- self-heal pause entries

\- pair correlation too high

\- trend following composite

\- VWAP trend

\- session filters

\- cooldowns

\- duplicate-trade prevention

\- execution-cost gating

\- capital governor / capital policy

\- risk sizing

\- paper/live config mismatches

\- recorder/history/bootstrap effects

\- dashboard/backend state drift

\- data-source degradation and fallback logic



If any of these can block trading, make the block reason observable.



\---



\## Paper-trading rules

Paper trading is a first-class path and the default operating mode.



Whenever a task touches paper trading, verify separately:

\- paper mode enablement/config

\- paper execution invocation

\- trade/order object creation

\- persistence of paper trades

\- PnL/stat updates for paper trades

\- recorder/history updates for paper trades

\- dashboard visibility for paper trades

\- logs/metrics for paper-trade attempts, rejections, execution, and persistence



If the bot can run for long periods with zero paper trades, that is a serious issue unless the system clearly exposes why.



Paper-trading work is not complete until one of these is true:

\- a valid paper-trade path is proven to work end-to-end, or

\- the exact code-backed reason it still cannot work is identified and surfaced clearly



Do not “fix” paper mode by simply weakening safeguards without evidence.

Prefer finding the actual disconnect, overblocking logic, or missing observability.



\---



\## Live-trading rules

Live mode must remain stricter than paper mode.



When touching live-related code:

\- preserve or strengthen safety assumptions unless evidence shows a bug

\- verify live gating still requires the expected acknowledgements and protections

\- do not accidentally align live behavior downward toward paper leniency

\- check reconcile/protection/exchange-truth logic carefully

\- avoid speculative changes to any code path that can affect real capital exposure



If changing shared code used by both paper and live, explicitly verify both paths.



\---



\## Dashboard rules

When touching dashboard code, always verify:



\- dashboard state matches backend reality

\- counters, charts, summaries, and tables use the correct source data

\- paper trades, live trades, signals, blockers, and system-health states are shown correctly

\- stale or cached data is not shown as current without indication

\- empty states are not misleading

\- errors are not hidden

\- polling, fetch, subscriptions, or event listeners are actually working

\- frontend assumptions match current backend payloads

\- summaries and PnL calculations are correct

\- rejection/block reasons are visible where relevant

\- “no activity” UI states cannot mask backend activity or backend failure

\- operator action buttons actually hit the correct backend behavior

\- snapshot freshness and runtime freshness are clearly distinguished



A dashboard bug may come from:

\- backend aggregation

\- recorder/history summarization

\- transport / polling / push

\- payload drift

\- frontend parsing

\- frontend rendering



Check all of them.



\---



\## Runtime and orchestration rules

When touching `src/runtime` or bot-loop behavior, always check:

\- whether loops are actually running on the expected cadence

\- whether one-shot mode and loop mode behave differently

\- whether status and dashboard snapshots are reading from the same underlying truth

\- whether alerts, lifecycle flags, and self-heal states ever reset correctly

\- whether research/replay/doctor/report code paths accidentally influence live runtime state

\- whether bootstrap history or recorder warm-start causes stale or over-conservative runtime state

\- whether the bot can get stuck in a degraded, blocked, or recovery state without a clear path back



Any long-lived blocked state should be explainable.



\---



\## Storage and recorder rules

When touching `src/storage` or historical/recorder logic, check:

\- whether trades and decisions are persisted consistently

\- whether read/write formats match current runtime expectations

\- whether bootstrap loading can resurrect stale blockers or stale health state

\- whether recorder summaries match raw stored events

\- whether paper vs live data separation is respected

\- whether replay, research, and learning records can distort current operator summaries if aggregation is wrong



Do not assume “stored successfully” means “visible and correctly aggregated”.



\---



\## Observability requirements

If a failure can happen silently, add visibility.



Prefer adding:

\- structured rejection reasons

\- categorized blocker/veto reasons

\- counters for:

&#x20; - signals generated

&#x20; - candidates rejected

&#x20; - rejection reasons by category

&#x20; - trades attempted

&#x20; - paper trades attempted

&#x20; - paper trades executed

&#x20; - trades persisted

&#x20; - dashboard feed/API failures

&#x20; - snapshot freshness / staleness warnings

\- logs for important early-return paths

\- warnings when the bot is running but functionally inactive

\- diagnostics when backend and dashboard state drift apart



Do not leave critical inactivity unexplained.



\---



\## Editing safety rules

\- Do not remove protections unless evidence clearly supports it.

\- Do not weaken safeguards only to force more trades.

\- Do not make speculative “magic number” tweaks without explaining why.

\- Do not rewrite major subsystems unless a targeted fix is impossible.

\- Do not leave temporary debug code behind unless it is intentionally useful observability.

\- Do not introduce fake success states in logs or the dashboard.

\- State uncertainty clearly.

\- If a bug is not proven, label it as suspected rather than confirmed.



\---



\## Code quality rules

\- Keep new code readable and traceable.

\- Use explicit names for blocker/rejection reasons.

\- Prefer deterministic behavior over fragile implicit behavior.

\- When fixing async/state issues, check ordering, retries, idempotency, stale-state risk, and race conditions.

\- When adding logs/metrics, make them actionable rather than noisy.

\- Keep diffs scoped.

\- Preserve explainability in trading decisions and operator-visible summaries.



\---



\## Verification expectations

After important changes, run the most relevant available checks, such as:

\- `npm test`

\- `npm run status`

\- `npm run doctor`

\- `npm run once`

\- `npm run report`

\- targeted `backtest` or `research` flows if directly relevant

\- dashboard startup validation

\- targeted smoke tests for affected execution paths

\- deterministic replay / simulation / fixture checks when available



If a task changes trading logic, do not rely on static inspection alone when targeted validation is available.

If a task changes dashboard logic, verify both backend data production and frontend presentation.



For meaningful trading-path fixes, prefer verification that proves one of:

\- candidate generation works

\- rejection reasons are surfaced correctly

\- execution path can be reached correctly

\- persistence and dashboard reflect the result correctly



\---



\## Output format for substantial tasks

For larger tasks, always report back using this structure:



1\. Plan

2\. System map / files inspected

3\. Confirmed root causes

4\. Likely or suspicious issues

5\. Files changed

6\. Fixes applied

7\. Observability added

8\. Validation performed

9\. Remaining risks

10\. Next manual checks



Do not report “fixed” without stating what was actually verified.



\---



\## Definition of done

Work is not done when code merely compiles.



Done means:

\- important confirmed bugs are fixed in code

\- affected call chains were inspected end-to-end

\- relevant verification was run, or inability to run it was explained

\- silent failures were reduced where practical

\- rejection/block reasons are visible where needed

\- dashboard and backend consistency were checked if relevant

\- remaining risks and next checks are clearly stated



For paper-trading tasks specifically, “done” additionally means:

\- paper-trade flow was traced end-to-end

\- blocked outcomes are explained

\- a working path or exact blocker is proven with code evidence



\---



\## Task splitting rule

If a request is too broad for one high-quality pass, split the work internally into sensible phases instead of doing a shallow audit.



Preferred split:

1\. trading logic / execution / paper path

2\. runtime / storage / monitoring state

3\. dashboard / aggregation / UI state

4\. verification and hardening pass



\---



\## AGENTS maintenance rule

When the same repo-specific mistake or review issue appears more than once:

\- add a short durable rule to this file

\- keep the rule specific and practical

\- do not bloat this file with one-off task details



Keep this file useful, practical, and grounded in real recurring issues from this repo.

