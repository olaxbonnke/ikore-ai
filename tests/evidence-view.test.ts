import { describe, expect, it } from "vitest";
import { formatEvidenceView, KNOWN_FARMS } from "../src/core/evidence-view.ts";

describe("formatEvidenceView (src/core/evidence-view.ts)", () => {
  it("exposes known farms with readable names and IDs", () => {
    expect(KNOWN_FARMS).toHaveLength(2);
    expect(KNOWN_FARMS[0].id).toBe("farm_bisi_ogbomoso");
    expect(KNOWN_FARMS[0].name).toBe("Mama Bisi");
    expect(KNOWN_FARMS[1].id).toBe("farm_ade_iseyin");
    expect(KNOWN_FARMS[1].name).toBe("Baba Ade");
  });

  it("maps a plant_timing response cleanly with options, chosen badge, and Zetaris SQL", () => {
    const mockApiResponse = {
      run_id: "run_test_123",
      mode: "live",
      intent: "plant_timing",
      reply: "Wait a week. Plant around 17 April.",
      decision: {
        chosen: "wait_7",
        runnerUp: "wait_14",
        options: [
          {
            option: "plant_now",
            label: "Plant now",
            replantProbability: 0.141,
            establishmentRainMm: { p50: 167.9 },
            n: 35,
          },
          {
            option: "wait_7",
            label: "Wait 7 days",
            replantProbability: 0.007,
            establishmentRainMm: { p50: 159.2 },
            n: 35,
          },
          {
            option: "wait_14",
            label: "Wait 14 days",
            replantProbability: 0.007,
            establishmentRainMm: { p50: 159.7 },
            n: 35,
          },
        ],
        assumptions: ["Base yield: 2,000 kg/ha"],
      },
      evidence: {
        nAnalogYears: 35,
      },
      llm: {
        provider: "nightshift",
        requested_model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        responded_model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        latency_ms: 1250,
        fallback_used: false,
      },
      zetaris: {
        queries_run: ["SELECT * FROM oko_pg.rain_daily"],
        row_counts: { rain_daily: 12899 },
      },
      memory: {
        hmem_used: true,
        recalled: ["Demo profile from data/farms_seed.csv"],
        stored: "mem-101",
      },
      trace_file: "logs/trace-test.jsonl",
    };

    const view = formatEvidenceView(mockApiResponse);
    expect(view.hasDecision).toBe(true);
    expect(view.options).toHaveLength(3);

    const wait7 = view.options.find((o) => o.option === "wait_7");
    expect(wait7?.isChosen).toBe(true);
    expect(wait7?.isRunnerUp).toBe(false);
    expect(wait7?.replantProbabilityPct).toBe("0.7%");
    expect(wait7?.establishmentRainP50Mm).toBe(159.2);

    const wait14 = view.options.find((o) => o.option === "wait_14");
    expect(wait14?.isRunnerUp).toBe(true);

    expect(view.seasonsEvaluated).toBe(35);
    expect(view.queriesRun).toEqual(["SELECT * FROM oko_pg.rain_daily"]);
    expect(view.rowCounts).toEqual({ rain_daily: 12899 });
    expect(view.memory.used).toBe(true);
    expect(view.memory.recalled).toHaveLength(1);
    expect(view.memory.stored).toBe("mem-101");
    expect(view.llm.provider).toBe("nightshift");
    expect(view.llm.respondedModel).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(view.runId).toBe("run_test_123");
    expect(view.traceFile).toBe("logs/trace-test.jsonl");
    expect(view.assumptions).toEqual(["Base yield: 2,000 kg/ha"]);
  });

  it("maps a recall_previous response with no decision options and zero queries", () => {
    const mockRecallResponse = {
      run_id: "run_recall_456",
      mode: "sample",
      intent: "recall_previous",
      decision: null,
      reply: "On 10 April I told you to wait a week.",
      evidence: {},
      llm: {
        provider: "sample",
        requested_model: "none",
        responded_model: "template",
        latency_ms: 1,
        fallback_used: true,
      },
      zetaris: {
        queries_run: [],
        row_counts: {},
      },
      memory: {
        hmem_used: true,
        recalled: ["Previous advice: wait_7"],
        stored: "none",
      },
      trace_file: "logs/trace-recall.jsonl",
    };

    const view = formatEvidenceView(mockRecallResponse);
    expect(view.hasDecision).toBe(false);
    expect(view.options).toHaveLength(0);
    expect(view.seasonsEvaluated).toBeUndefined();
    expect(view.queriesRun).toHaveLength(0);
    expect(view.memory.used).toBe(true);
    expect(view.memory.recalled[0]).toBe("Previous advice: wait_7");
    expect(view.llm.provider).toBe("sample");
    expect(view.llm.fallbackUsed).toBe(true);
  });

  it("safely handles null/empty payloads without throwing", () => {
    const view = formatEvidenceView(null);
    expect(view.hasDecision).toBe(false);
    expect(view.options).toEqual([]);
    expect(view.queriesRun).toEqual([]);
    expect(view.memory.used).toBe(false);
    expect(view.llm.latencyMs).toBe(0);
  });
});
