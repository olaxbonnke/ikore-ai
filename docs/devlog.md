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

### 1.3 Zetaris: how the blocker was solved (Fri 23 Oct 2026)

The two official routes to running Zetaris were both closed to me. The local Docker install needs about 6 to 8 GB of memory for Docker alone, and my laptop has 8 GB in total. The managed route runs on your own AWS account, and AWS declined my Nigerian Naira card at account verification, so I couldn't create the account the cluster needs.

I emailed the organisers and asked on the hackathon's Zetaris help channel. The Zetaris team confirmed that they don't host instances for participants and that the approved routes are AWS or the local Docker install. A Zetaris team member then confirmed that a 4-core, 16 GB GitHub Codespace has enough resources to run the local install, which gave me a third path that stays within the rules.

What I set up:
- A private repository (oko-zetaris-box) with a devcontainer that requests a 4-core, 16 GB Codespace. The licensed Zetaris platform bundle and its .env stay inside the Codespace and are never committed.
- The standard local Docker Compose install of Zetaris, run inside the Codespace and checked with the platform's own verification script.
- An SSH tunnel from my Windows machine (gh codespace ssh with port forwards for 3000 and 8888), because the simpler gh codespace ports forward command failed with a channel error. With the tunnel open, the Zetaris UI and API appear on localhost as if Zetaris were running on my laptop.
- A separate PostgreSQL container (oko-postgres) on the same Docker network, registered in Zetaris as the JDBC datasource oko_pg. Ikore's farms, farm records, prices and 25,798 days of rainfall are loaded there, and the agent reads them only through Zetaris queries.
- Credentials come from .env and are templated into the SQL, so no password appears in the repository or its history.

While access was blocked I kept building against a SnapshotGateway that returns saved query results through the same interface. Now that Zetaris is live, the planting decision gives identical output whether it runs live through Zetaris or from snapshots, which is checked on every run.

Known limitations: Codespaces on a free GitHub account have a monthly usage limit, so I stop the Codespace when I'm not working and use snapshot mode for day-to-day coding. This setup suits a hackathon. A real deployment would run Zetaris on proper cloud infrastructure.

### 1.4 Snapshot Fetching
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
  - Added strict annual rainfall validation after every NASA fetch: for every complete calendar year, total PRECTOTCORR must fall within allowable bounds. Base bounds are 600 to 2,500 mm / year, with a 2% upper tolerance setting the actually enforced ceiling to 2,550 mm to accommodate verified extreme flood anomalies (e.g. Oyo 2021 at 2,545.6 mm). The error message explicitly states the enforced bounds `[600, 2550] mm`.
  - In `main()`, removed any per-farm try/catch: a sanity-check failure for ANY farm immediately throws and halts execution with exit code 1, ensuring snapshots are never partially or invalidly written.
  - If any complete year falls outside this range (e.g. 29,000 mm from a corrupted query, or Kaduna's 3,398.5 mm in 2020), the function throws an error naming the farm, the year, and the total, and refuses to write the snapshot to disk.
- **Unit Testing & Sanity Validation**:
  - Added unit test in `tests/gateway.test.ts` verifying that a fake complete year totalling 29,000 mm throws naming the farm, year, and 29000.0 mm.
  - Re-ran `npm run snapshots:fetch`: `farm_bisi_ogbomoso` 2000-04-06 verified at 4.79 mm, year 2000 total verified at 1,235.9 mm.
  - Re-ran `scripts/debug-planting.ts`: verified planting options remain completely unchanged (`14.1%`, `0.7%`, `0.7%`; $n = 35$).
- **Verification**: `npx tsc --noEmit` passed with 0 errors; all 40 vitest tests passed across 5 test suites.

### 3.4 Data Limitations Note: Oyo Focus & Spike Guard
- **Kaduna Dropped for Daily Spikes**:
  - Investigation into Kaduna (`farm_musa_kaduna`, lat 10.52, lon 7.44) revealed severe, physically impossible single-day precipitation spikes in NASA POWER PRECTOTCORR from 2019 onward (e.g. 724.3 mm on a single day in 2022, 340.1 mm in 2023; pre-2019 maximum daily precipitation was ~46-65 mm).
  - Consequently, `farm_musa_kaduna` was removed entirely from active snapshots, seeds, and tests. Oko is strictly focused on Oyo State (`farm_bisi_ogbomoso` and `farm_ade_iseyin`).
- **NASA vs ERA5 Divergence in Oyo**:
  - NASA PRECTOTCORR at Oyo farms exhibits no extreme single-day spikes (maximum observed day is ~114 mm), but reads systematically higher than ERA5 reanalysis from 2018 onward. Because ERA5 is documented to underestimate West African monsoon rainfall, absolute rainfall totals across datasets carry inherent uncertainty.
  - Crucially, Oko's decision models rely on **relative timing comparisons** (dry spell durations, analog-year similarity weighting, and relative adequacy across candidate planting windows) rather than uncalibrated absolute volumetric thresholds.
- **Daily Spike Guard (`MAX_DAILY_RAIN_MM = 200`)**:
  - Added `MAX_DAILY_RAIN_MM = 200` to `scripts/fetch-snapshots.ts`. Any daily rainfall exceeding 200 mm is treated as invalid and stored as `null` (matching the `-999` missing sentinel).
  - The date and original spiked value are recorded in the snapshot's provenance and params. The simulator's existing missing-day policy (> 2 missing days excludes the analog year) gracefully handles any corrupted seasons without hiding risks.
  - Re-fetched snapshots for Ogbomoso and Iseyin: 0 spikes were nulled (both farms operate within valid meteorology). Planting debug simulation results for `farm_bisi_ogbomoso` at `asOf = 2026-04-10` remain robustly verified at 14.1% (`plant_now`), 0.7% (`wait_7`), and 0.7% (`wait_14`) with $n=35$.

### 3.5 Zetaris Live SQL Client Integration
- **Live Endpoint Contract**:
  - Rewrote `ZetarisGateway.query()` to match Zetaris's official `scripts/zetaris_sql.py` (`RestChannel.run`):
    - Submits POST to `{restUrl}/sql-editor/sqls/run` with payload `{ queryId, sql, source: "SqlEditor", limit: queryLimit }`.
    - Authenticates via `Authorization: Bearer <apiKey>`, `X-Org-ID: <orgId>`, `X-Request-ID: <fresh uuid>`, `Content-Type: application/json`.
    - Removed `/query/sql/next` and `/query/sql/close` calls.
- **Dual Response Parsing (Array of Arrays & Array of Objects)**:
  - Supports `response.data` as an array of objects or an array of row arrays mapped with `headers`, `columns`, `schema`, `fields`, or `columnNames`.
  - Fallback logging: if format cannot be determined, logs response top-level keys and first row shape once (without tokens or secrets) and stops.
- **Timeouts & Robustness**:
  - Extended request timeout from 30s to 180s to accommodate initial Spark warming, configurable via `ZETARIS_TIMEOUT_MS`.
  - Used explicit `AbortController` timer cancellation to eliminate libuv Windows process teardown assertions.
  - Seamlessly handles Zetaris Lightning's namespace policy (mapping/falling back to `SHOW UC NAMESPACES IN spark_catalog` when unqualified `SHOW DATABASES` is queried).
- **Verification**:
  - `npm run zetaris:verify` connected to live Zetaris at `http://127.0.0.1:8888/api/v1.0`:
    - `SELECT 1 rows: 1`
    - `SHOW DATABASES rows: 1`
  - Vitest test suite updated and passing: 43 tests passed across 5 test suites; `tsc --noEmit` clean.

### 3.6 Zetaris Data Ingestion (Option A: PostgreSQL JDBC Datasource)
- **Architecture (Option A)**:
  - Spun up an isolated PostgreSQL container `oko-postgres` (`postgres:16-alpine`) attached to the `zetaris_default` bridge network with dedicated volume `oko_postgres_data` (IP: `172.18.0.6:5432`, db: `oko`, user: `oko`).
  - No existing Zetaris containers or volumes were modified.
- **Data Loading (`scripts/zetaris-load.ts`)**:
  - Built an automated, reproducible ingestion pipeline (`npm run zetaris:load`) that reads CSVs (`data/farms.csv`, `data/farm_records.csv`, `data/prices_monthly.csv`) and daily rainfall snapshots (`rain_daily__farm_bisi_ogbomoso.json`, `rain_daily__farm_ade_iseyin.json`).
  - Streams the SQL DDL and 25,800+ INSERT statements directly into `oko-postgres` via SSH `docker exec -i` in a single transaction.
  - Ingested table row counts:
    - `oko_pg.farms`: 2 rows
    - `oko_pg.farm_records`: 4 rows
    - `oko_pg.prices`: 12 rows
    - `oko_pg.rain_daily`: 25,798 rows
- **Zetaris Datasource Registration (`zetaris/sql/01_register_oko.sql`)**:
  - Leveraged Zetaris's bundled PostgreSQL driver (`/home/zetaris/zetaris-ndp-driver/lib/org.postgresql.postgresql-42.7.12.jar`).
  - Registered the datasource and imported table definitions using:
    ```sql
    CREATE DATASOURCE oko_pg DESCRIBE BY 'Oko Farm Agent Postgres Database' OPTIONS (
      jdbcdriver 'org.postgresql.Driver',
      jdbcurl 'jdbc:postgresql://${OKO_PG_HOST}:${OKO_PG_PORT}/${OKO_PG_DB}',
      username '${OKO_PG_USER}',
      password '${OKO_PG_PASSWORD}',
      fetchsize '1000'
    );

    REGISTER DATASOURCE TABLES FROM oko_pg;
    ```
- **Gateway Provenance & Proof Verification**:
  - Updated `ZetarisGateway` (`src/data/zetaris.ts`) to return `provenance: "Zetaris (local)"` for rows sourced from live Zetaris.
  - Executed proof query through `ZetarisGateway`:
    ```sql
    SELECT farm_id, year(date) y, sum(rain_mm)
    FROM oko_pg.rain_daily
    WHERE farm_id = 'farm_bisi_ogbomoso'
    GROUP BY 1, 2
    ORDER BY 2
    LIMIT 5
    ```
    Results:
    - 1991: 1,518.45 mm
    - 1992: 1,260.94 mm
    - 1993: 1,498.81 mm
    - 1994: 1,684.42 mm
    - 1995: 1,943.53 mm
    - Year 2000: **1,235.90 mm** (exact match to snapshot).
- **Verification**: `npx tsc --noEmit` passed with 0 errors; all 43 vitest tests passed across 5 test suites.

### 3.7 Product Renamed to Ikore AI
- **Naming Context**:
  - The product is renamed from "Oko" to **"Ikore AI"** (Ìkórè is Yoruba for harvest).
  - All user-facing surfaces (UI text, page titles, layout metadata, README, prompts, i18n fallback templates, package name and description) now refer to the agent as "Ikore AI" or "Ikore".
- **Infrastructure Preserved on Purpose**:
  - The internal 'oko' identifiers were kept intentionally to avoid breaking existing data layers, Docker compose setups, or cached assets:
    - Zetaris datasource: `oko_pg` (and table references e.g. `oko_pg.rain_daily`, `oko_pg.farms`).
    - PostgreSQL container and volume: `oko-postgres`, `oko_postgres_data`.
    - Environment variables: `OKO_PG_HOST`, `OKO_PG_PORT`, `OKO_PG_DB`, `OKO_PG_USER`, `OKO_PG_PASSWORD`, `OKO_DEMO_DATE`, `OKO_TZ`, `OKO_STATE_DIR`.
    - File system and memory paths: `.oko/`, `data/farms_seed.csv`, `zetaris/sql/01_register_oko.sql`.
    - Meterless HTTP header: `meterless-app: oko`.

### 3.8 Day 3: Planting Decision End-to-End
- **Options & Candidate Generation (`src/core/options.ts`)**:
  - Implemented `listOptions(intent)` and `getOptionDefinitions(intent, context)`.
  - For `plant_timing`: returns `["plant_now", "wait_7", "wait_14"]` (or `["wait_until_window"]` if outside season window).
- **Decide Engine & Risk-Adjusted Scoring (`src/core/decide.ts`)**:
  - Pure deterministic scoring: `score = expectedValue - lambda * downside` with lambda calibrated by farm risk aversion (low: 0.25, normal: 0.5, high: 1.0).
  - Evaluates close calls: If top two options are within 5% of each other, recommends the safer option (lower replanting risk).
  - **Tie-Break Rule**: When scores are within 5% (0.49% difference) and replanting risks are identical (0.7% vs 0.7%), the engine breaks the tie in favor of the earlier window (`wait_7` over `wait_14`) to maximize growing season length and prevent late-season terminal drought.
  - Automatically builds `Decision.keyNumbers` (replant risk %, rain p10/p50/p90, adequacy, n analog years, asOf) and `Decision.evidence` (Zetaris SQL on `oko_pg.rain_daily`, provenance, and 200 mm spike guard).
- **8-Step Agent Loop (`src/core/orchestrator.ts`)**:
  - Implemented end-to-end `handle(message)`:
    1. Understand: Rule-based intent and language classification for English/local terms.
    2. Recall: Retrieves past decisions from Meterless H-MEM.
    3. Observe: Loads daily rainfall via `DataGateway` (live Zetaris or snapshot fallback).
    4. Options: Generates candidate windows.
    5. Simulate: Pure physics simulation against 35 analog years (1991–2025).
    6. Decide: Computes verdict (`wait_7`), runner-up (`wait_14`), risk badge (`green`), and confidence (`high`).
    7. Explain: Grounded localized explanation from `src/i18n/templates.ts`.
    8. Remember: Writes advice event and audit trail to farm H-MEM ledger.
- **CLI (`scripts/ask.ts`)**:
  - `npx tsx scripts/ask.ts farm_bisi_ogbomoso "when should I plant?"` tested and verified in both live Zetaris mode (provenance: `Zetaris (local)`) and snapshot mode (provenance: NASA POWER + Open-Meteo URLs). Both return identical verdicts (`wait_7`) and identical replant risk reduction (14.1% down to 0.7%).
- **Verification**: `npx tsc --noEmit` clean (0 errors); all 47 vitest tests passed across 6 test suites.

### 3.9 Day 3 Simulation Audit & NiMet 2026 Onset Benchmark
- **Simulation Audit & Zero Look-Ahead**:
  - Audited `src/core/simulate/planting.ts` and removed post-`asOf` forecast checks from the pure analog-year simulation.
  - Added unit test in `tests/planting.test.ts` verifying that mutating (injecting extreme 150 mm/day spikes) or completely truncating all rainfall on or after `asOf` results in bit-for-bit identical risk probabilities (14.1% vs 0.7%), rainfall adequacy, establishment precipitation, and scoring.
  - Updated snapshot provenance reporting in `src/core/observe.ts` to reflect only the historical NASA POWER climate dataset actually utilized.
  - Formatted farmer-facing tie-break note to state only what the model computes ("equal replant risk, so the earlier date is chosen to keep more of the season") and properly attributed the seedling dry spell criterion ("more than 7 dry days within the first 21 days after planting, adapted from Sivakumar (1988), whose onset criterion uses 30 days").
  - Grounded the internal expected value baseline of ₦1,400,000 (2 ha × 2,000 kg/ha × ₦350/kg) in `Decision.assumptions` rather than presenting it as an ungrounded farmer revenue guarantee.
- **NiMet 2026 Onset Benchmark Integration**:
  - Seeded official NiMet 2026 Oyo onset forecast (15–30 April 2026, wait 10–15 days, 50% soil moisture threshold; NIHORT downscaled SCP citation) into `data/nimet_onset_2026.csv` and created offline snapshot `data/snapshots/nimet_onset__2026.json`.
  - Added `nimet_onset` DDL and quote-aware CSV parsing to `scripts/zetaris-load.ts`, loaded the table into `oko-postgres`, and registered as `oko_pg.nimet_onset` in Zetaris.
  - Added parameterized query `queries.nimetOnset(state, season)` to `src/data/queries.ts`.
  - Wired in `src/core/orchestrator.ts` to query NiMet onset for the farm's state and season, and add neutral benchmark evidence to `Decision.evidence` comparing recommended planting date (e.g. 17 April) against NiMet's window (omitted silently if no benchmark row exists for state/season).
  - Added comprehensive unit tests in `tests/decide.test.ts` covering inside-window, outside-window, and missing benchmark rows.
- **Verification**: `npx tsc --noEmit` clean (0 errors); all 51 vitest tests passed across 6 test suites; live query via `scripts/ask.ts` verified with Zetaris.

## Day 4: Sat 24 Oct 2026

### 4.1 Sell-or-Store Decision & Seasonality Model
- **WFP Wholesale Seasonality**: Switched to WFP Ibadan "Maize (white)", unit 100 KG, Wholesale (2010 to 2023, 14 years), with yellow wholesale fallback for missing months.
- **Detrending Method Difference**: Within-year storage horizons (4w, 8w, 12w) use empirical within-year ratios because general inflation over 1–3 months within the same calendar year is negligible and within-year calendar means cancel out. The 24-week horizon (`store_24w`, August to February) crosses the calendar year boundary; in Nigeria's inflationary macroeconomic environment (15–30% p.a.), raw cross-year comparisons would mistake general currency inflation for grain storage upside. It is therefore detrended with a 12-month centred moving average (2x12 CMA) strictly before `asOf` (requiring full windows up to $t+6$ months before `asOf`), expressing returns in today's money, after allowing for general price rises.
- **Count-Based Honest Explanations**: Avoided small-sample percentages (e.g. 100%) in farmer-facing text, communicating exact historical counts ("In 8 of the 9 past years with data, Ibadan wholesale maize was cheaper a month after August than in August").

### 4.2 Multilingual Plain-Language Explanations & Number Validator
- **Supported Languages**: Built end-to-end plain-language explanation pipelines and fallback templates for English (`en`), Nigerian Pidgin (`pcm`), and Yoruba (`yo`), while retaining Hausa (`ha`) in the `Lang` type union.
- **Deterministic Templates First**: Implemented fully grounded deterministic fallback templates in `src/i18n/templates.ts` covering all verdicts (`plant_now`, `wait_7`, `wait_14`, `sell_now`, `store_4w`, `store_8w`, `store_12w`, `store_24w`, `partial_sell_store_8w`). Every template fills strictly from `Decision.keyNumbers` with zero ungrounded interpolations.
- **Strict Number Validator**: Implemented `findInvalidNumbers(text, decision)` normalizing currencies (`₦`, `k`, `naira`), percentages, counts, floats, and dates. Separated `allowedPercentages` ($0..1$ probabilities) from `allowedNumbers` to prevent small probabilities ($<0.5$) from rounding to $0$ and permitting hallucinated integer percentages. Any ungrounded number triggers immediate fallback to the deterministic template.
- **Yoruba Diacritic & Vocabulary Guard**: Implemented `validateYoruba(text)` requiring presence of standard Yoruba tone marks/subdots (`á, à, é, è, ẹ́, ẹ̀, í, ì, ó, ò, ọ́, ọ̀, ú, ù, ṣ`) and enforcing an English stopword ratio $\le 35\%$. Unaccented or English-heavy replies are rejected and routed to the validated template.
- **Multilingual Understanding (`src/llm/understand.ts`)**: Built structured query understanding with Unicode word boundary regex (`(?<=^|\P{L})...(?=\P{L}|$)`) to reliably parse accented Yoruba and Pidgin keywords and extract quantities (e.g. `20 bags`), prices (`45k`, `₦45,000`), and intent.
- **Unit & Live QA Matrix**: Added 17 unit tests in `tests/explain-validator.test.ts` (77 total tests passing offline). Conducted live snapshot QA against Nemotron (`nvidia/nemotron-3.5-lightning-30b-a3b`) recorded in `docs/lang-qa.md`.
- **Reasoning Disabled & Speed Optimization**: Switched Nemotron API payloads to use `chat_template_kwargs: { enable_thinking: false }` with `max_tokens: 600`, cutting response latency from 30–120s down to 1.2–2.9s with confirmed 0 reasoning token overhead.
- **Cross-Option Attribution & Spec Tightening**: Passed labelled facts grouped by option (`factsByOption`) instead of flat lists. Added validator checks rejecting headline > 12 words, reason > 2 sentences, reason > 3 numbers, ISO dates, technical jargon (analog years, median, mm), and cross-option risk attributions (e.g. attaching 14.1% replant risk beside 'wait'). 5 out of 6 live multilingual runs were generated directly by Nemotron with authentic Yoruba tone marks and natural Pidgin phrasing.
- **Plain Chances & Bag Counts**: Farmer replies use plain chances and bag counts instead of percentages; exact figures stay in the evidence panel. All 6 live multilingual QA runs in `docs/lang-qa.md` now pass with Nemotron LLM generation (6/6).
