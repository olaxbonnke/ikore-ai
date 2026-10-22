import type { OptionResult } from "../types.ts";

/** Sell-or-store simulation (DESIGN.md section 6.2). Pure; pass asOf. */
export function simulateSelling(_input: {
  asOf: string;
  optionIds: string[];
}): OptionResult[] {
  throw new Error("simulateSelling() not implemented yet");
}
