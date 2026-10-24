import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import type { AgentReply, Decision, Lang } from "../core/types.ts";
import { formatGroundedDate } from "../i18n/glossary.ts";
import { templatePlanting, templateSelling } from "../i18n/templates.ts";
import { NvidiaProvider } from "./nvidia.ts";
import type { LLMProvider } from "./provider.ts";

export const ExplainOutputSchema = z.object({
  headline: z.string(),
  reason: z.string(),
  details: z.array(z.string()).optional().default([]),
  followUpQuestion: z.string().nullable().optional().default(null),
});

export type ExplainOutput = z.infer<typeof ExplainOutputSchema>;

const LANG_NAMES: Record<Lang, string> = {
  en: "English",
  pcm: "Nigerian Pidgin",
  yo: "Yoruba",
  ha: "Hausa",
};

export interface ExtractedToken {
  raw: string;
  isPercentage: boolean;
  values: number[];
}

/** Word counter helper */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Splits text into sentences without breaking on decimal points (e.g. 14.1%, ₦45,000) or ellipsis */
export function splitSentences(text: string): string[] {
  // Protect ellipsis by replacing with comma
  const safe = text.replace(/\.{3,}/g, ", ");
  const sentences: string[] = [];
  const rawParts = safe.split(/(?<=[.!?])(?!\d)(?:\s+|\n+)/);
  for (const part of rawParts) {
    const trimmed = part.trim();
    if (trimmed.length > 0) {
      sentences.push(trimmed);
    }
  }
  return sentences.length > 0 ? sentences : [text.trim()];
}

/** Sentence counter helper */
export function countSentences(text: string): number {
  return splitSentences(text).length;
}

/** Finds all numeric tokens in a string (currency, %, decimals, counts) */
export function findNumericTokens(text: string): string[] {
  const tokenRegex = /(?:₦\s*)?(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:%|\s*k\b|\s*naira|\s*ngn)?/gi;
  const matches = text.match(tokenRegex) || [];
  return matches
    .map((m) => m.trim())
    .filter((m) => m.length > 0 && !/^\d+(?:st|nd|rd|th)$/i.test(m));
}

/**
 * Normalises a numeric string (e.g. "₦900,000", "45k", "14.1%", "159.2", "2026-04-17")
 * to its base numeric values and tracks whether it is a percentage.
 */
export function extractNumericToken(token: string): ExtractedToken {
  const cleaned = token.replace(/[₦,]/g, "").trim();

  // Match "45k" or "900k"
  const kMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*k$/i);
  if (kMatch) {
    return { raw: token, isPercentage: false, values: [parseFloat(kMatch[1]) * 1000] };
  }

  // Match percentage "14.1%" -> percentage number is 14.1, ratio is 0.141
  const pctMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (pctMatch) {
    const val = parseFloat(pctMatch[1]);
    return { raw: token, isPercentage: true, values: [val, val / 100] };
  }

  // Pure number
  const num = parseFloat(cleaned);
  if (Number.isFinite(num)) {
    return { raw: token, isPercentage: false, values: [num] };
  }
  return { raw: token, isPercentage: false, values: [] };
}

/**
 * Builds the set of allowed numbers and percentages from Decision.keyNumbers and Decision.chosen.
 */
export function getAllowedNumericSets(decision: Decision): {
  allowedNumbers: Set<number>;
  allowedPercentages: Set<number>;
} {
  const allowedNumbers = new Set<number>();
  const allowedPercentages = new Set<number>();

  if (decision.keyNumbers) {
    for (const [_key, val] of Object.entries(decision.keyNumbers)) {
      if (typeof val === "number" && Number.isFinite(val)) {
        allowedNumbers.add(val);
        if (val >= 1) {
          allowedNumbers.add(Math.round(val));
          allowedNumbers.add(parseFloat(val.toFixed(1)));
        }
        // If it's a probability between 0 and 1 (e.g. replantProbability: 0.007)
        if (val > 0 && val < 1) {
          const pct = parseFloat((val * 100).toFixed(1));
          allowedPercentages.add(pct);
          allowedPercentages.add(val);
        }
      } else if (typeof val === "string") {
        // String percentages e.g. "14.1%"
        const pctMatch = val.match(/^(\d+(?:\.\d+)?)\s*%$/);
        if (pctMatch) {
          const p = parseFloat(pctMatch[1]);
          allowedPercentages.add(p);
          allowedPercentages.add(parseFloat(p.toFixed(1)));
          allowedPercentages.add(p / 100);
        } else {
          // ISO date (YYYY-MM-DD)
          const dateMatch = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (dateMatch) {
            allowedNumbers.add(parseInt(dateMatch[1], 10)); // Year
            allowedNumbers.add(parseInt(dateMatch[2], 10)); // Month
            allowedNumbers.add(parseInt(dateMatch[3], 10)); // Day
          } else {
            // Check for currency or numeric string
            const num = parseFloat(val.replace(/[₦,]/g, ""));
            if (Number.isFinite(num)) {
              allowedNumbers.add(num);
              if (num >= 1) {
                allowedNumbers.add(Math.round(num));
                allowedNumbers.add(parseFloat(num.toFixed(1)));
              }
            }
            // Also extract any embedded numbers in plain strings (e.g. "about 1 in 7 seasons", "6 out of 10")
            const numMatches = val.match(/\b\d+(?:\.\d+)?\b/g);
            if (numMatches) {
              for (const nm of numMatches) {
                const parsed = parseFloat(nm);
                if (Number.isFinite(parsed)) {
                  allowedNumbers.add(parsed);
                  if (parsed >= 1) {
                    allowedNumbers.add(Math.round(parsed));
                    allowedNumbers.add(parseFloat(parsed.toFixed(1)));
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Extract candidate horizon numbers from chosen option (e.g. wait_7 -> 7, store_24w -> 24)
  const chosenMatch = decision.chosen.match(/(\d+)/);
  if (chosenMatch) {
    allowedNumbers.add(parseInt(chosenMatch[1], 10));
  }

  // Sivakumar dry spell rule constants: 7 dry days, 21-day window, base 100 seasons
  allowedNumbers.add(7);
  allowedNumbers.add(21);
  allowedNumbers.add(100);

  // Plain-language singular unit count (1 week, 1 season, 1 month)
  allowedNumbers.add(1);

  return { allowedNumbers, allowedPercentages };
}

/** Legacy helper for backward compatibility */
export function getAllowedNumericSet(decision: Decision): Set<number> {
  const { allowedNumbers, allowedPercentages } = getAllowedNumericSets(decision);
  const combined = new Set<number>([...allowedNumbers, ...allowedPercentages]);
  return combined;
}

/**
 * Returns any invalid numbers found in text that do not match Decision.keyNumbers.
 */
export function findInvalidNumbers(text: string, decision: Decision): string[] {
  const { allowedNumbers, allowedPercentages } = getAllowedNumericSets(decision);
  const invalid: string[] = [];

  // First mask full ISO dates (e.g. 2026-04-17) so hyphens aren't split
  const maskedText = text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_match, y, m, d) => {
    if (allowedNumbers.has(parseInt(y, 10)) && allowedNumbers.has(parseInt(d, 10))) {
      return " __VALID_DATE__ ";
    }
    return ` ${y} ${m} ${d} `;
  });

  // Regex to extract candidate numeric tokens including currency, %, and k
  const tokenRegex = /(?:₦\s*)?(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:%|\s*k\b|\s*naira|\s*ngn)?/gi;
  const matches = maskedText.match(tokenRegex) || [];

  for (const rawToken of matches) {
    const token = rawToken.trim();
    if (!token || token === "__VALID_DATE__") continue;

    // Check if token matches ordinals like "1st", "2nd", "7th"
    if (/^\d+(?:st|nd|rd|th)$/i.test(token)) continue;

    const extracted = extractNumericToken(token);
    if (extracted.values.length === 0) continue;

    if (extracted.isPercentage) {
      const isAllowed = extracted.values.some((v) => {
        if (allowedPercentages.has(v)) return true;
        if (allowedPercentages.has(parseFloat(v.toFixed(1)))) return true;
        return false;
      });
      if (!isAllowed) {
        invalid.push(token);
      }
    } else {
      const isAllowed = extracted.values.some((v) => {
        if (allowedNumbers.has(v)) return true;
        if (v >= 1 && allowedNumbers.has(Math.round(v))) return true;
        if (allowedNumbers.has(parseFloat(v.toFixed(1)))) return true;
        return false;
      });
      if (!isAllowed) {
        invalid.push(token);
      }
    }
  }

  return invalid;
}

/**
 * Validator rejecting raw percentages in farmer-facing text (Day 4.2 Polish):
 * Farmers don't read percentages, so replies must use plain chances/counts instead.
 */
export function validateNoPercentages(text: string): { valid: boolean; reason?: string } {
  const pctRegex = /(?:%|\bper\s*cent\b|\bpercent\b|ìdá\s+ọgọ́rùn(?:-ún)?|ida\s+ogorun)/i;
  const match = text.match(pctRegex);
  if (match) {
    return {
      valid: false,
      reason: `Found percentage expression ("${match[0]}"). Farmer replies must use plain chances or counts, never percentages.`,
    };
  }
  return { valid: true };
}

/**
 * Validates option attribution (Step 2):
 * A risk number or plain chance phrase from one option must not appear in the same sentence as another option's verb or duration.
 * E.g., '14.1%' or 'about 1 in 7' (plant_now risk) must not appear beside 'wait' or 'wait a week'.
 */
export function validateOptionAttribution(text: string, decision: Decision): { valid: boolean; reason?: string } {
  const sentences = splitSentences(text);

  if (decision.intent === "plant_timing") {
    const plantNowRisk = String(
      decision.keyNumbers.replantRisk_plantNow || decision.keyNumbers.replantRiskNow || "14.1%"
    );
    const plantNowNum = plantNowRisk.replace("%", "").trim();

    // Plain chance phrases for plant_now
    const plantNowPlainPhrases = [
      "about 1 in 7",
      "1 in 7",
      "about 1 for every 7",
      "1 for every 7",
      "ẹ̀ẹ̀kan nínú àsìkò méje",
      plantNowRisk,
      `${plantNowNum}%`,
    ];

    for (const s of sentences) {
      const lower = s.toLowerCase();
      const hasPlantNowRisk = plantNowPlainPhrases.some((phrase) => lower.includes(phrase.toLowerCase()));
      const hasWaitKeyword =
        /\b(wait|waiting|waited|dúró|jira)\b/i.test(s) ||
        /\b(?:after\s+)?(?:7|14)\s+days?\b/i.test(s) ||
        /\bwait\s+(?:a|one)\s+week\b/i.test(s) ||
        /\bọ̀sẹ̀\s+kan\b/i.test(s);

      if (hasPlantNowRisk && hasWaitKeyword) {
        return {
          valid: false,
          reason: `Plant-now risk (${plantNowRisk} / plain chance) appeared in same sentence as wait option keyword: "${s.trim()}"`,
        };
      }

      const waitRisk = String(
        decision.keyNumbers.replantRisk_wait7 || decision.keyNumbers.replantRisk || "0.7%"
      );
      const waitNum = waitRisk.replace("%", "").trim();
      const waitPlainPhrases = [
        "almost never",
        "e no dey almost happen",
        "fẹ́rẹ́ kò ṣẹlẹ̀ rárá",
        "fẹ́rẹ́ è kò ṣẹlẹ̀ rárá",
        waitRisk,
        `${waitNum}%`,
      ];
      const hasWaitRisk = waitPlainPhrases.some((phrase) => lower.includes(phrase.toLowerCase()));
      const hasPlantNowKeyword = /\b(plant\s+now|gbìn\s+báyìí|shuka\s+yanzu)\b/i.test(s);

      if (hasWaitRisk && hasPlantNowKeyword && !hasWaitKeyword) {
        return {
          valid: false,
          reason: `Wait risk (${waitRisk} / plain chance) appeared in same sentence as plant-now keyword: "${s.trim()}"`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Validates headline and reason structure according to DESIGN.md 8.3 (Step 3):
 * - Headline max 12 words
 * - Reason 1 to 2 sentences
 * - Reason max 3 numbers
 * - No ISO dates (e.g. 2026-04-17)
 * - No technical jargon (analog years, median, mm)
 */
export function validateOutputStructure(output: ExplainOutput): { valid: boolean; reason?: string } {
  const headlineWords = countWords(output.headline);
  if (headlineWords > 12) {
    return { valid: false, reason: `Headline has ${headlineWords} words (max 12 allowed)` };
  }

  const reasonSentences = countSentences(output.reason);
  if (reasonSentences > 2) {
    return { valid: false, reason: `Reason has ${reasonSentences} sentences (max 2 allowed)` };
  }

  const reasonNumbers = findNumericTokens(output.reason);
  if (reasonNumbers.length > 3) {
    return { valid: false, reason: `Reason has ${reasonNumbers.length} numbers (max 3 allowed: ${reasonNumbers.join(", ")})` };
  }

  // No ISO dates in headline or reason
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(output.headline) || /\b\d{4}-\d{2}-\d{2}\b/.test(output.reason)) {
    return { valid: false, reason: "Contains ISO date format; use localized dates like '17 April'" };
  }

  // No technical jargon in headline or reason
  const jargonRegex = /\b(analog\s*years?|median|\bmm\b)\b/i;
  if (jargonRegex.test(output.headline) || jargonRegex.test(output.reason)) {
    return { valid: false, reason: "Contains technical jargon (analog years, median, mm)" };
  }

  return { valid: true };
}

/**
 * Yoruba guard (DESIGN.md section 8.3):
 * If 'yo' reply has no tone marks at all, or mostly English words, reject it.
 */
export function validateYoruba(text: string): { valid: boolean; reason?: string } {
  // Check for tone marks / subdots: á à é è ẹ́ ẹ̀ í ì ó ò ọ́ ọ̀ ú ù ṣ ẹ ọ \u0300 \u0301 \u0323
  const hasToneMarks = /[áàéèíìóòúùẹ́ẹ̀ọ́ọ̀ṣẸỌṢ\u0300\u0301\u0323]/i.test(text);
  if (!hasToneMarks) {
    return { valid: false, reason: "No Yoruba tone marks or underdots found" };
  }

  // Count English words vs total words
  const words = (text.toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length >= 2);
  if (words.length === 0) {
    return { valid: false, reason: "No words found" };
  }

  const englishStopwords = new Set([
    "the", "is", "you", "your", "should", "plant", "wait", "and", "because",
    "for", "with", "in", "to", "of", "after", "days", "risk", "now", "corn",
    "sell", "store", "keep", "more", "less", "high", "low", "expected", "than",
    "today", "we", "have", "are", "will", "from", "at", "per", "bag", "bags",
    "market", "data", "past", "years", "replant", "replanting", "chance", "seasons",
  ]);

  let englishCount = 0;
  for (const w of words) {
    if (englishStopwords.has(w)) {
      englishCount++;
    }
  }

  const englishRatio = englishCount / words.length;
  if (englishRatio > 0.35) {
    return { valid: false, reason: `Too many English words (${(englishRatio * 100).toFixed(0)}%)` };
  }

  return { valid: true };
}

/**
 * Load system prompt template from file.
 */
function loadPromptTemplate(): string {
  const pathsToTry = [
    path.resolve(process.cwd(), "prompts", "explain.md"),
    path.resolve(process.cwd(), "src", "llm", "prompts", "explain.md"),
  ];
  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, "utf8");
    }
  }
  return "You are Ikore, a farm advisor. Write reply in {lang}.";
}

/**
 * Builds structured facts tied to the option they describe (Step 1 & Step 2).
 * Formats chance and storage loss in plain language so the LLM doesn't calculate them.
 */
export function buildFactsByOption(decision: Decision, lang: Lang): Record<string, unknown> {
  const k = decision.keyNumbers;

  if (decision.intent === "plant_timing") {
    const rawDate = String(k.plantingDate || decision.createdAt.slice(0, 10));
    const formattedDate = formatGroundedDate(rawDate, lang);

    return {
      plant_now: {
        replantChance: k[`plainChance_plantNow_${lang}`] || k.plainChance_plantNow_en || "about 1 in 7 seasons",
      },
      wait_7: {
        plantingDate: formattedDate,
        replantChance: k[`plainChance_wait7_${lang}`] || k.plainChance_wait7_en || "almost never",
      },
      wait_14: {
        plantingDate: "24 April",
        replantChance: k[`plainChance_wait14_${lang}`] || k.plainChance_wait14_en || "almost never",
      },
      context: {
        pastSeasonsEvaluated: k.seasonsCount || k.nAnalogYears || 35,
        chosenOption: decision.chosen,
      },
    };
  }

  const bags = Number(k.bags || 20);
  const price = Number(k.currentPricePerBag || 45000);
  const totalValue = bags * price;

  return {
    sell_now: {
      bags,
      pricePerBag: `₦${price.toLocaleString()}`,
      totalValue: `₦${totalValue.toLocaleString()}`,
    },
    store_4w: {
      horizon: "1 month",
      cheaperYearsCount: k.cheaperCount ?? 8,
      totalYearsEvaluated: k.nYears ?? 9,
      storageLoss: k[`storageLossBags_${lang}`] || k.storageLossBags_en || "about half a bag every month",
    },
    context: {
      chosenOption: decision.chosen,
    },
  };
}

/**
 * Grounded explanation + number validator + Yoruba guard + structure check (DESIGN.md 8.3 & Day 4.2 Polish).
 */
export async function explain(
  decision: Decision,
  lang: Lang = "en",
  provider?: LLMProvider
): Promise<AgentReply> {
  const t0 = Date.now();

  // If in test mode and no provider explicitly injected, use deterministic fallback
  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  if (isTest && !provider) {
    const fallbackText =
      decision.intent === "sell_or_store"
        ? templateSelling(decision, lang)
        : templatePlanting(decision, lang);
    return {
      text: fallbackText,
      lang,
      decision,
      askedQuestion: false,
      memoryIdsUsed: [],
      path: "template",
      fallbackReason: "Test mode without injected provider",
      latencyMs: Date.now() - t0,
    };
  }

  const activeProvider = provider || new NvidiaProvider();

  try {
    const rawTemplate = loadPromptTemplate();
    const systemPrompt = rawTemplate
      .replace(/{lang}/g, lang)
      .replace(/{langName}/g, LANG_NAMES[lang] || lang);

    const factsByOption = buildFactsByOption(decision, lang);

    const userPrompt = JSON.stringify(
      {
        intent: decision.intent,
        chosen: decision.chosen,
        confidence: decision.confidence,
        factsByOption,
      },
      null,
      2
    );

    const response = await activeProvider.complete<ExplainOutput>({
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      json: ExplainOutputSchema,
      temperature: 0.2,
    });

    const fullGenerated = `${response.headline}\n\n${response.reason}`;

    // 1. Percentage check: Farmer replies must not contain any '%' or 'percent'
    const headlinePctCheck = validateNoPercentages(response.headline);
    if (!headlinePctCheck.valid) {
      console.warn(`[Explain] Percentage validator rejected headline: ${headlinePctCheck.reason}. Falling back to template.`);
      throw new Error(headlinePctCheck.reason);
    }
    const reasonPctCheck = validateNoPercentages(response.reason);
    if (!reasonPctCheck.valid) {
      console.warn(`[Explain] Percentage validator rejected reason: ${reasonPctCheck.reason}. Falling back to template.`);
      throw new Error(reasonPctCheck.reason);
    }
    if (response.details) {
      for (const d of response.details) {
        const detailPctCheck = validateNoPercentages(d);
        if (!detailPctCheck.valid) {
          console.warn(`[Explain] Percentage validator rejected detail: ${detailPctCheck.reason}. Falling back to template.`);
          throw new Error(detailPctCheck.reason);
        }
      }
    }

    // 2. Structure Check (12 words, 2 sentences, 3 numbers, no ISO dates, no jargon)
    const structureCheck = validateOutputStructure(response);
    if (!structureCheck.valid) {
      console.warn(`[Explain] Structure check rejected LLM reply: ${structureCheck.reason}. Falling back to template.`);
      throw new Error(`Structure check failed: ${structureCheck.reason}`);
    }

    // 3. Number Validator (only numbers present in keyNumbers)
    const invalidNumbers = findInvalidNumbers(fullGenerated, decision);
    if (invalidNumbers.length > 0) {
      console.warn(
        `[Explain] Number validator rejected LLM reply (unmatched numbers: ${invalidNumbers.join(", ")}). Falling back to template.`
      );
      throw new Error(`Invalid numbers: ${invalidNumbers.join(", ")}`);
    }

    // 4. Option Attribution Check (numbers and plain chances not attached to wrong option)
    const attributionCheck = validateOptionAttribution(fullGenerated, decision);
    if (!attributionCheck.valid) {
      console.warn(`[Explain] Option attribution rejected LLM reply: ${attributionCheck.reason}. Falling back to template.`);
      throw new Error(`Option attribution failed: ${attributionCheck.reason}`);
    }

    // 5. Yoruba Guard if lang is yo
    if (lang === "yo") {
      const yoCheck = validateYoruba(fullGenerated);
      if (!yoCheck.valid) {
        console.warn(`[Explain] Yoruba guard rejected LLM reply (${yoCheck.reason}). Falling back to template.`);
        throw new Error(`Yoruba validation failed: ${yoCheck.reason}`);
      }
    }

    const latencyMs = Date.now() - t0;
    console.log(`[Explain] path=llm | latency=${latencyMs}ms | accepted for ${decision.intent} in ${lang} via ${activeProvider.name}`);

    // Assemble final response text
    let replyText = `${response.headline.trim()}\n\n${response.reason.trim()}`;
    if (response.details && response.details.length > 0) {
      replyText += `\n\n${response.details.map((d) => `• ${d}`).join("\n")}`;
    }
    if (response.followUpQuestion) {
      replyText += `\n\n${response.followUpQuestion.trim()}`;
    }

    return {
      text: replyText,
      lang,
      decision,
      askedQuestion: Boolean(response.followUpQuestion),
      memoryIdsUsed: [],
      path: "llm",
      latencyMs,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - t0;
    console.warn(`[Explain] path=template | reason="${err.message}" | latency=${latencyMs}ms`);

    const fallbackText =
      decision.intent === "sell_or_store"
        ? templateSelling(decision, lang)
        : templatePlanting(decision, lang);

    return {
      text: fallbackText,
      lang,
      decision,
      askedQuestion: false,
      memoryIdsUsed: [],
      path: "template",
      fallbackReason: err.message,
      latencyMs,
    };
  }
}
