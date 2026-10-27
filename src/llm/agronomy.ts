import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import type { Lang } from "../core/types.ts";
import { templateAgronomyFallback } from "../i18n/templates.ts";
import { validateYoruba } from "./explain.ts";
import { NightshiftProvider, logLLMCall, getNightshiftConfig } from "../core/nightshift.ts";
import type { LLMProvider } from "./provider.ts";
import type { Farm as FarmProfile } from "../core/types.ts";
import type { LoadedRecentRain } from "../core/observe.ts";

export const AgronomyOutputSchema = z.object({
  answer: z.string(),
  followUp: z.string().nullable().optional().default(null),
});

export type AgronomyOutput = z.infer<typeof AgronomyOutputSchema>;

/**
 * Detects if a maize agronomy query involves watering/irrigation or harvesting/drying,
 * which requires a Zetaris query on oko_pg.rain_daily for recent rainfall.
 */
export function isWateringOrHarvestQuery(text: string): boolean {
  if (!text) return false;
  const nfc = text.normalize("NFC").toLowerCase();
  const stripped = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  return (
    /\b(?:wet|water|watering|pour\s+water|irrigate|irrigation|irigeshon|bomi|bomirin|rin\s*omi|ruwa|rain|recent\s*rain|[oòó]j[oòó]|harvest|harvesting|k[oóọ̀]r[eéè]|ikore|ìkórè|dry|drying|moisture|shell|shelling|girbi)\b/iu.test(nfc) ||
    /\b(?:wet|water|watering|pour\s+water|irrigate|irrigation|irigeshon|bomi|bomirin|rin\s*omi|ruwa|rain|recent\s*rain|ojo|harvest|harvesting|kore|ikore|dry|drying|moisture|shell|shelling|girbi)\b/iu.test(stripped)
  );
}

export interface AgronomyValidationContext {
  allowedNumbers: Set<number>;
  rainMmNumbers: Set<number>;
  daysNumbers: Set<number>;
  haNumbers: Set<number>;
  memoryNumbers: Set<number>;
  validDates: string[];
}

/**
 * Builds the set of allowed numbers and context by unit kind:
 * - rain total and daily rain mm (mm)
 * - daysCount, rainDays, dryDays (days)
 * - farm size (ha)
 * - memory figures (bags, etc.)
 * - valid whole dates (e.g. "10 April") matching asOf or rain records
 */
/**
 * Whitelist filter for guidance memories.
 * Only admits farm profile and fact memories (hectares, zone, state, soil, storage method).
 * Rejects all advice records (plant timing, sell/store, verdicts, question logs).
 */
export function isProfileOrFactMemory(mem: string): boolean {
  if (typeof mem !== "string") return false;
  const s = mem.trim();
  if (!s) return false;

  // Strict blacklist check on advice records, decisions, verdicts, and question logs
  if (
    /(?:question:|advice\s+for|verdict:|verdict\b|decisionid|chosen\b|advised\s+to|store_[0-9a-z]|sell_now|wait_[0-9a-z]|plant_now)/i.test(s)
  ) {
    return false;
  }

  // Check JSON representation if present
  try {
    if (s.startsWith("{") && s.endsWith("}")) {
      const parsed = JSON.parse(s);
      if (parsed.type && !/(?:profile|fact)/i.test(parsed.type)) return false;
      if (parsed.tags && Array.isArray(parsed.tags)) {
        const hasProfileTag = parsed.tags.some((t: string) => /profile|fact|hectares|zone|state|soil|storage/i.test(t));
        if (!hasProfileTag) return false;
      }
      return true;
    }
  } catch {
    // not JSON
  }

  // Whitelist pattern matching for farm profile facts
  if (s.startsWith("[Demo profile") || s.startsWith("[Demo fact")) {
    return true;
  }
  if (/^(?:farm\s*(?:profile|size)|field\s*size|hectares|location|state|storage\s*method|soil\s*(?:type|condition))/i.test(s)) {
    return true;
  }
  if (/\b(?:hectares|ha|sandy\s+loam|clay|loam|derived_savanna|savanna|guinea|pics|hermetic|sack)\b/i.test(s) && !/(?:offered|buyer|price|naira|₦)/i.test(s)) {
    return true;
  }

  return false;
}

/**
 * Extracts the specific sub-question for the agronomy part from a compound query.
 */
export function extractAgronomySubQuestion(text: string, topic?: string, lang?: Lang): string {
  if (!text) return "";

  // Split on conjunctions and punctuation
  const conjunctionRegex = /\s+(?:and(?:\s+how|\s+what)?|also|as\s+well\s+as|báwo\s+sì\s+ni|bawo\s+si\s+ni|àti(?:\s+báwo)?|ati(?:\s+bawo)?|con)\s+|[.?,;]\s+/iu;
  const parts = text.split(conjunctionRegex).map((p) => p.trim()).filter(Boolean);

  for (const part of parts) {
    if (topic === "watering" && /(?:wet|water|irrigate|bomi|omi|rin)/i.test(part) && !/(?:start\s+planting|gbìn|gbin\s+àgbàdo)/i.test(part)) {
      return part.endsWith("?") ? part : `${part}?`;
    }
    if (topic === "fertilizer" && /(?:fertiliz|aj[ií]l[eẹ̀é]|npk|urea)/i.test(part) && !/(?:start\s+planting|gbìn)/i.test(part)) {
      return part.endsWith("?") ? part : `${part}?`;
    }
    if (topic === "weeding" && /(?:weed|kor[ií]ko)/i.test(part)) {
      return part.endsWith("?") ? part : `${part}?`;
    }
    if (topic === "pests" && /(?:pest|insect|kokoro|kòkòrò|armyworm)/i.test(part)) {
      return part.endsWith("?") ? part : `${part}?`;
    }
    if (topic === "harvest" && /(?:harvest|ikore|ìkórè)/i.test(part)) {
      return part.endsWith("?") ? part : `${part}?`;
    }
    if (topic === "storage" && /(?:store|storage|tọ́jú|toju|sack|bag)/i.test(part)) {
      return part.endsWith("?") ? part : `${part}?`;
    }
  }

  if (topic === "watering") {
    if (lang === "yo") return "Báwo ni kí n ṣe bomi rin àgbàdo mi?";
    if (lang === "pcm") return "How I go wet my maize?";
    return "How should I water my maize?";
  }
  return text;
}

export function buildAllowedAgronomyNumbers(
  farm: FarmProfile,
  recentRain?: LoadedRecentRain | null,
  asOf?: string,
  recalledMemories?: string[]
): AgronomyValidationContext {
  const rainMmNumbers = new Set<number>();
  const daysNumbers = new Set<number>();
  const haNumbers = new Set<number>();
  const memoryNumbers = new Set<number>();
  const allowedNumbers = new Set<number>();
  const validDates: string[] = [];

  if (farm.hectares && Number.isFinite(farm.hectares)) {
    haNumbers.add(farm.hectares);
    haNumbers.add(Math.round(farm.hectares));
    haNumbers.add(parseFloat(farm.hectares.toFixed(1)));
    allowedNumbers.add(farm.hectares);
    allowedNumbers.add(Math.round(farm.hectares));
    allowedNumbers.add(parseFloat(farm.hectares.toFixed(1)));
  }

  if (recentRain) {
    if (Number.isFinite(recentRain.totalRainMm)) {
      rainMmNumbers.add(recentRain.totalRainMm);
      rainMmNumbers.add(Math.round(recentRain.totalRainMm));
      rainMmNumbers.add(parseFloat(recentRain.totalRainMm.toFixed(1)));
      allowedNumbers.add(recentRain.totalRainMm);
      allowedNumbers.add(Math.round(recentRain.totalRainMm));
      allowedNumbers.add(parseFloat(recentRain.totalRainMm.toFixed(1)));
    }

    if (Number.isFinite(recentRain.daysCount)) {
      daysNumbers.add(recentRain.daysCount);
      allowedNumbers.add(recentRain.daysCount);
    }

    // Rain days (>= 1.0 mm) and dry days
    if (Array.isArray(recentRain.records)) {
      let rainDays = 0;
      for (const r of recentRain.records) {
        if (typeof r.rain_mm === "number" && Number.isFinite(r.rain_mm)) {
          rainMmNumbers.add(r.rain_mm);
          rainMmNumbers.add(Math.round(r.rain_mm));
          rainMmNumbers.add(parseFloat(r.rain_mm.toFixed(1)));
          allowedNumbers.add(r.rain_mm);
          allowedNumbers.add(Math.round(r.rain_mm));
          allowedNumbers.add(parseFloat(r.rain_mm.toFixed(1)));
          if (r.rain_mm >= 1.0) rainDays++;
        }
        if (typeof r.date === "string") {
          validDates.push(r.date);
          const [y, m, d] = r.date.split("-").map((p) => parseInt(p, 10));
          const monthsEn = [
            "", "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
          ];
          if (m && monthsEn[m]) {
            validDates.push(`${d} ${monthsEn[m]}`);
            validDates.push(`${d}th ${monthsEn[m]}`);
            validDates.push(`${d}st ${monthsEn[m]}`);
            validDates.push(`${d}nd ${monthsEn[m]}`);
            validDates.push(`${d}rd ${monthsEn[m]}`);
          }
        }
      }
      daysNumbers.add(rainDays);
      allowedNumbers.add(rainDays);

      const dryDays = recentRain.records.length - rainDays;
      daysNumbers.add(dryDays);
      allowedNumbers.add(dryDays);
    }

    if (recentRain.startDate) {
      validDates.push(recentRain.startDate);
    }
    if (recentRain.endDate) {
      validDates.push(recentRain.endDate);
    }
  }

  if (asOf) {
    validDates.push(asOf);
    const [y, m, d] = asOf.split("-").map((p) => parseInt(p, 10));
    const monthsEn = [
      "", "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];
    if (m && monthsEn[m]) {
      validDates.push(`${d} ${monthsEn[m]}`);
      validDates.push(`${d}th ${monthsEn[m]}`);
      validDates.push(`${d}st ${monthsEn[m]}`);
      validDates.push(`${d}nd ${monthsEn[m]}`);
      validDates.push(`${d}rd ${monthsEn[m]}`);
    }
  }

  if (Array.isArray(recalledMemories)) {
    for (const mem of recalledMemories) {
      if (typeof mem !== "string") continue;
      if (!isProfileOrFactMemory(mem)) continue;
      const matches = mem.match(/\b\d+(?:\.\d+)?\b/g) || [];
      for (const m of matches) {
        const n = parseFloat(m);
        if (Number.isFinite(n)) {
          memoryNumbers.add(n);
          memoryNumbers.add(Math.round(n));
          memoryNumbers.add(parseFloat(n.toFixed(1)));
          allowedNumbers.add(n);
          allowedNumbers.add(Math.round(n));
          allowedNumbers.add(parseFloat(n.toFixed(1)));
        }
      }
    }
  }

  return {
    allowedNumbers,
    rainMmNumbers,
    daysNumbers,
    haNumbers,
    memoryNumbers,
    validDates,
  };
}

/**
 * Validates agronomy guidance for:
 * 1. Prohibited chemical brand names or active ingredients.
 * 2. Prohibited specific chemical dose patterns (e.g. ml/L, g per litre, l/ha, kg/ha, bags/ha, knapsack).
 * 3. Unit-aware numbers check:
 *    - mm matches context rainfall
 *    - days matches daysCount, rainDays, or dryDays
 *    - ha matches farm hectares
 *    - prohibited units (cm, cobs, plants, m, %) are rejected
 *    - bare numbers must match context values
 */
export function validateAgronomyGuidance(
  text: string,
  context: AgronomyValidationContext | Set<number>,
  lang?: Lang,
  topic?: string
): { valid: boolean; reason?: string } {
  const cv = validateNoCurrencyOrTokens(text);
  if (!cv.valid) return cv;

  if (topic) {
    const tr = validateTopicSpecificRestrictions(text, topic);
    if (!tr.valid) return tr;
  }
  const ctx: AgronomyValidationContext =
    context instanceof Set
      ? {
          allowedNumbers: context,
          rainMmNumbers: context,
          daysNumbers: context,
          haNumbers: context,
          memoryNumbers: context,
          validDates: [],
        }
      : context;

  // 1. Specific chemical dosage patterns (ml/L, g/L, l/ha, kg/ha, bags/ha, per knapsack, etc.)
  const dosePattern =
    /\b\d+(?:\.\d+)?\s*(?:ml\/l|ml\/litre|ml\s+per\s+l(?:itre)?|g\/l|g\/litre|g\s+per\s+l(?:itre)?|l\/ha|litres?\/ha|litres?\s+per\s+(?:ha|hectares?)|kg\/ha|kg\s+per\s+(?:ha|hectares?)|bags?\s+per\s+(?:ha|hectares?)|bags?\s*\/\s*(?:ha|hectares?)|ml\s+per\s+20l|per\s+knapsack|knapsack\s+sprayer)\b/i;
  const doseMatch = text.match(dosePattern);
  if (doseMatch) {
    return {
      valid: false,
      reason: `Prohibited specific chemical dosage pattern detected: "${doseMatch[0]}". Must advise ADP officer instead.`,
    };
  }

  // 2. Specific chemical brand names or active ingredients
  const chemicalBrands =
    /\b(?:chlorpyrifos|ddvp|sniper|cypermethrin|glyphosate|paraquat|atrazine|mancozeb|carbofuran|deltamethrin|lambda-cyhalothrin)\b/i;
  const chemMatch = text.match(chemicalBrands);
  if (chemMatch) {
    return {
      valid: false,
      reason: `Prohibited chemical product name detected: "${chemMatch[0]}". Must advise ADP officer instead.`,
    };
  }

  // 3. Mask valid whole dates from context
  let workingText = text;
  for (const vd of ctx.validDates) {
    if (!vd) continue;
    const escaped = vd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const dateRegex = new RegExp(`\\b${escaped}\\b`, "gi");
    workingText = workingText.replace(dateRegex, " __VALID_DATE__ ");
  }

  // 4. Unit-aware check:
  // Detect single numbers or ranges (e.g. 2-3 cobs, 5-10 days, top 5cm) followed by a unit
  const unitRegex =
    /\b(\d+(?:\.\d+)?)(?:\s*(?:-|to|sí)\s*(\d+(?:\.\d+)?))?\s*(cm|mm|m|kg|g|l|ml|%|days?|weeks?|bags?|cobs?|plants?|ha|hectares?|ọjọ́|ọ̀sẹ̀|àpò)\b/gi;

  let unitMatch: RegExpExecArray | null;
  while ((unitMatch = unitRegex.exec(workingText)) !== null) {
    const rawMatch = unitMatch[0];
    const n1 = parseFloat(unitMatch[1]);
    const n2 = unitMatch[2] ? parseFloat(unitMatch[2]) : undefined;
    const unit = unitMatch[3].toLowerCase();

    // Check if unit is prohibited or never in context
    if (["cm", "m", "%"].includes(unit) || unit.startsWith("cob") || unit.startsWith("plant")) {
      return {
        valid: false,
        reason: `Ungrounded measurement or count detected: "${rawMatch}". Describe checks qualitatively (e.g. 'a few cobs from different parts of the field', 'the topsoil') without inventing counts or measurements.`,
      };
    }

    const checkNum = (n: number, set: Set<number>): boolean => {
      return set.has(n) || set.has(Math.round(n)) || set.has(parseFloat(n.toFixed(1)));
    };

    if (unit === "mm") {
      if (!checkNum(n1, ctx.rainMmNumbers) || (n2 !== undefined && !checkNum(n2, ctx.rainMmNumbers))) {
        return {
          valid: false,
          reason: `Ungrounded rainfall measurement "${rawMatch}" does not match recorded context rainfall.`,
        };
      }
    } else if (unit.startsWith("day") || unit === "ọjọ́") {
      if (!checkNum(n1, ctx.daysNumbers) || (n2 !== undefined && !checkNum(n2, ctx.daysNumbers))) {
        return {
          valid: false,
          reason: `Ungrounded day count "${rawMatch}" does not match context.`,
        };
      }
    } else if (unit.startsWith("ha") || unit.startsWith("hectare")) {
      if (!checkNum(n1, ctx.haNumbers) || (n2 !== undefined && !checkNum(n2, ctx.haNumbers))) {
        return {
          valid: false,
          reason: `Ungrounded land measurement "${rawMatch}" does not match farm hectares.`,
        };
      }
    } else if (unit.startsWith("bag") || unit === "àpò") {
      if (!checkNum(n1, ctx.memoryNumbers) || (n2 !== undefined && !checkNum(n2, ctx.memoryNumbers))) {
        return {
          valid: false,
          reason: `Ungrounded number: bag count "${rawMatch}" does not match farm memory context.`,
        };
      }
    } else if (unit.startsWith("week") || unit === "ọ̀sẹ̀") {
      const weeksAllowed = new Set<number>();
      for (const d of ctx.daysNumbers) {
        if (d % 7 === 0) weeksAllowed.add(d / 7);
      }
      for (const m of ctx.memoryNumbers) weeksAllowed.add(m);
      if (!checkNum(n1, weeksAllowed) || (n2 !== undefined && !checkNum(n2, weeksAllowed))) {
        return {
          valid: false,
          reason: `Ungrounded week count "${rawMatch}" does not match context.`,
        };
      }
    } else if (["kg", "g", "l", "ml"].includes(unit)) {
      if (!checkNum(n1, ctx.memoryNumbers) || (n2 !== undefined && !checkNum(n2, ctx.memoryNumbers))) {
        return {
          valid: false,
          reason: `Ungrounded measurement "${rawMatch}" not found in context.`,
        };
      }
    }
  }

  // Mask all unit matches from workingText
  workingText = workingText.replace(unitRegex, " __UNIT__ ");

  // 5. Bare numbers check
  const numMatches = workingText.match(/\b\d+(?:\.\d+)?\b/g) || [];
  for (const raw of numMatches) {
    const num = parseFloat(raw);
    if (!Number.isFinite(num)) continue;

    const allowed =
      ctx.allowedNumbers.has(num) ||
      ctx.allowedNumbers.has(Math.round(num)) ||
      ctx.allowedNumbers.has(parseFloat(num.toFixed(1)));

    if (!allowed) {
      return {
        valid: false,
        reason: `Ungrounded bare number "${raw}" found in agronomy guidance. Numbers must come strictly from context.`,
      };
    }
  }

  return { valid: true };
}

function loadAgronomyPrompt(): string {
  const p = path.resolve(process.cwd(), "prompts", "agronomy.md");
  if (fs.existsSync(p)) {
    return fs.readFileSync(p, "utf8");
  }
  return "You are Ikore AI maize agronomy advisory assistant. Max 80 words, no ungrounded numbers, no chemical brands or doses.";
}


/**
 * Validator rule: reject self-referential / meta lines ("not my role", "I only advise", "as an AI")
 * in English, Pidgin, and Yoruba.
 */
/**
 * Validator rule: reject currency and internal snake_case tokens in every guidance topic.
 */
export function validateNoCurrencyOrTokens(text: string): { valid: boolean; reason?: string } {
  // Reject currency: ₦, naira, NGN, kobo (case-insensitive)
  const currencyPattern = /(?:[₦]|(?:\b(?:naira|ngn|kobo)\b))/i;
  const currMatch = text.match(currencyPattern);
  if (currMatch) {
    return {
      valid: false,
      reason: `grounding_failed: currency found ("${currMatch[0]}")`,
    };
  }

  // Reject internal snake_case tokens (e.g. store_4w, store_8w, sell_now, wait_7, plant_now, etc.)
  const tokenPattern = /\b[a-z0-9]+_[a-z0-9]+(?:_[a-z0-9]+)*\b/i;
  const tokenMatch = text.match(tokenPattern);
  if (tokenMatch) {
    return {
      valid: false,
      reason: `grounding_failed: internal snake_case token found ("${tokenMatch[0]}")`,
    };
  }

  return { valid: true };
}

/**
 * Topic specific restrictions validator:
 * Reject bag counts and market or selling terms for topics where they don't belong (watering, planting, weeding, pests).
 * Storage and harvest may mention bags (including PICS or hermetic bags), but never prices.
 */
export function validateTopicSpecificRestrictions(text: string, topic?: string): { valid: boolean; reason?: string } {
  const normTopic = (topic || "").toLowerCase();
  const allowsBags = normTopic === "storage" || normTopic === "harvest";

  if (!allowsBags) {
    // Reject bag counts and bag words in topics like watering, planting, weeding, pests
    const bagPattern = /(?:\b\d+\s*(?:bags?|àpò|apo)\b)|(?:\b(?:àpò|apo)\s*\d+\b)|(?:^|[^\p{L}\p{N}])(?:bags?|àpò|apo)(?:[^\p{L}\p{N}]|$)/iu;
    const bagMatch = text.match(bagPattern);
    if (bagMatch) {
      return {
        valid: false,
        reason: `grounding_failed: bag count or bag reference found in ${topic || "general"} guidance ("${bagMatch[0]}")`,
      };
    }
  }

  // Market or selling terms: not allowed in watering, planting, weeding, pests, fertilizer, etc.
  const marketSellingPattern = /(?:\b(?:sell|selling|buyer|offered|offer|sale\s+price|market\s+price|ọjà|títà|tita|oníbàárà|onibaara)\b)/i;
  const marketMatch = text.match(marketSellingPattern);
  if (marketMatch) {
    return {
      valid: false,
      reason: `grounding_failed: market or selling term found in ${topic || "guidance"} ("${marketMatch[0]}")`,
    };
  }

  // Watering specific cross-topic leaks
  if (normTopic === "watering") {
    if (/\b(?:storage|store|storing|sack|tọ́jú|toju|fertilizer|npk|urea|pesticide|ajílẹ̀|ajile|weed|weeding|koríko|koriko)\b/i.test(text)) {
      return {
        valid: false,
        reason: "grounding_failed: cross-topic content in watering guidance",
      };
    }
  }

  return { valid: true };
}

export function validateNoMetaTalk(text: string): { valid: boolean; reason?: string } {
  const metaPattern =
    /(?:\b(?:not\s+my\s+role|only\s+advise\s+on|i\s+only\s+advise|as\s+an\s+ai|as\s+a\s+language\s+model|my\s+role\s+is|outside\s+my\s+scope|not\s+within\s+my\s+scope|not\s+my\s+job|i\s+am\s+an\s+ai|no\s+be\s+my\s+role|no\s+be\s+my\s+work|no\s+be\s+me\s+go\s+tell\s+you)\b|kì\s+í\s+ṣe\s+ojúṣe\s+mi|ki\s+i\s+se\s+ojuse\s+mi|ojúṣe\s+mi\s+ni|ojuse\s+mi\s+ni|gẹ́gẹ́\s+bí\s+ai|gege\s+bi\s+ai|mo\s+wulẹ̀\s+ń\s+gbani\s+nímọ̀ràn|mo\s+wule\s+n\s+gbani\s+nimoran|n\s+kì\s+í\s+ṣe|n\s+ki\s+i\s+se)/iu;
  const m = text.match(metaPattern);
  if (m) {
    return {
      valid: false,
      reason: `meta_talk_in_guidance ("${m[0]}")`,
    };
  }
  return { valid: true };
}

/**
 * Validator rule: reject planting-timing phrases in agronomy guidance.
 * Timing belongs to the data-checked decision part only.
 */
export function validateNoTimingClaims(text: string): { valid: boolean; reason?: string } {
  const timingPattern = /(?:\b(?:plant\s+now|time\s+to\s+plant|start\s+planting|planting\s+time|planting\s+timing|worry\s+about\s+planting|comment\s+on\s+planting|regarding\s+planting|this\s+week|next\s+week|wait\s+(?:a|one|two|\d+)\s+weeks?|plant\s+around|shuka\s+yanzu|lokacin\s+shuka|january|february|march|april|may|june|july|august|september|october|november|december)\b|gbìn\s+báyìí|gbin\s+bayii|ìgbà\s+gbígbìn|igba\s+gbigbin|bẹ̀rẹ̀\s+gbígbìn|bere\s+gbigbin|ọ̀sẹ̀\s+yìí|ose\s+yii|ẹrẹ̀nà|èrèlé|ìgbé|òbíbí|òkúdu|agẹmọ|ògún|ọ̀wẹ́wẹ̀|ọ̀wàrà|bélú|ọ̀pẹ́)/iu;
  const m = text.match(timingPattern);
  if (m) {
    return {
      valid: false,
      reason: `timing_claim_in_guidance ("${m[0]}")`,
    };
  }
  return { valid: true };
}

/**
 * Topic relevance validator:
 * The guidance must match the requested agronomy topic and avoid cross-topic leaks.
 */
export function validateAgronomyTopic(text: string, topic?: string): { valid: boolean; reason?: string } {
  if (!topic) return { valid: true };
  const lower = text.toLowerCase();

  if (topic === "watering") {
    // A watering reply must not talk about storage bags/sacks, market prices, or chemical fertilizer
    if (/\b(?:storage|store|storing|bags?\s+for\s+\d+|\b45k\b|\bàpò\b.*\btọ́jú\b|market\s+prices?|price\s+go\s+up|sack)\b/i.test(lower)) {
      return {
        valid: false,
        reason: "cross_topic_leak: watering guidance mentions storage/market prices",
      };
    }
  }

  return { valid: true };
}

/**
 * Language validator across en, pcm, and yo:
 * Ensures yo is real Yoruba (with tone marks) without English or Pidgin words.
 * Ensures pcm does not contain formal English constructs.
 */
export function validateAgronomyLanguage(text: string, lang: Lang): { valid: boolean; reason?: string } {
  if (lang === "yo") {
    // 1. Check for English words leaking into Yoruba
    const englishLeak =
      /\b(?:finger|deep|topsoil|soil|water|watering|plant|planting|plants|morning|evening|check|checking|dry|wet|root|base|leaf|leaves|field|maize|corn|when|how|what|and|the|is|in|on|at|to|for|with|of|by|from|about|early|late|spoil|damage|fertilizer|officer|extension|agent|farmer|crop|yield|soggy|stop|flood|flooding|consult|tips|area|best|storage|grains|regular|sell|price|dey|na|wey|dem|make\s+you)\b/i;
    const m = text.match(englishLeak);
    if (m) {
      return {
        valid: false,
        reason: `language_quality: English or Pidgin word detected ("${m[0]}")`,
      };
    }

    // 2. Check for repetitive looping phrases (e.g. model loop)
    if (/(?:\b(.{2,20})\b)(?:\s+\1){2,}/iu.test(text)) {
      return {
        valid: false,
        reason: "language_quality: repetitive looping phrase detected",
      };
    }

    // 3. Minimum Yoruba tone mark & diacritic density
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length < 5) {
      return {
        valid: false,
        reason: "language_quality: guidance text too short",
      };
    }
    const yorubaWords = words.filter((w) => /[áàéèíìóòúùẹ́ẹ̀ọ́ọ̀ṣẸỌṢ\u0300\u0301\u0323]/i.test(w));
    const yorubaRatio = yorubaWords.length / words.length;
    if (yorubaRatio < 0.4) {
      return {
        valid: false,
        reason: `language_quality: insufficient Yoruba tone marks/diacritics (${(yorubaRatio * 100).toFixed(0)}% < 40%)`,
      };
    }

    const yoVal = validateYoruba(text);
    if (!yoVal.valid) {
      return {
        valid: false,
        reason: `language_quality: ${yoVal.reason}`,
      };
    }
  } else if (lang === "pcm") {
    const formalEnglish = /\b(?:furthermore|consequently|consult\s+your\s+local|physiological\s+maturity|threshold|establishment|adhere\s+to)\b/i;
    const m = text.match(formalEnglish);
    if (m) {
      return {
        valid: false,
        reason: `Pidgin guidance contains overly formal English phrasing ("${m[0]}")`,
      };
    }
  }

  return { valid: true };
}

export interface ExplainAgronomyParams {
  question: string;
  farm: FarmProfile;
  lang: Lang;
  asOf: string;
  topic?: string;
  recentRain?: LoadedRecentRain | null;
  recalledMemories?: string[];
  provider?: LLMProvider;
  runId?: string;
  isCompound?: boolean;
}

export interface AgronomyExplainResult {
  text: string;
  followUp: string | null;
  path: "model" | "template";
  model: string;
  fallbackReason?: string;
  latencyMs?: number;
  requestedModel?: string;
  respondedModel?: string;
  finishReason?: string;
  completionTokens?: number;
}

/**
 * Cleans plain-text advice returned by the model:
 * - strips markdown formatting or fences
 * - extracts answer if model accidentally returned JSON
 * - strips enclosing quotes
 */
export function cleanPlainTextAdvice(raw: string): string {
  let text = (raw || "").trim();
  // Strip thinking / reasoning tags and blocks
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  text = text.replace(/<thought>[\s\S]*?<\/thought>/gi, "").trim();
  text = text.replace(/^(?:Thinking Process|Reasoning):[\s\S]*?(?:\n\n|\r\n\r\n)/i, "").trim();

  // Strip markdown code blocks
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  // If model returned JSON despite instructions, extract answer
  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed.answer === "string") {
        text = parsed.answer.trim();
      }
    } catch {}
  }
  // Strip enclosing quotes
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

/**
 * Trims advice to maximum word count while respecting sentence boundaries.
 */
export function trimAdviceToLength(text: string, maxWords = 80): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();

  // Split into sentences (by . ! ? followed by whitespace or end of string)
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [text];
  let accumulated = "";
  for (const s of sentences) {
    const candidate = accumulated ? `${accumulated} ${s.trim()}` : s.trim();
    const cWords = candidate.split(/\s+/).filter(Boolean);
    if (cWords.length <= maxWords) {
      accumulated = candidate;
    } else {
      break;
    }
  }

  if (accumulated && accumulated.split(/\s+/).filter(Boolean).length >= 10) {
    return accumulated.trim();
  }

  // Fallback: take first maxWords words and clean trailing punctuation
  const trimmed = words.slice(0, maxWords).join(" ");
  return trimmed.replace(/[,;:]$/, "") + ".";
}

export async function explainAgronomy(
  params: ExplainAgronomyParams
): Promise<AgronomyExplainResult> {
  const { question, farm, lang, asOf, topic, recentRain, recalledMemories, provider, runId, isCompound } = params;
  const safeMemories = (recalledMemories || []).filter(isProfileOrFactMemory);
  const allowedNumbers = buildAllowedAgronomyNumbers(farm, recentRain, asOf, safeMemories);
  const config = getNightshiftConfig();
  const isSample = config.sampleMode;
  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

  // Build context summary for prompt
  const rainRecordsSummary =
    recentRain && recentRain.records && recentRain.records.length > 0
      ? `Daily rain past ${recentRain.records.length} days: ${recentRain.records
          .map((r) => `${r.date.slice(5)}: ${r.rain_mm}mm`)
          .join(", ")}`
      : "";

  const rainContext = recentRain
    ? `Recent rainfall recorded at ${farm.ownerName} (${farm.lga}, ${farm.state}) from ${recentRain.startDate} to ${recentRain.endDate}: ${recentRain.totalRainMm.toFixed(1)} mm across ${recentRain.daysCount} days (${recentRain.records.filter((r) => r.rain_mm >= 1.0).length} rain days). ${rainRecordsSummary}`
    : "No recent rainfall data queried.";

  const memoryContext =
    safeMemories.length > 0
      ? `Recalled farm context: ${safeMemories.slice(0, 3).join(" ")}`
      : "";

  const compoundDirective = isCompound
    ? `\nCRITICAL COMPOUND QUERY RULE:\nThe farmer's planting date decision has already been answered separately in part 1 of this reply.\nDo NOT mention, advise on, or comment on planting dates, when to plant, planting timing, or waiting.\nFocus EXCLUSIVELY and DIRECTLY on ${topic || "agronomy guidance"}.\n`
    : "";

  const promptContext = `
Farmer Location: ${farm.lga}, ${farm.state}
Farm Size: ${farm.hectares} ha
Zone: ${farm.zone || "derived_savanna"}
Current Date (asOf): ${asOf}
${rainContext}
${memoryContext}
${compoundDirective}
Farmer Question: "${question}"
`;

  // Sample mode or test mode without provider: return deterministic grounded response
  if (isSample || (isTest && !provider)) {
    let sampleAnswer = "";
    if (recentRain) {
      if (lang === "yo") {
        sampleAnswer = `Láàrín ${recentRain.startDate} àti ${recentRain.endDate}, oko rẹ ní ${recentRain.totalRainMm.toFixed(1)} mm òjò. Pẹ̀lú omi yìí, ilẹ̀ wà ní ipò tó dára. Kàn sí alábòójútó ADP fún ìtọ́sọ́nà tó kún rẹ́rẹ́.`;
      } else if (lang === "pcm") {
        sampleAnswer = `Between ${recentRain.startDate} and ${recentRain.endDate}, your farm get ${recentRain.totalRainMm.toFixed(1)} mm rain. The ground hold small moisture. Make you see ADP extension officer for proper guidance.`;
      } else {
        sampleAnswer = `Between ${recentRain.startDate} and ${recentRain.endDate}, your farm recorded ${recentRain.totalRainMm.toFixed(1)} mm of rain across ${recentRain.daysCount} days. Soil moisture is moderate. Consult your local ADP extension officer for field management advice.`;
      }
    } else if (/\b(?:fertiliz|aj[ií]l[eẹ̀é]|taki)\b/iu.test(question)) {
      if (lang === "yo") {
        sampleAnswer = "Lo ajílẹ̀ àkọ́kọ́ nígbà tí àgbàdo bá hù, kí o sì lo èkejì nígbà tí ó bá dé orúnkún. Kàn sí alábòójútó ADP fún irú ajílẹ̀ tó bá ilẹ̀ rẹ mu.";
      } else if (lang === "pcm") {
        sampleAnswer = "Apply first fertilizer when corn sprout, then top dress when e reach knee level. Ask your local ADP extension officer for correct fertilizer type.";
      } else {
        sampleAnswer = "Apply basal fertilizer at seedling emergence and top-dress when maize reaches knee height. Consult your local ADP extension officer for soil-appropriate formulations and application timing.";
      }
    } else if (/\b(?:pest|armyworm|k[oòó]k[oòó]r[oòó]|kwari)\b/iu.test(question)) {
      if (lang === "yo") {
        sampleAnswer = "Ṣàyẹ̀wò oko àgbàdo rẹ ní kùtùkùtù òwúrọ̀ fún kòkòrò armyworm. Kàn sí alábòójútó ADP fún àwọn ọ̀nà ààbò tó yẹ láti gbé láìlo egbòogi eléwu.";
      } else if (lang === "pcm") {
        sampleAnswer = "Check your maize leaves early morning for armyworm larvae. Go meet your local ADP extension officer to know safe approved pest control.";
      } else {
        sampleAnswer = "Scout maize whorls early in the morning for fall armyworm feeding signs. Consult your local ADP extension officer or registered agro-dealer for safe, approved pest control options.";
      }
    } else {
      sampleAnswer = templateAgronomyFallback(topic, lang);
    }

    if (runId) {
      logLLMCall({
        timestamp: new Date().toISOString(),
        runId,
        step: "agronomy",
        provider: "sample",
        requestedModel: "none",
        respondedModel: "none",
        latencyMs: 1,
        status: "ok",
        fallbackUsed: false,
      });
    }

    return {
      text: sampleAnswer,
      followUp: null,
      path: "model",
      model: "nemotron-3.5-30b (sample)",
    };
  }

  const activeProvider = provider || new NightshiftProvider();
  const systemPrompt = loadAgronomyPrompt().replace("{LANG}", lang);

  const callLLM = async (
    msgs: Array<{ role: "system" | "user" | "assistant"; content: string }>
  ): Promise<{
    text: string;
    rawText: string;
    model: string;
    latencyMs: number;
    finishReason?: string;
    completionTokens?: number;
    error?: string;
  }> => {
    const tStart = performance.now();
    try {
      if (
        "completeWithMeta" in activeProvider &&
        typeof (activeProvider as any).completeWithMeta === "function"
      ) {
        const meta = await (activeProvider as any).completeWithMeta({
          system: systemPrompt,
          messages: msgs,
          temperature: 0.2,
          stepName: "agronomy",
          runId,
          maxTokens: 300,
        });
        const rawContent = typeof meta.content === "string" ? meta.content : meta.rawText || "";
        const cleaned = trimAdviceToLength(cleanPlainTextAdvice(rawContent), 80);
        return {
          text: cleaned,
          rawText: meta.rawText || rawContent,
          model: meta.model || config.model,
          latencyMs: meta.latencyMs || Math.round(performance.now() - tStart),
          finishReason: meta.finishReason,
          completionTokens: meta.completionTokens,
        };
      } else {
        const res = await activeProvider.complete({
          system: systemPrompt,
          messages: msgs,
          temperature: 0.2,
          stepName: "agronomy",
          runId,
          maxTokens: 300,
        });
        const rawContent = typeof res === "string" ? res : JSON.stringify(res);
        const cleaned = trimAdviceToLength(cleanPlainTextAdvice(rawContent), 80);
        return {
          text: cleaned,
          rawText: rawContent,
          model: (activeProvider as any).lastRespondedModel || config.model,
          latencyMs: Math.round(performance.now() - tStart),
          finishReason: (activeProvider as any).lastFinishReason,
          completionTokens: (activeProvider as any).lastCompletionTokens,
        };
      }
    } catch (err: any) {
      return {
        text: "",
        rawText: "",
        model: config.model,
        latencyMs: Math.round(performance.now() - tStart),
        error: err?.message || "LLM completion error",
      };
    }
  };

  const validateCandidate = (t: string, finishReason?: string): { valid: boolean; reason?: string } => {
    if (finishReason === "length") {
      return {
        valid: false,
        reason: "Model completion was truncated (finish_reason=length)",
      };
    }
    if (!t || t.trim().length === 0) {
      return { valid: false, reason: "Empty response from model" };
    }
    const words = t.trim().split(/\s+/).filter(Boolean);
    if (words.length > 90) {
      return { valid: false, reason: `Response too long (${words.length} words, max 80 allowed)` };
    }

    // 0. Currency and internal tokens
    const cv = validateNoCurrencyOrTokens(t);
    if (!cv.valid) return cv;

    // 1. Topic specific restrictions (bag counts, market/selling terms)
    const topRestr = validateTopicSpecificRestrictions(t, topic);
    if (!topRestr.valid) return topRestr;

    // 2. No meta talk / self-referential lines
    const mv = validateNoMetaTalk(t);
    if (!mv.valid) return mv;

    // 3. No planting timing claims in guidance
    const tv = validateNoTimingClaims(t);
    if (!tv.valid) return tv;

    // 2. Topic check
    const topV = validateAgronomyTopic(t, topic);
    if (!topV.valid) return topV;

    // 3. Language check
    const lv = validateAgronomyLanguage(t, lang);
    if (!lv.valid) return lv;

    // 4. Grounding and dosage checks
    const gv = validateAgronomyGuidance(t, allowedNumbers, lang, topic);
    if (!gv.valid) return gv;

    return { valid: true };
  };

  try {
    // Attempt 1
    const msgs1: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "user", content: promptContext },
    ];
    const attempt1 = await callLLM(msgs1);
    let totalLatency = attempt1.latencyMs;
    let respondedModel = attempt1.model;

    const val1 = validateCandidate(attempt1.text, attempt1.finishReason);
    if (val1.valid) {
      return {
        text: attempt1.text,
        followUp: null,
        path: "model",
        model: respondedModel,
        latencyMs: totalLatency,
        requestedModel: config.model,
        respondedModel,
        finishReason: attempt1.finishReason,
        completionTokens: attempt1.completionTokens,
      };
    }

    const failureReason1 = attempt1.error || val1.reason || "Validation failed";

    // Cap Yoruba guidance at 1 attempt before falling back to natural template on validation failure
    // (Allow retry only when attempt1 was truncated with finish_reason === 'length')
    if (lang === "yo" && attempt1.finishReason !== "length") {
      const fbReason = failureReason1.includes("language_quality")
        ? "language_quality"
        : (failureReason1.includes("grounding_failed") ? "grounding_failed" : failureReason1);
      return {
        text: templateAgronomyFallback(topic, lang),
        followUp: null,
        path: "template",
        model: "template",
        fallbackReason: fbReason,
        latencyMs: totalLatency,
        requestedModel: config.model,
        respondedModel: "template",
        finishReason: attempt1.finishReason,
        completionTokens: attempt1.completionTokens,
      };
    }

    // Attempt 2: One retry with correction prompt
    const correctionPrompt = `Your previous response was rejected for the following reason: "${failureReason1}".
Please rewrite your response adhering strictly to these rules:
1. STRICT RULE: Output ONLY plain text (max 60 words). No JSON, no markdown formatting.
2. STRICT RULE: Remove all measurements and counts not in context; describe checks qualitatively (e.g. 'a few cobs from different parts of the field', 'the topsoil').
3. STRICT RULE: DO NOT include any specific chemical dose rates (e.g. ml/L, kg/ha, bags/ha) or chemical brand names (Sniper, DDVP, chlorpyrifos, etc.). Advise consulting the local ADP extension officer or registered agro-dealer.
4. STRICT RULE: Only use numbers if they are explicitly provided in the context (like recorded rainfall in mm or farm size in ha). Otherwise, use NO numbers or measurements at all.
Direct plain-text advice:`;

    const msgs2: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "user", content: promptContext },
      {
        role: "assistant",
        content: attempt1.rawText || attempt1.text || "",
      },
      { role: "user", content: correctionPrompt },
    ];

    const attempt2 = await callLLM(msgs2);
    totalLatency += attempt2.latencyMs;
    respondedModel = attempt2.model || respondedModel;

    const val2 = validateCandidate(attempt2.text, attempt2.finishReason);
    if (val2.valid) {
      return {
        text: attempt2.text,
        followUp: null,
        path: "model",
        model: respondedModel,
        latencyMs: totalLatency,
        requestedModel: config.model,
        respondedModel,
        finishReason: attempt2.finishReason,
        completionTokens: attempt2.completionTokens,
      };
    }

    const failureReason2 = attempt2.error || val2.reason || "Validation failed";
    const combined = `${failureReason1}; ${failureReason2}`;
    const fbReason = combined.includes("language_quality")
      ? "language_quality"
      : (combined.includes("grounding_failed")
          ? "grounding_failed"
          : `grounding_failed: Attempt 1: ${failureReason1}; Attempt 2: ${failureReason2}`);

    return {
      text: templateAgronomyFallback(topic, lang),
      followUp: null,
      path: "template",
      model: "template",
      fallbackReason: fbReason,
      latencyMs: totalLatency,
      requestedModel: config.model,
      respondedModel: "template",
      finishReason: attempt2.finishReason || attempt1.finishReason,
      completionTokens: (attempt2.completionTokens || 0) + (attempt1.completionTokens || 0),
    };
  } catch (err: any) {
    return {
      text: templateAgronomyFallback(topic, lang),
      followUp: null,
      path: "template",
      model: "template",
      fallbackReason: err.message?.includes("language_quality") ? "language_quality" : `grounding_failed: ${err.message}`,
      respondedModel: "template",
    };
  }
}
