import type { LLMCompleteParams, LLMProvider } from "./provider.ts";

export interface NvidiaProviderConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

/** NVIDIA Nemotron via NVIDIA's API (build.nvidia.com, OpenAI-compatible format) - DESIGN.md section 8.1 */
export class NvidiaProvider implements LLMProvider {
  readonly name = "nvidia";
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config?: NvidiaProviderConfig) {
    this.baseUrl = (config?.baseUrl || process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");
    this.apiKey = config?.apiKey || process.env.NVIDIA_API_KEY || "";
    this.model = config?.model || process.env.NEMOTRON_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b";
  }

  async complete<T = string>(params: LLMCompleteParams<T>): Promise<T> {
    if (!this.apiKey) {
      throw new Error("NvidiaProvider: missing NVIDIA_API_KEY in environment");
    }

    const messages = [
      { role: "system", content: params.system },
      ...params.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: params.temperature ?? 0.2,
      max_tokens: 600,
      chat_template_kwargs: { enable_thinking: false },
    };

    if (params.json) {
      body.response_format = { type: "json_object" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      let res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.status === 502 || res.status === 503) {
        console.warn(`[NvidiaProvider] Received HTTP ${res.status}, retrying once in 500ms...`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      }

      if (!res.ok) {
        const status = res.status;
        const errText = await res.text().catch(() => "");
        throw new Error(`NvidiaProvider error (HTTP ${status}): ${errText.slice(0, 150)}`);
      }

      const data = (await res.json()) as any;
      const choice = data.choices?.[0];
      const reasoning = choice?.message?.reasoning_content;
      if (reasoning) {
        console.warn("[NvidiaProvider] Notice: reasoning_content present in response despite enable_thinking: false");
      } else {
        console.log("[NvidiaProvider] Confirmed: response has no reasoning content (enable_thinking: false)");
      }

      const content = choice?.message?.content;
      if (typeof content !== "string") {
        throw new Error("NvidiaProvider returned empty content");
      }

      if (params.json) {
        // Strip markdown fences if any were included
        const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
        const parsed = JSON.parse(cleaned);
        return params.json.parse(parsed);
      }

      return content as unknown as T;
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error("NvidiaProvider: request timed out after 30s");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}
