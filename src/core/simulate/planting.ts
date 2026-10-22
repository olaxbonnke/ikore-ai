import type { OptionResult } from "../types.ts";

/** Plant-timing simulation (DESIGN.md section 6.1). Pure; pass asOf (ISO date, Africa/Lagos). */
export function simulatePlanting(_input: {
  asOf: string;
  optionIds: string[];
}): OptionResult[] {
  throw new Error("simulatePlanting() not implemented yet");
}
