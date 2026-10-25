import { describe, it, expect } from "vitest";
import { templatePlanting, templateAgronomyFallback } from "../src/i18n/templates";
import { understand } from "../src/core/understand";
import { handle } from "../src/core/orchestrator";
import { validateNoTimingClaims, validateAgronomyLanguage, validateNoMetaTalk } from "../src/llm/agronomy";
import { validateSellingOutput } from "../src/llm/explain";
import { formatStorageLossBags } from "../src/core/decide";
import type { Decision } from "../src/core/types";

describe("Regression tests for user rules and bug fixes", () => {
  describe("6.1 Planting template text for every wait_N variant in en, pcm, and yo", () => {
    const makeDecision = (chosen: "plant_now" | "wait_7" | "wait_14"): Decision => ({
      id: "dec_mock",
      farmId: "farm_bisi_ogbomoso",
      intent: "plant_timing",
      chosen,
      runnerUp: "wait_7",
      confidence: "high",
      riskBadge: "green",
            evidence: [],
      options: [
        {
          option: chosen,
          label: chosen,
          score: 100,
          expectedValueNgn: 1400000,
          replantProbability: chosen === "plant_now" ? 0.14 : 0.007,
        } as any,
      ],
      assumptions: [],
      keyNumbers: {
        plantingDate: chosen === "plant_now" ? "2026-04-10" : chosen === "wait_7" ? "2026-04-17" : "2026-04-24",
        offsetDays: chosen === "plant_now" ? 0 : chosen === "wait_7" ? 7 : 14,
        nAnalogYears: 35,
        replantRisk: chosen === "plant_now" ? "14.1%" : "0.7%",
        plainChance_plantNow_en: "about 1 in 7 seasons",
        plainChance_plantNow_pcm: "about 1 for every 7 seasons",
        plainChance_plantNow_yo: "ẹ̀ẹ̀kan nínú àsìkò méje",
        plainChance_chosen_en: chosen === "plant_now" ? "about 1 in 7 seasons" : "almost never",
        plainChance_chosen_pcm: chosen === "plant_now" ? "about 1 for every 7 seasons" : "almost never",
        plainChance_chosen_yo: chosen === "plant_now" ? "ẹ̀ẹ̀kan nínú àsìkò méje" : "fẹ́rẹ́ kò ṣẹlẹ̀ rárá",
      },
      createdAt: "2026-04-10T00:00:00.000Z",
      dataMode: "snapshot",
    });

    it("verifies en templates for plant_now, wait_7, wait_14", () => {
      const now = templatePlanting(makeDecision("plant_now"), "en");
      expect(now).toContain("Plant now around 10 April.");
      expect(now).toContain("Replanting was needed in about 1 in 7 seasons with enough rain");

      const w7 = templatePlanting(makeDecision("wait_7"), "en");
      expect(w7).toContain("Wait a week. Plant around 17 April.");
      expect(w7).toContain("replanting was almost never needed in 35 past seasons.");

      const w14 = templatePlanting(makeDecision("wait_14"), "en");
      expect(w14).toContain("Wait two weeks. Plant around 24 April.");
      expect(w14).toContain("replanting was almost never needed in 35 past seasons.");
    });

    it("verifies pcm templates for plant_now, wait_7, wait_14", () => {
      const now = templatePlanting(makeDecision("plant_now"), "pcm");
      expect(now).toContain("Plant now around 10 April.");
      expect(now).toContain("replanting almost never happen");

      const w7 = templatePlanting(makeDecision("wait_7"), "pcm");
      expect(w7).toContain("Wait one week. Plant around 17 April.");
      expect(w7).toContain("e almost never happen for 35 past seasons.");

      const w14 = templatePlanting(makeDecision("wait_14"), "pcm");
      expect(w14).toContain("Wait two weeks. Plant around 24 April.");
      expect(w14).toContain("e almost never happen for 35 past seasons.");
    });

    it("verifies yo templates for plant_now, wait_7, wait_14", () => {
      const now = templatePlanting(makeDecision("plant_now"), "yo");
      expect(now).toContain("Gbìn àgbàdo rẹ báyìí ní nǹkan bí Ọjọ́ Ẹtì, 10 Oṣù Kẹrin.");
      expect(now).toContain("fẹ́rẹ́ kò ṣẹlẹ̀ rárá");

      const w7 = templatePlanting(makeDecision("wait_7"), "yo");
      expect(w7).toContain("Dúró ọ̀sẹ̀ kan. Gbìn ní nǹkan bí Ọjọ́ Ẹtì, 17 Oṣù Kẹrin.");
      expect(w7).toContain("Tí o bá dúró ọ̀sẹ̀ kan");
      expect(w7).toContain("fẹ́rẹ́ kò ṣẹlẹ̀ rárá nínú àsìkò 35 sẹ́yìn.");

      const w14 = templatePlanting(makeDecision("wait_14"), "yo");
      expect(w14).toContain("Dúró ọ̀sẹ̀ méjì. Gbìn ní nǹkan bí Ọjọ́ Ẹtì, 24 Oṣù Kẹrin.");
      expect(w14).toContain("Tí o bá dúró ọ̀sẹ̀ méjì");
      expect(w14).toContain("fẹ́rẹ́ kò ṣẹlẹ̀ rárá nínú àsìkò 35 sẹ́yìn.");
    });
  });

  describe("6.2 Compound en and yo questions return 2 parts in correct order", () => {
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

    it("runs handle() in sample mode and returns parts in correct order with metadata", async () => {
      process.env.SAMPLE_MODE = "true";
      const reply = await handle({
        farmId: "farm_bisi_ogbomoso",
        text: "when do i start planting and how should i wet my maize",
        lang: "en",
      });

      expect(reply.parts).toBeDefined();
      expect(reply.parts?.length).toBe(2);
      expect(reply.parts?.[0].intent).toBe("plant_timing");
      expect(reply.parts?.[0].kind).toBe("decision");
      expect(reply.parts?.[0].responded_model).toBe("template");

      expect(reply.parts?.[1].intent).toBe("maize_agronomy");
      expect(reply.parts?.[1].kind).toBe("guidance");
      expect(reply.parts?.[1].topic).toBe("watering");
      expect(reply.parts?.[1].responded_model).toBe("template");
      process.env.SAMPLE_MODE = undefined;
    });
  });

  describe("6.3 Agronomy timing claims rejection", () => {
    it("rejects guidance claiming planting time is now or stating dates", () => {
      expect(validateNoTimingClaims("Planting time for your area is now, at the start of the rains.").valid).toBe(false);
      expect(validateNoTimingClaims("Wait a week before you plant.").valid).toBe(false);
      expect(validateNoTimingClaims("Start planting in April.").valid).toBe(false);
      expect(validateNoTimingClaims("Plant around 17 April.").valid).toBe(false);
      expect(validateNoTimingClaims("Gbìn báyìí kí o tó bomi rin ín.").valid).toBe(false);

      // Safe practical qualitative advice passes
      expect(validateNoTimingClaims("Rain-fed maize relies on rains. Check that soil is moist about a finger deep.").valid).toBe(true);
    });
  });

  describe("6.4 Yoruba language check rejects English and Pidgin leaks", () => {
    it("rejects Yoruba reply that ends in English/Pidgin storage advice", () => {
      const mixedText = "Dúró díẹ̀ kí o gbìn. Consult your ADP officer for di best storage tips for your area.";
      const res = validateAgronomyLanguage(mixedText, "yo");
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("English or Pidgin");
    });

    it("accepts pure tone-marked Yoruba agronomy guidance", () => {
      const pureYo = templateAgronomyFallback("watering", "yo");
      const res = validateAgronomyLanguage(pureYo, "yo");
      expect(res.valid).toBe(true);
    });
  });

  describe("6.5 Sell/store grounding in en, pcm, and yo", () => {
    const makeSellingDecision = (isPics = true, lossBags = 0.06): Decision => ({
      id: "dec_sell_test",
      farmId: "farm_ade_iseyin",
      intent: "sell_or_store",
      chosen: "store_8w",
      runnerUp: "store_12w",
      confidence: "medium",
      riskBadge: "green",
            evidence: [],
      options: [],
      assumptions: [],
      keyNumbers: {
        nYears: 8,
        cheaperCount: 0,
        countEarnedMore: 8,
        countEarnedLess: 0,
        higherPriceCount: 8,
        isPics: isPics ? 1 : 0,
        lossBags,
        monthlyLossPct: isPics ? 0.3 : 2.5,
      },
      createdAt: "2026-04-10T00:00:00.000Z",
      dataMode: "snapshot",
    });

    it("rejects claiming maize was cheaper after storage when stored price was higher", () => {
      const dec = makeSellingDecision();
      const text = "Store 8 weeks. In 8 out of 8 past years, Ibadan maize was cheaper after 8 weeks storage.";
      const res = validateSellingOutput(text, dec);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("Direction check failed");
    });

    it("rejects plain sacks when the storage assumption is PICS hermetic bags", () => {
      const dec = makeSellingDecision(true, 0.06);
      const text = "Store 8 weeks. In 8 out of 8 past years, storing earned more. Your 20 bags would lose a small amount in plain sacks.";
      const res = validateSellingOutput(text, dec);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("Bag type check failed");
    });

    it("rejects half a bag when loss is 0.06 bags (< 0.25 bags)", () => {
      const dec = makeSellingDecision(true, 0.06);
      const text = "Store 8 weeks. In 8 out of 8 past years, storing earned more. Your 20 bags would lose about half a bag every month.";
      const res = validateSellingOutput(text, dec);
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("Storage loss check failed");
    });

    it("accepts honest grounded selling explanation quoting PICS bags and concrete fraction", () => {
      const dec = makeSellingDecision(true, 0.06);
      const text = "Store your maize for 8 weeks.\n\nIn 8 of 8 past years, storing eight weeks earned more than selling now. Expected loss in PICS bags is less than a tenth of a bag out of your 20.";
      const res = validateSellingOutput(text, dec);
      expect(res.valid).toBe(true);
    });

    it("verifies formatStorageLossBags produces concrete fractions under 0.25 bags", () => {
      const loss20 = formatStorageLossBags(20, 0.3);
      expect(loss20.en).toBe("less than a tenth of a bag out of your 20");
      expect(loss20.yo).toBe("kò tó ìdá mẹ́wàá àpò kan nínú àpò 20 rẹ");
      expect(loss20.pcm).toBe("less than one-tenth of bag inside your 20");
    });
  });

  describe("6.6 Meta talk rejection in agronomy guidance", () => {
    it("rejects meta talk and self-referential statements in en, pcm, and yo", () => {
      expect(validateNoMetaTalk("Planting timing is not my role; I only advise on field operations.").valid).toBe(false);
      expect(validateNoMetaTalk("As an AI, I only advise on maize operations.").valid).toBe(false);
      expect(validateNoMetaTalk("No be my role to tell you when to plant.").valid).toBe(false);
      expect(validateNoMetaTalk("Kì í ṣe ojúṣe mi láti sọ ìgbà gbígbìn.").valid).toBe(false);

      // Practical field advice without meta-talk passes
      expect(validateNoMetaTalk("Rain-fed maize relies primarily on rainfall. Check that topsoil is moist about a finger deep.").valid).toBe(true);
    });
  });
});
