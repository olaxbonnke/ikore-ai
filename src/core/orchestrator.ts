import type { AgentReply, IncomingMessage } from "./types.ts";

/** 8-step agent loop (DESIGN.md section 4). Logic added in Day 3+. */
export async function handle(_message: IncomingMessage): Promise<AgentReply> {
  throw new Error("Orchestrator not implemented yet");
}
