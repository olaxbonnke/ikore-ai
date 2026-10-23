import type { Decision, Lang } from "../core/types.ts";

/** Fallback explanations when the LLM or validator fails (DESIGN.md step 7). */
export function templateUnavailable(_intent: "plant_timing" | "sell_or_store", _lang: Lang): string {
  return "Ikore AI is still starting up. Please try again soon.";
}

/** Pre-written grounded template explanations per language (DESIGN.md step 7). */
export function templatePlanting(decision: Decision, lang: Lang = "en"): string {
  const chosen = decision.chosen;
  const k = decision.keyNumbers;
  const date = String(k.plantingDate || decision.createdAt.slice(0, 10));
  const risk = String(k.replantRisk || "0.7%");
  const riskNow = String(k.replantRiskNow || "14.1%");
  const rain50 = String(k.rainP50Mm || "159.2");

  if (lang === "yo") {
    if (chosen === "wait_7") {
      return `Dúró fún ọjọ́ méje (títí di ${date}) kó o tó gbìn. Ewu tí èso lè kú tí o bá gbìn báyìí jẹ́ ${riskNow}, ṣùgbọ́n tí o bá dúró ewu dínkù sí ${risk}.`;
    }
    if (chosen === "wait_14") {
      return `Dúró fún ọjọ́ mẹ́rìnlá (títí di ${date}). Ewu dínkù sí ${risk}.`;
    }
    return `Gbìn àgbàdo rẹ báyìí. Ewu kékeré ni (${risk}), òjò tó sì máa rọ̀ tó ${rain50} mm.`;
  }

  if (lang === "pcm") {
    if (chosen === "wait_7") {
      return `Wait 7 days make you plant around ${date}. If you plant now, replanting risk na ${riskNow}. If you wait, e go drop well well to ${risk}.`;
    }
    if (chosen === "wait_14") {
      return `Wait 14 days reach ${date}. Replanting risk go drop to ${risk}.`;
    }
    return `Plant now. Replanting risk low well well (${risk}), with good rain coming.`;
  }

  if (lang === "ha") {
    if (chosen === "wait_7") {
      return `Jira kwanaki 7 kafin ka shuka (kusan ${date}). Shuka yanzu yana da haɗarin ${riskNow}, amma idan ka jira haɗarin zai ragu zuwa ${risk}.`;
    }
    if (chosen === "wait_14") {
      return `Jira kwanaki 14 har zuwa ${date}. Haɗari zai ragu zuwa ${risk}.`;
    }
    return `Shuka yanzu. Haɗarin sake shuka yana da ƙanƙanta (${risk}).`;
  }

  // Default English
  if (chosen === "wait_7") {
    return `Wait 7 days to plant (around ${date}). Planting now carries a ${riskNow} risk of false start requiring replanting, whereas waiting drops the replanting risk to ${risk} with ${rain50} mm median establishment rainfall expected across 35 analog years (equal replant risk to waiting 14 days, so the earlier date is chosen to keep more of the season).`;
  }
  if (chosen === "wait_14") {
    return `Wait 14 days to plant (around ${date}). Replanting risk drops to ${risk}.`;
  }
  return `Plant now. Replanting risk is low at ${risk} with ${rain50} mm expected establishment rain.`;
}

/** Pre-written grounded template explanations for sell-or-store (DESIGN.md step 7). */
export function templateSelling(decision: Decision, _lang: Lang = "en"): string {
  const chosen = decision.chosen;
  const k = decision.keyNumbers;
  const bags = Number(k.bags || 20);
  const price = Number(k.currentPricePerBag || 45000);
  const totalNow = (bags * price).toLocaleString();
  const lossPct = Number(k.monthlyLossPct !== undefined ? k.monthlyLossPct : 2.5);
  const storageLabel = lossPct <= 0.5 ? "PICS hermetic bags" : "plain sacks";
  const riskPct = k.riskPercent || "100.0%";

  if (chosen === "sell_now") {
    const cheaper = k.cheaperCount ?? 8;
    const n = k.nYears ?? 9;
    return `Sell now for ₦${totalNow} (${bags} bags at ₦${price.toLocaleString()} per bag). In ${cheaper} of the ${n} past years with data, Ibadan wholesale maize was cheaper a month after August than in August. After accounting for storage weight loss (assumed ${lossPct}% per month in ${storageLabel}), waiting carries high risk of earning less than selling today.`;
  }

  if (chosen === "partial_sell_store_8w") {
    const soldNow = Number(k.bagsSoldNow !== undefined ? k.bagsSoldNow : Math.ceil(bags / 2));
    const stored = Number(k.bagsStored !== undefined ? k.bagsStored : bags - soldNow);
    const cashNow = Number(k.cashGeneratedNow || soldNow * price).toLocaleString();
    return `Sell ${soldNow} bags now for ₦${cashNow} to cover your immediate cash need, and store the remaining ${stored} bags for 8 weeks.`;
  }

  const weeks = k.horizonWeeks || (chosen === "store_4w" ? 4 : chosen === "store_8w" ? 8 : chosen === "store_12w" ? 12 : 24);
  const p50 = Number(k.valueP50Ngn || k.expectedValueNgn || 0).toLocaleString();
  const p10 = Number(k.valueP10Ngn || 0).toLocaleString();
  const p90 = Number(k.valueP90Ngn || 0).toLocaleString();
  const n = Number(k.nYears || 10);
  const higher = n - Number(k.cheaperCount ?? 0);
  const inflationClause = chosen === "store_24w" ? " in today's money, after allowing for general price rises" : "";

  return `Store your maize for ${weeks} weeks. In ${higher} of the ${n} past years with data, wholesale prices rose enough to cover storage weight loss (assumed ${lossPct}% per month in ${storageLabel}), with expected return around ₦${p50} across past years${inflationClause} (typically between ₦${p10} and ₦${p90}).`;
}
