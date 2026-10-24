/**
 * Risk-adjusted scoring and decision verdict (DESIGN.md step 6).
 *
 * Rules:
 * - Fully pure and deterministic.
 * - Score = expected value minus λ × downside (λ from farm risk aversion).
 * - Close call rule: If top two options are within 5% of each other,
 *   recommend the safer one (lower replant risk).
 * - Tie-break rule: If replant risk is identical (e.g. 0.7% vs 0.7%),
 *   break the tie in favor of the earlier planting date (wait_7 over wait_14)
 *   to preserve growing season length and prevent late-season terminal drought.
 * - Fill Decision.keyNumbers and Decision.evidence with full auditability.
 */

import type { Decision, EvidenceItem, OptionResult } from "./types.ts";
import type { PlantingOption } from "./simulate/planting.ts";
import type { SellingOptionResult } from "./simulate/selling.ts";

export interface DecideParams {
  farmId: string;
  intent: Decision["intent"];
  asOf: string;
  dataMode: Decision["dataMode"];
  riskAversion?: "low" | "normal" | "high";
  querySql?: string;
  provenance?: string;
  evidenceItems?: EvidenceItem[];
  plantingOptions?: PlantingOption[];
  sellingOptions?: SellingOptionResult[];
  assumptions?: string[];
  currentPricePerBag?: number;
  bags?: number;
  storageMethod?: string;
  monthlyLossPct?: number;
}

/**
 * Deterministic plain-language formatting helpers (Day 4.2 Polish)
 * Computes plain 'chance' phrases and bag loss descriptions so LLMs and templates never compute them.
 */
export function formatPlainChance(prob: number): {
  en: string;
  pcm: string;
  yo: string;
  n?: number;
} {
  const pct = prob * 100;
  if (pct < 2.0) {
    return {
      en: "almost never",
      pcm: "e no dey almost happen",
      yo: "fẹ́rẹ́ kò ṣẹlẹ̀ rárá",
      n: 0,
    };
  }
  if (pct <= 50.0) {
    const n = Math.round(100 / pct);
    const yoNumberWords: Record<number, string> = {
      2: "méjì",
      3: "mẹ́ta",
      4: "mẹ́rin",
      5: "márùn-ún",
      6: "mẹ́fà",
      7: "méje",
      8: "mẹ́jọ",
      9: "mẹ̀sán",
      10: "mẹ́wàá",
    };
    const yoN = yoNumberWords[n] || `${n}`;
    return {
      n,
      en: `about 1 in ${n} seasons`,
      pcm: `about 1 for every ${n} seasons`,
      yo: `ẹ̀ẹ̀kan nínú àsìkò ${yoN}`,
    };
  }
  const x = Math.round(pct / 10);
  return {
    n: x,
    en: `about ${x} out of 10 seasons`,
    pcm: `about ${x} for every 10 seasons`,
    yo: `ní nǹkan bí ${x} nínú àsìkò mẹ́wàá`,
  };
}

export function formatStorageLossBags(bags: number, monthlyLossPct: number, pricePerBag?: number): {
  lossBags: number;
  lossValueNgn?: number;
  en: string;
  pcm: string;
  yo: string;
} {
  const rawLoss = bags * (monthlyLossPct / 100);
  if (rawLoss < 0.25) {
    return {
      lossBags: rawLoss,
      en: "a small amount",
      pcm: "small amount",
      yo: "iye díẹ̀",
    };
  }
  const rounded = Math.round(rawLoss * 2) / 2;
  const lossValueNgn = pricePerBag ? Math.round(rounded * pricePerBag) : undefined;
  if (rounded === 0.5) {
    return {
      lossBags: 0.5,
      lossValueNgn,
      en: "about half a bag every month",
      pcm: "about half bag every month",
      yo: "ní nǹkan bí ààbọ̀ àpò lórí oṣù kọ̀ọ̀kan",
    };
  }
  if (rounded === 1) {
    return {
      lossBags: 1,
      lossValueNgn,
      en: "about 1 bag every month",
      pcm: "about 1 bag every month",
      yo: "ní nǹkan bí àpò kan lórí oṣù kọ̀ọ̀kan",
    };
  }
  return {
    lossBags: rounded,
    lossValueNgn,
    en: `about ${rounded} bags every month`,
    pcm: `about ${rounded} bags every month`,
    yo: `ní nǹkan bí àpò ${rounded} lórí oṣù kọ̀ọ̀kan`,
  };
}

export function decide(
  options: OptionResult[],
  params: DecideParams,
): Decision {
  if (!options || options.length === 0) {
    throw new Error("Cannot decide without candidate options");
  }

  // 1. Determine lambda from risk aversion
  const aversion = params.riskAversion || "normal";
  const lambda = aversion === "low" ? 0.25 : aversion === "high" ? 1.0 : 0.5;

  // 2. Sort options by score descending (filtering out any dropped options)
  const activeOptions = options.filter((o) => !(o as any).dropped);
  if (activeOptions.length === 0) {
    throw new Error("All options were dropped due to constraints");
  }
  const sorted = [...activeOptions].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const second = sorted[1] ?? sorted[0];

  // 3. Evaluate close call and apply tie-break rule
  // DESIGN.md step 6: "If the top two are within 5% of each other, say it's a close call and recommend the safer one."
  const maxScore = Math.max(best.score, second.score, 1);
  const scoreGapPct = Math.abs(best.score - second.score) / maxScore;
  const isCloseCall = sorted.length > 1 && scoreGapPct <= 0.05;

  let chosenOpt = best;
  let runnerUpOpt = second;
  let closeCallNote: string | undefined;

  if (isCloseCall) {
    // If scores are within 5%, evaluate safety (lower risk metric)
    if (second.outcome.riskMetric < best.outcome.riskMetric) {
      chosenOpt = second;
      runnerUpOpt = best;
      closeCallNote = `Close call: ${best.option} and ${second.option} scores are within ${(scoreGapPct * 100).toFixed(1)}%. Recommending safer option (${second.option}) with lower risk (${(second.outcome.riskMetric * 100).toFixed(1)}% vs ${(best.outcome.riskMetric * 100).toFixed(1)}%).`;
    } else if (best.outcome.riskMetric < second.outcome.riskMetric) {
      chosenOpt = best;
      runnerUpOpt = second;
      closeCallNote = `Close call: ${best.option} and ${second.option} scores are within ${(scoreGapPct * 100).toFixed(1)}%. Recommending safer option (${best.option}) with lower risk (${(best.outcome.riskMetric * 100).toFixed(1)}% vs ${(second.outcome.riskMetric * 100).toFixed(1)}%).`;
    } else {
      // TIE-BREAK RULE: Both risk and score are virtually identical.
      if (params.intent === "sell_or_store") {
        const hasSellNow = best.option === "sell_now" || second.option === "sell_now";
        if (hasSellNow) {
          chosenOpt = best.option === "sell_now" ? best : second;
          runnerUpOpt = best.option === "sell_now" ? second : best;
          closeCallNote = `Close call: scores are within ${(scoreGapPct * 100).toFixed(1)}%. Choosing sell_now for immediate liquidity with zero storage weight loss.`;
        } else {
          chosenOpt = best;
          runnerUpOpt = second;
        }
      } else {
        const optA = best.option;
        const optB = second.option;
        const isWait7And14 =
          (optA === "wait_7" && optB === "wait_14") ||
          (optA === "wait_14" && optB === "wait_7");

        if (isWait7And14) {
          chosenOpt = optA === "wait_7" ? best : second;
          runnerUpOpt = optA === "wait_7" ? second : best;
          closeCallNote = `Close call: wait_7 and wait_14 have equal ${(chosenOpt.outcome.riskMetric * 100).toFixed(1)}% replant risk, so the earlier date is chosen to keep more of the season.`;
        } else {
          chosenOpt = best;
          runnerUpOpt = second;
        }
      }
    }
  }

  // 4. Assign confidence
  // DESIGN.md step 6: "high if the gap to second place is over 15% and n_analog_years >= 25; medium if over 5%; otherwise low."
  const n = chosenOpt.outcome.n;
  const gapToPlantNow = (() => {
    const plantNowOpt = sorted.find((o) => o.option === "plant_now");
    if (!plantNowOpt || plantNowOpt === chosenOpt) return scoreGapPct;
    return Math.abs(chosenOpt.score - plantNowOpt.score) / Math.max(chosenOpt.score, 1);
  })();

  let confidence: Decision["confidence"] = "low";
  if (params.intent === "sell_or_store") {
    const anyLowN = params.sellingOptions
      ?.filter((s) => s.option !== "sell_now")
      .some((s) => s.outcome.n < 5 || s.lowConfidence);
    if (anyLowN) {
      confidence = "low";
    } else if (scoreGapPct > 0.1) {
      confidence = "high";
    } else if (scoreGapPct > 0.03) {
      confidence = "medium";
    }
  } else {
    if (n >= 25 && (scoreGapPct > 0.15 || gapToPlantNow > 0.15)) {
      confidence = "high";
    } else if (scoreGapPct > 0.05 || gapToPlantNow > 0.05) {
      confidence = "medium";
    }
  }

  // 5. Risk badge
  // DESIGN.md step 6: "green (risk < 15%), amber (15 to 35%), red (> 35%)"
  const chosenRisk = chosenOpt.outcome.riskMetric;
  let riskBadge: Decision["riskBadge"] = "green";
  if (chosenRisk > 0.35) {
    riskBadge = "red";
  } else if (chosenRisk >= 0.15) {
    riskBadge = "amber";
  }

  // 6. Build Decision.keyNumbers
  // Matching planting simulation metadata if provided
  const matchingPlanting = params.plantingOptions?.find((p) => p.option === chosenOpt.option);
  const plantNowPlanting = params.plantingOptions?.find((p) => p.option === "plant_now");

  const keyNumbers: Record<string, number | string> = {
    asOf: params.asOf,
    chosenOption: chosenOpt.option,
    chosenLabel: chosenOpt.label,
    score: chosenOpt.score,
    expectedValueNgn: chosenOpt.outcome.p50 || chosenOpt.outcome.mean,
    nAnalogYears: n,
    lambda,
  };

  if (params.intent === "sell_or_store") {
    keyNumbers.riskMetric = chosenRisk;
    keyNumbers.riskPercent = `${(chosenRisk * 100).toFixed(1)}%`;
    keyNumbers.riskLabel = chosenOpt.outcome.riskLabel || "chance of earning less than selling now";
    keyNumbers.valueP10Ngn = chosenOpt.outcome.p10;
    keyNumbers.valueP50Ngn = chosenOpt.outcome.p50;
    keyNumbers.valueP90Ngn = chosenOpt.outcome.p90;

    const storeOptions = params.sellingOptions?.filter((s) => s.option !== "sell_now") || [];
    if (storeOptions.length > 0) {
      const waitRisk = Math.max(...storeOptions.map((s) => s.outcome.riskMetric));
      keyNumbers.waitingRiskPercent = `${(waitRisk * 100).toFixed(1)}%`;
    } else {
      keyNumbers.waitingRiskPercent = "100.0%";
    }

    const store4w = params.sellingOptions?.find((s) => s.option === "store_4w");
    const store8w = params.sellingOptions?.find((s) => s.option === "store_8w");
    const store12w = params.sellingOptions?.find((s) => s.option === "store_12w");
    const store24w = params.sellingOptions?.find((s) => s.option === "store_24w");

    if (store4w) keyNumbers.nStore4w = store4w.outcome.n;
    if (store8w) keyNumbers.nStore8w = store8w.outcome.n;
    if (store12w) keyNumbers.nStore12w = store12w.outcome.n;
    if (store24w) keyNumbers.nStore24w = store24w.outcome.n;

    // Reference storage option for count-based explanation (prefer store_4w)
    const refStorage = store4w || storeOptions[0];
    if (refStorage) {
      keyNumbers.cheaperCount = refStorage.outcome.cheaperPriceCount ?? 8;
      keyNumbers.nYears = refStorage.outcome.n ?? 9;
      keyNumbers.countEarnedLess = refStorage.outcome.countEarnedLess ?? 8;
    }

    if (params.currentPricePerBag) {
      keyNumbers.currentPricePerBag = params.currentPricePerBag;
    }
    if (params.bags) {
      keyNumbers.bags = params.bags;
      keyNumbers.valueSellNowNgn = params.bags * (params.currentPricePerBag ?? 0);
    }
    const matchingSelling = params.sellingOptions?.find((s) => s.option === chosenOpt.option);
    if (matchingSelling) {
      keyNumbers.horizonWeeks = matchingSelling.horizonWeeks;
      keyNumbers.horizonMonths = matchingSelling.horizonMonths;
      keyNumbers.monthlyLossPct = matchingSelling.assumptions.monthlyLossPct;
      if (matchingSelling.bagsSoldNow !== undefined) {
        keyNumbers.bagsSoldNow = matchingSelling.bagsSoldNow;
      }
      if (matchingSelling.bagsStored !== undefined) {
        keyNumbers.bagsStored = matchingSelling.bagsStored;
      }
      if (matchingSelling.cashGeneratedNow !== undefined) {
        keyNumbers.cashGeneratedNow = matchingSelling.cashGeneratedNow;
      }
    }
    const bagsCount = params.bags || 20;
    const lossPct = matchingSelling?.assumptions.monthlyLossPct ?? 2.5;
    const currentPrice = params.currentPricePerBag || 45000;
    const lossInfo = formatStorageLossBags(bagsCount, lossPct, currentPrice);
    keyNumbers.storageLossBags_en = lossInfo.en;
    keyNumbers.storageLossBags_pcm = lossInfo.pcm;
    keyNumbers.storageLossBags_yo = lossInfo.yo;
    keyNumbers.lossBags = lossInfo.lossBags;
    if (lossInfo.lossValueNgn) {
      keyNumbers.lossValueNgn = lossInfo.lossValueNgn;
    }
  } else {
    keyNumbers.replantRisk = `${(chosenRisk * 100).toFixed(1)}%`;
    keyNumbers.replantProbability = chosenRisk;
    if (matchingPlanting) {
      keyNumbers.plantingDate = matchingPlanting.plantingDate;
      keyNumbers.rainP10Mm = matchingPlanting.establishmentRainMm.p10;
      keyNumbers.rainP50Mm = matchingPlanting.establishmentRainMm.p50;
      keyNumbers.rainP90Mm = matchingPlanting.establishmentRainMm.p90;
      keyNumbers.adequacyP10 = `${(matchingPlanting.rainfallAdequacy.p10 * 100).toFixed(1)}%`;
      keyNumbers.adequacyP50 = `${(matchingPlanting.rainfallAdequacy.p50 * 100).toFixed(1)}%`;
      keyNumbers.adequacyP90 = `${(matchingPlanting.rainfallAdequacy.p90 * 100).toFixed(1)}%`;
    }
    if (plantNowPlanting) {
      keyNumbers.replantRiskNow = `${(plantNowPlanting.replantProbability * 100).toFixed(1)}%`;
      keyNumbers.replantProbabilityNow = plantNowPlanting.replantProbability;
      keyNumbers.replantRisk_plantNow = `${(plantNowPlanting.replantProbability * 100).toFixed(1)}%`;
      keyNumbers.replantIn100_plantNow = Math.round(plantNowPlanting.replantProbability * 100);
      keyNumbers.plantNow_rainP10Mm = plantNowPlanting.establishmentRainMm.p10;
      keyNumbers.plantNow_rainP50Mm = plantNowPlanting.establishmentRainMm.p50;
      keyNumbers.plantNow_rainP90Mm = plantNowPlanting.establishmentRainMm.p90;
      keyNumbers.plantNow_adequacyP10 = `${(plantNowPlanting.rainfallAdequacy.p10 * 100).toFixed(1)}%`;
      keyNumbers.plantNow_adequacyP50 = `${(plantNowPlanting.rainfallAdequacy.p50 * 100).toFixed(1)}%`;
      keyNumbers.plantNow_adequacyP90 = `${(plantNowPlanting.rainfallAdequacy.p90 * 100).toFixed(1)}%`;

      const plainPlantNow = formatPlainChance(plantNowPlanting.replantProbability);
      keyNumbers.plainChance_plantNow_en = plainPlantNow.en;
      keyNumbers.plainChance_plantNow_pcm = plainPlantNow.pcm;
      keyNumbers.plainChance_plantNow_yo = plainPlantNow.yo;
      if (plainPlantNow.n) keyNumbers.plantNow_n = plainPlantNow.n;
    }
    const wait7Opt = params.plantingOptions?.find((p) => p.option === "wait_7");
    const wait14Opt = params.plantingOptions?.find((p) => p.option === "wait_14");
    if (wait7Opt) {
      keyNumbers.replantRisk_wait7 = `${(wait7Opt.replantProbability * 100).toFixed(1)}%`;
      keyNumbers.replantIn100_wait7 = Math.round(wait7Opt.replantProbability * 100);

      const plainWait7 = formatPlainChance(wait7Opt.replantProbability);
      keyNumbers.plainChance_wait7_en = plainWait7.en;
      keyNumbers.plainChance_wait7_pcm = plainWait7.pcm;
      keyNumbers.plainChance_wait7_yo = plainWait7.yo;
    }
    if (wait14Opt) {
      keyNumbers.replantRisk_wait14 = `${(wait14Opt.replantProbability * 100).toFixed(1)}%`;
      keyNumbers.replantIn100_wait14 = Math.round(wait14Opt.replantProbability * 100);

      const plainWait14 = formatPlainChance(wait14Opt.replantProbability);
      keyNumbers.plainChance_wait14_en = plainWait14.en;
      keyNumbers.plainChance_wait14_pcm = plainWait14.pcm;
      keyNumbers.plainChance_wait14_yo = plainWait14.yo;
    }
    const plainChosen = formatPlainChance(chosenRisk);
    keyNumbers.plainChance_chosen_en = plainChosen.en;
    keyNumbers.plainChance_chosen_pcm = plainChosen.pcm;
    keyNumbers.plainChance_chosen_yo = plainChosen.yo;

    keyNumbers.replantIn100_chosen = Math.round(chosenRisk * 100);
    keyNumbers.in100 = 100;
    keyNumbers.seasonsCount = n;
  }

  // 7. Build Decision.evidence
  const evidence: EvidenceItem[] = [
    ...(params.evidenceItems || []),
  ];

  if (params.intent === "sell_or_store") {
    const storageLabel = params.storageMethod === "pics" ? "PICS hermetic bags" : "plain sacks";
    const lossPct = params.monthlyLossPct ?? (params.storageMethod === "pics" ? 0.3 : 2.5);
    const hasYellowFallback = params.sellingOptions?.some((s) => s.outcome.usedYellowFallback);
    const fallbackNote = hasYellowFallback
      ? " Yellow wholesale used for missing months."
      : "";

    evidence.push({
      id: "ev_price_seasonality",
      kind: "history",
      label: "WFP Ibadan wholesale white maize seasonal price pattern",
      source: "WFP VAM, via HDX (Ibadan, Oyo)",
      sql:
        params.querySql ||
        "SELECT state, market, commodity, unit, pricetype, ym, price_ngn_per_kg FROM oko_pg.prices WHERE LOWER(state) = 'oyo'",
      queryName: "priceSeasonality",
      statistic: `Seasonal pattern: WFP Ibadan wholesale white maize, 2010 to 2023 (14 years).${fallbackNote} Prices after January 2023 aren't in this data.`,
      value: 14,
      unit: "years",
    });

    if (params.currentPricePerBag) {
      evidence.push({
        id: "ev_stated_price",
        kind: "price",
        label: "Today's offered price",
        source: "Farmer statement",
        statistic: `Today's price: you told me ₦${params.currentPricePerBag.toLocaleString()} per bag.`,
        value: params.currentPricePerBag,
        unit: "NGN/bag",
      });
    }

    evidence.push({
      id: "ev_storage_loss",
      kind: "assumption",
      label: `Storage weight loss rate (${params.storageMethod || "sack"})`,
      source: "Assumption (data/storage_loss.csv)",
      statistic: `Assumed ${lossPct}% weight loss per month in ${storageLabel}`,
      value: lossPct,
      unit: "%/month",
    });
  } else {
    evidence.push(
      {
        id: "ev_rain_history",
        kind: "history",
        label: `Daily rainfall history (${params.farmId})`,
        source: params.provenance || (params.dataMode === "live" ? "Zetaris (local)" : "SnapshotGateway"),
        sql:
          params.querySql ||
          `SELECT date, rain_mm FROM oko_pg.rain_daily WHERE farm_id = '${params.farmId}' ORDER BY date ASC`,
        queryName: "rainDaily",
        statistic: `${n} analog years evaluated with 21-day pre-season similarity weighting`,
        value: n,
        unit: "analog_years",
      },
      {
        id: "ev_spike_guard",
        kind: "assumption",
        label: "Daily precipitation spike guard (MAX_DAILY_RAIN_MM)",
        source: "Climate Data Gateway",
        statistic: "Values > 200 mm/day nulled to prevent unphysical sensor spikes",
        value: 200,
        unit: "mm/day",
      },
      {
        id: "ev_sivakumar_threshold",
        kind: "assumption",
        label: "False-start seedling dry spell threshold",
        source: "Adapted from Sivakumar (1988) West Africa agroclimatology",
        statistic: "More than 7 dry days within the first 21 days after planting, adapted from Sivakumar (1988), whose onset criterion uses 30 days",
        value: 7,
        unit: "days",
      }
    );
  }

  // 8. Build Decision.assumptions
  const assumptions: string[] = [];
  if (params.intent === "sell_or_store") {
    const storageLabel = params.storageMethod === "pics" ? "PICS hermetic bags" : "plain sacks";
    const lossPct = params.monthlyLossPct ?? (params.storageMethod === "pics" ? 0.3 : 2.5);
    const hasYellowFallback = params.sellingOptions?.some((s) => s.outcome.usedYellowFallback);
    const fallbackNote = hasYellowFallback
      ? " Yellow wholesale used for missing months."
      : "";
    assumptions.push(
      `Assumed ${lossPct}% weight loss per month in ${storageLabel}`,
      "Storage cost assumed ₦0/month (stored on-farm)",
      `Seasonal pattern: WFP Ibadan wholesale white maize, 2010 to 2023 (14 years).${fallbackNote} Prices after January 2023 aren't in this data.`
    );
    if (params.currentPricePerBag) {
      assumptions.push(`Today's price: you told me ₦${params.currentPricePerBag.toLocaleString()} per bag.`);
    }
    if (params.sellingOptions?.some((s) => s.option === "store_24w")) {
      assumptions.push(
        "6-month storage (store_24w) estimates are in today's money, after allowing for general price rises (CMA-detrended)"
      );
    }
  } else {
    assumptions.push(
      "Base yield for smallholder maize: 2,000 kg/ha",
      "Seed cost: ₦25,000/ha; Replant labour: ₦20,000/ha",
      "Dry-spell rule: more than 7 dry days within the first 21 days after planting, adapted from Sivakumar (1988), whose onset criterion uses 30 days",
      "2.0 ha from farms_seed.csv; 2,000 kg/ha is an uncited illustrative yield; ₦350/kg is an illustrative price matching the Aug 2022 Ibadan row in oko_pg.prices, not a 2026 forecast. Used only to scale scores, never shown to the farmer.",
      "200 mm daily rainfall spike guard applied to satellite climate data"
    );
  }

  if (params.assumptions) {
    assumptions.push(...params.assumptions);
  }

  if (params.dataMode === "snapshot") {
    assumptions.push("Offline snapshot mode: verified cached Zetaris query results");
  }

  if (closeCallNote) {
    assumptions.push(closeCallNote);
  }

  const decisionId = `dec_${params.asOf}_${params.farmId}_${params.intent}_01`;
  const createdAt = `${params.asOf}T08:00:00+01:00`; // Africa/Lagos

  return {
    id: decisionId,
    farmId: params.farmId,
    intent: params.intent,
    createdAt,
    options: sorted,
    chosen: chosenOpt.option,
    runnerUp: runnerUpOpt.option,
    confidence,
    riskBadge,
    keyNumbers,
    evidence,
    assumptions,
    dataMode: params.dataMode,
  };
}
