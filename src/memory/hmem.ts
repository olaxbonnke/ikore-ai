/** Thin wrapper over Meterless H-MEM (DESIGN.md section 9). */

export interface RememberedEvent {
  id: string;
  farmId: string;
  type: string;
  payload: unknown;
}

export async function remember(_farmId: string, _event: unknown): Promise<string> {
  throw new Error("hmem.remember() not implemented yet");
}

export async function ask(_farmId: string, _query: string): Promise<RememberedEvent[]> {
  throw new Error("hmem.ask() not implemented yet");
}

export async function audit(_memoryId: string): Promise<unknown> {
  throw new Error("hmem.audit() not implemented yet");
}

export async function feedback(_memoryId: string, _verdict: "helpful" | "not_helpful"): Promise<void> {
  throw new Error("hmem.feedback() not implemented yet");
}

export async function sleep(_farmId: string, _opts: { preview: boolean }): Promise<void> {
  throw new Error("hmem.sleep() not implemented yet");
}
