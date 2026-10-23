import fs from "node:fs";
import path from "node:path";
import { addDays, alignDateToYear, analogYearWeights, longestDrySpell } from "../src/core/simulate/stats.ts";
import {
  CRITICAL_DRY_SPELL_DAYS,
  DRY_DAY_THRESHOLD_MM,
  ESTABLISHMENT_PERIOD_DAYS,
  SEEDLING_STAGE_DAYS,
  simulatePlanting,
} from "../src/core/simulate/planting.ts";

const snapshotPath = path.resolve(process.cwd(), "data", "snapshots", "rain_daily__farm_bisi_ogbomoso.json");
const data = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
const rows = data.rows as Array<{ date: string; rain_mm?: number | null; source?: string }>;

const asOf = "2026-04-10";
const asOfYear = 2026;

// 1. Count history vs forecast
let historyCount = 0;
let forecastCount = 0;
const dateMap = new Map<string, { rain_mm: number | null; source: string }>();

for (const r of rows) {
  const rain = r.rain_mm ?? null;
  const src = r.source || (r.date < asOf ? "history" : "forecast");
  if (src === "history") historyCount++;
  else forecastCount++;
  dateMap.set(r.date, { rain_mm: rain, source: src });
}

console.log("====================================================================================================");
console.log("DIAGNOSTIC REPORT: farm_bisi_ogbomoso as of 2026-04-10");
console.log("====================================================================================================");
console.log(`Total series rows: ${rows.length}`);
console.log(`Actual History rows: ${historyCount} (NASA POWER daily, 1991-01-01 to 2026-04-09)`);
console.log(`Forecast rows: ${forecastCount} (Open-Meteo historical forecast, 2026-04-10 to 2026-04-25)`);
console.log(`Series date range: ${rows[0].date} to ${rows[rows.length - 1].date}`);
console.log("Confirmation: Each analog year's evaluation windows read THAT historical year's observed data only;");
console.log("             the 2026 forecast is NOT spliced onto historical analog years.");
console.log("----------------------------------------------------------------------------------------------------\n");

// 21 days before asOf (current season 2026)
let currentR21 = 0;
const r21Dates2026: string[] = [];
for (let i = 1; i <= 21; i++) {
  const d = addDays(asOf, -i);
  r21Dates2026.unshift(d);
  const val = dateMap.get(d)?.rain_mm ?? 0;
  currentR21 += val;
}
console.log(`Current 2026 R21 window: ${r21Dates2026[0]} to ${r21Dates2026[r21Dates2026.length - 1]}`);
console.log(`Current 2026 R21 total rainfall: ${currentR21.toFixed(2)} mm\n`);

// Compute for every analog year 1991 to 2025
interface YearDebug {
  year: number;
  r21Window: string;
  r21Mm: number;
  r21Missing: number;
  weight: number;
  estRainMm: number;
  longestDryDays: number;
  replant: boolean;
  estMissing: number;
  seedlingMissing: number;
}

const yearStats: Array<{ year: number; r21: number; missing: number }> = [];

for (let y = 1991; y < asOfYear; y++) {
  const alignedAsOf = alignDateToYear(asOf, y);
  let r21_y = 0;
  let missing = 0;
  for (let i = 1; i <= 21; i++) {
    const d = addDays(alignedAsOf, -i);
    const rec = dateMap.get(d);
    if (!rec || rec.rain_mm === null || rec.rain_mm === undefined) {
      missing++;
    } else {
      r21_y += rec.rain_mm;
    }
  }
  yearStats.push({ year: y, r21: r21_y, missing });
}

const { weights, sigma, mean } = analogYearWeights(
  yearStats.map((y) => y.r21),
  currentR21
);
console.log(`Analog weights parameters: sigma=${sigma.toFixed(2)} mm, mean=${mean.toFixed(2)} mm\n`);

const debugRows: YearDebug[] = [];

for (let i = 0; i < yearStats.length; i++) {
  const y = yearStats[i].year;
  const w = weights[i];
  const alignedAsOf = alignDateToYear(asOf, y);

  // R21 window
  const r21Start = addDays(alignedAsOf, -21);
  const r21End = addDays(alignedAsOf, -1);
  const r21Mm = yearStats[i].r21;
  const r21Missing = yearStats[i].missing;

  // Raw 30-day establishment rain in mm (uncapped) for D = asOf (evaluated purely against THAT year's data)
  let estRain = 0;
  let estMissing = 0;
  for (let d = 0; d <= ESTABLISHMENT_PERIOD_DAYS; d++) {
    const dt = addDays(alignedAsOf, d);
    const rec = dateMap.get(dt);
    if (!rec || rec.rain_mm === null || rec.rain_mm === undefined) {
      estMissing++;
    } else {
      estRain += rec.rain_mm;
    }
  }

  // Seedling stage (D+1..D+21) longest dry spell (evaluated purely against THAT year's data)
  const seedlingRain: (number | null)[] = [];
  let seedlingMissing = 0;
  for (let d = 1; d <= SEEDLING_STAGE_DAYS; d++) {
    const dt = addDays(alignedAsOf, d);
    const rec = dateMap.get(dt);
    if (!rec || rec.rain_mm === null || rec.rain_mm === undefined) {
      seedlingMissing++;
      seedlingRain.push(null);
    } else {
      seedlingRain.push(rec.rain_mm);
    }
  }

  const { longestDrySpellDays } = longestDrySpell(seedlingRain, 0, SEEDLING_STAGE_DAYS - 1, DRY_DAY_THRESHOLD_MM);

  debugRows.push({
    year: y,
    r21Window: `${r21Start.slice(5)}..${r21End.slice(5)}`,
    r21Mm: Math.round(r21Mm * 10) / 10,
    r21Missing,
    weight: Math.round(w * 1000) / 1000,
    estRainMm: Math.round(estRain * 10) / 10,
    longestDryDays: longestDrySpellDays,
    replant: longestDrySpellDays > CRITICAL_DRY_SPELL_DAYS,
    estMissing,
    seedlingMissing,
  });
}

console.log("=========================================================================================================================");
console.log("Year | R21 Window  | R21 (mm) | Weight | Est Rain 30d (mm) | Longest Dry D+1..D+21 | Replant? | Missing (R21, Est, Sdl)");
console.log("-------------------------------------------------------------------------------------------------------------------------");
for (const r of debugRows) {
  const line = [
    r.year.toString().padEnd(4),
    r.r21Window.padEnd(11),
    r.r21Mm.toFixed(1).padStart(8),
    r.weight.toFixed(3).padStart(6),
    r.estRainMm.toFixed(1).padStart(17),
    (r.longestDryDays.toString() + " days").padStart(21),
    (r.replant ? "YES" : "no").padStart(8),
    `r21:${r.r21Missing}, est:${r.estMissing}, sdl:${r.seedlingMissing}`.padStart(23),
  ].join(" | ");
  console.log(line);
}
console.log("=========================================================================================================================\n");

// Run simulatePlanting to show the 3-option decision output
const simulationResults = simulatePlanting({
  series: rows,
  asOf,
});

console.log("SIMULATE PLANTING 3-OPTION OUTPUT (pure weather-derived risk & adequacy, no invented economics):");
console.log("-------------------------------------------------------------------------------------------------");
for (const opt of simulationResults) {
  console.log(`Option: ${opt.label} [${opt.option}]`);
  console.log(`  Planting Date: ${opt.plantingDate}`);
  console.log(`  Replant Probability: ${(opt.replantProbability * 100).toFixed(1)}%`);
  console.log(`  Establishment Rain (raw mm): p10=${opt.establishmentRainMm.p10} mm, p50=${opt.establishmentRainMm.p50} mm, p90=${opt.establishmentRainMm.p90} mm`);
  console.log(`  Rainfall Adequacy (0..1): p10=${(opt.rainfallAdequacy.p10 * 100).toFixed(1)}%, p50=${(opt.rainfallAdequacy.p50 * 100).toFixed(1)}%, p90=${(opt.rainfallAdequacy.p90 * 100).toFixed(1)}%`);
  console.log(`  Analog Years Count (n): ${opt.n}`);
  console.log(`  Low Confidence: ${opt.lowConfidence}`);
  console.log(`  Notes: ${opt.notes.join("; ")}`);
  console.log("");
}
