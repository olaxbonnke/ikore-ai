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
  - Result: `npx tsc --noEmit` clean pass; all 24 vitest tests passed.
