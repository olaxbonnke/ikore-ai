/**
 * Pure helpers for mapping /api/run responses to UI presentation.
 * All numbers and strings are drawn strictly from the API response payload.
 */

export interface FarmOption {
  id: string;
  name: string;
  lga: string;
  state: string;
  crop: string;
  hectares: number;
  storage: string;
  preferredLang: string;
  label: string;
}

export const KNOWN_FARMS: FarmOption[] = [
  {
    id: "farm_bisi_ogbomoso",
    name: "Mama Bisi",
    lga: "Ogbomoso North",
    state: "Oyo",
    crop: "maize",
    hectares: 2,
    storage: "sack",
    preferredLang: "pcm",
    label: "Mama Bisi — Ogbomoso North, Oyo (farm_bisi_ogbomoso)",
  },
  {
    id: "farm_ade_iseyin",
    name: "Baba Ade",
    lga: "Iseyin",
    state: "Oyo",
    crop: "maize",
    hectares: 1.5,
    storage: "pics",
    preferredLang: "yo",
    label: "Baba Ade — Iseyin, Oyo (farm_ade_iseyin)",
  },
];

export interface FormattedOption {
  option: string;
  label: string;
  isChosen: boolean;
  isRunnerUp: boolean;
  plantingDate?: string;
  replantProbabilityPct?: string;
  establishmentRainP50Mm?: number;
  notes?: string;
}

export interface FormattedEvidenceView {
  hasDecision: boolean;
  options: FormattedOption[];
  seasonsEvaluated?: number;
  queriesRun: string[];
  rowCounts: Record<string, number>;
  memory: {
    used: boolean;
    recalled: string[];
    stored: string;
  };
  llm: {
    provider: string;
    requestedModel: string;
    respondedModel: string;
    latencyMs: number;
    fallbackUsed: boolean;
  };
  runId: string;
  traceFile: string;
  assumptions?: string[];
}

/**
 * Pure mapping of /api/run JSON response to evidence view model.
 * Does not synthesize or guess missing fields.
 */
export function formatEvidenceView(data: any): FormattedEvidenceView {
  const decision = data?.decision;
  const evidence = data?.evidence || {};
  const chosen = decision?.chosen;
  const runnerUp = decision?.runnerUp;

  const rawOptions: any[] = Array.isArray(decision?.options) ? decision.options : [];
  const options: FormattedOption[] = rawOptions.map((opt) => {
    const isChosen = Boolean(chosen && opt.option === chosen);
    const isRunnerUp = Boolean(runnerUp && opt.option === runnerUp);

    let replantProbabilityPct: string | undefined;
    if (typeof opt.replantProbability === "number") {
      replantProbabilityPct = `${(opt.replantProbability * 100).toFixed(1)}%`;
    }

    const establishmentRainP50Mm =
      typeof opt.establishmentRainMm?.p50 === "number" ? opt.establishmentRainMm.p50 : undefined;

    return {
      option: opt.option || "",
      label: opt.label || opt.option || "",
      isChosen,
      isRunnerUp,
      plantingDate: opt.plantingDate,
      replantProbabilityPct,
      establishmentRainP50Mm,
      notes: opt.notes,
    };
  });

  const seasonsEvaluated =
    typeof evidence.nAnalogYears === "number"
      ? evidence.nAnalogYears
      : typeof evidence.seasonsCount === "number"
      ? evidence.seasonsCount
      : typeof rawOptions[0]?.n === "number"
      ? rawOptions[0].n
      : undefined;

  return {
    hasDecision: Boolean(decision),
    options,
    seasonsEvaluated,
    queriesRun: Array.isArray(data?.zetaris?.queries_run) ? data.zetaris.queries_run : [],
    rowCounts: data?.zetaris?.row_counts || {},
    memory: {
      used: Boolean(data?.memory?.hmem_used),
      recalled: Array.isArray(data?.memory?.recalled) ? data.memory.recalled : [],
      stored: data?.memory?.stored || "none",
    },
    llm: {
      provider: data?.llm?.provider || "unknown",
      requestedModel: data?.llm?.requested_model || "none",
      respondedModel: data?.llm?.responded_model || "none",
      latencyMs: data?.llm?.latency_ms ?? 0,
      fallbackUsed: Boolean(data?.llm?.fallback_used),
    },
    runId: data?.run_id || "",
    traceFile: data?.trace_file || "",
    assumptions: Array.isArray(decision?.assumptions) ? decision.assumptions : undefined,
  };
}
