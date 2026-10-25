import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractRules,
  isRainAdequacyQuery,
  isMaizeAgronomyQuery,
  isNonMaizeCropQuery,
  isRecallQuery,
} from "../src/llm/understand.ts";
import {
  validateAgronomyGuidance,
  buildAllowedAgronomyNumbers,
  isWateringOrHarvestQuery,
  explainAgronomy,
} from "../src/llm/agronomy.ts";
import type { LLMProvider, LLMCompleteParams } from "../src/llm/provider.ts";
import { validateOutputStructure } from "../src/llm/explain.ts";
import { templatePlantingRainAdequacy, templateAgronomyFallback } from "../src/i18n/templates.ts";
import type { Decision, Farm as FarmProfile } from "../src/core/types.ts";

describe("maize_agronomy and rain adequacy routing", () => {
  it("routes maize agronomy operations across EN, YO, PCM to maize_agronomy", () => {
    // Watering / Irrigation
    const waterEn = extractRules("When should I water my maize this month?");
    expect(waterEn.intent).toBe("maize_agronomy");
    expect(isWateringOrHarvestQuery("When should I water my maize this month?")).toBe(true);

    const waterYo = extractRules("Báwo ni mo ṣe lè rin omi fún àgbàdo mi?");
    expect(waterYo.intent).toBe("maize_agronomy");

    // Land preparation & spacing
    const spacingEn = extractRules("What spacing should I use between maize seeds?");
    expect(spacingEn.intent).toBe("maize_agronomy");

    const landPrepEn = extractRules("How should I do land preparation for my maize field?");
    expect(landPrepEn.intent).toBe("maize_agronomy");

    // Fertiliser timing
    const fertEn = extractRules("What is the best time to apply NPK fertilizer on maize?");
    expect(fertEn.intent).toBe("maize_agronomy");

    const fertYo = extractRules("Ìgbà wo ni kí n lo ajílẹ̀ urea lórí àgbàdo?");
    expect(fertYo.intent).toBe("maize_agronomy");

    // Pests & diseases
    const pestEn = extractRules("How do I control fall armyworm on maize?");
    expect(pestEn.intent).toBe("maize_agronomy");

    const pestPcm = extractRules("Wetin I go do for this worm dey chop my corn leaves?");
    expect(pestPcm.intent).toBe("maize_agronomy");

    // Harvest timing & drying
    const harvestEn = extractRules("When should I harvest my maize?");
    expect(harvestEn.intent).toBe("maize_agronomy");
    expect(isWateringOrHarvestQuery("When should I harvest my maize?")).toBe(true);

    const harvestYo = extractRules("Báwo ni màá ṣe mọ̀ pé àgbàdo mi ti gbó fún ìkórè?");
    expect(harvestYo.intent).toBe("maize_agronomy");

    const dryEn = extractRules("How should I dry and shell my harvested maize?");
    expect(dryEn.intent).toBe("maize_agronomy");
  });

  it("routes non-maize crop questions to out_of_scope", () => {
    const cassava = extractRules("When should I plant cassava?");
    expect(cassava.intent).toBe("out_of_scope");

    const yam = extractRules("How do I care for my yam heaps?");
    expect(yam.intent).toBe("out_of_scope");

    const rice = extractRules("When should I harvest rice in Nigeria?");
    expect(rice.intent).toBe("out_of_scope");
  });

  it("preserves existing intents for planting, selling, and recall", () => {
    const plant = extractRules("When should I plant my maize this season?");
    expect(plant.intent).toBe("plant_timing");
    expect(plant.slots.focus).toBeUndefined();

    const sell = extractRules("I have 20 bags of maize, offered 45,000 per bag. Should I sell?");
    expect(sell.intent).toBe("sell_or_store");

    const recall = extractRules("Remind me, when did you say I should plant?");
    expect(recall.intent).toBe("recall_previous");
  });

  it("routes rain-adequacy queries to plant_timing with slots.focus = 'rain_adequacy'", () => {
    const q1 = extractRules("Will this month's rain be enough for planting maize this season?");
    expect(q1.intent).toBe("plant_timing");
    expect(q1.slots.focus).toBe("rain_adequacy");

    const q2 = extractRules("Is the rain enough to plant now?");
    expect(q2.intent).toBe("plant_timing");
    expect(q2.slots.focus).toBe("rain_adequacy");

    const q3 = extractRules("Has the rain started properly?");
    expect(q3.intent).toBe("plant_timing");
    expect(q3.slots.focus).toBe("rain_adequacy");

    const qYo = extractRules("Ṣé òjò tó láti gbìn àgbàdo báyìí?");
    expect(qYo.intent).toBe("plant_timing");
    expect(qYo.slots.focus).toBe("rain_adequacy");

    const qPcm = extractRules("Rain don reach to plant corn now?");
    expect(qPcm.intent).toBe("plant_timing");
    expect(qPcm.slots.focus).toBe("rain_adequacy");
  });
});

describe("agronomy guidance validator", () => {
  const allowedNumbers = new Set<number>([1, 2, 14, 25, 45]);

  it("rejects guidance containing prohibited chemical brand names or active ingredients", () => {
    const v1 = validateAgronomyGuidance("Spray with chlorpyrifos to eliminate stem borers.", allowedNumbers);
    expect(v1.valid).toBe(false);
    expect(v1.reason).toContain("Prohibited chemical product name detected");

    const v2 = validateAgronomyGuidance("Apply Sniper or DDVP for caterpillars.", allowedNumbers);
    expect(v2.valid).toBe(false);
  });

  it("rejects guidance containing specific chemical dosage patterns", () => {
    const v1 = validateAgronomyGuidance("Mix 50ml per 20L sprayer and apply over the crops.", allowedNumbers);
    expect(v1.valid).toBe(false);
    expect(v1.reason).toContain("Prohibited specific chemical dosage pattern detected");

    const v2 = validateAgronomyGuidance("Apply at 2 L/ha across the field.", allowedNumbers);
    expect(v2.valid).toBe(false);

    const v3 = validateAgronomyGuidance("Use 5g/L in water.", allowedNumbers);
    expect(v3.valid).toBe(false);

    const v4 = validateAgronomyGuidance("Apply 4 bags per hectare of NPK.", allowedNumbers);
    expect(v4.valid).toBe(false);
    expect(v4.reason).toContain("Prohibited specific chemical dosage pattern detected");

    const v5 = validateAgronomyGuidance("Broadcast 100 kg/ha before rain.", allowedNumbers);
    expect(v5.valid).toBe(false);
  });

  it("rejects guidance containing ungrounded numbers", () => {
    const v = validateAgronomyGuidance(
      "Yield will increase by 450 bags if watered 8 times.",
      allowedNumbers
    );
    expect(v.valid).toBe(false);
    expect(v.reason).toContain("Ungrounded number");
  });

  it("accepts safe, grounded guidance without doses and with valid numbers", () => {
    const v = validateAgronomyGuidance(
      "Across 14 days, your farm recorded 25 mm of rainfall. Consult your local ADP extension officer for pest control advice.",
      allowedNumbers
    );
    expect(v.valid).toBe(true);
  });
});

describe("buildAllowedAgronomyNumbers", () => {
  const farm: FarmProfile = {
    id: "farm_ade_iseyin",
    ownerName: "Ade",
    lga: "Iseyin",
    state: "Oyo",
    crop: "maize",
    hectares: 3.5,
    zone: "derived_savanna",
    historicalAnalogCount: 35,
    sampleHistoricalSeason: "2021",
  };

  const recentRain = {
    records: [
      { date: "2026-04-01", rain_mm: 0.0 },
      { date: "2026-04-02", rain_mm: 12.4 },
      { date: "2026-04-03", rain_mm: 5.0 },
    ],
    totalRainMm: 17.4,
    startDate: "2026-04-01",
    endDate: "2026-04-03",
    daysCount: 3,
    provenance: "zetaris:oko_pg.rain_daily",
    querySql: "SELECT ...",
  };

  it("extracts allowed numbers from farm profile, daily rain records, rain days count, and memories", () => {
    const memories = [
      "Last season harvest was 40 bags of maize.",
      "Offered 45000 per bag at Iseyin market.",
    ];
    const allowed = buildAllowedAgronomyNumbers(farm, recentRain, "2026-04-10", memories);

    // Baseline standard windows
    expect(allowed.has(14)).toBe(true);
    expect(allowed.has(7)).toBe(true);
    expect(allowed.has(1)).toBe(true);
    expect(allowed.has(2)).toBe(true);

    // Farm hectares
    expect(allowed.has(3.5)).toBe(true);
    expect(allowed.has(4)).toBe(true);

    // Rain totals and records
    expect(allowed.has(17.4)).toBe(true);
    expect(allowed.has(17)).toBe(true);
    expect(allowed.has(12.4)).toBe(true);
    expect(allowed.has(5)).toBe(true);

    // Rain days (12.4 and 5.0 >= 1.0 => 2 rain days)
    expect(allowed.has(2)).toBe(true);

    // Recalled memories numbers
    expect(allowed.has(40)).toBe(true);
    expect(allowed.has(45000)).toBe(true);
  });
});

describe("explainAgronomy retry flow", () => {
  const farm: FarmProfile = {
    id: "farm_bisi_ogbomoso",
    ownerName: "Bisi",
    lga: "Ogbomoso",
    state: "Oyo",
    crop: "maize",
    hectares: 2.0,
    zone: "derived_savanna",
    historicalAnalogCount: 35,
    sampleHistoricalSeason: "2021",
  };

  class SequenceMockProvider implements LLMProvider {
    readonly name = "mock-seq";
    public calls: any[] = [];
    constructor(private responses: Array<{ answer: string; followUp: string | null }>) {}

    async complete<T>(params: LLMCompleteParams<T>): Promise<T> {
      this.calls.push(params);
      const resp = this.responses.shift();
      if (!resp) throw new Error("No more mock responses");
      return resp as unknown as T;
    }
  }

  it("retries on validator rejection and returns model guidance when attempt 2 passes", async () => {
    const mockProvider = new SequenceMockProvider([
      // Attempt 1: ungrounded number 999
      { answer: "Apply 999 units of water to your field.", followUp: null },
      // Attempt 2: valid, grounded in allowed numbers (14 days)
      { answer: "Across 14 days, check soil moisture and consult your local ADP extension officer.", followUp: null },
    ]);

    const res = await explainAgronomy({
      question: "When should I water my maize?",
      farm,
      lang: "en",
      asOf: "2026-04-10",
      provider: mockProvider,
    });

    expect(mockProvider.calls.length).toBe(2);
    expect(res.path).toBe("model");
    expect(res.fallbackReason).toBeUndefined();
    expect(res.text).toContain("Across 14 days");
  });

  it("falls back to localized template when both attempts fail validation", async () => {
    const mockProvider = new SequenceMockProvider([
      // Attempt 1: prohibited dose
      { answer: "Apply 50ml/l Sniper spray.", followUp: null },
      // Attempt 2: still ungrounded number 888
      { answer: "Wait 888 days before harvesting.", followUp: null },
    ]);

    const res = await explainAgronomy({
      question: "How do I control pests?",
      farm,
      lang: "en",
      asOf: "2026-04-10",
      provider: mockProvider,
    });

    expect(mockProvider.calls.length).toBe(2);
    expect(res.path).toBe("template");
    expect(res.model).toBe("template");
    expect(res.fallbackReason).toContain("Attempt 1");
    expect(res.fallbackReason).toContain("Attempt 2");
    expect(res.text).toMatch(/ADP.*extension officer/);
  });
});

describe("rain adequacy explanation validator and templates", () => {
  const mockDecision: Decision = {
    id: "dec_test",
    farmId: "farm_bisi_ogbomoso",
    intent: "plant_timing",
    chosen: "wait_7",
    runnerUp: "plant_now",
    confidence: "high",
    riskBadge: "green",
    createdAt: "2026-04-10T08:00:00Z",
    dataMode: "snapshot",
    keyNumbers: {
      plantingDate: "2026-04-17",
      rainP10Mm: 45,
      rainP50Mm: 95,
      rainP90Mm: 160,
      seasonsCount: 35,
    },
    options: [
      {
        option: "plant_now",
        label: "Plant now",
        score: 60,
        notes: ["Plant immediately"],
        outcome: { mean: 60, p10: 40, p50: 60, p90: 80, riskMetric: 0.141, riskLabel: "replant risk", n: 35 },
      },
      {
        option: "wait_7",
        label: "Wait a week",
        score: 85,
        notes: ["Wait 7 days"],
        outcome: { mean: 85, p10: 70, p50: 85, p90: 95, riskMetric: 0.007, riskLabel: "replant risk", n: 35 },
      },
    ],
    evidence: [],
    assumptions: [],
  };

  it("generates grounded rain adequacy template leading with establishment rain", () => {
    const textEn = templatePlantingRainAdequacy(mockDecision, "en");
    expect(textEn).toContain("No, establishment rain has not been adequate");
    expect(textEn).toContain("95 mm");
    expect(textEn).toContain("Wait a week");
    expect(textEn).toContain("17 April");

    const textYo = templatePlantingRainAdequacy(mockDecision, "yo");
    expect(textYo).toContain("95 mm");
    expect(textYo).toContain("Dúró fún ọ̀sẹ̀ kan");
  });

  it("validates that rain adequacy output allows mm figures but rejects forecast words", () => {
    // Allows mm when focus is rain_adequacy
    const validOutput = {
      headline: "Wait a week. Plant around 17 April.",
      reason: "In past seasons, planting now had 95 mm establishment rain. Wait a week for safer soil moisture.",
      details: [],
      followUpQuestion: null,
    };
    const checkValid = validateOutputStructure(validOutput, "rain_adequacy");
    expect(checkValid.valid).toBe(true);

    // Rejects forecast words
    const forecastOutput = {
      headline: "Wait a week. Plant around 17 April.",
      reason: "The weather forecast says it will rain this month, so wait a week.",
      details: [],
      followUpQuestion: null,
    };
    const checkForecast = validateOutputStructure(forecastOutput, "rain_adequacy");
    expect(checkForecast.valid).toBe(false);
    expect(checkForecast.reason).toContain("forecast wording");
  });
});
