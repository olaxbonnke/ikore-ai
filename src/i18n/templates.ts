import type { Decision, Lang, OptionResult } from "../core/types.ts";
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

/** Honest localized reply for out-of-scope or unsupported agricultural questions. */
export function templateOutOfScope(lang: Lang = "en"): string {
  if (lang === "yo") {
    return "Mo lè gbani nímọ̀ràn lórí gbogbo iṣẹ́ oko àgbàdo nìkan (ìgbà gbígbin, àbójútó oko, ìkórè, títà tàbí títọ́jú). N kò lè gbani nímọ̀ràn lórí àwọn ohun ọ̀gbìn mìíràn bíi gbágùúdá tàbí iṣu.";
  }
  if (lang === "pcm") {
    return "I fit only advise on maize farming work (planting time, farm care, harvest, storage, and selling). I no fit advise on other crops like cassava or yam.";
  }
  if (lang === "ha") {
    return "Zan iya ba da shawara ne kawai kan aikin noman masara (lokacin shuka, kula da gona, girbi, ajiya, da sayarwa). Ba zan iya ba da shawara kan sauran amfanin gona kamar rogo ko doya ba.";
  }
  return "I can only advise on maize farming operations (planting timing, field care, harvest, storage, and selling decisions). I cannot advise on other crops like cassava or yam.";
}

/** Honest localized fallback when agronomy guidance is rejected or fails. */
export function templateAgronomyFallback(lang: Lang = "en"): string {
  if (lang === "yo") {
    return "Fún àbójútó oko àgbàdo rẹ tó dára àti èyí tó wà ní ààbò, jọ̀wọ́ kàn sí alábòójútó iṣẹ́ àgbẹ̀ (ADP extension officer) tó wà lábúlé rẹ tàbí ilé-iṣẹ́ ajílẹ̀ tó ní àṣẹ fún ìtọ́sọ́nà tó tọ́ àti ìwọ̀n lílò tó dájú.";
  }
  if (lang === "pcm") {
    return "For correct advice and safe way to handle your maize farm, make you visit your local Agricultural Development Programme (ADP) extension officer or licensed agro-dealer for correct rates.";
  }
  if (lang === "ha") {
    return "Don samun ingantacciyar shawarwari kan kula da gonar masara, tuntuɓi jami'in Agricultural Development Programme (ADP) na yankinku ko shagon magunguna da aka amince da shi.";
  }
  return "For safe and effective maize field management, please consult your local Agricultural Development Programme (ADP) extension officer or registered agro-dealer for approved recommendations and label application rates.";
}

/** Pre-written grounded explanation for rain adequacy questions leading with establishment rain. */
export function templatePlantingRainAdequacy(decision: Decision, lang: Lang = "en"): string {
  const chosen = decision.chosen;
  const k = decision.keyNumbers;
  const chosenOpt = decision.options?.find((o) => o.option === chosen) as
    | (OptionResult & { offsetDays?: number; plantingDate?: string })
    | undefined;
  const offsetDays =
    typeof chosenOpt?.offsetDays === "number"
      ? chosenOpt.offsetDays
      : chosen === "plant_now"
      ? 0
      : chosen === "wait_7"
      ? 7
      : chosen === "wait_14"
      ? 14
      : 0;

  const rawDate = String(chosenOpt?.plantingDate || k.plantingDate || decision.createdAt.slice(0, 10));
  const formattedDate = formatGroundedDate(rawDate, lang);
  const nYears = Number(k.seasonsCount || k.nAnalogYears || 35);

  const rainP50 = Math.round(Number(k.plantNow_rainP50Mm ?? k.rainP50Mm ?? 95));
  const rainP10 = Math.round(Number(k.plantNow_rainP10Mm ?? k.rainP10Mm ?? 45));
  const rainP90 = Math.round(Number(k.plantNow_rainP90Mm ?? k.rainP90Mm ?? 160));

  const isAdequateNow = rainP50 >= 100;

  // Check if NiMet benchmark evidence is attached
  const nimetEv = decision.evidence?.find((e) => e.id === "ev_nimet_benchmark");
  const nimetNoteEn = nimetEv ? ` ${nimetEv.statistic}.` : "";

  const waitPhraseEn =
    offsetDays === 7
      ? "Wait a week"
      : offsetDays === 14
      ? "Wait two weeks"
      : `Wait ${offsetDays} days`;

  const plantNowChanceEn = String(
    k[`plainChance_plantNow_${lang}`] || k.plainChance_plantNow_en || "about 1 in 7 seasons"
  );
  const waitChanceEn = String(
    k[`plainChance_chosen_${lang}`] || k.plainChance_chosen_en || "almost never"
  );

  if (lang === "yo") {
    const waitPhraseYo =
      offsetDays === 7
        ? "Dúró fún ọ̀sẹ̀ kan"
        : offsetDays === 14
        ? "Dúró fún ọ̀sẹ̀ méjì"
        : `Dúró fún ọjọ́ ${offsetDays}`;
    const plantNowChanceYo = String(
      k[`plainChance_plantNow_yo`] || "ẹ̀ẹ̀kan nínú àsìkò méje"
    );
    const waitChanceYo = String(
      k[`plainChance_chosen_yo`] || "fẹ́rẹ́ kò ṣẹlẹ̀ rárá"
    );

    const adequacyClauseYo = isAdequateNow
      ? "èyí tí ó tó ìwọ̀n 100 mm tí a nílò"
      : "èyí tí kò tó ìwọ̀n 100 mm tí a nílò";

    if (offsetDays === 0) {
      return `Ní àsìkò ${nYears} sẹ́yìn tí ó jọra, gbígbin báyìí ní ìwọ̀n òjò ìbẹ̀rẹ̀ ${rainP50} mm (láàrín ${rainP10} sí ${rainP90} mm), ${adequacyClauseYo}. Gbìn báyìí ní nǹkan bí ${formattedDate}. Ewu láti tún gbìn jẹ́ ${plantNowChanceYo}.`;
    }
    return `Ní àsìkò ${nYears} sẹ́yìn tí ó jọra, gbígbin báyìí ní ìwọ̀n òjò ìbẹ̀rẹ̀ ${rainP50} mm (láàrín ${rainP10} sí ${rainP90} mm), ${adequacyClauseYo}. Bí ó ti wù kí ó rí, ${waitPhraseYo} kí o gbìn ní nǹkan bí ${formattedDate}. Tí o bá gbìn báyìí, ewu láti tún gbìn jẹ́ ${plantNowChanceYo}, ṣùgbọ́n tí o bá dúró, ${waitChanceYo}.`;
  }

  if (lang === "pcm") {
    const waitPhrasePcm =
      offsetDays === 7
        ? "Wait one week"
        : offsetDays === 14
        ? "Wait two weeks"
        : `Wait ${offsetDays} days`;
    const plantNowChancePcm = String(
      k[`plainChance_plantNow_pcm`] || "about 1 for every 7 seasons"
    );
    const waitChancePcm = String(
      k[`plainChance_chosen_pcm`] || "e no dey almost happen"
    );

    const adequacyClausePcm = isAdequateNow
      ? "wey reach the 100 mm seedling threshold"
      : "wey dey below the 100 mm seedling threshold";

    if (offsetDays === 0) {
      return `Inside ${nYears} similar past seasons, planting now record median establishment rain of ${rainP50} mm (between ${rainP10} and ${rainP90} mm), ${adequacyClausePcm}. Plant now around ${formattedDate}. Replant risk na ${plantNowChancePcm}.`;
    }
    return `Inside ${nYears} similar past seasons, planting now record median establishment rain of ${rainP50} mm (between ${rainP10} and ${rainP90} mm), ${adequacyClausePcm}. However, ${waitPhrasePcm}. Plant around ${formattedDate}, where replanting ${waitChancePcm} (planting now needed replanting in ${plantNowChancePcm}).`;
  }

  // Default English
  const adequacyClauseEn = isAdequateNow
    ? "which meets the 100 mm seedling threshold"
    : "which is below the 100 mm seedling threshold";

  if (offsetDays === 0) {
    return `In ${nYears} similar past seasons, planting now recorded a median establishment rain of ${rainP50} mm (between ${rainP10} and ${rainP90} mm), ${adequacyClauseEn}. Plant now around ${formattedDate}. Replant chance is ${plantNowChanceEn}.${nimetNoteEn}`;
  }
  return `In ${nYears} similar past seasons, planting now recorded a median establishment rain of ${rainP50} mm (between ${rainP10} and ${rainP90} mm), ${adequacyClauseEn}. However, ${waitPhraseEn}. Plant around ${formattedDate}, where replanting ${waitChanceEn} (planting now needed replanting in ${plantNowChanceEn}).${nimetNoteEn}`;
}

/** Pre-written grounded template explanations for planting decisions (DESIGN.md step 7 & Day 4.2 Polish). */
export function templatePlanting(decision: Decision, lang: Lang = "en"): string {
  const chosen = decision.chosen;
  const k = decision.keyNumbers;
  const chosenOpt = decision.options?.find((o) => o.option === chosen) as
    | (OptionResult & { offsetDays?: number; plantingDate?: string })
    | undefined;
  const offsetDays =
    typeof chosenOpt?.offsetDays === "number"
      ? chosenOpt.offsetDays
      : chosen === "plant_now"
      ? 0
      : chosen === "wait_7"
      ? 7
      : chosen === "wait_14"
      ? 14
      : 0;

  const rawDate = String(chosenOpt?.plantingDate || k.plantingDate || decision.createdAt.slice(0, 10));
  const formattedDate = formatGroundedDate(rawDate, lang);
  const nYears = String(k.seasonsCount || k.nAnalogYears || "35");

  const plantNowChance = String(
    k[`plainChance_plantNow_${lang}`] || k.plainChance_plantNow_en || "about 1 in 7 seasons"
  );
  const waitChance = String(
    k[`plainChance_chosen_${lang}`] || k.plainChance_chosen_en || "almost never"
  );

  if (lang === "yo") {
    if (offsetDays === 0) {
      return `Gbìn àgbàdo rẹ báyìí ní nǹkan bí ${formattedDate}.\n\nEwu láti tún gbìn fẹ́rẹ́ kò ṣẹlẹ̀ rárá pẹ̀lú òjò tó tó nínú àsìkò ${nYears} sẹ́yìn.`;
    }
    const waitHeadline =
      offsetDays === 7
        ? "Dúró fún ọ̀sẹ̀ kan"
        : offsetDays === 14
        ? "Dúró fún ọ̀sẹ̀ méjì"
        : `Dúró fún ọjọ́ ${offsetDays}`;
    const waitReason =
      offsetDays === 7
        ? "Tí o bá dúró fún ọ̀sẹ̀ kan"
        : offsetDays === 14
        ? "Tí o bá dúró fún ọ̀sẹ̀ méjì"
        : `Tí o bá dúró fún ọjọ́ ${offsetDays}`;

    return `${waitHeadline} kí o gbìn ní nǹkan bí ${formattedDate}.\n\nTí o bá gbìn báyìí, ewu láti tún gbìn jẹ́ ${plantNowChance}. ${waitReason}, ${waitChance} nínú àsìkò ${nYears} sẹ́yìn.`;
  }

  if (lang === "pcm") {
    if (offsetDays === 0) {
      return `Plant now around ${formattedDate}.\n\nGood rain dey ground across ${nYears} past seasons, e no dey almost need planting again.`;
    }
    const waitHeadline =
      offsetDays === 7
        ? "Wait one week"
        : offsetDays === 14
        ? "Wait two weeks"
        : `Wait ${offsetDays} days`;
    const waitReason =
      offsetDays === 7
        ? "If you wait one week"
        : offsetDays === 14
        ? "If you wait two weeks"
        : `If you wait ${offsetDays} days`;

    return `${waitHeadline}. Plant around ${formattedDate}.\n\nIf you plant now, ${plantNowChance}, people don plant am again. ${waitReason}, e no dey almost happen.`;
  }

  if (lang === "ha") {
    if (offsetDays === 0) {
      return `Shuka yanzu a kusan ${formattedDate}.\n\nHaɗarin sake shuka kusan ba ya taɓa faruwa ba.`;
    }
    const waitHeadline =
      offsetDays === 7
        ? "Jira mako guda"
        : offsetDays === 14
        ? "Jira makonni biyu"
        : `Jira kwanaki ${offsetDays}`;
    const waitReason =
      offsetDays === 7
        ? "Idan ka jira mako guda"
        : offsetDays === 14
        ? "Idan ka jira makonni biyu"
        : `Idan ka jira kwanaki ${offsetDays}`;

    return `${waitHeadline} kafin ka shuka (kusan ${formattedDate}).\n\nIdan ka shuka yanzu, akwai haɗarin sake shuka. ${waitReason}, kusan ba ya taɓa faruwa ba.`;
  }

  // Default English (no 'danger', uses chance / needed replanting)
  if (offsetDays === 0) {
    return `Plant now around ${formattedDate}.\n\nReplanting ${waitChance} with enough rain across ${nYears} past seasons.`;
  }
  const waitHeadline =
    offsetDays === 7
      ? "Wait a week"
      : offsetDays === 14
      ? "Wait two weeks"
      : `Wait ${offsetDays} days`;
  const waitReason =
    offsetDays === 7
      ? "If you wait a week"
      : offsetDays === 14
      ? "If you wait two weeks"
      : `If you wait ${offsetDays} days`;

  return `${waitHeadline}. Plant around ${formattedDate}.\n\nIf you plant now, ${plantNowChance} needed replanting. ${waitReason}, it ${waitChance} in ${nYears} past seasons.`;
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
