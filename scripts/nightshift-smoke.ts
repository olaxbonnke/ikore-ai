import "../src/core/env.ts";
import { explain } from "../src/core/explain.ts";
import type { Decision } from "../src/core/types.ts";

async function main(): Promise<void> {
  console.log(`======================================================`);
  console.log(`Meterless Nightshift Live Explanation Smoke Check`);
  console.log(`======================================================`);

  const mockDecision: Decision = {
    id: "dec_smoke_nightshift",
    farmId: "farm_bisi_ogbomoso",
    intent: "plant_timing",
    createdAt: new Date().toISOString(),
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

  const t0 = Date.now();
  console.log("Sending real explanation request through Meterless Nightshift...\n");

  const reply = await explain(mockDecision, "en");
  const elapsedMs = Date.now() - t0;

  console.log(`------------------------------------------------------`);
  console.log(`Responded Model: ${reply.model || "none"}`);
  console.log(`Latency:         ${reply.latencyMs ?? elapsedMs}ms`);
  console.log(`Path:            ${reply.path}`);
  if (reply.fallbackReason) {
    console.log(`Fallback Reason: ${reply.fallbackReason}`);
  }
  console.log(`------------------------------------------------------`);
  console.log(`First 200 characters of reply:`);
  console.log(`"${reply.text.slice(0, 200)}"`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error("Smoke check failed:", err);
  process.exit(1);
});
