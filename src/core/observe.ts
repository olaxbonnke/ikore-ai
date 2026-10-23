import type { DataGateway } from "../data/gateway.ts";
import { rainDaily } from "../data/queries.ts";
import type { DailyRainRecord } from "./simulate/planting.ts";
import type { Farm, Observation } from "./types.ts";

export interface LoadedRainDaily {
  records: DailyRainRecord[];
  provenance: string;
  source: string;
  fetchedAt: string;
}

/**
 * Loads daily rainfall time series for a farm through DataGateway.
 * Routes to live Zetaris (oko_pg.rain_daily) or SnapshotGateway transparently.
 */
export async function loadRainDaily(
  gateway: DataGateway,
  farmId: string,
): Promise<LoadedRainDaily> {
  const query = rainDaily(farmId);
  const result = await gateway.query<{ date: string; rain_mm?: number | string | null; source?: string }>(
    query.sql,
    { farmId, limit: 50000 },
  );

  const records: DailyRainRecord[] = result.rows.map((r) => ({
    date: typeof r.date === "string" ? r.date.slice(0, 10) : String(r.date),
    rain_mm: r.rain_mm != null ? Number(r.rain_mm) : null,
    source: r.source,
  }));

  return {
    records,
    provenance: result.provenance,
    source: result.source,
    fetchedAt: result.fetchedAt,
  };
}

/** Builds Observation from Zetaris via DataGateway (DESIGN.md step 3). */
export async function observe(
  _gateway: DataGateway,
  _farm: Farm,
  _asOf: string,
): Promise<Observation> {
  throw new Error("observe() not implemented yet");
}
