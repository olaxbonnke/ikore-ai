import type { UnderstandIntent } from "./understand.ts";

/** Candidate actions per intent (DESIGN.md step 4). */
export function listOptions(_intent: UnderstandIntent): string[] {
  throw new Error("listOptions() not implemented yet");
}
