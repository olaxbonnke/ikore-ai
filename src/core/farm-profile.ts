import fs from "node:fs";
import path from "node:path";
import type { Farm } from "./types.ts";

/**
 * Loads farm profile by farmId from seeded CSV data.
 */
export function getFarmProfile(farmId: string): Farm {
  const csvPath = path.resolve(process.cwd(), "data", "farms_seed.csv");
  if (fs.existsSync(csvPath)) {
    const lines = fs
      .readFileSync(csvPath, "utf-8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));

    if (lines.length > 1) {
      const headers = lines[0].split(",").map((h) => h.trim());
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",").map((p) => p.trim());
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = parts[idx] ?? "";
        });

        if (row.id === farmId) {
          return {
            id: row.id,
            ownerName: row.owner_name,
            lat: Number(row.lat),
            lon: Number(row.lon),
            state: row.state,
            lga: row.lga,
            crop: (row.crop as "maize") || "maize",
            hectares: Number(row.hectares),
            storage: (row.storage as any) || "sack",
            preferredLang: (row.preferred_lang as any) || "en",
            riskAversion: (row.risk_aversion as any) || "normal",
            zone: (row.zone as any) || "derived_savanna",
          };
        }
      }
    }
  }

  // Safe fallback for demo farm
  return {
    id: farmId,
    ownerName: "Mama Bisi",
    lat: 8.13,
    lon: 4.24,
    state: "Oyo",
    lga: "Ogbomoso North",
    crop: "maize",
    hectares: 2,
    storage: "sack",
    preferredLang: "pcm",
    riskAversion: "normal",
    zone: "derived_savanna",
  };
}
