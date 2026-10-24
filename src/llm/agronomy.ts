import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import type { Lang } from "../core/types.ts";
import { templateAgronomyFallback } from "../i18n/templates.ts";
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
    /\b(?:water|watering|irrigation|irigeshon|bomi|bomirin|rin\s*omi|ruwa|rain|recent\s*rain|[oòó]j[oòó]|harvest|harvesting|k[oóọ̀]r[eéè]|ikore|ìkórè|dry|drying|moisture|shell|shelling|girbi)\b/iu.test(nfc) ||
    /\b(?:water|watering|irrigation|irigeshon|bomi|bomirin|rin\s*omi|ruwa|rain|recent\s*rain|ojo|harvest|harvesting|kore|ikore|dry|drying|moisture|shell|shelling|girbi)\b/iu.test(stripped)
  );
}

/**
 * Validates agronomy guidance for:
 * 1. Prohibited chemical brand names or active ingredients.
 * 2. Prohibited specific chemical dose patterns (e.g. ml/L, g per litre, l/ha, knapsack).
 * 3. Ungrounded numbers (all numbers must come from the prompt context).
 */
export function validateAgronomyGuidance(
  text: string,
  allowedNumbers: Set<number>
): { valid: boolean; reason?: string } {
  // 1. Specific chemical dosage patterns
  const dosePattern =
    /\b\d+(?:\.\d+)?\s*(?:ml\/l|ml\/litre|ml\s+per\s+l(?:itre)?|g\/l|g\/litre|g\s+per\s+l(?:itre)?|l\/ha|litres?\/ha|kg\/ha|ml\s+per\s+20l|per\s+knapsack|knapsack\s+sprayer)\b/i;
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

  // 3. Numbers check
  // Extract all numbers from text
  const numMatches = text.match(/\b\d+(?:\.\d+)?\b/g) || [];
  for (const raw of numMatches) {
    const num = parseFloat(raw);
    if (!Number.isFinite(num)) continue;
    // Harmless baseline small integers (1 or 2 e.g. "1 to 2 seeds" or "1 week")
    if (num === 1 || num === 2) continue;

    const allowed =
      allowedNumbers.has(num) ||
      allowedNumbers.has(Math.round(num)) ||
      allowedNumbers.has(parseFloat(num.toFixed(1)));

    if (!allowed) {
      return {
        valid: false,
        reason: `Ungrounded number "${raw}" found in agronomy guidance. Numbers must come strictly from context.`,
      };
    }
  }

  return { valid: true };
}

/**
 * Builds the set of allowed numbers from farm profile, recent rainfall, and dates.
 */
export function buildAllowedAgronomyNumbers(
  farm: FarmProfile,
  recentRain?: LoadedRecentRain | null,
  asOf?: string
): Set<number> {
  const allowed = new Set<number>();

  if (farm.hectares) {
    allowed.add(farm.hectares);
    allowed.add(Math.round(farm.hectares));
  }

  if (recentRain) {
    allowed.add(recentRain.totalRainMm);
    allowed.add(Math.round(recentRain.totalRainMm));
    allowed.add(parseFloat(recentRain.totalRainMm.toFixed(1)));
    allowed.add(recentRain.daysCount);

    // Add days in date ranges
    const startDay = parseInt(recentRain.startDate.slice(8, 10), 10);
    const endDay = parseInt(recentRain.endDate.slice(8, 10), 10);
    if (Number.isFinite(startDay)) allowed.add(startDay);
    if (Number.isFinite(endDay)) allowed.add(endDay);
  }

  if (asOf) {
    const y = parseInt(asOf.slice(0, 4), 10);
    const m = parseInt(asOf.slice(5, 7), 10);
    const d = parseInt(asOf.slice(8, 10), 10);
    if (Number.isFinite(y)) allowed.add(y);
    if (Number.isFinite(m)) allowed.add(m);
    if (Number.isFinite(d)) allowed.add(d);
  }

  // 14 days default window
  allowed.add(14);
  allowed.add(1);
  allowed.add(2);

  return allowed;
}

function loadAgronomyPrompt(): string {
  const p = path.resolve(process.cwd(), "prompts", "agronomy.md");
  if (fs.existsSync(p)) {
    return fs.readFileSync(p, "utf8");
  }
  return "You are Ikore AI maize agronomy advisory assistant. Max 80 words, no ungrounded numbers, no chemical brands or doses.";
}

export interface ExplainAgronomyParams {
  question: string;
  farm: FarmProfile;
  lang: Lang;
  asOf: string;
  recentRain?: LoadedRecentRain | null;
  recalledMemories?: string[];
  provider?: LLMProvider;
  runId?: string;
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
}

export async function explainAgronomy(
  params: ExplainAgronomyParams
): Promise<AgronomyExplainResult> {
  const { question, farm, lang, asOf, recentRain, recalledMemories, provider, runId } = params;
  const allowedNumbers = buildAllowedAgronomyNumbers(farm, recentRain, asOf);
  const config = getNightshiftConfig();
  const isSample = config.sampleMode;
  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

  // Build context summary for prompt
  const rainContext = recentRain
    ? `Recent rainfall recorded at ${farm.ownerName} (${farm.lga}, ${farm.state}) from ${recentRain.startDate} to ${recentRain.endDate}: ${recentRain.totalRainMm.toFixed(1)} mm across ${recentRain.daysCount} days.`
    : "No recent rainfall data queried.";

  const memoryContext = recalledMemories && recalledMemories.length > 0
    ? `Recalled farm context: ${recalledMemories.slice(0, 2).join(" ")}`
    : "";

  const promptContext = `
Farmer Location: ${farm.lga}, ${farm.state}
Farm Size: ${farm.hectares} ha
Zone: ${farm.zone || "derived_savanna"}
Current Date (asOf): ${asOf}
${rainContext}
${memoryContext}
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
      sampleAnswer = templateAgronomyFallback(lang);
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

  const t0 = performance.now();
  try {
    let output: AgronomyOutput;
    let respondedModel = config.model;
    let latencyMs = 0;

    if ("completeWithMeta" in activeProvider && typeof (activeProvider as any).completeWithMeta === "function") {
      const meta = await (activeProvider as any).completeWithMeta({
        system: systemPrompt,
        messages: [{ role: "user", content: promptContext }],
        json: AgronomyOutputSchema,
        temperature: 0.2,
        stepName: "agronomy",
      });
      output = AgronomyOutputSchema.parse(meta.content);
      respondedModel = meta.model;
      latencyMs = meta.latencyMs;
    } else {
      const parsed = await activeProvider.complete({
        system: systemPrompt,
        messages: [{ role: "user", content: promptContext }],
        json: AgronomyOutputSchema,
        temperature: 0.2,
      });
      output = AgronomyOutputSchema.parse(parsed);
      respondedModel = (activeProvider as any).lastRespondedModel || config.model;
      latencyMs = Math.round(performance.now() - t0);
    }

    const validation = validateAgronomyGuidance(output.answer, allowedNumbers);

    if (!validation.valid) {
      return {
        text: templateAgronomyFallback(lang),
        followUp: null,
        path: "template",
        model: "template",
        fallbackReason: validation.reason,
        latencyMs,
        requestedModel: config.model,
        respondedModel,
      };
    }

    return {
      text: output.answer,
      followUp: output.followUp || null,
      path: "model",
      model: respondedModel,
      latencyMs,
      requestedModel: config.model,
      respondedModel,
    };
  } catch (err: any) {
    return {
      text: templateAgronomyFallback(lang),
      followUp: null,
      path: "template",
      model: "template",
      fallbackReason: err?.message || "LLM completion error",
    };
  }
}
