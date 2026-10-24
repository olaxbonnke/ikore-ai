import { describe, expect, it } from "vitest";
import { explain, findInvalidNumbers, validateYoruba, type ExplainOutput } from "../src/core/explain.ts";
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
    },
  };

  it("falls back to deterministic template when LLM generates a hallucinated number", async () => {
    const mockBadOutput: ExplainOutput = {
      headline: "Wait 7 days to plant.",
      reason: "Replanting risk drops to 25% across 50 analog years.", // 25% and 50 are invalid!
      details: [],
      followUpQuestion: null,
    };
    const provider = new MockLLMProvider(mockBadOutput);

    const reply = await explain(mockDecision, "en", provider);
    // Should fall back to templatePlanting
    expect(reply.text).toBe(templatePlanting(mockDecision, "en"));
  });

  it("falls back to deterministic template when LLM provider throws or fails", async () => {
    const provider = new MockLLMProvider({} as any, true);
    const reply = await explain(mockDecision, "en", provider);
    expect(reply.text).toBe(templatePlanting(mockDecision, "en"));
  });

  it("accepts valid grounded LLM output when all numbers match", async () => {
    const mockGoodOutput: ExplainOutput = {
      headline: "Wait 7 days to plant.",
      reason: "Planting around 17 April drops replant risk from 14.1% to 0.7% with 159.2 mm rain.",
      details: ["Evaluated across 35 analog years."],
      followUpQuestion: null,
    };
    const provider = new MockLLMProvider(mockGoodOutput);

    const reply = await explain(mockDecision, "en", provider);
    expect(reply.text).toContain("Wait 7 days to plant.");
    expect(reply.text).toContain("drops replant risk from 14.1% to 0.7%");
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
