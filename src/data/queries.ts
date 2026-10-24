/** Named, parameter-validated SQL builders (DESIGN.md — all SQL lives here). */

export interface BuiltQuery {
  name: string;
  sql: string;
}

function rejectBadId(id: string, field: string): void {
  if (!/^[a-z0-9_]+$/.test(id)) {
    throw new Error(`Invalid ${field}: ${id}`);
  }
}

function rejectBadNumber(n: number, field: string): void {
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid ${field}: ${n}`);
  }
}

/** Stub builders — SQL wired in Day 2. */
export function rainDaily(farmId: string): BuiltQuery {
  rejectBadId(farmId, "farmId");
  return {
    name: "rainDaily",
    sql: `SELECT date, rain_mm FROM oko_pg.rain_daily WHERE farm_id = '${farmId}' ORDER BY date ASC`,
  };
}

export function forecast16d(_lat: number, _lon: number): BuiltQuery {
  rejectBadNumber(_lat, "lat");
  rejectBadNumber(_lon, "lon");
  throw new Error("forecast16d query not implemented yet");
}

export function rainHistory(_lat: number, _lon: number, _fromYear = 1985): BuiltQuery {
  rejectBadNumber(_lat, "lat");
  rejectBadNumber(_lon, "lon");
  throw new Error("rainHistory query not implemented yet");
}

export function recentRainDaily(farmId: string, asOf: string, days = 14): BuiltQuery {
  rejectBadId(farmId, "farmId");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error(`Invalid asOf date: ${asOf}`);
  }
  rejectBadNumber(days, "days");
  return {
    name: "recentRainDaily",
    sql: `SELECT date, rain_mm FROM oko_pg.rain_daily WHERE farm_id = '${farmId}' AND date <= '${asOf}' ORDER BY date DESC LIMIT ${Math.round(days)}`,
  };
}

export function recentRain(_lat: number, _lon: number, _days = 21): BuiltQuery {
  rejectBadNumber(_lat, "lat");
  rejectBadNumber(_lon, "lon");
  throw new Error("recentRain query not implemented yet");
}

export function priceSeasonality(state: string, commodity = "Maize (white)"): BuiltQuery {
  if (!/^[a-zA-Z0-9_ -]+$/.test(state)) {
    throw new Error(`Invalid state: ${state}`);
  }
  if (!/^[a-zA-Z0-9_ ()-]+$/.test(commodity)) {
    throw new Error(`Invalid commodity: ${commodity}`);
  }
  return {
    name: "priceSeasonality",
    sql: `SELECT state, market, commodity, unit, pricetype, ym, price_ngn_per_kg FROM oko_pg.prices WHERE LOWER(state) = LOWER('${state}') ORDER BY ym ASC, commodity ASC`,
  };
}

export function cropCalendar(_crop: string, _zone: string): BuiltQuery {
  rejectBadId(_crop, "crop");
  if (!/^[a-z0-9_]+$/.test(_zone)) {
    throw new Error(`Invalid zone: ${_zone}`);
  }
  throw new Error("cropCalendar query not implemented yet");
}

export function farmRecords(farmId: string): BuiltQuery {
  rejectBadId(farmId, "farmId");
  throw new Error("farmRecords query not implemented yet");
}

export function soil(_lat: number, _lon: number): BuiltQuery {
  rejectBadNumber(_lat, "lat");
  rejectBadNumber(_lon, "lon");
  throw new Error("soil query not implemented yet");
}

export function nimetOnset(state: string, season: string | number): BuiltQuery {
  if (!/^[a-zA-Z0-9_]+$/.test(state)) {
    throw new Error(`Invalid state: ${state}`);
  }
  const seasonStr = String(season);
  if (!/^[0-9]+$/.test(seasonStr)) {
    throw new Error(`Invalid season: ${seasonStr}`);
  }
  return {
    name: "nimetOnset",
    sql: `SELECT state, season, onset_start, onset_end, wait_after_onset_days_min, wait_after_onset_days_max, source_name, source_url, note FROM oko_pg.nimet_onset WHERE LOWER(state) = LOWER('${state}') AND season = ${seasonStr} LIMIT 1`,
  };
}
