import type { LLMProvider } from "./provider.ts";

/** Meterless Runtime OpenAI-compatible provider. */
export class MeterlessProvider implements LLMProvider {
  readonly name = "meterless";

  async complete<T>(_params: import("./provider.ts").LLMCompleteParams<T>): Promise<T> {
    throw new Error("MeterlessProvider not implemented yet");
  }
}
