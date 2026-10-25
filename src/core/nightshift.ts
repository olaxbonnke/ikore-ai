import "./env.ts";
import type { ZodType } from "zod";
import type { LLMCompleteParams, LLMProvider } from "../llm/provider.ts";

export interface NightshiftConfig {
  baseUrl: string;
  token: string;
  model: string;
  app: string;
  scope?: string;
  sampleMode: boolean;
  timeoutMs: number;
}

export interface LLMLogEntry {
  timestamp: string;
  runId: string;
  step: string;
  provider: "nightshift" | "sample" | "template";
  requestedModel: string;
  respondedModel: string;
  latencyMs: number;
  status: "ok" | "failed";
  fallbackUsed: boolean;
}

export function logLLMCall(entry: LLMLogEntry): void {
  console.log(
    `[LLM] timestamp="${entry.timestamp}" run_id="${entry.runId}" step="${entry.step}" provider="${entry.provider}" requested_model="${entry.requestedModel}" responded_model="${entry.respondedModel}" latency_ms=${entry.latencyMs} status="${entry.status}" fallback_used=${entry.fallbackUsed}`
  );
}

export function getNightshiftConfig(overrides?: Partial<NightshiftConfig>): NightshiftConfig {
  const rawBase = overrides?.baseUrl || process.env.METERLESS_BASE_URL || "http://127.0.0.1:8088/v1";
  const baseUrl = rawBase.replace(/\/+$/, "");
  const token = overrides?.token || process.env.METERLESS_RUNTIME_TOKEN || "";
  const model = overrides?.model || process.env.METERLESS_MODEL?.trim() || "";
  const app = overrides?.app || process.env.METERLESS_APP || "ikore-ai";
  const scope = overrides?.scope !== undefined ? overrides.scope : process.env.METERLESS_SCOPE;
  const sampleMode =
    overrides?.sampleMode !== undefined ? overrides.sampleMode : process.env.SAMPLE_MODE === "true";
  const timeoutMs = overrides?.timeoutMs ?? 90000;

  return { baseUrl, token, model, app, scope, sampleMode, timeoutMs };
}

export interface ChatCompletionResult<T = string> {
  content: T;
  rawText: string;
  model: string;
  latencyMs: number;
  finishReason?: string;
  completionTokens?: number;
}

/**
 * OpenAI-compatible chat completions call to Meterless Nightshift runtime.
 */
export async function completeChat<T = string>(
  params: LLMCompleteParams<T>,
  configOverrides?: Partial<NightshiftConfig>
): Promise<ChatCompletionResult<T>> {
  const config = getNightshiftConfig(configOverrides);
  const t0 = Date.now();
  const runId = params.runId || `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const step = params.stepName || "chat";

  if (config.sampleMode) {
    logLLMCall({
      timestamp: new Date().toISOString(),
      runId,
      step,
      provider: "sample",
      requestedModel: "none",
      respondedModel: "none",
      latencyMs: 0,
      status: "ok",
      fallbackUsed: true,
    });
    throw new Error("SAMPLE_MODE=true: Nightshift network calls disabled");
  }

  const requestedModel = config.model || "meterless/auto";
  if (!config.model || config.model === "meterless/auto") {
    console.warn(
      "[Nightshift] Warning: METERLESS_MODEL is unset or meterless/auto; request may route to a non-NVIDIA model."
    );
  }

  const messages = [
    { role: "system", content: params.system },
    ...params.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const body: Record<string, unknown> = {
    model: requestedModel,
    messages,
    temperature: params.temperature ?? 0.2,
    max_tokens: params.maxTokens ?? 1000,
  };

  // Only send chat_template_kwargs when model id contains 'nemotron'
  if (requestedModel.toLowerCase().includes("nemotron")) {
    body.chat_template_kwargs = { enable_thinking: false };
  }

  if (params.json) {
    body.response_format = { type: "json_object" };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "meterless-app": config.app,
  };

  if (config.token) {
    headers["Authorization"] = `Bearer ${config.token}`;
  }

  // Only send meterless-scope if METERLESS_SCOPE is set
  if (config.scope) {
    headers["meterless-scope"] = config.scope;
  }

  const endpoint = `${config.baseUrl}/chat/completions`;

  const attempt = async (): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  };

  let res: Response;
  try {
    res = await attempt();
    if (res.status >= 500) {
      console.warn(`[Nightshift] Received HTTP ${res.status}, retrying once in 500ms...`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      res = await attempt();
    }
  } catch (err: any) {
    console.warn(`[Nightshift] Network error (${err.message}), retrying once in 500ms...`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      res = await attempt();
    } catch (retryErr: any) {
      const latencyMs = Date.now() - t0;
      logLLMCall({
        timestamp: new Date().toISOString(),
        runId,
        step,
        provider: "nightshift",
        requestedModel,
        respondedModel: "none",
        latencyMs,
        status: "failed",
        fallbackUsed: true,
      });
      throw retryErr;
    }
  }

  if (!res.ok) {
    const status = res.status;
    const errText = await res.text().catch(() => "");
    const latencyMs = Date.now() - t0;
    logLLMCall({
      timestamp: new Date().toISOString(),
      runId,
      step,
      provider: "nightshift",
      requestedModel,
      respondedModel: "none",
      latencyMs,
      status: "failed",
      fallbackUsed: true,
    });
    throw new Error(`Nightshift error (HTTP ${status}): ${errText.slice(0, 150)}`);
  }

  const data = (await res.json()) as any;
  const latencyMs = Date.now() - t0;
  const respondedModel = (data.model as string) || requestedModel;
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  const finishReason = choice?.finish_reason as string | undefined;
  const completionTokens = data.usage?.completion_tokens as number | undefined;

  if (typeof content !== "string") {
    logLLMCall({
      timestamp: new Date().toISOString(),
      runId,
      step,
      provider: "nightshift",
      requestedModel,
      respondedModel,
      latencyMs,
      status: "failed",
      fallbackUsed: true,
    });
    throw new Error("Nightshift returned empty content");
  }

  let parsedResult: T;
  if (params.json) {
    const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    parsedResult = params.json.parse(parsed);
  } else {
    parsedResult = content as unknown as T;
  }

  logLLMCall({
    timestamp: new Date().toISOString(),
    runId,
    step,
    provider: "nightshift",
    requestedModel,
    respondedModel,
    latencyMs,
    status: "ok",
    fallbackUsed: false,
  });

  return {
    content: parsedResult,
    rawText: content,
    model: respondedModel,
    latencyMs,
    finishReason,
    completionTokens,
  };
}

/**
 * Primary LLM Provider: Meterless Nightshift OpenAI-compatible client.
 */
export class NightshiftProvider implements LLMProvider {
  readonly name: string;
  private config?: Partial<NightshiftConfig>;
  lastRespondedModel?: string;

  constructor(config?: Partial<NightshiftConfig>, name = "nightshift") {
    this.name = name;
    this.config = config;
  }

  async complete<T = string>(params: LLMCompleteParams<T>): Promise<T> {
    const res = await completeChat<T>(params, this.config);
    this.lastRespondedModel = res.model;
    return res.content;
  }

  async completeWithMeta<T = string>(params: LLMCompleteParams<T>): Promise<ChatCompletionResult<T>> {
    const res = await completeChat<T>(params, this.config);
    this.lastRespondedModel = res.model;
    return res;
  }
}
