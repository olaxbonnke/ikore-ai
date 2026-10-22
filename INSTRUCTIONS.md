# INSTRUCTIONS.md: step-by-step build plan

All times are **WAT (Africa/Lagos)**. The build window opens **Thu 22 Oct 01:00** and closes **Wed 28 Oct 00:45**.
**Internal deadline: submit by Tue 27 Oct 22:00.**
Each task has: what to do, a ready-made prompt to paste into Cursor's agent, and **acceptance criteria** (don't move on until they pass).

---

## Day 0: Wed 21 Oct (before the window; preparation only, no product code)
Writing product code before the window opens doesn't count, so only prepare accounts and reading.
- [ ] **Register** on hackathon.genai.works (closes **Fri 23 Oct 00:59 WAT**). Solo team. Track 3.
- [ ] Install **Cursor** and sign in. Install Node 20+, Git, and the GitHub CLI.
- [ ] Create accounts and get keys: NVIDIA (build.nvidia.com API key), Zetaris Cloud (register at `cloud.enterprise.zetaris.com/register`, note the cost: it deploys into **your AWS/Azure account** and you pay for compute; check for hackathon credits on Discord or by emailing hackathons@genai.works), an AWS S3 bucket or Azure Blob container (for CSV files), and optionally iSDAsoil.
- [ ] Join the hackathon Discord and look for sponsor office hours on Zetaris and Meterless.
- [ ] Read: the Meterless starter README, `engines/hmem/AGENTS.md`, Zetaris `getting-started` (client-setup, REST cookbook, Parquet/CSV cookbook).
- [ ] Pick the exact **Nemotron** model ID on build.nvidia.com and test one call with curl.

---

## Day 1: Thu 22 Oct, foundations
### 1.1 Scaffold (about 45 min)
```
npx degit meterless/meterless/templates/agentathon-starter oko-farm-agent
cd oko-farm-agent && npm install && npm run setup
npx tsx notebook.ts seed && npx tsx notebook.ts ask "what did we decide about storage"
git init && git add -A && git commit -m "Scaffold from Meterless agentathon-starter (third-party, Apache-2.0)"
```
Copy the spec files (PROJECT, DESIGN, DATA, INSTRUCTIONS, AGENTS, `.cursor/rules/oko.mdc`, `.env.example`, `data/*.csv`) into the repo. Commit.

**Cursor prompt:**
> Read AGENTS.md, PROJECT.md and DESIGN.md. Add Next.js 15 (App Router, TypeScript, Tailwind) to this repo without breaking the existing Meterless starter scripts. Create the folder layout in DESIGN.md section 3 with empty, typed module stubs and `src/core/types.ts` exactly as in DESIGN.md section 5. Add Vitest, Zod and Recharts. Add the npm scripts listed in AGENTS.md (stub the ones not implemented yet with a clear "not implemented" message). Don't implement logic yet.

**Acceptance:** `npm run dev` serves a placeholder page; `npm test` runs (0 tests OK); `npx tsx notebook.ts ask ...` still works; `tsc --noEmit` passes.

### 1.2 Zetaris connection (about 2 hrs)
**Cursor prompt:**
> Implement `src/data/zetaris.ts` (ZetarisGateway) following DESIGN.md section 7.1. Base it on Zetaris's official getting-started `scripts/query_zetaris.ts` auth pattern (bearer token, X-Org-ID, fresh UUID X-Request-ID). Implement `query(name, sql)` that starts the SQL query, pages all results up to ZETARIS_QUERY_LIMIT, and always closes the query in a finally block. 30s timeout, 2 retries on 5xx, typed ZetarisError. Add `scripts/zetaris-verify.ts` that runs `SELECT 1` and lists Lightning databases.

**Acceptance:** `npm run zetaris:verify` prints a successful result from your Zetaris instance.
**If blocked for more than 2 hours:** post in the Zetaris Discord channel, email hackathons@genai.works, and carry on with Day 2 work using SnapshotGateway on local JSON files fetched by script (temporary). Swap back to Zetaris as soon as access works. Live Zetaris **must** be working for the demo video.

### 1.3 Register the first two sources (about 2 hrs)
- Upload `wfp_food_prices_nga.csv`, `crop_calendar_maize_ng.csv`, `storage_loss.csv`, `farms_seed.csv` to your bucket.
- Write `zetaris/sql/00_database.sql`, `30_wfp_prices.sql`, `50_crop_calendar.sql` and `20_nasa_power.sql` (one per farm), following the Zetaris HOWTOs (`CREATE LIGHTNING DATABASE`, `CREATE LIGHTNING FILESTORE TABLE`, `CREATE LIGHTNING REST TABLE` + `CREATE SCHEMASTORE VIEW`).
- Implement `scripts/zetaris-apply.ts` (runs the files in order, idempotent: catches "already exists").

**Acceptance:** `npm run zetaris:verify` shows row counts above 0 for `wfp_prices_nga`, `crop_calendar`, and `power_farm_bisi`.

**End of Day 1 commit + a short devlog in `docs/devlog.md`** (helps the "how Cursor was used" write-up: note which prompts you used).

---

## Day 2: Fri 23 Oct, all data and memory
### 2.1 Remaining sources and views (about 3 hrs)
- `10_open_meteo.sql` (forecast per farm), `40_soil.sql` (optional), `60_farm_records.sql`, `90_views.sql` (`v_rain_daily`, `v_maize_price_monthly`, `v_crop_calendar`).
- Write every named query in `src/data/queries.ts` (DESIGN.md section 4, step 3).

**Cursor prompt:**
> Implement `src/data/queries.ts` with these named, parameter-validated SQL builders: forecast16d, rainHistory, recentRain, priceSeasonality, cropCalendar, farmRecords, soil. They query the views in zetaris/sql/90_views.sql. Each returns {name, sql}. Add unit tests that check parameter validation rejects bad input.

**Acceptance:** every named query returns rows via ZetarisGateway for `farm_bisi_ogbomoso`.

### 2.2 Snapshots (about 1 hr)
**Cursor prompt:**
> Implement scripts/snapshot.ts and src/data/snapshot.ts (SnapshotGateway) per DESIGN.md section 7.4. Snapshot every named query for every farm in data/farms_seed.csv.

**Acceptance:** `DATA_MODE=snapshot` returns identical rows to live for the same query.

### 2.3 Memory wrapper and seeding (about 2 hrs)
**Cursor prompt:**
> Read vendor/**/AGENTS.md (H-MEM spec) and notebook.ts. Implement src/memory/hmem.ts exposing remember(farmId, event), ask(farmId, query) returning memories with ids and trace, audit(memoryId), feedback(memoryId, verdict), sleep(farmId, {preview}). Use the real H-MEM services (MemoryMiningService, MemoryStoreService, MemoryRetrievalService, TrustLedgerService, SleepCycleService). Namespace by farm. Then implement scripts/seed-farms.ts that writes each farm profile and data/farm_records.csv seasons as events.

**Acceptance:** `npm run seed`, then a script call `ask("farm_bisi_ogbomoso","storage method")` returns the sack storage memory with an ID, and `audit(id)` shows its ledger.

---

## Day 3: Sat 24 Oct, the planting decision end to end
### 3.1 Stats and planting simulation (about 4 hrs)
**Cursor prompt:**
> Implement src/core/simulate/stats.ts and planting.ts exactly per DESIGN.md sections 6.1 and 6.3 as pure functions taking asOf. Write Vitest tests first using small fixtures in tests/fixtures (all-dry, all-wet, false-start, missing days, leap year). Include analog-year weighting by the past 21-day rainfall.

**Acceptance:** tests pass; for Mama Bisi with `OKO_DEMO_DATE=2026-04-10` (or the date you choose) the sim returns 3 options with replant probability, adequacy p10/p50/p90 and n ≥ 25.

### 3.2 Options, decide, orchestrator (about 3 hrs)
**Cursor prompt:**
> Implement options.ts, decide.ts (DESIGN.md section 4, steps 4 and 6) and orchestrator.ts wiring steps 1 to 8 for intent plant_timing. Use a temporary rule-based understand() for English only. Build Decision.keyNumbers and Decision.evidence with SQL and statistics. Return AgentReply with a template explanation (no LLM yet).

**Acceptance:** `POST /api/chat {farmId, text:"should I plant now?"}` returns a verdict plus a Decision JSON with evidence including SQL strings.

**Demo date decision (do today):** late October is outside the main maize planting window in Oyo. Use `OKO_DEMO_DATE` set to a date in the main season (e.g. 2026-04-10) and the historical forecast archive for that date. Show the date chip in the interface and say it in the video. Or frame it as the second season if your crop calendar sources support that.

---

## Day 4: Sun 25 Oct, selling, the LLM and languages
### 4.1 Selling simulation (about 3 hrs)
**Cursor prompt:**
> Implement simulate/selling.ts per DESIGN.md section 6.2: seasonal index from v_maize_price_monthly (Oyo/Ibadan; detrend by annual mean; median per month), empirical ratio distributions for horizons 1 to 3 months, storage loss from data/storage_loss.csv, cash-need handling with a partial-sale option. Tests first.

**Acceptance:** for 20 bags at ₦52,000 with sack storage, you get 4 or 5 options with p10/p50/p90 in ₦ and riskMetric; tests pass.

### 4.2 LLM providers, understanding and explanation (about 3 hrs)
**Cursor prompt:**
> Implement src/llm/nvidia.ts and meterless.ts per DESIGN.md section 8.1 (Meterless: normalise base URL to <host>/v1, bearer token, meterless-app: oko header, meterless-scope: user, 180s timeout, status via GET /v1/models). Implement understand.ts with prompts/understand.md and a Zod schema, and explain.ts with prompts/explain.md and the number validator plus template fallback. Add golden tests for the validator.

**Acceptance:** Pidgin "I get 20 bags, price na 52k per bag. Make I sell?" goes to the sell_or_store decision with a validated Pidgin reply; a deliberately wrong number in a mocked explanation is caught by the validator.

### 4.3 Languages (about 1.5 hrs)
- Fill `i18n/glossary.ts` and `templates.ts` for en, pcm, yo, ha.
- Test 5 prompts per language and record them in `docs/lang-qa.md`. Ask a Yoruba and a Hausa speaker to check 3 replies each if you can.

---

## Day 5: Mon 26 Oct, overnight runs, interface polish, recording
### 5.1 Nightshift (about 2 hrs)
**Cursor prompt:**
> Implement scripts/nightshift.ts and src/core/briefing.ts per DESIGN.md sections 8.5 and 9: for each farm, run Observe, Simulate and Decide for both intents, compare with yesterday's decision from H-MEM, write a briefing (remember as type briefing), then run hmem.sleep(farmId) (preview first, then apply). Output a summary table. Add GET /api/briefings and a "Run overnight now" button.

Then try registering it as a **Meterless Nightshift** job (if installable on your OS). Otherwise schedule it with Windows Task Scheduler and document that.

**Acceptance:** `npm run nightshift` produces briefings for all 3 farms in their own languages; the briefings page shows them.

### 5.2 Interface (about 4 hrs)
**Cursor prompt:**
> Build the UI in DESIGN.md section 10: WhatsApp-style chat, verdict bubble with risk badge and naira figure, quick-reply chips, evidence panel (option table, the two charts, sources with expandable SQL, memory used with ledger, assumptions), farm switcher, language toggle, data mode chip, demo date chip. Mobile responsive. Colours and fonts as specified.

**Acceptance:** the full demo script in PROJECT.md section 8 can be clicked through without errors in live mode.

### 5.3 Record the demo (about 2 hrs)
- Script: PROJECT.md section 8. Record the screen with OBS at 1080p. Voiceover in English, with on-screen Pidgin/Yoruba/Hausa replies.
- Keep it **under 4:00** (aim for 3:00 to 3:30). Show live Zetaris SQL in the evidence panel at least once and the H-MEM audit at least once.

---

## Day 6: Tue 27 Oct, deliverables and submission
- [ ] **README.md**: what it is, quick start (`npm run setup`, `.env`, `npm run demo`), architecture diagram, the sponsor tech tables (Zetaris and Meterless service mapping), data sources and licences, assumptions, limitations, pre-existing code declaration.
- [ ] **docs/SUBMISSION.md**: the written explanation:
  1. How Zetaris was integrated (sources, REST tables, views, SQL in evidence, read-only federated access, MCP in Cursor).
  2. How Meterless was integrated (H-MEM services table, ledger audit, sleep cycle, Runtime provider, Nightshift).
  3. How Cursor was used (agent prompts from devlog, Zetaris MCP inside Cursor for schema exploration, AGENTS.md-driven development, screenshots).
  4. Where NVIDIA contributes (Nemotron for understanding and multilingual explanation; Meterless runtime local models if used).
  5. What was unique (federated agronomic data plus compounding local farm memory; number-validated explanations; 4 Nigerian languages).
- [ ] **Deck (10 to 12 slides)**: 1 Title · 2 Problem · 3 Who it's for · 4 Solution · 5 Demo screenshots · 6 Agent loop · 7 Architecture · 8 Tech stack · 9 Zetaris use · 10 Meterless use · 11 What's unique · 12 Impact and future (WhatsApp/USSD, more crops, cooperatives, voice).
- [ ] Repo public, tagged `v1.0-submission`.
- [ ] Submit on the platform by **22:00 WAT**. Check that the video plays, links open and the track is Track 3.

---

## If you fall behind (cut in this order)
1. Soil data → hard-code soil classes per farm.
2. Hausa farm → keep the Hausa language toggle only.
3. Charts → table only.
4. Meterless Nightshift registration → scheduled script plus H-MEM sleep.
5. **Never cut:** Zetaris live queries, H-MEM memory and audit, number validator, demo video.

## Risk register
| Risk | Likelihood | Mitigation |
|---|---|---|
| Zetaris setup or cost blocks Day 1 | Medium | Email organisers and post on Discord early; build on snapshots meanwhile; FILESTORE CSV fallback for REST sources |
| REST tables can't be parameterised | High | One table per farm (3 farms), documented |
| Off-season demo date looks odd | High | `OKO_DEMO_DATE` time-travel, said openly on screen |
| Yoruba/Hausa quality | Medium | Glossary, templates, native-speaker check, keep sentences short |
| Open-Meteo rate limits | Low | Snapshots and caching |
| Nightshift not installable | Medium | Scheduled script plus SleepCycle; say so openly |
| Burnout plus GAM commitments | Medium | Strict cut list; stop building at Day 5 noon if behind |
