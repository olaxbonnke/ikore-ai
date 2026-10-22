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

    return {
      rows,
      source: "snapshot",
      fetchedAt: new Date().toISOString(),
      provenance: fileName,
    };
  }

  private resolveFileName(sql: string, params?: Record<string, unknown>): string {
    if (typeof params?.file === "string") {
      return params.file;
    }

    const lower = sql.toLowerCase();
    if (lower.includes("price") || lower.includes("wfp")) {
      return "price_monthly__oyo.json";
    }
    if (lower.includes("calendar")) {
      return "crop_calendar__maize_ng.json";
    }
    if (
      lower.includes("rain") ||
      lower.includes("forecast") ||
      lower.includes("power") ||
      lower.includes("meteo")
    ) {
      return "rain_daily__farm_bisi_ogbomoso.json";
    }
    if (lower.includes("database") || lower.includes("show databases")) {
      return "verify_databases.json";
    }
    if (lower.includes("select 1")) {
      return "verify_select_1.json";
    }

    return "verify_select_1.json";
  }
}
