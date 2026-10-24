/**
 * Intent + slot extraction (DESIGN.md section 8.2).
 */
export {
  UnderstandSchema,
  extractRules,
  understand,
  isRecallQuery,
  isOutOfScopeQuery,
  isNonMaizeCropQuery,
  isRainAdequacyQuery,
  isMaizeAgronomyQuery,
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
  | "maize_agronomy"
  | "out_of_scope"
  | "unknown";
