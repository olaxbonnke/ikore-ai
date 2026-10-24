import type { Decision, Lang } from "../core/types.ts";
import { formatGroundedDate, GLOSSARY } from "./glossary.ts";

/** Fallback message when service or intent is temporarily unavailable. */
export function templateUnavailable(_intent: "plant_timing" | "sell_or_store", lang: Lang = "en"): string {
  if (lang === "yo") {
    return "Ikore AI ń bẹ̀rẹ̀ lọ́wọ́lọ́wọ́. Ẹ jọ̀wọ́ ẹ tún gbìyànjú lẹ́yìn díẹ̀.";
  }
  if (lang === "pcm") {
    return "Ikore AI still dey start up. Abeg try again small time.";
  }
  if (lang === "ha") {
    return "Ikore AI yana farawa. Da fatan za a sake gwadawa nan ba da jimawa ba.";
  }
  return "Ikore AI is still starting up. Please try again soon.";
}

/** Pre-written grounded template explanations for planting decisions (DESIGN.md step 7). */
export function templatePlanting(decision: Decision, lang: Lang = "en"): string {
  const chosen = decision.chosen;
  const k = decision.keyNumbers;
  const rawDate = String(k.plantingDate || decision.createdAt.slice(0, 10));
  const formattedDate = formatGroundedDate(rawDate, lang);
  const risk = String(k.replantRisk || "0.7%");
  const riskNow = String(k.replantRiskNow || "14.1%");
  const nYears = String(k.seasonsCount || k.nAnalogYears || "35");

  if (lang === "yo") {
    if (chosen === "wait_7") {
      return `Dúró díẹ̀ kí o gbìn ní nǹkan bí ${formattedDate}.\n\nTí o bá gbìn báyìí, ewu láti tún gbìn jẹ́ ${riskNow}. Tí o bá dúró, ewu dínkù sí ${risk} pẹ̀lú òjò tó tó láti ọdún ${nYears} sẹ́yìn.`;
    }
    if (chosen === "wait_14") {
      return `Dúró díẹ̀ kí o gbìn ní nǹkan bí ${formattedDate}.\n\nTí o bá gbìn báyìí, ewu láti tún gbìn jẹ́ ${riskNow}. Tí o bá dúró, ewu dínkù sí ${risk} pẹ̀lú òjò tó tó láti ọdún ${nYears} sẹ́yìn.`;
    }
    return `Gbìn àgbàdo rẹ báyìí ní nǹkan bí ${formattedDate}.\n\nEwu láti tún gbìn kéré gan-an ní ${risk} pẹ̀lú òjò tó tó láti ọdún ${nYears} sẹ́yìn.`;
  }

  if (lang === "pcm") {
    if (chosen === "wait_7") {
      return `Wait small to plant around ${formattedDate}.\n\nIf you plant now, danger to replant na ${riskNow}. If you wait, e go drop well well to ${risk} with enough rain across ${nYears} past seasons.`;
    }
    if (chosen === "wait_14") {
      return `Wait small to plant around ${formattedDate}.\n\nIf you plant now, danger to replant na ${riskNow}. If you wait, e go drop to ${risk} with enough rain across ${nYears} past seasons.`;
    }
    return `Plant now around ${formattedDate}.\n\nDanger to replant low well well at ${risk} with enough rain across ${nYears} past seasons.`;
  }

  if (lang === "ha") {
    if (chosen === "wait_7") {
      return `Jira kwanaki 7 kafin ka shuka (kusan ${formattedDate}).\n\nShuka yanzu yana da haɗarin ${riskNow}, amma idan ka jira haɗarin zai ragu zuwa ${risk}.`;
    }
    if (chosen === "wait_14") {
      return `Jira kwanaki 14 har zuwa ${formattedDate}.\n\nHaɗari zai ragu zuwa ${risk}.`;
    }
    return `Shuka yanzu a kusan ${formattedDate}.\n\nHaɗarin sake shuka yana da ƙanƙanta (${risk}).`;
  }

  // Default English
  if (chosen === "wait_7") {
    return `Wait 7 days to plant around ${formattedDate}.\n\nIf you plant now, danger to replant is ${riskNow}. Waiting drops danger to ${risk} with enough rain across ${nYears} past seasons.`;
  }
  if (chosen === "wait_14") {
    return `Wait 14 days to plant around ${formattedDate}.\n\nIf you plant now, danger to replant is ${riskNow}. Waiting drops danger to ${risk} with enough rain across ${nYears} past seasons.`;
  }
  return `Plant now around ${formattedDate}.\n\nDanger to replant is low at ${risk} with enough rain across ${nYears} past seasons.`;
}

/** Pre-written grounded template explanations for sell-or-store decisions (DESIGN.md step 7). */
export function templateSelling(decision: Decision, lang: Lang = "en"): string {
  const chosen = decision.chosen;
  const k = decision.keyNumbers;
  const bags = Number(k.bags || 20);
  const price = Number(k.currentPricePerBag || 45000);
  const totalNow = (bags * price).toLocaleString();
  const lossPct = Number(k.monthlyLossPct !== undefined ? k.monthlyLossPct : 2.5);

  const isPics = lossPct <= 0.5;
  const storageLabelEn = isPics ? "PICS hermetic bags" : "plain sacks";
  const storageLabelPcm = isPics ? "PICS triple bags" : "normal plain sacks";
  const storageLabelYo = isPics ? "àpò hermetic PICS" : "àpò lásán";

  if (chosen === "sell_now") {
    const cheaper = Number(k.cheaperCount ?? 8);
    const n = Number(k.nYears ?? 9);

    if (lang === "yo") {
      return `Tà á báyìí fún ₦${totalNow} (àpò ${bags} ní ₦${price.toLocaleString()} fún àpò kọ̀ọ̀kan).\n\nNí ${cheaper} nínú ọdún ${n} sẹ́yìn tí a ní àkọsílẹ̀ rẹ̀, àgbàdo lórí ìtasílẹ̀ ní Ìbàdàn dín owó kù lẹ́yìn oṣù kẹjọ. Pẹ̀lú àdánù ìwọ̀n ${lossPct}% lórí oṣù kọ̀ọ̀kan nínú ${storageLabelYo}, tí o bá tọ́jú rẹ̀ ewu wà pé owó tí wàá rí yóò dínkù.`;
    }
    if (lang === "pcm") {
      return `Sell now for ₦${totalNow} (${bags} bags at ₦${price.toLocaleString()} per bag).\n\nFor ${cheaper} out of ${n} past years wey get data, Ibadan wholesale corn cheaper a month after August than in August. With ${storageLabelPcm} losing ${lossPct}% every month, danger dey say you go make less money pass today.`;
    }
    // Default English
    return `Sell now for ₦${totalNow} (${bags} bags at ₦${price.toLocaleString()} per bag).\n\nFor ${cheaper} out of ${n} past years with data, Ibadan wholesale maize was cheaper a month after August than in August. With ${storageLabelEn} losing ${lossPct}% weight monthly, waiting carries high risk of earning less than selling today.`;
  }

  if (chosen === "partial_sell_store_8w") {
    const soldNow = Number(k.bagsSoldNow !== undefined ? k.bagsSoldNow : Math.ceil(bags / 2));
    const stored = Number(k.bagsStored !== undefined ? k.bagsStored : bags - soldNow);
    const cashNow = Number(k.cashGeneratedNow || soldNow * price).toLocaleString();

    if (lang === "yo") {
      return `Tà àpò ${soldNow} báyìí fún ₦${cashNow} kíákíá.\n\nTọ́jú àpò ${stored} tó kù fún ọ̀sẹ̀ 8 fún èrè tó dára níwájú.`;
    }
    if (lang === "pcm") {
      return `Sell ${soldNow} bags now make you get ₦${cashNow}.\n\nKeep the remaining ${stored} bags for 8 weeks make e gain value.`;
    }
    return `Sell ${soldNow} bags now for ₦${cashNow}.\n\nStore the remaining ${stored} bags for 8 weeks to capture higher market prices.`;
  }

  // Storage options: store_4w, store_8w, store_12w, store_24w
  const weeks = Number(k.horizonWeeks || (chosen === "store_4w" ? 4 : chosen === "store_8w" ? 8 : chosen === "store_12w" ? 12 : 24));
  const p50 = Number(k.valueP50Ngn || k.expectedValueNgn || 0).toLocaleString();
  const n = Number(k.nYears || 10);
  const cheaper = Number(k.cheaperCount ?? 0);
  const higher = Math.max(0, n - cheaper);

  const inflationClauseEn = chosen === "store_24w" ? " in today's money, after allowing for general price rises" : "";
  const inflationClausePcm = chosen === "store_24w" ? " for today money, after we remove general price increase" : "";
  const inflationClauseYo = chosen === "store_24w" ? " ní iye owó òní, lẹ́yìn tí a yọ àfikún owó gbogbogbò kúrò" : "";

  if (lang === "yo") {
    return `Tọ́jú àgbàdo rẹ fún ọ̀sẹ̀ ${weeks}.\n\nNí ${higher} nínú ọdún ${n} sẹ́yìn, iye owó àgbàdo ga tó láti bo àdánù ìtọ́jú (a fi sí ${lossPct}% lórí oṣù kọ̀ọ̀kan nínú ${storageLabelYo}), pẹ̀lú èrè tí a retí ní ₦${p50}${inflationClauseYo}.`;
  }
  if (lang === "pcm") {
    return `Keep your corn for ${weeks} weeks.\n\nFor ${higher} out of ${n} past years wey get data, price jump reach to cover storage loss (we assume ${lossPct}% every month inside ${storageLabelPcm}), with expected return around ₦${p50}${inflationClausePcm}.`;
  }
  return `Store your maize for ${weeks} weeks.\n\nFor ${higher} out of ${n} past years with data, prices rose enough to cover storage weight loss (assumed ${lossPct}% per month in ${storageLabelEn}), with expected return around ₦${p50}${inflationClauseEn}.`;
}
