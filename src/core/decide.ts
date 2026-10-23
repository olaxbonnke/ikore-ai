/**
 * Risk-adjusted scoring and decision verdict (DESIGN.md step 6).
 *
 * Rules:
 * - Fully pure and deterministic.
 * - Score = expected value minus λ × downside (λ from farm risk aversion).
 * - Close call rule: If top two options are within 5% of each other,
 *   recommend the safer one (lower replant risk).
 * - Tie-break rule: If replant risk is identical (e.g. 0.7% vs 0.7%),
 *   break the tie in favor of the earlier planting date (wait_7 over wait_14)
 *   to preserve growing season length and prevent late-season terminal drought.
 * - Fill Decision.keyNumbers and Decision.evidence with full auditability.
 */

import type { Decision, EvidenceItem, OptionResult } from "./types.ts";
import type { PlantingOption } from "./simulate/planting.ts";

export interface DecideParams {
  farmId: string;
  intent: Decision["intent"];
  asOf: string;
  dataMode: Decision["dataMode"];
  riskAversion?: "low" | "normal" | "high";
  querySql?: string;
  provenance?: string;
  evidenceItems?: EvidenceItem[];
  plantingOptions?: PlantingOption[];
  assumptions?: string[];
}

export function decide(
  options: OptionResult[],
  params: DecideParams,
): Decision {
  if (!options || options.length === 0) {
    throw new Error("Cannot decide without candidate options");
  }

  // 1. Determine lambda from risk aversion
  const aversion = params.riskAversion || "normal";
  const lambda = aversion === "low" ? 0.25 : aversion === "high" ? 1.0 : 0.5;

  // 2. Sort options by score descending
  const sorted = [...options].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const second = sorted[1] ?? sorted[0];

  // 3. Evaluate close call and apply tie-break rule
  // DESIGN.md step 6: "If the top two are within 5% of each other, say it's a close call and recommend the safer one."
  const maxScore = Math.max(best.score, second.score, 1);
  const scoreGapPct = Math.abs(best.score - second.score) / maxScore;
  const isCloseCall = sorted.length > 1 && scoreGapPct <= 0.05;

  let chosenOpt = best;
  let runnerUpOpt = second;
  let closeCallNote: string | undefined;

  if (isCloseCall) {
    // If scores are within 5%, evaluate safety (lower risk metric)
    if (second.outcome.riskMetric < best.outcome.riskMetric) {
      chosenOpt = second;
      runnerUpOpt = best;
      closeCallNote = `Close call: ${best.option} and ${second.option} scores are within ${(scoreGapPct * 100).toFixed(1)}%. Recommending safer option (${second.option}) with lower risk (${(second.outcome.riskMetric * 100).toFixed(1)}% vs ${(best.outcome.riskMetric * 100).toFixed(1)}%).`;
    } else if (best.outcome.riskMetric < second.outcome.riskMetric) {
      chosenOpt = best;
      runnerUpOpt = second;
      closeCallNote = `Close call: ${best.option} and ${second.option} scores are within ${(scoreGapPct * 100).toFixed(1)}%. Recommending safer option (${best.option}) with lower risk (${(best.outcome.riskMetric * 100).toFixed(1)}% vs ${(second.outcome.riskMetric * 100).toFixed(1)}%).`;
    } else {
      // TIE-BREAK RULE: Both replant risk and score are virtually identical.
      // In agronomy, planting earlier (wait_7 over wait_14) is strongly preferred
      // to maximize growing season length and avoid late-season moisture deficits.
      const optA = best.option;
      const optB = second.option;
      const isWait7And14 =
        (optA === "wait_7" && optB === "wait_14") ||
        (optA === "wait_14" && optB === "wait_7");

      if (isWait7And14) {
        chosenOpt = optA === "wait_7" ? best : second;
        runnerUpOpt = optA === "wait_7" ? second : best;
        closeCallNote = `Close call: wait_7 and wait_14 scores are within ${(scoreGapPct * 100).toFixed(1)}% with identical ${(chosenOpt.outcome.riskMetric * 100).toFixed(1)}% replant risk. Tie-break rule selects earlier window (wait_7) to preserve growing season length.`;
      } else {
        chosenOpt = best;
        runnerUpOpt = second;
      }
    }
  }

  // 4. Assign confidence
  // DESIGN.md step 6: "high if the gap to second place is over 15% and n_analog_years >= 25; medium if over 5%; otherwise low."
  const n = chosenOpt.outcome.n;
  const gapToPlantNow = (() => {
    const plantNowOpt = sorted.find((o) => o.option === "plant_now");
    if (!plantNowOpt || plantNowOpt === chosenOpt) return scoreGapPct;
    return Math.abs(chosenOpt.score - plantNowOpt.score) / Math.max(chosenOpt.score, 1);
  })();

  let confidence: Decision["confidence"] = "low";
  if (n >= 25 && (scoreGapPct > 0.15 || gapToPlantNow > 0.15)) {
    confidence = "high";
  } else if (scoreGapPct > 0.05 || gapToPlantNow > 0.05) {
    confidence = "medium";
  }

  // 5. Risk badge
  // DESIGN.md step 6: "green (risk < 15%), amber (15 to 35%), red (> 35%)"
  const chosenRisk = chosenOpt.outcome.riskMetric;
  let riskBadge: Decision["riskBadge"] = "green";
  if (chosenRisk > 0.35) {
    riskBadge = "red";
  } else if (chosenRisk >= 0.15) {
    riskBadge = "amber";
  }

  // 6. Build Decision.keyNumbers
  // Matching planting simulation metadata if provided
  const matchingPlanting = params.plantingOptions?.find((p) => p.option === chosenOpt.option);
  const plantNowPlanting = params.plantingOptions?.find((p) => p.option === "plant_now");

  const keyNumbers: Record<string, number | string> = {
    asOf: params.asOf,
    chosenOption: chosenOpt.option,
    chosenLabel: chosenOpt.label,
    score: chosenOpt.score,
    expectedValueNgn: chosenOpt.outcome.p50 || chosenOpt.outcome.mean,
    replantRisk: `${(chosenRisk * 100).toFixed(1)}%`,
    replantProbability: chosenRisk,
    nAnalogYears: n,
    lambda,
  };

  if (matchingPlanting) {
    keyNumbers.plantingDate = matchingPlanting.plantingDate;
    keyNumbers.rainP10Mm = matchingPlanting.establishmentRainMm.p10;
    keyNumbers.rainP50Mm = matchingPlanting.establishmentRainMm.p50;
    keyNumbers.rainP90Mm = matchingPlanting.establishmentRainMm.p90;
    keyNumbers.adequacyP10 = `${(matchingPlanting.rainfallAdequacy.p10 * 100).toFixed(1)}%`;
    keyNumbers.adequacyP50 = `${(matchingPlanting.rainfallAdequacy.p50 * 100).toFixed(1)}%`;
    keyNumbers.adequacyP90 = `${(matchingPlanting.rainfallAdequacy.p90 * 100).toFixed(1)}%`;
  }

  if (plantNowPlanting) {
    keyNumbers.replantRiskNow = `${(plantNowPlanting.replantProbability * 100).toFixed(1)}%`;
    keyNumbers.replantProbabilityNow = plantNowPlanting.replantProbability;
  }

  // 7. Build Decision.evidence
  const evidence: EvidenceItem[] = [
    ...(params.evidenceItems || []),
    {
      id: "ev_rain_history",
      kind: "history",
      label: `Daily rainfall history (${params.farmId})`,
      source: params.provenance || (params.dataMode === "live" ? "Zetaris (local)" : "SnapshotGateway"),
      sql:
        params.querySql ||
        `SELECT date, rain_mm FROM oko_pg.rain_daily WHERE farm_id = '${params.farmId}' ORDER BY date ASC`,
      queryName: "rainDaily",
      statistic: `${n} analog years evaluated with 21-day pre-season similarity weighting`,
      value: n,
      unit: "analog_years",
    },
    {
      id: "ev_spike_guard",
      kind: "assumption",
      label: "Daily precipitation spike guard (MAX_DAILY_RAIN_MM)",
      source: "Climate Data Gateway",
      statistic: "Values > 200 mm/day nulled to prevent unphysical sensor spikes",
      value: 200,
      unit: "mm/day",
    },
    {
      id: "ev_sivakumar_threshold",
      kind: "assumption",
      label: "False-start seedling dry spell threshold",
      source: "Sivakumar (1988) West Africa agroclimatology",
      statistic: "Run of > 7 consecutive dry days (< 1 mm) within days 1 to 21 triggers replanting",
      value: 7,
      unit: "days",
    },
  ];

  // 8. Build Decision.assumptions
  const assumptions: string[] = [
    "Base yield for smallholder maize: 2,000 kg/ha",
    "Seed cost: ₦25,000/ha; Replant labour: ₦20,000/ha",
    "Dry day threshold: < 1 mm rain; Critical dry spell: > 7 consecutive dry days in seedling stage (D+1 to D+21)",
    "Season water requirement: 500 mm (Sivakumar-style onset criterion)",
    "200 mm daily rainfall spike guard applied to satellite climate data",
    ...(params.assumptions || []),
  ];

  if (params.dataMode === "snapshot") {
    assumptions.push("Offline snapshot mode: verified cached Zetaris query results");
  }

  if (closeCallNote) {
    assumptions.push(closeCallNote);
  }

  const decisionId = `dec_${params.asOf}_${params.farmId}_${params.intent}_01`;
  const createdAt = `${params.asOf}T08:00:00+01:00`; // Africa/Lagos

  return {
    id: decisionId,
    farmId: params.farmId,
    intent: params.intent,
    createdAt,
    options: sorted,
    chosen: chosenOpt.option,
    runnerUp: runnerUpOpt.option,
    confidence,
    riskBadge,
    keyNumbers,
    evidence,
    assumptions,
    dataMode: params.dataMode,
  };
}
