import { describe, it, expect } from "vitest";
import { templatePlanting } from "../src/i18n/templates";
import { understand } from "../src/core/understand";
import type { Decision } from "../src/core/types";

describe("Compound questions and template grammar fixes", () => {
  it("templatePlanting in English uses 'replanting was almost never needed in 35 past seasons.' for wait options", () => {
    const mockDecision: Decision = {
      id: "dec_test_1",
      farmId: "farm_bisi_ogbomoso",
      intent: "plant_timing",
      chosen: "wait_7",
      confidence: "high",
      reasons: [],
      evidence: [],
      options: [
        {
          option: "wait_7",
          label: "Wait 7 days",
          plantingDate: "2026-04-17",
          offsetDays: 7,
          replantProbability: 0.007,
          score: 100,
          expectedValueNgn: 1400000,
          rawRainP50Mm: 159,
        },
      ],
      assumptions: [],
      keyNumbers: {
        plantingDate: "2026-04-17",
        offsetDays: 7,
        nAnalogYears: 35,
        replantRisk: "0.7%",
        replantRisk_wait7: "0.7%",
        plainChance_wait7_en: "almost never",
      },
      createdAt: "2026-04-10T00:00:00.000Z",
    };

    const text = templatePlanting(mockDecision, "en");
    expect(text).toContain("replanting was almost never needed in 35 past seasons.");
    expect(text).not.toContain("almost never in 35 past seasons");
  });

  it("understands compound planting and watering questions with 2 parts", async () => {
    const res = await understand("when do i start planting and how should i wet my maize", "farm_bisi_ogbomoso");
    expect(res.intent).toBe("plant_timing");
    expect(res.intents).toBeDefined();
    expect(res.intents?.length).toBe(2);
    expect(res.intents?.[0].intent).toBe("plant_timing");
    expect(res.intents?.[1].intent).toBe("maize_agronomy");
    expect(res.intents?.[1].topic).toBe("watering");
  });

  it("understands compound planting and watering in Yoruba", async () => {
    const res = await understand("Ìgbà wo ni kí n gbìn àgbàdo mi, báwo sì ni kí n bomi rin ín?", "farm_bisi_ogbomoso");
    expect(res.intent).toBe("plant_timing");
    expect(res.language).toBe("yo");
    expect(res.intents).toBeDefined();
    expect(res.intents?.length).toBe(2);
    expect(res.intents?.[0].intent).toBe("plant_timing");
    expect(res.intents?.[1].intent).toBe("maize_agronomy");
    expect(res.intents?.[1].topic).toBe("watering");
  });
});
