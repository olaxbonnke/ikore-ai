import type { Decision, OptionResult } from "./types.ts";

/** Risk-adjusted scoring and verdict (DESIGN.md step 6). */
export function decide(
  _options: OptionResult[],
  _params: { farmId: string; intent: Decision["intent"]; asOf: string; dataMode: Decision["dataMode"] },
): Pick<
  Decision,
  "chosen" | "runnerUp" | "confidence" | "riskBadge" | "keyNumbers"
> {
  throw new Error("decide() not implemented yet");
}
