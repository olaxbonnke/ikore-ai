import dotenv from "dotenv";
import * as fs from "fs";
import { handle } from "../src/core/orchestrator.ts";
import { templatePlanting, templateSelling } from "../src/i18n/templates.ts";

dotenv.config();
process.env.DATA_MODE = "snapshot";

interface QARun {
  id: string;
  intent: "plant_timing" | "sell_or_store";
  lang: "en" | "pcm" | "yo";
  asOf: string;
  prompt: string;
  replyText?: string;
  source?: "LLM" | "template";
  path?: "llm" | "template";
  fallbackReason?: string | null;
  latencyMs?: number;
}

const runs: QARun[] = [
  {
    id: "plant_en",
    intent: "plant_timing",
    lang: "en",
    asOf: "2026-04-10",
    prompt: "When should I plant my maize?",
  },
  {
    id: "plant_pcm",
    intent: "plant_timing",
    lang: "pcm",
    asOf: "2026-04-10",
    prompt: "When I go plant my corn this season?",
  },
  {
    id: "plant_yo",
    intent: "plant_timing",
    lang: "yo",
    asOf: "2026-04-10",
    prompt: "Ìgbà wo ni kí n gbìn àgbàdo mi ní àsìkò yìí?",
  },
  {
    id: "sell_en",
    intent: "sell_or_store",
    lang: "en",
    asOf: "2026-08-20",
    prompt: "I have 20 bags of maize and a buyer is offering ₦45,000 per bag. Should I sell now or store?",
  },
  {
    id: "sell_pcm",
    intent: "sell_or_store",
    lang: "pcm",
    asOf: "2026-08-20",
    prompt: "I get 20 bags, price na 45k per bag. Make I sell now or keep am?",
  },
  {
    id: "sell_yo",
    intent: "sell_or_store",
    lang: "yo",
    asOf: "2026-08-20",
    prompt: "Mo ní àpò 20, ẹnìkan fẹ́ rà ní ₦45,000 fún àpò kọ̀ọ̀kan. Ṣé kí n tà á báyìí tàbí kí n tọ́jú rẹ̀?",
  },
];

async function main() {
  console.log("Starting Live Multilingual Nemotron QA Runs in SNAPSHOT mode...\n");

  for (const r of runs) {
    process.env.OKO_DEMO_DATE = r.asOf;
    console.log(`========================================================`);
    console.log(`[Run ${r.id}] ${r.lang.toUpperCase()} | Intent: ${r.intent} | asOf: ${r.asOf}`);
    console.log(`Prompt: "${r.prompt}"`);

    try {
      const reply = await handle({
        farmId: "farm_bisi_ogbomoso",
        text: r.prompt,
      });

      r.replyText = reply.text;
      r.path = reply.path || "template";
      r.fallbackReason = reply.fallbackReason || null;
      r.latencyMs = reply.latencyMs || 0;
      r.source = reply.path === "llm" ? "LLM" : "template";

      console.log(`\nPath: ${r.path} | Latency: ${r.latencyMs}ms | Fallback Reason: ${r.fallbackReason || "None"}`);
      console.log(`Advisor Reply:\n${reply.text}\n`);
    } catch (err: any) {
      console.error(`Run ${r.id} failed:`, err.message);
    }
  }

  // Generate docs/lang-qa.md
  let md = `# Multilingual Explanation QA (Day 4.2)\n\n`;
  md += `Evaluated on **farm_bisi_ogbomoso** in **snapshot** mode with live Nemotron LLM (\`nvidia/nemotron-3.5-lightning-30b-a3b\` via build.nvidia.com) with \`chat_template_kwargs: { enable_thinking: false }\`, grounded number validation, and Yoruba diacritic guards.\n\n`;
  md += `| # | Intent | Language | Prompt | Path | Latency | Fallback Reason | Advisor Reply | Native Speaker Check |\n`;
  md += `|---|---|---|---|---|---|---|---|---|\n`;

  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const cleanReply = (r.replyText || "").replace(/\n+/g, "<br>").replace(/\|/g, "\\|");
    const cleanPrompt = r.prompt.replace(/\|/g, "\\|");
    const fallbackText = r.fallbackReason ? r.fallbackReason.replace(/\|/g, "\\|") : "-";
    md += `| ${i + 1} | ${r.intent} | ${r.lang} | "${cleanPrompt}" | **${r.path || "template"}** | ${r.latencyMs}ms | ${fallbackText} | ${cleanReply} |  |\n`;
  }

  md += `\n\n## Detailed Replies\n\n`;
  for (const r of runs) {
    md += `### ${r.id}: ${r.intent} (${r.lang})\n\n`;
    md += `- **asOf:** \`${r.asOf}\`\n`;
    md += `- **Prompt:** "${r.prompt}"\n`;
    md += `- **Path:** **${r.path}**\n`;
    md += `- **Latency:** ${r.latencyMs}ms\n`;
    md += `- **Fallback Reason:** ${r.fallbackReason ? `\`${r.fallbackReason}\`` : "None (Accepted LLM generation)"}\n\n`;
    md += `**Reply:**\n\n> ${r.replyText?.replace(/\n/g, "\n> ")}\n\n`;
    md += `**Native speaker check:**\n\n\n---\n\n`;
  }

  fs.writeFileSync("docs/lang-qa.md", md, "utf8");
  console.log("Wrote docs/lang-qa.md successfully.");
}

main().catch(console.error);
