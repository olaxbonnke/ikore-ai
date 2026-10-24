import type { Decision, Lang } from "../core/types.ts";
import { formatGroundedDate } from "./glossary.ts";

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

/** Pre-written grounded template explanations for planting decisions (DESIGN.md step 7 & Day 4.2 Polish). */
export function templatePlanting(decision: Decision, lang: Lang = "en"): string {
  const chosen = decision.chosen;
  const k = decision.keyNumbers;
  const rawDate = String(k.plantingDate || decision.createdAt.slice(0, 10));
  const formattedDate = formatGroundedDate(rawDate, lang);
  const nYears = String(k.seasonsCount || k.nAnalogYears || "35");

  if (lang === "yo") {
    if (chosen === "wait_7" || chosen === "wait_14") {
      return `Dúró díẹ̀ kí o gbìn ní nǹkan bí ${formattedDate}.\n\nTí o bá gbìn báyìí, ewu láti tún gbìn jẹ́ ẹ̀ẹ̀kan nínú àsìkò méje. Tí o bá dúró, fẹ́rẹ́ kò ṣẹlẹ̀ rárá nínú àsìkò ${nYears} sẹ́yìn.`;
    }
    return `Gbìn àgbàdo rẹ báyìí ní nǹkan bí ${formattedDate}.\n\nEwu láti tún gbìn fẹ́rẹ́ kò ṣẹlẹ̀ rárá pẹ̀lú òjò tó tó nínú àsìkò ${nYears} sẹ́yìn.`;
  }

  if (lang === "pcm") {
    if (chosen === "wait_7" || chosen === "wait_14") {
      return `Wait small. Plant around ${formattedDate}.\n\nIf you plant now, about 1 for every 7 seasons, people don plant am again. If you wait one week, e no dey almost happen.`;
    }
    return `Plant now around ${formattedDate}.\n\nGood rain dey ground across ${nYears} past seasons, e no dey almost need planting again.`;
  }

  if (lang === "ha") {
    if (chosen === "wait_7" || chosen === "wait_14") {
      return `Jira mako guda kafin ka shuka (kusan ${formattedDate}).\n\nIdan ka shuka yanzu, akwai haɗarin sake shuka. Idan ka jira mako guda, kusan ba ya taɓa faruwa ba.`;
    }
    return `Shuka yanzu a kusan ${formattedDate}.\n\nHaɗarin sake shuka kusan ba ya taɓa faruwa ba.`;
  }

  // Default English (no 'danger', uses chance / needed replanting)
  if (chosen === "wait_7" || chosen === "wait_14") {
    return `Wait a week. Plant around ${formattedDate}.\n\nIf you plant now, about 1 in 7 seasons needed replanting. If you wait a week, it almost never happened in ${nYears} past seasons.`;
  }
  return `Plant now around ${formattedDate}.\n\nReplanting almost never happened with enough rain across ${nYears} past seasons.`;
}

/** Pre-written grounded template explanations for sell-or-store decisions (DESIGN.md step 7 & Day 4.2 Polish). */
export function templateSelling(decision: Decision, lang: Lang = "en"): string {
  const chosen = decision.chosen;
  const k = decision.keyNumbers;
  const bags = Number(k.bags || 20);
  const price = Number(k.currentPricePerBag || 45000);
  const totalNow = (bags * price).toLocaleString();

  const isPics = (Number(k.monthlyLossPct) || 2.5) <= 0.5;
  const storageLabelEn = isPics ? "PICS hermetic bags" : "plain sacks";
  const storageLabelPcm = isPics ? "PICS triple bags" : "ordinary sack";
  const storageLabelYo = isPics ? "àpò hermetic PICS" : "àpò lásán";

  const lossTextEn = String(k.storageLossBags_en || "about half a bag every month");
  const lossTextPcm = String(k.storageLossBags_pcm || "about half bag every month");
  const lossTextYo = String(k.storageLossBags_yo || "ní nǹkan bí ààbọ̀ àpò lórí oṣù kọ̀ọ̀kan");

  if (chosen === "sell_now") {
    const cheaper = Number(k.cheaperCount ?? 8);
    const n = Number(k.nYears ?? 9);

    if (lang === "yo") {
      return `Tà á báyìí fún ₦${totalNow} (àpò ${bags} ní ₦${price.toLocaleString()} fún àpò kọ̀ọ̀kan).\n\nNí ${cheaper} nínú ọdún ${n} sẹ́yìn, àgbàdo ní ọjà Ìbàdàn dín owó kù lẹ́yìn oṣù kẹjọ. Àwọn àpò ${bags} rẹ yóò tún pàdánù ${lossTextYo} nínú ${storageLabelYo}.`;
    }
    if (lang === "pcm") {
      return `Sell now, you go get ₦${totalNow}.\n\nFor ${cheaper} out of ${n} past years, corn price for Ibadan market fall after August. Your ${bags} bags go still lose ${lossTextPcm} inside ${storageLabelPcm}.`;
    }
    // Default English
    return `Sell now for ₦${totalNow}.\n\nIn ${cheaper} out of ${n} past years, Ibadan maize was cheaper a month later. Your ${bags} bags would also lose ${lossTextEn} in ${storageLabelEn}.`;
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
    return `Tọ́jú àgbàdo rẹ fún ọ̀sẹ̀ ${weeks}.\n\nNí ${higher} nínú ọdún ${n} sẹ́yìn, iye owó àgbàdo ga tó láti bo àdánù ìtọ́jú, pẹ̀lú èrè tí a retí ní ₦${p50}${inflationClauseYo}.`;
  }
  if (lang === "pcm") {
    return `Keep your corn for ${weeks} weeks.\n\nFor ${higher} out of ${n} past years wey get data, price jump reach to cover storage loss, with expected return around ₦${p50}${inflationClausePcm}.`;
  }
  return `Store your maize for ${weeks} weeks.\n\nFor ${higher} out of ${n} past years with data, prices rose enough to cover storage weight loss, with expected return around ₦${p50}${inflationClauseEn}.`;
}

/** Fallback reply when no previous advice has been recorded for a farm. */
export function templateNoPreviousAdvice(lang: Lang = "en"): string {
  if (lang === "yo") {
    return "N kò tíì fún ọ ní ìmọ̀ràn kankan tẹ́lẹ̀ fún oko yìí.";
  }
  if (lang === "pcm") {
    return "I never give you any advice before for this farm.";
  }
  if (lang === "ha") {
    return "Ban ba da wata shawara a baya ba ga wannan gona.";
  }
  return "I do not have any previous advice recorded yet for this farm.";
}

function localizeRiskText(risk: string, lang: Lang): string {
  const r = risk.trim().toLowerCase();
  const num = parseFloat(r.replace("%", ""));

  const isLow = r.includes("almost never") || r.includes("never") || (Number.isFinite(num) && num < 2);
  const isOneInSeven = r.includes("1 in 7") || (Number.isFinite(num) && num >= 10 && num <= 20);

  if (lang === "yo") {
    if (isOneInSeven) return "ẹ̀ẹ̀kan nínú àsìkò méje";
    return "fẹ́rẹ́ kò ṣẹlẹ̀ rárá";
  }
  if (lang === "pcm") {
    if (isOneInSeven) return "about 1 for every 7 seasons";
    return "almost never happen";
  }
  if (isOneInSeven) return "about 1 in 7 seasons";
  if (isLow) return "almost never";
  return r.replace("%", "").trim();
}

/** Pre-written grounded reminder quoting previous stored advice (DESIGN.md Step 7 & Day 4.2 Polish). */
export function templateRecallAdvice(content: string, lang: Lang = "en"): string {
  // Extract date if present (e.g. "Planting advice for 2026-04-10" or "for 2026-04-10")
  const dateMatch = content.match(/advice for (\d{4}-\d{2}-\d{2})/i) || content.match(/(\d{4}-\d{2}-\d{2})/);
  const rawDate = dateMatch ? dateMatch[1] : "";
  const formattedDate = rawDate ? formatGroundedDate(rawDate, lang) : "earlier";

  const isPlanting = /planting/i.test(content) || /plant/i.test(content);
  const isSelling = /sell or store/i.test(content) || /sell/i.test(content) || /store/i.test(content);

  if (isPlanting) {
    const verdictMatch = content.match(/Planting advice for [^:]+:\s*([a-z0-9_]+)/i);
    const verdict = verdictMatch ? verdictMatch[1] : (content.includes("wait_7") ? "wait_7" : content.includes("wait_14") ? "wait_14" : "plant_now");
    const plantDateMatch = content.match(/Planting date (\d{4}-\d{2}-\d{2})/i);
    const plantDate = plantDateMatch ? formatGroundedDate(plantDateMatch[1], lang) : formattedDate;

    const riskMatch = content.match(/Replant risk ([^,.]+)/i);
    const risk = riskMatch ? localizeRiskText(riskMatch[1], lang) : "";

    if (lang === "yo") {
      if (verdict === "wait_7" || verdict === "wait_14") {
        const weeksText = verdict === "wait_14" ? "ọ̀sẹ̀ méjì" : "ọ̀sẹ̀ kan";
        return `Ní ${formattedDate} mo sọ fún ọ pé kí o dúró fún ${weeksText} kí o sì gbìn ní nǹkan bí ${plantDate}.${risk ? ` Ewu àtún-gbìn sì jẹ́ ${risk}.` : ""}`;
      }
      return `Ní ${formattedDate} mo sọ fún ọ pé kí o gbìn báyìí (kí ó tó di ${plantDate}).${risk ? ` Ewu àtún-gbìn sì fẹ́rẹ́ kò ṣẹlẹ̀ rárá.` : ""}`;
    }

    if (lang === "pcm") {
      if (verdict === "wait_7" || verdict === "wait_14") {
        const weeksText = verdict === "wait_14" ? "two weeks" : "a week";
        return `For ${formattedDate} I tell you say make you wait ${weeksText} and plant around ${plantDate}.${risk ? ` Replant risk na ${risk}.` : ""}`;
      }
      return `For ${formattedDate} I tell you say make you plant now (around ${plantDate}).${risk ? ` Replant risk almost never happen.` : ""}`;
    }

    // Default English
    if (verdict === "wait_7" || verdict === "wait_14") {
      const weeksText = verdict === "wait_14" ? "two weeks" : "a week";
      return `On ${formattedDate} I told you to wait ${weeksText} and plant around ${plantDate}.${risk ? ` Replant risk is ${risk}.` : ""}`;
    }
    return `On ${formattedDate} I told you to plant now (by ${plantDate}).${risk ? ` Replant risk is ${risk}.` : ""}`;
  }

  if (isSelling) {
    const verdictMatch = content.match(/Sell or store advice for [^:]+:\s*([a-z0-9_]+)/i);
    const verdict = verdictMatch ? verdictMatch[1] : (content.includes("sell_now") ? "sell_now" : "store");
    const offeredMatch = content.match(/Offered\s*(₦[\d,]+(?:\/bag)?)/i);
    const offered = offeredMatch ? offeredMatch[1] : "";

    if (lang === "yo") {
      if (verdict === "sell_now") {
        return `Ní ${formattedDate} mo sọ fún ọ pé kí o tà báyìí${offered ? ` ní ${offered}` : ""}.`;
      }
      return `Ní ${formattedDate} mo sọ fún ọ pé kí o tọ́jú àgbàdo rẹ kí o sì dúró de ìgbà tí owó yóò ga.`;
    }

    if (lang === "pcm") {
      if (verdict === "sell_now") {
        return `For ${formattedDate} I tell you say make you sell now${offered ? ` for ${offered}` : ""}.`;
      }
      return `For ${formattedDate} I tell you say make you keep your corn for store make price go up.`;
    }

    // Default English
    if (verdict === "sell_now") {
      return `On ${formattedDate} I told you to sell now${offered ? ` at ${offered}` : ""}.`;
    }
    return `On ${formattedDate} I told you to store your maize and wait for higher market prices.`;
  }

  // Generic fallback with no ISO dates
  const safeContent = content.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (iso) => formatGroundedDate(iso, lang));
  if (lang === "yo") {
    return `Ìmọ̀ràn tí a gbà sílẹ̀: ${safeContent.trim()}`;
  }
  if (lang === "pcm") {
    return `Advice wey dey ground: ${safeContent.trim()}`;
  }
  return `Previous advice on record: ${safeContent.trim()}`;
}
