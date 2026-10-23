import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  simulatePlanting,
  type DailyRainRecord,
  type PlantingOption,
} from "../src/core/simulate/planting.ts";
import { addDays } from "../src/core/simulate/stats.ts";

function loadFixture(name: string): DailyRainRecord[] {
  const p = path.resolve(process.cwd(), "tests", "fixtures", "simulate", name);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

describe("simulatePlanting (src/core/simulate/planting.ts)", () => {
  it("all-dry series -> high replant risk (1.0), low adequacy (0.0)", () => {
    const series = loadFixture("all_dry.json");
    const asOf = "2026-04-10";

    const options = simulatePlanting(series, asOf);
    expect(options).toHaveLength(3);

    const [opt0, opt7, opt14] = options;
    expect(opt0.option).toBe("plant_now");
    expect(opt7.option).toBe("wait_7");
    expect(opt14.option).toBe("wait_14");

    for (const opt of options) {
      expect(opt.replantProbability).toBe(1.0);
      expect(opt.rainfallAdequacy.p10).toBe(0.0);
      expect(opt.rainfallAdequacy.p50).toBe(0.0);
      expect(opt.rainfallAdequacy.p90).toBe(0.0);
      expect(opt.establishmentRainMm.p10).toBe(0.0);
      expect(opt.n).toBeGreaterThanOrEqual(5);
      expect(opt.notes.some((n) => n.toLowerCase().includes("replanting risk"))).toBe(true);
    }
  });

  it("all-wet series -> low replant risk (0.0), high adequacy (1.0)", () => {
    const series = loadFixture("all_wet.json");
    const asOf = "2026-04-10";

    const options = simulatePlanting(series, asOf);
    expect(options).toHaveLength(3);

    for (const opt of options) {
      expect(opt.replantProbability).toBe(0.0);
      expect(opt.rainfallAdequacy.p10).toBe(1.0);
      expect(opt.rainfallAdequacy.p50).toBe(1.0);
      expect(opt.rainfallAdequacy.p90).toBe(1.0);
      expect(opt.establishmentRainMm.p50).toBeGreaterThanOrEqual(100.0);
      expect(opt.notes.some((n) => n.toLowerCase().includes("low replanting risk"))).toBe(true);
    }
  });

  it("false-start series -> elevated replant probability due to critical dry spell", () => {
    const series = loadFixture("false_start.json");
    const asOf = "2026-04-10";

    const options = simulatePlanting(series, asOf);
    expect(options).toHaveLength(3);

    const plantNow = options.find((o) => o.option === "plant_now")!;
    // 10 consecutive dry days in days 1 to 21 (> 7 day threshold) triggers replant in all years
    expect(plantNow.replantProbability).toBe(1.0);
    expect(plantNow.evidence.thresholds.criticalDrySpellDays).toBe(7);
  });

  it("regression: if half of analog years have a 10-day dry spell, replantProbability is ~0.5 and adequacy p10 < p90", () => {
    // Synthetic series with 10 analog years (2015 to 2024), asOf = 2025-04-10
    const asOf = "2025-04-10";
    const rows: DailyRainRecord[] = [];

    // Current 2025 R21 window: 21 days with 2.0 mm/day
    for (let d = 1; d <= 21; d++) {
      rows.push({ date: addDays(asOf, -d), rain_mm: 2.0 });
    }

    // 10 historical years: 2015 to 2024
    // All years have identical R21 = 42 mm (21 days * 2.0 mm), giving equal weights to all analog years.
    for (let y = 2015; y <= 2024; y++) {
      const alignedAsOf = `${y}-04-10`;
      for (let d = 1; d <= 21; d++) {
        rows.push({ date: addDays(alignedAsOf, -d), rain_mm: 2.0 });
      }

      const isDrySpellYear = y % 2 === 0; // 5 years even (dry spell), 5 years odd (wet)

      // Seedling window (days 1 to 21 from planting) & establishment window (days 0 to 30)
      // For wait_14, day offset extends to 14 + 30 = 44 days after asOf. Generate 60 days.
      for (let d = 0; d <= 60; d++) {
        const dt = addDays(alignedAsOf, d);
        if (d === 0) {
          rows.push({ date: dt, rain_mm: 5.0 });
        } else if (isDrySpellYear) {
          // 10-day dry spell in days 1 to 10 (< 1.0 mm), then light rain (2.0 mm)
          const rain = d <= 10 ? 0.0 : 2.0;
          rows.push({ date: dt, rain_mm: rain });
        } else {
          // Consistent wet days (5.0 mm/day) -> no dry spell, high establishment rain
          rows.push({ date: dt, rain_mm: 5.0 });
        }
      }
    }

    const options = simulatePlanting(rows, asOf);
    const plantNow = options.find((o) => o.option === "plant_now")!;

    expect(plantNow.n).toBe(10);
    // 5 of 10 equal-weight years experienced critical dry spell (> 7 days)
    expect(plantNow.replantProbability).toBeCloseTo(0.5, 1);
    expect(plantNow.replantProbability).toBeGreaterThanOrEqual(0.45);
    expect(plantNow.replantProbability).toBeLessThanOrEqual(0.55);

    // Adequacy spread: dry-spell years have lower rain than wet years -> p10 < p90
    expect(plantNow.establishmentRainMm.p10).toBeLessThan(plantNow.establishmentRainMm.p90);
    expect(plantNow.rainfallAdequacy.p10).toBeLessThan(plantNow.rainfallAdequacy.p90);
  });

  it("series with missing days -> handled, flagged, and no crash", () => {
    const series = loadFixture("missing_days.json");
    const asOf = "2026-04-10";

    const options = simulatePlanting(series, asOf);
    expect(options).toHaveLength(3);

    const opt = options[0];
    expect(opt.evidence.missingDaysCount).toBe(2); // 2026-04-01 and 2026-04-02 null
    // 2021 had 10 missing days (> 2 max allowed), so it must be excluded
    const analogYears = opt.evidence.analogYears.map((a) => a.year);
    expect(analogYears).not.toContain(2021);
    expect(opt.evidence.excludedYears.some((e) => e.year === 2021)).toBe(true);

    // 2022 had 1 missing day (<= 2), so it is included with lowConfidence flag
    expect(analogYears).toContain(2022);
    expect(opt.lowConfidence).toBe(true);
  });

  it("leap-year series -> correct day alignment around Feb 29", () => {
    const series = loadFixture("leap_year.json");
    const asOf = "2024-03-15"; // 2024 is leap year

    const options = simulatePlanting(series, asOf);
    expect(options).toHaveLength(3);

    for (const opt of options) {
      expect(opt.n).toBeGreaterThanOrEqual(4);
      expect(Number.isFinite(opt.replantProbability)).toBe(true);
      expect(Number.isFinite(opt.rainfallAdequacy.p50)).toBe(true);
    }
  });

  it("determinism: same input and asOf give identical output", () => {
    const series = loadFixture("false_start.json");
    const asOf = "2026-04-10";

    const run1 = simulatePlanting(series, asOf);
    const run2 = simulatePlanting(series, asOf);

    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });

  it("no look-ahead: mutating or deleting all rain data on or after asOf does not change simulation or risk results", () => {
    const snapshotPath = path.resolve(
      process.cwd(),
      "data",
      "snapshots",
      "rain_daily__farm_bisi_ogbomoso.json"
    );
    const parsedSnapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
    const asOf = "2026-04-10";

    const baseOptions = simulatePlanting({
      series: parsedSnapshot.rows,
      asOf,
    });

    // Mutate every row on or after asOf: inject extreme spikes (150 mm/day)
    const mutatedSeries: DailyRainRecord[] = parsedSnapshot.rows.map((r: DailyRainRecord) => {
      if (r.date >= asOf) {
        return { date: r.date, rain_mm: 150.0 };
      }
      return { ...r };
    });

    const mutatedOptions = simulatePlanting({
      series: mutatedSeries,
      asOf,
    });

    // Truncated series: completely delete all rows on or after asOf
    const truncatedSeries: DailyRainRecord[] = parsedSnapshot.rows.filter(
      (r: DailyRainRecord) => r.date < asOf
    );

    const truncatedOptions = simulatePlanting({
      series: truncatedSeries,
      asOf,
    });

    expect(baseOptions).toHaveLength(3);
    expect(mutatedOptions).toHaveLength(3);
    expect(truncatedOptions).toHaveLength(3);

    for (let i = 0; i < 3; i++) {
      expect(mutatedOptions[i].replantProbability).toBe(baseOptions[i].replantProbability);
      expect(mutatedOptions[i].rainfallAdequacy).toEqual(baseOptions[i].rainfallAdequacy);
      expect(mutatedOptions[i].establishmentRainMm).toEqual(baseOptions[i].establishmentRainMm);
      expect(mutatedOptions[i].score).toBe(baseOptions[i].score);

      expect(truncatedOptions[i].replantProbability).toBe(baseOptions[i].replantProbability);
      expect(truncatedOptions[i].rainfallAdequacy).toEqual(baseOptions[i].rainfallAdequacy);
      expect(truncatedOptions[i].establishmentRainMm).toEqual(baseOptions[i].establishmentRainMm);
      expect(truncatedOptions[i].score).toBe(baseOptions[i].score);
    }
  });

  describe("Validation on real data (farm_bisi_ogbomoso snapshot)", () => {
    it("runs for farm_bisi_ogbomoso as of 2026-04-10 with n >= 25", () => {
      const snapshotPath = path.resolve(
        process.cwd(),
        "data",
        "snapshots",
        "rain_daily__farm_bisi_ogbomoso.json"
      );
      expect(fs.existsSync(snapshotPath)).toBe(true);

      const parsedSnapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
      const asOf = process.env.OKO_DEMO_DATE?.trim() || "2026-04-10";

      const options: PlantingOption[] = simulatePlanting({
        series: parsedSnapshot.rows,
        asOf,
        options: {
          sourceUrls: parsedSnapshot.sourceUrls || [parsedSnapshot.sourceUrl],
          economics: {
            hectares: 2.0,
            baseYieldKgPerHa: 2000,
            expectedPricePerKg: 350,
            seedCostPerHa: 30000,
            replantLabourPerHa: 15000,
          },
        },
      });

      expect(options).toHaveLength(3);

      console.log("\n=======================================================");
      console.log(`REAL DATA VALIDATION: farm_bisi_ogbomoso (asOf: ${asOf})`);
      console.log("=======================================================");

      for (const opt of options) {
        expect(opt.n).toBeGreaterThanOrEqual(25);
        expect(opt.evidence.sourceUrls.length).toBeGreaterThan(0);
        expect(opt.plantingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(opt.replantProbability).toBeGreaterThanOrEqual(0);
        expect(opt.replantProbability).toBeLessThanOrEqual(1);
        expect(opt.rainfallAdequacy.p50).toBeGreaterThanOrEqual(0);
        expect(opt.rainfallAdequacy.p50).toBeLessThanOrEqual(1);
        expect(opt.establishmentRainMm.p10).toBeLessThanOrEqual(opt.establishmentRainMm.p90);
        expect(opt.rainfallAdequacy.p10).toBeLessThanOrEqual(opt.rainfallAdequacy.p90);

        console.log(`\nOption: ${opt.label} [${opt.option}]`);
        console.log(`  Planting Date: ${opt.plantingDate}`);
        console.log(`  Replant Probability (False Start Risk): ${(opt.replantProbability * 100).toFixed(1)}%`);
        console.log(
          `  Raw Establishment Rain (mm): p10=${opt.establishmentRainMm.p10} mm, p50=${opt.establishmentRainMm.p50} mm, p90=${opt.establishmentRainMm.p90} mm`
        );
        console.log(
          `  Establishment Rainfall Adequacy: p10=${(opt.rainfallAdequacy.p10 * 100).toFixed(1)}%, p50=${(
            opt.rainfallAdequacy.p50 * 100
          ).toFixed(1)}%, p90=${(opt.rainfallAdequacy.p90 * 100).toFixed(1)}%`
        );
        console.log(`  Analog Years Count (n): ${opt.n}`);
        if (opt.outcome) {
          console.log(
            `  Expected Value: ₦${opt.outcome.p50.toLocaleString()} (p10: ₦${opt.outcome.p10.toLocaleString()}, p90: ₦${opt.outcome.p90.toLocaleString()})`
          );
        }
        if (opt.score !== undefined) {
          console.log(`  Score: ${opt.score.toLocaleString()}`);
        }
        console.log(`  Notes: ${opt.notes.join("; ") || "None"}`);
      }

      console.log("=======================================================\n");
    });
  });
});
