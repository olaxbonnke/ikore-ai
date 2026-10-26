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
import { nimetOnset, priceSeasonality, rainDaily } from "../data/queries.ts";
import { templatePlanting, templateSelling, templateUnavailable, templateNoPreviousAdvice, templateOutOfScope, templateAgronomyFallback } from "../i18n/templates.ts";
import { ask, remember, getFarmHMEM, deduplicateMemories } from "../memory/hmem.ts";
import { decide } from "./decide.ts";
import { ZetarisError, LLMError } from "./errors.ts";
import { explain } from "./explain.ts";
import { explainRecall } from "../llm/explain.ts";
import { getFarmProfile } from "./farm-profile.ts";
import { loadRainDaily, loadRecentRain } from "./observe.ts";
import { listOptions } from "./options.ts";
import { DEFAULT_PLANTING_ECONOMICS, simulatePlanting } from "./simulate/planting.ts";
import { simulateSelling, type CashNeed, type MonthlyPriceRecord } from "./simulate/selling.ts";
import type { AgentReply, EvidenceItem, IncomingMessage, OptionResult, Lang } from "./types.ts";
import { RunTracer } from "./tracer.ts";
import { understand } from "./understand.ts";
import { isWateringOrHarvestQuery, explainAgronomy } from "../llm/agronomy.ts";

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

function getAgronomyTransition(topic?: string, lang: Lang = "en"): string {
  if (lang === "yo") {
    switch (topic) {
      case "watering":
        return "Nípa bíbomi rin àgbàdo:";
      case "fertilizer":
        return "Nípa ajilẹ̀:";
      case "pests":
        return "Nípa àwọn kòkòrò:";
      case "weeding":
        return "Nípa ìtulẹ̀ àti koríko:";
      case "spacing":
        return "Nípa ààyè àti ìwọ̀n gbígbìn:";
      case "land_prep":
        return "Nípa ìmúrasílẹ̀ ilẹ̀:";
      case "harvest":
        return "Nípa ìkórè àgbàdo:";
      case "drying":
      case "storage":
        return "Nípa ìtọ́jú àti lílọ àgbàdo:";
      default:
        return "Nípa iṣẹ́ àgbàdo rẹ:";
    }
  } else if (lang === "pcm") {
    switch (topic) {
      case "watering":
        return "On how to water your maize:";
      case "fertilizer":
        return "For fertilizer:";
      case "pests":
        return "For worms and insects:";
      case "weeding":
        return "For clearing grass:";
      case "spacing":
        return "For spacing and how to plant seed:";
      case "land_prep":
        return "For preparing the land:";
      case "harvest":
        return "For harvesting your maize:";
      case "drying":
      case "storage":
        return "For drying and keeping your maize:";
      default:
        return "On your maize farming:";
    }
  } else {
    // English default
    switch (topic) {
      case "watering":
        return "On watering:";
      case "fertilizer":
        return "On fertiliser:";
      case "pests":
        return "On pests and diseases:";
      case "weeding":
        return "On weeding:";
      case "spacing":
        return "On spacing and planting depth:";
      case "land_prep":
        return "On land preparation:";
      case "harvest":
        return "On harvesting:";
      case "drying":
        return "On drying:";
      case "storage":
        return "On storage:";
      default:
        return "On maize management:";
    }
  }
}

export async function handle(message: IncomingMessage): Promise<AgentReply> {
  const config = getConfig();
  const asOf = config.demoDate || "2026-04-10";
  const farmId = message.farmId;
  const isSample = process.env.SAMPLE_MODE === "true";

  const tracer = new RunTracer(message.runId);
  const runId = tracer.runId;
  const traceFile = tracer.traceFile;
  const queriesRun: string[] = [];
  const rowCounts: Record<string, number> = {};
  const recalledMemories: string[] = [];

  // Step 1: Understand
  const tUnderstand = performance.now();
  let understood: any;
  try {
    understood = await understand(message.text, farmId);
  } catch (err: any) {
    tracer.log({
      step: "understand",
      component: "nightshift",
      input_summary: `text="${message.text}" farm_id=${farmId}`,
      output_summary: `error: ${err.message}`,
      latency_ms: Math.round(performance.now() - tUnderstand),
      status: "failed",
    });
    throw err;
  }

  const farm = getFarmProfile(farmId);
  const lang = message.lang || understood.language || farm.preferredLang || "en";
  const usedLlmInUnderstand = understood.meta?.usedLlm ?? false;

  tracer.log({
    step: "understand",
    component: usedLlmInUnderstand ? "nightshift" : "orchestrator",
    input_summary: `text="${message.text}" farm_id=${farmId}`,
    output_summary: `intent=${understood.intent} lang=${lang} slots=${JSON.stringify(understood.slots)}`,
    latency_ms: Math.round(performance.now() - tUnderstand),
    requested_model: understood.meta?.requestedModel,
    responded_model: understood.meta?.respondedModel,
    status: "ok",
  });

  // Handle out_of_scope intent (harvest timing, fertilizer, pests, other crops)
  if (understood.intent === "out_of_scope") {
    const text = templateOutOfScope(lang);
    tracer.log({
      step: "explain",
      component: "orchestrator",
      input_summary: `intent=out_of_scope lang=${lang}`,
      output_summary: `path=template model=template words=${text.split(/\s+/).length}`,
      latency_ms: 1,
      requested_model: "none",
      responded_model: "template",
      status: "ok",
    });
    tracer.log({
      step: "validate",
      component: "validator",
      input_summary: `text_length=${text.length}`,
      output_summary: `status=valid path=template`,
      latency_ms: 1,
      status: "ok",
    });
    return {
      text,
      lang,
      intent: "out_of_scope",
      memoryIdsUsed: [],
      recalledMemories: [],
      path: "template",
      fallbackReason: "out_of_scope",
      model: "template",
      runId,
      traceFile,
      queriesRun: [],
      rowCounts: {},
      decision: undefined,
    };
  }

  // Handle recall_previous intent ("remind me", "what did you tell me", etc.)
  if (understood.intent === "recall_previous") {
    const tRecall = performance.now();
    const hmem = await getFarmHMEM(farmId);
    const allRecords = [...hmem.store.records.values()];
    const adviceRecords = allRecords
      .filter((r: any) => {
        return (
          (Array.isArray(r.tags) && r.tags.includes("type:advice")) ||
          (typeof r.content === "string" &&
            (r.content.includes("Planting advice") ||
              r.content.includes("Sell or store advice") ||
              r.content.includes("advice for")))
        );
      })
      .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));

    const isPlantQuestion = /\b(plant|gbìn|gbin|shuka)\b/i.test(message.text);
    const isSellQuestion = /\b(sell|store|market|tà|tọ́jú|sayar|ajiye)\b/i.test(message.text);

    adviceRecords.sort((a: any, b: any) => {
      if (isPlantQuestion) {
        const aPlant = typeof a.content === "string" && /plant/i.test(a.content);
        const bPlant = typeof b.content === "string" && /plant/i.test(b.content);
        if (aPlant && !bPlant) return -1;
        if (!aPlant && bPlant) return 1;
      } else if (isSellQuestion) {
        const aSell = typeof a.content === "string" && /sell|store/i.test(a.content);
        const bSell = typeof b.content === "string" && /sell|store/i.test(b.content);
        if (aSell && !bSell) return -1;
        if (!aSell && bSell) return 1;
      }
      return (b.timestamp || 0) - (a.timestamp || 0);
    });

    const uniqueAdvice = deduplicateMemories(adviceRecords);
    const memoryIdsUsed: string[] = [];
    const recalledMemories: string[] = [];
    for (const r of uniqueAdvice.slice(0, 3)) {
      memoryIdsUsed.push(r.id);
      recalledMemories.push(r.content);
    }

    tracer.log({
      step: "recall",
      component: "hmem",
      input_summary: `farm_id=${farmId} query="previous advice recommendation"`,
      output_summary: `recalled_count=${memoryIdsUsed.length} ids=${memoryIdsUsed.join(",")}`,
      latency_ms: Math.round(performance.now() - tRecall),
      status: "ok",
    });

    if (adviceRecords.length === 0) {
      const text = templateNoPreviousAdvice(lang);
      tracer.log({
        step: "explain",
        component: "orchestrator",
        input_summary: `intent=recall_previous advice_records=0 lang=${lang}`,
        output_summary: `path=template model=template words=${text.split(/\s+/).length}`,
        latency_ms: 1,
        requested_model: isSample ? "none" : (process.env.METERLESS_MODEL || "none"),
        responded_model: "template",
        status: "ok",
      });
      tracer.log({
        step: "validate",
        component: "validator",
        input_summary: `text_length=${text.length}`,
        output_summary: `status=valid path=template`,
        latency_ms: 1,
        status: "ok",
      });
      return {
        text,
        lang,
        intent: "recall_previous",
        memoryIdsUsed: [],
        recalledMemories: [],
        path: "template",
        fallbackReason: "no_previous_advice",
        model: "template",
        respondedModel: "template",
        runId,
        traceFile,
        queriesRun: [],
        rowCounts: {},
        parts: [
          {
            intent: "recall_previous",
            kind: "guidance",
            reply: text,
            responded_model: "template",
            fallback_used: true,
            fallback_reason: "no_previous_advice",
          },
        ],
      };
    }

    const latestAdvice = adviceRecords[0];
    const tExplain = performance.now();
    const explanation = await explainRecall({
      question: message.text,
      adviceContent: latestAdvice.content,
      lang,
    });

    const reqModel = isSample ? "none" : (process.env.METERLESS_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b");
    const isFallback = explanation.path === "template" || isSample;
    const respModel = isFallback
      ? "template"
      : (explanation.model || process.env.METERLESS_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b");
    const finalFallbackReason = isFallback
      ? (explanation.fallbackReason || "template_by_design")
      : undefined;

    tracer.log({
      step: "explain",
      component: isSample ? "orchestrator" : (explanation.path === "llm" ? "nightshift" : "orchestrator"),
      input_summary: `intent=recall_previous memory_id=${latestAdvice.id} lang=${lang}`,
      output_summary: `path=${explanation.path} model=${respModel} words=${explanation.text.split(/\s+/).length}`,
      latency_ms: Math.round(performance.now() - tExplain),
      requested_model: reqModel,
      responded_model: respModel,
      status: "ok",
    });

    tracer.log({
      step: "validate",
      component: "validator",
      input_summary: `text_length=${explanation.text.length}`,
      output_summary: `status=valid path=${explanation.path}`,
      latency_ms: 1,
      status: "ok",
    });

    return {
      text: explanation.text,
      lang,
      intent: "recall_previous",
      memoryIdsUsed,
      recalledMemories,
      path: explanation.path,
      model: respModel,
      requestedModel: reqModel,
      respondedModel: respModel,
      latencyMs: explanation.latencyMs,
      fallbackReason: finalFallbackReason,
      runId,
      traceFile,
      queriesRun: [],
      rowCounts: {},
      parts: [
        {
          intent: "recall_previous",
          kind: "guidance",
          reply: explanation.text,
          responded_model: respModel,
          fallback_used: isFallback,
          ...(finalFallbackReason ? { fallback_reason: finalFallbackReason } : {}),
        },
      ],
    };
  }

  // Step 2: Recall
  const tRecall = performance.now();
  const memoryIdsUsed: string[] = [];
  try {
    const queryTerm =
      understood.intent === "sell_or_store"
        ? "offered maize price per bag"
        : "planting history and farm profile";
    const retrieved = await ask(farmId, queryTerm);
    if (Array.isArray(retrieved)) {
      for (const m of retrieved) {
        if (m.id) {
          memoryIdsUsed.push(m.id);
          recalledMemories.push(m.content || m.id);
        }
      }
    }
    tracer.log({
      step: "recall",
      component: "hmem",
      input_summary: `farm_id=${farmId} query="${queryTerm}"`,
      output_summary: `recalled_count=${memoryIdsUsed.length} ids=${memoryIdsUsed.join(",")}`,
      latency_ms: Math.round(performance.now() - tRecall),
      status: "ok",
    });
  } catch (err: any) {
    tracer.log({
      step: "recall",
      component: "hmem",
      input_summary: `farm_id=${farmId}`,
      output_summary: `skipped: ${err.message}`,
      latency_ms: Math.round(performance.now() - tRecall),
      status: "skipped",
    });
  }

  // Handle maize_agronomy intent (general guidance for all maize operations)
  if (understood.intent === "maize_agronomy") {
    let recentRain: any = null;
    const needsRain = isWateringOrHarvestQuery(message.text);
    if (needsRain) {
      const tObserve = performance.now();
      try {
        const gateway = getGateway();
        recentRain = await loadRecentRain(gateway, farmId, asOf, 14);
        queriesRun.push(recentRain.querySql);
        rowCounts["recent_rain"] = recentRain.records.length;
        tracer.log({
          step: "observe",
          component: "zetaris",
          input_summary: `farm_id=${farmId} days=14 asOf=${asOf}`,
          output_summary: `rows=${recentRain.records.length} total_rain_mm=${recentRain.totalRainMm.toFixed(1)} sql="${recentRain.querySql}"`,
          latency_ms: Math.round(performance.now() - tObserve),
          status: "ok",
        });
      } catch (err: any) {
        tracer.log({
          step: "observe",
          component: "zetaris",
          input_summary: `farm_id=${farmId} days=14 asOf=${asOf}`,
          output_summary: `skipped: ${err.message}`,
          latency_ms: Math.round(performance.now() - tObserve),
          status: "skipped",
        });
      }
    }

    const tExplain = performance.now();
    const agronomyRes = await explainAgronomy({
      question: message.text,
      farm,
      lang,
      asOf,
      recentRain,
      recalledMemories,
      runId,
    });

    tracer.log({
      step: "explain",
      component: agronomyRes.path === "model" ? "nightshift" : "orchestrator",
      input_summary: `intent=maize_agronomy farm_id=${farmId} lang=${lang}`,
      output_summary: `path=${agronomyRes.path} model=${agronomyRes.model} words=${agronomyRes.text.split(/\s+/).length}`,
      latency_ms: Math.round(performance.now() - tExplain),
      requested_model: agronomyRes.requestedModel,
      responded_model: agronomyRes.respondedModel,
      finish_reason: agronomyRes.finishReason,
      completion_tokens: agronomyRes.completionTokens,
      status: "ok",
    });

    tracer.log({
      step: "validate",
      component: "validator",
      input_summary: `text_length=${agronomyRes.text.length}`,
      output_summary: agronomyRes.fallbackReason ? `status=fallback reason="${agronomyRes.fallbackReason}"` : "status=valid",
      latency_ms: 1,
      status: "ok",
    });

    // Step 8: Remember Q&A in H-MEM
    let storedMemoryId: string | undefined;
    try {
      const tRemember = performance.now();
      const hmem = await getFarmHMEM(farmId);
      const dedupKey = `run:${runId}`;
      const existing = [...hmem.store.records.values()].find((r: any) =>
        r.tags && r.tags.includes(`dedup:${dedupKey}`)
      );
      if (existing) {
        storedMemoryId = existing.id;
      } else {
        const memText = `Question: "${message.text}"\nGuidance: "${agronomyRes.text}"`;
        storedMemoryId = await remember(farmId, {
          type: "agronomy_advice",
          intent: "maize_agronomy",
          runId,
          content: memText,
          tags: ["type:agronomy_advice", "intent:maize_agronomy", `run_id:${runId}`, `dedup:${dedupKey}`, `asOf:${asOf}`],
        });
      }
      tracer.log({
        step: "remember",
        component: "hmem",
        input_summary: `farm_id=${farmId} dedup_key=${dedupKey}`,
        output_summary: `stored_id=${storedMemoryId}`,
        latency_ms: Math.round(performance.now() - tRemember),
        status: "ok",
      });
    } catch (err: any) {
      tracer.log({
        step: "remember",
        component: "hmem",
        input_summary: `farm_id=${farmId}`,
        output_summary: `error: ${err.message}`,
        latency_ms: 1,
        status: "skipped",
      });
    }

    return {
      text: agronomyRes.text,
      lang,
      intent: "maize_agronomy",
      decision: null as any,
      guidance_type: "general",
      askedQuestion: Boolean(agronomyRes.followUp),
      memoryIdsUsed,
      recalledMemories,
      memory: {
        recalled: memoryIdsUsed,
        stored: storedMemoryId,
      },
      path: agronomyRes.path,
      model: agronomyRes.path === "template" ? "template" : agronomyRes.model,
      fallbackReason: agronomyRes.fallbackReason,
      latencyMs: agronomyRes.latencyMs,
      requestedModel: agronomyRes.requestedModel,
      respondedModel: agronomyRes.path === "template" ? "template" : agronomyRes.respondedModel,
      runId,
      traceFile,
      queriesRun,
      rowCounts,
    };
  }

  // Handle sell_or_store intent
  if (understood.intent === "sell_or_store") {
    // Honesty Rule: Price comes ONLY from the farmer (slots or H-MEM recall)
    let currentPricePerBag: number | undefined = understood.slots.pricePerBag as number | undefined;

    if (!currentPricePerBag) {
      try {
        const recalled = await ask(farmId, "offered maize price per bag");
        if (Array.isArray(recalled) && recalled.length > 0) {
          for (const mem of recalled) {
            const mText = mem.content || "";
            // Ignore past season records (e.g. historical sales from 2024/2025)
            if (/past season|sold in 20/i.test(mText)) continue;
            // Ignore previous advice outputs from the agent
            if (/advice|advised/i.test(mText)) continue;
            if (Array.isArray(mem.tags) && mem.tags.includes("advice")) continue;
            // Must indicate a farmer-stated price or offer
            if (!/offer|today|current/i.test(mText)) continue;
            const match = mText.match(/(?:₦|ngn|price|offer|offering|at)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})\s*(?:naira|ngn)?\s*(?:per|\/)?\s*bag/i);
            if (match) {
              const p = Number(match[1].replace(/,/g, ""));
              if (Number.isFinite(p) && p > 0) {
                currentPricePerBag = p;
                if (mem.id && !memoryIdsUsed.includes(mem.id)) memoryIdsUsed.push(mem.id);
                break;
              }
            }
          }
        }
      } catch {
        // Non-fatal
      }
    }

    if (!currentPricePerBag || !Number.isFinite(currentPricePerBag) || currentPricePerBag <= 0) {
      const askText =
        lang === "yo"
          ? "Élò ni àwọn oníṣòwò ń fẹ́ ra àpò àgbàdo kan lọ́wọ́ rẹ lónìí?"
          : lang === "pcm"
          ? "How much dem dey offer you for one bag of corn today?"
          : "What price per bag are buyers offering you today?";
      tracer.log({
        step: "decide",
        component: "orchestrator",
        input_summary: "missing currentPricePerBag",
        output_summary: "asked_farmer_price",
        latency_ms: 0,
      });
      return {
        text: askText,
        lang,
        askedQuestion: true,
        memoryIdsUsed,
        runId,
        traceFile,
        queriesRun,
        rowCounts,
        recalledMemories,
      };
    }

    const bags = (understood.slots.bags as number) || 20;
    const bagWeightKg = (understood.slots.bagWeightKg as number) || 100;
    const storageMethod = (understood.slots.storageMethod as string) || farm.storage || "sack";
    const cashNeed = understood.slots.cashNeed as CashNeed | undefined;

    // Step 3: Observe (query price seasonality via DataGateway)
    const tObserve = performance.now();
    let prices: MonthlyPriceRecord[] = [];
    let pRes: any;
    const pQuery = priceSeasonality(farm.state);
    queriesRun.push(pQuery.sql);
    try {
      const gateway = getGateway();
      pRes = await gateway.query<MonthlyPriceRecord>(pQuery.sql);
      prices = pRes.rows;
      rowCounts["prices"] = prices.length;
      tracer.log({
        step: "observe",
        component: "zetaris",
        input_summary: `query=priceSeasonality state=${farm.state}`,
        output_summary: `rows=${prices.length} provenance=${pRes.provenance}`,
        latency_ms: Math.round(performance.now() - tObserve),
        status: "ok",
      });
    } catch (err: any) {
      tracer.log({
        step: "observe",
        component: "zetaris",
        input_summary: `query=priceSeasonality state=${farm.state}`,
        output_summary: `error: ${err.message}`,
        latency_ms: Math.round(performance.now() - tObserve),
        status: "failed",
      });
      throw err;
    }

    // Step 4: Options
    const candidateKeys = listOptions("sell_or_store", { asOf, cashNeedNgn: cashNeed?.amountNgn });

    // Step 5: Simulate
    const tSimulate = performance.now();
    const simResults = simulateSelling({
      prices,
      asOf,
      currentPricePerBag,
      bags,
      bagWeightKg,
      storageMethod,
      cashNeed,
    });
    tracer.log({
      step: "simulate",
      component: "orchestrator",
      input_summary: `bags=${bags} currentPrice=${currentPricePerBag} method=${storageMethod}`,
      output_summary: `options_simulated=${simResults.length}`,
      latency_ms: Math.round(performance.now() - tSimulate),
      status: "ok",
    });

    // Step 6: Decide
    const tDecide = performance.now();
    const decision = decide(simResults as unknown as OptionResult[], {
      farmId,
      intent: "sell_or_store",
      asOf,
      dataMode: isSample ? "snapshot" : config.dataMode,
      riskAversion: farm.riskAversion,
      querySql: pQuery.sql,
      provenance: pRes.provenance,
      sellingOptions: simResults,
      currentPricePerBag,
      bags,
      storageMethod,
    });
    tracer.log({
      step: "decide",
      component: "orchestrator",
      input_summary: `options=${simResults.map((o) => o.option).join(",")}`,
      output_summary: `chosen=${decision.chosen} runnerUp=${decision.runnerUp} confidence=${decision.confidence}`,
      latency_ms: Math.round(performance.now() - tDecide),
      status: "ok",
    });

    // Step 7: Explain
    const tExplain = performance.now();
    const explanation = await explain(decision, lang);
    const text = explanation.text;
    const reqModel = isSample ? "none" : (process.env.METERLESS_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b");
    const respModel = isSample ? "template" : (explanation.model || "none");
    tracer.log({
      step: "explain",
      component: isSample ? "orchestrator" : (explanation.path === "llm" ? "nightshift" : "orchestrator"),
      input_summary: `decision_id=${decision.id} lang=${lang}`,
      output_summary: `path=${explanation.path} model=${respModel} words=${explanation.text.split(/\s+/).length}${explanation.fallbackReason ? ` fallback_reason="${explanation.fallbackReason}"` : ""}`,
      latency_ms: Math.round(performance.now() - tExplain),
      requested_model: reqModel,
      responded_model: respModel,
      status: "ok",
    });
    tracer.log({
      step: "validate",
      component: "validator",
      input_summary: `text_length=${explanation.text.length}`,
      output_summary: `status=valid path=${explanation.path}`,
      latency_ms: 1,
      status: "ok",
    });

    // Step 8: Remember
    const tRemember = performance.now();
    let storedMemoryId: string | undefined;
    try {
      storedMemoryId = await remember(farmId, {
        type: "advice",
        intent: decision.intent,
        verdict: decision.chosen,
        decisionId: decision.id,
        runId,
        keyNumbers: decision.keyNumbers,
        content: `Question: "${message.text}". Sell or store advice for ${asOf}: ${decision.chosen}. Offered ₦${currentPricePerBag.toLocaleString()}/bag for ${bags} bags. Expected return ₦${Number(decision.keyNumbers.expectedValueNgn).toLocaleString()}.`,
        date: decision.createdAt,
      });
      if (storedMemoryId && !memoryIdsUsed.includes(storedMemoryId)) {
        memoryIdsUsed.push(storedMemoryId);
      }
      tracer.log({
        step: "remember",
        component: "hmem",
        input_summary: `question="${message.text}" verdict=${decision.chosen}`,
        output_summary: `stored_id=${storedMemoryId || "none"}`,
        latency_ms: Math.round(performance.now() - tRemember),
        status: "ok",
      });
    } catch (err: any) {
      tracer.log({
        step: "remember",
        component: "hmem",
        input_summary: `verdict=${decision.chosen}`,
        output_summary: `skipped: ${err.message}`,
        latency_ms: Math.round(performance.now() - tRemember),
        status: "skipped",
      });
    }

    return {
      text,
      lang,
      decision,
      guidance_type: "decision",
      askedQuestion: false,
      memoryIdsUsed,
      path: explanation.path,
      fallbackReason: explanation.fallbackReason,
      latencyMs: explanation.latencyMs,
      model: isSample ? "template" : explanation.model,
      runId,
      traceFile,
      queriesRun,
      rowCounts,
      recalledMemories: deduplicateMemories(recalledMemories.map((c) => ({ content: c }))).map((x) => x.content),
      storedMemoryId,
    };
  }

  // If intent is not planting timing, return temporary unavailable/placeholder
  if (understood.intent !== "plant_timing") {
    tracer.log({
      step: "handle",
      component: "orchestrator",
      input_summary: `unsupported_intent=${understood.intent}`,
      output_summary: "template_unavailable",
      latency_ms: 1,
    });
    return {
      text: templateUnavailable(understood.intent as any, lang),
      lang,
      askedQuestion: false,
      memoryIdsUsed,
      runId,
      traceFile,
      queriesRun,
      rowCounts,
      recalledMemories,
    };
  }

  // Step 3: Observe
  const tObserve = performance.now();
  let loaded: any;
  const gateway = getGateway();
  const query = rainDaily(farmId);
  queriesRun.push(query.sql);

  try {
    loaded = await loadRainDaily(gateway, farmId);
    rowCounts["rain_daily"] = loaded.records.length;
  } catch (err: any) {
    tracer.log({
      step: "observe",
      component: "zetaris",
      input_summary: `farm_id=${farmId} state=${farm.state}`,
      output_summary: `error: ${err.message}`,
      latency_ms: Math.round(performance.now() - tObserve),
      status: "failed",
    });
    throw err;
  }

  // Step 3b: NiMet Onset Benchmark (observed context, NOT input to simulation)
  let nimetRow: any = null;
  let nimetQuerySql: string | undefined;
  try {
    const asOfYear = asOf.split("-")[0];
    const nQuery = nimetOnset(farm.state, asOfYear);
    nimetQuerySql = nQuery.sql;
    queriesRun.push(nQuery.sql);
    const res = await gateway.query<any>(nQuery.sql);
    if (res.rows && res.rows.length > 0) {
      rowCounts["nimet_onset"] = res.rows.length;
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
  tracer.log({
    step: "observe",
    component: "zetaris",
    input_summary: `farm_id=${farmId} state=${farm.state}`,
    output_summary: `rain_rows=${loaded.records.length} nimet_matched=${Boolean(nimetRow)}`,
    latency_ms: Math.round(performance.now() - tObserve),
    status: "ok",
  });

  // Step 4: Options
  const candidateKeys = listOptions(understood.intent, { asOf });

  // Step 5: Simulate
  const tSimulate = performance.now();
  const lambda = farm.riskAversion === "low" ? 0.25 : farm.riskAversion === "high" ? 1.0 : 0.5;
  const simResults = simulatePlanting({
    series: loaded.records,
    asOf,
    options: {
      candidateOffsetsDays: [0, 7, 14],
      economics: {
        hectares: farm.hectares,
        baseYieldKgPerHa: DEFAULT_PLANTING_ECONOMICS.baseYieldKgPerHa,
        expectedPricePerKg: DEFAULT_PLANTING_ECONOMICS.expectedPricePerKg,
        seedCostPerHa: DEFAULT_PLANTING_ECONOMICS.seedCostPerHa,
        replantLabourPerHa: DEFAULT_PLANTING_ECONOMICS.replantLabourPerHa,
        riskAversionLambda: lambda,
      },
    },
  });
  tracer.log({
    step: "simulate",
    component: "orchestrator",
    input_summary: `asOf=${asOf} offsets=0,7,14 series_len=${loaded.records.length}`,
    output_summary: `simulated_options=${simResults.length}`,
    latency_ms: Math.round(performance.now() - tSimulate),
    status: "ok",
  });

  // Step 6: Decide
  const tDecide = performance.now();
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
  tracer.log({
    step: "decide",
    component: "orchestrator",
    input_summary: `options=${simResults.map((o) => o.option).join(",")}`,
    output_summary: `chosen=${decision.chosen} runnerUp=${decision.runnerUp} confidence=${decision.confidence}`,
    latency_ms: Math.round(performance.now() - tDecide),
    status: "ok",
  });

  // Step 7: Explain
  const tExplain = performance.now();
  const explanation = await explain(
    decision,
    lang,
    undefined,
    understood.slots?.focus as string | undefined
  );
  const text = explanation.text;
  const reqModelPlant = isSample ? "none" : (process.env.METERLESS_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b");
  const respModelPlant = isSample ? "template" : (explanation.model || "none");
  tracer.log({
    step: "explain",
    component: isSample ? "orchestrator" : (explanation.path === "llm" ? "nightshift" : "orchestrator"),
    input_summary: `decision_id=${decision.id} lang=${lang}`,
    output_summary: `path=${explanation.path} model=${respModelPlant} words=${explanation.text.split(/\s+/).length}${explanation.fallbackReason ? ` fallback_reason="${explanation.fallbackReason}"` : ""}`,
    latency_ms: Math.round(performance.now() - tExplain),
    requested_model: reqModelPlant,
    responded_model: respModelPlant,
    status: "ok",
  });
  tracer.log({
    step: "validate",
    component: "validator",
    input_summary: `text_length=${explanation.text.length}`,
    output_summary: `status=valid path=${explanation.path}`,
    latency_ms: 1,
    status: "ok",
  });

  // Step 8: Remember
  const tRemember = performance.now();
  let storedMemoryId: string | undefined;
  try {
    storedMemoryId = await remember(farmId, {
      type: "advice",
      intent: decision.intent,
      verdict: decision.chosen,
      decisionId: decision.id,
      runId,
      keyNumbers: decision.keyNumbers,
      content: `Question: "${message.text}". Planting advice for ${asOf}: ${decision.chosen}. Planting date ${decision.keyNumbers.plantingDate}. Replant risk ${decision.keyNumbers.replantRisk}, expected value ₦${Number(decision.keyNumbers.expectedValueNgn).toLocaleString()}.`,
      date: decision.createdAt,
    });
    if (storedMemoryId && !memoryIdsUsed.includes(storedMemoryId)) {
      memoryIdsUsed.push(storedMemoryId);
    }
    tracer.log({
      step: "remember",
      component: "hmem",
      input_summary: `question="${message.text}" verdict=${decision.chosen}`,
      output_summary: `stored_id=${storedMemoryId || "none"}`,
      latency_ms: Math.round(performance.now() - tRemember),
      status: "ok",
    });
  } catch (err: any) {
    tracer.log({
      step: "remember",
      component: "hmem",
      input_summary: `verdict=${decision.chosen}`,
      output_summary: `skipped: ${err.message}`,
      latency_ms: Math.round(performance.now() - tRemember),
      status: "skipped",
    });
  }

  // If this was a compound question with a secondary maize_agronomy part, run and join it
  const secondaryPart = Array.isArray(understood.intents)
    ? understood.intents.find((p: any) => p.intent === "maize_agronomy")
    : undefined;

  let finalReplyText = text;
  let replyParts: any[] | undefined = undefined;

  if (secondaryPart) {
    const tAgStart = performance.now();
    let agronomyRes: any;
    try {
      agronomyRes = await explainAgronomy({
        question: message.text,
        farm,
        lang,
        asOf,
        topic: secondaryPart.topic,
        recentRain: undefined,
        recalledMemories,
      });
    } catch (agErr: any) {
      console.warn("[Compound] Agronomy secondary step failed:", agErr.message);
      agronomyRes = {
        text: templateAgronomyFallback(secondaryPart.topic, lang),
        path: "template",
        model: "template",
        fallbackReason: `llm_error: ${agErr.message}`,
      };
    }

    tracer.log({
      step: "explain",
      component: agronomyRes.path === "model" ? "nightshift" : "orchestrator",
      input_summary: `part=secondary intent=maize_agronomy topic=${secondaryPart.topic || "general"} farm_id=${farmId} lang=${lang}`,
      output_summary: `path=${agronomyRes.path} model=${agronomyRes.model} words=${agronomyRes.text.split(/\s+/).length}`,
      latency_ms: Math.round(performance.now() - tAgStart),
      requested_model: agronomyRes.requestedModel,
      responded_model: agronomyRes.respondedModel,
      status: "ok",
    });

    tracer.log({
      step: "validate",
      component: "validator",
      input_summary: `part=secondary text_length=${agronomyRes.text.length}`,
      output_summary: agronomyRes.fallbackReason ? `status=fallback reason="${agronomyRes.fallbackReason}"` : "status=valid",
      latency_ms: 1,
      status: "ok",
    });

    const transitionLine = getAgronomyTransition(secondaryPart.topic, lang);
    finalReplyText = `${text}\n\n${transitionLine}\n${agronomyRes.text}`;

    const primaryFallbackUsed = explanation.path === "template" || isSample;
    const primaryModel = primaryFallbackUsed ? "template" : (explanation.model || "template");
    const primaryFallbackReason = !isSample && (explanation.path === "template" || explanation.fallbackReason)
      ? (explanation.fallbackReason || "template_by_design")
      : undefined;

    const secondaryFallbackUsed = agronomyRes.path === "template" || isSample;
    const secondaryModel = secondaryFallbackUsed ? "template" : (agronomyRes.respondedModel || agronomyRes.model || "template");
    const secondaryFallbackReason = !isSample && (agronomyRes.path === "template" || agronomyRes.fallbackReason)
      ? (agronomyRes.fallbackReason || "template_by_design")
      : undefined;

    replyParts = [
      {
        intent: "plant_timing",
        kind: "decision",
        reply: text,
        responded_model: primaryModel,
        fallback_used: primaryFallbackUsed,
        ...(primaryFallbackReason ? { fallback_reason: primaryFallbackReason } : {}),
      },
      {
        intent: "maize_agronomy",
        kind: "guidance",
        topic: secondaryPart.topic,
        reply: agronomyRes.text,
        responded_model: secondaryModel,
        fallback_used: secondaryFallbackUsed,
        ...(secondaryFallbackReason ? { fallback_reason: secondaryFallbackReason } : {}),
      },
    ];
  }

  return {
    text: finalReplyText,
    lang,
    decision,
    guidance_type: "decision",
    askedQuestion: false,
    memoryIdsUsed,
    path: explanation.path,
    fallbackReason: explanation.fallbackReason,
    latencyMs: explanation.latencyMs,
    model: isSample ? "template" : explanation.model,
    runId,
    traceFile,
    queriesRun,
    rowCounts,
    recalledMemories: deduplicateMemories(recalledMemories.map((c) => ({ content: c }))).map((x) => x.content),
    storedMemoryId,
    parts: replyParts,
  };
}
