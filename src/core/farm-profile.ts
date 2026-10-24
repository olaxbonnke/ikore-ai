import fs from "node:fs";
import path from "node:path";
import type { Farm } from "./types.ts";

/**
 * Returns array of all known/seeded farm IDs.
 */
export function getKnownFarmIds(): string[] {
  const csvPath = path.resolve(process.cwd(), "data", "farms_seed.csv");
  if (fs.existsSync(csvPath)) {
    const lines = fs
      .readFileSync(csvPath, "utf-8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));

    if (lines.length > 1) {
      const headers = lines[0].split(",").map((h) => h.trim());
      const idIdx = headers.indexOf("id");
      if (idIdx !== -1) {
        return lines
          .slice(1)
          .map((line) => line.split(",")[idIdx]?.trim())
          .filter((id): id is string => Boolean(id));
      }
    }
  }

  return ["farm_bisi_ogbomoso", "farm_ade_iseyin"];
}

/**
 * Checks whether a farm ID is known.
 */
export function isKnownFarmId(farmId: string): boolean {
  return getKnownFarmIds().includes(farmId);
}

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
