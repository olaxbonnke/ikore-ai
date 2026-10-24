import "../src/core/env.ts";
import { getGateway } from "../src/data/gateway.ts";
import { loadRainDaily } from "../src/core/observe.ts";
import { simulatePlanting } from "../src/core/simulate/planting.ts";

const farmId = "farm_bisi_ogbomoso";
const asOf = "2026-04-10";

async function runTest(mode: "live" | "snapshot") {
  console.log(`\n======================================================`);
  console.log(`Running planting simulation in mode: ${mode.toUpperCase()}`);
  console.log(`======================================================`);

  let envCopy = { ...process.env };
  if (mode === "snapshot") {
    delete envCopy.ZETARIS_REST_URL;
  }

  const gateway = getGateway(envCopy);
  const loaded = await loadRainDaily(gateway, farmId);

  console.log(`Loaded ${loaded.records.length} daily rainfall rows.`);
  console.log(`Gateway Source: ${loaded.source}`);
  console.log(`Provenance: ${loaded.provenance}`);

  const options = simulatePlanting({
    series: loaded.records,
    asOf,
  });

  console.log("\nSimulation Options (Planting Decisions):");
  for (const opt of options) {
    const replantPct = `${(opt.replantProbability * 100).toFixed(1)}%`;
    console.log(`  - Option: ${opt.option} (${opt.label})`);
    console.log(`    Planting Date: ${opt.plantingDate}`);
    console.log(`    Replant Risk: ${replantPct}`);
    console.log(`    Adequacy (p10/p50/p90): ${(opt.rainfallAdequacy.p10 * 100).toFixed(1)}% / ${(opt.rainfallAdequacy.p50 * 100).toFixed(1)}% / ${(opt.rainfallAdequacy.p90 * 100).toFixed(1)}%`);
    console.log(`    Analog Years (n): ${opt.n}`);
  }

  return {
    source: loaded.source,
    provenance: loaded.provenance,
    options: options.map((o) => ({
      option: o.option,
      date: o.plantingDate,
      replantRisk: `${(o.replantProbability * 100).toFixed(1)}%`,
    })),
  };
}

async function main() {
  const liveResult = await runTest("live");
  const snapshotResult = await runTest("snapshot");

  console.log("\n======================================================");
  console.log("COMPARISON SUMMARY:");
  console.log("======================================================");
  console.log("Live (Zetaris):");
  console.log(`  Provenance: ${liveResult.provenance}`);
  console.log("  Replant risks:", liveResult.options.map((o) => `${o.option}: ${o.replantRisk}`).join(", "));

  console.log("\nSnapshot (Offline):");
  console.log(`  Provenance: ${snapshotResult.provenance}`);
  console.log("  Replant risks:", snapshotResult.options.map((o) => `${o.option}: ${o.replantRisk}`).join(", "));

  // Assert equivalence
  for (let i = 0; i < liveResult.options.length; i++) {
    const l = liveResult.options[i];
    const s = snapshotResult.options[i];
    if (l.option !== s.option || l.replantRisk !== s.replantRisk) {
      throw new Error(`Mismatch between live and snapshot: ${JSON.stringify(l)} vs ${JSON.stringify(s)}`);
    }
  }

  console.log("\n✓ SUCCESS: Both live Zetaris and offline snapshot produce identical replant risk figures!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
