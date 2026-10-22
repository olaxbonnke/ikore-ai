import fs from "node:fs";
import path from "node:path";
import type { DataGateway, GatewayResult } from "./gateway.ts";

export class SnapshotGateway implements DataGateway {
  readonly mode = "snapshot" as const;
  private readonly snapshotsDir: string;

  constructor(snapshotsDir?: string) {
    this.snapshotsDir = snapshotsDir || path.resolve(process.cwd(), "data", "snapshots");
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: Record<string, unknown>
  ): Promise<GatewayResult<T>> {
    const fileName = this.resolveFileName(sql, params);
    const filePath = path.join(this.snapshotsDir, fileName);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Snapshot file not found: ${fileName} (expected at ${filePath})`);
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    const rows = (Array.isArray(parsed) ? parsed : (parsed.rows ?? [])) as T[];
    const isMock = parsed.source === "mock" || parsed.source === "assumption";
    const source: "mock" | "snapshot" = isMock ? "mock" : "snapshot";
    const provenance = isMock
      ? (parsed.note || fileName)
      : (Array.isArray(parsed.sourceUrls)
          ? parsed.sourceUrls.join(" & ")
          : (parsed.sourceUrl || parsed.source || fileName));
    const fetchedAt = parsed.fetchedAt || new Date().toISOString();

    return {
      rows,
      source,
      fetchedAt,
      provenance,
    };
  }

  private resolveFileName(sql: string, params?: Record<string, unknown>): string {
    if (typeof params?.file === "string") {
      return params.file;
    }

    const lower = sql.toLowerCase();
    const farmId = (typeof params?.farmId === "string" ? params.farmId : "").trim();

    // Weather history: NASA POWER
    if (lower.includes("power") || lower.includes("nasa") || lower.includes("history")) {
      if (farmId) {
        const candidate = `nasa_power_daily__${farmId}.json`;
        if (fs.existsSync(path.join(this.snapshotsDir, candidate))) return candidate;
      }
      return "nasa_power_daily__farm_bisi_ogbomoso.json";
    }

    // Weather forecast: Open-Meteo
    if (lower.includes("forecast") || lower.includes("meteo") || lower.includes("forecast16d")) {
      if (farmId) {
        const candidate = `open_meteo_forecast__${farmId}.json`;
        if (fs.existsSync(path.join(this.snapshotsDir, candidate))) return candidate;
      }
      return "open_meteo_forecast__farm_bisi_ogbomoso.json";
    }

    // Combined rain view or generic rain
    if (lower.includes("rain")) {
      if (farmId) {
        const candidate = `rain_daily__${farmId}.json`;
        if (fs.existsSync(path.join(this.snapshotsDir, candidate))) return candidate;
        const candidateNasa = `nasa_power_daily__${farmId}.json`;
        if (fs.existsSync(path.join(this.snapshotsDir, candidateNasa))) return candidateNasa;
      }
      return "rain_daily__farm_bisi_ogbomoso.json";
    }

    // Storage loss
    if (lower.includes("storage") || lower.includes("loss")) {
      return "storage_loss.json";
    }

    // Crop calendar
    if (lower.includes("calendar")) {
      return "crop_calendar__maize_ng.json";
    }

    // Market price
    if (lower.includes("price") || lower.includes("wfp")) {
      return "price_monthly__oyo.json";
    }

    // Verification queries
    if (lower.includes("database") || lower.includes("show databases")) {
      return "verify_databases.json";
    }
    if (lower.includes("select 1")) {
      return "verify_select_1.json";
    }

    return "verify_select_1.json";
  }
}
