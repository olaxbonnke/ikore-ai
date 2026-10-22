import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

interface FarmSeed {
  id: string;
  ownerName: string;
  lat: number;
  lon: number;
  state: string;
  lga: string;
  crop: string;
  hectares: number;
  storage: string;
  preferredLang: string;
  riskAversion: string;
  zone: string;
}

interface SnapshotFile<T> {
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  params: Record<string, unknown>;
  rows: T[];
}

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

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fetchWithRetry(url: string, retries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "OkoFarmAgent/1.0 (hackathon@genai.works)" },
        signal: AbortSignal.timeout(45_000),
      });
      if (res.ok) return res;
      if (res.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Failed to fetch ${url}`);
}

async function fetchNasaPower(farm: FarmSeed, outDir: string): Promise<{ rows: any[]; url: string }> {
  console.log(`[NASA POWER] Fetching 1991-present for ${farm.id} (${farm.lat}, ${farm.lon})...`);
  const endDateCandidates = ["20261020", "20261018", "20261015", "20261010"];
  let finalData: any = null;
  let finalUrl = "";

  for (const endYmd of endDateCandidates) {
    const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,T2M_MAX,T2M_MIN&community=AG&longitude=${farm.lon}&latitude=${farm.lat}&start=19910101&end=${endYmd}&format=JSON`;
    try {
      const res = await fetchWithRetry(url);
      if (res.ok) {
        finalData = await res.json();
        finalUrl = url;
        break;
      }
    } catch {
      // try next date candidate
    }
  }

  if (!finalData || !finalData.properties?.parameter) {
    throw new Error(`Could not fetch NASA POWER data for ${farm.id}`);
  }

  const p = finalData.properties.parameter;
  const dates = Object.keys(p.PRECTOTCORR || {}).sort();
  const rows = dates.map((ymd) => {
    const date = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
    const rain = p.PRECTOTCORR?.[ymd];
    const tmax = p.T2M_MAX?.[ymd];
    const tmin = p.T2M_MIN?.[ymd];
    return {
      farm_id: farm.id,
      date,
      rain_mm: rain === -999 ? null : Number(rain),
      t2m_max: tmax === -999 ? null : Number(tmax),
      t2m_min: tmin === -999 ? null : Number(tmin),
    };
  });

  const snapshot: SnapshotFile<typeof rows[0]> = {
    source: "snapshot",
    sourceUrl: finalUrl,
    fetchedAt: new Date().toISOString(),
    params: { farmId: farm.id, lat: farm.lat, lon: farm.lon, start: "19910101" },
    rows,
  };

  const filePath = path.join(outDir, `nasa_power_daily__${farm.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`[NASA POWER] Saved ${rows.length} rows to ${path.basename(filePath)}`);
  return { rows, url: finalUrl };
}

async function fetchOpenMeteo(farm: FarmSeed, demoDate: string, outDir: string): Promise<{ rows: any[]; url: string }> {
  const startDate = demoDate;
  const endDate = addDays(demoDate, 15); // 16 days inclusive

  console.log(`[Open-Meteo] Fetching 16-day historical forecast (${startDate} to ${endDate}) for ${farm.id}...`);
  const url = `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${farm.lat}&longitude=${farm.lon}&start_date=${startDate}&end_date=${endDate}&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&timezone=Africa%2FLagos`;

  const res = await fetchWithRetry(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Open-Meteo API returned status ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    daily?: {
      time?: string[];
      precipitation_sum?: (number | null)[];
      temperature_2m_max?: (number | null)[];
      temperature_2m_min?: (number | null)[];
    };
  };

  const times = data.daily?.time || [];
  const rows = times.map((date, idx) => ({
    farm_id: farm.id,
    date,
    precipitation_sum: data.daily?.precipitation_sum?.[idx] ?? 0,
    temperature_2m_max: data.daily?.temperature_2m_max?.[idx] ?? null,
    temperature_2m_min: data.daily?.temperature_2m_min?.[idx] ?? null,
  }));

  const snapshot: SnapshotFile<typeof rows[0]> = {
    source: "snapshot",
    sourceUrl: url,
    fetchedAt: new Date().toISOString(),
    params: { farmId: farm.id, lat: farm.lat, lon: farm.lon, demoDate, days: 16 },
    rows,
  };

  const filePath = path.join(outDir, `open_meteo_forecast__${farm.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`[Open-Meteo] Saved ${rows.length} rows to ${path.basename(filePath)}`);
  return { rows, url };
}

function buildRainDailySnapshot(
  farm: FarmSeed,
  nasaRows: any[],
  meteoRows: any[],
  meteoUrl: string,
  demoDate: string,
  outDir: string
): void {
  // Combine recent NASA POWER history for 2026 before demoDate with 16-day Open-Meteo forecast
  const demoYear = demoDate.slice(0, 4);
  const historyRows = nasaRows
    .filter((r) => r.date >= `${demoYear}-01-01` && r.date < demoDate)
    .map((r) => ({
      farm_id: farm.id,
      date: r.date,
      rain_mm: r.rain_mm ?? 0,
      tmax: r.t2m_max ?? null,
      tmin: r.t2m_min ?? null,
      source: "history",
    }));

  const forecastRows = meteoRows.map((r) => ({
    farm_id: farm.id,
    date: r.date,
    rain_mm: r.precipitation_sum ?? 0,
    tmax: r.temperature_2m_max ?? null,
    tmin: r.temperature_2m_min ?? null,
    source: "forecast",
  }));

  const combinedRows = [...historyRows, ...forecastRows];
  const snapshot: SnapshotFile<typeof combinedRows[0]> = {
    source: "snapshot",
    sourceUrl: meteoUrl,
    fetchedAt: new Date().toISOString(),
    params: {
      farmId: farm.id,
      demoDate,
      historyCount: historyRows.length,
      forecastCount: forecastRows.length,
    },
    rows: combinedRows,
  };

  const filePath = path.join(outDir, `rain_daily__${farm.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`[Rain Daily] Saved ${combinedRows.length} real fetched rows (${historyRows.length} history + ${forecastRows.length} forecast) to ${path.basename(filePath)}`);
}

function convertCsvFiles(projectRoot: string, outDir: string): void {
  // 1. Crop Calendar
  const calCsvPath = path.join(projectRoot, "data", "crop_calendar_maize_ng.csv");
  if (fs.existsSync(calCsvPath)) {
    const raw = parseCsv(fs.readFileSync(calCsvPath, "utf-8"));
    const rows = raw.map((r) => ({
      crop: r.crop,
      zone: r.zone,
      season: r.season,
      plant_start_mmdd: r.plant_start_mmdd,
      plant_opt_end_mmdd: r.plant_opt_end_mmdd,
      plant_last_mmdd: r.plant_last_mmdd,
      days_to_maturity: Number(r.days_to_maturity) || 100,
      water_need_min_mm: Number(r.water_need_min_mm) || 500,
      water_need_max_mm: Number(r.water_need_max_mm) || 800,
      source: r.source,
    }));

    const snapshot: SnapshotFile<typeof rows[0]> = {
      source: "snapshot",
      sourceUrl: "https://raw.githubusercontent.com/olaxbonnke/oko-farm-agent/main/data/crop_calendar_maize_ng.csv",
      fetchedAt: new Date().toISOString(),
      params: { file: "crop_calendar_maize_ng.csv" },
      rows,
    };
    fs.writeFileSync(path.join(outDir, "crop_calendar__maize_ng.json"), JSON.stringify(snapshot, null, 2), "utf-8");
    console.log(`[CSV Convert] Converted ${rows.length} rows to crop_calendar__maize_ng.json`);
  }

  // 2. Storage Loss
  const lossCsvPath = path.join(projectRoot, "data", "storage_loss.csv");
  if (fs.existsSync(lossCsvPath)) {
    const raw = parseCsv(fs.readFileSync(lossCsvPath, "utf-8"));
    const rows = raw.map((r) => ({
      storage: r.storage,
      monthly_loss_pct: Number(r.monthly_loss_pct) || 0,
      source: r.source,
    }));

    const snapshot: SnapshotFile<typeof rows[0]> = {
      source: "snapshot",
      sourceUrl: "https://raw.githubusercontent.com/olaxbonnke/oko-farm-agent/main/data/storage_loss.csv",
      fetchedAt: new Date().toISOString(),
      params: { file: "storage_loss.csv" },
      rows,
    };
    fs.writeFileSync(path.join(outDir, "storage_loss.json"), JSON.stringify(snapshot, null, 2), "utf-8");
    console.log(`[CSV Convert] Converted ${rows.length} rows to storage_loss.json`);
  }
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const outDir = path.join(projectRoot, "data", "snapshots");
  fs.mkdirSync(outDir, { recursive: true });

  const demoDate = process.env.OKO_DEMO_DATE?.trim() || "2026-04-10";
  console.log(`Using demo date: ${demoDate}`);

  // Convert CSVs first
  convertCsvFiles(projectRoot, outDir);

  // Read farms_seed.csv
  const farmsCsvPath = path.join(projectRoot, "data", "farms_seed.csv");
  if (!fs.existsSync(farmsCsvPath)) {
    throw new Error(`data/farms_seed.csv not found at ${farmsCsvPath}`);
  }

  const rawFarms = parseCsv(fs.readFileSync(farmsCsvPath, "utf-8"));
  const farms: FarmSeed[] = rawFarms.map((r) => ({
    id: r.id,
    ownerName: r.owner_name,
    lat: Number(r.lat),
    lon: Number(r.lon),
    state: r.state,
    lga: r.lga,
    crop: r.crop,
    hectares: Number(r.hectares),
    storage: r.storage,
    preferredLang: r.preferred_lang,
    riskAversion: r.risk_aversion,
    zone: r.zone,
  }));

  console.log(`Found ${farms.length} seeded farms.`);

  for (const farm of farms) {
    const { rows: nasaRows } = await fetchNasaPower(farm, outDir);
    const { rows: meteoRows, url: meteoUrl } = await fetchOpenMeteo(farm, demoDate, outDir);
    buildRainDailySnapshot(farm, nasaRows, meteoRows, meteoUrl, demoDate, outDir);
  }

  console.log("All snapshots fetched successfully!");
}

main().catch((err) => {
  console.error("Fetch snapshots failed:", err);
  process.exit(1);
});
