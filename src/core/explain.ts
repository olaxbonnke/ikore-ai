import type { AgentReply, Decision, Lang } from "./types.ts";

/** Grounded explanation + number validator (DESIGN.md step 7). */
export async function explain(_decision: Decision, _lang: Lang): Promise<AgentReply> {
  throw new Error("explain() not implemented yet");
}

/** Returns invalid numbers found in text vs Decision.keyNumbers. */
export function findInvalidNumbers(_text: string, _decision: Decision): string[] {
  return [];
}
