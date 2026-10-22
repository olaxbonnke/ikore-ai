import type { LLMProvider } from "./provider.ts";

/** NVIDIA Nemotron via OpenAI-compatible API (build.nvidia.com). */
export class NvidiaProvider implements LLMProvider {
  readonly name = "nvidia";

  async complete<T>(_params: import("./provider.ts").LLMCompleteParams<T>): Promise<T> {
    throw new Error("NvidiaProvider not implemented yet");
  }
}
