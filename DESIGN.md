# DESIGN.md: Ikore AI technical and product design

Read PROJECT.md first. This file is the source of truth for **how** Ikore AI is built. If code and this file disagree, update this file in the same change.

---

## 1. Architecture overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Web app (Next.js)                            │
│  Chat (WhatsApp-style)  │  Evidence panel  │  Farm switcher │ Briefs │
└──────────────┬───────────────────────────────────────────────────────┘
               │  POST /api/chat, GET /api/briefings, GET /api/audit/:id
┌──────────────▼───────────────────────────────────────────────────────┐
│                      Agent orchestrator (core/)                      │
│                                                                      │
│  1 Understand ─► 2 Recall ─► 3 Observe ─► 4 Options ─► 5 Simulate     │
│      (LLM)        (H-MEM)    (Zetaris)    (code)       (code)        │
│                                                          │           │
│  8 Remember ◄── 7 Explain ◄────────── 6 Decide ◄─────────┘           │
│   (H-MEM)        (LLM, grounded)       (code)                        │
└───────┬───────────────┬───────────────────────┬──────────────────────┘
        │               │                       │
┌───────▼──────┐ ┌──────▼─────────┐  ┌──────────▼──────────────────────┐
│ Meterless    │ │ LLM providers  │  │ DataGateway                      │
│ H-MEM engine │ │  - NVIDIA      │  │  - ZetarisGateway (REST /api/v1.0)│
│ (memory,     │ │    Nemotron    │  │  - SnapshotGateway (offline cache,│
│  ledger,     │ │  - Meterless   │  │    clearly labelled, judges only) │
│  sleep)      │ │    Runtime     │  └──────────┬──────────────────────┘
└──────────────┘ └────────────────┘             │ SQL
                                     ┌──────────▼──────────────────────┐
                                     │ Zetaris (federated, read-only)   │
                                     │  open_meteo_forecast (REST table)│
                                     │  nasa_power_daily   (REST table) │
                                     │  wfp_prices_nga     (CSV table)  │
                                     │  soil_props         (REST/CSV)   │
                                     │  crop_calendar      (CSV table)  │
                                     │  farm_records       (CSV/Sheet)  │
                                     └─────────────────────────────────┘

Nightly: `npm run nightshift` ─► for each farm: Observe ─► Simulate ─► Decide
          ─► write Briefing ─► H-MEM sleep cycle (consolidate) ─► audit log
```

### Design principles (don't break these)
1. **The language model never makes up a number.** Every figure in a reply comes from the `Decision` object computed in code. The explanation step gets only that object and must quote its values.
2. **All external data goes through Zetaris.** The agent never calls a weather or price API directly at runtime. (Exception: `SnapshotGateway` replays cached Zetaris query results for offline judging, and the interface labels it "Offline snapshot".)
3. **Every claim is traceable.** Each evidence item carries `{source, sql, rowRef, statistic}`. Each decision is written to H-MEM and its ledger.
4. **The answer comes first, short and in the farmer's language.** Verdict in 1 line, reason in 1 or 2 lines, then numbers on request or in the evidence panel.
5. **Deterministic core, testable without network.** The simulation and scoring modules are pure functions with unit tests and fixtures.

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** (Node 20+) | The Meterless starter and H-MEM reference are TS. One language end to end. |
| Package manager | npm (match the Meterless starter) | Fewer surprises with the starter's scripts |
| Web | **Next.js 15 (App Router)** + React + Tailwind CSS | Fast to build; API routes live in the same app |
| Charts | Recharts | Simple line/area/bar charts for evidence |
| Memory | **Meterless H-MEM** (vendored by the starter's `npm run setup`) | Required sponsor tech; persistent local memory with ledger and sleep cycle |
| Data | **Zetaris Cloud** via REST (`/api/v1.0`), plus Zetaris MCP in Cursor during development | Required sponsor tech; federated read-only SQL |
| LLM (reasoning and language) | **NVIDIA Nemotron** via NVIDIA's OpenAI-compatible API (build.nvidia.com) | Nemotron prize; strong reasoning |
| LLM (local / fallback) | **Meterless Runtime** OpenAI-compatible provider (`http://127.0.0.1:8088/v1`, model `meterless/auto`) | Local-first; extra sponsor depth |
| Overnight jobs | `scripts/nightshift.ts`, run by Meterless Nightshift if available on your OS, otherwise Windows Task Scheduler or cron, recorded as a Meterless job | Overnight re-planning |
| Tests | Vitest | Fast, TS-native |
| Validation | Zod | Validate LLM JSON outputs and API responses |

**Check on Day 1:** the Meterless README says Nightshift runs on "Mac, Windows PC or DGX Spark", but also says "Nightshift for Mac ships Q4 2026". Check what installs on your machine. If Nightshift isn't installable, keep the job as a script, register it with the H-MEM SleepCycle, and say so honestly in the write-up.

---

## 3. Repository layout

```
oko-farm-agent/
├── AGENTS.md                  # rules for coding agents (Cursor reads this)
├── PROJECT.md / DESIGN.md / INSTRUCTIONS.md / DATA.md
├── .cursor/rules/oko.mdc      # points Cursor at AGENTS.md
├── .env.example
├── package.json
├── vendor/                    # Meterless H-MEM (from `npm run setup`; gitignored)
├── .oko/                      # local H-MEM state + caches (gitignored)
├── zetaris/
│   ├── sql/
│   │   ├── 00_database.sql
│   │   ├── 10_open_meteo.sql
│   │   ├── 20_nasa_power.sql
│   │   ├── 30_wfp_prices.sql
│   │   ├── 40_soil.sql
│   │   ├── 50_crop_calendar.sql
│   │   ├── 60_farm_records.sql
│   │   └── 90_views.sql
│   └── verify.sql             # one SELECT per table; must all return rows
├── data/
│   ├── crop_calendar_maize_ng.csv
│   ├── farms_seed.csv
│   ├── storage_loss.csv
│   └── snapshots/             # cached Zetaris query results (JSON) for offline demo
├── src/
│   ├── core/
│   │   ├── types.ts           # all shared types (section 5)
│   │   ├── orchestrator.ts    # the 8-step loop
│   │   ├── understand.ts      # intent + slot extraction (LLM → Zod)
│   │   ├── observe.ts         # builds Observation from DataGateway
│   │   ├── options.ts         # candidate actions per intent
│   │   ├── simulate/
│   │   │   ├── planting.ts    # analog-year + forecast simulation
│   │   │   ├── selling.ts     # seasonality + storage loss simulation
│   │   │   └── stats.ts       # percentiles, dry-spell detection, etc.
│   │   ├── decide.ts          # risk-adjusted scoring + verdict
│   │   ├── explain.ts         # grounded explanation (LLM) + validator
│   │   └── briefing.ts        # morning briefing composer
│   ├── data/
│   │   ├── gateway.ts         # DataGateway interface
│   │   ├── zetaris.ts         # ZetarisGateway (REST client)
│   │   ├── snapshot.ts        # SnapshotGateway (reads data/snapshots)
│   │   └── queries.ts         # every SQL string, named + parameterised
│   ├── memory/
│   │   └── hmem.ts            # thin wrapper over vendored H-MEM services
│   ├── llm/
│   │   ├── provider.ts        # LLM interface
│   │   ├── nvidia.ts          # Nemotron
│   │   ├── meterless.ts       # Meterless Runtime
│   │   └── prompts/           # system prompts as .md files (section 8)
│   ├── i18n/
│   │   ├── glossary.ts        # fixed terms per language (section 8.4)
│   │   └── numbers.ts         # naira + date formatting per language
│   └── app/                   # Next.js app router
│       ├── page.tsx           # chat UI
│       ├── briefings/page.tsx
│       ├── api/chat/route.ts
│       ├── api/briefings/route.ts
│       └── api/audit/[id]/route.ts
├── scripts/
│   ├── zetaris-apply.ts       # runs zetaris/sql/*.sql in order
│   ├── zetaris-verify.ts
│   ├── snapshot.ts            # records Zetaris results to data/snapshots
│   ├── seed-farms.ts          # writes seeded farm profiles into H-MEM
│   └── nightshift.ts          # overnight replanning
├── tests/
│   ├── fixtures/              # small rainfall + price series
│   ├── stats.test.ts
│   ├── planting.test.ts
│   ├── selling.test.ts
│   ├── decide.test.ts
│   └── explain-validator.test.ts
└── docs/
    ├── architecture.png
    ├── deck.pdf
    └── SUBMISSION.md          # written sponsor-tech + Cursor explanation
```

---

## 4. The agent loop in detail

`orchestrator.handle(message: IncomingMessage): Promise<AgentReply>`

### Step 1: Understand (LLM, Nemotron)
- Input: user text, farm ID, recent turns (last 6).
- Output (Zod-validated JSON):
```ts
{ intent: "plant_timing" | "sell_or_store" | "why" | "briefing" | "profile_update" | "smalltalk" | "unknown",
  language: "en" | "pcm" | "yo" | "ha",
  slots: { crop?: "maize", bags?: number, bagKg?: number, pricePerBagNgn?: number,
           storage?: "sack" | "pics" | "silo" | "unknown", cashNeedNgn?: number, cashNeedByDate?: string,
           decisionRef?: string },
  missing: string[] }       // slots needed to answer and not yet known (after recall)
```
- If `missing` is still non-empty after recall (step 2), ask ONE short question in the user's language and stop (no simulation).
- Detect language from the text; the farm's preferred language is the fallback.

### Step 2: Recall (Meterless H-MEM)
- `hmem.ask(farmId, query)` retrieves: the farm profile, last decision of the same intent, last stated price, storage method, cash needs, and outcomes of past advice.
- Fill missing slots from memory (e.g. storage method remembered from last season). Record which memory IDs were used. They go into the evidence and the audit trail.

### Step 3: Observe (Zetaris)
Build an `Observation` with named Zetaris queries (all in `src/data/queries.ts`):
- `forecast16d(lat, lon)`: daily precipitation, temperature max/min, ET0 for the next 16 days.
- `rainHistory(lat, lon, fromYear=1985)`: daily corrected precipitation (NASA POWER `PRECTOTCORR`).
- `recentRain(lat, lon, days=21)`: observed rain in the last 21 days (NASA POWER, lags a few days; combine with Open-Meteo `past_days`).
- `soil(lat, lon)`: texture, water-holding proxy, pH, N, organic carbon (if a soil source is available; optional).
- `priceSeasonality(state="Oyo", commodity in ("Maize (white)","Maize (yellow)"))`: monthly price index (section 6.2).
- `cropCalendar(crop="maize", zone)`: planting window, days to maturity, water need.
- `farmRecords(farmId)`: past yields and sale prices if present.
Each query result keeps `{queryName, sql, executedAt, rowCount, source}` for evidence.

### Step 4: Options (code)
- `plant_timing`: `["plant_now", "wait_7", "wait_14"]`. If today is outside the crop calendar window, add a note and make `wait_until_window` the only option.
- `sell_or_store`: `["sell_now", "store_4w", "store_8w", "store_12w"]`. Remove options that break the cash need (if `cashNeedByDate` comes before the store end and storing can't cover it, drop it and flag the reason).

### Step 5: Simulate (code; see section 6)
Gives each option an `OutcomeDistribution` with p10, p50, p90 and a risk metric.

### Step 6: Decide (code)
- Score = expected value minus λ × downside (λ = 0.5 by default; configurable per farm: `riskAversion` low 0.25, normal 0.5, high 1.0).
- Choose the top option. If the top two are within 5% of each other, say it's a close call and recommend the safer one.
- Assign confidence: `high` if the gap to second place is over 15% and n_analog_years ≥ 25; `medium` if over 5%; otherwise `low`.
- Risk badge: green (risk < 15%), amber (15 to 35%), red (> 35%), using the main risk metric of the chosen option.

### Step 7: Explain (LLM, grounded)
- Input: the `Decision` object only (plus language and the glossary). No raw data.
- Output JSON: `{ headline, reason, details[], followUpQuestion? }` in the target language.
- **Validator** (`explain.ts`): pull every number out of the generated text and check that each one appears in the `Decision` (allowing formatting differences: "₦118,000", "118k", "118 thousand", and dates in local formats). If the check fails, retry once with the validator's error message. If it fails again, fall back to a **template explanation** (pre-written per language in `src/i18n/templates.ts`). Never ship unvalidated numbers.

### Step 8: Remember (H-MEM)
- `remember` the decision as an event: `{type:"advice", intent, verdict, decisionId, keyNumbers, evidenceRefs, date}`.
- Remember any new facts the user gave (price, bags, storage, cash need) as `farm_fact` events.
- The ledger gets an entry automatically through TrustLedgerService. `GET /api/audit/:decisionId` returns the ledger history plus the evidence list.
- Feedback: thumbs up/down in the UI calls `hmem.feedback(memoryId, "helpful" | "not_helpful")`.
- Later outcomes ("I planted on 2 Nov and it germinated well", "I sold at ₦61,000") become `outcome` events linked to `decisionId`.

---

## 5. Core types (`src/core/types.ts`)

```ts
export type Lang = "en" | "pcm" | "yo" | "ha";

export interface Farm {
  id: string;                 // "farm_bisi_ogbomoso"
  ownerName: string;          // "Mama Bisi"
  lat: number; lon: number;   // field centroid
  state: string; lga: string; // "Oyo", "Ogbomoso North"
  crop: "maize";
  hectares: number;
  storage: "sack" | "pics" | "silo" | "unknown";
  preferredLang: Lang;
  riskAversion: "low" | "normal" | "high";
  zone: "derived_savanna" | "southern_guinea" | "northern_guinea" | "sudan"; // agro-ecological zone
}

export interface EvidenceItem {
  id: string;                 // "ev_03"
  kind: "forecast" | "history" | "price" | "soil" | "calendar" | "memory" | "assumption";
  label: string;              // human label, English (translated at render)
  source: string;             // "NASA POWER via Zetaris" | "WFP VAM via Zetaris" | "H-MEM mem-12"
  sql?: string;               // the exact SQL run in Zetaris
  queryName?: string;
  statistic?: string;         // "31 of 40 analog years had a dry spell > 7 days"
  value?: number | string;
  unit?: string;
  chart?: ChartSpec;          // optional data for the evidence panel
}

export interface OutcomeDistribution {
  p10: number; p50: number; p90: number;   // in the option's unit (₦ or %)
  mean: number;
  riskMetric: number;          // 0..1 (replant probability, or prob. of losing money vs sell_now)
  riskLabel: string;           // "replanting risk" | "chance of earning less than selling now"
  n: number;                   // number of simulated samples / analog years
}

export interface OptionResult {
  option: string;              // "wait_7"
  label: string;               // "Wait 7 days"
  outcome: OutcomeDistribution;
  score: number;
  notes: string[];             // e.g. "Outside recommended window after 14 days"
}

export interface Decision {
  id: string;                  // "dec_2026-10-24_bisi_plant_01"
  farmId: string;
  intent: "plant_timing" | "sell_or_store";
  createdAt: string;           // ISO with offset, Africa/Lagos
  options: OptionResult[];
  chosen: string;
  runnerUp: string;
  confidence: "high" | "medium" | "low";
  riskBadge: "green" | "amber" | "red";
  keyNumbers: Record<string, number | string>; // every number the explanation may quote
  evidence: EvidenceItem[];
  assumptions: string[];       // "Storage loss in sacks: 1.5%/month (configurable)"
  dataMode: "live" | "snapshot";
}

export interface AgentReply {
  text: string;                // what the farmer reads
  lang: Lang;
  decision?: Decision;
  askedQuestion?: boolean;
  memoryIdsUsed: string[];
}
```

---

## 6. Simulation models (pure functions; unit-tested)

### 6.1 Plant timing (`simulate/planting.ts`)

**Agronomy definitions (put these on the evidence panel and in the README):**
- **Onset of rains (agronomic):** the first day from which **≥ 20 mm of rain falls within 3 consecutive days**, and **no dry spell of more than 7 consecutive days** happens in the following 30 days. This criterion is widely used in West African agroclimatology (Sivakumar 1988-style definition). Cite it in the README.
- **Dry day:** a day with < 1 mm rain.
- **False start / replant event:** after a candidate planting date D, there's a run of **> 7 consecutive dry days** within **days 1 to 21** after D (seedling stage). This means a high chance of replanting.
- **Season water adequacy:** total rain from D to D+100 days (maize 90 to 120 days to maturity) compared with the maize requirement range of **500 to 800 mm** (configurable in `crop_calendar_maize_ng.csv`). Score = min(1, rain / 500).

**Method: analog years plus forecast splice**
1. Load daily rain for the farm's coordinates from 1985 to last year (about 40 seasons) via `rainHistory`.
2. For each candidate option, let the planting date be `D = today + offset` (0, 7 or 14).
3. For each historical year y:
   - Build a rain series for days D to D+100. For the **first 16 days**, use the **Open-Meteo forecast** (its own values; it's the same for every year). After that, use **year y's observed rain for the same calendar days**. This "splice" gives an ensemble of about 40 plausible futures based on today's forecast.
   - (Optional, better) Analog weighting: give years more weight when their rainfall in the **past 21 days** was similar to this year's observed past 21 days. Weight `w_y = exp(-|R21_y − R21_now| / σ)`, with σ = the standard deviation of R21 across years. Show "most similar years: 2003, 2011, 2019" in evidence.
   - Compute: `replant_y` = 1 if a dry spell > 7 days happens in D+1 to D+21, otherwise 0; `adequacy_y` = min(1, sum(rain D to D+100) / 500).
4. Aggregate over years (weighted): `replantProb = Σ w·replant / Σ w`; adequacy p10, p50, p90.
5. **Expected value in naira** (so both decisions use naira):
   - `expectedYieldKg = hectares × baseYieldKgPerHa × adequacy` (baseYieldKgPerHa default 2,000 kg/ha for smallholder maize; configurable and labelled as an assumption).
   - `replantCost = hectares × (seedKgPerHa × seedPrice + replantLabourPerHa)` (defaults are assumptions: 25 kg/ha seed; seed price and labour from the farmer or config; label them).
   - Late planting penalty: if D is past the calendar's "optimal end", yield multiplier is 0.98 per day late (configurable).
   - `value_y = expectedYieldKg_y × expectedPricePerKg − replant_y × replantCost`.
   - Outcome p10, p50, p90 of `value_y`; `riskMetric = replantProb`.
6. If the forecast shows ≥ 20 mm in 3 days but a ≥ 7-day dry gap in days 4 to 16, add evidence: "Forecast shows a dry gap from {date} to {date}".

**Edge cases:** missing data days. If more than 5% of a year is missing, drop that year and report n. Coordinates come from the farm. NASA POWER is about 0.5° resolution (say so in assumptions).

### 6.2 Sell or store (`simulate/selling.ts`)

**Price seasonality index (from WFP data via Zetaris):**
1. Take `wfp_prices_nga` rows where `admin1 = 'Oyo'` (market Ibadan) and the commodity is maize (white or yellow; prefer white, fall back to yellow) and `pricetype` is Retail (or Wholesale if present), with unit KG.
2. Remove the long-term trend (inflation): for each year, divide each month's price by that year's 12-month centred moving average, or simply by the annual mean.
3. Seasonal index `S[m]` = median across years of the detrended price for month m (1 to 12). Normalise so the mean of S = 1.
4. Variability: for each year, compute the ratio `r(m→m+k) = P[m+k]/P[m]` (detrended). Keep the empirical distribution of these ratios for each starting month and horizon k ∈ {1, 2, 3} months. This gives p10, p50, p90 without assuming a distribution.
5. **Important data fact (checked 2026-10-21):** Oyo/Ibadan maize prices in the WFP file run only to **January 2023** (316 rows from Ibadan). Use them only for **seasonal shape**. The current price level comes from **the farmer's stated price** (asked in chat, remembered in H-MEM). Show both in evidence: "Seasonal pattern: WFP Ibadan maize 20XX to 2023 (n years)" and "Today's price: you told me ₦52,000/bag on 24 Oct". Optionally show Borno/Yobe 2026 maize flour series as a sense check of the current market trend. Label it as a different product and region.

**Storage loss model (`data/storage_loss.csv`, assumptions; cite sources in README):**
| storage | monthly weight loss | notes |
|---|---|---|
| sack (polypropylene, no treatment) | 2.5% | weevils and moisture, higher in the humid south |
| sack + approved insecticide | 1.0% | |
| pics (hermetic triple bag) | 0.3% | hermetic storage; strong evidence base (Purdue PICS) |
| silo (metal) | 0.3% | |
These are assumptions to label clearly. Let the farmer override them. If you find a better published figure (APHLIS, the African Postharvest Losses Information System), use and cite it.

**Simulation per option k ∈ {0, 1, 2, 3} months (sell_now, store_4w, store_8w, store_12w):**
- `bagsLeft = bags × (1 − loss_m)^k`
- `price_k = currentPrice × r(m→m+k)` for each historical ratio sample
- `value = bagsLeft × price_k − storageCost × k` (storageCost default ₦0 if stored at home; PICS bag cost can be a one-off: ₦X per bag, an assumption)
- Cash need: if `cashNeedNgn` is due before month k, check `bags × currentPrice ≥ cashNeedNgn`. Otherwise suggest a **partial sale**: sell just enough bags now to cover the need and store the rest. (Partial sale is a strong extra option. Add `partial_sell_store_8w` when a cash need exists.)
- `riskMetric = P(value < value_sell_now)`.

### 6.3 Shared stats (`simulate/stats.ts`)
- `longestDrySpell(series, start, end, threshold=1)`
- `findOnset(series, fromDate, rule={mm:20, days:3, noDry:7, within:30})`
- `weightedPercentile(values, weights, p)`
- `movingAverage`, `median`, `detrendByAnnualMean`
- Test every function with small fixtures (tests/fixtures/*.json) that include edge cases: all dry, all wet, missing days, leap years.

---

## 7. Data layer: Zetaris (see DATA.md for sources)

### 7.1 Connection (REST)
- API base: `ZETARIS_REST_URL` (e.g. `https://api.saas.enterprise.zetaris.com/api/v1.0`, or the URL your Zetaris Cloud instance gives you).
- Headers on every request: `Authorization: Bearer <token or API key>`, `X-Org-ID: <org id>`, `X-Request-ID: <uuid v4>` (new per request).
- Query lifecycle: `POST /query/sql/start` with the SQL, then page through results, then **close** the query (the CloseSqlQuery endpoint) to free server resources. Wrap this in `ZetarisGateway.query(sql, params)`, which always closes the query, even if paging fails (`try/finally`).
- Timeout 30 seconds per request. Retry with backoff (2 retries) on 5xx. Throw `ZetarisError` with the query name.
- Copy the auth and paging pattern from Zetaris's official `getting-started` repo (`scripts/query_zetaris.ts`, `check_zetaris.ts`). Check the exact endpoint names against their redoc on Day 1. Don't guess them.

### 7.2 Registering sources (Zetaris Lightning SQL)
- Database: `CREATE LIGHTNING DATABASE oko DESCRIBE BY "Oko farm decision data";`
- CSV/Parquet files (WFP prices, crop calendar, storage loss, farm records): `CREATE LIGHTNING FILESTORE TABLE ... FROM oko ...` pointing at an S3/Azure Blob path or uploaded file. Check the exact syntax in Zetaris's `open_data/parquet_csv/HOWTO.md`.
- REST APIs (Open-Meteo, NASA POWER): `CREATE LIGHTNING REST TABLE <raw> FROM oko REQUEST(endpoint "...", method "get", response_type "json", http_encoding "URLENCODED") HEADER(user-agent "Oko hackathon <email>") BODY();` then `CREATE SCHEMASTORE VIEW` to flatten the JSON into columns. Follow `open_data/rest_apis/HOWTO.md`.
- **Parameterised locations:** REST tables usually have a fixed endpoint URL. Plan for that: register **one REST table per demo farm location** (3 farms means 3 forecast tables and 3 history tables, named `forecast_farm_bisi`, `power_farm_bisi`, etc.), created by `scripts/zetaris-apply.ts` from `farms_seed.csv`. Write this as a known limitation and say it's solved in production by a generic connector. If Zetaris turns out to support templated endpoints, use that instead.
- **Fallback if REST tables fail:** fetch the API JSON on a schedule into CSV/Parquet in S3 or Blob, and register those as FILESTORE tables. The agent still reads only through Zetaris.

### 7.3 Views (`zetaris/sql/90_views.sql`)
Create these views so the agent's SQL stays simple:
- `v_rain_daily(farm_id, date, rain_mm, source)`: union of NASA POWER history and the Open-Meteo forecast, with `source` in ('history','forecast').
- `v_maize_price_monthly(state, market, ym, price_ngn_per_kg, commodity, pricetype)`
- `v_crop_calendar(crop, zone, plant_start_mmdd, plant_opt_end_mmdd, plant_last_mmdd, days_to_maturity, water_need_min_mm, water_need_max_mm)`

### 7.4 SnapshotGateway
- `scripts/snapshot.ts` runs every named query for every seeded farm through Zetaris and saves `data/snapshots/<queryName>__<farmId>.json` with `{sql, executedAt, rows}`.
- With `DATA_MODE=snapshot`, `SnapshotGateway` serves those files. The interface shows a grey "Offline snapshot from <date>" chip. This is for judges who clone the repo without Zetaris credentials. The demo video uses `DATA_MODE=live`.

---

## 8. LLM design

### 8.1 Providers
- `LLMProvider.complete({system, messages, json?: ZodSchema, temperature})`.
- `NvidiaProvider`: OpenAI-compatible endpoint from build.nvidia.com (`NVIDIA_BASE_URL`, `NVIDIA_API_KEY`, `NVIDIA_MODEL`). Pick a current Nemotron model from the NVIDIA catalog on Day 1 and put its exact ID in `.env`.
- `MeterlessProvider`: base `http://127.0.0.1:8088/v1` (normalise pasted URLs to `<host>/v1`, never `/v1/v1`). `Authorization: Bearer <token from <stateDir>/proxy-token>` (`rt-local` is rejected). Header `meterless-app: oko` on every request, and `meterless-scope: user` on chat. Model IDs are routing modes such as `meterless/auto`. Status: `GET /v1/models` (401/403 = unauthorized, 200 = online, anything else = offline). 180-second timeout.
- Routing: `understand` and `explain` use Nemotron by default. If NVIDIA isn't reachable, fall back to Meterless; if that fails too, use template explanations. Log which provider answered in the evidence ("Explained by Nemotron <model>").

### 8.2 Prompt: understand (`prompts/understand.md`)
```
You turn a Nigerian farmer's message into JSON. The farmer may write in English, Nigerian Pidgin,
Yoruba, or Hausa, often mixed. Output ONLY JSON matching the schema.
- intent: plant_timing (when to plant), sell_or_store (sell now or keep), why (asks for reason of
  earlier advice), briefing, profile_update (tells facts about farm), smalltalk, unknown.
- language: the language the farmer mostly used (en|pcm|yo|ha).
- Extract numbers exactly as given. "20 bags" → bags: 20. "52k" → pricePerBagNgn: 52000.
  "100kg bag" → bagKg: 100. Never guess a number that was not said.
- missing: list slots needed for the intent that were not given.
  plant_timing needs: nothing (location comes from farm profile).
  sell_or_store needs: bags, pricePerBagNgn. bagKg defaults to 100 if unsaid (do not list it).
Examples: (include 8 examples: 2 per language, covering both intents)
```

### 8.3 Prompt: explain (`prompts/explain.md`)
```
You are Ikore, a friendly farm advisor. Write the reply to the farmer in {lang}.
You receive a Decision JSON. Rules:
1. First line: the verdict, max 12 words. (e.g. Pidgin: "Wait small. Plant around 2 November.")
2. Then 1–2 short sentences with the main reason, using at most 3 numbers.
3. ONLY use numbers present in Decision.keyNumbers. Never compute or invent numbers.
4. Use simple words a farmer uses. No jargon: say "dry days" not "dry spell index".
5. If confidence is low, say it plainly ("E close. Na small difference.").
6. Use the glossary terms exactly as given.
7. Output JSON: {headline, reason, details: string[] (max 3), followUpQuestion|null}
```

### 8.4 Language glossary (`i18n/glossary.ts`); have a native speaker check it
| Concept | en | pcm (Pidgin) | yo (Yoruba) | ha (Hausa) |
|---|---|---|---|---|
| plant | plant | plant | gbìn | shuka |
| wait | wait | wait small | dúró díẹ̀ | jira |
| sell | sell | sell | tà | sayar |
| store | store | keep am | tọ́jú | ajiye |
| rain | rain | rain | òjò | ruwan sama |
| dry days | dry days | dry days | ọjọ́ ọ̀gbẹlẹ̀ | kwanakin fari |
| maize | maize | corn | àgbàdo | masara |
| bag | bag | bag | àpò | buhu |
| risk | risk | danger | ewu | haɗari |
| good morning | Good morning | Good morning | Ẹ káàárọ̀ | Ina kwana |

Numbers: always format naira as `₦118,000` in every language. Dates: "2 Nov" / "2 November" in en/pcm; for yo/ha use the same numeric date, plus the weekday name in that language from the glossary.

### 8.5 Briefing prompt (`prompts/briefing.md`)
- Input: the farm, today's Decision(s), and what changed since yesterday's Decision (verdict change, risk change > 10 percentage points, new forecast dry gap).
- Output: at most 3 lines, greeting first. Only send a "change" alert if something meaningful changed; otherwise send a one-line "no change" brief.

---

## 9. Meterless integration (aim for depth; the Meterless rubric weights engine use at 25%)

| Ikore feature | Meterless service (from the agentathon starter / H-MEM spec) |
|---|---|
| Save farm facts, advice and outcomes | `remember` → **MemoryMiningService** + **MemoryStoreService** |
| Recall farm context before deciding | `ask` → **MemoryRetrievalService** (hybrid retrieval, reinjection, trace) |
| "Why did you tell me this?" audit | `audit <memId>` → **TrustLedgerService** (append-only history) |
| Nightly consolidation of each farm's memories | `sleep` → **SleepCycleService** (preview first, guardrails, backup) |
| Farmer thumbs up/down | `hmem.feedback(id, "helpful"|"not_helpful")` |
| Local model routing | **Meterless Runtime** as an OpenAI-compatible provider (`meterless/auto`) |
| Overnight replanning | **Nightshift** job if installable; otherwise a scheduled script documented as a Meterless overnight agent |

- Keep a table like this in the README, like the starter README does. Judges look for it.
- Namespacing: one H-MEM store per farm (`.oko/hmem/<farmId>/`) or a `farmId` tag on every memory. Choose based on what the H-MEM API supports (read `vendor/.../AGENTS.md` sections 3 to 9).
- Event types to mine: `farm_profile`, `farm_fact`, `advice`, `outcome`, `feedback`, `briefing`.

---

## 10. UI design

### 10.1 Layout (desktop and mobile)
- **Left (or a top drawer on mobile):** farm switcher (Mama Bisi, Ogbomoso · Musa, Kaduna · Demo farm 3), language toggle (EN / Pidgin / Yorùbá / Hausa), data mode chip (Live via Zetaris / Offline snapshot).
- **Centre:** chat, styled like WhatsApp.
  - Incoming (farmer) bubbles on the right, light green. Ikore bubbles on the left, white.
  - Ikore's verdict bubble: **bold headline**, reason text, a risk badge (green/amber/red pill), a large naira figure when relevant, and a "See why" button.
  - Quick-reply chips under Ikore's messages: "Why?", "Show numbers", "I don plant", "I don sell".
- **Right panel (or a bottom sheet on mobile): Evidence**
  - Option comparison table: option, expected ₦ (p50), range (p10 to p90), risk %.
  - Chart 1 (planting): 16-day forecast bars plus a shaded dry gap; a strip of analog years showing replant events.
  - Chart 2 (selling): seasonal price index line (12 months) with a p10 to p90 band and a marker at "today"; bags-left line for the storage method.
  - Source list: each `EvidenceItem` with source, statistic and an expandable "SQL run in Zetaris" code block.
  - Memory used: memory IDs with short text from H-MEM; clicking opens the ledger history.
  - Assumptions: bulleted list with an "edit" link (stretch goal).
- **Briefings page:** cards per farm per morning; a "Run overnight now" button (calls the same code as `npm run nightshift` for the demo).

### 10.2 Visual style
- Colours: deep green `#1F5130` (primary), maize yellow `#E8B923` (accent), soil brown `#6B4F2A` (secondary text), off-white `#FAF7F0` (background), risk colours green `#2E7D32`, amber `#F9A825`, red `#C62828`.
- Font: Inter (UI). Large tap targets (44px minimum). Base text 16px or more.
- Tone: warm, short, respectful ("Mama", "Baba" where it suits the persona).
- Accessibility: colour is never the only signal (badges also carry text: "Low risk").

---

## 11. Configuration (`.env.example`)

```
# Data
DATA_MODE=live                 # live | snapshot
ZETARIS_REST_URL=
ZETARIS_BASE_URL=              # UI origin, if using the /api/proxy route
ZETARIS_API_KEY=
ZETARIS_ORG_ID=
ZETARIS_ENGINE_ID=             # optional
ZETARIS_QUERY_LIMIT=5000

# LLM
NVIDIA_BASE_URL=
NVIDIA_API_KEY=
NVIDIA_MODEL=                  # exact Nemotron model id from build.nvidia.com
METERLESS_BASE_URL=http://127.0.0.1:8088/v1
METERLESS_TOKEN=               # from <stateDir>/proxy-token
LLM_PRIMARY=nvidia             # nvidia | meterless

# App
OKO_TZ=Africa/Lagos
OKO_STATE_DIR=.oko
APP_CONTACT_EMAIL=             # used in REST user-agent headers
```
Never commit `.env`. Never log keys.

---

## 12. Error handling and edge cases
- Zetaris down: show a "Data source unreachable" bubble in the user's language. Offer to answer from the last snapshot, clearly labelled. Never answer with made-up data.
- LLM down: deterministic template replies (`i18n/templates.ts`) for both intents in all four languages.
- Outside the planting season (e.g. October in Oyo is near the end of the second season): planting intent returns "outside window" plus the next window dates from the crop calendar. **Important for the demo date (late October):** frame the planting demo as either (a) the **second season / dry-season irrigated** scenario, or (b) a **"time-travel" demo date setting** (`OKO_DEMO_DATE=2026-04-10`) that runs the model as of the start of the main season, using the historical data for that date and an archived forecast. Option (b) is the most honest and clearest: show the demo date chip on screen and say it in the voiceover. Open-Meteo's archive/historical forecast API can provide a "forecast as of" a past date. Check this on Day 1.
- Price unknown: ask once: "How much one bag dey sell for your market today?"
- Unit confusion: bag defaults to 100 kg; mudu or tiya conversions are a stretch goal (show in the glossary).

---

## 13. Testing strategy
- Unit: stats, planting simulation, selling simulation, decide scoring, explanation number validator (≥ 90% coverage on `src/core/simulate` and `decide.ts`).
- Golden tests: 6 fixed Decision fixtures, each with an approved explanation in 4 languages. The validator must pass them all.
- Integration: `scripts/zetaris-verify.ts` (all tables return rows). An end-to-end chat test in snapshot mode for both intents.
- Manual language QA: 5 prompts per language; record results in `docs/lang-qa.md`.
