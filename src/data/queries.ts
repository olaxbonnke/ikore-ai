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

export function recentRain(_lat: number, _lon: number, _days = 21): BuiltQuery {
  rejectBadNumber(_lat, "lat");
  rejectBadNumber(_lon, "lon");
  throw new Error("recentRain query not implemented yet");
}

export function priceSeasonality(_state: string): BuiltQuery {
  throw new Error("priceSeasonality query not implemented yet");
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
