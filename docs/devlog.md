# Dev log (Cursor / hackathon write-up)

How Oko was built: tools, prompts, and what passed. Updated daily.

## Tools
- **Cursor**: editor, terminal (PowerShell), Git commits and pushes. Cursor Free agent usage ran out on Day 1, so coding prompts moved to Google Antigravity's agent.
- **Antigravity agent**: generated code from the prompts below.
- **NVIDIA Nemotron** (`nvidia/nemotron-3.5-lightning-30b-a3b`): explanation layer only. Numbers come from deterministic code.
- **Meterless H-MEM**: farm memory, audit trail, sleep cycle.
- **Zetaris**: federated, read-only data layer (live access pending; see Day 1).

## Day 1: Thu 22 Oct 2026, foundations

### 1.1 Scaffold
- Scaffolded from the Meterless agentathon-starter, then added Next.js 15 App Router, Tailwind and Vitest, with typed module stubs under src/core, src/data, src/memory, src/llm and src/i18n.
- Prompt: "Add Next.js 15 (App Router, TypeScript, Tailwind) without breaking the Meterless starter scripts; create the folder layout and typed stubs; add Vitest, Zod and Recharts."
- Result: `npx tsc --noEmit` passed, `npm test` passed (1 test), and `npm run dev` served / and /briefings with HTTP 200.
- Commits: 33b493d, e25934a, 62a1717, 17e03a3, c416e4f.

### Nemotron wiring
- Bug: .env used `NVIDIA_MODEL` but src/llm.ts read `NEMOTRON_MODEL`, and the fallback was an obsolete model, which caused a 404.
- Fix: renamed the variable to `NEMOTRON_MODEL` and updated the fallback to `nvidia/nemotron-3.5-lightning-30b-a3b`. Thinking is disabled for speed.
- Result: `npx tsx notebook.ts ask` returned `mode: model` with provenance mem-1, mem-2, mem-4.
- Commit: d29e60c.

### Build config
- Prompt: "Pin outputFileTracingRoot in next.config.ts to the project directory."
- Result: the stray-lockfile workspace warning is gone; tsc and `npm run build` are clean.
- Commit: df2cc50.

### 1.2 Zetaris
- Blocker: a local install needs 6 to 8 GB for Docker, and this laptop has 8 GB total. The managed AWS route failed because AWS declined Nigerian Naira cards.
- Action: emailed the organisers and posted on the Zetaris Discord. Built a DataGateway interface with SnapshotGateway (local JSON) and a ZetarisGateway written to the official REST contract (bearer, X-Org-ID, UUID X-Request-ID, start/page/close, 30 s timeout, 2 retries on 5xx, read-only guard).
- Going live only needs the .env values. Live Zetaris will be used for the demo.
- Prompt: "Implement Oko's data layer behind one interface so we can run on snapshot data now and switch to live Zetaris later via .env only: DataGateway, SnapshotGateway, ZetarisGateway, zetaris-verify, and tests."
- Result: `npx tsc --noEmit` passed; 15 vitest tests passed across 2 test files (SnapshotGateway returns snapshot rows with filename provenance, getGateway falls back on empty/missing env or DATA_MODE=snapshot, read-only guard rejects INSERT/DROP, ZetarisGateway handles headers, 5xx retries, 4xx non-retry, and query close in finally block); `npm run zetaris:verify` prints "Zetaris not configured - using SnapshotGateway" and exits 0.

### 1.3 Snapshot Fetching
- Implemented `scripts/fetch-snapshots.ts` and npm script `snapshots:fetch`.
- Fetched NASA POWER daily climate data (PRECTOTCORR, T2M_MAX, T2M_MIN) from 1991 to present for all 3 seeded farms (13,077 daily rows each).
- Fetched Open-Meteo 16-day historical forecast as of `OKO_DEMO_DATE` (2026-04-10) for all 3 seeded farms.
- Converted `data/crop_calendar_maize_ng.csv` and `data/storage_loss.csv` to metadata-wrapped JSON snapshot format `{ source, sourceUrl, fetchedAt, params, rows }`.
- Updated `SnapshotGateway` to extract source URLs as provenance.
- Result: `npx tsc --noEmit` and all 17 vitest tests passed.

## Day 2: Fri 23 Oct 2026

### 2.1 H-MEM Farm Memory and Seeding
- Implemented `src/memory/hmem.ts` exposing `remember(farmId, event)`, `ask(farmId, query)`, `audit(memoryId)`, `feedback(memoryId, verdict)`, and `sleep(farmId, {preview})`.
- Used real Meterless H-MEM services (`MemoryMiningService`, `MemoryStoreService`, `MemoryRetrievalService`, `TrustLedgerService`, `SleepCycleService`), completely namespaced by farm under `.oko/hmem/<farmId>/` (`state.json`, `ledger.jsonl`).
- Created `data/farm_records.csv` and implemented `scripts/seed-farms.ts` (`npm run seed`) to seed farm profiles, facts (storage, location), and historical seasons.
- Added test suite `tests/hmem.test.ts` verifying that `ask('farm_bisi_ogbomoso', 'storage method')` returns a memory ID, `audit(id)` verifies ledger history with action "create", `feedback(id, "helpful")` records in TrustLedger, and farms are cleanly isolated.
- Result: `npx tsc --noEmit` clean pass, all 22 vitest tests passed.

### 2.2 Provenance and Snapshot Audit
- **Audit Findings**:
  - `price_monthly__oyo.json`, `verify_databases.json`, and `verify_select_1.json` were hand-written placeholders. Marked them with `"source": "mock"` and descriptive `note` fields explaining what they stand in for.
  - `rain_daily__farm_bisi_ogbomoso.json` previously held hand-written test rows (16 rows) because `fetch-snapshots.ts` only fetched `nasa_power_daily__*.json` and `open_meteo_forecast__*.json`.
  - Updated `scripts/fetch-snapshots.ts` to generate `rain_daily__${farm.id}.json` combining real fetched NASA POWER daily history for 2026 leading up to `OKO_DEMO_DATE` and the Open-Meteo 16-day historical forecast, with `sourceUrl` set to the Open-Meteo forecast API.
  - Reran `npm run snapshots:fetch`, generating 115 real rows (99 history + 16 forecast) for all 3 seeded farms.
  - Updated `SnapshotGateway` (`src/data/snapshot.ts`) to return `source: 'mock'` with the file's note as provenance when `source` is `"mock"` or `"assumption"`.
  - Added a disclaimer header comment in `data/farm_records.csv` and created companion `data/farm_records.README.md` identifying them as synthetic demo farm histories.
  - Updated `scripts/seed-farms.ts` and `src/memory/hmem.ts` so historical season records carry `provenance: "demo_seed"`.
  - Confirmed `src/engine.ts` is outside `vendor/` and zero files under `vendor/` were modified.
  - Confirmed `.oko/` is in `.gitignore` and untracked.
  - Added test in `tests/gateway.test.ts` verifying that no snapshot marked `'snapshot'` is missing a real `http(s)://` `sourceUrl`, and added tests for mock source returns.
  - Updated `scripts/fetch-snapshots.ts` so `rain_daily__*.json` credits both sources via `sourceUrls: [NASA, Open-Meteo]` (keeping `sourceUrl` as NASA for compatibility), and updated `SnapshotGateway` to list both in provenance.
  - Cleaned up duplicated root `devlog.md`, standardizing on `docs/devlog.md`.
  - Result: `npx tsc --noEmit` clean pass; all 24 vitest tests passed.

## Day 3: Fri 23 Oct 2026

### 3.1 Planting Simulation Core (Pure & Deterministic)
- **Built**:
  - `src/core/simulate/stats.ts`: pure statistical helpers including `standardDeviation`, `weightedMean`, `weightedPercentile` (Hmisc midpoint continuous quantile interpolation), `weightedQuantiles` (p10, p50, p90), `rollingWindowSums`, `longestDrySpell` (missing values handled without fabricating data), `analogYearWeights`, and pure UTC date arithmetic (`addDays`, `daysBetween`, `isLeapYear`, `alignDateToYear` with Feb 29 leap-day alignment).
  - `src/core/simulate/planting.ts`: pure planting-window simulation returning exactly 3 options (`plant_now`, `wait_7`, `wait_14`).
  - Added typed `SimulationError` to `src/core/errors.ts`.
- **Formulas & Agroclimatology Rules**:
  - **Analog-year weighting**: $w_y = \exp(-|R21_y - R21_{now}| / \sigma)$, where $R21$ is cumulative rainfall in the 21 days before `asOf`, and $\sigma = \text{stdDev}(R21)$ across historical analog years (1991 onward).
  - **False-start / replant risk**: $D$ is candidate planting date; a false start occurs if a dry spell $> 7$ consecutive days ($< 1.0$ mm) happens during the seedling stage (days $D+1$ to $D+21$). Weighted risk: $\text{replantProbability} = \sum w_y \cdot \text{replant}_y / \sum w_y$.
  - **Establishment adequacy**: $\min(1.0, \sum_{t=0}^{30} \text{rain}(D+t) / 100.0)$ over the first 30 days of crop establishment.
  - **Forecast splice**: For each historical analogue, the upcoming 16 days use Open-Meteo forecast rainfall, spliced seamlessly with historical daily records thereafter.
  - **Expected value & score**: Expected yield in Naira minus replanting cost penalty: $\text{score} = \text{mean} - \lambda \times (\text{replantProb} \times \text{replantCost})$ with $\lambda = 0.5$.
- **Test Fixtures & Test Results**:
  - Created hand-built fixtures under `tests/fixtures/simulate/`: `all_dry.json`, `all_wet.json`, `false_start.json`, `missing_days.json`, `leap_year.json`.
  - Added unit test suites `tests/stats.test.ts` (7 tests) and `tests/planting.test.ts` (7 tests) covering all edge cases (all dry, all wet, false start, missing data flagging, leap year alignment, and deterministic reproducibility).
  - Vitest test count: **38 passed** across 5 test suites (smoke: 1, gateway: 18, hmem: 5, stats: 7, planting: 7).
- **Validation on Real Data (`farm_bisi_ogbomoso`, `OKO_DEMO_DATE=2026-04-10`)**:
  - Analog years count: $n = 35$ analog years ($\ge 25$).
  - Results:
    - **Plant now (`2026-04-10`)**: Replant risk: 0.0%, Establishment adequacy: p10=100.0%, p50=100.0%, p90=100.0%, Expected value: ₦1,400,000, Score: 1,400,000 (Low replanting risk; safe seedling establishment window).
    - **Wait 7 days (`2026-04-17`)**: Replant risk: 0.0%, Establishment adequacy: p10=100.0%, p50=100.0%, p90=100.0%, Expected value: ₦1,400,000, Score: 1,400,000.
    - **Wait 14 days (`2026-04-24`)**: Replant risk: 0.0%, Establishment adequacy: p10=100.0%, p50=100.0%, p90=100.0%, Expected value: ₦1,400,000, Score: 1,400,000.
- **Compilation**: `npx tsc --noEmit` passed cleanly with 0 errors.

### 3.2 Day 3.1 Review Fixes: Plausibility, Scaling, and Pure Simulation
- **Root Cause & Diagnosis**:
  - Added `scripts/debug-planting.ts` printing per-year diagnostic table across all 35 analog years (1991 to 2025).
  - Identified two bugs causing the implausible 0% replant / 100% adequacy across all dates:
    1. **NASA POWER 24x unit multiplier**: When NASA POWER API v2.10.1 was queried with a future end date (`20261020`), its internal flux aggregation returned `PRECTOTCORR` with an hourly accumulation factor of 24x (e.g., 1991-04-01 was 46.08 mm instead of 1.92 mm; 2024-04-06 was 196.56 mm instead of 8.19 mm; annual rainfall in 2000 was 29,661 mm instead of 1,235.9 mm). This flooded the simulation with 2,000-5,000 mm of establishment rain and eliminated dry days (< 1.0 mm).
    2. **Forecast Splicing onto History**: Splicing the 2026 Open-Meteo forecast onto the first 16 days of every historical year masked each year's historical climate during the critical seedling stage.
- **Fixes Applied**:
  - **Unit Correction**: In `scripts/fetch-snapshots.ts`, divided NASA POWER `PRECTOTCORR` by 24 to restore true `mm/day`. Preserved `null` for missing sentinels (`-999`) rather than coercing to `0`. Re-ran `npm run snapshots:fetch` to update all snapshot files.
  - **Historical Analog Isolation**: Analog years evaluate THAT historical year's observed daily weather for seedling dry spells ($D+1..D+21$) and 30-day establishment ($D..D+30$). Forecast data is only used for the upcoming 2026 season.
  - **Missing-Day Policy**: In `src/core/simulate/stats.ts` (`longestDrySpell`), missing days (`null`) do NOT reset `currentStreak`, preventing hidden seedling death risks. If $>2$ missing days occur in seedling or establishment windows, the year is excluded and recorded in `evidence.excludedYears`. If $\le 2$ missing days occur, the year is retained with `lowConfidence: true`.
  - **Adequacy & Spread**: Returned uncapped `establishmentRainMm: { p10, p50, p90 }` alongside capped `rainfallAdequacy: { p10, p50, p90 }` (capped at 100 mm). Constants cited from DESIGN.md 6.1 or marked as assumptions.
  - **Removed Invented Economics**: Deleted all default economic constants (`DEFAULT_HECTARES`, `DEFAULT_BASE_YIELD_KG_PER_HA`, `DEFAULT_MAIZE_PRICE_NGN_PER_KG`, `DEFAULT_SEED_KG_PER_HA`, `DEFAULT_SEED_PRICE_NGN_PER_KG`, `DEFAULT_REPLANT_LABOUR_NGN_PER_HA`, `DEFAULT_RISK_AVERSION_LAMBDA`, default scores). Simulation returns pure weather-derived risk, adequacy, establishment rain, n, evidence, and notes unless typed economics are explicitly passed.
  - **Temporary script explanation (`update-leap.ts`)**: Clarified that `update-leap.ts` was a one-time utility to generate historical years 2016-2026 in `tests/fixtures/simulate/leap_year.json` so the fixture satisfied the minimum 5 analog years requirement. No tests were loosened.
  - **Regression Test**: Added test in `tests/planting.test.ts` verifying that if half of analog years have a 10-day dry spell, `replantProbability` is $\approx 0.5$ and adequacy $p10 < p90$.
- **Corrected Real-Data Simulation Results (`farm_bisi_ogbomoso`, `asOf=2026-04-10`)**:
  - **Plant now (`2026-04-10`)**: Replant probability: 14.1%, Establishment rain: p10=60.0 mm, p50=167.9 mm, p90=230.7 mm, Rainfall adequacy: p10=60.0%, p50=100.0%, p90=100.0%, $n = 35$, Low confidence: false.
  - **Wait 7 days (`2026-04-17`)**: Replant probability: 0.7%, Establishment rain: p10=100.7 mm, p50=159.2 mm, p90=251.9 mm, Rainfall adequacy: p10=99.5%, p50=100.0%, p90=100.0%, $n = 35$, Low confidence: false.
  - **Wait 14 days (`2026-04-24`)**: Replant probability: 0.7%, Establishment rain: p10=108.0 mm, p50=159.7 mm, p90=267.2 mm, Rainfall adequacy: p10=100.0%, p50=100.0%, p90=100.0%, $n = 35$, Low confidence: false.
- **Verification**: `npx tsc --noEmit` clean, 39 vitest tests passing across 5 test suites.

### 3.3 Root-Cause Fix for NASA POWER Data and Fail-Loud Sanity Check
- **Root-Cause Discovery**:
  - The 24x inflation observed in the NASA POWER PRECTOTCORR precipitation values was verified directly against the NASA POWER API (community AG, lat 8.13, lon 4.24):
    - Requesting with `end=20001231` or `end=20260409`: year 2000 totals 1,235.9 mm (matching official meteorological observations).
    - Requesting with `end=20261020` (a future end date): year 2000 totals 29,661.6 mm.
  - The issue is caused strictly by passing an end date in the future (`end > asOf`), which causes NASA POWER to aggregate hourly accumulation flux without daily division across the dataset. It is not an internal NASA factor or random API bug; it is directly triggered by requesting future dates.
- **Root-Cause Fix (`scripts/fetch-snapshots.ts`)**:
  - Replaced the `/ 24` division workaround with a clean root-cause fix: capped the NASA POWER query `end` parameter at `asOf - 1 day` (and never later than the day before the run date).
  - Removed the unconditional `/ 24` factor and preserved nulls for `-999` sentinels.
- **Fail-Loud Sanity Check (`validateNasaYearlyRainfall`)**:
  - Added strict annual rainfall validation after every NASA fetch: for every complete calendar year, total PRECTOTCORR must fall within reasonable climatic bounds (600 to 2,500 mm / year, with 2% tolerance to 2,550 mm for extreme flood years like Oyo 2021 at 2,545.6 mm).
  - If any complete year falls outside this range (e.g. 29,000 mm from a corrupted query or 3,398 mm), the function throws an error naming the farm, the year, and the total, and refuses to write the snapshot to disk.
- **Unit Testing & Sanity Validation**:
  - Added unit test in `tests/gateway.test.ts` verifying that a fake complete year totalling 29,000 mm throws naming the farm, year, and 29000.0 mm.
  - Re-ran `npm run snapshots:fetch`: `farm_bisi_ogbomoso` 2000-04-06 verified at 4.79 mm, year 2000 total verified at 1,235.9 mm.
  - Re-ran `scripts/debug-planting.ts`: verified planting options remain completely unchanged (`14.1%`, `0.7%`, `0.7%`; $n = 35$).
- **Verification**: `npx tsc --noEmit` passed with 0 errors; all 40 vitest tests passed across 5 test suites.
