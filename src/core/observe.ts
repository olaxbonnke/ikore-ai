import type { DataGateway } from "../data/gateway.ts";
import { rainDaily, recentRainDaily } from "../data/queries.ts";
import type { DailyRainRecord } from "./simulate/planting.ts";
import type { Farm, Observation } from "./types.ts";

export interface LoadedRainDaily {
  records: DailyRainRecord[];
  provenance: string;
  source: string;
  fetchedAt: string;
}

export interface LoadedRecentRain {
  records: Array<{ date: string; rain_mm: number }>;
  totalRainMm: number;
  startDate: string;
  endDate: string;
  daysCount: number;
  provenance: string;
  querySql: string;
}

/**
 * Loads recent daily rainfall time series for a farm through DataGateway (for agronomy/irrigation/harvest).
 */
export async function loadRecentRain(
  gateway: DataGateway,
  farmId: string,
  asOf: string,
  days = 14
): Promise<LoadedRecentRain> {
  const query = recentRainDaily(farmId, asOf, days);
  const result = await gateway.query<{ date: string; rain_mm?: number | string | null }>(
    query.sql,
    { farmId, limit: days }
  );

  const validRows = result.rows
    .filter((r) => typeof r.date === "string" && r.date <= asOf && r.rain_mm != null)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, days);

  validRows.sort((a, b) => a.date.localeCompare(b.date));

  const records = validRows.map((r) => ({
    date: r.date.slice(0, 10),
    rain_mm: typeof r.rain_mm === "number" ? r.rain_mm : parseFloat(String(r.rain_mm)),
  }));

  const totalRainMm = parseFloat(
    records.reduce((sum, r) => sum + r.rain_mm, 0).toFixed(1)
  );
  const startDate = records[0]?.date || asOf;
  const endDate = records[records.length - 1]?.date || asOf;

  return {
    records,
    totalRainMm,
    startDate,
    endDate,
    daysCount: records.length,
    provenance: result.provenance,
    querySql: query.sql,
  };
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

  // Simulation uses only historical data before asOf (NASA POWER), not the forecast
  const actualProvenance = result.provenance.includes("power.larc.nasa.gov")
    ? result.provenance.split(" & ")[0]
    : result.provenance;

  return {
    records,
    provenance: actualProvenance,
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
