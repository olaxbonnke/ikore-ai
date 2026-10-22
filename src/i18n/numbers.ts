import type { Lang } from "../core/types.ts";

/** Format naira for farmer-facing strings (₦118,000 in every language). */
export function formatNaira(amountNgn: number, _lang: Lang): string {
  return `₦${Math.round(amountNgn).toLocaleString("en-NG")}`;
}
