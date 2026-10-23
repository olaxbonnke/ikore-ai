import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  simulatePlanting,
  type DailyRainRecord,
  type PlantingOption,
} from "../src/core/simulate/planting.ts";

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
      expect(opt.n).toBeGreaterThanOrEqual(5);
      expect(opt.notes.some((n) => n.toLowerCase().includes("high replanting risk"))).toBe(true);
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

  it("series with missing days -> handled, flagged, and no crash", () => {
    const series = loadFixture("missing_days.json");
    const asOf = "2026-04-10";

    const options = simulatePlanting(series, asOf);
    expect(options).toHaveLength(3);

    const opt = options[0];
    expect(opt.evidence.missingDaysCount).toBe(2); // 2026-04-01 and 2026-04-02 null
    // 2021 had 10 missing days (> 5%), so it should be excluded from analog years
    const analogYears = opt.evidence.analogYears.map((a) => a.year);
    expect(analogYears).not.toContain(2021);
    // 2022 had 1 missing day (<= 5%), so it should be included
    expect(analogYears).toContain(2022);
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
          hectares: 2.0,
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

        console.log(`\nOption: ${opt.label} [${opt.option}]`);
        console.log(`  Planting Date: ${opt.plantingDate}`);
        console.log(`  Replant Probability (False Start Risk): ${(opt.replantProbability * 100).toFixed(1)}%`);
        console.log(
          `  Establishment Rainfall Adequacy: p10=${(opt.rainfallAdequacy.p10 * 100).toFixed(1)}%, p50=${(
            opt.rainfallAdequacy.p50 * 100
          ).toFixed(1)}%, p90=${(opt.rainfallAdequacy.p90 * 100).toFixed(1)}%`
        );
        console.log(`  Analog Years Count (n): ${opt.n}`);
        console.log(
          `  Expected Value: ₦${opt.outcome.p50.toLocaleString()} (p10: ₦${opt.outcome.p10.toLocaleString()}, p90: ₦${opt.outcome.p90.toLocaleString()})`
        );
        console.log(`  Score: ${opt.score.toLocaleString()}`);
        console.log(`  Notes: ${opt.notes.join("; ") || "None"}`);
      }

      console.log("=======================================================\n");
    });
  });
});
