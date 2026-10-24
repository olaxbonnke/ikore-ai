import fs from "node:fs";
import path from "node:path";
import { getFarmProfile } from "../core/farm-profile.ts";
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
 * Normalises text and deduplicates memories based on their content.
 */
export function deduplicateMemories<T extends { content?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (!item || typeof item.content !== "string") continue;
    const norm = item.content.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(item);
    }
  }
  return out;
}

export function clearHMEMCache(): void {
  farmHmemCache.clear();
  memoryToFarmMap.clear();
}

function autoSeedFarm(farmId: string, hmem: any): void {
  try {
    const farm = getFarmProfile(farmId);
    const profileText = `[Demo profile from data/farms_seed.csv] Farm profile: ${farm.ownerName} (${farmId}) operates ${farm.hectares} hectares of maize in ${farm.lga}, ${farm.state} State (${farm.zone}). Storage method: ${farm.storage}. Preferred language: ${farm.preferredLang}. Risk profile: ${farm.riskAversion}.`;
    const storageFact = `[Demo fact from data/farms_seed.csv] Storage method for ${farm.ownerName} (${farmId}) is ${farm.storage}.`;
    const scaleFact = `[Demo fact from data/farms_seed.csv] ${farm.ownerName} farms ${farm.hectares} hectares in ${farm.lga}, ${farm.state} State.`;

    const facts = [
      { content: profileText, tags: [`farm:${farmId}`, "profile", "farm_info", "maize", farm.storage, "type:farm_profile", "demo-seed", "synthetic", "seed_version:2"], type: "factual", layer: "long_term" },
      { content: storageFact, tags: [`farm:${farmId}`, "storage", "storage_method", farm.storage, "type:farm_fact", "demo-seed", "synthetic", "seed_version:2"], type: "factual", layer: "long_term" },
      { content: scaleFact, tags: [`farm:${farmId}`, "hectares", "location", "field_size", "type:farm_fact", "demo-seed", "synthetic", "seed_version:2"], type: "factual", layer: "long_term" },
    ];

    for (const f of facts) {
      hmem.store.add({
        content: f.content,
        type: f.type,
        layer: f.layer,
        tags: f.tags,
        confidence: 0.95,
        source: "demo-seed",
        provenance: { origin: "demo-seed", label: "demo_seed", source: "data/farms_seed.csv", learnedAt: Date.now() },
      });
    }

    // Also check data/farm_records.csv if available
    const recordsCsv = path.resolve(process.cwd(), "data", "farm_records.csv");
    if (fs.existsSync(recordsCsv)) {
      const lines = fs.readFileSync(recordsCsv, "utf-8").split(/\r?\n/).filter((l) => l.trim().length > 0 && !l.startsWith("#"));
      if (lines.length > 1) {
        const headers = lines[0].split(",").map((h) => h.trim());
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(",").map((p) => p.trim());
          const row: Record<string, string> = {};
          headers.forEach((h, idx) => { row[h] = parts[idx] ?? ""; });
          if (row.farm_id === farmId) {
            const seasonText = `[Demo record from data/farm_records.csv] Past season ${row.season_year} for ${row.farm_id}: planting date was ${row.planting_date}, germination was ${row.germination_ok}, harvested ${row.yield_bags} bags of maize, sold in ${row.sale_month} at ₦${row.sale_price_per_bag} per bag.`;
            hmem.store.add({
              content: seasonText,
              type: "factual",
              layer: "long_term",
              tags: [`farm:${farmId}`, "past_season", "harvest", `year:${row.season_year}`, "records", "demo_seed", "demo-seed", "synthetic", "type:farm_season_record", "seed_version:2"],
              confidence: 0.9,
              source: "demo-seed",
              provenance: { origin: "demo-seed", label: "demo_seed", source: "data/farm_records.csv", learnedAt: Date.now() },
            });
          }
        }
      }
    }
  } catch (err: any) {
    console.warn(`[HMEM] autoSeedFarm error for ${farmId}: ${err.message}`);
  }
}

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

    // If memory store has no records for this farm, auto-seed default profile facts
    if (inst.store.records.size === 0) {
      autoSeedFarm(farmId, inst);
    } else {
      // Check seed version marker: if store lacks seed_version:2, reseed demo records without touching user memories
      const records = [...inst.store.records.values()];
      const hasSeedV2 = records.some((r: any) => Array.isArray(r.tags) && r.tags.includes("seed_version:2"));
      if (!hasSeedV2) {
        const demoRecords = records.filter((r: any) => {
          const isUserAdvice =
            r.tags?.includes("type:advice") ||
            r.content?.includes("Question:") ||
            r.tags?.some((t: string) => t.startsWith("run:"));
          if (isUserAdvice) return false;
          const isDemo =
            r.source === "demo-seed" ||
            r.tags?.includes("demo-seed") ||
            r.tags?.includes("demo_seed") ||
            r.tags?.includes("type:farm_profile") ||
            r.tags?.includes("type:farm_fact") ||
            r.tags?.includes("type:farm_season_record") ||
            r.tags?.includes("profile") ||
            r.tags?.includes("past_season");
          return isDemo;
        });

        for (const dr of demoRecords) {
          inst.store.delete(dr.id, "reseed_demo_v2");
        }
        autoSeedFarm(farmId, inst);
      }
    }
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

  // Duplicate-save prevention:
  // 1. Same-run deduplication
  // 2. Same-farm identical memory deduplication: (same question + same verdict + same date) or identical content
  if (typeof event === "object" && event !== null) {
    const runId = "runId" in event && event.runId ? String(event.runId) : undefined;
    const decId = "decisionId" in event && event.decisionId ? String(event.decisionId) : undefined;

    if (runId) {
      const existing = [...hmem.store.records.values()].find((r: any) => {
        return Array.isArray(r.tags) && r.tags.includes(`run:${runId}`);
      });
      if (existing) {
        return existing.id;
      }
      tags.push(`run:${runId}`);
    } else if (decId) {
      // Fallback only if runId was not supplied
      const existing = [...hmem.store.records.values()].find((r: any) => {
        return Array.isArray(r.tags) && r.tags.includes(`decision:${decId}`);
      });
      if (existing) {
        return existing.id;
      }
    }

    if (decId) {
      tags.push(`decision:${decId}`);
    }

    // Prevent storing identical memory twice for same farm: (same question + same verdict + same date)
    const eventVerdict = "verdict" in event && event.verdict ? String(event.verdict) : undefined;
    const eventDate = "date" in event && event.date ? String(event.date).slice(0, 10) : undefined;
    const qMatch = content.match(/Question:\s*"([^"]+)"/i);
    const eventQuestion = ("question" in event && event.question ? String(event.question) : qMatch ? qMatch[1] : "").trim().toLowerCase();

    if (eventQuestion && eventVerdict && eventDate) {
      const identical = [...hmem.store.records.values()].find((r: any) => {
        if (typeof r.content !== "string") return false;
        const rContentLower = r.content.toLowerCase();
        const hasQ = rContentLower.includes(eventQuestion);
        const hasV = rContentLower.includes(eventVerdict.toLowerCase());
        const hasD = rContentLower.includes(eventDate);
        return hasQ && hasV && hasD;
      });

      if (identical) {
        return identical.id;
      }
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

  const rawSummaries: RetrievedMemorySummary[] = (rawResult.memories || []).map((rm: any) => {
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

  const summaries = deduplicateMemories(rawSummaries);

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
