import { afterEach, describe, expect, it, vi } from "vitest";
import {
  explain,
  explainRecall,
  findInvalidNumbers,
  validateNoPercentages,
  validateOptionAttribution,
  validateOutputStructure,
  validateRecallLanguage,
  validateYoruba,
  validateRepetition,
  REPETITION_MIN_CLAUSE_WORDS,
  REPETITION_MAX_CLAUSE_REPETITIONS,
  REPETITION_NGRAM_SIZE,
  REPETITION_MAX_NGRAM_REPETITIONS,
  REPETITION_MIN_WORDS_FOR_RATIO,
  REPETITION_MIN_UNIQUE_RATIO,
  type ExplainOutput,
} from "../src/core/explain.ts";
import type { Decision, Lang } from "../src/core/types.ts";
import { templatePlanting, templateSelling } from "../src/i18n/templates.ts";
import { extractRules, understand } from "../src/llm/understand.ts";
import type { LLMCompleteParams, LLMProvider } from "../src/llm/provider.ts";

// Helper mock provider
class MockLLMProvider implements LLMProvider {
  readonly name = "mock-llm";
  constructor(private output: ExplainOutput | string, private shouldThrow = false) {}

  async complete<T>(_params: LLMCompleteParams<T>): Promise<T> {
    if (this.shouldThrow) {
      throw new Error("Network / Provider error");
    }
    return this.output as unknown as T;
  }
}

describe("findInvalidNumbers and Number Validator (src/core/explain.ts)", () => {
  const mockPlantingDecision: Decision = {
    id: "dec_plant_test",
    farmId: "farm_bisi_ogbomoso",
    intent: "plant_timing",
    createdAt: "2026-04-10T08:00:00Z",
    chosen: "wait_7",
    runnerUp: "wait_14",
    confidence: "high",
    riskBadge: "green",
    dataMode: "snapshot",
    assumptions: [],
    evidence: [],
    options: [],
    keyNumbers: {
      asOf: "2026-04-10",
      plantingDate: "2026-04-17",
      replantRisk: "0.7%",
      replantRiskNow: "14.1%",
      rainP50Mm: 159.2,
      nAnalogYears: 35,
      expectedValueNgn: 1400000,
    },
  };

  const mockSellingDecision: Decision = {
    id: "dec_sell_test",
    farmId: "farm_bisi_ogbomoso",
    intent: "sell_or_store",
    createdAt: "2026-08-20T08:00:00Z",
    chosen: "sell_now",
    runnerUp: "store_4w",
    confidence: "high",
    riskBadge: "green",
    dataMode: "snapshot",
    assumptions: [],
    evidence: [],
    options: [],
    keyNumbers: {
      asOf: "2026-08-20",
      bags: 20,
      currentPricePerBag: 45000,
      valueSellNowNgn: 900000,
      monthlyLossPct: 2.5,
      cheaperCount: 8,
      nYears: 9,
      expectedValueNgn: 900000,
    },
  };

  it("passes when all numbers in the reply match Decision.keyNumbers", () => {
    const text =
      "Wait 7 days to plant around 17 April. Planting now carries a 14.1% risk, whereas waiting drops the risk to 0.7% with 159.2 mm rain across 35 analog years.";
    const invalid = findInvalidNumbers(text, mockPlantingDecision);
    expect(invalid).toEqual([]);
  });

  it("catches an invented or wrong number and flags it", () => {
    // 50 is not in keyNumbers (nAnalogYears is 35)
    const text =
      "Wait 7 days to plant. We analyzed 50 analog years and replant risk is 0.7%.";
    const invalid = findInvalidNumbers(text, mockPlantingDecision);
    expect(invalid).toContain("50");
  });

  it("catches an invented currency amount", () => {
    // ₦1,200,000 is not in keyNumbers (expectedValueNgn is 1,400,000)
    const text = "Planting now will yield ₦1,200,000 instead of ₦1,400,000.";
    const invalid = findInvalidNumbers(text, mockPlantingDecision);
    expect(invalid).toContain("₦1,200,000");
  });

  it("catches an invented percentage not present in keyNumbers", () => {
    // 25% is not in keyNumbers
    const text = "Wait 7 days because the replanting risk right now is 25%.";
    const invalid = findInvalidNumbers(text, mockPlantingDecision);
    expect(invalid).toContain("25%");
  });

  it("normalises 45k and ₦900,000 in selling decisions", () => {
    const text = "Sell 20 bags now for ₦900,000 at 45k per bag. In 8 of the 9 past years prices dropped.";
    const invalid = findInvalidNumbers(text, mockSellingDecision);
    expect(invalid).toEqual([]);
  });

  it("catches wrong count of years in selling decisions", () => {
    // 10 years instead of 9
    const text = "In 8 of the 10 past years prices dropped.";
    const invalid = findInvalidNumbers(text, mockSellingDecision);
    expect(invalid).toContain("10");
  });
});

describe("explain() integration with validation & fallback (src/core/explain.ts)", () => {
  const mockDecision: Decision = {
    id: "dec_plant_test",
    farmId: "farm_bisi_ogbomoso",
    intent: "plant_timing",
    createdAt: "2026-04-10T08:00:00Z",
    chosen: "wait_7",
    runnerUp: "wait_14",
    confidence: "high",
    riskBadge: "green",
    dataMode: "snapshot",
    assumptions: [],
    evidence: [],
    options: [],
    keyNumbers: {
      asOf: "2026-04-10",
      plantingDate: "2026-04-17",
      replantRisk: "0.7%",
      replantRiskNow: "14.1%",
      rainP50Mm: 159.2,
      nAnalogYears: 35,
      plainChance_plantNow_en: "about 1 in 7 seasons",
      plainChance_wait7_en: "almost never",
    },
  };

  it("falls back to deterministic template when LLM generates a hallucinated number", async () => {
    const mockBadOutput: ExplainOutput = {
      headline: "Wait a week to plant.",
      reason: "Replanting risk drops to almost never across 50 analog years.", // 50 is invalid!
      details: [],
      followUpQuestion: null,
    };
    const provider = new MockLLMProvider(mockBadOutput);

    const reply = await explain(mockDecision, "en", provider);
    // Should fall back to templatePlanting
    expect(reply.text).toBe(templatePlanting(mockDecision, "en"));
  });

  it("falls back to deterministic template when LLM generates a percentage (Day 4.2 Polish)", async () => {
    const mockBadOutput: ExplainOutput = {
      headline: "Wait a week to plant around 17 April.",
      reason: "If you plant now, replant risk is 14.1%. Waiting drops risk to 0.7%.", // percentages rejected!
      details: [],
      followUpQuestion: null,
    };
    const provider = new MockLLMProvider(mockBadOutput);

    const reply = await explain(mockDecision, "en", provider);
    expect(reply.text).toBe(templatePlanting(mockDecision, "en"));
    expect(reply.path).toBe("template");
    expect(reply.fallbackReason).toContain("Found percentage expression");
  });

  it("falls back to deterministic template when LLM provider throws or fails", async () => {
    const provider = new MockLLMProvider({} as any, true);
    const reply = await explain(mockDecision, "en", provider);
    expect(reply.text).toBe(templatePlanting(mockDecision, "en"));
  });

  it("accepts valid grounded LLM output when all numbers match", async () => {
    const mockGoodOutput: ExplainOutput = {
      headline: "Wait a week. Plant around 17 April.",
      reason: "If you plant now, about 1 in 7 seasons needed replanting. Waiting drops replanting risk to almost never across 35 past seasons.",
      details: ["Evaluated across 35 past seasons."],
      followUpQuestion: null,
    };
    const provider = new MockLLMProvider(mockGoodOutput);

    const reply = await explain(mockDecision, "en", provider);
    expect(reply.text).toContain("Wait a week. Plant around 17 April.");
    expect(reply.text).toContain("about 1 in 7 seasons");
    expect(reply.path).toBe("llm");
  });
});

describe("Yoruba Guard (src/core/explain.ts)", () => {
  it("rejects Yoruba text with no tone marks or underdots", () => {
    const plainText = "Duro die ki o to gbin agbado re nitori ojo ko tii to.";
    const check = validateYoruba(plainText);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("No Yoruba tone marks");
  });

  it("rejects Yoruba text that is mostly English words", () => {
    const mixedText = "Dúró díẹ̀ because the replant risk is high and you will need 159.2 mm of rain.";
    const check = validateYoruba(mixedText);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("Too many English words");
  });

  it("accepts authentic Yoruba text with tone marks and proper vocabulary", () => {
    const yoText = "Dúró díẹ̀. Gbìn ní nǹkan bí 17 April. Ewu láti tún gbìn jẹ́ 0.7% pẹ̀lú 159.2 mm òjò.";
    const check = validateYoruba(yoText);
    expect(check.valid).toBe(true);
  });
});

describe("Percentage Validator (src/core/explain.ts)", () => {
  it("golden test: rejects a reply with '14.1%'", () => {
    const text = "Wait a week to plant. Planting now has 14.1% replant risk.";
    const check = validateNoPercentages(text);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("Found percentage expression");
  });

  it("rejects replies with 'percent', 'per cent', or Yoruba 'ìdá ọgọ́rùn-ún'", () => {
    expect(validateNoPercentages("Risk is 5 percent").valid).toBe(false);
    expect(validateNoPercentages("Ewu jẹ́ ìdá ọgọ́rùn-ún márùn-ún").valid).toBe(false);
    expect(validateNoPercentages("Risk is 10 per cent").valid).toBe(false);
  });

  it("accepts replies using plain language chances and counts", () => {
    const text =
      "Wait a week. Plant around 17 April.\n\nIf you plant now, about 1 in 7 seasons needed replanting. Waiting drops risk to almost never across 35 past seasons.";
    const check = validateNoPercentages(text);
    expect(check.valid).toBe(true);
  });
});

describe("Option Attribution Validator (src/core/explain.ts)", () => {
  const mockDecision: Decision = {
    id: "dec_plant_test",
    farmId: "farm_bisi_ogbomoso",
    intent: "plant_timing",
    createdAt: "2026-04-10T08:00:00Z",
    chosen: "wait_7",
    runnerUp: "wait_14",
    confidence: "high",
    riskBadge: "green",
    dataMode: "snapshot",
    assumptions: [],
    evidence: [],
    options: [],
    keyNumbers: {
      plantingDate: "2026-04-17",
      replantRisk_plantNow: "14.1%",
      replantRiskNow: "14.1%",
      replantRisk_wait7: "0.7%",
      replantRisk: "0.7%",
      nAnalogYears: 35,
    },
  };

  it("golden test: 'about 1 in 7 seasons' attached to plant_now passes", () => {
    const text =
      "Wait a week to plant around 17 April.\n\nIf you plant now, about 1 in 7 seasons needed replanting. If you wait a week, it almost never happened across 35 past seasons.";
    const check = validateOptionAttribution(text, mockDecision);
    expect(check.valid).toBe(true);
  });

  it("golden test: 'about 1 in 7 seasons' attached to wait_7 is rejected", () => {
    const text = "Wait a week to plant around 17 April because waiting has about 1 in 7 seasons replanting risk.";
    const check = validateOptionAttribution(text, mockDecision);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("appeared in same sentence as wait");
  });

  it("golden test: rejects 'Wait 7 days... replant risk is 14.1%'", () => {
    const text = "Wait 7 days... replant risk is 14.1%";
    const check = validateOptionAttribution(text, mockDecision);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("appeared in same sentence as wait");
  });

  it("golden test: rejects real failure attaching 14.1% to planting after 7 days", () => {
    const text =
      "Wait 7 days to plant around 2026-04-17.\n\nWith 35 past seasons median rain is 159.2 mm and replant risk is 14.1%, planting after 7 days gives a solid start.";
    const check = validateOptionAttribution(text, mockDecision);
    expect(check.valid).toBe(false);
  });

  it("passes when risk numbers are properly attributed to their respective options", () => {
    const text =
      "Wait 7 days to plant around 17 April.\n\nIf you plant now, danger to replant is 14.1%. Waiting drops danger to 0.7% with enough rain across 35 past seasons.";
    const check = validateOptionAttribution(text, mockDecision);
    expect(check.valid).toBe(true);
  });
});

describe("Output Structure Validator (src/core/explain.ts)", () => {
  it("rejects headline with more than 12 words", () => {
    const output: ExplainOutput = {
      headline: "You should definitely wait at least seven days before planting your maize on your farm", // 14 words
      reason: "Danger drops to 0.7% across 35 past seasons.",
      details: [],
      followUpQuestion: null,
    };
    const check = validateOutputStructure(output);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("max 12 allowed");
  });

  it("rejects reason with more than 2 sentences", () => {
    const output: ExplainOutput = {
      headline: "Wait 7 days to plant around 17 April.",
      reason: "If you plant now danger is 14.1%. Waiting drops danger to 0.7%. Rainfall will be adequate.",
      details: [],
      followUpQuestion: null,
    };
    const check = validateOutputStructure(output);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("max 2 allowed");
  });

  it("rejects reason with more than 3 numbers", () => {
    const output: ExplainOutput = {
      headline: "Wait 7 days to plant around 17 April.",
      reason: "Planting on 10 April has 14.1% risk, but waiting until 17 April drops risk to 0.7% across 35 seasons.", // 5 numbers: 10, 14.1%, 17, 0.7%, 35
      details: [],
      followUpQuestion: null,
    };
    const check = validateOutputStructure(output);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("max 3 allowed");
  });

  it("rejects reason with technical jargon (analog years, median, mm)", () => {
    const output: ExplainOutput = {
      headline: "Wait 7 days to plant around 17 April.",
      reason: "Median establishment rain is 159.2 mm across 35 analog years.",
      details: [],
      followUpQuestion: null,
    };
    const check = validateOutputStructure(output);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("technical jargon");
  });

  it("rejects reason containing ISO dates", () => {
    const output: ExplainOutput = {
      headline: "Wait 7 days to plant.",
      reason: "Do not plant until 2026-04-17 because risk is high.",
      details: [],
      followUpQuestion: null,
    };
    const check = validateOutputStructure(output);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("ISO date format");
  });

  it("accepts output meeting all DESIGN.md 8.3 constraints", () => {
    const output: ExplainOutput = {
      headline: "Wait 7 days to plant around 17 April.",
      reason: "If you plant now, danger to replant is 14.1%. Waiting drops danger to 0.7% with enough rain across 35 past seasons.",
      details: ["35 past seasons evaluated"],
      followUpQuestion: null,
    };
    const check = validateOutputStructure(output);
    expect(check.valid).toBe(true);
  });
});

describe("Deterministic Templates coverage (src/i18n/templates.ts)", () => {
  const languages: Lang[] = ["en", "pcm", "yo"];

  it("renders all planting verdicts (plant_now, wait_7, wait_14) in en, pcm, yo without placeholders", () => {
    const verdicts = ["plant_now", "wait_7", "wait_14"];
    for (const chosen of verdicts) {
      for (const lang of languages) {
        const decision: Decision = {
          id: `dec_${chosen}`,
          farmId: "farm_bisi_ogbomoso",
          intent: "plant_timing",
          createdAt: "2026-04-10T08:00:00Z",
          chosen,
          runnerUp: chosen === "wait_7" ? "wait_14" : "wait_7",
          confidence: "high",
          riskBadge: "green",
          dataMode: "snapshot",
          assumptions: [],
          evidence: [],
          options: [],
          keyNumbers: {
            asOf: "2026-04-10",
            plantingDate: "2026-04-17",
            replantRisk: "0.7%",
            replantRiskNow: "14.1%",
            rainP50Mm: 159.2,
            nAnalogYears: 35,
          },
        };

        const rendered = templatePlanting(decision, lang);
        expect(rendered).toBeDefined();
        expect(rendered.length).toBeGreaterThan(15);
        expect(rendered).not.toContain("undefined");
        expect(rendered).not.toContain("null");
        expect(rendered).not.toContain("NaN");
        expect(rendered).not.toContain("[object");
      }
    }
  });

  it("renders all selling verdicts (sell_now, partial_sell_store_8w, store_4w, store_8w, store_12w, store_24w) in en, pcm, yo without placeholders", () => {
    const verdicts = [
      "sell_now",
      "partial_sell_store_8w",
      "store_4w",
      "store_8w",
      "store_12w",
      "store_24w",
    ];

    for (const chosen of verdicts) {
      for (const lang of languages) {
        const decision: Decision = {
          id: `dec_${chosen}`,
          farmId: "farm_bisi_ogbomoso",
          intent: "sell_or_store",
          createdAt: "2026-08-20T08:00:00Z",
          chosen,
          runnerUp: chosen === "sell_now" ? "store_4w" : "sell_now",
          confidence: "high",
          riskBadge: "green",
          dataMode: "snapshot",
          assumptions: [],
          evidence: [],
          options: [],
          keyNumbers: {
            asOf: "2026-08-20",
            bags: 20,
            currentPricePerBag: 45000,
            valueSellNowNgn: 900000,
            monthlyLossPct: 2.5,
            cheaperCount: 8,
            nYears: 9,
            horizonWeeks: chosen === "store_24w" ? 24 : 4,
            valueP50Ngn: 850000,
            valueP10Ngn: 700000,
            valueP90Ngn: 950000,
            bagsSoldNow: 10,
            bagsStored: 10,
            cashGeneratedNow: 450000,
          },
        };

        const rendered = templateSelling(decision, lang);
        expect(rendered).toBeDefined();
        expect(rendered.length).toBeGreaterThan(20);
        expect(rendered).not.toContain("undefined");
        expect(rendered).not.toContain("null");
        expect(rendered).not.toContain("NaN");
        expect(rendered).not.toContain("[object");
      }
    }
  });
});

describe("Intent & Slot extraction (src/llm/understand.ts)", () => {
  it("handles 'I get 20 bags, price na 45k per bag. Make I sell?' per DESIGN.md 8.2", async () => {
    const text = "I get 20 bags, price na 45k per bag. Make I sell?";
    const res = await understand(text);

    expect(res.intent).toBe("sell_or_store");
    expect(res.language).toBe("pcm");
    expect(res.slots.bags).toBe(20);
    expect(res.slots.pricePerBagNgn).toBe(45000);
    expect(res.missing).toEqual([]);
  });

  it("handles Yoruba selling inquiry with tone marks", async () => {
    const text = "Mo ní àpò 20, ẹnìkan fẹ́ rà ní ₦45,000 fún àpò kọ̀ọ̀kan. Ṣé kí n tà á báyìí?";
    const res = await understand(text);

    expect(res.intent).toBe("sell_or_store");
    expect(res.language).toBe("yo");
    expect(res.slots.bags).toBe(20);
    expect(res.slots.pricePerBagNgn).toBe(45000);
  });

  it("handles English planting timing question", async () => {
    const text = "When should I plant my maize this season?";
    const res = await understand(text);

    expect(res.intent).toBe("plant_timing");
    expect(res.language).toBe("en");
    expect(res.missing).toEqual([]);
  });
});

describe("explainRecall & validateRecallLanguage (src/llm/explain.ts)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("validates language correctly for Yoruba, Pidgin, and English", () => {
    // English leak in Yoruba
    const badYo = validateRecallLanguage("On 10 April I told you to wait a week and plant around 17 April.", "yo");
    expect(badYo.valid).toBe(false);

    // Valid Yoruba
    const goodYo = validateRecallLanguage("Ní Ọjọ́ Ẹtì, 10 April mo sọ fún ọ pé kí o dúró fún ọ̀sẹ̀ kan kí o sì gbìn ní nǹkan bí Ọjọ́ Ẹtì, 17 April.", "yo");
    expect(goodYo.valid).toBe(true);

    // Formal English in Pidgin
    const badPcm = validateRecallLanguage("I advised you to wait one week before planting.", "pcm");
    expect(badPcm.valid).toBe(false);

    // Valid Pidgin
    const goodPcm = validateRecallLanguage("For 10 April I tell you say make you wait one week and plant around 17 April.", "pcm");
    expect(goodPcm.valid).toBe(true);
  });

  it("retries on language mismatch and falls back to templateRecallAdvice if retry still fails", async () => {
    vi.stubEnv("SAMPLE_MODE", "false");

    // Mock provider returning English when Yoruba was requested
    const englishLeakProvider = new MockLLMProvider({
      reply: "On 10 April I told you to wait a week and plant around 17 April.",
    } as any);

    const result = await explainRecall({
      question: "Kí lo sọ fún mi nípa ìgbà tí màá gbìn?",
      adviceContent: "Question: \"When to plant?\". Planting advice for 2026-04-10: wait_7. Planting date 2026-04-17. Replant risk 0.7%, expected value ₦1,400,000.",
      lang: "yo",
      provider: englishLeakProvider,
    });

    // Should fall back to Yoruba template
    expect(result.path).toBe("template");
    expect(result.fallbackReason).toContain("Language check failed");
    expect(result.text).toMatch(/sọ fún ọ/);
    expect(result.text).toMatch(/Ọjọ́ Ẹtì, 17 Oṣù Kẹrin/);
    expect(result.text).not.toMatch(/I told you|wait a week/i);
  });

  it("accepts valid Yoruba reply from provider", async () => {
    vi.stubEnv("SAMPLE_MODE", "false");

    const yorubaProvider = new MockLLMProvider({
      reply: "Ní Ọjọ́ Ẹtì, 10 April mo sọ fún ọ pé kí o dúró fún ọ̀sẹ̀ kan kí o sì gbìn ní nǹkan bí Ọjọ́ Ẹtì, 17 April.",
    } as any);

    const result = await explainRecall({
      question: "Kí lo sọ fún mi nípa ìgbà tí màá gbìn?",
      adviceContent: "Question: \"When to plant?\". Planting advice for 2026-04-10: wait_7. Planting date 2026-04-17. Replant risk 0.7%, expected value ₦1,400,000.",
      lang: "yo",
      provider: yorubaProvider,
    });

    expect(result.path).toBe("llm");
    expect(result.text).toBe("Ní Ọjọ́ Ẹtì, 10 April mo sọ fún ọ pé kí o dúró fún ọ̀sẹ̀ kan kí o sì gbìn ní nǹkan bí Ọjọ́ Ẹtì, 17 April.");
  });
});

describe("wait_14 verdict and date wording (src/i18n/templates.ts)", () => {
  const wait14Decision: Decision = {
    id: "dec_wait14_test",
    farmId: "farm_ade_iseyin",
    intent: "plant_timing",
    createdAt: "2026-04-10T08:00:00Z",
    chosen: "wait_14",
    runnerUp: "wait_7",
    confidence: "medium",
    riskBadge: "green",
    dataMode: "live",
    assumptions: [],
    evidence: [],
    options: [
      {
        option: "plant_now",
        label: "Plant now (10 April)",
        outcome: { p10: 100, p50: 200, p90: 300, mean: 200, riskMetric: 0.101, riskLabel: "replant risk", n: 35 },
        score: 180,
        notes: [],
        offsetDays: 0,
        plantingDate: "2026-04-10",
        replantProbability: 0.101,
      } as any,
      {
        option: "wait_7",
        label: "Wait 7 days (17 April)",
        outcome: { p10: 120, p50: 220, p90: 320, mean: 220, riskMetric: 0.007, riskLabel: "replant risk", n: 35 },
        score: 218,
        notes: [],
        offsetDays: 7,
        plantingDate: "2026-04-17",
        replantProbability: 0.007,
      } as any,
      {
        option: "wait_14",
        label: "Wait 14 days (24 April)",
        outcome: { p10: 130, p50: 230, p90: 330, mean: 230, riskMetric: 0.007, riskLabel: "replant risk", n: 35 },
        score: 228,
        notes: [],
        offsetDays: 14,
        plantingDate: "2026-04-24",
        replantProbability: 0.007,
      } as any,
    ],
    keyNumbers: {
      asOf: "2026-04-10",
      plantingDate: "2026-04-24",
      replantRisk: "0.7%",
      replantRiskNow: "10.1%",
      plainChance_plantNow_en: "about 1 in 10 seasons",
      plainChance_plantNow_yo: "ẹ̀ẹ̀kan nínú àsìkò mẹ́wàá",
      plainChance_plantNow_pcm: "about 1 for every 10 seasons",
      plainChance_chosen_en: "almost never",
      plainChance_chosen_yo: "fẹ́rẹ́ kò ṣẹlẹ̀ rárá",
      plainChance_chosen_pcm: "e no dey almost happen",
      seasonsCount: 35,
    },
  };

  it("produces 'Wait two weeks' and matching plantingDate in English, never 'a week'", () => {
    const textEn = templatePlanting(wait14Decision, "en");
    expect(textEn).toContain("Wait two weeks. Plant around 24 April.");
    expect(textEn).not.toContain("Wait a week");
    expect(textEn).toContain("24 April");
    expect(textEn).toContain("about 1 in 10 seasons");
  });

  it("produces 'Dúró ọ̀sẹ̀ méjì' and matching plantingDate in Yoruba, never 'ọ̀sẹ̀ kan'", () => {
    const textYo = templatePlanting(wait14Decision, "yo");
    expect(textYo).toContain("Dúró ọ̀sẹ̀ méjì");
    expect(textYo).not.toContain("ọ̀sẹ̀ kan");
    expect(textYo).toContain("24 Oṣù Kẹrin");
    expect(textYo).toContain("ẹ̀ẹ̀kan nínú àsìkò mẹ́wàá");
  });

  it("produces 'Wait two weeks' and matching plantingDate in Pidgin, never 'one week'", () => {
    const textPcm = templatePlanting(wait14Decision, "pcm");
    expect(textPcm).toContain("Wait two weeks. Plant around 24 April.");
    expect(textPcm).not.toContain("Wait one week");
    expect(textPcm).toContain("24 April");
    expect(textPcm).toContain("about 1 for every 10 seasons");
  });
});

describe("replantProbability 0.101 figure and validation", () => {
  const decWith0101: Decision = {
    id: "dec_0101_test",
    farmId: "farm_ade_iseyin",
    intent: "plant_timing",
    createdAt: "2026-04-10T08:00:00Z",
    chosen: "wait_14",
    runnerUp: "wait_7",
    confidence: "medium",
    riskBadge: "green",
    dataMode: "live",
    assumptions: [],
    evidence: [],
    options: [
      {
        option: "plant_now",
        label: "Plant now",
        outcome: { p10: 100, p50: 200, p90: 300, mean: 200, riskMetric: 0.101, riskLabel: "replant risk", n: 35 },
        score: 180,
        notes: [],
        offsetDays: 0,
        plantingDate: "2026-04-10",
        replantProbability: 0.101,
      } as any,
    ],
    keyNumbers: {
      asOf: "2026-04-10",
      plantingDate: "2026-04-24",
      replantProbabilityNow: 0.101,
      replantRisk_plantNow: "10.1%",
      plainChance_plantNow_en: "about 1 in 10 seasons",
      plainChance_chosen_en: "almost never",
      plantNow_n: 10,
      seasonsCount: 35,
    },
  };

  it("rejects text stating 'about 1 in 7 seasons' when decision replantProbability is 0.101 (1 in 10)", () => {
    const wrongText = "Wait two weeks. Plant around 24 April.\n\nIf you plant now, about 1 in 7 seasons needed replanting. If you wait two weeks, it almost never happened in 35 past seasons.";
    const check = validateOptionAttribution(wrongText, decWith0101);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain('Replant chance "1 in 7" does not match decision expected "1 in 10"');
  });

  it("accepts text stating 'about 1 in 10 seasons' when decision replantProbability is 0.101", () => {
    const correctText = "Wait two weeks. Plant around 24 April.\n\nIf you plant now, about 1 in 10 seasons needed replanting. If you wait two weeks, it almost never happened in 35 past seasons.";
    const check = validateOptionAttribution(correctText, decWith0101);
    expect(check.valid).toBe(true);
  });
});

describe("maize_agronomy and out-of-scope question classification", () => {
  it("classifies harvest questions as maize_agronomy", () => {
    const q1 = extractRules("when should i harvest my maize");
    expect(q1.intent).toBe("maize_agronomy");

    const q2 = extractRules("ìgbà wo ni màá kórè àgbàdo mi?");
    expect(q2.intent).toBe("maize_agronomy");
  });

  it("classifies fertilizer questions as maize_agronomy", () => {
    const q1 = extractRules("Which fertilizer should I use for my maize?");
    expect(q1.intent).toBe("maize_agronomy");

    const q2 = extractRules("Ṣé kí n lo ajílẹ̀ urea báyìí?");
    expect(q2.intent).toBe("maize_agronomy");
  });

  it("classifies pest and weeding questions as maize_agronomy", () => {
    const q1 = extractRules("How do I control armyworm pests on my farm?");
    expect(q1.intent).toBe("maize_agronomy");

    const q2 = extractRules("Báwo ni mo ṣe lè pa àwọn kòkòrò?");
    expect(q2.intent).toBe("maize_agronomy");
  });

  it("classifies other non-maize crops as out_of_scope", () => {
    const q1 = extractRules("When should I plant cassava?");
    expect(q1.intent).toBe("out_of_scope");

    const q2 = extractRules("Ìgbà wo ni màá gbìn isu?");
    expect(q2.intent).toBe("out_of_scope");
  });
});

describe("validateRepetition universal guard (src/core/explain.ts)", () => {
  it("exports named repetition constants with required thresholds", () => {
    expect(REPETITION_MIN_CLAUSE_WORDS).toBe(4);
    expect(REPETITION_MAX_CLAUSE_REPETITIONS).toBe(3);
    expect(REPETITION_NGRAM_SIZE).toBe(5);
    expect(REPETITION_MAX_NGRAM_REPETITIONS).toBe(3);
    expect(REPETITION_MIN_WORDS_FOR_RATIO).toBe(30);
    expect(REPETITION_MIN_UNIQUE_RATIO).toBe(0.4);
  });

  it("rejects the exact looping Yoruba text that repeated ~6 times", () => {
    const loopingYoruba =
      "Kọ́sọ́ tí a ń gbọ́ ní a ń kọ́ sí iṣẹ́ àlàyé. " +
      "Kọ́sọ́ tí a ń gbọ́ ní a ń kọ́ sí iṣẹ́ àlàyé. " +
      "Kọ́sọ́ tí a ń gbọ́ ní a ń kọ́ sí iṣẹ́ àlàyé. " +
      "Kọ́sọ́ tí a ń gbọ́ ní a ń kọ́ sí iṣẹ́ àlàyé. " +
      "Kọ́sọ́ tí a ń gbọ́ ní a ń kọ́ sí iṣẹ́ àlàyé. " +
      "Kọ́sọ́ tí a ń gbọ́ ní a ń kọ́ sí iṣẹ́ àlàyé.";

    const check = validateRepetition(loopingYoruba);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("repetition:");
  });

  it("accepts a normal Yoruba watering reply", () => {
    const normalYoruba =
      "Bomi rin àgbàdo rẹ ní àárọ̀ kùtùkùtù nígbà tí ilẹ̀ bá ti bẹ̀rẹ̀ sí ní gbẹ. " +
      "Rí i dájú pé omi kò dúró sórí ilẹ̀ fún àkókò pípẹ́ kí gbòǹgbò má baà jẹrà.";

    const check = validateRepetition(normalYoruba);
    expect(check.valid).toBe(true);
    expect(check.reason).toBeUndefined();
  });

  it("accepts a normal English reply", () => {
    const normalEnglish =
      "Water your maize once or twice a week when rainfall is low. " +
      "Ensure the water reaches the root zone by checking the topsoil in the morning. " +
      "Avoid watering during midday heat so the water does not evaporate before the plants can absorb it.";

    const check = validateRepetition(normalEnglish);
    expect(check.valid).toBe(true);
    expect(check.reason).toBeUndefined();
  });

  it("does not falsely reject natural repetition of short word 'the' in English", () => {
    const textWithThe =
      "The farmer inspected the field in the early morning. " +
      "The soil around the maize stems had sufficient moisture from the recent rainfall. " +
      "The roots had already established well into the deeper ground layer.";

    const check = validateRepetition(textWithThe);
    expect(check.valid).toBe(true);
    expect(check.reason).toBeUndefined();
  });

  it("does not falsely reject natural repetition of short word 'ni' in Yoruba", () => {
    const textWithNi =
      "Àgbàdo nílò omi ní àárọ̀ kùtùkùtù nígbà tí oòrùn kò tíì yọ. " +
      "Nígbà tí ilẹ̀ bá gbẹ, bomirin ní ìrọ̀lẹ́ pẹ̀lú kí omi lè wọ inú ilẹ̀ dáadáa fún àwọn gbòǹgbò àgbàdo rẹ ní oko.";

    const check = validateRepetition(textWithNi);
    expect(check.valid).toBe(true);
    expect(check.reason).toBeUndefined();
  });

  it("rejects when a 5-word sequence repeats 3 or more times even without punctuation", () => {
    const repeating5Gram =
      "bomi rin agbado re daadaa bomi rin agbado re daadaa bomi rin agbado re daadaa fun ikore to dara";

    const check = validateRepetition(repeating5Gram);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("repetition:");
  });

  it("rejects when unique word ratio is below 0.4 for text over 30 words", () => {
    // 32 words with 11 unique words (ratio = 11/32 = 0.34 < 0.4), crafted so no 5-word sequence repeats 3 times
    const lowDiversity =
      "alpha beta alpha gamma alpha delta alpha epsilon alpha zeta alpha eta alpha theta alpha iota alpha kappa " +
      "beta gamma beta delta beta epsilon beta zeta beta eta beta theta beta iota beta kappa";

    const check = validateRepetition(lowDiversity);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain("repetition: unique word ratio");
  });
});
