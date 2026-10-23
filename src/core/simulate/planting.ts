/**
 * Plant-timing simulation model (DESIGN.md section 6.1).
 *
 * Rules:
 * - Fully pure and deterministic. Every function takes `asOf` (ISO date, Africa/Lagos) as an argument.
 * - No Date.now(), no new Date() without arguments, no Math.random(), no I/O, no network or file operations.
 * - Do not fabricate data. If data is insufficient, throw a typed SimulationError.
 * - Numbers come from data and physics, not model hallucination or invented economic defaults.
 */

import { SimulationError } from "../errors.ts";
import type { OutcomeDistribution } from "../types.ts";
import {
  addDays,
  alignDateToYear,
  analogYearWeights,
  longestDrySpell,
  weightedMean,
  weightedPercentile,
  weightedQuantiles,
} from "./stats.ts";

/**
 * Named agronomy constants.
 * Cited from DESIGN.md section 6.1 or explicitly marked as assumptions.
 */

// DESIGN.md section 6.1: "Dry day: a day with < 1 mm rain"
export const DRY_DAY_THRESHOLD_MM = 1.0;

// DESIGN.md section 6.1: "days 1 to 21 after D (seedling stage)"
export const SEEDLING_STAGE_DAYS = 21;

// DESIGN.md section 6.1: "run of > 7 consecutive dry days within days 1 to 21 after D (seedling stage)"
export const CRITICAL_DRY_SPELL_DAYS = 7;

// DESIGN.md section 6.1: Sivakumar (1988) onset criterion: "no dry spell of more than 7 consecutive days happens in the following 30 days"
export const ESTABLISHMENT_PERIOD_DAYS = 30;

// ASSUMPTION: 100 mm water requirement for the 30-day seedling establishment phase (~20% of 500 mm full season need)
export const ESTABLISHMENT_WATER_NEED_MM = 100.0;

// DESIGN.md section 6.1: "Season water adequacy: total rain from D to D+100 days compared with maize requirement 500 to 800 mm"
export const SEASON_MATURITY_DAYS = 100;
export const SEASON_WATER_NEED_MM = 500.0;

// DESIGN.md section 6.1: "past 21 days" analog window
export const ANALOG_WINDOW_DAYS = 21;

// Historical archive starting year in NASA POWER
export const HISTORICAL_START_YEAR = 1991;

// Minimum number of valid analog years required to simulate
export const MIN_ANALOG_YEARS_THRESHOLD = 5;

// ASSUMPTION (Day 3.1 Review): Maximum allowed missing days in seedling or establishment window before excluding the year
export const MAX_ALLOWED_MISSING_DAYS = 2;

export interface DailyRainRecord {
  date: string; // ISO format "YYYY-MM-DD"
  rainMm?: number | null;
  rain_mm?: number | null;
  precipitation_sum?: number | null;
  tmax?: number | null;
  tmin?: number | null;
  source?: "history" | "forecast" | string;
}

export interface PlantingEconomicsInput {
  hectares: number;
  baseYieldKgPerHa: number;
  expectedPricePerKg: number;
  seedCostPerHa?: number;
  replantLabourPerHa?: number;
  riskAversionLambda?: number;
}

export interface PlantingSimulationOptions {
  sourceUrls?: string[];
  candidateOffsetsDays?: number[]; // default: [0, 7, 14]
  economics?: PlantingEconomicsInput;
}

export interface PlantingEvidence {
  sourceUrls: string[];
  analogYears: Array<{ year: number; weight: number; r21: number }>;
  excludedYears: Array<{ year: number; reason: string }>;
  thresholds: {
    dryDayThresholdMm: number; // DESIGN.md 6.1
    seedlingStageDays: number; // DESIGN.md 6.1
    criticalDrySpellDays: number; // DESIGN.md 6.1
    establishmentPeriodDays: number; // DESIGN.md 6.1
    establishmentWaterRequirementMm: number; // Assumption: 100 mm
    seasonWaterRequirementMm: number; // DESIGN.md 6.1
    maxAllowedMissingDays: number; // Assumption: 2 days
  };
  dryGapForecast?: {
    found: boolean;
    startDate?: string;
    endDate?: string;
    lengthDays?: number;
    note?: string;
  };
  currentR21Mm: number;
  sigmaR21: number;
  meanR21: number;
  missingDaysCount?: number;
}

export interface PlantingOption {
  option: "plant_now" | "wait_7" | "wait_14" | string;
  label: string;
  plantingDate: string;
  offsetDays: number;
  replantProbability: number;
  establishmentRainMm: {
    p10: number;
    p50: number;
    p90: number;
  };
  rainfallAdequacy: {
    p10: number;
    p50: number;
    p90: number;
  };
  n: number;
  lowConfidence: boolean;
  evidence: PlantingEvidence;
  notes: string[];
  // Economics are only computed if caller passes typed economics
  outcome?: OutcomeDistribution;
  score?: number;
}

export interface SimulatePlantingInput {
  series: DailyRainRecord[];
  asOf: string;
  options?: PlantingSimulationOptions;
}

/**
 * Normalizes extraction of rain amount from varying record schemas.
 * Returns null if missing, null, undefined, not finite, or negative (NASA -999 missing flag).
 */
function extractRainMm(record?: DailyRainRecord): number | null {
  if (!record) return null;
  const raw = record.rainMm ?? record.rain_mm ?? record.precipitation_sum;
  if (raw === null || raw === undefined || !Number.isFinite(raw) || raw < 0) {
    return null;
  }
  return raw;
}

/**
 * Builds an index map of ISO date -> DailyRainRecord for O(1) lookups.
 */
function indexRainSeries(series: DailyRainRecord[]): Map<string, DailyRainRecord> {
  const map = new Map<string, DailyRainRecord>();
  for (const r of series) {
    if (typeof r?.date === "string" && r.date.length >= 10) {
      map.set(r.date.slice(0, 10), r);
    }
  }
  return map;
}

/**
 * Pure simulation of planting windows (DESIGN.md section 6.1).
 *
 * Given a daily rainfall time series and an explicit `asOf` date,
 * weights historical analog years by similarity of past 21-day rainfall,
 * and evaluates candidate planting dates (default 0, 7, 14 days offset) against
 * each analog year's own historical weather.
 *
 * Does NOT splice forecast data onto historical analog years.
 * Forecast data is solely used to evaluate upcoming forecast conditions for the current season.
 */
export function simulatePlanting(
  arg1: SimulatePlantingInput | DailyRainRecord[],
  arg2?: string,
  arg3?: PlantingSimulationOptions
): PlantingOption[] {
  let series: DailyRainRecord[];
  let asOf: string;
  let options: PlantingSimulationOptions | undefined;

  if (Array.isArray(arg1)) {
    series = arg1;
    if (!arg2 || typeof arg2 !== "string") {
      throw new SimulationError("asOf date is required and must be an ISO date string (YYYY-MM-DD)");
    }
    asOf = arg2.slice(0, 10);
    options = arg3;
  } else {
    series = arg1.series;
    asOf = arg1.asOf.slice(0, 10);
    options = arg1.options;
  }

  if (!series || series.length === 0) {
    throw new SimulationError("Daily rainfall series is empty; cannot run planting simulation", { n: 0 });
  }

  const dateMap = indexRainSeries(series);
  const asOfYear = Number(asOf.slice(0, 4));
  const candidateOffsets = options?.candidateOffsetsDays ?? [0, 7, 14];

  // 1. Calculate current season's R21 (rainfall in the 21 days before asOf)
  let currentR21 = 0;
  let currentMissingCount = 0;

  for (let i = 1; i <= ANALOG_WINDOW_DAYS; i++) {
    const d = addDays(asOf, -i);
    const rain = extractRainMm(dateMap.get(d));
    if (rain === null) {
      currentMissingCount++;
    } else {
      currentR21 += rain;
    }
  }

  // 2. Identify candidate historical analog years (from HISTORICAL_START_YEAR up to asOfYear - 1)
  interface InitialCandidate {
    year: number;
    r21: number;
    r21Missing: number;
  }

  const initialCandidates: InitialCandidate[] = [];
  const excludedFromR21: Array<{ year: number; reason: string }> = [];

  for (let y = HISTORICAL_START_YEAR; y < asOfYear; y++) {
    const alignedAsOf = alignDateToYear(asOf, y);
    let r21_y = 0;
    let missingInR21 = 0;
    let daysFound = 0;

    for (let i = 1; i <= ANALOG_WINDOW_DAYS; i++) {
      const d = addDays(alignedAsOf, -i);
      const rec = dateMap.get(d);
      if (rec !== undefined) {
        daysFound++;
        const rain = extractRainMm(rec);
        if (rain === null) {
          missingInR21++;
        } else {
          r21_y += rain;
        }
      }
    }

    if (daysFound < ANALOG_WINDOW_DAYS - MAX_ALLOWED_MISSING_DAYS || missingInR21 > MAX_ALLOWED_MISSING_DAYS) {
      excludedFromR21.push({
        year: y,
        reason: `R21 window has ${missingInR21} missing days or incomplete coverage (${daysFound}/${ANALOG_WINDOW_DAYS} days present)`,
      });
    } else {
      initialCandidates.push({ year: y, r21: r21_y, r21Missing: missingInR21 });
    }
  }

  if (initialCandidates.length < MIN_ANALOG_YEARS_THRESHOLD) {
    throw new SimulationError(
      `Insufficient historical analog years found (${initialCandidates.length} valid years; minimum required is ${MIN_ANALOG_YEARS_THRESHOLD})`,
      { n: initialCandidates.length, reason: "insufficient_analog_years" }
    );
  }

  // 3. Compute analog-year similarity weights: w_y = exp(-|R21_y - R21_now| / sigma)
  const historicalR21Values = initialCandidates.map((c) => c.r21);
  const { weights: rawWeights, sigma, mean } = analogYearWeights(historicalR21Values, currentR21);

  // Note: No post-asOf data is used. Simulation relies strictly on pre-asOf data
  // (current 2026 pre-season days up to asOf-1 and historical analog years 1991-2025).
  const dryGapForecast: PlantingEvidence["dryGapForecast"] = undefined;

  const results: PlantingOption[] = [];

  // 5. Evaluate each candidate planting window option
  for (const offsetDays of candidateOffsets) {
    const plantingDate = addDays(asOf, offsetDays);
    const optionKey = offsetDays === 0 ? "plant_now" : `wait_${offsetDays}`;
    const label = offsetDays === 0 ? "Plant now" : `Wait ${offsetDays} days`;

    const includedYears: Array<{
      year: number;
      weight: number;
      r21: number;
      replant: number;
      estRainMm: number;
      adequacy: number;
      hasMissing: boolean;
    }> = [];
    const optionExcludedYears = [...excludedFromR21];

    for (let i = 0; i < initialCandidates.length; i++) {
      const cand = initialCandidates[i];
      const y = cand.year;
      const w = rawWeights[i];
      const alignedPlantingDate = alignDateToYear(plantingDate, y);

      // Seedling window: days D+1 to D+21 after planting date
      const seedlingRain: (number | null)[] = [];
      let seedlingMissing = 0;
      for (let d = 1; d <= SEEDLING_STAGE_DAYS; d++) {
        const dt = addDays(alignedPlantingDate, d);
        const rain = extractRainMm(dateMap.get(dt));
        if (rain === null) seedlingMissing++;
        seedlingRain.push(rain);
      }

      // Establishment window: days D to D+30 (31 days)
      const estRainList: (number | null)[] = [];
      let estMissing = 0;
      for (let d = 0; d <= ESTABLISHMENT_PERIOD_DAYS; d++) {
        const dt = addDays(alignedPlantingDate, d);
        const rain = extractRainMm(dateMap.get(dt));
        if (rain === null) estMissing++;
        estRainList.push(rain);
      }

      // Missing-day policy:
      // If seedling or establishment window has more than 2 missing days, exclude that year.
      if (seedlingMissing > MAX_ALLOWED_MISSING_DAYS) {
        optionExcludedYears.push({
          year: y,
          reason: `Seedling window (D+1..D+21) has ${seedlingMissing} missing days (> ${MAX_ALLOWED_MISSING_DAYS} allowed)`,
        });
        continue;
      }

      if (estMissing > MAX_ALLOWED_MISSING_DAYS) {
        optionExcludedYears.push({
          year: y,
          reason: `Establishment window (D..D+30) has ${estMissing} missing days (> ${MAX_ALLOWED_MISSING_DAYS} allowed)`,
        });
        continue;
      }

      // Compute streak with missing days treated as unknown (does NOT break dry streak).
      const { longestDrySpellDays } = longestDrySpell(seedlingRain, 0, SEEDLING_STAGE_DAYS - 1, DRY_DAY_THRESHOLD_MM);
      const isReplant = longestDrySpellDays > CRITICAL_DRY_SPELL_DAYS ? 1.0 : 0.0;

      // Sum available establishment rain
      const estRainMm = estRainList.reduce((acc: number, r) => acc + (r ?? 0), 0);
      const adequacy = Math.min(1.0, estRainMm / ESTABLISHMENT_WATER_NEED_MM);

      const hasMissing = cand.r21Missing > 0 || seedlingMissing > 0 || estMissing > 0;

      includedYears.push({
        year: y,
        weight: w,
        r21: cand.r21,
        replant: isReplant,
        estRainMm,
        adequacy,
        hasMissing,
      });
    }

    if (includedYears.length < MIN_ANALOG_YEARS_THRESHOLD) {
      throw new SimulationError(
        `Insufficient valid analog years after window evaluation (${includedYears.length} valid; minimum required is ${MIN_ANALOG_YEARS_THRESHOLD})`,
        { n: includedYears.length, reason: "insufficient_valid_analog_years" }
      );
    }

    // Normalize weights among included analog years
    const sumWeights = includedYears.reduce((acc, y) => acc + y.weight, 0);
    const normalizedWeights = sumWeights > 0 ? includedYears.map((y) => y.weight / sumWeights) : includedYears.map(() => 1 / includedYears.length);

    // Weather-derived risk and adequacy
    const replantProbability = weightedMean(
      includedYears.map((y) => y.replant),
      normalizedWeights
    );

    const estRainValues = includedYears.map((y) => y.estRainMm);
    const rawEstablishmentRain = {
      p10: weightedPercentile(estRainValues, normalizedWeights, 0.1),
      p50: weightedPercentile(estRainValues, normalizedWeights, 0.5),
      p90: weightedPercentile(estRainValues, normalizedWeights, 0.9),
    };

    const adequacyValues = includedYears.map((y) => y.adequacy);
    const rainfallAdequacy = {
      p10: weightedPercentile(adequacyValues, normalizedWeights, 0.1),
      p50: weightedPercentile(adequacyValues, normalizedWeights, 0.5),
      p90: weightedPercentile(adequacyValues, normalizedWeights, 0.9),
    };

    const anyMissing = currentMissingCount > 0 || includedYears.some((y) => y.hasMissing);
    const lowConfidence = anyMissing || includedYears.length < 25;

    // Agronomy notes (no fabricated numbers)
    const notes: string[] = [];
    if (replantProbability < 0.15) {
      notes.push("Low replanting risk (<15%); safe seedling establishment window");
    } else if (replantProbability <= 0.35) {
      notes.push("Moderate replanting risk (15-35%); watch early moisture");
    } else {
      notes.push("High false-start risk (>35%); high replanting risk with seedling mortality likely if dry spell hits");
    }

    if (lowConfidence) {
      notes.push("Low confidence flag: missing rainfall data in some historical windows");
    }

    const evidence: PlantingEvidence = {
      sourceUrls: options?.sourceUrls ?? [],
      analogYears: includedYears
        .map((y, idx) => ({ year: y.year, weight: normalizedWeights[idx], r21: y.r21 }))
        .sort((a, b) => b.weight - a.weight),
      excludedYears: optionExcludedYears,
      thresholds: {
        dryDayThresholdMm: DRY_DAY_THRESHOLD_MM,
        seedlingStageDays: SEEDLING_STAGE_DAYS,
        criticalDrySpellDays: CRITICAL_DRY_SPELL_DAYS,
        establishmentPeriodDays: ESTABLISHMENT_PERIOD_DAYS,
        establishmentWaterRequirementMm: ESTABLISHMENT_WATER_NEED_MM,
        seasonWaterRequirementMm: SEASON_WATER_NEED_MM,
        maxAllowedMissingDays: MAX_ALLOWED_MISSING_DAYS,
      },
      dryGapForecast,
      currentR21Mm: currentR21,
      sigmaR21: sigma,
      meanR21: mean,
      missingDaysCount: currentMissingCount,
    };

    const optionResult: PlantingOption = {
      option: optionKey,
      label,
      plantingDate,
      offsetDays,
      replantProbability: Number(replantProbability.toFixed(4)),
      establishmentRainMm: {
        p10: Number(rawEstablishmentRain.p10.toFixed(1)),
        p50: Number(rawEstablishmentRain.p50.toFixed(1)),
        p90: Number(rawEstablishmentRain.p90.toFixed(1)),
      },
      rainfallAdequacy: {
        p10: Number(rainfallAdequacy.p10.toFixed(3)),
        p50: Number(rainfallAdequacy.p50.toFixed(3)),
        p90: Number(rainfallAdequacy.p90.toFixed(3)),
      },
      n: includedYears.length,
      lowConfidence,
      evidence,
      notes,
    };

    // If caller provided typed economics, calculate outcome distribution and score
    if (options?.economics) {
      const econ = options.economics;
      const seedCost = econ.hectares * (econ.seedCostPerHa ?? 0);
      const replantLabour = econ.hectares * (econ.replantLabourPerHa ?? 0);
      const replantCost = seedCost + replantLabour;

      const valuesInNaira = includedYears.map((y) => {
        const yieldKg = econ.hectares * econ.baseYieldKgPerHa * y.adequacy;
        return yieldKg * econ.expectedPricePerKg - y.replant * replantCost;
      });

      const lambda = econ.riskAversionLambda ?? 0.5;
      const q = weightedQuantiles(valuesInNaira, normalizedWeights);
      const meanValue = weightedMean(valuesInNaira, normalizedWeights);

      optionResult.outcome = {
        p10: Math.round(q.p10),
        p50: Math.round(q.p50),
        p90: Math.round(q.p90),
        mean: Math.round(meanValue),
        riskMetric: Number(replantProbability.toFixed(3)),
        riskLabel: "replanting risk",
        n: includedYears.length,
      };
      optionResult.score = Math.round(meanValue - lambda * (meanValue - q.p10));
    }

    results.push(optionResult);
  }

  return results;
}
