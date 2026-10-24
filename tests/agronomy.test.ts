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
} from "../src/llm/agronomy.ts";
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
  });

  it("rejects guidance containing ungrounded numbers", () => {
    const v = validateAgronomyGuidance(
      "Yield will increase by 450 kg per hectare if watered 8 times.",
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
