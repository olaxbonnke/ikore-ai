import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as healthGet } from "../src/app/api/health/route.ts";
import { POST as runPost } from "../src/app/api/run/route.ts";

describe("JSON API: /api/health and /api/run", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SAMPLE_MODE = "true";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("GET /api/health", () => {
    it("returns 200 with configuration booleans and zero secret values", async () => {
      process.env.METERLESS_RUNTIME_TOKEN = "secret_rt_token_12345";
      process.env.ZETARIS_API_KEY = "secret_zetaris_key_99999";
      process.env.ZETARIS_REST_URL = "https://zetaris.example.com";
      process.env.ZETARIS_ORG_ID = "org-123";

      const res = await healthGet();
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("charset=utf-8");

      const json = await res.json();
      expect(json).toEqual({
        ok: true,
        sample_mode: true,
        nightshift_configured: true,
        zetaris_configured: true,
      });

      // Assert no secret substrings exist in serialized output
      const serialized = JSON.stringify(json);
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain("token");
      expect(serialized).not.toContain("key");
      expect(serialized).not.toContain("12345");
      expect(serialized).not.toContain("99999");
    });

    it("correctly identifies unconfigured states", async () => {
      delete process.env.METERLESS_RUNTIME_TOKEN;
      delete process.env.ZETARIS_API_KEY;
      process.env.SAMPLE_MODE = "false";

      const res = await healthGet();
      const json = await res.json();
      expect(json.sample_mode).toBe(false);
      expect(json.nightshift_configured).toBe(false);
      expect(json.zetaris_configured).toBe(false);
      expect(json.ok).toBe(true);
    });
  });

  describe("POST /api/run", () => {
    it("returns 400 when question is missing or invalid", async () => {
      const req = new Request("http://localhost:3000/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ farm_id: "farm_bisi_ogbomoso" }),
      });

      const res = await runPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    it("runs plant_timing end-to-end in SAMPLE_MODE and generates valid trace", async () => {
      const req = new Request("http://localhost:3000/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "When should I plant maize?",
          farm_id: "farm_bisi_ogbomoso",
          lang: "en",
        }),
      });

      const res = await runPost(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.run_id).toBeDefined();
      expect(json.mode).toBe("sample");
      expect(json.intent).toBe("plant_timing");
      expect(json.decision).toBeDefined();
      expect(json.decision.chosen).toMatch(/plant_now|wait_7|wait_14/);
      expect(typeof json.reply).toBe("string");
      expect(json.reply.length).toBeGreaterThan(10);
      expect(json.evidence).toBeDefined();
      expect(json.evidence.replantRisk).toBeDefined();

      // Check LLM fields in SAMPLE_MODE
      expect(json.llm).toEqual({
        provider: "sample",
        requested_model: "none",
        responded_model: "template",
        latency_ms: expect.any(Number),
        fallback_used: true,
      });

      // Check Zetaris queries and row counts from bundled snapshot
      expect(json.zetaris.queries_run.length).toBeGreaterThan(0);
      expect(json.zetaris.row_counts.rain_daily).toBeGreaterThan(0);

      // Check Memory
      expect(json.memory.hmem_used).toBe(true);
      expect(Array.isArray(json.memory.recalled)).toBe(true);
      expect(json.memory.recalled.length).toBeGreaterThan(0);
      expect(json.memory.stored).toMatch(/^mem-/);
      expect(res.headers.get("content-type")).toContain("charset=utf-8");

      // Check Trace file
      expect(json.trace_file).toMatch(/^logs\/trace-.*\.jsonl$/);
      const fullTracePath = path.resolve(process.cwd(), json.trace_file);
      expect(fs.existsSync(fullTracePath)).toBe(true);

      const traceContent = fs.readFileSync(fullTracePath, "utf-8").trim();
      const lines = traceContent.split(/\r?\n/).map((l) => JSON.parse(l));
      expect(lines.length).toBeGreaterThanOrEqual(5);

      for (const line of lines) {
        expect(line.ts).toBeDefined();
        expect(line.run_id).toBe(json.run_id);
        expect(line.step).toBeDefined();
        expect(["zetaris", "hmem", "nightshift", "orchestrator", "validator"]).toContain(line.component);
        expect(line.input_summary).toBeDefined();
        expect(line.output_summary).toBeDefined();
        expect(typeof line.latency_ms).toBe("number");
        expect(line.status).toBeDefined();
      }

      // Verify no secret leakage in traces
      expect(traceContent).not.toContain("secret_");
      expect(traceContent).not.toContain("Bearer");
    });

    it("runs sell_or_store end-to-end in SAMPLE_MODE", async () => {
      const req = new Request("http://localhost:3000/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "I have 20 bags of maize and a buyer is offering ₦45,000 per bag. Should I sell now or store?",
          farm_id: "farm_ade_iseyin",
          lang: "en",
        }),
      });

      const res = await runPost(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.mode).toBe("sample");
      expect(json.intent).toBe("sell_or_store");
      expect(json.decision.chosen).toMatch(/sell_now|store_/);
      expect(json.llm.responded_model).toBe("template");
      expect(json.llm.provider).toBe("sample");
      expect(json.zetaris.row_counts.prices).toBeGreaterThan(0);
      expect(json.memory.hmem_used).toBe(true);
      expect(json.memory.stored).toMatch(/^mem-/);
    });

    it("prevents duplicate saves for the same decision run", async () => {
      const { remember, getFarmHMEM } = await import("../src/memory/hmem.ts");
      const farmId = "farm_ade_iseyin";
      const hmem = await getFarmHMEM(farmId);
      const initialCount = hmem.store.records.size;
      const decId = `dec_dedup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      const id1 = await remember(farmId, {
        type: "advice",
        decisionId: decId,
        content: "Unique dedup test content for 2026-04-10",
      });

      const id2 = await remember(farmId, {
        type: "advice",
        decisionId: decId,
        content: "Unique dedup test content for 2026-04-10",
      });

      expect(id1).toBe(id2);
      expect(hmem.store.records.size).toBe(initialCount + 1);
    });

    it("allows storing identical question across different seasons / decision runs", async () => {
      const { remember, getFarmHMEM } = await import("../src/memory/hmem.ts");
      const farmId = "farm_ade_iseyin";
      const hmem = await getFarmHMEM(farmId);
      const initialCount = hmem.store.records.size;
      const dec1 = `dec_season_2026_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const dec2 = `dec_season_2027_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      const id1 = await remember(farmId, {
        type: "advice",
        decisionId: dec1,
        content: "Should I plant now?",
      });

      const id2 = await remember(farmId, {
        type: "advice",
        decisionId: dec2,
        content: "Should I plant now?",
      });

      expect(id1).not.toBe(id2);
      expect(hmem.store.records.size).toBe(initialCount + 2);
    });

    it("returns HTTP 503 JSON with trace when Zetaris is unreachable in live mode", async () => {
      process.env.SAMPLE_MODE = "false";
      process.env.DATA_MODE = "live";
      process.env.ZETARIS_REST_URL = "http://127.0.0.1:54321";
      process.env.ZETARIS_API_KEY = "dummy_key";
      process.env.ZETARIS_ORG_ID = "dummy_org";

      const req = new Request("http://localhost:3000/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "When should I plant maize?",
          farm_id: "farm_bisi_ogbomoso",
        }),
      });

      const res = await runPost(req);
      expect(res.status).toBe(503);
      expect(res.headers.get("content-type")).toContain("charset=utf-8");

      const json = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error.component).toBe("zetaris");
      expect(json.run_id).toBeDefined();
      expect(json.trace_file).toBeDefined();

      // Ensure trace file exists on disk and reflects failure
      const tracePath = path.resolve(process.cwd(), json.trace_file);
      expect(fs.existsSync(tracePath)).toBe(true);
      const traceText = fs.readFileSync(tracePath, "utf-8");
      expect(traceText).toContain('"status":"failed"');
    });

    it("traces understand as nightshift with requested and responded model when LLM is active", async () => {
      const { RunTracer } = await import("../src/core/tracer.ts");
      const tracer = new RunTracer();

      tracer.log({
        step: "understand",
        component: "nightshift",
        input_summary: 'text="When to plant" farm_id=farm_bisi_ogbomoso',
        output_summary: "intent=plant_timing lang=en slots={}",
        latency_ms: 120,
        requested_model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        responded_model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        status: "ok",
      });

      const tracePath = path.resolve(process.cwd(), tracer.traceFile);
      const content = fs.readFileSync(tracePath, "utf-8");
      const line = JSON.parse(content.trim().split(/\r?\n/).pop()!);
      expect(line.step).toBe("understand");
      expect(line.component).toBe("nightshift");
      expect(line.requested_model).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
      expect(line.responded_model).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
    });
  });
});
