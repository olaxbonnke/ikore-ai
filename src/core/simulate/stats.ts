/**
 * Shared statistics and pure agroclimatology math helpers (DESIGN.md section 6.3).
 *
 * Rules:
 * - Fully pure and deterministic: No Date.now(), no new Date() without explicit arguments,
 *   no Math.random(), no I/O, no network or file operations.
 * - Units are explicitly documented in JSDoc for every helper.
 */

/**
 * Standard deviation of an array of numbers.
 * Uses population standard deviation (or 0 if length <= 1).
 */
export function standardDeviation(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Computes the weighted mean of a list of numbers.
 *
 * Formula: \bar{x}_w = (\sum w_i * x_i) / (\sum w_i)
 *
 * @param values Array of numbers
 * @param weights Corresponding non-negative weights
 * @returns Weighted mean, or 0 if total weight is 0 or arrays are empty
 */
export function weightedMean(values: number[], weights: number[]): number {
  if (values.length === 0 || values.length !== weights.length) return 0;
  let weightSum = 0;
  let weightedValSum = 0;

  for (let i = 0; i < values.length; i++) {
    const w = Number.isFinite(weights[i]) && weights[i] > 0 ? weights[i] : 0;
    const v = Number.isFinite(values[i]) ? values[i] : 0;
    weightSum += w;
    weightedValSum += w * v;
  }

  if (weightSum <= 0) return 0;
  return weightedValSum / weightSum;
}

/**
 * Computes a weighted percentile using cumulative weight linear interpolation.
 *
 * @param values Array of numerical values
 * @param weights Corresponding non-negative weights
 * @param p Desired percentile between 0.0 and 1.0 (e.g. 0.1 for p10, 0.5 for median)
 * @returns The interpolated weighted quantile value
 */
export function weightedPercentile(values: number[], weights: number[], p: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];

  // Clamp p to [0, 1]
  const clampedP = Math.max(0, Math.min(1, p));

  // Pair values with weights and filter out non-positive weights
  const pairs: Array<{ val: number; weight: number }> = [];
  let totalWeight = 0;

  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    const weight = weights[i];
    if (Number.isFinite(val) && Number.isFinite(weight) && weight > 0) {
      pairs.push({ val, weight });
      totalWeight += weight;
    }
  }

  if (pairs.length === 0) return 0;
  if (pairs.length === 1 || totalWeight <= 0) return pairs[0].val;

  // Sort by value ascending
  pairs.sort((a, b) => a.val - b.val);

  // Midpoints of cumulative weights (Hmisc-style continuous quantile interpolation)
  let cumWeight = 0;
  const pMid: number[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const mid = cumWeight + pairs[i].weight / 2;
    pMid.push(mid / totalWeight);
    cumWeight += pairs[i].weight;
  }

  if (clampedP <= pMid[0]) return pairs[0].val;
  if (clampedP >= pMid[pMid.length - 1]) return pairs[pairs.length - 1].val;

  for (let i = 0; i < pMid.length - 1; i++) {
    if (clampedP >= pMid[i] && clampedP <= pMid[i + 1]) {
      const span = pMid[i + 1] - pMid[i];
      const fraction = span > 0 ? (clampedP - pMid[i]) / span : 0;
      return pairs[i].val + fraction * (pairs[i + 1].val - pairs[i].val);
    }
  }

  return pairs[pairs.length - 1].val;
}

/**
 * Computes p10, p50 (median), and p90 for weighted distributions.
 */
export function weightedQuantiles(
  values: number[],
  weights: number[]
): { p10: number; p50: number; p90: number } {
  return {
    p10: weightedPercentile(values, weights, 0.1),
    p50: weightedPercentile(values, weights, 0.5),
    p90: weightedPercentile(values, weights, 0.9),
  };
}

/**
 * Computes rolling window sums of a 1D numeric array.
 *
 * @param values Array of numbers
 * @param windowSize Number of elements per rolling window
 * @returns Array of sums, length = values.length - windowSize + 1
 */
export function rollingWindowSums(values: number[], windowSize: number): number[] {
  if (windowSize <= 0 || values.length < windowSize) return [];

  const result: number[] = [];
  let currentSum = 0;

  for (let i = 0; i < windowSize; i++) {
    currentSum += values[i] ?? 0;
  }
  result.push(currentSum);

  for (let i = windowSize; i < values.length; i++) {
    currentSum += (values[i] ?? 0) - (values[i - windowSize] ?? 0);
    result.push(currentSum);
  }

  return result;
}

/**
 * Measures the longest continuous run of dry days within a slice of daily rainfall.
 *
 * Missing-day policy (Day 3.1 review):
 * A missing day (null or undefined) must NOT break a dry streak, because that hides risk.
 * A missing day continues the streak (treated as unknown / non-breaking).
 * Only a verified wet day (rain >= dryThresholdMm) breaks the dry streak.
 *
 * @param series Daily rainfall values in mm (or null if missing)
 * @param startIndex Inclusive start index in series
 * @param endIndex Inclusive end index in series
 * @param dryThresholdMm Threshold below which a day is considered dry (< 1.0 mm by default, DESIGN.md section 6.1)
 */
export function longestDrySpell(
  series: (number | null | undefined)[],
  startIndex = 0,
  endIndex = series.length - 1,
  dryThresholdMm = 1.0
): { longestDrySpellDays: number; missingDaysCount: number } {
  const start = Math.max(0, startIndex);
  const end = Math.min(series.length - 1, endIndex);

  let maxStreak = 0;
  let currentStreak = 0;
  let missingDaysCount = 0;

  for (let i = start; i <= end; i++) {
    const val = series[i];
    if (val === null || val === undefined || !Number.isFinite(val)) {
      missingDaysCount++;
      // Missing day must NOT break dry streak, because that hides risk.
      currentStreak++;
      if (currentStreak > maxStreak) {
        maxStreak = currentStreak;
      }
    } else if (val < dryThresholdMm) {
      currentStreak++;
      if (currentStreak > maxStreak) {
        maxStreak = currentStreak;
      }
    } else {
      currentStreak = 0;
    }
  }

  return { longestDrySpellDays: maxStreak, missingDaysCount };
}

/**
 * Analog-year weighting formula (DESIGN.md section 6.1):
 *
 * Weight: w_y = exp(-|R21_y - R21_now| / sigma)
 *
 * where:
 * - R21_now is rainfall in the 21 days before asOf
 * - R21_y is rainfall in the same 21-day calendar window for historical year y
 * - sigma is the standard deviation of R21 across all valid historical years
 *
 * If sigma is 0 (all years have identical rainfall), uniform weights (1.0) are returned.
 */
export function analogYearWeights(
  historicalR21: number[],
  currentR21: number
): { weights: number[]; sigma: number; mean: number } {
  if (historicalR21.length === 0) {
    return { weights: [], sigma: 0, mean: 0 };
  }

  const mean = historicalR21.reduce((sum, v) => sum + v, 0) / historicalR21.length;
  const sigma = standardDeviation(historicalR21);

  if (sigma < 1e-6) {
    return {
      weights: historicalR21.map(() => 1.0),
      sigma: 0,
      mean,
    };
  }

  const weights = historicalR21.map((r21_y) => {
    const diff = Math.abs(r21_y - currentR21);
    return Math.exp(-diff / sigma);
  });

  return { weights, sigma, mean };
}

/**
 * Pure date helper: Adds integer days to an ISO date (YYYY-MM-DD) deterministically using UTC.
 * Never calls Date.now() or relies on host timezone.
 */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
}

/**
 * Pure date helper: Calculates difference in days between two ISO dates (b - a).
 */
export function daysBetween(isoDateA: string, isoDateB: string): number {
  const [yA, mA, dA] = isoDateA.split("-").map(Number);
  const [yB, mB, dB] = isoDateB.split("-").map(Number);
  const utcA = Date.UTC(yA, mA - 1, dA);
  const utcB = Date.UTC(yB, mB - 1, dB);
  return Math.round((utcB - utcA) / 86_400_000);
}

/**
 * Checks whether a calendar year is a leap year.
 */
export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Aligns a calendar date into historical year y, properly handling Feb 29 leap day.
 * If target date is Feb 29 (02-29) and year y is not a leap year, it maps to Feb 28 (02-28).
 */
export function alignDateToYear(isoDate: string, targetYear: number): string {
  const mmdd = isoDate.slice(5);
  if (mmdd === "02-29" && !isLeapYear(targetYear)) {
    return `${targetYear}-02-28`;
  }
  return `${targetYear}-${mmdd}`;
}
