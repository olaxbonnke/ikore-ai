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

/** LLM intent + slot extraction (DESIGN.md step 1). */
export async function understand(
  _text: string,
  _farmId: string,
): Promise<UnderstandResult> {
  throw new Error("understand() not implemented yet");
}
