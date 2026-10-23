import { describe, expect, it } from "vitest";
import {
  addDays,
  alignDateToYear,
  analogYearWeights,
  daysBetween,
  isLeapYear,
  longestDrySpell,
  rollingWindowSums,
  standardDeviation,
  weightedMean,
  weightedPercentile,
  weightedQuantiles,
} from "../src/core/simulate/stats.ts";

describe("pure stats helpers (simulate/stats.ts)", () => {
  it("computes standard deviation accurately", () => {
    expect(standardDeviation([])).toBe(0);
    expect(standardDeviation([5])).toBe(0);
    // [2, 4, 4, 4, 5, 5, 7, 9]: mean = 5, variance = 32 / 8 = 4, std = 2
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
  });

  it("computes weighted mean correctly", () => {
    expect(weightedMean([], [])).toBe(0);
    // Equal weights -> arithmetic mean ( (10 + 20) / 2 = 15 )
    expect(weightedMean([10, 20], [1, 1])).toBe(15);
    // Skewed weights: 10 * 3 + 20 * 1 = 50 / 4 = 12.5
    expect(weightedMean([10, 20], [3, 1])).toBe(12.5);
  });

  it("computes weighted percentiles and quantiles with monotonic ordering", () => {
    const values = [10, 20, 30, 40, 50];
    const weights = [1, 1, 1, 1, 1];

    const q = weightedQuantiles(values, weights);
    expect(q.p10).toBeLessThanOrEqual(q.p50);
    expect(q.p50).toBeLessThanOrEqual(q.p90);
    expect(q.p50).toBeCloseTo(30, 0);

    // Single value
    expect(weightedPercentile([42], [1], 0.5)).toBe(42);
    // Empty array
    expect(weightedPercentile([], [], 0.5)).toBe(0);
  });

  it("computes rolling window sums", () => {
    const arr = [1, 2, 3, 4, 5];
    expect(rollingWindowSums(arr, 3)).toEqual([6, 9, 12]);
    expect(rollingWindowSums(arr, 1)).toEqual([1, 2, 3, 4, 5]);
    expect(rollingWindowSums(arr, 10)).toEqual([]);
  });

  it("measures longest dry spell and tracks missing days explicitly", () => {
    // 0 = dry, 5 = wet, null = missing
    const series = [0, 0, 0, 10, 0, 0, 0, 0, 0, 2, 0];
    const res = longestDrySpell(series, 0, series.length - 1, 1.0);
    expect(res.longestDrySpellDays).toBe(5);
    expect(res.missingDaysCount).toBe(0);

    // With nulls
    const withNulls = [0, 0, null, 0, 0];
    const resNulls = longestDrySpell(withNulls, 0, withNulls.length - 1, 1.0);
    // null breaks the streak: max streak is 2, not 4
    expect(resNulls.longestDrySpellDays).toBe(2);
    expect(resNulls.missingDaysCount).toBe(1);

    // All wet
    const allWet = [10, 20, 15, 30];
    expect(longestDrySpell(allWet, 0, 3, 1.0).longestDrySpellDays).toBe(0);
  });

  it("calculates analog-year weights with similarity formula", () => {
    const historicalR21 = [10, 20, 50, 80, 100];
    const currentR21 = 50;

    const { weights, sigma } = analogYearWeights(historicalR21, currentR21);
    expect(sigma).toBeGreaterThan(0);
    // The exact match (50) must have the highest weight = exp(0) = 1.0
    const exactMatchIndex = 2;
    expect(weights[exactMatchIndex]).toBe(1.0);
    // Further distances must have strictly smaller weights
    expect(weights[0]).toBeLessThan(weights[1]);
    expect(weights[1]).toBeLessThan(weights[2]);
    expect(weights[4]).toBeLessThan(weights[3]);

    // Zero variance edge case: uniform weights
    const uniform = analogYearWeights([50, 50, 50], 50);
    expect(uniform.sigma).toBe(0);
    expect(uniform.weights).toEqual([1.0, 1.0, 1.0]);
  });

  it("handles pure date operations, leap years, and Feb 29 alignment", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2020)).toBe(true);
    expect(isLeapYear(2023)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);

    // addDays across month and year boundaries
    expect(addDays("2026-04-10", 7)).toBe("2026-04-17");
    expect(addDays("2026-04-10", 14)).toBe("2026-04-24");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29"); // leap year
    expect(addDays("2023-02-28", 1)).toBe("2023-03-01"); // non-leap year

    expect(daysBetween("2026-04-10", "2026-04-17")).toBe(7);
    expect(daysBetween("2026-04-10", "2026-04-10")).toBe(0);

    // alignDateToYear
    expect(alignDateToYear("2026-04-10", 2024)).toBe("2024-04-10");
    // Feb 29 to non-leap maps to Feb 28
    expect(alignDateToYear("2024-02-29", 2023)).toBe("2023-02-28");
    // Feb 29 to leap year maps to Feb 29
    expect(alignDateToYear("2024-02-29", 2020)).toBe("2020-02-29");
  });
});
