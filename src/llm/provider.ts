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
}

/** LLM provider interface (DESIGN.md section 8.1). */
export interface LLMProvider {
  readonly name: string;
  complete<T = string>(params: LLMCompleteParams<T>): Promise<T>;
}
