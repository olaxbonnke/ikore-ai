import dotenv from "dotenv";
import { handle } from "../src/core/orchestrator.ts";

dotenv.config();

async function main(): Promise<void> {
  const farmId = process.argv[2] || "farm_bisi_ogbomoso";
  const question = process.argv[3] || "when should I plant?";

  if (!process.env.OKO_DEMO_DATE) {
    process.env.OKO_DEMO_DATE = "2026-04-10";
  }

  console.log(`\n======================================================`);
  console.log(`Ikore AI Advisory Query`);
  console.log(`======================================================`);
  console.log(`Farm ID:   ${farmId}`);
  console.log(`Question:  "${question}"`);
  console.log(`As Of:     ${process.env.OKO_DEMO_DATE}`);

  const reply = await handle({
    farmId,
    text: question,
  });

  console.log(`\n------------------------------------------------------`);
  console.log(`ADVISOR REPLY (${reply.lang.toUpperCase()}):`);
  console.log(`------------------------------------------------------`);
  console.log(reply.text);

  if (reply.decision) {
    console.log(`\n------------------------------------------------------`);
    console.log(`DECISION VERDICT & KEY NUMBERS:`);
    console.log(`------------------------------------------------------`);
    console.log(`Verdict:    ${reply.decision.chosen} (Runner-up: ${reply.decision.runnerUp})`);
    console.log(`Confidence: ${reply.decision.confidence}`);
    console.log(`Risk Badge: ${reply.decision.riskBadge}`);
    console.log(`Key Numbers:`);
    for (const [k, v] of Object.entries(reply.decision.keyNumbers)) {
      console.log(`  - ${k}: ${v}`);
    }

    console.log(`\n------------------------------------------------------`);
    console.log(`PROVENANCE & EVIDENCE:`);
    console.log(`------------------------------------------------------`);
    for (const ev of reply.decision.evidence) {
      console.log(`  [${ev.id}] ${ev.label}`);
      console.log(`    Source:    ${ev.source}`);
      if (ev.sql) {
        console.log(`    SQL:       ${ev.sql}`);
      }
      if (ev.statistic) {
        console.log(`    Statistic: ${ev.statistic}`);
      }
    }

    console.log(`\nMemory IDs Referenced:`, reply.memoryIdsUsed);
  }

  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error("Query failed:", err);
  process.exit(1);
});
