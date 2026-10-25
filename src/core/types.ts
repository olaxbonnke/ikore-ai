/** Shared Ikore AI types (DESIGN.md section 5). */

export type Lang = "en" | "pcm" | "yo" | "ha";

export interface Farm {
  id: string;
  ownerName: string;
  lat: number;
  lon: number;
  state: string;
  lga: string;
  crop: "maize";
  hectares: number;
  storage: "sack" | "pics" | "silo" | "unknown";
  preferredLang: Lang;
  riskAversion: "low" | "normal" | "high";
  zone: "derived_savanna" | "southern_guinea" | "northern_guinea" | "sudan";
}

export interface ChartSpec {
  kind: "line" | "bar" | "area";
  series: Array<{
    name: string;
    points: Array<{ x: string | number; y: number }>;
  }>;
}

export interface EvidenceItem {
  id: string;
  kind: "forecast" | "history" | "price" | "soil" | "calendar" | "memory" | "assumption";
  label: string;
  source: string;
  sql?: string;
  queryName?: string;
  statistic?: string;
  value?: number | string;
  unit?: string;
  chart?: ChartSpec;
}

export interface OutcomeDistribution {
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  riskMetric: number;
  riskLabel: string;
  n: number;
}

export interface OptionResult {
  option: string;
  label: string;
  outcome: OutcomeDistribution;
  score: number;
  notes: string[];
}

export interface Decision {
  id: string;
  farmId: string;
  intent: "plant_timing" | "sell_or_store";
  createdAt: string;
  options: OptionResult[];
  chosen: string;
  runnerUp: string;
  confidence: "high" | "medium" | "low";
  riskBadge: "green" | "amber" | "red";
  keyNumbers: Record<string, number | string>;
  evidence: EvidenceItem[];
  assumptions: string[];
  dataMode: "live" | "snapshot";
}

export interface AgentReplyPart {
  intent: string;
  kind: "decision" | "guidance";
  reply: string;
  topic?: string;
}

export interface AgentReply {
  text: string;
  lang: Lang;
  decision?: Decision | null;
  intent?: string;
  parts?: AgentReplyPart[];
  askedQuestion?: boolean;
  memoryIdsUsed: string[];
  path?: "llm" | "template" | "model";
  fallbackReason?: string;
  latencyMs?: number;
  model?: string;
  requestedModel?: string;
  respondedModel?: string;
  guidance_type?: "general" | "decision";
  runId?: string;
  traceFile?: string;
  queriesRun?: string[];
  rowCounts?: Record<string, number>;
  recalledMemories?: string[];
  storedMemoryId?: string;
  memory?: { recalled: string[]; stored?: string };
}

/** User message into the orchestrator (DESIGN.md section 4). */
export interface IncomingMessage {
  farmId: string;
  text: string;
  recentTurns?: Array<{ role: "user" | "assistant"; text: string; at: string }>;
  runId?: string;
  lang?: Lang;
}

/** Observation built in observe.ts from DataGateway (filled in Day 2+). */
export interface Observation {
  farmId: string;
  asOf: string;
  queryMeta: Array<{
    queryName: string;
    sql: string;
    executedAt: string;
    rowCount: number;
    source: string;
  }>;
}
