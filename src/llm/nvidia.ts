import type { LLMProvider } from "./provider.ts";
import { NightshiftProvider, type NightshiftConfig } from "../core/nightshift.ts";

export interface NvidiaProviderConfig extends Partial<NightshiftConfig> {}

/**
 * @deprecated All LLM calls now route through Meterless Nightshift as the primary provider.
 * This class wraps NightshiftProvider to preserve backwards compatibility without direct NVIDIA keys.
 */
export class NvidiaProvider extends NightshiftProvider implements LLMProvider {
  readonly name = "nvidia";

  constructor(config?: NvidiaProviderConfig) {
    super(config);
  }
}
