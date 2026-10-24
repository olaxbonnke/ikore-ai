import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getConfig } from "@/config";
import { initEnv } from "@/core/env";
import { handle } from "@/core/orchestrator";

export async function POST(req: Request) {
  initEnv();

  const body = await req.json().catch(() => ({}));
  const question = body.question;
  if (!question || typeof question !== "string") {
    return NextResponse.json({ error: "question string is required" }, { status: 400 });
  }

  const farmId = typeof body.farm_id === "string" && body.farm_id.trim() ? body.farm_id.trim() : "farm_bisi_ogbomoso";
  const lang = body.lang as "en" | "yo" | "pcm" | undefined;

  const reply = await handle({
    farmId,
    text: question,
    lang,
  });

  const config = getConfig();
  const isSample = process.env.SAMPLE_MODE === "true";
  const mode: "live" | "sample" = isSample ? "sample" : (config.dataMode === "live" ? "live" : "sample");

  return NextResponse.json({
    run_id: reply.runId || randomUUID(),
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
      hmem_used: (reply.memoryIdsUsed && reply.memoryIdsUsed.length > 0) || false,
      recalled: reply.recalledMemories || [],
    },
    trace_file: reply.traceFile || (reply.runId ? `logs/trace-${reply.runId}.jsonl` : ""),
  });
}
