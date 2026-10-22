import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { remember } from "../src/memory/hmem.ts";

dotenv.config();

function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });
    return row;
  });
}

async function seedFarms(): Promise<void> {
  const projectRoot = process.cwd();
  const farmsCsvPath = path.join(projectRoot, "data", "farms_seed.csv");

  if (!fs.existsSync(farmsCsvPath)) {
    throw new Error(`Seed file not found: ${farmsCsvPath}`);
  }

  const farms = parseCsv(fs.readFileSync(farmsCsvPath, "utf-8"));
  console.log(`Seeding ${farms.length} farms into H-MEM...`);

  let profileCount = 0;
  let recordsCount = 0;

  for (const f of farms) {
    const farmId = f.id;
    const owner = f.owner_name;
    const hectares = f.hectares;
    const storage = f.storage;
    const state = f.state;
    const lga = f.lga;
    const zone = f.zone;
    const lang = f.preferred_lang;
    const risk = f.risk_aversion;

    // 1. Comprehensive Farm Profile
    const profileText = `Farm profile: ${owner} (${farmId}) operates ${hectares} hectares of maize in ${lga}, ${state} State (${zone}). Storage method: ${storage}. Preferred language: ${lang}. Risk profile: ${risk}.`;
    await remember(farmId, {
      type: "farm_profile",
      content: profileText,
      payload: f,
      tags: ["profile", "farm_info", "maize", storage],
    });

    // 2. Storage method fact (specifically optimized for retrieval)
    const storageFact = `Storage method for ${owner} (${farmId}) is ${storage}.`;
    await remember(farmId, {
      type: "farm_fact",
      content: storageFact,
      payload: { storage },
      tags: ["storage", "storage_method", storage],
    });

    // 3. Scale and location fact
    const scaleFact = `${owner} farms ${hectares} hectares in ${lga}, ${state} State.`;
    await remember(farmId, {
      type: "farm_fact",
      content: scaleFact,
      payload: { hectares, lga, state },
      tags: ["hectares", "location", "field_size"],
    });

    profileCount++;
  }

  // Seed past records if data/farm_records.csv exists
  const recordsCsvPath = path.join(projectRoot, "data", "farm_records.csv");
  if (fs.existsSync(recordsCsvPath)) {
    const records = parseCsv(fs.readFileSync(recordsCsvPath, "utf-8"));
    console.log(`Seeding ${records.length} historical seasons from data/farm_records.csv...`);

    for (const r of records) {
      const seasonText = `Past season ${r.season_year} for ${r.farm_id}: planting date was ${r.planting_date}, germination was ${r.germination_ok}, harvested ${r.yield_bags} bags of maize, sold in ${r.sale_month} at ₦${r.sale_price_per_bag} per bag.`;
      await remember(r.farm_id, {
        type: "farm_season_record",
        content: seasonText,
        payload: r,
        tags: ["past_season", `year:${r.season_year}`, "yield", "records"],
      });
      recordsCount++;
    }
  }

  console.log(`Seeding complete! Seeded ${profileCount} farm profiles and ${recordsCount} historical season records.`);
}

seedFarms().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
