# Ikore AI

Ìkórè means harvest in Yoruba.

Ikore AI is a farm decision agent designed to empower Nigerian smallholder farmers with data-grounded agronomic and economic intelligence. It addresses two critical inflection points that determine a farmer's seasonal livelihood:
1. **When to plant**: Minimising false-start replanting risk and ensuring adequate seasonal rainfall through historical analog-year analysis and forecast integration.
2. **Whether to sell or store**: Comparing immediate harvest prices against storage costs, post-harvest loss curves, and seasonal market price appreciation.

> **Current Implementation & Scope**: Maize in Oyo State (e.g. Ogbomoso and Iseyin) is the first supported crop and geography. The crop parameters, agronomic thresholds, and data adapters are designed to extend cleanly to other crops (e.g. sorghum, cassava) and states, but currently only **maize in Oyo State** is fully implemented and validated against real satellite and historical records.

---

## Architecture & Core Tech

Ikore AI combines deterministic agronomic modeling with modern agent infrastructure:

- **Data Layer (Zetaris)**: Federated, read-only data access over 35+ years of daily climate history (NASA POWER PRECTOTCORR), 16-day weather forecasts (Open-Meteo), WFP monthly market prices, and crop calendars via `DataGateway` (`ZetarisGateway` in live mode, `SnapshotGateway` for offline reproducible evaluation).
- **Farm Memory & Ledger (Meterless H-MEM)**: Multi-session, auditable memory per farm using real Meterless H-MEM services (`MemoryMiningService`, `MemoryRetrievalService`, `TrustLedgerService`, `SleepCycleService`).
- **Explanation Layer (NVIDIA Nemotron via Nightshift)**: Models run through Meterless Nightshift (primary AI provider). NVIDIA Nemotron writes the farmer-facing explanations in English, Nigerian Pidgin and Yoruba. The NVIDIA key is stored in Nightshift's Providers tab, not in this project. Crucially, **the language model never invents or alters numbers**; all figures originate strictly from pure simulation code.
- **Pure Simulation Engine**: 100% deterministic, pure functions taking explicit `asOf` dates (Africa/Lagos timezone) with zero unseeded randomness or ungrounded heuristics.

---

## Quickstart

### Prerequisites
- Node.js 20+
- npm

### Installation
```bash
git clone https://github.com/olaxbonnke/oko-farm-agent.git
cd oko-farm-agent
npm install
```

> **H-MEM Engine (Clean-Clone & Bundling)**:
> The Meterless H-MEM reference engine is vendored in `vendor/hmem` under its original Apache-2.0 license and committed with pre-built ESM distribution (`vendor/hmem/dist/index.js`). A fresh clone has full H-MEM memory capabilities out of the box with zero external downloads and no risk of degit rate limits.
> If you ever need to re-vendor or refresh the upstream reference implementation from Meterless:
> ```bash
> npm run setup        # Clones upstream reference into vendor/hmem and builds vendor/hmem/dist/index.js
> ```


### Verification & Testing
```bash
npm test             # Runs all Vitest test suites (pure simulations, memory, gateway)
npx tsc --noEmit     # Validates TypeScript types strictly
npm run zetaris:verify # Verifies live Zetaris connectivity or fallback
```

### Running the App
```bash
npm run dev          # Next.js development server at http://localhost:3000
npm run demo         # Runs snapshot-backed demo with seeded farm memories
```

---

## Key Commands

- `npm test`: Run full Vitest test suite.
- `npm run setup`: Vendor Meterless H-MEM reference into `vendor/hmem`.
- `npm run seed`: Seed demo farm profiles into H-MEM memory.
- `npm run zetaris:verify`: Test connectivity to live Zetaris or offline fallback.
- `npm run zetaris:load`: Ingest tables into PostgreSQL container and register JDBC datasource in Zetaris.
- `npm run snapshots:fetch`: Fetch live NASA POWER and Open-Meteo climate data with sanity bounds.
- `npx tsx scripts/nightshift-models.ts`: Inspect available model IDs registered in Meterless Nightshift.
- `npx tsx scripts/nightshift-smoke.ts`: Send a test decision explanation through Nightshift and verify model attribution.

---

## AI and Model Usage

Models run through Meterless Nightshift (primary AI provider). NVIDIA Nemotron [exact id] writes the farmer-facing explanations in English, Nigerian Pidgin and Yoruba. The NVIDIA key is stored in Nightshift's Providers tab, not in this project.

- **Routing & Credentials**: All chat completion requests route to `METERLESS_BASE_URL` with bearer token `METERLESS_RUNTIME_TOKEN` and header `meterless-app: ikore-ai`. No NVIDIA keys or direct NVIDIA endpoints are accessed by application code.
- **Model Attribution**: The model that actually answers is read directly from the response's `model` field, logged in a structured call log, and added as proof to the `Decision.evidence` panel (`[ev_explanation_model]`).
- **Thinking Tokens**: `chat_template_kwargs { enable_thinking: false }` is dynamically passed exclusively to Nemotron models to minimize latency.
- **Offline / Sample Mode**: Setting `SAMPLE_MODE=true` disables all Nightshift network calls and immediately serves verified deterministic templates.
