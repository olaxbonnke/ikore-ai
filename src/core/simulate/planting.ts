/**
 * Plant-timing simulation model (DESIGN.md section 6.1).
 *
 * Rules:
 * - Fully pure and deterministic. Every function takes `asOf` (ISO date, Africa/Lagos) as an argument.
 * - No Date.now(), no new Date() without arguments, no Math.random(), no I/O, no network or file operations.
 * - Do not fabricate data. If data is insufficient, throw a typed SimulationError.
 */

import { SimulationError } from "../errors.ts";
import type { OptionResult, OutcomeDistribution } from "../types.ts";
import {
  addDays,
  alignDateToYear,
  analogYearWeights,
  daysBetween,
  longestDrySpell,
  weightedMean,
  weightedQuantiles,
} from "./stats.ts";

/**
 * Named agronomy constants matching DESIGN.md section 6.1
 */
export const DRY_DAY_THRESHOLD_MM = 1.0;
export const SEEDLING_STAGE_DAYS = 21;
export const CRITICAL_DRY_SPELL_DAYS = 7;
export const ESTABLISHMENT_PERIOD_DAYS = 30;
export const ESTABLISHMENT_WATER_NEED_MM = 100.0;
export const SEASON_MATURITY_DAYS = 100;
export const SEASON_WATER_NEED_MM = 500.0;
export const ANALOG_WINDOW_DAYS = 21;
export const HISTORICAL_START_YEAR = 1991;
export const MAX_MISSING_DAYS_PCT = 0.05;
export const MIN_ANALOG_YEARS_THRESHOLD = 5;

// Default economic assumptions (labelled in evidence and Decision.assumptions)
export const DEFAULT_HECTARES = 2.0;
export const DEFAULT_BASE_YIELD_KG_PER_HA = 2000.0;
export const DEFAULT_MAIZE_PRICE_NGN_PER_KG = 350.0;
export const DEFAULT_SEED_KG_PER_HA = 25.0;
export const DEFAULT_SEED_PRICE_NGN_PER_KG = 1200.0;
export const DEFAULT_REPLANT_LABOUR_NGN_PER_HA = 15000.0;
export const DEFAULT_RISK_AVERSION_LAMBDA = 0.5;

export interface DailyRainRecord {
  date: string; // ISO format "YYYY-MM-DD"
  rainMm?: number | null;
  rain_mm?: number | null;
  precipitation_sum?: number | null;
  tmax?: number | null;
  tmin?: number | null;
  source?: "history" | "forecast" | string;
}

export interface PlantingSimulationOptions {
  sourceUrls?: string[];
  candidateOffsetsDays?: number[]; // default: [0, 7, 14]
  hectares?: number;
  baseYieldKgPerHa?: number;
  expectedPricePerKg?: number;
  riskAversion?: "low" | "normal" | "high";
}

export interface PlantingEvidence {
  sourceUrls: string[];
  analogYears: Array<{ year: number; weight: number; r21: number }>;
  thresholds: {
    dryDayThresholdMm: number;
    seedlingStageDays: number;
    criticalDrySpellDays: number;
    establishmentPeriodDays: number;
    establishmentWaterRequirementMm: number;
    seasonWaterRequirementMm: number;
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

export interface PlantingOption extends OptionResult {
  option: "plant_now" | "wait_7" | "wait_14" | string;
  label: string;
  plantingDate: string;
  offsetDays: number;
  replantProbability: number;
  rainfallAdequacy: {
    p10: number;
    p50: number;
    p90: number;
  };
  n: number;
  evidence: PlantingEvidence;
  outcome: OutcomeDistribution;
  score: number;
  notes: string[];
}

export interface SimulatePlantingInput {
  series: DailyRainRecord[];
  asOf: string;
  options?: PlantingSimulationOptions;
}

/**
 * Normalizes extraction of rain amount from varying gateway record schemas.
 * Returns null if missing or negative (NASA -999 missing flag).
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
 * computes analog-year similarity weights, splices the forecast with historical analogues,
 * and returns exactly 3 candidate planting window options:
 * 1. "plant_now" (offset 0 days)
 * 2. "wait_7" (offset 7 days)
 * 3. "wait_14" (offset 14 days)
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

  // 1. Calculate current year's R21 (rainfall in the 21 days before asOf)
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

  // 2. Identify candidate historical years (from HISTORICAL_START_YEAR up to asOfYear - 1)
  interface AnalogCandidate {
    year: number;
    r21: number;
    missingCount: number;
  }

  const analogCandidates: AnalogCandidate[] = [];

  for (let y = HISTORICAL_START_YEAR; y < asOfYear; y++) {
    const alignedAsOf = alignDateToYear(asOf, y);
    let r21_y = 0;
    let missingInWindow = 0;
    let totalPresent = 0;

    for (let i = 1; i <= ANALOG_WINDOW_DAYS; i++) {
      const d = addDays(alignedAsOf, -i);
      const rec = dateMap.get(d);
      if (rec !== undefined) {
        totalPresent++;
        const rain = extractRainMm(rec);
        if (rain === null) {
          missingInWindow++;
        } else {
          r21_y += rain;
        }
      }
    }

    // Drop year if data for this window is missing > 5% of days or not present
    if (totalPresent >= ANALOG_WINDOW_DAYS * (1 - MAX_MISSING_DAYS_PCT) && missingInWindow <= 1) {
      analogCandidates.push({ year: y, r21: r21_y, missingCount: missingInWindow });
    }
  }

  if (analogCandidates.length < MIN_ANALOG_YEARS_THRESHOLD) {
    throw new SimulationError(
      `Insufficient historical analog years found (${analogCandidates.length} valid years; minimum required is ${MIN_ANALOG_YEARS_THRESHOLD})`,
      { n: analogCandidates.length, reason: "insufficient_analog_years" }
    );
  }

  // 3. Compute analog-year weights: w_y = exp(-|R21_y - R21_now| / sigma)
  const historicalR21Values = analogCandidates.map((c) => c.r21);
  const { weights, sigma, mean } = analogYearWeights(historicalR21Values, currentR21);

  const analogYearEvidence = analogCandidates
    .map((c, idx) => ({
      year: c.year,
      weight: weights[idx],
      r21: c.r21,
    }))
    .sort((a, b) => b.weight - a.weight);

  // 4. Check forecast dry gap (days 4 to 16 in forecast)
  let dryGapForecast: PlantingEvidence["dryGapForecast"] | undefined;
  const forecastRainDays: Array<{ date: string; rain: number | null }> = [];
  for (let f = 0; f < 16; f++) {
    const d = addDays(asOf, f);
    const rain = extractRainMm(dateMap.get(d));
    forecastRainDays.push({ date: d, rain });
  }

  const { longestDrySpellDays: forecastGapDays } = longestDrySpell(
    forecastRainDays.slice(3).map((f) => f.rain),
    0,
    12,
    DRY_DAY_THRESHOLD_MM
  );

  if (forecastGapDays >= CRITICAL_DRY_SPELL_DAYS) {
    dryGapForecast = {
      found: true,
      lengthDays: forecastGapDays,
      note: `Forecast shows a dry gap of ${forecastGapDays} consecutive days in the upcoming 16-day window`,
    };
  }

  // 5. Simulate each candidate planting window option
  const hectares = options?.hectares ?? DEFAULT_HECTARES;
  const baseYieldKgPerHa = options?.baseYieldKgPerHa ?? DEFAULT_BASE_YIELD_KG_PER_HA;
  const priceNgnPerKg = options?.expectedPricePerKg ?? DEFAULT_MAIZE_PRICE_NGN_PER_KG;
  const seedCost = hectares * DEFAULT_SEED_KG_PER_HA * DEFAULT_SEED_PRICE_NGN_PER_KG;
  const replantLabour = hectares * DEFAULT_REPLANT_LABOUR_NGN_PER_HA;
  const replantCost = seedCost + replantLabour;

  let lambda = DEFAULT_RISK_AVERSION_LAMBDA;
  if (options?.riskAversion === "low") lambda = 0.25;
  if (options?.riskAversion === "high") lambda = 1.0;

  const results: PlantingOption[] = [];

  for (const offsetDays of candidateOffsets) {
    const plantingDate = addDays(asOf, offsetDays);
    const optionKey = offsetDays === 0 ? "plant_now" : `wait_${offsetDays}`;
    const label = offsetDays === 0 ? "Plant now" : `Wait ${offsetDays} days`;

    const replantIndicators: number[] = [];
    const adequacyEstValues: number[] = [];
    const valuesInNaira: number[] = [];

    // Evaluate against each historical analog year
    for (let yi = 0; yi < analogCandidates.length; yi++) {
      const year = analogCandidates[yi].year;

      // Spliced series:
      // - If day is within the 16-day forecast from asOf, prefer forecast rain
      // - Beyond the forecast window, use year y's calendar day rain
      const getSplicedRain = (dayOffsetFromPlanting: number): number => {
        const targetDate = addDays(plantingDate, dayOffsetFromPlanting);
        const deltaFromAsOf = daysBetween(asOf, targetDate);

        // If within 16-day forecast window from asOf and record is marked or present
        if (deltaFromAsOf >= 0 && deltaFromAsOf < 16) {
          const forecastRec = dateMap.get(targetDate);
          const fRain = extractRainMm(forecastRec);
          if (fRain !== null) return fRain;
        }

        // Historical fallback for day in year y
        const alignedAsOfForYear = alignDateToYear(asOf, year);
        const yDate = addDays(alignedAsOfForYear, deltaFromAsOf);
        const yRec = dateMap.get(yDate);
        return extractRainMm(yRec) ?? 0;
      };

      // 1. Seedling stage false-start risk (days 1 to 21 after planting)
      const seedlingRain: number[] = [];
      for (let day = 1; day <= SEEDLING_STAGE_DAYS; day++) {
        seedlingRain.push(getSplicedRain(day));
      }

      const { longestDrySpellDays } = longestDrySpell(seedlingRain, 0, SEEDLING_STAGE_DAYS - 1, DRY_DAY_THRESHOLD_MM);
      const isReplant = longestDrySpellDays > CRITICAL_DRY_SPELL_DAYS ? 1 : 0;
      replantIndicators.push(isReplant);

      // 2. Establishment period adequacy (first 30 days: day 0 to day 30)
      let establishmentRainSum = 0;
      for (let day = 0; day <= ESTABLISHMENT_PERIOD_DAYS; day++) {
        establishmentRainSum += getSplicedRain(day);
      }
      const adequacyEst = Math.min(1.0, establishmentRainSum / ESTABLISHMENT_WATER_NEED_MM);
      adequacyEstValues.push(adequacyEst);

      // 3. Season adequacy (day 0 to day 100) for expected value in Naira
      let seasonRainSum = 0;
      for (let day = 0; day <= SEASON_MATURITY_DAYS; day++) {
        seasonRainSum += getSplicedRain(day);
      }
      const seasonAdequacy = Math.min(1.0, seasonRainSum / SEASON_WATER_NEED_MM);

      const expectedYieldKg = hectares * baseYieldKgPerHa * seasonAdequacy;
      const grossIncome = expectedYieldKg * priceNgnPerKg;
      const netValue = grossIncome - isReplant * replantCost;
      valuesInNaira.push(netValue);
    }

    // Weighted aggregation
    const replantProbability = weightedMean(replantIndicators, weights);
    const adequacyQuantiles = weightedQuantiles(adequacyEstValues, weights);
    const valueQuantiles = weightedQuantiles(valuesInNaira, weights);
    const meanValue = weightedMean(valuesInNaira, weights);

    // Score = expected value minus risk penalty
    const score = Math.round(meanValue - lambda * (replantProbability * replantCost));

    const notes: string[] = [];
    if (replantProbability > 0.35) {
      notes.push("High replanting risk due to dry spells in seedling stage");
    } else if (replantProbability < 0.15) {
      notes.push("Low replanting risk; safe seedling establishment window");
    }

    if (dryGapForecast?.found && offsetDays === 0) {
      notes.push(dryGapForecast.note || "Upcoming dry gap detected in forecast");
    }

    results.push({
      option: optionKey,
      label,
      plantingDate,
      offsetDays,
      replantProbability: Math.round(replantProbability * 1000) / 1000,
      rainfallAdequacy: {
        p10: Math.round(adequacyQuantiles.p10 * 1000) / 1000,
        p50: Math.round(adequacyQuantiles.p50 * 1000) / 1000,
        p90: Math.round(adequacyQuantiles.p90 * 1000) / 1000,
      },
      n: analogCandidates.length,
      evidence: {
        sourceUrls: options?.sourceUrls ?? [],
        analogYears: analogYearEvidence,
        thresholds: {
          dryDayThresholdMm: DRY_DAY_THRESHOLD_MM,
          seedlingStageDays: SEEDLING_STAGE_DAYS,
          criticalDrySpellDays: CRITICAL_DRY_SPELL_DAYS,
          establishmentPeriodDays: ESTABLISHMENT_PERIOD_DAYS,
          establishmentWaterRequirementMm: ESTABLISHMENT_WATER_NEED_MM,
          seasonWaterRequirementMm: SEASON_WATER_NEED_MM,
        },
        dryGapForecast,
        currentR21Mm: Math.round(currentR21 * 10) / 10,
        sigmaR21: Math.round(sigma * 10) / 10,
        meanR21: Math.round(mean * 10) / 10,
        missingDaysCount: currentMissingCount,
      },
      outcome: {
        p10: Math.round(valueQuantiles.p10),
        p50: Math.round(valueQuantiles.p50),
        p90: Math.round(valueQuantiles.p90),
        mean: Math.round(meanValue),
        riskMetric: Math.round(replantProbability * 1000) / 1000,
        riskLabel: "replanting risk",
        n: analogCandidates.length,
      },
      score,
      notes,
    });
  }

  return results;
}
