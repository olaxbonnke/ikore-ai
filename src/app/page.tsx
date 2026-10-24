"use client";

import { useState } from "react";
import Link from "next/link";
import { formatEvidenceView, KNOWN_FARMS, type FormattedEvidenceView } from "@/core/evidence-view";

interface ApiError {
  component?: string;
  message: string;
  valid_farm_ids?: string[];
  run_id?: string;
  trace_file?: string;
}

export default function HomePage() {
  const [selectedFarm, setSelectedFarm] = useState<string>("farm_bisi_ogbomoso");
  const [question, setQuestion] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [response, setResponse] = useState<any | null>(null);
  const [evidenceView, setEvidenceView] = useState<FormattedEvidenceView | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState<boolean>(true);

  const exampleChips = [
    {
      label: "When to plant? (EN)",
      text: "When should I plant my maize this season?",
      farmId: "farm_bisi_ogbomoso",
    },
    {
      label: "Ìgbà wo ni màá gbìn? (YO)",
      text: "Sọ fún mi ìgbà tí màá gbìn àgbàdo",
      farmId: "farm_ade_iseyin",
    },
    {
      label: "Remind me earlier advice (EN)",
      text: "Remind me, when did you say I should plant?",
      farmId: "farm_bisi_ogbomoso",
    },
    {
      label: "Watering maize? (EN)",
      text: "When should I water my maize this month?",
      farmId: "farm_ade_iseyin",
    },
  ];

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!question.trim() || loading) return;

    setLoading(true);
    setError(null);
    setResponse(null);
    setEvidenceView(null);

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          farm_id: selectedFarm,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError({
          component: data?.error?.component || "internal",
          message: data?.error?.message || `Server returned HTTP ${res.status}`,
          valid_farm_ids: data?.error?.valid_farm_ids,
          run_id: data?.run_id,
          trace_file: data?.trace_file,
        });
        return;
      }

      setResponse(data);
      setEvidenceView(formatEvidenceView(data));
    } catch (err: any) {
      setError({
        component: "network",
        message: err.message || "Failed connecting to /api/run",
      });
    } finally {
      setLoading(false);
    }
  }

  function handleChipClick(chip: { text: string; farmId: string }) {
    setQuestion(chip.text);
    setSelectedFarm(chip.farmId);
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <header className="border-b border-oko-soil/20 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wider text-oko-green">
            Ikore AI · Ìkórè
          </p>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-oko-maize/30 px-2.5 py-0.5 text-xs font-semibold text-oko-green">
              Zetaris Live Data
            </span>
            <span className="inline-flex items-center rounded-full bg-oko-maize/30 px-2.5 py-0.5 text-xs font-semibold text-oko-green">
              Meterless H-MEM
            </span>
            <span className="inline-flex items-center rounded-full bg-oko-maize/30 px-2.5 py-0.5 text-xs font-semibold text-oko-green">
              Nemotron via Nightshift
            </span>
          </div>
        </div>

        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-oko-green sm:text-4xl">
          Farm Decision Advisor
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-oko-soil/90 sm:text-base">
          Maize planting-timing, selling, agronomy, and memory recall advisor for smallholder farmers in Oyo State.
          Evaluates false-start replanting risks and price seasonality using federated Zetaris climate
          and market data, provides grounded guidance across all maize operations (watering, fertilizer, weeding, pests, harvesting, storage),
          preserves farmer context in Meterless H-MEM, and explains decisions in
          English, Yoruba, or Pidgin via NVIDIA Nemotron through Meterless Nightshift.
        </p>
      </header>

      {/* Main Interaction Area */}
      <div className="mt-6 space-y-6">
        {/* Form */}
        <form onSubmit={handleSubmit} className="rounded-xl border border-oko-soil/20 bg-white p-5 shadow-sm">
          {/* Farm Picker */}
          <div>
            <label htmlFor="farm-select" className="block text-xs font-bold uppercase tracking-wide text-oko-soil">
              Select Farm Profile
            </label>
            <select
              id="farm-select"
              value={selectedFarm}
              onChange={(e) => setSelectedFarm(e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-oko-soil/30 bg-oko-cream/50 px-3 py-2 text-sm text-oko-soil focus:border-oko-green focus:outline-none focus:ring-1 focus:ring-oko-green"
            >
              {KNOWN_FARMS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} — {f.lga}, {f.state} ({f.crop}, {f.hectares} ha, {f.storage}) [{f.id}]
                </option>
              ))}
            </select>
          </div>

          {/* Example Chips */}
          <div className="mt-4">
            <span className="text-xs font-medium text-oko-soil/80">Example questions:</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {exampleChips.map((chip, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleChipClick(chip)}
                  className="rounded-full border border-oko-green/30 bg-oko-cream px-3 py-1 text-xs text-oko-green hover:bg-oko-maize/30 transition-colors"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* Question Box */}
          <div className="mt-4">
            <label htmlFor="question-input" className="block text-xs font-bold uppercase tracking-wide text-oko-soil">
              Ask a question
            </label>
            <textarea
              id="question-input"
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. When should I plant my maize this season? or Remind me, when did you say I should plant?"
              className="mt-1.5 block w-full rounded-lg border border-oko-soil/30 bg-oko-cream/30 p-3 text-sm text-oko-soil placeholder-oko-soil/50 focus:border-oko-green focus:outline-none focus:ring-1 focus:ring-oko-green"
            />
          </div>

          {/* Submit */}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-oko-soil/70">
              Target API: <code className="font-mono text-oko-green">POST /api/run</code>
            </span>
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-oko-green px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-oko-green/90 disabled:opacity-50 transition-all"
            >
              {loading ? (
                <>
                  <svg
                    className="h-4 w-4 animate-spin text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <span>Reasoning via Nemotron...</span>
                </>
              ) : (
                "Get Advisor Recommendation"
              )}
            </button>
          </div>
        </form>

        {/* Loading Indicator */}
        {loading && (
          <div className="rounded-xl border border-oko-maize/50 bg-oko-maize/10 p-5 text-center animate-pulse">
            <p className="text-sm font-semibold text-oko-green">
              Querying Zetaris federated climate tables and running H-MEM memory recall...
            </p>
            <p className="mt-1 text-xs text-oko-soil/80">
              Evaluating analog weather seasons and generating grounded natural language advice with NVIDIA Nemotron.
            </p>
          </div>
        )}

        {/* Error Card */}
        {error && (
          <div className="rounded-xl border border-oko-risk-red bg-red-50 p-5 text-oko-risk-red shadow-sm">
            <div className="flex items-center gap-2">
              <span className="rounded bg-red-200 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-red-900">
                Component: {error.component || "unknown"}
              </span>
              <span className="text-xs font-semibold text-red-700">Error response from /api/run</span>
            </div>
            <p className="mt-2 text-sm font-semibold text-red-900">{error.message}</p>
            {error.valid_farm_ids && error.valid_farm_ids.length > 0 && (
              <p className="mt-1 text-xs text-red-800">
                Valid farm IDs: <code className="font-mono">{error.valid_farm_ids.join(", ")}</code>
              </p>
            )}
            {error.run_id && (
              <div className="mt-3 text-xs text-red-700">
                Run ID: <code className="font-mono">{error.run_id}</code> | Trace:{" "}
                <code className="font-mono">{error.trace_file}</code>
              </div>
            )}
          </div>
        )}

        {/* Answer Card */}
        {response && (
          <div className="space-y-6">
            <div className="rounded-xl border border-oko-green/30 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-oko-soil/10 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-oko-soil">
                    Advisor Recommendation
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      response.mode === "live"
                        ? "bg-green-100 text-green-800"
                        : "bg-amber-100 text-amber-900"
                    }`}
                  >
                    Mode: {response.mode}
                  </span>
                  <span className="rounded-full bg-oko-cream px-2.5 py-0.5 text-xs font-semibold text-oko-green border border-oko-green/20">
                    Intent: {response.intent}
                  </span>
                  {(!response.decision || response.guidance_type === "general") && (
                    <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-900 border border-blue-300">
                      General guidance — not a data-checked decision
                    </span>
                  )}
                </div>
                <div className="text-xs text-oko-soil/70 font-mono">
                  {response.run_id}
                </div>
              </div>

              {/* Reply Text */}
              <div className="mt-4 whitespace-pre-line text-base leading-relaxed text-oko-soil font-medium">
                {response.reply}
              </div>
            </div>

            {/* Evidence Panel (Collapsible) */}
            {evidenceView && (
              <div className="rounded-xl border border-oko-soil/20 bg-white shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setEvidenceOpen(!evidenceOpen)}
                  className="flex w-full items-center justify-between bg-oko-cream/60 px-5 py-3 text-left hover:bg-oko-cream transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-oko-green">
                      Evidence & Grounding Panel
                    </span>
                    <span className="text-xs text-oko-soil/70">
                      (All values drawn strictly from /api/run response)
                    </span>
                  </div>
                  <span className="text-sm text-oko-soil">
                    {evidenceOpen ? "Hide ▲" : "Show ▼"}
                  </span>
                </button>

                {evidenceOpen && (
                  <div className="divide-y divide-oko-soil/10 p-5 space-y-5 text-sm text-oko-soil">
                    {/* 1. Candidate Options Compared */}
                    {evidenceView.hasDecision && evidenceView.options.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-xs uppercase tracking-wider text-oko-green">
                            Candidate Options Evaluated
                          </h4>
                          {evidenceView.seasonsEvaluated && (
                            <span className="text-xs text-oko-soil/80">
                              Analyzed across <strong className="text-oko-green">{evidenceView.seasonsEvaluated}</strong> past analog seasons
                            </span>
                          )}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          {evidenceView.options.map((opt) => (
                            <div
                              key={opt.option}
                              className={`rounded-lg border p-3 ${
                                opt.isChosen
                                  ? "border-oko-green bg-green-50/60 ring-2 ring-oko-green/20"
                                  : opt.isRunnerUp
                                  ? "border-amber-400 bg-amber-50/40"
                                  : "border-oko-soil/20 bg-white"
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-sm text-oko-soil">{opt.label}</span>
                                {opt.isChosen && (
                                  <span className="rounded bg-oko-green px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                                    Chosen
                                  </span>
                                )}
                                {opt.isRunnerUp && (
                                  <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                                    Runner-Up
                                  </span>
                                )}
                              </div>
                              {opt.plantingDate && (
                                <p className="mt-1 text-xs text-oko-soil/70">
                                  Planting Date: <strong className="text-oko-soil">{opt.plantingDate}</strong>
                                </p>
                              )}
                              {opt.replantProbabilityPct && (
                                <p className="mt-1 text-xs text-oko-soil/70">
                                  Replant Risk: <strong className="text-oko-soil">{opt.replantProbabilityPct}</strong>
                                </p>
                              )}
                              {typeof opt.establishmentRainP50Mm === "number" && (
                                <p className="mt-1 text-xs text-oko-soil/70">
                                  Median Rain (p50): <strong className="text-oko-soil">{opt.establishmentRainP50Mm} mm</strong>
                                </p>
                              )}
                              {opt.notes && (
                                <p className="mt-2 text-[11px] text-oko-soil/80 italic">{opt.notes}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 2. Zetaris Queries Run */}
                    {evidenceView.queriesRun.length > 0 && (
                      <div className="pt-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-xs uppercase tracking-wider text-oko-green">
                            Zetaris Federated SQL Queries Run ({evidenceView.queriesRun.length})
                          </h4>
                          {Object.keys(evidenceView.rowCounts).length > 0 && (
                            <span className="text-xs text-oko-soil/70">
                              Rows: {JSON.stringify(evidenceView.rowCounts)}
                            </span>
                          )}
                        </div>
                        {evidenceView.queriesRun.map((sql, idx) => (
                          <pre
                            key={idx}
                            className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs text-emerald-400"
                          >
                            {sql}
                          </pre>
                        ))}
                      </div>
                    )}

                    {/* 3. Meterless H-MEM Memory */}
                    <div className="pt-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-xs uppercase tracking-wider text-oko-green">
                          Meterless H-MEM Memory
                        </h4>
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-semibold ${
                            evidenceView.memory.used
                              ? "bg-green-100 text-green-900"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {evidenceView.memory.used ? "H-MEM Active" : "Not Used"}
                        </span>
                      </div>
                      <div className="text-xs text-oko-soil/80">
                        Stored Memory ID: <code className="font-mono font-bold text-oko-green">{evidenceView.memory.stored}</code>
                      </div>
                      {evidenceView.memory.recalled.length > 0 && (
                        <div className="mt-2">
                          <span className="text-xs font-semibold text-oko-soil">Recalled Prior Context:</span>
                          <ul className="mt-1 space-y-1 pl-4 list-disc text-xs text-oko-soil/80">
                            {evidenceView.memory.recalled.map((mem, i) => (
                              <li key={i}>{mem}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {/* 4. Model & Nightshift Telemetry */}
                    <div className="pt-4 space-y-2">
                      <h4 className="font-bold text-xs uppercase tracking-wider text-oko-green">
                        Meterless Nightshift & Model Telemetry
                      </h4>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div className="rounded bg-oko-cream/50 p-2">
                          <span className="text-oko-soil/70 block">Provider:</span>
                          <span className="font-bold text-oko-soil">{evidenceView.llm.provider}</span>
                        </div>
                        <div className="rounded bg-oko-cream/50 p-2">
                          <span className="text-oko-soil/70 block">Requested Model:</span>
                          <span className="font-mono text-oko-soil truncate block" title={evidenceView.llm.requestedModel}>
                            {evidenceView.llm.requestedModel}
                          </span>
                        </div>
                        <div className="rounded bg-oko-cream/50 p-2">
                          <span className="text-oko-soil/70 block">Responded Model:</span>
                          <span className="font-mono text-oko-soil truncate block" title={evidenceView.llm.respondedModel}>
                            {evidenceView.llm.respondedModel}
                          </span>
                        </div>
                        <div className="rounded bg-oko-cream/50 p-2">
                          <span className="text-oko-soil/70 block">Latency:</span>
                          <span className="font-bold text-oko-soil">{evidenceView.llm.latencyMs} ms</span>
                        </div>
                      </div>
                      {evidenceView.llm.fallbackUsed && (
                        <p className="text-xs text-amber-700 italic">
                          * Notice: Deterministic grounded template fallback was used for safety
                          {evidenceView.llm.fallbackReason ? ` (${evidenceView.llm.fallbackReason})` : ""}.
                        </p>
                      )}
                    </div>

                    {/* 5. Trace & Provenance */}
                    <div className="pt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-oko-soil/70">
                      <div>
                        Trace File: <code className="font-mono text-oko-green">{evidenceView.traceFile}</code>
                      </div>
                      <div>
                        Run ID: <code className="font-mono text-oko-green">{evidenceView.runId}</code>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
