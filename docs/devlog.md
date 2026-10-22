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

## Day 2: Fri 23 Oct 2026
- (snapshots, H-MEM farm memory)
