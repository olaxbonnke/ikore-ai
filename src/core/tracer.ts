import fs from "node:fs";
import path from "node:path";

export type TraceComponent = "zetaris" | "hmem" | "nightshift" | "orchestrator" | "validator";

export interface TraceStep {
  ts: string;
  run_id: string;
  step: string;
  component: TraceComponent;
  input_summary: string;
  output_summary: string;
  latency_ms: number;
  status: "ok" | "failed" | "skipped";
}

/**
 * Redacts tokens, passwords, keys, and authorization headers from trace text.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let redacted = text;

  // Mask any known active secret values from environment
  const knownSecrets = [
    process.env.METERLESS_RUNTIME_TOKEN,
    process.env.ZETARIS_API_KEY,
    process.env.OKO_PG_PASSWORD,
    process.env.NVIDIA_API_KEY,
  ].filter((s): s is string => typeof s === "string" && s.trim().length > 3);

  for (const secret of knownSecrets) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }

  // Regex rules for headers, tokens, and password pairs
  redacted = redacted.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, "Bearer [REDACTED]");
  redacted = redacted.replace(/(?:password|token|api_key|apiKey|secret|pwd)\s*[:=]\s*["']?[A-Za-z0-9_\-\.]+["']?/gi, "$1=[REDACTED]");
  redacted = redacted.replace(/\b(nvapi-[A-Za-z0-9_\-]+)\b/g, "[REDACTED]");
  redacted = redacted.replace(/\b(rt_[A-Za-z0-9_\-]+)\b/g, "[REDACTED]");

  return redacted;
}

export class RunTracer {
  readonly runId: string;
  readonly traceFilePath: string;
  private readonly relativePath: string;

  constructor(runId?: string) {
    this.runId = runId || `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.relativePath = `logs/trace-${this.runId}.jsonl`;
    this.traceFilePath = path.resolve(process.cwd(), "logs", `trace-${this.runId}.jsonl`);

    const logsDir = path.dirname(this.traceFilePath);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  }

  get traceFile(): string {
    return this.relativePath;
  }

  log(entry: {
    step: string;
    component: TraceComponent;
    input_summary: string;
    output_summary: string;
    latency_ms: number;
    status?: "ok" | "failed" | "skipped";
  }): void {
    const record: TraceStep = {
      ts: new Date().toISOString(),
      run_id: this.runId,
      step: entry.step,
      component: entry.component,
      input_summary: redactSecrets(entry.input_summary),
      output_summary: redactSecrets(entry.output_summary),
      latency_ms: Math.round(entry.latency_ms),
      status: entry.status || "ok",
    };

    const line = JSON.stringify(record) + "\n";
    try {
      fs.appendFileSync(this.traceFilePath, line, "utf8");
    } catch (err: any) {
      console.warn(`[Tracer] Failed writing trace line: ${err.message}`);
    }
  }
}
