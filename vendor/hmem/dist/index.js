// vendor/hmem/src/memoryStore.ts
import fs from "node:fs";
import path from "node:path";

// vendor/hmem/src/types.ts
var FEEDBACK_DELTAS = { helpful: 0.05, not_helpful: -0.03, wrong: -0.2 };
var DEFAULTS = {
  retrievalTopN: 5,
  retrievalThreshold: 0.35,
  // on the final score, after the confidence multiplier
  consolidationDays: 7,
  archiveMinDays: 30,
  archiveMaxAccess: 2,
  synthesisCosine: 0.82,
  dreamClusterMinSize: 2,
  dreamRelatedness: 0.35,
  maxDreamProposalsPerType: 8,
  conflictAutoResolveGate: 0.7,
  entityCap: 10,
  relatedCap: 5,
  recencyDays: 14
};
var clamp01 = (x) => Math.min(1, Math.max(0, x));
var DAY_MS = 24 * 60 * 60 * 1e3;

// vendor/hmem/src/embeddings.ts
var DIM = 64;
function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 1);
}
function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function embed(text) {
  const vec = new Array(DIM).fill(0);
  for (const token of tokenize(text)) {
    const h = fnv1a(token);
    const idx = h % DIM;
    const sign = (h >>> 8) % 2 === 0 ? 1 : -1;
    const mag = 1 + (h >>> 16) % 8 / 8;
    vec[idx] += sign * mag;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? vec : vec.map((v) => v / norm);
}
function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

// vendor/hmem/src/memoryStore.ts
var TECH_TERMS = [
  "react",
  "python",
  "typescript",
  "javascript",
  "rust",
  "sqlite",
  "postgres",
  "indexeddb",
  "node",
  "docker",
  "graphql",
  "redis",
  "webrtc",
  "tauri",
  "electron",
  "llm",
  "embedding"
];
var DOMAIN_KEYWORDS = {
  tech: ["code", "bug", "api", "database", "deploy", "framework", "library", "server", ...TECH_TERMS],
  work: ["meeting", "deadline", "client", "project", "sprint", "review", "report"],
  personal: ["family", "hobby", "prefer", "like", "dislike", "morning", "evening"]
};
var MemoryStoreService = class {
  constructor(clock, ledger, actor, persistDir) {
    this.clock = clock;
    this.ledger = ledger;
    this.actor = actor;
    if (persistDir) {
      fs.mkdirSync(persistDir, { recursive: true });
      this.stateFile = path.join(persistDir, "state.json");
      if (fs.existsSync(this.stateFile)) {
        const saved = JSON.parse(fs.readFileSync(this.stateFile, "utf-8"));
        this.seq = saved.seq;
        for (const r of saved.records) this.records.set(r.id, r);
      }
    }
  }
  clock;
  ledger;
  actor;
  records = /* @__PURE__ */ new Map();
  seq = 0;
  stateFile;
  persist() {
    if (!this.stateFile) return;
    const records = [...this.records.values()].sort((a, b) => a.id.localeCompare(b.id));
    fs.writeFileSync(this.stateFile, JSON.stringify({ seq: this.seq, records }, null, 2) + "\n", "utf-8");
  }
  add(input) {
    if (!input.source || input.source.trim() === "") {
      throw new Error("H-MEM: a memory record with no source must be rejected by construction (AGENTS.md section 2)");
    }
    const now = this.clock();
    const id = `mem-${++this.seq}`;
    const tags = [...input.tags ?? []];
    const domain = this.classifyDomain(input.content, tags, input.type ?? "general");
    const record = {
      id,
      content: input.content,
      type: input.type ?? "general",
      layer: input.layer ?? "working",
      timestamp: now,
      lastAccessed: now,
      accessCount: 0,
      tags,
      embedding: embed(input.content),
      confidence: clamp01(input.confidence ?? 0.7),
      source: input.source,
      provenance: input.provenance ?? { origin: "manual", learnedAt: now, label: input.source },
      chatId: input.chatId,
      missionId: input.missionId,
      goalRunId: input.goalRunId,
      domain,
      namespace: this.namespace(domain, input.type ?? "general"),
      entities: this.extractEntities(input.content),
      relatedTo: [],
      supersedes: input.supersedes,
      derivedFrom: input.derivedFrom
    };
    this.discoverRelationships(record);
    this.records.set(id, record);
    this.ledger.log(id, "create", this.actor, { newState: snapshot(record) });
    this.persist();
    return record;
  }
  get(id) {
    return this.records.get(id);
  }
  all() {
    return [...this.records.values()];
  }
  update(id, patch) {
    const rec = this.mustGet(id);
    const prev = snapshot(rec);
    Object.assign(rec, patch);
    this.ledger.log(id, "update", this.actor, { previousState: prev, newState: snapshot(rec) });
    this.persist();
    return rec;
  }
  delete(id, reason) {
    const rec = this.mustGet(id);
    this.records.delete(id);
    this.ledger.log(id, "delete", this.actor, { previousState: snapshot(rec), details: { reason } });
    this.persist();
  }
  touch(id) {
    const rec = this.mustGet(id);
    rec.lastAccessed = this.clock();
    rec.accessCount += 1;
  }
  promote(id, layer) {
    const rec = this.mustGet(id);
    const prev = snapshot(rec);
    rec.layer = layer;
    this.ledger.log(id, "promote", this.actor, { previousState: prev, newState: snapshot(rec) });
    this.persist();
  }
  restoreAll(records, seq) {
    this.records = new Map(records.map((r) => [r.id, structuredClone(r)]));
    this.seq = seq;
    this.persist();
  }
  snapshotAll() {
    return { records: structuredClone([...this.records.values()]), seq: this.seq };
  }
  mustGet(id) {
    const rec = this.records.get(id);
    if (!rec) throw new Error(`H-MEM: unknown memory id ${id}`);
    return rec;
  }
  // Multi-pass domain classification (AGENTS.md section 5).
  classifyDomain(content, tags, type) {
    for (const t of tags) {
      if (t.startsWith("project:")) return t.slice("project:".length);
      if (t.startsWith("tech:")) return "tech";
    }
    const tokens = new Set(tokenize(content));
    let best = "general";
    let bestScore = 0;
    for (const [domain, kws] of Object.entries(DOMAIN_KEYWORDS)) {
      let score = kws.reduce((s, kw) => s + (tokens.has(kw) ? 1 : 0), 0);
      if (domain === "personal" && (type === "personal" || type === "preference")) score += 1;
      if (score > bestScore) {
        best = domain;
        bestScore = score;
      }
    }
    return bestScore > 0 ? best : "general";
  }
  namespace(domain, type) {
    const bucket = type === "preference" || type === "personal" ? "profile" : type === "factual" ? "facts" : "notes";
    return `${domain}/${bucket}`;
  }
  extractEntities(content) {
    const entities = /* @__PURE__ */ new Set();
    for (const t of tokenize(content)) if (TECH_TERMS.includes(t)) entities.add(t);
    for (const m of content.matchAll(/\b([A-Z][a-zA-Z]{2,})\b/g)) {
      const norm = m[1].toLowerCase();
      if (!["the", "this", "that", "with"].includes(norm)) entities.add(norm);
    }
    return [...entities].slice(0, DEFAULTS.entityCap);
  }
  discoverRelationships(record) {
    const CORRECTION = /\b(actually|instead|no longer|not anymore|changed to|correction)\b/i;
    for (const other of this.records.values()) {
      if (record.relatedTo.length >= DEFAULTS.relatedCap) break;
      const sharedEntities = other.entities.filter((e) => record.entities.includes(e));
      const sim = cosine(record.embedding, other.embedding);
      if (!record.supersedes && sim > 0.85 && CORRECTION.test(record.content)) {
        record.supersedes = other.id;
        continue;
      }
      if (sharedEntities.length >= 1 && other.domain === record.domain) {
        record.relatedTo.push(other.id);
        if (other.relatedTo.length < DEFAULTS.relatedCap && !other.relatedTo.includes(record.id)) {
          other.relatedTo.push(record.id);
        }
      }
    }
  }
};
function snapshot(r) {
  const { embedding, ...rest } = structuredClone(r);
  return rest;
}

// vendor/hmem/src/trustLedger.ts
import fs2 from "node:fs";
import path2 from "node:path";
var TrustLedgerService = class {
  constructor(clock, persistDir) {
    this.clock = clock;
    if (persistDir) {
      this.file = path2.join(persistDir, "ledger.jsonl");
      if (fs2.existsSync(this.file)) {
        this.entries = fs2.readFileSync(this.file, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      }
    }
  }
  clock;
  entries = [];
  file;
  log(memoryId, action, actor, extra) {
    const entry = { memoryId, action, actor, timestamp: this.clock(), ...extra };
    this.entries.push(entry);
    if (this.file) fs2.appendFileSync(this.file, JSON.stringify(entry) + "\n", "utf-8");
    return entry;
  }
  history(memoryId) {
    return this.entries.filter((e) => e.memoryId === memoryId);
  }
  all() {
    return this.entries;
  }
  stats() {
    const out = {};
    for (const e of this.entries) out[e.action] = (out[e.action] ?? 0) + 1;
    return out;
  }
};

// vendor/hmem/src/memoryMining.ts
var EVENT_TYPE_MAP = {
  chat_message: "general",
  user_correction: "preference",
  file_save: "factual",
  file_open: "general",
  file_edit: "factual",
  model_response: "factual",
  plan_completion: "factual"
};
var SIGNAL = /\b(prefer|always|never|decided|chose|choose|use|because|instead|must|should|important|remember)\b/i;
var MemoryMiningService = class {
  constructor(store, clock, minerFn) {
    this.store = store;
    this.clock = clock;
    this.minerFn = minerFn;
  }
  store;
  clock;
  minerFn;
  async mineInteraction(event, text, opts) {
    const candidates = this.minerFn ? await this.mineWithModel(event, text) : this.mineModelFree(text);
    return candidates.map(
      (content) => this.store.add({
        content,
        type: EVENT_TYPE_MAP[event],
        layer: opts?.layer ?? (this.minerFn ? "working" : "short_term"),
        tags: [`event:${event}`],
        source: `interaction:${event}`,
        provenance: { origin: event, learnedAt: this.clock(), label: `mined from ${event}` },
        chatId: opts?.chatId
      })
    );
  }
  async mineDocument(fileName, text) {
    const truncated = text.slice(0, 8e3);
    const candidates = this.minerFn ? await this.mineWithModel("file_save", truncated) : this.mineModelFree(truncated);
    return candidates.map(
      (content) => this.store.add({
        content,
        type: "factual",
        layer: "working",
        tags: ["document", `file:${fileName}`],
        source: `document:${fileName}`
      })
    );
  }
  // 4.3: no-model fallback. Concise direct summaries as short-term memories.
  mineModelFree(text) {
    return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 20 && s.length <= 300 && SIGNAL.test(s)).slice(0, 10);
  }
  async mineWithModel(event, text) {
    const prompt = `Extract durable memories from this ${event} as a strict JSON array of strings:

${text}`;
    const rawResponse = await this.minerFn(prompt);
    return parseStrictJsonArray(rawResponse);
  }
};
function parseStrictJsonArray(raw) {
  let cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start !== -1 && end > start) cleaned = cleaned.slice(start, end + 1);
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => typeof x === "string" && x.trim().length >= 5);
  } catch {
    return [];
  }
}

// vendor/hmem/src/memoryRetrieval.ts
var LAYER_WEIGHT = {
  long_term: 1,
  working: 0.8,
  short_term: 0.6
};
var MemoryRetrievalService = class {
  constructor(store, ledger, clock, actor) {
    this.store = store;
    this.ledger = ledger;
    this.clock = clock;
    this.actor = actor;
  }
  store;
  ledger;
  clock;
  actor;
  scoreOne(memory, query) {
    const queryEmbedding = embed(query);
    const queryTokens = tokenize(query).slice(0, 8);
    const queryEntities = this.store.extractEntities(query);
    const queryDomain = this.store.classifyDomain(query, [], "general");
    return this.score(memory, queryEmbedding, queryTokens, queryEntities, queryDomain);
  }
  score(m, queryEmbedding, queryTokens, queryEntities, queryDomain) {
    const semantic = clamp01(cosine(queryEmbedding, m.embedding));
    const keyword = jaccard(queryTokens, tokenize(m.content));
    const tag = jaccard(queryTokens, m.tags.map((t) => t.toLowerCase()));
    const domain = m.domain === queryDomain ? 1 : 0;
    const entity = jaccard(queryEntities, m.entities);
    const layer = LAYER_WEIGHT[m.layer];
    const ageDays = (this.clock() - m.lastAccessed) / DAY_MS;
    const recency = Math.exp(-ageDays / DEFAULTS.recencyDays);
    const superseded = m.supersededBy ? 1 : 0;
    const raw = 0.35 * semantic + 0.2 * keyword + 0.1 * tag + 0.1 * domain + 0.15 * entity + 0.05 * layer + 0.05 * recency - 0.2 * superseded;
    return clamp01(raw) * m.confidence;
  }
  query(query, opts) {
    const queryEmbedding = embed(query);
    const queryTokens = tokenize(query).slice(0, 8);
    const queryEntities = this.store.extractEntities(query);
    const queryDomain = this.store.classifyDomain(query, [], "general");
    const threshold = opts?.threshold ?? DEFAULTS.retrievalThreshold;
    const topN = opts?.topN ?? DEFAULTS.retrievalTopN;
    const scored = [];
    for (const m of this.store.all()) {
      if (opts?.chatId && m.chatId && m.chatId !== opts.chatId) continue;
      const s = this.score(m, queryEmbedding, queryTokens, queryEntities, queryDomain);
      if (s >= threshold) scored.push({ memory: m, relevance: s });
    }
    scored.sort((a, b) => b.relevance - a.relevance || a.memory.id.localeCompare(b.memory.id));
    const top = scored.slice(0, topN);
    for (const { memory } of top) {
      this.store.touch(memory.id);
      this.ledger.log(memory.id, "read", this.actor, { details: { query } });
    }
    const strategy = top.length <= 1 ? "minimal" : top.some((t) => t.memory.type === "personal" || t.memory.type === "preference") ? "personal" : "comprehensive";
    return {
      memories: top,
      context: this.formatReinjection(top),
      trace: {
        retrievalReason: `hybrid ranking for "${query}" (domain: ${queryDomain})`,
        strategy,
        scores: Object.fromEntries(top.map((t) => [t.memory.id, Number(t.relevance.toFixed(4))]))
      }
    };
  }
  // Domain-grouped reinjection blocks with layer markers and entities (section 6.2).
  formatReinjection(items) {
    if (items.length === 0) return "";
    const byDomain = /* @__PURE__ */ new Map();
    for (const it of items) {
      const list = byDomain.get(it.memory.domain) ?? [];
      list.push(it);
      byDomain.set(it.memory.domain, list);
    }
    const lines = ["[MEMORY CONTEXT]"];
    for (const [domain, list] of [...byDomain.entries()].sort()) {
      lines.push(`## ${domain}`);
      for (const { memory } of list) {
        const marker = memory.layer === "long_term" ? "LT" : memory.layer === "working" ? "WK" : "ST";
        const ents = memory.entities.length ? ` (entities: ${memory.entities.join(", ")})` : "";
        lines.push(`- [${marker}] ${memory.content}${ents} <${memory.id}>`);
      }
    }
    lines.push("[/MEMORY CONTEXT]");
    return lines.join("\n");
  }
  // Exact feedback deltas (AGENTS.md section 9.2).
  feedback(memoryId, kind) {
    const m = this.store.get(memoryId);
    if (!m) throw new Error(`H-MEM: unknown memory id ${memoryId}`);
    const prev = snapshot(m);
    if (kind === "helpful") m.accessCount += 1;
    m.confidence = clamp01(m.confidence + FEEDBACK_DELTAS[kind]);
    if (kind === "wrong" && !m.tags.includes("review")) m.tags.push("review");
    this.ledger.log(memoryId, "feedback", this.actor, {
      previousState: prev,
      newState: snapshot(m),
      details: { kind, delta: FEEDBACK_DELTAS[kind] }
    });
    this.store.persist();
  }
};

// vendor/hmem/src/conflictDetection.ts
var OPPOSING_PAIRS = [
  [/\balways\b/i, /\bnever\b/i],
  [/\benable[ds]?\b/i, /\bdisable[ds]?\b/i],
  [/\bprefer[s]?\b/i, /\bavoid[s]?|dislike[s]?\b/i],
  [/\bon\b/i, /\boff\b/i],
  [/\byes\b/i, /\bno\b/i]
];
var ConflictDetectionService = class {
  constructor(store, ledger, clock, actor) {
    this.store = store;
    this.ledger = ledger;
    this.clock = clock;
    this.actor = actor;
  }
  store;
  ledger;
  clock;
  actor;
  conflicts = [];
  seq = 0;
  scan() {
    const found = [];
    const all = this.store.all();
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const conflict = this.check(all[i], all[j]);
        if (conflict) {
          found.push(conflict);
          this.conflicts.push(conflict);
          this.ledger.log(conflict.memoryA, "conflict_detected", this.actor, {
            details: { with: conflict.memoryB, reason: conflict.reason, confidence: conflict.confidence }
          });
        }
      }
    }
    return found;
  }
  check(a, b) {
    if (a.supersedes === b.id || b.supersedes === a.id || a.supersededBy === b.id || b.supersededBy === a.id) return void 0;
    const sim = cosine(a.embedding, b.embedding);
    let reason = "";
    let confidence = 0;
    for (const [p, q] of OPPOSING_PAIRS) {
      if (p.test(a.content) && q.test(b.content) || q.test(a.content) && p.test(b.content)) {
        if (sim > 0.5) {
          reason = "opposing phrase pair on similar content";
          confidence = 0.5 + 0.3 * sim;
        }
      }
    }
    if (!reason && sim > 0.8) {
      const numsA = a.content.match(/\d+(\.\d+)?/g) ?? [];
      const numsB = b.content.match(/\d+(\.\d+)?/g) ?? [];
      if (numsA.length && numsB.length && numsA.join() !== numsB.join()) {
        reason = "high-similarity conflicting numeric values";
        confidence = 0.55 + 0.25 * sim;
      }
    }
    if (!reason) return void 0;
    const sharedEntities = a.entities.filter((e) => b.entities.includes(e));
    if (sharedEntities.length > 0) confidence += 0.1;
    if (a.domain === b.domain) confidence += 0.05;
    if (a.relatedTo.includes(b.id)) confidence -= 0.1;
    return {
      id: `conflict-${++this.seq}`,
      memoryA: a.id,
      memoryB: b.id,
      reason,
      confidence: clamp01(confidence),
      resolved: false
    };
  }
  // Weighted auto-decision heuristics (section 10.2).
  autoResolve(conflict) {
    const a = this.store.get(conflict.memoryA);
    const b = this.store.get(conflict.memoryB);
    const scoreOf = (m) => 0.3 * (m.lastAccessed / Math.max(1, this.clock())) + 0.2 * Math.min(1, m.accessCount / 10) + 0.25 * m.confidence + 0.1 * Math.min(1, m.content.length / 200) + 0.15 * (m.provenance.origin === "user_correction" ? 1 : 0.5);
    const sa = scoreOf(a);
    const sb = scoreOf(b);
    const margin = Math.abs(sa - sb) / Math.max(sa, sb);
    const decisionConfidence = clamp01(conflict.confidence * 0.6 + margin * 0.8);
    if (decisionConfidence < DEFAULTS.conflictAutoResolveGate) return "queued";
    const winner = sa >= sb ? a : b;
    const loser = sa >= sb ? b : a;
    const prev = snapshot(loser);
    loser.supersededBy = winner.id;
    conflict.resolved = true;
    conflict.resolution = winner.id === conflict.memoryA ? "keep_a" : "keep_b";
    this.ledger.log(loser.id, "conflict_resolved", this.actor, {
      previousState: prev,
      newState: snapshot(loser),
      details: { conflictId: conflict.id, winner: winner.id, decisionConfidence: Number(decisionConfidence.toFixed(3)) }
    });
    this.store.persist();
    return "resolved";
  }
  queue() {
    return this.conflicts.filter((c) => !c.resolved);
  }
};

// vendor/hmem/src/sleepCycle.ts
var HUB_THRESHOLD = 3;
var SleepCycleService = class {
  constructor(store, ledger, clock, actor) {
    this.store = store;
    this.ledger = ledger;
    this.clock = clock;
    this.actor = actor;
  }
  store;
  ledger;
  clock;
  actor;
  backups = /* @__PURE__ */ new Map();
  backupSeq = 0;
  preview() {
    const now = this.clock();
    const all = this.store.all();
    const referenced = /* @__PURE__ */ new Set();
    for (const m of all) {
      for (const r of m.relatedTo) referenced.add(r);
      if (m.supersedes) referenced.add(m.supersedes);
      for (const d of m.derivedFrom ?? []) referenced.add(d);
    }
    const toConsolidate = all.filter((m) => m.layer === "short_term" && now - m.lastAccessed >= DEFAULTS.consolidationDays * DAY_MS).map((m) => m.id);
    const toArchive = all.filter((m) => {
      const oldEnough = now - m.timestamp >= DEFAULTS.archiveMinDays * DAY_MS;
      const lowAccess = m.accessCount <= DEFAULTS.archiveMaxAccess;
      const unreferenced = !referenced.has(m.id);
      if (!(oldEnough && lowAccess && unreferenced)) return false;
      if (m.supersedes) return false;
      if ((m.derivedFrom ?? []).length > 0) return false;
      if (m.relatedTo.length >= HUB_THRESHOLD) return false;
      return true;
    }).map((m) => m.id);
    const toSynthesize = [];
    const used = /* @__PURE__ */ new Set();
    for (let i = 0; i < all.length; i++) {
      if (used.has(all[i].id)) continue;
      const group = [all[i]];
      for (let j = i + 1; j < all.length; j++) {
        if (used.has(all[j].id)) continue;
        if (cosine(all[i].embedding, all[j].embedding) >= DEFAULTS.synthesisCosine) group.push(all[j]);
      }
      if (group.length >= 2) {
        for (const g of group) used.add(g.id);
        toSynthesize.push(group.map((g) => g.id));
      }
    }
    return { toConsolidate, toArchive, toSynthesize };
  }
  execute(preview) {
    const plan = preview ?? this.preview();
    const backupId = `backup-${++this.backupSeq}`;
    this.backups.set(backupId, this.store.snapshotAll());
    const actionLog = [`backup ${backupId} created`];
    for (const id of plan.toConsolidate) {
      const m = this.store.get(id);
      if (!m) continue;
      this.store.promote(id, "long_term");
      this.ledger.log(id, "sleep_consolidate", this.actor, { details: { from: "short_term", to: "long_term" } });
      actionLog.push(`consolidated ${id}`);
    }
    for (const id of plan.toArchive) {
      const m = this.store.get(id);
      if (!m) continue;
      this.ledger.log(id, "sleep_archive", this.actor, { details: { age: this.clock() - m.timestamp, accessCount: m.accessCount } });
      this.store.delete(id, "sleep archive");
      actionLog.push(`archived ${id}`);
    }
    let synthesized = 0;
    for (const group of plan.toSynthesize) {
      const members = group.map((id) => this.store.get(id)).filter((m) => !!m);
      if (members.length < 2) continue;
      const merged = this.store.add({
        content: `Synthesis: ${members.map((m) => m.content).join(" | ")}`,
        type: "factual",
        layer: "long_term",
        tags: [...new Set(members.flatMap((m) => m.tags))],
        confidence: Math.max(...members.map((m) => m.confidence)),
        source: "sleep:synthesis",
        provenance: { origin: "sleep_synthesis", learnedAt: this.clock(), label: `synthesized from ${members.length} memories` },
        derivedFrom: members.map((m) => m.id)
      });
      this.ledger.log(merged.id, "sleep_synthesize", this.actor, { details: { sources: group } });
      for (const m of members) this.store.delete(m.id, "merged by sleep synthesis");
      synthesized++;
      actionLog.push(`synthesized ${merged.id} from ${group.join(", ")}`);
    }
    this.store.persist();
    return {
      backupId,
      consolidated: plan.toConsolidate.length,
      archived: plan.toArchive.length,
      synthesized,
      actionLog
    };
  }
  restore(backupId) {
    const backup = this.backups.get(backupId);
    if (!backup) throw new Error(`H-MEM: unknown backup ${backupId}`);
    this.store.restoreAll(backup.records, backup.seq);
    this.ledger.log("*", "restore", this.actor, { details: { backupId } });
  }
};

// vendor/hmem/src/dreaming.ts
var DreamingService = class {
  constructor(store, ledger, clock, actor) {
    this.store = store;
    this.ledger = ledger;
    this.clock = clock;
    this.actor = actor;
  }
  store;
  ledger;
  clock;
  actor;
  proposals = /* @__PURE__ */ new Map();
  seq = 0;
  // Multi-signal relatedness: content similarity, tag overlap, shared domain/type, entity overlap.
  relatedness(a, b) {
    return 0.5 * Math.max(0, cosine(a.embedding, b.embedding)) + 0.2 * jaccard(a.tags, b.tags) + 0.1 * (a.domain === b.domain ? 1 : 0) + 0.2 * jaccard(a.entities, b.entities);
  }
  cluster() {
    const all = this.store.all();
    const used = /* @__PURE__ */ new Set();
    const clusters = [];
    for (const seed of all) {
      if (used.has(seed.id)) continue;
      const group = [seed];
      for (const other of all) {
        if (other.id === seed.id || used.has(other.id)) continue;
        if (this.relatedness(seed, other) >= DEFAULTS.dreamRelatedness) group.push(other);
      }
      if (group.length >= DEFAULTS.dreamClusterMinSize) {
        for (const g of group) used.add(g.id);
        clusters.push(group);
      }
    }
    return clusters;
  }
  dream() {
    const created = [];
    const propose = (p) => {
      const proposal = { ...p, id: `dream-${++this.seq}`, status: "proposed" };
      this.proposals.set(proposal.id, proposal);
      created.push(proposal);
      this.ledger.log(proposal.id, "dream_proposed", this.actor, { details: { type: p.type, derivedFrom: p.derivedFrom } });
    };
    let insights = 0;
    for (const cluster of this.cluster()) {
      if (insights >= DEFAULTS.maxDreamProposalsPerType) break;
      const domains2 = [...new Set(cluster.map((m) => m.domain))].join("/");
      propose({
        type: "insight",
        content: `Across ${cluster.length} related memories (${domains2}): ${cluster.map((m) => m.content).join(" + ")}`,
        derivedFrom: cluster.map((m) => m.id)
      });
      insights++;
    }
    let domains = 0;
    for (const m of this.store.all()) {
      if (domains >= DEFAULTS.maxDreamProposalsPerType) break;
      if (m.domain !== "general") continue;
      const suggested = this.store.classifyDomain(m.content, m.tags, m.type);
      if (suggested !== "general") {
        propose({ type: "domain", content: `Reclassify "${m.content.slice(0, 60)}" as ${suggested}`, derivedFrom: [m.id], suggestedDomain: suggested });
        domains++;
      }
    }
    let invariants = 0;
    const prefs = this.store.all().filter((m) => m.type === "preference" || m.type === "personal" || m.tags.includes("event:user_correction"));
    const byDomain = /* @__PURE__ */ new Map();
    for (const p of prefs) {
      const list = byDomain.get(p.domain) ?? [];
      list.push(p);
      byDomain.set(p.domain, list);
    }
    for (const [domain, list] of byDomain) {
      if (invariants >= DEFAULTS.maxDreamProposalsPerType) break;
      if (list.length < 2) continue;
      propose({
        type: "invariant",
        content: `Stable pattern in ${domain}: ${list.map((m) => m.content).join("; ")}`,
        derivedFrom: list.map((m) => m.id)
      });
      invariants++;
    }
    return created;
  }
  pending() {
    return [...this.proposals.values()].filter((p) => p.status === "proposed");
  }
  approve(proposalId) {
    const p = this.proposals.get(proposalId);
    if (!p || p.status !== "proposed") throw new Error(`H-MEM: no pending proposal ${proposalId}`);
    p.status = "approved";
    this.ledger.log(proposalId, "dream_approved", this.actor, { details: { type: p.type } });
    if (p.type === "domain") {
      for (const id of p.derivedFrom) {
        const m = this.store.get(id);
        if (m && p.suggestedDomain) this.store.update(id, { domain: p.suggestedDomain });
      }
      return void 0;
    }
    return this.store.add({
      content: p.content,
      type: p.type === "insight" ? "factual" : "preference",
      layer: "long_term",
      tags: [`dream:${p.type}`],
      confidence: 0.75,
      source: "dreaming",
      provenance: { origin: "dream", learnedAt: this.clock(), label: `approved ${p.type} proposal` },
      derivedFrom: p.derivedFrom
    });
  }
  reject(proposalId) {
    const p = this.proposals.get(proposalId);
    if (!p || p.status !== "proposed") throw new Error(`H-MEM: no pending proposal ${proposalId}`);
    p.status = "rejected";
    this.ledger.log(proposalId, "dream_rejected", this.actor, { details: { type: p.type } });
  }
};

// vendor/hmem/src/index.ts
var HMEM = class {
  ledger;
  store;
  mining;
  retrieval;
  conflicts;
  sleep;
  dreaming;
  clock;
  constructor(opts = {}) {
    this.clock = opts.clock ?? Date.now;
    const actor = opts.actor ?? "system";
    this.ledger = new TrustLedgerService(this.clock, opts.persistDir);
    this.store = new MemoryStoreService(this.clock, this.ledger, actor, opts.persistDir);
    this.mining = new MemoryMiningService(this.store, this.clock, opts.minerFn);
    this.retrieval = new MemoryRetrievalService(this.store, this.ledger, this.clock, actor);
    this.conflicts = new ConflictDetectionService(this.store, this.ledger, this.clock, actor);
    this.sleep = new SleepCycleService(this.store, this.ledger, this.clock, actor);
    this.dreaming = new DreamingService(this.store, this.ledger, this.clock, actor);
  }
  // Convenience surface mirroring HOW_TO_USE_H-MEM.md.
  add(input) {
    return this.store.add(input);
  }
  mine(event, text, opts) {
    return this.mining.mineInteraction(event, text, opts);
  }
  query(query, opts) {
    return this.retrieval.query(query, opts);
  }
  feedback(memoryId, kind) {
    this.retrieval.feedback(memoryId, kind);
  }
};
export {
  ConflictDetectionService,
  DAY_MS,
  DEFAULTS,
  DreamingService,
  FEEDBACK_DELTAS,
  HMEM,
  MemoryMiningService,
  MemoryRetrievalService,
  MemoryStoreService,
  SleepCycleService,
  TrustLedgerService,
  clamp01,
  cosine,
  embed,
  jaccard,
  parseStrictJsonArray,
  tokenize
};
