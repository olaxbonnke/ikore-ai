import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { decide } from "../src/core/decide.ts";
import { formatNiMetBenchmarkEvidence, handle } from "../src/core/orchestrator.ts";
import { simulatePlanting } from "../src/core/simulate/planting.ts";
import type { OptionResult } from "../src/core/types.ts";
import { SnapshotGateway } from "../src/data/snapshot.ts";

describe("decide (src/core/decide.ts)", () => {
  const dummyOptions: OptionResult[] = [
    {
      option: "plant_now",
      label: "Plant now",
      outcome: {
        p10: 785705,
        p50: 1400000,
        p90: 1400000,
        mean: 1344648,
        riskMetric: 0.141,
        riskLabel: "replanting risk",
        n: 35,
      },
      score: 1037667,
      notes: [],
    },
    {
      option: "wait_7",
      label: "Wait 7 days",
      outcome: {
        p10: 1391115,
        p50: 1400000,
        p90: 1400000,
        mean: 1395568,
        riskMetric: 0.007,
        riskLabel: "replanting risk",
        n: 35,
      },
      score: 1387839,
      notes: [],
    },
    {
      option: "wait_14",
      label: "Wait 14 days",
      outcome: {
        p10: 1400000,
        p50: 1400000,
        p90: 1400000,
        mean: 1395568,
        riskMetric: 0.007,
        riskLabel: "replanting risk",
        n: 35,
      },
      score: 1394678,
      notes: [],
    },
  ];

  it("selects wait_7 via earlier-window tie-break when scores are within 0.5% and risk is equal", () => {
    const decision = decide(dummyOptions, {
      farmId: "farm_bisi_ogbomoso",
      intent: "plant_timing",
      asOf: "2026-04-10",
      dataMode: "snapshot",
      riskAversion: "normal",
    });

    expect(decision.chosen).toBe("wait_7");
    expect(decision.runnerUp).toBe("wait_14");
    expect(decision.confidence).toBe("high");
    expect(decision.riskBadge).toBe("green");
    expect(decision.keyNumbers.replantRisk).toBe("0.7%");
  });

  it("chooses safer option when scores are within 5% but risk differs", () => {
    const closeOptions: OptionResult[] = [
      {
        option: "opt_higher_score",
        label: "Higher Score but riskier",
        outcome: { p10: 100, p50: 200, p90: 300, mean: 200, riskMetric: 0.25, riskLabel: "risk", n: 30 },
        score: 1000,
        notes: [],
      },
      {
        option: "opt_safer",
        label: "Slightly lower score but much safer",
        outcome: { p10: 95, p50: 195, p90: 295, mean: 195, riskMetric: 0.05, riskLabel: "risk", n: 30 },
        score: 980, // 2% lower score
        notes: [],
      },
    ];

    const decision = decide(closeOptions, {
      farmId: "test_farm",
      intent: "plant_timing",
      asOf: "2026-04-10",
      dataMode: "snapshot",
    });

    expect(decision.chosen).toBe("opt_safer");
    expect(decision.runnerUp).toBe("opt_higher_score");
    expect(decision.riskBadge).toBe("green");
  });

  it("fills keyNumbers, SQL evidence, and 200 mm spike guard", () => {
    const decision = decide(dummyOptions, {
      farmId: "farm_bisi_ogbomoso",
      intent: "plant_timing",
      asOf: "2026-04-10",
      dataMode: "live",
      provenance: "Zetaris (local)",
      querySql: "SELECT date, rain_mm FROM oko_pg.rain_daily WHERE farm_id = 'farm_bisi_ogbomoso' ORDER BY date ASC",
    });

    expect(decision.keyNumbers.asOf).toBe("2026-04-10");
    expect(decision.keyNumbers.nAnalogYears).toBe(35);
    expect(decision.keyNumbers.replantRisk).toBe("0.7%");

    const historyEv = decision.evidence.find((e) => e.id === "ev_rain_history");
    expect(historyEv).toBeDefined();
    expect(historyEv?.source).toBe("Zetaris (local)");
    expect(historyEv?.sql).toContain("oko_pg.rain_daily");

    const spikeGuardEv = decision.evidence.find((e) => e.id === "ev_spike_guard");
    expect(spikeGuardEv).toBeDefined();
    expect(spikeGuardEv?.value).toBe(200);
  });
});

describe("Orchestrator plant_timing end-to-end (snapshot mode)", () => {
  it("runs end-to-end for Mama Bisi Ogbomoso asOf=2026-04-10 and chooses wait_7", async () => {
    process.env.DATA_MODE = "snapshot";
    process.env.OKO_DEMO_DATE = "2026-04-10";

    const reply = await handle({
      farmId: "farm_bisi_ogbomoso",
      text: "when should I plant maize?",
    });

    expect(reply.decision).toBeDefined();
    const d = reply.decision!;

    expect(d.intent).toBe("plant_timing");
    expect(d.chosen).toBe("wait_7");
    expect(d.runnerUp).toBe("wait_14");
    expect(d.confidence).toBe("high");
    expect(d.riskBadge).toBe("green");

    // Replanting risk comparison: 14.1% vs 0.7%
    expect(d.keyNumbers.replantRisk).toBe("0.7%");
    expect(d.keyNumbers.replantRiskNow).toBe("14.1%");
    expect(d.keyNumbers.nAnalogYears).toBe(35);

    // Evidence checks
    const rainEv = d.evidence.find((e) => e.id === "ev_rain_history");
    expect(rainEv).toBeDefined();
    expect(rainEv?.sql).toContain("oko_pg.rain_daily");

    const spikeEv = d.evidence.find((e) => e.id === "ev_spike_guard");
    expect(spikeEv).toBeDefined();

    // Reply text contains advice
    expect(reply.text.toLowerCase()).toContain("wait 7 days");
    expect(reply.memoryIdsUsed.length).toBeGreaterThan(0);

    // NiMet benchmark evidence item
    const nimetEv = d.evidence.find((e) => e.id === "ev_nimet_benchmark");
    expect(nimetEv).toBeDefined();
    expect(nimetEv?.value).toBe("inside");
    expect(nimetEv?.statistic).toBe(
      "NiMet's 2026 forecast puts onset in Oyo between 15 and 30 April. Ikore's suggested date, 17 April, falls inside that window."
    );
  });

  it("formats NiMet benchmark evidence when suggested date is inside window", () => {
    const row = {
      state: "Oyo",
      season: 2026,
      onset_start: "2026-04-15",
      onset_end: "2026-04-30",
      source_name: "NiMet 2026 SCP",
    };
    const ev = formatNiMetBenchmarkEvidence(row, "2026-04-17");
    expect(ev.value).toBe("inside");
    expect(ev.statistic).toBe(
      "NiMet's 2026 forecast puts onset in Oyo between 15 and 30 April. Ikore's suggested date, 17 April, falls inside that window."
    );
  });

  it("formats NiMet benchmark evidence when suggested date is outside window", () => {
    const row = {
      state: "Oyo",
      season: 2026,
      onset_start: "2026-04-15",
      onset_end: "2026-04-30",
      source_name: "NiMet 2026 SCP",
    };
    const ev = formatNiMetBenchmarkEvidence(row, "2026-04-10");
    expect(ev.value).toBe("outside");
    expect(ev.statistic).toBe(
      "NiMet's 2026 forecast puts onset in Oyo between 15 and 30 April. Ikore's suggested date, 10 April, falls outside that window."
    );
  });

  it("verdict (wait_7) and replant risks remain invariant across different illustrative prices (350, 700) and yields (1500, 2500)", () => {
    const snapshotPath = path.resolve(
      process.cwd(),
      "data",
      "snapshots",
      "rain_daily__farm_bisi_ogbomoso.json"
    );
    const parsedSnapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
    const asOf = "2026-04-10";

    const prices = [350, 700];
    const yields = [1500, 2500];

    for (const expectedPricePerKg of prices) {
      for (const baseYieldKgPerHa of yields) {
        const sim = simulatePlanting({
          series: parsedSnapshot.rows,
          asOf,
          options: {
            candidateOffsetsDays: [0, 7, 14],
            economics: {
              hectares: 2.0,
              baseYieldKgPerHa,
              expectedPricePerKg,
              seedCostPerHa: 25000,
              replantLabourPerHa: 20000,
              riskAversionLambda: 0.5,
            },
          },
        });

        const decision = decide(sim as unknown as OptionResult[], {
          farmId: "farm_bisi_ogbomoso",
          intent: "plant_timing",
          asOf,
          dataMode: "snapshot",
          riskAversion: "normal",
          plantingOptions: sim,
        });

        expect(decision.chosen).toBe("wait_7");
        expect(decision.runnerUp).toBe("wait_14");
        expect(decision.keyNumbers.replantRisk).toBe("0.7%");
        expect(decision.keyNumbers.replantRiskNow).toBe("14.1%");
      }
    }
  });

  it("skips NiMet benchmark evidence silently if no benchmark row exists for farm state or season", async () => {
    process.env.DATA_MODE = "snapshot";
    process.env.OKO_DEMO_DATE = "2026-04-10";

    const originalQuery = SnapshotGateway.prototype.query;
    const spy = vi.spyOn(SnapshotGateway.prototype, "query").mockImplementation(async function(this: any, sql: any, params: any) {
      if (typeof sql === "string" && sql.toLowerCase().includes("nimet")) {
        return { rows: [], source: "snapshot", fetchedAt: new Date().toISOString(), provenance: "none" };
      }
      return originalQuery.call(this, sql, params);
    });

    try {
      const reply = await handle({
        farmId: "farm_bisi_ogbomoso",
        text: "when should I plant maize?",
      });

      expect(reply.decision).toBeDefined();
      const nimetEv = reply.decision!.evidence.find((e) => e.id === "ev_nimet_benchmark");
      expect(nimetEv).toBeUndefined();
    } finally {
      spy.mockRestore();
      process.env.OKO_DEMO_DATE = "2026-04-10";
    }
  });
});
