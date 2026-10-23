import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decide } from "../src/core/decide.ts";
import { handle } from "../src/core/orchestrator.ts";
import {
  computeSeasonalIndex,
  simulateSelling,
  type MonthlyPriceRecord,
} from "../src/core/simulate/selling.ts";
import type { OptionResult } from "../src/core/types.ts";

function loadPriceSnapshot(): MonthlyPriceRecord[] {
  const p = path.resolve(process.cwd(), "data", "snapshots", "price_monthly__oyo.json");
  const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
  return parsed.rows || [];
}

describe("simulateSelling (src/core/simulate/selling.ts)", () => {
  it("seasonal index sanity: mean across 12 calendar months equals 1.0", () => {
    const prices = loadPriceSnapshot();
    const asOf = "2026-08-20";
    const result = computeSeasonalIndex(prices, asOf, "Maize (white)");

    expect(result.monthlyIndices).toHaveLength(12);
    expect(result.nYears).toBeGreaterThanOrEqual(3);

    const sum = result.monthlyIndices.reduce((a, b) => a + b, 0);
    const mean = sum / 12;
    expect(Number(mean.toFixed(2))).toBe(1.0);
  });

  it("no look-ahead: mutating or adding future prices on or after asOf does not change simulation or ratios", () => {
    const prices = loadPriceSnapshot();
    const asOf = "2026-08-20";

    const baseSim = simulateSelling({
      prices,
      asOf,
      currentPricePerBag: 45000,
      bags: 20,
    });

    // Mutate prices for dates >= asOf (e.g. inject extreme future values in 2026-09 to 2026-12)
    const mutatedPrices: MonthlyPriceRecord[] = [
      ...prices,
      { state: "Oyo", market: "Ibadan", commodity: "Maize (white)", ym: "2026-09", price_ngn_per_kg: 9999 },
      { state: "Oyo", market: "Ibadan", commodity: "Maize (white)", ym: "2026-10", price_ngn_per_kg: 8888 },
    ];

    const mutatedSim = simulateSelling({
      prices: mutatedPrices,
      asOf,
      currentPricePerBag: 45000,
      bags: 20,
    });

    expect(mutatedSim).toHaveLength(baseSim.length);
    for (let i = 0; i < baseSim.length; i++) {
      expect(mutatedSim[i].outcome.riskMetric).toBe(baseSim[i].outcome.riskMetric);
      expect(mutatedSim[i].outcome.p50).toBe(baseSim[i].outcome.p50);
      expect(mutatedSim[i].score).toBe(baseSim[i].score);
    }
  });

  it("verdict invariant to price level: ₦30,000 vs ₦60,000 per bag produces the same verdict when there is no cash need", () => {
    const prices = loadPriceSnapshot();
    const asOf = "2026-08-20";

    const sim30k = simulateSelling({
      prices,
      asOf,
      currentPricePerBag: 30000,
      bags: 20,
    });

    const dec30k = decide(sim30k as unknown as OptionResult[], {
      farmId: "farm_bisi_ogbomoso",
      intent: "sell_or_store",
      asOf,
      dataMode: "snapshot",
      sellingOptions: sim30k,
      currentPricePerBag: 30000,
      bags: 20,
    });

    const sim60k = simulateSelling({
      prices,
      asOf,
      currentPricePerBag: 60000,
      bags: 20,
    });

    const dec60k = decide(sim60k as unknown as OptionResult[], {
      farmId: "farm_bisi_ogbomoso",
      intent: "sell_or_store",
      asOf,
      dataMode: "snapshot",
      sellingOptions: sim60k,
      currentPricePerBag: 60000,
      bags: 20,
    });

    expect(dec30k.chosen).toBe(dec60k.chosen);
    expect(dec30k.runnerUp).toBe(dec60k.runnerUp);

    // Risk metrics are scale-invariant
    const risk30k = sim30k.map((o) => o.outcome.riskMetric);
    const risk60k = sim60k.map((o) => o.outcome.riskMetric);
    expect(risk30k).toEqual(risk60k);
  });

  it("storage sensitivity: evaluates plain sack (2.5%) vs PICS hermetic bags (0.3%)", () => {
    const prices = loadPriceSnapshot();
    const asOf = "2026-08-20";

    const simSack = simulateSelling({
      prices,
      asOf,
      currentPricePerBag: 45000,
      bags: 20,
      storageMethod: "sack",
      monthlyLossPct: 2.5,
    });

    const decSack = decide(simSack as unknown as OptionResult[], {
      farmId: "farm_bisi_ogbomoso",
      intent: "sell_or_store",
      asOf,
      dataMode: "snapshot",
      sellingOptions: simSack,
      currentPricePerBag: 45000,
      bags: 20,
      storageMethod: "sack",
    });

    const simPics = simulateSelling({
      prices,
      asOf,
      currentPricePerBag: 45000,
      bags: 20,
      storageMethod: "pics",
      monthlyLossPct: 0.3,
    });

    const decPics = decide(simPics as unknown as OptionResult[], {
      farmId: "farm_bisi_ogbomoso",
      intent: "sell_or_store",
      asOf,
      dataMode: "snapshot",
      sellingOptions: simPics,
      currentPricePerBag: 45000,
      bags: 20,
      storageMethod: "pics",
    });

    console.log(
      `Storage Sensitivity: plain sack (2.5% loss/mo) chose ${decSack.chosen}; PICS bag (0.3% loss/mo) chose ${decPics.chosen}`
    );

    // In August in Oyo, post-harvest price declines mean storing in sacks loses value.
    // Even in PICS bags, August-to-October price declines still mean holding grain carries high risk of earning less than selling at harvest.
    expect(decSack.chosen).toBe("sell_now");
    expect(decPics.chosen).toBe("sell_now");
    // PICS bags preserve more value than plain sacks
    const p50PicsStore4w = simPics.find((o) => o.option === "store_4w")!.outcome.p50;
    const p50SackStore4w = simSack.find((o) => o.option === "store_4w")!.outcome.p50;
    expect(p50PicsStore4w).toBeGreaterThan(p50SackStore4w);
  });

  it("cash need produces partial_sell_store_8w and drops incompatible full-storage options", () => {
    const prices = loadPriceSnapshot();
    const asOf = "2026-08-20";

    const simWithCashNeed = simulateSelling({
      prices,
      asOf,
      currentPricePerBag: 45000,
      bags: 20,
      cashNeed: {
        amountNgn: 400000,
        dueInWeeks: 4,
        description: "school fees",
      },
    });

    const partialOpt = simWithCashNeed.find((o) => o.option === "partial_sell_store_8w");
    expect(partialOpt).toBeDefined();
    // 400,000 / 45,000 = 8.88 -> 9 bags sold now, 11 bags stored
    expect(partialOpt?.bagsSoldNow).toBe(9);
    expect(partialOpt?.bagsStored).toBe(11);
    expect(partialOpt?.cashGeneratedNow).toBe(9 * 45000);

    // store_8w and store_12w hold all grain past 4 weeks, so they should be marked dropped
    const store8w = simWithCashNeed.find((o) => o.option === "store_8w")!;
    const store12w = simWithCashNeed.find((o) => o.option === "store_12w")!;
    expect(store8w.dropped).toBe(true);
    expect(store8w.dropReason).toContain("leaving ₦0 cash");
    expect(store12w.dropped).toBe(true);
  });
});

describe("Orchestrator sell_or_store end-to-end", () => {
  it("missing price leads to a question, not a verdict", async () => {
    process.env.DATA_MODE = "snapshot";
    process.env.OKO_DEMO_DATE = "2026-08-20";

    const reply = await handle({
      farmId: "farm_bisi_ogbomoso",
      text: "Should I sell my 20 bags of maize now or keep them in storage?",
    });

    expect(reply.askedQuestion).toBe(true);
    expect(reply.decision).toBeUndefined();
    expect(reply.text.toLowerCase()).toContain("what price per bag are buyers offering you today");
  });

  it("runs end-to-end for Mama Bisi with stated price of ₦45,000/bag at asOf=2026-08-20", async () => {
    process.env.DATA_MODE = "snapshot";
    process.env.OKO_DEMO_DATE = "2026-08-20";

    const reply = await handle({
      farmId: "farm_bisi_ogbomoso",
      text: "I harvest 20 bags of 100 kg. Buyer dey offer 45,000 naira per bag. Make I sell now or keep am?",
    });

    expect(reply.askedQuestion).toBe(false);
    expect(reply.decision).toBeDefined();

    const d = reply.decision!;
    expect(d.intent).toBe("sell_or_store");
    expect(d.chosen).toBe("sell_now");
    expect(d.keyNumbers.currentPricePerBag).toBe(45000);
    expect(d.keyNumbers.bags).toBe(20);
    expect(d.keyNumbers.valueSellNowNgn).toBe(900000);

    // Evidence checks
    const priceEv = d.evidence.find((e) => e.id === "ev_stated_price");
    expect(priceEv).toBeDefined();
    expect(priceEv?.statistic).toBe("Today's price: you told me ₦45,000 per bag.");

    const seasonEv = d.evidence.find((e) => e.id === "ev_price_seasonality");
    expect(seasonEv).toBeDefined();
    expect(seasonEv?.statistic).toContain("Seasonal pattern: WFP Ibadan maize, 2014 to 2023");

    // Reply text contains honest explanation
    expect(reply.text.toLowerCase()).toContain("sell now for ₦900,000");
    expect(reply.text.toLowerCase()).toContain("in most past years");
  });
});
