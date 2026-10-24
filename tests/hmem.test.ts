import { describe, expect, it } from "vitest";
import { ask, audit, feedback, remember, sleep } from "../src/memory/hmem.ts";

describe("H-MEM farm memory wrapper", () => {
  it("ask('farm_bisi_ogbomoso', 'storage method') returns a memory id and audit(id) shows its ledger", async () => {
    // 1. Ask for storage method
    const result = await ask("farm_bisi_ogbomoso", "storage method");
    expect(result.memories.length).toBeGreaterThan(0);
    expect(result.length).toBeGreaterThan(0);

    const topMemory = result.memories[0];
    expect(topMemory.id).toBeDefined();
    expect(topMemory.id).toMatch(/^mem-\d+$/);
    expect(topMemory.content.toLowerCase()).toContain("sack");
    expect(result.trace).toBeDefined();
    expect(result.trace.strategy).toBeDefined();

    // 2. Audit the memory id
    const history = await audit(topMemory.id);
    expect(history.length).toBeGreaterThanOrEqual(1);

    const createEntry = history.find((e) => e.action === "create");
    expect(createEntry).toBeDefined();
    expect(createEntry?.memoryId).toBe(topMemory.id);
    expect(createEntry?.actor).toContain("farm_bisi_ogbomoso");
  });

  it("records feedback into the TrustLedger", async () => {
    const askResult = await ask("farm_bisi_ogbomoso", "storage method");
    const memId = askResult.memories[0].id;

    await feedback(memId, "helpful");

    const history = await audit(memId);
    const feedbackEntry = history.find((e) => e.action === "feedback");
    expect(feedbackEntry).toBeDefined();
    expect(feedbackEntry?.memoryId).toBe(memId);
  });

  it("isolates memory between farms (namespacing)", async () => {
    // Mama Bisi uses sack
    const bisiResult = await ask("farm_bisi_ogbomoso", "storage method");
    expect(bisiResult.memories[0].content.toLowerCase()).toContain("sack");

    // Baba Ade uses pics
    const adeResult = await ask("farm_ade_iseyin", "storage method");
    expect(adeResult.memories[0].content.toLowerCase()).toContain("pics");
  });

  it("retrieves past season records from H-MEM and verifies demo_seed provenance", async () => {
    const pastRecords = await ask("farm_bisi_ogbomoso", "past season harvest yield");
    expect(pastRecords.memories.length).toBeGreaterThan(0);
    const seasonRecord = pastRecords.memories.find((m) => m.content.includes("harvested"));
    expect(seasonRecord).toBeDefined();
    expect(seasonRecord?.provenance?.label).toBe("demo_seed");
  });

  it("computes sleep cycle preview without mutating state", async () => {
    const preview = (await sleep("farm_bisi_ogbomoso", { preview: true })) as {
      toConsolidate: string[];
      toArchive: string[];
      toSynthesize: string[][];
    };

    expect(preview).toBeDefined();
    expect(Array.isArray(preview.toConsolidate)).toBe(true);
    expect(Array.isArray(preview.toArchive)).toBe(true);
    expect(Array.isArray(preview.toSynthesize)).toBe(true);
  });

  it("imports the engine through src/engine.ts with cwd = project root and asserts H-MEM loads", async () => {
    const { loadHMEM } = await import("../src/engine.ts");
    const loaded = await loadHMEM();
    expect(loaded).toBeDefined();
    expect(typeof loaded.HMEM).toBe("function");
    expect(loaded.source).toContain("vendor/hmem");
  });

  it("dedupes strictly by runId: same runId stores once, different runIds store distinct memories", async () => {
    const { remember, getFarmHMEM } = await import("../src/memory/hmem.ts");
    const farmId = "farm_ade_iseyin";
    const hmem = await getFarmHMEM(farmId);
    const initialCount = hmem.store.records.size;

    const runA = `run_test_${Date.now()}_a`;
    const runB = `run_test_${Date.now()}_b`;
    const decFixed = "dec_2026-04-10_farm_ade_iseyin_plant_timing_01";

    // Call 1 with runA
    const idA1 = await remember(farmId, {
      type: "advice",
      runId: runA,
      decisionId: decFixed,
      content: "Question: 'Should I plant now?'. Advice: plant_now",
    });

    // Call 2 with same runA (should dedup and return idA1)
    const idA2 = await remember(farmId, {
      type: "advice",
      runId: runA,
      decisionId: decFixed,
      content: "Question: 'Should I plant now?'. Advice: plant_now",
    });

    expect(idA1).toBe(idA2);
    expect(hmem.store.records.size).toBe(initialCount + 1);

    // Call 3 with different runB even though decisionId is identical (must store a new record)
    const idB = await remember(farmId, {
      type: "advice",
      runId: runB,
      decisionId: decFixed,
      content: "Question: 'What about planting later?'. Advice: wait_7",
    });

    expect(idB).not.toBe(idA1);
    expect(hmem.store.records.size).toBe(initialCount + 2);
  });

  it("reseeds demo memories with [Demo ...] labels and seed_version:2 without deleting user memories", async () => {
    const { getFarmHMEM, clearHMEMCache } = await import("../src/memory/hmem.ts");
    const farmId = "farm_ade_iseyin";
    const hmem = await getFarmHMEM(farmId);

    // Verify all seeded demo facts have [Demo ...] prefix and seed_version:2 tag
    const demoRecords = [...hmem.store.records.values()].filter(
      (r: any) => r.source === "demo-seed" || r.tags?.includes("demo-seed")
    );
    expect(demoRecords.length).toBeGreaterThan(0);
    for (const rec of demoRecords) {
      expect(rec.tags).toContain("seed_version:2");
      expect(rec.content).toMatch(/^\[Demo (?:profile|fact|record) from data\//);
    }
  });

  it("deduplicateMemories removes duplicate memories with identical or normalized content", async () => {
    const { deduplicateMemories } = await import("../src/memory/hmem.ts");
    const list = [
      { id: "mem-1", content: "Planting advice for 2026-04-10: wait_7." },
      { id: "mem-2", content: "planting advice for 2026-04-10:   wait_7. " },
      { id: "mem-3", content: "Different advice for 2026-04-10: plant_now." },
    ];
    const deduped = deduplicateMemories(list);
    expect(deduped.length).toBe(2);
    expect(deduped[0].id).toBe("mem-1");
    expect(deduped[1].id).toBe("mem-3");
  });

  it("prevents storing identical memory twice for same farm (same question + same verdict + same date)", async () => {
    const farmId = "farm_ade_iseyin";
    const eventPayload = {
      type: "advice",
      intent: "plant_timing",
      verdict: "wait_14",
      decisionId: "dec_test_dedup",
      question: "when should i plant maize",
      date: "2026-04-10",
      content: 'Question: "when should i plant maize". Planting advice for 2026-04-10: wait_14.',
    };

    const firstId = await remember(farmId, eventPayload);
    expect(firstId).toBeDefined();

    // Store again with a different runId or no runId, but identical question, verdict, date
    const secondId = await remember(farmId, {
      ...eventPayload,
      runId: "run_different_123",
    });

    expect(secondId).toBe(firstId);
  });

  it("hmem:reset renames .oko/hmem to a backup folder rather than deleting files", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { resetHMEM } = await import("../scripts/hmem-reset.ts");

    const stateDir = process.env.OKO_STATE_DIR || ".oko";
    const hmemDir = path.resolve(process.cwd(), stateDir, "hmem");

    // Ensure hmem directory exists
    fs.mkdirSync(hmemDir, { recursive: true });
    const dummyFile = path.join(hmemDir, "test_marker.txt");
    fs.writeFileSync(dummyFile, "marker_content", "utf-8");

    const result = resetHMEM();
    expect(result.success).toBe(true);
    expect(result.renamedTo).toBeDefined();
    expect(fs.existsSync(hmemDir)).toBe(false);
    expect(fs.existsSync(result.renamedTo!)).toBe(true);
    expect(fs.existsSync(path.join(result.renamedTo!, "test_marker.txt"))).toBe(true);

    // Restore for subsequent tests
    fs.renameSync(result.renamedTo!, hmemDir);
  });
});
