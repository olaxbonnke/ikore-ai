// Answer path. Two labeled modes:
//   retrieval-only (default): the answer is assembled from retrieved
//     memories; zero network access, zero keys.
//   model mode: when NVIDIA_API_KEY is set, queries NVIDIA Nemotron via
//     the OpenAI-compatible chat/completions endpoint.

import { LLMError } from "./core/errors.ts";

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch {
    // Ignore when .env does not exist
  }
}

export interface AnswerResult {
  mode: "retrieval-only" | "model";
  text: string;
}

export async function answer(
  question: string,
  memoryContext: string,
  memories: { relevance: number; content: string }[]
): Promise<AnswerResult> {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  if (!apiKey) {
    return { mode: "retrieval-only", text: retrievalOnly(question, memories) };
  }

  const baseUrl = (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");
  const model = process.env.NEMOTRON_MODEL || process.env.NVIDIA_MODEL || "nvidia/nemotron-4-340b-instruct";

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are an assistant answering questions strictly using the provided memory context. " +
              "Answer ONLY from the memory context and cite memory ids inline (e.g. mem-1). " +
              "Do not invent facts or use outside knowledge.",
          },
          {
            role: "user",
            content: `${memoryContext}\n\nAnswer using ONLY the memory context above. Cite memory ids inline.\n\nQuestion: ${question}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 400,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new LLMError(`NVIDIA Nemotron API request failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    return { mode: "model", text };
  } catch (err) {
    if (err instanceof LLMError) {
      throw err;
    }
    throw new LLMError("Failed to query NVIDIA Nemotron model", { cause: err });
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
