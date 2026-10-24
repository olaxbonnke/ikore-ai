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
 * Detects questions outside the agent's supported capabilities:
 * - Harvest timing / harvesting
 * - Fertilizer, chemicals, manure
 * - Pests, insects, weeds, spraying, disease
 * - Other non-maize crops (cassava, yam, rice, etc.)
 */
export function isOutOfScopeQuery(text: string): boolean {
  if (!text) return false;
  const nfc = text.normalize("NFC").toLowerCase();
  const stripped = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

  // If the query is explicitly asking to sell or store (e.g. "after harvest should I sell or store?"),
  // it is in-scope for sell_or_store.
  const hasSellOrStore =
    /\b(?:sell|store|selling|storage|market|price|t[aàá]|t[oọ̀ó]j[uú]|sayar|ajiye|per\s+bag|buhu|àpò)\b/iu.test(nfc);

  // 1. Harvest timing / operations (when not a sell/store decision)
  if (!hasSellOrStore) {
    if (
      /\b(?:harvest|harvesting|k[oóọ̀]r[eéè]|ikore|ìkórè|girbi|girbe)\b/iu.test(nfc) ||
      /\b(?:harvest|harvesting|kore|ikore|girbi|girbe)\b/iu.test(stripped)
    ) {
      return true;
    }
  }

  // 2. Fertilizers & soil chemicals
  if (
    /\b(?:fertiliz(?:er)?|fertiliser|urea|npk|manure|aj[ií]l[eẹ̀é]|taki)\b/iu.test(nfc) ||
    /\b(?:fertiliz(?:er)?|fertiliser|urea|npk|manure|ajile|taki)\b/iu.test(stripped)
  ) {
    return true;
  }

  // 3. Pests, insects, weeds, diseases, spraying
  if (
    /\b(?:pests?|armyworms?|stem\s*borers?|caterpillars?|insects?|weeds?|weeding|fungicides?|herbicides?|pesticides?|k[oòó]k[oòó]r[oòó]|kwari)\b/iu.test(nfc) ||
    /\b(?:pests?|armyworms?|stem\s*borers?|caterpillars?|insects?|weeds?|weeding|fungicides?|herbicides?|pesticides?|kokoro|kwari)\b/iu.test(stripped)
  ) {
    return true;
  }

  // 4. Other non-maize crops (cassava, yam, rice, cowpea, cocoa, etc.)
  if (
    /\b(?:cassava|yams?|rice|sorghum|millet|cowpeas?|cocoa|soybeans?|tomatoes?|peppers?|gb[aá]g[uú]d[aá]|gbaguda|[eẹ́ẹ̀]g[eẹ́ẹ̀]|ege|[ií]s[uú]|isu|[ií]r[eẹ́ẹ̀]s[ií]|iresi|rogo|doya|shinkafa|wake)\b/iu.test(nfc) ||
    /\b(?:cassava|yams?|rice|sorghum|millet|cowpeas?|cocoa|soybeans?|tomatoes?|peppers?|gbaguda|ege|isu|iresi|rogo|doya|shinkafa|wake)\b/iu.test(stripped)
  ) {
    return true;
  }

  return false;
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
    /(?<=^|\P{L})(?:gbìn|àgbàdo|ọjọ́|ìgbà|ẹni|kí n|báyìí|ṣé|ní|mo ní|bóyá|owo|fún|kọ̀ọ̀kan|dúró|díẹ̀|tà|tọ́jú|àpò|fẹ́|rà|rántí|ranti|ìmọ̀ràn|imoran|kí lo|kí ni|sọ fún|ṣé o|nípa|màá)(?=\P{L}|$)/iu.test(nfc) ||
    /(?<=^|\P{L})(?:gbin|agbado|ojo|igba|eni|ki n|bayii|se|mo ni|boya|owo|fun|kookan|duro|die|ta|toju|apo|fe|ra|ranti|imoran|ki lo|ki ni|so fun|se o|nipa|maa)(?=\P{L}|$)/iu.test(stripped)
  ) {
    language = "yo";
  } else if (
    /(?<=^|\P{L})(?:don|make|dey|wetin|na|fit|abeg|corn|keep am|i get|how much|talk|bin talk)(?=\P{L}|$)/iu.test(nfc)
  ) {
    language = "pcm";
  } else if (
    /(?<=^|\P{L})(?:yaushe|ina|shuka|masara|buhu|jira|sayar|ajiye|tuna)(?=\P{L}|$)/iu.test(nfc)
  ) {
    language = "ha";
  }

  // 2. Intent detection
  let intent: UnderstandResult["intent"] = "unknown";
  if (isRecallQuery(text)) {
    intent = "recall_previous";
  } else if (isOutOfScopeQuery(text)) {
    intent = "out_of_scope";
  } else if (
    /(?<=^|\P{L})(?:why|wetin make|kilode|kílódé|me ya sa)(?=\P{L}|$)/iu.test(nfc) ||
    /(?<=^|\P{L})(?:why|wetin make|kilode|me ya sa)(?=\P{L}|$)/iu.test(stripped)
  ) {
    intent = "why";
  } else if (/(?<=^|\P{L})(?:brief|morning|update|report)(?=\P{L}|$)/iu.test(nfc)) {
    intent = "briefing";
  } else if (
    /(?<=^|\P{L})(?:sell|store|price|market|bag|keep|tà|tọ́jú|sayar|ajiye|àpò|rà)(?=\P{L}|$)/iu.test(nfc) ||
    /(?<=^|\P{L})(?:sell|store|price|market|bag|keep|ta|toju|sayar|ajiye|apo|ra)(?=\P{L}|$)/iu.test(stripped)
  ) {
    intent = "sell_or_store";
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

  // 3. Slot extraction
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

  // Detect out-of-scope queries (harvest, fertilizer, pests, other crops) early
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
