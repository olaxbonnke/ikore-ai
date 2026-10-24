import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getConfig } from "@/config";
import { ZetarisError, LLMError } from "@/core/errors";
import { initEnv } from "@/core/env";
import { handle } from "@/core/orchestrator";
import type { AgentReply } from "@/core/types";

export async function POST(req: Request) {
  initEnv();

  const body = await req.json().catch(() => ({}));
  const question = body.question;
  if (!question || typeof question !== "string") {
    return NextResponse.json(
      { error: "question string is required" },
      {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  const farmId = typeof body.farm_id === "string" && body.farm_id.trim() ? body.farm_id.trim() : "farm_bisi_ogbomoso";
  const lang = body.lang as "en" | "yo" | "pcm" | undefined;
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  let reply: AgentReply;
  try {
    reply = await handle({
      farmId,
      text: question,
      lang,
      runId,
    });
  } catch (err: any) {
    const isZetaris =
      err instanceof ZetarisError ||
      /zetaris/i.test(err.name || "") ||
      /zetaris|oko_pg|rain_daily|priceSeasonality|nimet_onset/i.test(err.message || "");
    const component = isZetaris ? "zetaris" : "nightshift";

    return NextResponse.json(
      {
        error: {
          component,
          message: err.message || "External service unreachable",
        },
        run_id: runId,
        trace_file: `logs/trace-${runId}.jsonl`,
      },
      {
        status: 503,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    );
  }

  const config = getConfig();
  const isSample = process.env.SAMPLE_MODE === "true";
  const mode: "live" | "sample" = isSample ? "sample" : (config.dataMode === "live" ? "live" : "sample");

  const hasHmem =
    (Array.isArray(reply.recalledMemories) && reply.recalledMemories.length > 0) ||
    Boolean(reply.storedMemoryId);

  return NextResponse.json(
    {
      run_id: reply.runId || runId,
      mode,
      intent: reply.decision?.intent || "unknown",
      decision: reply.decision || null,
      reply: reply.text,
      evidence: reply.decision?.keyNumbers || {},
      llm: {
        provider: isSample ? "sample" : (reply.path === "llm" ? "nightshift" : "template"),
        requested_model: isSample ? "none" : (process.env.METERLESS_MODEL || "meterless/auto"),
        responded_model: isSample ? "template" : (reply.model || "template"),
        latency_ms: reply.latencyMs ?? 0,
        fallback_used: reply.path === "template",
      },
      zetaris: {
        queries_run: reply.queriesRun || [],
        row_counts: reply.rowCounts || {},
      },
      memory: {
        hmem_used: hasHmem,
        recalled: reply.recalledMemories || [],
        stored: reply.storedMemoryId || "none",
      },
      trace_file: reply.traceFile || `logs/trace-${runId}.jsonl`,
    },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    }
  );
}
