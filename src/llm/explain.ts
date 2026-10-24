import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import type { AgentReply, Decision, Lang } from "../core/types.ts";
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
            const num = parseFloat(val.replace(/[₦,]/g, ""));
            if (Number.isFinite(num)) {
              allowedNumbers.add(num);
              if (num >= 1) {
                allowedNumbers.add(Math.round(num));
                allowedNumbers.add(parseFloat(num.toFixed(1)));
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

  // Sivakumar dry spell rule constants: 7 dry days, 21-day window
  allowedNumbers.add(7);
  allowedNumbers.add(21);

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
    "market", "data", "past", "years", "replant", "replanting",
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
 * Grounded explanation + number validator + Yoruba guard (DESIGN.md section 8.3).
 */
export async function explain(
  decision: Decision,
  lang: Lang = "en",
  provider?: LLMProvider
): Promise<AgentReply> {
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
    };
  }

  const activeProvider = provider || new NvidiaProvider();

  try {
    const rawTemplate = loadPromptTemplate();
    const systemPrompt = rawTemplate
      .replace(/{lang}/g, lang)
      .replace(/{langName}/g, LANG_NAMES[lang] || lang);

    const userPrompt = JSON.stringify(
      {
        intent: decision.intent,
        chosen: decision.chosen,
        confidence: decision.confidence,
        keyNumbers: decision.keyNumbers,
        evidence: decision.evidence.map((e) => ({ label: e.label, statistic: e.statistic })),
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

    // 1. Run Number Validator
    const invalidNumbers = findInvalidNumbers(fullGenerated, decision);
    if (invalidNumbers.length > 0) {
      console.warn(
        `[Explain] Number validator rejected LLM reply (unmatched numbers: ${invalidNumbers.join(", ")}). Falling back to template.`
      );
      throw new Error(`Invalid numbers: ${invalidNumbers.join(", ")}`);
    }

    // 2. Run Yoruba Guard if lang is yo
    if (lang === "yo") {
      const yoCheck = validateYoruba(fullGenerated);
      if (!yoCheck.valid) {
        console.warn(
          `[Explain] Yoruba guard rejected LLM reply (${yoCheck.reason}). Falling back to template.`
        );
        throw new Error(`Yoruba validation failed: ${yoCheck.reason}`);
      }
    }

    console.log(`[Explain] LLM explanation accepted for ${decision.intent} in ${lang} via ${activeProvider.name}`);

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
    };
  } catch (err: any) {
    console.warn(`[Explain] Fallback to deterministic template (${err.message})`);
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
    };
  }
}
