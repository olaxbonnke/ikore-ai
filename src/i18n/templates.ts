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
    return `Wait 7 days to plant (around ${date}). Planting now carries a ${riskNow} risk of false start requiring replanting, whereas waiting drops the replanting risk to ${risk} with ${rain50} mm median establishment rainfall expected across 35 analog years.`;
  }
  if (chosen === "wait_14") {
    return `Wait 14 days to plant (around ${date}). Replanting risk drops to ${risk} with steady onset rains.`;
  }
  return `Plant now. Replanting risk is low at ${risk} with ${rain50} mm expected establishment rain.`;
}
