import type { UnderstandIntent } from "./understand.ts";

export interface OptionsContext {
  asOf?: string;
  isOutsideWindow?: boolean;
  windowNote?: string;
  cashNeedByDate?: string;
  cashNeedNgn?: number;
}

export interface OptionItem {
  key: string;
  label: string;
  offsetDays?: number;
  weeks?: number;
  notes: string[];
}

/** Candidate actions per intent (DESIGN.md step 4). */
export function listOptions(
  intent: UnderstandIntent,
  context?: OptionsContext,
): string[] {
  if (intent === "plant_timing") {
    if (context?.isOutsideWindow) {
      return ["wait_until_window"];
    }
    return ["plant_now", "wait_7", "wait_14"];
  }

  if (intent === "sell_or_store") {
    return ["sell_now", "store_4w", "store_8w", "store_12w"];
  }

  return [];
}

/** Structured options metadata for candidate generation */
export function getOptionDefinitions(
  intent: UnderstandIntent,
  context?: OptionsContext,
): OptionItem[] {
  if (intent === "plant_timing") {
    if (context?.isOutsideWindow) {
      return [
        {
          key: "wait_until_window",
          label: "Wait until planting window",
          notes: [context?.windowNote || "Current date is outside recommended planting season"],
        },
      ];
    }
    return [
      { key: "plant_now", label: "Plant now", offsetDays: 0, notes: [] },
      { key: "wait_7", label: "Wait 7 days", offsetDays: 7, notes: [] },
      { key: "wait_14", label: "Wait 14 days", offsetDays: 14, notes: [] },
    ];
  }

  if (intent === "sell_or_store") {
    return [
      { key: "sell_now", label: "Sell now at harvest", weeks: 0, notes: [] },
      { key: "store_4w", label: "Store 4 weeks", weeks: 4, notes: [] },
      { key: "store_8w", label: "Store 8 weeks", weeks: 8, notes: [] },
      { key: "store_12w", label: "Store 12 weeks", weeks: 12, notes: [] },
    ];
  }

  return [];
}
