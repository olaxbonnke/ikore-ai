import type { Lang } from "./types.ts";

export type UnderstandIntent =
  | "plant_timing"
  | "sell_or_store"
  | "why"
  | "briefing"
  | "profile_update"
  | "smalltalk"
  | "unknown";

export interface UnderstandResult {
  intent: UnderstandIntent;
  language: Lang;
  slots: Record<string, unknown>;
  missing: string[];
}

/** Rule-based intent + slot extraction for English and local terms (LLM wired in Day 4). */
export async function understand(
  text: string,
  _farmId?: string,
): Promise<UnderstandResult> {
  const lower = text.toLowerCase();

  // Language detection heuristic
  let language: Lang = "en";
  if (/\b(se|shey|bawo|kilo|gbìn|àgbàdo|ọjọ́)\b/i.test(lower)) {
    language = "yo";
  } else if (/\b(don|make|dey|wetin|na|fit|abeg)\b/i.test(lower)) {
    language = "pcm";
  } else if (/\b(yaushe|ina|shuka|masara|buhu|jira)\b/i.test(lower)) {
    language = "ha";
  }

  // Intent detection
  let intent: UnderstandIntent = "unknown";
  if (/\b(why|wetin make|kilode|me ya sa)\b/i.test(lower)) {
    intent = "why";
  } else if (/\b(brief|morning|update|report)\b/i.test(lower)) {
    intent = "briefing";
  } else if (/\b(plant|sow|seed|ground|start|planting|when)\b/i.test(lower)) {
    intent = "plant_timing";
  } else if (/\b(sell|store|price|market|bag|harvest)\b/i.test(lower)) {
    intent = "sell_or_store";
  } else if (/\b(hi|hello|good morning|kedu|bawo)\b/i.test(lower)) {
    intent = "smalltalk";
  } else {
    // Default farm advisory context
    intent = "plant_timing";
  }

  return {
    intent,
    language,
    slots: {
      crop: "maize",
    },
    missing: [],
  };
}
