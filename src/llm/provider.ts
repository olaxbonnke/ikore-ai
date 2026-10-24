import type { ZodType } from "zod";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCompleteParams<T> {
  system: string;
  messages: LLMMessage[];
  json?: ZodType<T>;
  temperature?: number;
  stepName?: string;
  runId?: string;
}

/** LLM provider interface (DESIGN.md section 8.1). */
export interface LLMProvider {
  readonly name: string;
  lastRespondedModel?: string;
  complete<T = string>(params: LLMCompleteParams<T>): Promise<T>;
  completeWithMeta?<T = string>(params: LLMCompleteParams<T>): Promise<{
    content: T;
    rawText: string;
    model: string;
    latencyMs: number;
  }>;
}
