import type { Decision, Farm, Lang } from "./types.ts";

/** Morning briefing composer (DESIGN.md section 8.5). */
export function composeBriefing(
  _farm: Farm,
  _decisions: Decision[],
  _lang: Lang,
): string {
  throw new Error("composeBriefing() not implemented yet");
}
