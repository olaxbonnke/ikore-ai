# AGENTS.md: rules for coding agents working on Ikore AI

You are working on **Ikore AI**, a farm decision agent for the Open Agent Hackathon 2026.
Read these first, in this order: **PROJECT.md**, then **DESIGN.md**, then **DATA.md**, then **INSTRUCTIONS.md**.
DESIGN.md is the source of truth for architecture. If you change behaviour, update DESIGN.md in the same change.

## Non-negotiable rules
1. **Numbers come from code, not from the model.** Never let an LLM produce or change a figure shown to a farmer. Explanations may only quote `Decision.keyNumbers`. Keep the number validator in `src/core/explain.ts` working, with tests.
2. **All runtime data goes through `DataGateway`** (`ZetarisGateway` in live mode, `SnapshotGateway` in snapshot mode). Never call Open-Meteo, NASA POWER or the WFP files directly from app code. Scripts that *register* sources in Zetaris or *record snapshots* are the only exception.
3. **All SQL lives in `src/data/queries.ts`** as named, parameterised builders. Escape or validate every parameter (numbers through `Number.isFinite`, IDs through `/^[a-z0-9_]+$/`). No string-built SQL anywhere else.
4. **Memory goes through `src/memory/hmem.ts`**, which wraps the vendored Meterless H-MEM services. Don't write to `.oko/` directly.
5. **Pure, tested simulation.** `src/core/simulate/*` and `src/core/decide.ts` must be pure functions (no I/O, no Date.now(); pass `asOf` in). Add or update Vitest tests for every change.
6. **Time zone:** every user-facing date uses `Africa/Lagos`. Support `OKO_DEMO_DATE` (ISO date) to run "as of" a past date. All code takes `asOf` from config, never from the system clock directly.
7. **Secrets:** read only from env. Never log keys, tokens or full request headers. Never commit `.env`.
8. **Languages:** user-facing strings live in `src/i18n/`. Support `en`, `pcm`, `yo`, `ha`. Use glossary terms exactly. Format naira as `₦118,000`.
9. **Honesty labels:** anything assumed (yield per ha, storage loss, seed price) appears in `Decision.assumptions` and in the evidence panel. Snapshot mode shows the "Offline snapshot" chip. Seeded farm records are labelled as demo data.
10. **Hackathon rules:** only work done from 22 Oct 2026 00:00 UTC counts. Keep the Meterless starter and vendored code as clearly separate, declared third-party code. Don't rewrite it as if it were ours.

## Coding conventions
- TypeScript `strict: true`. No `any` except at external boundaries, where it's immediately validated with Zod.
- Files: kebab-case or the names in DESIGN.md section 3. Exported functions get JSDoc with units (mm, ₦, kg, days).
- Units in variable names where it's unclear: `rainMm`, `priceNgnPerKg`, `bagsCount`, `daysOffset`.
- Errors: throw typed errors (`ZetarisError`, `LLMError`, `ValidationError`). The orchestrator catches them and replies with a localised fallback.
- Keep functions under about 60 lines. Prefer small pure helpers in `stats.ts`.
- Commits: small, imperative ("Add analog-year weighting to planting sim"). Commit at least every working milestone; the commit history proves the work was done in the build window.

## Commands (keep these working)
```
npm run setup            # Meterless starter: vendor H-MEM (required after clone)
npm run dev              # Next.js dev server
npm test                 # Vitest
npm run zetaris:apply    # run zetaris/sql/*.sql in order
npm run zetaris:verify   # every table returns rows
npm run snapshot         # record Zetaris results to data/snapshots
npm run seed             # seed demo farms into H-MEM
npm run nightshift       # overnight replanning + briefings (+ H-MEM sleep)
npm run demo             # DATA_MODE=snapshot, seed, then dev
```

## When you're unsure
- Unsure about a Zetaris endpoint or SQL syntax: check Zetaris's official `getting-started` repo (scripts/query_zetaris.ts, open_data/*/HOWTO.md) or the redoc. If the Zetaris MCP server is connected in Cursor, use it to inspect live schemas. Don't guess endpoint names.
- Unsure about the H-MEM API: read `vendor/**/AGENTS.md` and the starter's `notebook.ts`.
- Unsure about agronomy numbers: put them in config, label them as assumptions, and add a TODO with the source to check.
- If a task loops more than twice without progress, stop and write down what's blocking you in `docs/blockers.md`.

## Definition of done for any task
- Code compiles (`tsc --noEmit`), tests pass, lint is clean.
- New behaviour is reflected in DESIGN.md (if architectural) and README (if user-visible).
- The demo path (`npm run demo`) still works.
