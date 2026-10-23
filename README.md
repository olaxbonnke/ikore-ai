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
- **Explanation Layer (NVIDIA Nemotron)**: Explains decisions in plain, local language (English, Nigerian Pidgin, Yoruba, and Hausa). Crucially, **the language model never invents or alters numbers**; all figures originate strictly from pure simulation code.
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
npm run setup        # Vendors Meterless H-MEM reference into vendor/
```

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
