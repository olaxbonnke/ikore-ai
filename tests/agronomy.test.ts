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
import { validateOutputStructure, explain } from "../src/llm/explain.ts";
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

describe("unit-aware agronomy number grounding", () => {
  const farm: FarmProfile = {
    id: "farm_ade_iseyin",
    ownerName: "Ade",
    lat: 7.97,
    lon: 3.6,
    lga: "Iseyin",
    state: "Oyo",
    crop: "maize",
    hectares: 3.5,
    storage: "sack",
    preferredLang: "yo",
    riskAversion: "normal",
    zone: "derived_savanna",
  };

  const recentRainWith5mm = {
    records: [
      { date: "2026-04-01", rain_mm: 0.0 },
      { date: "2026-04-02", rain_mm: 5.0 },
    ],
    totalRainMm: 5.0,
    startDate: "2026-04-01",
    endDate: "2026-04-14",
    daysCount: 14,
    provenance: "zetaris:oko_pg.rain_daily",
    querySql: "SELECT ...",
  };

  const recentRainWithout5mm = {
    records: [
      { date: "2026-04-01", rain_mm: 0.0 },
      { date: "2026-04-02", rain_mm: 12.0 },
    ],
    totalRainMm: 12.0,
    startDate: "2026-04-01",
    endDate: "2026-04-14",
    daysCount: 14,
    provenance: "zetaris:oko_pg.rain_daily",
    querySql: "SELECT ...",
  };

  it("rejects ungrounded measurements like 'top 5cm'", () => {
    const ctx = buildAllowedAgronomyNumbers(farm, recentRainWith5mm, "2026-04-10");
    const v = validateAgronomyGuidance("Check the top 5cm of soil before watering.", ctx);
    expect(v.valid).toBe(false);
    expect(v.reason).toContain("Ungrounded measurement or count detected");
    expect(v.reason).toContain("5cm");
  });

  it("rejects ungrounded counts and ranges like '2-3 cobs'", () => {
    const ctx = buildAllowedAgronomyNumbers(farm, recentRainWith5mm, "2026-04-10");
    const v = validateAgronomyGuidance("Check 2-3 cobs from different parts of the field.", ctx);
    expect(v.valid).toBe(false);
    expect(v.reason).toContain("Ungrounded measurement or count detected");
    expect(v.reason).toContain("2-3 cobs");
  });

  it("passes '5 mm of rain in the last 14 days' ONLY when 5 and 14 match context", () => {
    const ctxValid = buildAllowedAgronomyNumbers(farm, recentRainWith5mm, "2026-04-10");
    const vPass = validateAgronomyGuidance("Your farm received 5 mm of rain in the last 14 days.", ctxValid);
    expect(vPass.valid).toBe(true);

    const ctxInvalid = buildAllowedAgronomyNumbers(farm, recentRainWithout5mm, "2026-04-10");
    const vFail = validateAgronomyGuidance("Your farm received 5 mm of rain in the last 14 days.", ctxInvalid);
    expect(vFail.valid).toBe(false);
    expect(vFail.reason).toContain("Ungrounded rainfall measurement");
  });

  it("passes qualitative descriptions like 'a few cobs'", () => {
    const ctx = buildAllowedAgronomyNumbers(farm, recentRainWith5mm, "2026-04-10");
    const v = validateAgronomyGuidance("Check a few cobs from different parts of the field to inspect maturity.", ctx);
    expect(v.valid).toBe(true);
  });
});

describe("explainAgronomy retry flow", () => {
  const farm: FarmProfile = {
    id: "farm_bisi_ogbomoso",
    ownerName: "Bisi",
    lat: 8.13,
    lon: 4.25,
    lga: "Ogbomoso",
    state: "Oyo",
    crop: "maize",
    hectares: 2.0,
    storage: "pics",
    preferredLang: "en",
    riskAversion: "high",
    zone: "derived_savanna",
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
      // Attempt 1: ungrounded count "top 5cm"
      { answer: "Check the top 5cm of soil before watering.", followUp: null },
      // Attempt 2: qualitative, no ungrounded measurements
      { answer: "Check the topsoil moisture and consult your local ADP extension officer.", followUp: null },
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
    expect(res.text).toContain("topsoil");
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

  it("accepts a plain-text Yoruba reply that passes the validator with model path", async () => {
    class YorubaPlainMockProvider implements LLMProvider {
      readonly name = "mock-yo";
      async complete<T>(_params: LLMCompleteParams<T>): Promise<T> {
        return "Ṣàyẹ̀wò oko àgbàdo rẹ fún ọ̀rinrin ilẹ̀ kí o tó bomirin. Kàn sí alábòójútó ADP fún ìmọ̀ràn kíkún." as unknown as T;
      }
    }

    const res = await explainAgronomy({
      question: "Báwo ni mo ṣe lè rin omi fún àgbàdo mi?",
      farm: { ...farm, preferredLang: "yo" },
      lang: "yo",
      asOf: "2026-04-10",
      provider: new YorubaPlainMockProvider(),
    });

    expect(res.path).toBe("model");
    expect(res.text).toContain("Ṣàyẹ̀wò");
    expect(res.fallbackReason).toBeUndefined();
  });

  it("triggers retry when finish_reason is length (truncated response)", async () => {
    class TruncatedMockProvider implements LLMProvider {
      readonly name = "mock-trunc";
      public calls = 0;
      async completeWithMeta<T>(_params: LLMCompleteParams<T>): Promise<any> {
        this.calls++;
        if (this.calls === 1) {
          return {
            content: "Fún àbójútó oko àgbàdo rẹ tó dára, jọ̀wọ́ kàn sí",
            rawText: "Fún àbójútó oko àgbàdo rẹ tó dára, jọ̀wọ́ kàn sí",
            model: "nvidia/nemotron-3.5-lightning-30b-a3b",
            latencyMs: 150,
            finishReason: "length",
            completionTokens: 1000,
          };
        }
        return {
          content: "Fún àbójútó oko àgbàdo rẹ tó dára, kàn sí alábòójútó ADP tó wà lábúlé rẹ.",
          rawText: "Fún àbójútó oko àgbàdo rẹ tó dára, kàn sí alábòójútó ADP tó wà lábúlé rẹ.",
          model: "nvidia/nemotron-3.5-lightning-30b-a3b",
          latencyMs: 120,
          finishReason: "stop",
          completionTokens: 35,
        };
      }
      async complete<T>(params: LLMCompleteParams<T>): Promise<T> {
        return (await this.completeWithMeta(params)).content;
      }
    }

    const mockProvider = new TruncatedMockProvider();
    const res = await explainAgronomy({
      question: "Báwo ni mo ṣe lè lo ajílẹ̀ fún àgbàdo mi?",
      farm: { ...farm, preferredLang: "yo" },
      lang: "yo",
      asOf: "2026-04-10",
      provider: mockProvider,
    });

    expect(mockProvider.calls).toBe(2);
    expect(res.path).toBe("model");
    expect(res.text).toContain("alábòójútó ADP");
    expect(res.finishReason).toBe("stop");
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
    expect(textEn).toContain("In 35 similar past seasons");
    expect(textEn).toContain("95 mm");
    expect(textEn).toContain("below the 100 mm seedlings need");
    expect(textEn).toContain("That's why waiting is safer: plant around 17 April.");
    expect(textEn).toContain("waiting a week almost never did");

    const textYo = templatePlantingRainAdequacy(mockDecision, "yo");
    expect(textYo).toContain("95 mm");
    expect(textYo).toContain("Ní àsìkò 35 sẹ́yìn tí ó jọra");
    expect(textYo).toContain("Ìdí nìyí tí dídúró fi ní ààbò jù");
  });

  it("produces exact requested phrasing when establishment rain is above threshold with NiMet outlook", () => {
    const bisiDecision: Decision = {
      ...mockDecision,
      keyNumbers: {
        ...mockDecision.keyNumbers,
        plantNow_rainP10Mm: 60,
        plantNow_rainP50Mm: 168,
        plantNow_rainP90Mm: 231,
      },
      evidence: [
        {
          id: "ev_nimet_benchmark",
          kind: "forecast",
          label: "NiMet benchmark",
          source: "NiMet",
          statistic: "NiMet's 2026 forecast puts onset in Oyo between 15 and 30 April. Ikore's suggested date, 17 April, falls inside that window.",
        },
      ],
    };

    const textEn = templatePlantingRainAdequacy(bisiDecision, "en");
    expect(textEn).toBe(
      "In 35 similar past seasons, planting now got a median of 168 mm of rain while seedlings established (between 60 and 231 mm), above the 100 mm they need. Even so, waiting is safer: plant around 17 April. Planting now needed replanting in about 1 in 7 seasons; waiting a week almost never did. NiMet's 2026 outlook puts onset in Oyo between 15 and 30 April, and 17 April falls inside that window."
    );
  });

  it("asserts no double periods, no capital letter after a comma, and balanced parentheses across all branches and languages", () => {
    const optionsToTest = ["plant_now", "wait_7", "wait_14"];
    const rainLevels = [
      { p50: 168, p10: 60, p90: 231 },
      { p50: 80, p10: 30, p90: 110 },
    ];
    const languages = ["en", "yo", "pcm"] as const;
    const evidenceVariants = [
      [],
      [
        {
          id: "ev_nimet_benchmark",
          kind: "forecast" as const,
          label: "NiMet",
          source: "NiMet",
          statistic: "NiMet's 2026 forecast puts onset in Oyo between 15 and 30 April. Ikore's suggested date, 17 April, falls inside that window.",
        },
      ],
    ];

    for (const opt of optionsToTest) {
      for (const rain of rainLevels) {
        for (const ev of evidenceVariants) {
          for (const lang of languages) {
            const dec: Decision = {
              ...mockDecision,
              chosen: opt,
              keyNumbers: {
                ...mockDecision.keyNumbers,
                plantingDate: opt === "plant_now" ? "2026-04-10" : opt === "wait_7" ? "2026-04-17" : "2026-04-24",
                plantNow_rainP50Mm: rain.p50,
                plantNow_rainP10Mm: rain.p10,
                plantNow_rainP90Mm: rain.p90,
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
                  option: opt,
                  label: opt,
                  score: 85,
                  notes: ["Wait option"],
                  outcome: { mean: 85, p10: 70, p50: 85, p90: 95, riskMetric: 0.007, riskLabel: "replant risk", n: 35 },
                },
              ],
              evidence: ev,
            };

            const text = templatePlantingRainAdequacy(dec, lang);

            // Assert no double periods
            expect(text).not.toContain("..");
            // Assert no capital letters following comma
            expect(text).not.toMatch(/,\s+[A-Z]/);
            // Assert balanced parentheses
            const openParens = (text.match(/\(/g) || []).length;
            const closeParens = (text.match(/\)/g) || []).length;
            expect(openParens).toBe(closeParens);
          }
        }
      }
    }
  });

  it("validates that rain adequacy output allows mm figures but rejects forecast words", () => {
    // Allows mm when focus is rain_adequacy
    const validOutput = {
      headline: "Wait a week. Plant around 17 April.",
      reason: "In past seasons, planting now had 95 mm establishment rain. Wait a week for safer soil moisture.",
      details: [],
      followUpQuestion: null,
    };
    const checkValid = validateOutputStructure(validOutput, "rain_adequacy", 95);
    expect(checkValid.valid).toBe(true);

    // Rejects forecast words
    const forecastOutput = {
      headline: "Wait a week. Plant around 17 April.",
      reason: "The weather forecast says it will rain this month, so wait a week.",
      details: [],
      followUpQuestion: null,
    };
    const checkForecast = validateOutputStructure(forecastOutput, "rain_adequacy", 95);
    expect(checkForecast.valid).toBe(false);
    expect(checkForecast.reason).toContain("forecast wording");
  });

  it("enforces median mm figure through the LLM path or falls back to template", async () => {
    // 1. LLM provides reason with median mm (95 mm) -> passes as path = "llm"
    class ValidRainLLMProvider implements LLMProvider {
      readonly name = "mock-rain-valid";
      async complete<T>(_params: LLMCompleteParams<T>): Promise<T> {
        return {
          headline: "Wait a week. Plant around 17 April.",
          reason: "In 35 similar past seasons, planting now recorded a median establishment rain of 95 mm (between 45 and 160 mm), which is below the 100 mm seedling threshold. Planting now needed replanting in about 1 in 7 seasons.",
          details: ["35 past seasons evaluated"],
          followUpQuestion: null,
        } as unknown as T;
      }
    }
    const resPass = await explain(mockDecision, "en", new ValidRainLLMProvider(), "rain_adequacy");
    expect(resPass.path).toBe("llm");
    expect(resPass.text).toContain("95 mm");

    // 2. LLM omits median mm figure -> rejected & retried, falls back to rain-aware template
    class MissingRainLLMProvider implements LLMProvider {
      readonly name = "mock-rain-missing";
      async complete<T>(_params: LLMCompleteParams<T>): Promise<T> {
        return {
          headline: "Wait a week. Plant around 17 April.",
          reason: "If you plant now, about 1 in 7 seasons needed replanting. If you wait a week, it almost never happened in 35 past seasons.",
          details: ["35 past seasons evaluated"],
          followUpQuestion: null,
        } as unknown as T;
      }
    }
    const resFail = await explain(mockDecision, "en", new MissingRainLLMProvider(), "rain_adequacy");
    expect(resFail.path).toBe("template");
    expect(resFail.text).toContain("In 35 similar past seasons");
    expect(resFail.text).toContain("95 mm");
  });
});
