import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { LLMError } from "../core/errors.ts";
import type { Lang } from "../core/types.ts";
import { NightshiftProvider, logLLMCall, getNightshiftConfig } from "../core/nightshift.ts";
import type { LLMProvider } from "./provider.ts";

export const UnderstandSchema = z.object({
  intent: z.enum([
    "plant_timing",
    "sell_or_store",
    "maize_agronomy",
    "why",
    "briefing",
    "profile_update",
    "recall_previous",
    "smalltalk",
    "out_of_scope",
    "unknown",
  ]),
  language: z.enum(["en", "pcm", "yo", "ha"]),
  slots: z.record(z.string(), z.unknown()),
  missing: z.array(z.string()),
});

export type UnderstandResult = z.infer<typeof UnderstandSchema> & {
  meta?: {
    usedLlm: boolean;
    provider: string;
    requestedModel?: string;
    respondedModel?: string;
    latencyMs?: number;
  };
};

/**
 * Detects if a farmer's message is asking to recall past advice (DESIGN.md Step 1 & Day 4.2 Follow-up).
 * Checks both NFC-normalized text and a diacritic-stripped form (NFD without combining marks).
 * Requires explicit phrasings referencing past advice, avoiding false positives on general requests like "sọ fún mi" ("tell me").
 */
export function isRecallQuery(text: string): boolean {
  if (!text) return false;
  const nfc = text.normalize("NFC").toLowerCase();
  const stripped = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

  // Yoruba patterns (NFC) - Require past reference to what was previously said
  // "kí lo sọ", "kí ni o sọ", "o ti sọ", "ìmọ̀ràn tí o fún mi", "ṣé o rántí ohun tí o sọ", "rántí ohun tí o sọ", "tí o sọ tẹ́lẹ̀", "rántí mi"
  const yorubaPatterns = [
    /k[ií]\s+l?o\s+s[oọ]/iu,
    /k[ií]\s+ni\s+o\s+s[oọ]/iu,
    /o\s+ti\s+s[oọ]/iu,
    /ìm[oọ̀òó]\s*r[aàá]n\s+t[ií]\s+o\s+f[uú]n\s+mi/iu,
    /ṣ[eé]\s+o\s+r[aàá]nt[ií]\s+ohun\s+t[ií]\s+o\s+s[oọ]/iu,
    /r[aàá]nt[ií]\s+ohun\s+t[ií]\s+o\s+s[oọ]/iu,
    /r[aàá]nt[ií]\s+mi\b/iu,
    /t[ií]\s+o\s+s[oọ]\s+t[eẹ́ẹ̀]l[eẹ̀é]/iu,
  ];

  // Pidgin patterns - Must reference past conversation
  // "wetin you talk", "wetin you tell me", "wetin you say before", "which advice you give me", "remind me"
  const pidginPatterns = [
    /wetin\s+you\s+talk/iu,
    /wetin\s+you\s+tell\s+me/iu,
    /wetin\s+you\s+say\s+before/iu,
    /which\s+advice\s+you\s+give\s+me/iu,
    /remind\s+me/iu,
  ];

  // English & general patterns - Must reference past advice
  // "remind me", "what did you tell me", "what did you say", "you said", "last time"
  const englishPatterns = [
    /remind\s+(?:me|us)/iu,
    /what\s+did\s+you\s+(?:tell\s+me|say|advise)/iu,
    /what\s+did\s+you\s+tell/iu,
    /you\s+said/iu,
    /last\s+time/iu,
    /when\s+did\s+you\s+say/iu,
    /what\s+was\s+(?:your\s+)?advice/iu,
    /previous\s+advice/iu,
    /earlier\s+advice/iu,
  ];

  // Diacritic-stripped patterns for typed Yoruba
  const strippedPatterns = [
    /ki\s+lo\s+so/iu,
    /ki\s+ni\s+o\s+so/iu,
    /o\s+ti\s+so/iu,
    /imoran\s+ti\s+o\s+fun\s+mi/iu,
    /se\s+o\s+ranti\s+ohun\s+ti\s+o\s+so/iu,
    /ranti\s+ohun\s+ti\s+o\s+so/iu,
    /ranti\s+mi\b/iu,
    /ti\s+o\s+so\s+tele/iu,
  ];

  for (const pat of [...yorubaPatterns, ...pidginPatterns, ...englishPatterns]) {
    if (pat.test(nfc)) return true;
  }

  for (const pat of strippedPatterns) {
    if (pat.test(stripped)) return true;
  }

  return false;
}

/**
 * Detects questions about non-maize crops (cassava, yam, rice, cowpea, cocoa, etc.).
 * Ikore AI is strictly focused on maize; queries about other crops are out of scope.
 */
export function isNonMaizeCropQuery(text: string): boolean {
  if (!text) return false;
  const nfc = text.normalize("NFC").toLowerCase();
  const stripped = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

  return (
    /\b(?:cassava|yams?|rice|sorghum|millet|cowpeas?|cocoa|soybeans?|tomatoes?|peppers?|gb[aá]g[uú]d[aá]|gbaguda|[eẹ́ẹ̀]g[eẹ́ẹ̀]|ege|[ií]s[uú]|isu|[ií]r[eẹ́ẹ̀]s[ií]|iresi|rogo|doya|shinkafa|wake)\b/iu.test(nfc) ||
    /\b(?:cassava|yams?|rice|sorghum|millet|cowpeas?|cocoa|soybeans?|tomatoes?|peppers?|gbaguda|ege|isu|iresi|rogo|doya|shinkafa|wake)\b/iu.test(stripped)
  );
}

/**
 * Detects questions about rainfall adequacy / establishment rain:
 * "Will this month's rain be enough for planting maize this season?",
 * "Is the rain enough to plant now?", "Has the rain started properly?"
 * These route to plant_timing with slots.focus = "rain_adequacy".
 */
export function isRainAdequacyQuery(text: string): boolean {
  if (!text) return false;
  const nfc = text.normalize("NFC").toLowerCase();
  const stripped = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

  const enPatterns = [
    /rain\s+(?:be\s+)?enough/iu,
    /enough\s+rain/iu,
    /is\s+(?:the\s+)?rain\s+enough/iu,
    /is\s+there\s+enough\s+rain/iu,
    /rain\s+started\s+(?:properly|well)/iu,
    /has\s+(?:the\s+)?rain\s+started/iu,
    /rain\s+reach\s+(?:to\s+)?plant/iu,
    /rain\s+adequa/iu,
    /sufficient\s+rain/iu,
  ];

  const yoPatterns = [
    /ṣ[eé]\s+[oòó]j[oòó]\s+(?:náà\s+)?t[oó]/iu,
    /[oòó]j[oòó]\s+ha\s+t[oó]/iu,
    /[oòó]j[oòó]\s+t[oó]\s+l[aá]ti/iu,
    /[oòó]j[oòó]\s+ti\s+b[eẹ́ẹ̀]r[eẹ́ẹ̀]\s+d[aá][aá]d[aá][aá]/iu,
    /ṣ[eé]\s+[oòó]j[oòó]\s+t[oó]/iu,
    /[oòó]j[oòó]\s+oṣ[uùú]\s+y[iíì]/iu,
  ];

  const yoStripped = [
    /se\s+ojo\s+(?:naa\s+)?to/iu,
    /ojo\s+ha\s+to/iu,
    /ojo\s+to\s+lati/iu,
    /ojo\s+ti\s+bere\s+daadaa/iu,
    /se\s+ojo\s+to/iu,
    /ojo\s+osu\s+yii/iu,
  ];

  const pcmPatterns = [
    /rain\s+don\s+reach/iu,
    /rain\s+reach\s+to\s+plant/iu,
    /water\s+reach\s+to\s+plant/iu,
    /rain\s+don\s+start\s+well/iu,
    /rain\s+start\s+well\s+well/iu,
    /rain\s+go\s+reach/iu,
  ];

  for (const pat of [...enPatterns, ...yoPatterns, ...pcmPatterns]) {
    if (pat.test(nfc)) return true;
  }
  for (const pat of yoStripped) {
    if (pat.test(stripped)) return true;
  }
  return false;
}

/**
 * Detects maize agronomy questions:
 * - watering / irrigation
 * - land preparation (clearing, plowing, harrowing, ridging, tilling)
 * - seed choice and spacing
 * - fertiliser timing and application
 * - weeding & weed control
 * - pests and diseases (fall armyworm, stem borers, caterpillars, blight)
 * - harvest timing and signs of maturity
 * - drying & shelling
 * - storage handling (protecting stored maize, weevil control)
 */
export function isMaizeAgronomyQuery(text: string): boolean {
  if (!text) return false;
  const nfc = text.normalize("NFC").toLowerCase();
  const stripped = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

  // Watering / irrigation
  const waterMatch =
    /\b(?:water|watering|irrigation|irigeshon|bomi|bomirin|rin\s*omi|ruwa)\b/iu.test(nfc) ||
    /\b(?:water|watering|irrigation|irigeshon|bomi|bomirin|rin\s*omi|ruwa)\b/iu.test(stripped);

  // Land prep
  const landPrepMatch =
    /\b(?:land\s*prep(?:aration)?|plow|plowing|plough|ploughing|ridge|ridging|till|tilling|harrow|harrowing|clearing|tu\s*il[eẹ́ẹ̀]|roko|pal[eẹ́ẹ̀]\s*m[oọ́]|gyaran\s*gona)\b/iu.test(nfc) ||
    /\b(?:land\s*prep(?:aration)?|plow|plowing|plough|ploughing|ridge|ridging|till|tilling|harrow|harrowing|clearing|tu\s*ile|roko|pale\s*mo|gyaran\s*gona)\b/iu.test(stripped);

  // Seed choice, spacing, depth
  const seedSpacingMatch =
    /\b(?:spacing|seed\s*variety|variety|hybrid|open\s*pollinated|how\s*deep|how\s*far|distance|seeds?\s*per\s*hole|irugbin|aaye|[aàá]y[eèé]|nisa)\b/iu.test(nfc) ||
    /\b(?:spacing|seed\s*variety|variety|hybrid|open\s*pollinated|how\s*deep|how\s*far|distance|seeds?\s*per\s*hole|irugbin|aaye|aye|nisa)\b/iu.test(stripped);

  // Fertilizer & soil
  const fertilizerMatch =
    /\b(?:fertiliz(?:er)?|fertiliser|urea|npk|manure|aj[ií]l[eẹ̀é]|taki)\b/iu.test(nfc) ||
    /\b(?:fertiliz(?:er)?|fertiliser|urea|npk|manure|ajile|taki)\b/iu.test(stripped);

  // Weeds & weeding
  const weedingMatch =
    /\b(?:weeds?|weeding|herbicide|koriko|k[oọ]r[oọ]k[oọ]|ciyawa|yanko)\b/iu.test(nfc) ||
    /\b(?:weeds?|weeding|herbicide|koriko|koroko|ciyawa|yanko)\b/iu.test(stripped);

  // Pests & diseases
  const pestMatch =
    /\b(?:pests?|armyworms?|worms?|stem\s*borers?|caterpillars?|insects?|fungicides?|pesticides?|blight|diseases?|k[oòó]k[oòó]r[oòó]|kwari)\b/iu.test(nfc) ||
    /\b(?:pests?|armyworms?|worms?|stem\s*borers?|caterpillars?|insects?|fungicides?|pesticides?|blight|diseases?|kokoro|kwari)\b/iu.test(stripped);

  // Harvest, maturity, drying, shelling
  const harvestMatch =
    /\b(?:harvest|harvesting|mature|maturity|signs\s+of\s+maturity|drying|sun\s+dry|dry|moisture|shelling|shell|threshing|thresh|k[oóọ̀]r[eéè]|ikore|ìkórè|s[aá]\s+[aàá]gb[aàá]do|r[eẹ́ẹ̀]\s+[aàá]gb[aàá]do|girbi|girbe|bushewa)\b/iu.test(nfc) ||
    /\b(?:harvest|harvesting|mature|maturity|signs\s+of\s+maturity|drying|sun\s+dry|dry|moisture|shelling|shell|threshing|thresh|kore|ikore|sa\s+agbado|re\s+agbado|girbi|girbe|bushewa)\b/iu.test(stripped);

  // Storage handling (e.g. weevils or how to store safely) when NOT a commercial bags+price trade decision
  const storageHandlingMatch =
    /\b(?:weevils?|protect\s+maize|how\s+to\s+store|safe\s+storage|storage\s+loss)\b/iu.test(nfc);

  return (
    waterMatch ||
    landPrepMatch ||
    seedSpacingMatch ||
    fertilizerMatch ||
    weedingMatch ||
    pestMatch ||
    harvestMatch ||
    storageHandlingMatch
  );
}

/**
 * Detects questions completely outside Ikore AI's domain (non-maize crops, non-farming topics).
 */
export function isOutOfScopeQuery(text: string): boolean {
  if (!text) return false;
  return isNonMaizeCropQuery(text);
}

function isDirectPlantingQuery(text: string): boolean {
  const nfc = text.normalize("NFC").toLowerCase();
  const stripped = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  // Don't treat spacing, depth, fertilizer, weed, pest, harvest as plant_timing
  if (
    /\b(?:spacing|distance|how\s+deep|seeds?\s+per\s+hole|fertiliz|aj[ií]l[eẹ̀é]|k[oóọ̀]r[eéè]|ikore|ìkórè|harvest|weeds?|pests?|water|watering)\b/iu.test(nfc) ||
    /\b(?:spacing|distance|how\s+deep|seeds?\s+per\s+hole|fertiliz|ajile|kore|ikore|harvest|weeds?|pests?|water|watering)\b/iu.test(stripped)
  ) {
    return false;
  }
  return (
    /\b(?:when\s+(?:should|can|to|do)\s+(?:i\s+)?plant|plant\s+now\s+or\s+wait|should\s+i\s+plant|time\s+to\s+plant|planting\s+date|start\s+planting|gbìn\s+b[aá]y[iíì]|ìgb[aàá]\s+wo\s+ni.*gbìn|ṣ[eé]\s+k[ií]\s+n\s+gbìn|shuka\s+yanzu)\b/iu.test(nfc) ||
    /\b(?:when\s+(?:should|can|to|do)\s+(?:i\s+)?plant|plant\s+now\s+or\s+wait|should\s+i\s+plant|time\s+to\s+plant|planting\s+date|start\s+planting|gbin\s+bayii|igba\s+wo\s+ni.*gbin|se\s+ki\s+n\s+gbin|shuka\s+yanzu)\b/iu.test(stripped)
  );
}

/**
 * Deterministic rule-based extractor (fast, offline, zero-network fallback).
 */
export function extractRules(text: string): UnderstandResult {
  const lower = text.toLowerCase();
  const nfc = text.normalize("NFC").toLowerCase();
  const stripped = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

  // 1. Language detection
  let language: Lang = "en";
  if (
    /(?<=^|\P{L})(?:gbìn|àgbàdo|ọjọ́|ìgbà|ẹni|kí n|báyìí|ṣé|ní|mo ní|bóyá|owo|fún|kọ̀ọ̀kan|dúró|díẹ̀|tà|tọ́jú|àpò|fẹ́|rà|rántí|ranti|ìmọ̀ràn|imoran|kí lo|kí ni|sọ fún|ṣé o|nípa|màá|kórè|ìkórè|ajílẹ̀|kòkòrò|omi|ilẹ̀)(?=\P{L}|$)/iu.test(nfc) ||
    /(?<=^|\P{L})(?:gbin|agbado|ojo|igba|eni|ki n|bayii|se|mo ni|boya|owo|fun|kookan|duro|die|ta|toju|apo|fe|ra|ranti|imoran|ki lo|ki ni|so fun|se o|nipa|maa|kore|ikore|ajile|kokoro|omi|ile)(?=\P{L}|$)/iu.test(stripped)
  ) {
    language = "yo";
  } else if (
    /(?<=^|\P{L})(?:don|make|dey|wetin|na|fit|abeg|corn|keep am|i get|how much|talk|bin talk)(?=\P{L}|$)/iu.test(nfc)
  ) {
    language = "pcm";
  } else if (
    /(?<=^|\P{L})(?:yaushe|ina|shuka|masara|buhu|jira|sayar|ajiye|tuna|ruwa|taki|girbi|kwari)(?=\P{L}|$)/iu.test(nfc)
  ) {
    language = "ha";
  }

  // 2. Slot extraction (early so intent detection can check bags/price)
  const slots: Record<string, unknown> = {};

  // Bags count extraction (e.g. "20 bags", "àpò 20", "20 àpò", "buhu 20")
  const bagsMatch =
    text.match(/(\d+)\s*(?:bags?|àpò|buhu)/i) ||
    text.match(/(?:bags?|àpò|buhu)\s*(\d+)/i) ||
    text.match(/\b(\d+)\s+bags?\b/i);
  if (bagsMatch) {
    const b = parseInt(bagsMatch[1], 10);
    if (Number.isFinite(b) && b > 0) {
      slots.bags = b;
    }
  }

  // Bag weight in kg (e.g. "100kg bag", "100 kg", "50kg")
  const weightMatch = text.match(/(\d+)\s*kg/i);
  if (weightMatch) {
    const w = parseInt(weightMatch[1], 10);
    if (Number.isFinite(w) && w > 0) {
      slots.bagKg = w;
      slots.bagWeightKg = w;
    }
  }

  // Price extraction:
  // 1. First look for explicit full price patterns (e.g. "45,000 naira per bag", "₦45,000", "45000 per bag")
  const fullPriceMatch =
    text.match(/(?:offer|offering|price\s*(?:na|is|=|:)?|at|sell for|buy for|for)?\s*(?:₦|ngn|naira)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})\s*(?:naira|ngn)?\s*(?:per|\/)?\s*(?:bag|àpò|buhu)/i) ||
    text.match(/([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})\s*(?:naira|ngn)\s*(?:per|\/)?\s*(?:bag|àpò|buhu)/i) ||
    text.match(/(?:₦|ngn)\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})/i) ||
    text.match(/([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})\s*(?:per|\/)\s*bag/i);

  if (fullPriceMatch) {
    const pStr = fullPriceMatch[1].replace(/,/g, "");
    const pNum = Number(pStr);
    if (Number.isFinite(pNum) && pNum > 0) {
      slots.pricePerBagNgn = pNum;
      slots.pricePerBag = pNum;
    }
  }

  // 2. If no full price match, check for "45k" shorthand (strictly NOT followed by 'g' for kg)
  if (!slots.pricePerBagNgn) {
    const kPriceMatch = text.match(/(?:price\s*(?:na|is|=|:)?\s*|offer\s*|at\s*|₦\s*)?(\d+(?:\.\d+)?)\s*k\b(?!\s*g)(?:\s*(?:per|\/)?\s*(?:bag|àpò|buhu))?/i);
    if (kPriceMatch) {
      const kVal = parseFloat(kPriceMatch[1]) * 1000;
      if (Number.isFinite(kVal) && kVal >= 1000) {
        slots.pricePerBagNgn = kVal;
        slots.pricePerBag = kVal;
      }
    }
  }

  // Storage method
  if (/\b(pics|hermetic|triple bag)\b/i.test(lower)) {
    slots.storageMethod = "pics";
  } else if (/\b(sack|plain sack|àpò lásán)\b/i.test(lower)) {
    slots.storageMethod = "sack";
  } else if (/\b(silo)\b/i.test(lower)) {
    slots.storageMethod = "silo";
  }

  // 3. Intent detection
  let intent: UnderstandResult["intent"] = "unknown";
  if (isRecallQuery(text)) {
    intent = "recall_previous";
  } else if (isNonMaizeCropQuery(text)) {
    intent = "out_of_scope";
  } else if (isRainAdequacyQuery(text)) {
    intent = "plant_timing";
    slots.focus = "rain_adequacy";
  } else if (
    Boolean(slots.bags || slots.pricePerBagNgn) &&
    /(?<=^|\P{L})(?:sell|store|price|market|bag|keep|tà|tọ́jú|sayar|ajiye|àpò|rà)(?=\P{L}|$)/iu.test(nfc)
  ) {
    intent = "sell_or_store";
  } else if (isDirectPlantingQuery(text)) {
    intent = "plant_timing";
  } else if (isMaizeAgronomyQuery(text)) {
    intent = "maize_agronomy";
  } else if (
    /(?<=^|\P{L})(?:sell|store|price|market|bag|keep|tà|tọ́jú|sayar|ajiye|àpò|rà)(?=\P{L}|$)/iu.test(nfc) ||
    /(?<=^|\P{L})(?:sell|store|price|market|bag|keep|ta|toju|sayar|ajiye|apo|ra)(?=\P{L}|$)/iu.test(stripped)
  ) {
    intent = "sell_or_store";
  } else if (
    /(?<=^|\P{L})(?:why|wetin make|kilode|kílódé|me ya sa)(?=\P{L}|$)/iu.test(nfc) ||
    /(?<=^|\P{L})(?:why|wetin make|kilode|me ya sa)(?=\P{L}|$)/iu.test(stripped)
  ) {
    intent = "why";
  } else if (/(?<=^|\P{L})(?:brief|morning|update|report)(?=\P{L}|$)/iu.test(nfc)) {
    intent = "briefing";
  } else if (
    /(?<=^|\P{L})(?:plant|sow|seed|ground|start|planting|gbìn|shuka)(?=\P{L}|$)/iu.test(nfc) ||
    /(?<=^|\P{L})(?:plant|sow|seed|ground|start|planting|gbin|shuka)(?=\P{L}|$)/iu.test(stripped)
  ) {
    intent = "plant_timing";
  } else if (/(?<=^|\P{L})(?:hi|hello|good morning|kedu|bawo)(?=\P{L}|$)/iu.test(nfc)) {
    intent = "smalltalk";
  } else {
    intent = "plant_timing";
  }

  // 4. Missing slots calculation
  const missing: string[] = [];
  if (intent === "sell_or_store") {
    if (!slots.bags) missing.push("bags");
    if (!slots.pricePerBagNgn) missing.push("pricePerBagNgn");
  }

  return {
    intent,
    language,
    slots,
    missing,
  };
}

/**
 * Load system prompt for understand.
 */
function loadUnderstandPrompt(): string {
  const pathsToTry = [
    path.resolve(process.cwd(), "prompts", "understand.md"),
    path.resolve(process.cwd(), "src", "llm", "prompts", "understand.md"),
  ];
  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, "utf8");
    }
  }
  return "You extract intent, language, and slots from a Nigerian farmer message as JSON.";
}

/**
 * High-level understand function (LLM with Zod validation + deterministic rule fallback).
 */
export async function understand(
  text: string,
  _farmId?: string,
  provider?: LLMProvider
): Promise<UnderstandResult> {
  // Make rule-based recall check run BEFORE the LLM classifier and take precedence when it matches
  if (isRecallQuery(text)) {
    const rules = extractRules(text);
    rules.intent = "recall_previous";
    return {
      ...rules,
      meta: {
        usedLlm: false,
        provider: "rules",
        requestedModel: "none",
        respondedModel: "none",
        latencyMs: 0,
      },
    };
  }

  // Detect out-of-scope queries (non-maize crops) early
  if (isOutOfScopeQuery(text)) {
    const rules = extractRules(text);
    rules.intent = "out_of_scope";
    return {
      ...rules,
      meta: {
        usedLlm: false,
        provider: "rules",
        requestedModel: "none",
        respondedModel: "none",
        latencyMs: 0,
      },
    };
  }

  // Detect rain-adequacy queries early (route to plant_timing with slots.focus = "rain_adequacy")
  if (isRainAdequacyQuery(text)) {
    const rules = extractRules(text);
    rules.intent = "plant_timing";
    rules.slots.focus = "rain_adequacy";
    return {
      ...rules,
      meta: {
        usedLlm: false,
        provider: "rules",
        requestedModel: "none",
        respondedModel: "none",
        latencyMs: 0,
      },
    };
  }

  const config = getNightshiftConfig();

  // SAMPLE_MODE=true: use deterministic extraction and log sample
  if (config.sampleMode) {
    logLLMCall({
      timestamp: new Date().toISOString(),
      runId: `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      step: "understand",
      provider: "sample",
      requestedModel: "none",
      respondedModel: "none",
      latencyMs: 0,
      status: "ok",
      fallbackUsed: true,
    });
    const fallback = extractRules(text);
    return {
      ...fallback,
      meta: {
        usedLlm: false,
        provider: "sample",
        requestedModel: "none",
        respondedModel: "none",
        latencyMs: 0,
      },
    };
  }

  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

  // In test mode without an explicit provider, use fast rules
  if (isTest && !provider) {
    const fallback = extractRules(text);
    return {
      ...fallback,
      meta: {
        usedLlm: false,
        provider: "rules",
        requestedModel: "none",
        respondedModel: "none",
        latencyMs: 0,
      },
    };
  }

  const activeProvider = provider || new NightshiftProvider();

  try {
    const system = loadUnderstandPrompt();
    let compResult: any;

    if ("completeWithMeta" in activeProvider && typeof (activeProvider as any).completeWithMeta === "function") {
      compResult = await (activeProvider as any).completeWithMeta({
        system,
        messages: [{ role: "user", content: text }],
        json: UnderstandSchema,
        temperature: 0.1,
        stepName: "understand",
      });
    } else {
      const res = await activeProvider.complete({
        system,
        messages: [{ role: "user", content: text }],
        json: UnderstandSchema,
        temperature: 0.1,
        stepName: "understand",
      });
      compResult = {
        content: res,
        model: (activeProvider as any).lastRespondedModel || config.model,
        latencyMs: 0,
      };
    }

    const result = compResult.content as UnderstandResult;

    // Mirror slot alias for backward compatibility (pricePerBagNgn <-> pricePerBag)
    if (result.slots.pricePerBagNgn && !result.slots.pricePerBag) {
      result.slots.pricePerBag = result.slots.pricePerBagNgn;
    } else if (result.slots.pricePerBag && !result.slots.pricePerBagNgn) {
      result.slots.pricePerBagNgn = result.slots.pricePerBag;
    }

    result.meta = {
      usedLlm: true,
      provider: "nightshift",
      requestedModel: config.model,
      respondedModel: compResult.model,
      latencyMs: compResult.latencyMs,
    };

    return result;
  } catch (err: any) {
    // If in live mode and network/connection to Nightshift failed, throw LLMError
    if (!config.sampleMode && !isTest && /fetch failed|ECONNREFUSED|ETIMEDOUT|502|503/i.test(err.message)) {
      throw new LLMError(`Nightshift unreachable: ${err.message}`, { cause: err });
    }
    console.warn(`[Understand] LLM parse failed (${err.message}), falling back to deterministic extraction.`);
    const fallback = extractRules(text);
    return {
      ...fallback,
      meta: {
        usedLlm: false,
        provider: "rules",
        requestedModel: "none",
        respondedModel: "none",
        latencyMs: 0,
      },
    };
  }
}
