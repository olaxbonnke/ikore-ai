// Answer path. Two labeled modes:
//   retrieval-only (default): the answer is assembled from retrieved
//     memories; zero network access, zero keys.
//   model mode: when NVIDIA_API_KEY is set, queries NVIDIA Nemotron via
//     the OpenAI-compatible chat/completions endpoint using the openai package.

import dotenv from "dotenv";
import OpenAI from "openai";
import { LLMError } from "./core/errors.ts";

dotenv.config();

export interface AnswerResult {
  mode: "retrieval-only" | "model";
  text: string;
}

type NemotronChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & {
  chat_template_kwargs?: {
    enable_thinking?: boolean;
  };
};

export async function answer(
  question: string,
  memoryContext: string,
  memories: { relevance: number; content: string }[]
): Promise<AnswerResult> {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  if (!apiKey) {
    return { mode: "retrieval-only", text: retrievalOnly(question, memories) };
  }

  const baseURL = (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");
  const model = process.env.NEMOTRON_MODEL?.trim() || "nvidia/nemotron-3.5-lightning-30b-a3b";

  const client = new OpenAI({
    apiKey,
    baseURL,
  });

  try {
    const params: NemotronChatCompletionParams = {
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
      chat_template_kwargs: { enable_thinking: false },
    };

    const response = await client.chat.completions.create(params);
    const text = response.choices[0]?.message?.content?.trim() ?? "";
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
