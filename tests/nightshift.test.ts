import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeChat, getNightshiftConfig, NightshiftProvider } from "../src/core/nightshift.ts";
import { explain } from "../src/core/explain.ts";
import type { Decision } from "../src/core/types.ts";

describe("Meterless Nightshift Provider (src/core/nightshift.ts)", () => {
  const originalEnv = { ...process.env };

  const mockDecision: Decision = {
    id: "dec_plant_test",
    farmId: "farm_bisi_ogbomoso",
    intent: "plant_timing",
    createdAt: "2026-04-10T08:00:00Z",
    chosen: "wait_7",
    runnerUp: "wait_14",
    confidence: "high",
    riskBadge: "green",
    dataMode: "snapshot",
    assumptions: [],
    evidence: [],
    options: [],
    keyNumbers: {
      asOf: "2026-04-10",
      plantingDate: "2026-04-17",
      replantRisk: "0.7%",
      replantRiskNow: "14.1%",
      rainP50Mm: 159.2,
      nAnalogYears: 35,
      plainChance_plantNow_en: "about 1 in 7 seasons",
      plainChance_wait7_en: "almost never",
    },
  };

  beforeEach(() => {
    vi.stubEnv("METERLESS_BASE_URL", "http://127.0.0.1:8088/v1");
    vi.stubEnv("METERLESS_RUNTIME_TOKEN", "rt_test_secret_token");
    vi.stubEnv("METERLESS_APP", "ikore-ai");
    vi.stubEnv("METERLESS_MODEL", "nvidia/nemotron-3.5-lightning-30b-a3b");
    delete process.env.METERLESS_SCOPE;
    vi.stubEnv("SAMPLE_MODE", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sends request to METERLESS_BASE_URL with Bearer and meterless-app headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        choices: [
          {
            message: {
              content: "Hello from Nightshift",
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await completeChat({
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Test" }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8088/v1/chat/completions");
    expect(options.method).toBe("POST");
    expect(options.headers["Authorization"]).toBe("Bearer rt_test_secret_token");
    expect(options.headers["meterless-app"]).toBe("ikore-ai");
    expect(options.headers["meterless-scope"]).toBeUndefined();
    expect(res.model).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
    expect(res.rawText).toBe("Hello from Nightshift");
  });

  it("sends meterless-scope header only when METERLESS_SCOPE is set", async () => {
    vi.stubEnv("METERLESS_SCOPE", "user");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        choices: [{ message: { content: "OK" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await completeChat({
      system: "Sys",
      messages: [{ role: "user", content: "Hi" }],
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers["meterless-scope"]).toBe("user");
  });

  it("sends chat_template_kwargs { enable_thinking: false } ONLY when model contains 'nemotron'", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        choices: [{ message: { content: "OK" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // 1. With Nemotron model
    vi.stubEnv("METERLESS_MODEL", "nvidia/nemotron-3.5-lightning-30b-a3b");
    await completeChat({
      system: "Sys",
      messages: [{ role: "user", content: "Hi" }],
    });
    let body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });

    fetchMock.mockClear();

    // 2. With non-Nemotron model (e.g. llama or meterless/auto)
    vi.stubEnv("METERLESS_MODEL", "meta/llama-3.1-70b-instruct");
    await completeChat({
      system: "Sys",
      messages: [{ role: "user", content: "Hi" }],
    });
    body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.chat_template_kwargs).toBeUndefined();
  });

  it("captures the model that actually responded from response.model", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: "nvidia/nemotron-actual-responding-model",
        choices: [{ message: { content: "OK" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new NightshiftProvider();
    const res = await provider.completeWithMeta({
      system: "Sys",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(res.model).toBe("nvidia/nemotron-actual-responding-model");
    expect(provider.lastRespondedModel).toBe("nvidia/nemotron-actual-responding-model");
  });

  it("explain() captures responded model and attaches it to Decision.evidence", async () => {
    const validJsonOutput = JSON.stringify({
      headline: "Wait a week. Plant around 17 April.",
      reason:
        "If you plant now, about 1 in 7 seasons needed replanting. If you wait a week, it almost never happened in 35 past seasons.",
      details: ["35 past seasons evaluated"],
      followUpQuestion: null,
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        choices: [{ message: { content: validJsonOutput } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const decisionCopy: Decision = JSON.parse(JSON.stringify(mockDecision));
    const reply = await explain(decisionCopy, "en", new NightshiftProvider());

    expect(reply.path).toBe("llm");
    expect(reply.model).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");

    // Evidence panel verification
    const ev = decisionCopy.evidence.find((e) => e.id === "ev_explanation_model");
    expect(ev).toBeDefined();
    expect(ev?.source).toBe("Meterless Nightshift");
    expect(ev?.statistic).toBe(
      "Written by nvidia/nemotron-3.5-lightning-30b-a3b via Meterless Nightshift"
    );
    expect(ev?.value).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
  });

  it("retries once on 5xx or network failure, then falls back safely to template", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => "Bad Gateway",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "Service Unavailable",
      });
    vi.stubGlobal("fetch", fetchMock);

    const decisionCopy: Decision = JSON.parse(JSON.stringify(mockDecision));
    const reply = await explain(decisionCopy, "en", new NightshiftProvider({ timeoutMs: 1000 }));

    // Retried once (2 calls total)
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Safely fell back to deterministic template
    expect(reply.path).toBe("template");
    expect(reply.text).toContain("Wait a week. Plant around 17 April.");
    expect(reply.fallbackReason).toContain("Nightshift error (HTTP 503)");

    // Evidence item indicates fallback
    const ev = decisionCopy.evidence.find((e) => e.id === "ev_explanation_model");
    expect(ev).toBeDefined();
    expect(ev?.value).toBe("template");
  });

  it("SAMPLE_MODE=true makes NO network call and uses safe template", async () => {
    vi.stubEnv("SAMPLE_MODE", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const decisionCopy: Decision = JSON.parse(JSON.stringify(mockDecision));
    const reply = await explain(decisionCopy, "en");

    // Zero fetch calls
    expect(fetchMock).not.toHaveBeenCalled();

    // Template used
    expect(reply.path).toBe("template");
    expect(reply.model).toBe("template");
    expect(reply.fallbackReason).toBe("SAMPLE_MODE=true");
    expect(reply.text).toContain("Wait a week. Plant around 17 April.");

    // Evidence panel marks Sample Mode
    const ev = decisionCopy.evidence.find((e) => e.id === "ev_explanation_model");
    expect(ev).toBeDefined();
    expect(ev?.source).toBe("Sample Mode");
    expect(ev?.value).toBe("template");
  });

  it("logs warning when METERLESS_MODEL is unset or meterless/auto", async () => {
    vi.stubEnv("METERLESS_MODEL", "meterless/auto");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        model: "meterless/auto",
        choices: [{ message: { content: "OK" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await completeChat({
      system: "Sys",
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("METERLESS_MODEL is unset or meterless/auto")
    );
  });
});
