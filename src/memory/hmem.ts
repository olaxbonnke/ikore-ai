import fs from "node:fs";
import path from "node:path";
import { loadHMEM } from "../engine.ts";

export interface FarmEvent {
  type?: string;
  content?: string;
  text?: string;
  tags?: string[];
  payload?: unknown;
  confidence?: number;
  layer?: "short_term" | "working" | "long_term";
  provenance?: string | Record<string, unknown>;
}

export interface RetrievedMemorySummary {
  id: string;
  content: string;
  relevance: number;
  layer: string;
  type: string;
  tags: string[];
  provenance?: any;
  memory: any;
}

export interface AskResult extends Array<RetrievedMemorySummary> {
  memories: RetrievedMemorySummary[];
  context: string;
  trace: {
    retrievalReason: string;
    strategy: string;
    scores: Record<string, number>;
  };
}

export interface LedgerEntryRecord {
  memoryId: string;
  action: string;
  actor: string;
  timestamp: number;
  previousState?: any;
  newState?: any;
  details?: Record<string, unknown>;
}

export interface SleepPreviewRecord {
  toConsolidate: string[];
  toArchive: string[];
  toSynthesize: string[][];
}

export interface SleepReportRecord {
  backupId: string;
  consolidated: number;
  archived: number;
  synthesized: number;
  actionLog: string[];
}

const farmHmemCache = new Map<string, any>();
const memoryToFarmMap = new Map<string, string>();

/**
 * Returns namespaced HMEM instance for a farm.
 * Persists to .oko/hmem/<farmId> (state.json + ledger.jsonl).
 */
export async function getFarmHMEM(farmId: string): Promise<any> {
  let inst = farmHmemCache.get(farmId);
  if (!inst) {
    const { HMEM } = await loadHMEM();
    const stateDir = process.env.OKO_STATE_DIR || ".oko";
    const persistDir = path.resolve(process.cwd(), stateDir, "hmem", farmId);
    fs.mkdirSync(persistDir, { recursive: true });
    inst = new HMEM({
      persistDir,
      actor: `oko:${farmId}`,
    });
    farmHmemCache.set(farmId, inst);
  }
  return inst;
}

/**
 * Store an event or fact into a farm's H-MEM memory store.
 */
export async function remember(
  farmId: string,
  event: FarmEvent | Record<string, unknown> | string
): Promise<string> {
  const hmem = await getFarmHMEM(farmId);

  let content = "";
  let type: "personal" | "factual" | "preference" | "general" = "factual";
  let layer: "short_term" | "working" | "long_term" = "working";
  const tags: string[] = [`farm:${farmId}`];
  let eventType = "general";
  let confidence = 0.9;

  if (typeof event === "string") {
    content = event;
  } else {
    eventType = String(event.type || "farm_fact");
    content =
      (typeof event.content === "string" && event.content) ||
      (typeof event.text === "string" && event.text) ||
      JSON.stringify(event.payload || event);

    if (Array.isArray(event.tags)) {
      tags.push(...event.tags.map(String));
    }
    tags.push(`type:${eventType}`);

    if (eventType === "farm_profile" || eventType === "farm_fact") {
      type = "factual";
      layer = "long_term";
    } else if (eventType === "preference") {
      type = "preference";
    } else if (eventType === "advice" || eventType === "outcome") {
      type = "factual";
      layer = "working";
    }

    const customLayer = "layer" in event ? event.layer : undefined;
    if (customLayer === "short_term" || customLayer === "working" || customLayer === "long_term") {
      layer = customLayer;
    }
    if ("confidence" in event && typeof event.confidence === "number") {
      confidence = event.confidence;
    }
  }

  let provenanceRecord: any = {
    origin: "document",
    learnedAt: Date.now(),
    label: `Farm event: ${eventType} for ${farmId}`,
  };

  if (typeof event === "object" && event !== null && "provenance" in event && event.provenance) {
    if (typeof event.provenance === "string") {
      provenanceRecord = {
        origin: "document",
        learnedAt: Date.now(),
        label: event.provenance,
        source: event.provenance,
      };
    } else {
      provenanceRecord = event.provenance;
    }
  }

  // Direct persistence through MemoryStoreService with TrustLedger logging
  const record = hmem.store.add({
    content,
    type,
    layer,
    tags,
    confidence,
    source: `farm:${farmId}:${eventType}`,
    provenance: provenanceRecord,
  });

  memoryToFarmMap.set(record.id, farmId);
  return record.id;
}

/**
 * Retrieve memories matching a query from the farm's store.
 */
export async function ask(
  farmId: string,
  query: string,
  opts?: { threshold?: number; topN?: number }
): Promise<AskResult> {
  const hmem = await getFarmHMEM(farmId);
  const threshold = opts?.threshold ?? 0.1;
  const topN = opts?.topN ?? 5;

  const rawResult = hmem.retrieval.query(query, {
    threshold,
    topN,
  });

  const summaries: RetrievedMemorySummary[] = (rawResult.memories || []).map((rm: any) => {
    memoryToFarmMap.set(rm.memory.id, farmId);
    return {
      id: rm.memory.id,
      content: rm.memory.content,
      relevance: rm.relevance,
      layer: rm.memory.layer,
      type: rm.memory.type,
      tags: rm.memory.tags,
      provenance: rm.memory.provenance,
      memory: rm.memory,
    };
  });

  const result = Object.assign(summaries, {
    memories: summaries,
    context: rawResult.context || "",
    trace: rawResult.trace || {
      retrievalReason: "query",
      strategy: "comprehensive",
      scores: {},
    },
  }) as AskResult;

  return result;
}

/**
 * Retrieve append-only ledger history for a memory record.
 */
export async function audit(memoryId: string, farmId?: string): Promise<LedgerEntryRecord[]> {
  if (farmId) {
    const hmem = await getFarmHMEM(farmId);
    return hmem.ledger.history(memoryId);
  }

  const cachedFarmId = memoryToFarmMap.get(memoryId);
  if (cachedFarmId) {
    const hmem = await getFarmHMEM(cachedFarmId);
    return hmem.ledger.history(memoryId);
  }

  // Search active cached instances
  for (const [fId, hmem] of farmHmemCache.entries()) {
    const history = hmem.ledger.history(memoryId);
    if (history.length > 0) {
      memoryToFarmMap.set(memoryId, fId);
      return history;
    }
  }

  // Search on-disk farm stores in .oko/hmem
  const stateDir = process.env.OKO_STATE_DIR || ".oko";
  const hmemBase = path.resolve(process.cwd(), stateDir, "hmem");
  if (fs.existsSync(hmemBase)) {
    const entries = fs.readdirSync(hmemBase, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const ledgerFile = path.join(hmemBase, ent.name, "ledger.jsonl");
        if (fs.existsSync(ledgerFile)) {
          const content = fs.readFileSync(ledgerFile, "utf-8");
          if (content.includes(`"memoryId":"${memoryId}"`)) {
            const hmem = await getFarmHMEM(ent.name);
            memoryToFarmMap.set(memoryId, ent.name);
            return hmem.ledger.history(memoryId);
          }
        }
      }
    }
  }

  return [];
}

/**
 * Provide feedback on a memory record, recorded in TrustLedger.
 */
export async function feedback(
  memoryId: string,
  verdict: "helpful" | "not_helpful" | "wrong",
  farmId?: string
): Promise<void> {
  let targetFarmId = farmId || memoryToFarmMap.get(memoryId);

  if (!targetFarmId) {
    const stateDir = process.env.OKO_STATE_DIR || ".oko";
    const hmemBase = path.resolve(process.cwd(), stateDir, "hmem");
    if (fs.existsSync(hmemBase)) {
      const entries = fs.readdirSync(hmemBase, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory()) {
          const ledgerFile = path.join(hmemBase, ent.name, "ledger.jsonl");
          if (fs.existsSync(ledgerFile)) {
            const content = fs.readFileSync(ledgerFile, "utf-8");
            if (content.includes(`"memoryId":"${memoryId}"`)) {
              targetFarmId = ent.name;
              break;
            }
          }
        }
      }
    }
  }

  if (!targetFarmId) {
    throw new Error(`Cannot find farm associated with memoryId "${memoryId}"`);
  }

  const hmem = await getFarmHMEM(targetFarmId);
  hmem.retrieval.feedback(memoryId, verdict);
}

/**
 * Execute or preview SleepCycle consolidation and archival.
 */
export async function sleep(
  farmId: string,
  opts?: { preview?: boolean }
): Promise<SleepPreviewRecord | SleepReportRecord> {
  const hmem = await getFarmHMEM(farmId);
  const preview = hmem.sleep.preview();
  if (opts?.preview) {
    return preview;
  }
  return hmem.sleep.execute(preview);
}
