// Answer path via Meterless Nightshift (Primary AI Provider)
// Two labeled modes:
//   retrieval-only (default): the answer is assembled from retrieved
//     memories; zero network access, zero keys.
//   model mode: queries OpenAI-compatible endpoint via Meterless Nightshift.
//     The NVIDIA key is managed in Nightshift's Providers tab, not in this project.

import "./core/env.ts";
import { completeChat, getNightshiftConfig } from "./core/nightshift.ts";
import { LLMError } from "./core/errors.ts";

export interface AnswerResult {
  mode: "retrieval-only" | "model";
  text: string;
  model?: string;
}

export async function answer(
  question: string,
  memoryContext: string,
  memories: { relevance: number; content: string }[]
): Promise<AnswerResult> {
  const config = getNightshiftConfig();

  // In SAMPLE_MODE or when no token is present, fall back to retrieval-only
  if (config.sampleMode || !config.token) {
    return { mode: "retrieval-only", text: retrievalOnly(question, memories) };
  }

  try {
    const result = await completeChat({
      system:
        "You are an assistant answering questions strictly using the provided memory context. " +
        "Answer ONLY from the memory context and cite memory ids inline (e.g. mem-1). " +
        "Do not invent facts or use outside knowledge.",
      messages: [
        {
          role: "user",
          content: `${memoryContext}\n\nAnswer using ONLY the memory context above. Cite memory ids inline.\n\nQuestion: ${question}`,
        },
      ],
      temperature: 0.2,
      stepName: "answer",
    });

    const text = result.rawText.trim();
    return { mode: "model", text, model: result.model };
  } catch (err: any) {
    if (err instanceof LLMError) {
      throw err;
    }
    // Safe fallback to retrievalOnly on failure
    return { mode: "retrieval-only", text: retrievalOnly(question, memories) };
  }
}

function retrievalOnly(
  question: string,
  memories: { relevance: number; content: string }[]
): string {
  if (memories.length === 0) {
    return `Nothing in memory answers "${question}" yet. Teach me: notebook remember "<fact>"`;
  }
  const lines = [`Based on what I remember about "${question}":`];
  for (const m of memories) {
    lines.push(`- ${m.content} (relevance ${m.relevance.toFixed(2)})`);
  }
  return lines.join("\n");
}
