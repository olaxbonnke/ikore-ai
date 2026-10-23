/**
 * 8-step agent loop (DESIGN.md section 4).
 *
 * Steps:
 * 1. Understand (intent + language extraction)
 * 2. Recall (retrieve past context & profile from H-MEM)
 * 3. Observe (query rainfall & market data via DataGateway)
 * 4. Options (generate candidate choices per intent)
 * 5. Simulate (pure analog-year & agronomic physics simulation)
 * 6. Decide (risk-adjusted scoring, tie-breaking, and verdict)
 * 7. Explain (grounded explanation in farmer's preferred language)
 * 8. Remember (commit advice & audit trail to H-MEM)
 */

import { getConfig } from "../config.ts";
import { getGateway } from "../data/gateway.ts";
import { nimetOnset, rainDaily } from "../data/queries.ts";
import { templatePlanting, templateUnavailable } from "../i18n/templates.ts";
import { ask, remember } from "../memory/hmem.ts";
import { decide } from "./decide.ts";
import { getFarmProfile } from "./farm-profile.ts";
import { loadRainDaily } from "./observe.ts";
import { listOptions } from "./options.ts";
import { simulatePlanting } from "./simulate/planting.ts";
import type { AgentReply, EvidenceItem, IncomingMessage, OptionResult } from "./types.ts";
import { understand } from "./understand.ts";

export function formatNiMetBenchmarkEvidence(
  row: {
    state: string;
    season: number | string;
    onset_start: string;
    onset_end: string;
    source_name?: string;
    source_url?: string;
  },
  suggestedDate: string,
  querySql?: string
): EvidenceItem {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const parsePart = (dStr: string) => {
    const parts = dStr.split("-");
    const d = parseInt(parts[2], 10);
    const m = months[parseInt(parts[1], 10) - 1];
    return { day: d, month: m };
  };

  const start = parsePart(row.onset_start);
  const end = parsePart(row.onset_end);
  const rec = parsePart(suggestedDate);

  const windowStr =
    start.month === end.month
      ? `${start.day} and ${end.day} ${end.month}`
      : `${start.day} ${start.month} and ${end.day} ${end.month}`;

  const recStr = `${rec.day} ${rec.month}`;

  const isInside = suggestedDate >= row.onset_start && suggestedDate <= row.onset_end;
  const comparison = isInside ? "falls inside that window." : "falls outside that window.";
  const statistic = `NiMet's ${row.season} forecast puts onset in ${row.state} between ${windowStr}. Ikore's suggested date, ${recStr}, ${comparison}`;

  return {
    id: "ev_nimet_benchmark",
    kind: "forecast",
    label: `NiMet ${row.season} Seasonal Climate Prediction benchmark (${row.state})`,
    source: row.source_name || "NiMet 2026 Seasonal Climate Prediction",
    sql: querySql,
    queryName: "nimetOnset",
    statistic,
    value: isInside ? "inside" : "outside",
  };
}

export async function handle(message: IncomingMessage): Promise<AgentReply> {
  const config = getConfig();
  const asOf = config.demoDate || "2026-04-10";
  const farmId = message.farmId;

  // Step 1: Understand
  const understood = await understand(message.text, farmId);
  const farm = getFarmProfile(farmId);
  const lang = understood.language || farm.preferredLang || "en";

  // Step 2: Recall
  const memoryIdsUsed: string[] = [];
  try {
    const retrieved = await ask(farmId, "planting history and farm profile");
    if (Array.isArray(retrieved)) {
      for (const m of retrieved) {
        if (m.id) memoryIdsUsed.push(m.id);
      }
    }
  } catch {
    // Non-fatal if H-MEM is unseeded
  }

  // If intent is not planting timing, return temporary unavailable/placeholder
  if (understood.intent !== "plant_timing") {
    return {
      text: templateUnavailable(understood.intent as any, lang),
      lang,
      askedQuestion: false,
      memoryIdsUsed,
    };
  }

  // Step 3: Observe
  const gateway = getGateway();
  const loaded = await loadRainDaily(gateway, farmId);
  const query = rainDaily(farmId);

  // Step 3b: NiMet Onset Benchmark (observed context, NOT input to simulation)
  let nimetRow: any = null;
  let nimetQuerySql: string | undefined;
  try {
    const asOfYear = asOf.split("-")[0];
    const nQuery = nimetOnset(farm.state, asOfYear);
    nimetQuerySql = nQuery.sql;
    const res = await gateway.query<any>(nQuery.sql);
    if (res.rows && res.rows.length > 0) {
      const match = res.rows.find(
        (r: any) =>
          String(r.state).toLowerCase() === farm.state.toLowerCase() &&
          String(r.season) === asOfYear
      );
      if (match) {
        nimetRow = match;
      }
    }
  } catch {
    // Skip silently if no row exists or table not available
  }

  // Step 4: Options
  const candidateKeys = listOptions(understood.intent, { asOf });

  // Step 5: Simulate
  const lambda = farm.riskAversion === "low" ? 0.25 : farm.riskAversion === "high" ? 1.0 : 0.5;
  const simResults = simulatePlanting({
    series: loaded.records,
    asOf,
    options: {
      candidateOffsetsDays: [0, 7, 14],
      economics: {
        hectares: farm.hectares,
        baseYieldKgPerHa: 2000,
        expectedPricePerKg: 350,
        seedCostPerHa: 25000,
        replantLabourPerHa: 20000,
        riskAversionLambda: lambda,
      },
    },
  });

  // Step 6: Decide
  const decision = decide(simResults as unknown as OptionResult[], {
    farmId,
    intent: "plant_timing",
    asOf,
    dataMode: config.dataMode,
    riskAversion: farm.riskAversion,
    querySql: query.sql,
    provenance: loaded.provenance,
    plantingOptions: simResults,
  });

  // Attach NiMet onset benchmark evidence if available for this state & season
  if (nimetRow && decision.keyNumbers.plantingDate) {
    const benchmarkItem = formatNiMetBenchmarkEvidence(
      nimetRow,
      String(decision.keyNumbers.plantingDate),
      nimetQuerySql
    );
    decision.evidence.push(benchmarkItem);
  }

  // Step 7: Explain
  const text = templatePlanting(decision, lang);

  // Step 8: Remember
  try {
    const memoryId = await remember(farmId, {
      type: "advice",
      intent: decision.intent,
      verdict: decision.chosen,
      decisionId: decision.id,
      keyNumbers: decision.keyNumbers,
      content: `Planting advice for ${asOf}: ${decision.chosen}. Replant risk ${decision.keyNumbers.replantRisk}, expected value ₦${decision.keyNumbers.expectedValueNgn}.`,
      date: decision.createdAt,
    });
    if (memoryId) {
      memoryIdsUsed.push(memoryId);
    }
  } catch (err: any) {
    console.warn(`! Note: Could not commit to H-MEM: ${err.message}`);
  }

  return {
    text,
    lang,
    decision,
    askedQuestion: false,
    memoryIdsUsed,
  };
}
