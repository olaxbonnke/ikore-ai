import type { Lang } from "../core/types.ts";

/** Fallback explanations when the LLM or validator fails (DESIGN.md step 7). */
export function templateUnavailable(_intent: "plant_timing" | "sell_or_store", _lang: Lang): string {
  return "Oko is still starting up. Please try again soon.";
}
