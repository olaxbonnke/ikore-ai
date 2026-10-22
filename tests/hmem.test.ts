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

    // Musa uses sack_treated
    const musaResult = await ask("farm_musa_kaduna", "storage method");
    expect(musaResult.memories[0].content.toLowerCase()).toContain("sack_treated");

    // Baba Ade uses pics
    const adeResult = await ask("farm_ade_iseyin", "storage method");
    expect(adeResult.memories[0].content.toLowerCase()).toContain("pics");
  });

  it("retrieves past season records from H-MEM", async () => {
    const pastRecords = await ask("farm_bisi_ogbomoso", "past season harvest yield");
    expect(pastRecords.memories.length).toBeGreaterThan(0);
    const hasYield = pastRecords.memories.some((m) => m.content.includes("harvested"));
    expect(hasYield).toBe(true);
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
});
