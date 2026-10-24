import type { LLMProvider } from "./provider.ts";
import { NightshiftProvider, type NightshiftConfig } from "../core/nightshift.ts";

/**
 * Meterless Runtime OpenAI-compatible provider (Nightshift).
 * DESIGN.md section 8.1
 */
export class MeterlessProvider extends NightshiftProvider implements LLMProvider {
  readonly name = "meterless";

  constructor(config?: Partial<NightshiftConfig>) {
    super(config);
  }
}
