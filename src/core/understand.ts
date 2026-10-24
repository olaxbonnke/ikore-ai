/**
 * Intent + slot extraction (DESIGN.md section 8.2).
 */
export {
  UnderstandSchema,
  extractRules,
  understand,
  type UnderstandResult,
} from "../llm/understand.ts";

export type UnderstandIntent =
  | "plant_timing"
  | "sell_or_store"
  | "why"
  | "briefing"
  | "profile_update"
  | "recall_previous"
  | "smalltalk"
  | "unknown";
