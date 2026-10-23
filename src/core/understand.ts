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

  // Slot extraction
  const slots: Record<string, unknown> = {
    crop: "maize",
  };

  // Price per bag extraction
  // e.g. "offer 45,000 naira per bag", "buyer dey offer 45,000 naira per bag", "₦45,000", "45000 per bag"
  const priceMatch =
    text.match(
      /(?:offer|offering|price|at|sell for|buy for|for)?\s*(?:₦|ngn|naira)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})\s*(?:naira|ngn)?\s*(?:per|\/)?\s*bag/i
    ) ||
    text.match(/([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})\s*(?:naira|ngn)\s*(?:per|\/)?\s*bag/i) ||
    text.match(/(?:₦|ngn)\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})/i);
  if (priceMatch) {
    const pStr = priceMatch[1].replace(/,/g, "");
    const pNum = Number(pStr);
    if (Number.isFinite(pNum) && pNum > 0) {
      slots.pricePerBag = pNum;
    }
  }

  // Bags count extraction
  const bagsMatch = text.match(/(\d+)\s*bags?/i);
  if (bagsMatch) {
    const bNum = Number(bagsMatch[1]);
    if (Number.isFinite(bNum) && bNum > 0) {
      slots.bags = bNum;
    }
  }

  // Bag weight extraction
  const weightMatch = text.match(/(\d+)\s*kg/i);
  if (weightMatch) {
    const wNum = Number(weightMatch[1]);
    if (Number.isFinite(wNum) && wNum > 0) {
      slots.bagWeightKg = wNum;
    }
  }

  // Storage method extraction
  if (/\b(pics|hermetic|triple bag)\b/i.test(lower)) {
    slots.storageMethod = "pics";
  } else if (/\b(treated sack|chemical sack)\b/i.test(lower)) {
    slots.storageMethod = "sack_treated";
  } else if (/\b(silo)\b/i.test(lower)) {
    slots.storageMethod = "silo";
  } else if (/\b(sack|plain sack)\b/i.test(lower)) {
    slots.storageMethod = "sack";
  }

  // Cash need extraction
  // e.g. "need 400,000 naira for school fees in 4 weeks"
  const cashMatch = text.match(
    /need\s*(?:₦|ngn|naira)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,7})\s*(?:naira|ngn)?(?:\s*for\s*([^.]+?))?\s*in\s*(\d+)\s*(weeks?|months?|days?)/i
  );
  if (cashMatch) {
    const cStr = cashMatch[1].replace(/,/g, "");
    const amount = Number(cStr);
    const desc = cashMatch[2]?.trim();
    const num = Number(cashMatch[3]);
    const unit = cashMatch[4].toLowerCase();
    const weeks = unit.startsWith("month") ? num * 4 : unit.startsWith("day") ? Math.ceil(num / 7) : num;
    slots.cashNeed = {
      amountNgn: amount,
      dueInWeeks: weeks,
      description: desc,
    };
  }

  return {
    intent,
    language,
    slots,
    missing: [],
  };
}
