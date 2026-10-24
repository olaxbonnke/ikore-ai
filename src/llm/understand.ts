import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
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
    "smalltalk",
    "unknown",
  ]),
  language: z.enum(["en", "pcm", "yo", "ha"]),
  slots: z.record(z.string(), z.unknown()),
  missing: z.array(z.string()),
});

export type UnderstandResult = z.infer<typeof UnderstandSchema>;

/**
 * Deterministic rule-based extractor (fast, offline, zero-network fallback).
 */
export function extractRules(text: string): UnderstandResult {
  const lower = text.toLowerCase();

  // 1. Language detection
  let language: Lang = "en";
  if (/(?<=^|\P{L})(?:gbìn|àgbàdo|ọjọ́|ìgbà|ẹni|kí n|báyìí|ṣé|ní|mo ní|bóyá|owo|fún|kọ̀ọ̀kan|dúró|díẹ̀|tà|tọ́jú|àpò|fẹ́|rà)(?=\P{L}|$)/iu.test(lower)) {
    language = "yo";
  } else if (/(?<=^|\P{L})(?:don|make|dey|wetin|na|fit|abeg|corn|keep am|i get|how much)(?=\P{L}|$)/iu.test(lower)) {
    language = "pcm";
  } else if (/(?<=^|\P{L})(?:yaushe|ina|shuka|masara|buhu|jira|sayar|ajiye)(?=\P{L}|$)/iu.test(lower)) {
    language = "ha";
  }

  // 2. Intent detection
  let intent: UnderstandResult["intent"] = "unknown";
  if (/(?<=^|\P{L})(?:why|wetin make|kilode|me ya sa)(?=\P{L}|$)/iu.test(lower)) {
    intent = "why";
  } else if (/(?<=^|\P{L})(?:brief|morning|update|report)(?=\P{L}|$)/iu.test(lower)) {
    intent = "briefing";
  } else if (/(?<=^|\P{L})(?:sell|store|price|market|bag|harvest|keep|corn|tà|tọ́jú|sayar|ajiye|àpò|rà)(?=\P{L}|$)/iu.test(lower)) {
    intent = "sell_or_store";
  } else if (/(?<=^|\P{L})(?:plant|sow|seed|ground|start|planting|when|gbìn|shuka|ìgbà)(?=\P{L}|$)/iu.test(lower)) {
    intent = "plant_timing";
  } else if (/(?<=^|\P{L})(?:hi|hello|good morning|kedu|bawo)(?=\P{L}|$)/iu.test(lower)) {
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
    return extractRules(text);
  }

  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

  // In test mode without an explicit provider, use fast rules
  if (isTest && !provider) {
    return extractRules(text);
  }

  const activeProvider = provider || new NightshiftProvider();

  try {
    const system = loadUnderstandPrompt();
    const result = await activeProvider.complete<UnderstandResult>({
      system,
      messages: [{ role: "user", content: text }],
      json: UnderstandSchema,
      temperature: 0.1,
      stepName: "understand",
    });

    // Mirror slot alias for backward compatibility (pricePerBagNgn <-> pricePerBag)
    if (result.slots.pricePerBagNgn && !result.slots.pricePerBag) {
      result.slots.pricePerBag = result.slots.pricePerBagNgn;
    } else if (result.slots.pricePerBag && !result.slots.pricePerBagNgn) {
      result.slots.pricePerBagNgn = result.slots.pricePerBag;
    }

    return result;
  } catch (err: any) {
    console.warn(`[Understand] LLM parse failed (${err.message}), falling back to deterministic extraction.`);
    return extractRules(text);
  }
}
