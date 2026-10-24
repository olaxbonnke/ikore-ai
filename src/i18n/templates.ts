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
  const rain50 = String(k.rainP50Mm || "159.2");
  const nYears = String(k.nAnalogYears || "35");

  if (lang === "yo") {
    if (chosen === "wait_7") {
      return `Dúró díẹ̀. Gbìn ní nǹkan bí ${formattedDate} (lẹ́yìn ọjọ́ méje). Tí o bá gbìn báyìí, ewu láti tún gbìn jẹ́ ${riskNow}. Tí o bá dúró, ewu dínkù sí ${risk} pẹ̀lú ${rain50} mm òjò láti ọdún ${nYears} sẹ́yìn (ewu rẹ̀ dọ́gba pẹ̀lú dídúró fún ọjọ́ mẹ́rìnlá, nítorí náà a yan ọjọ́ kùtùkùtù kí àsìkò má baà kọjá).`;
    }
    if (chosen === "wait_14") {
      return `Dúró díẹ̀. Gbìn ní nǹkan bí ${formattedDate} (lẹ́yìn ọjọ́ mẹ́rìnlá). Tí o bá gbìn báyìí, ewu láti tún gbìn jẹ́ ${riskNow}. Tí o bá dúró, ewu dínkù sí ${risk} pẹ̀lú ${rain50} mm òjò láti ọdún ${nYears} sẹ́yìn.`;
    }
    return `Gbìn àgbàdo rẹ báyìí ní nǹkan bí ${formattedDate}. Ewu láti tún gbìn kéré gan-an (${risk}) pẹ̀lú ${rain50} mm òjò tí a retí láti ọdún ${nYears} sẹ́yìn.`;
  }

  if (lang === "pcm") {
    if (chosen === "wait_7") {
      return `Wait small. Plant around ${formattedDate} (after 7 days). If you plant now, danger to replant na ${riskNow}. If you wait, e go drop well well to ${risk} with ${rain50} mm rain across ${nYears} analog years (danger same as waiting 14 days, so we pick earlier date to keep the season).`;
    }
    if (chosen === "wait_14") {
      return `Wait small. Plant around ${formattedDate} (after 14 days). If you plant now, danger to replant na ${riskNow}. If you wait, e go drop to ${risk} with ${rain50} mm rain across ${nYears} analog years.`;
    }
    return `Plant now around ${formattedDate}. Danger to replant low well well at ${risk}, with ${rain50} mm good rain across ${nYears} analog years.`;
  }

  if (lang === "ha") {
    if (chosen === "wait_7") {
      return `Jira kwanaki 7 kafin ka shuka (kusan ${formattedDate}). Shuka yanzu yana da haɗarin ${riskNow}, amma idan ka jira haɗarin zai ragu zuwa ${risk}.`;
    }
    if (chosen === "wait_14") {
      return `Jira kwanaki 14 har zuwa ${formattedDate}. Haɗari zai ragu zuwa ${risk}.`;
    }
    return `Shuka yanzu. Haɗarin sake shuka yana da ƙanƙanta (${risk}).`;
  }

  // Default English
  if (chosen === "wait_7") {
    return `Wait 7 days to plant (around ${formattedDate}). Planting now carries a ${riskNow} risk of false start requiring replanting, whereas waiting drops the replanting risk to ${risk} with ${rain50} mm median establishment rainfall expected across ${nYears} analog years (equal replant risk to waiting 14 days, so the earlier date is chosen to keep more of the season).`;
  }
  if (chosen === "wait_14") {
    return `Wait 14 days to plant (around ${formattedDate}). Replanting risk drops to ${risk} with ${rain50} mm median establishment rainfall expected across ${nYears} analog years.`;
  }
  return `Plant now. Replanting risk is low at ${risk} with ${rain50} mm expected establishment rain across ${nYears} analog years.`;
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
      return `Tà á báyìí fún ₦${totalNow} (àpò ${bags} ní ₦${price.toLocaleString()} fún àpò kọ̀ọ̀kan). Ní ${cheaper} nínú ọdún ${n} sẹ́yìn tí a ní àkọsílẹ̀ rẹ̀, àgbàdo lórí ìtasílẹ̀ ní Ìbàdàn dín owó kù lẹ́yìn oṣù kẹjọ. Pẹ̀lú àdánù ìwọ̀n ọjà (a fi sí ${lossPct}% lórí oṣù kọ̀ọ̀kan nínú ${storageLabelYo}), tí o bá tọ́jú rẹ̀ ewu wà pé owó tí wàá rí yóò dínkù sí ti òní.`;
    }
    if (lang === "pcm") {
      return `Sell now for ₦${totalNow} (${bags} bags at ₦${price.toLocaleString()} per bag). In ${cheaper} inside ${n} past years wey get data, Ibadan wholesale corn cheaper a month after August than in August. With storage weight loss (we assume ${lossPct}% every month inside ${storageLabelPcm}), if you keep am, danger dey say you go make less money pass today.`;
    }
    // Default English
    return `Sell now for ₦${totalNow} (${bags} bags at ₦${price.toLocaleString()} per bag). In ${cheaper} of the ${n} past years with data, Ibadan wholesale maize was cheaper a month after August than in August. After accounting for storage weight loss (assumed ${lossPct}% per month in ${storageLabelEn}), waiting carries high risk of earning less than selling today.`;
  }

  if (chosen === "partial_sell_store_8w") {
    const soldNow = Number(k.bagsSoldNow !== undefined ? k.bagsSoldNow : Math.ceil(bags / 2));
    const stored = Number(k.bagsStored !== undefined ? k.bagsStored : bags - soldNow);
    const cashNow = Number(k.cashGeneratedNow || soldNow * price).toLocaleString();

    if (lang === "yo") {
      return `Tà àpò ${soldNow} báyìí fún ₦${cashNow} láti bójútó àwọn ohun tí o fẹ́ náwó sí ní kíákíá, kí o sì tọ́jú àpò ${stored} tó kù fún ọ̀sẹ̀ 8.`;
    }
    if (lang === "pcm") {
      return `Sell ${soldNow} bags now make you get ₦${cashNow} take solve your urgent need, den keep the remaining ${stored} bags for 8 weeks.`;
    }
    return `Sell ${soldNow} bags now for ₦${cashNow} to cover your immediate cash need, and store the remaining ${stored} bags for 8 weeks.`;
  }

  // Storage options: store_4w, store_8w, store_12w, store_24w
  const weeks = Number(k.horizonWeeks || (chosen === "store_4w" ? 4 : chosen === "store_8w" ? 8 : chosen === "store_12w" ? 12 : 24));
  const p50 = Number(k.valueP50Ngn || k.expectedValueNgn || 0).toLocaleString();
  const p10 = Number(k.valueP10Ngn || 0).toLocaleString();
  const p90 = Number(k.valueP90Ngn || 0).toLocaleString();
  const n = Number(k.nYears || 10);
  const cheaper = Number(k.cheaperCount ?? 0);
  const higher = Math.max(0, n - cheaper);

  const inflationClauseEn = chosen === "store_24w" ? " in today's money, after allowing for general price rises" : "";
  const inflationClausePcm = chosen === "store_24w" ? " for today money, after we remove general price increase" : "";
  const inflationClauseYo = chosen === "store_24w" ? " ní iye owó òní, lẹ́yìn tí a yọ àfikún owó gbogbogbò kúrò" : "";

  if (lang === "yo") {
    return `Tọ́jú àgbàdo rẹ fún ọ̀sẹ̀ ${weeks}. Ní ${higher} nínú ọdún ${n} sẹ́yìn tí a ní àkọsílẹ̀ rẹ̀, iye owó àgbàdo ga tó láti bo àdánù ìtọ́jú (a fi sí ${lossPct}% lórí oṣù kọ̀ọ̀kan nínú ${storageLabelYo}), pẹ̀lú èrè tí a retí ní nǹkan bí ₦${p50} láti àwọn ọdún sẹ́yìn${inflationClauseYo} (láàárín ₦${p10} àti ₦${p90}).`;
  }
  if (lang === "pcm") {
    return `Keep your corn for ${weeks} weeks. For ${higher} inside ${n} past years wey get data, market price jump reach to cover storage loss (we assume ${lossPct}% every month inside ${storageLabelPcm}), with expected return around ₦${p50} across past years${inflationClausePcm} (between ₦${p10} and ₦${p90}).`;
  }
  return `Store your maize for ${weeks} weeks. In ${higher} of the ${n} past years with data, wholesale prices rose enough to cover storage weight loss (assumed ${lossPct}% per month in ${storageLabelEn}), with expected return around ₦${p50} across past years${inflationClauseEn} (typically between ₦${p10} and ₦${p90}).`;
}
