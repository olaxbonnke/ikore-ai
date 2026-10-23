import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ZetarisError } from "../src/core/errors.ts";
import { getGateway } from "../src/data/gateway.ts";
import { SnapshotGateway } from "../src/data/snapshot.ts";
import { isReadOnlySql, ZetarisGateway } from "../src/data/zetaris.ts";
import {
  MAX_DAILY_RAIN_MM,
  parseDailyRainMm,
  type NulledSpikeDay,
  validateNasaYearlyRainfall,
} from "../scripts/fetch-snapshots.ts";

describe("Snapshot files integrity", () => {
  it("verifies that each snapshot file in data/snapshots parses as JSON and has rows", () => {
    const snapshotsDir = path.resolve(process.cwd(), "data", "snapshots");
    const files = fs.readdirSync(snapshotsDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(10);

    for (const file of files) {
      const fullPath = path.join(snapshotsDir, file);
      const content = fs.readFileSync(fullPath, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed, `File ${file} must have rows`).toHaveProperty("rows");
      expect(Array.isArray(parsed.rows), `File ${file} rows must be an array`).toBe(true);
      expect(parsed.rows.length, `File ${file} must have at least 1 row`).toBeGreaterThan(0);
      expect(parsed, `File ${file} must have source or sourceUrl`).toHaveProperty("source");
      expect(parsed, `File ${file} must have fetchedAt`).toHaveProperty("fetchedAt");
      expect(parsed, `File ${file} must have params`).toHaveProperty("params");
    }
  });

  it("verifies seeded farms have NASA POWER history and Open-Meteo forecasts", () => {
    const snapshotsDir = path.resolve(process.cwd(), "data", "snapshots");
    const farmIds = ["farm_bisi_ogbomoso", "farm_ade_iseyin"];

    for (const farmId of farmIds) {
      const nasaPath = path.join(snapshotsDir, `nasa_power_daily__${farmId}.json`);
      expect(fs.existsSync(nasaPath), `NASA file for ${farmId} must exist`).toBe(true);
      const nasaData = JSON.parse(fs.readFileSync(nasaPath, "utf-8"));
      expect(nasaData.rows.length).toBeGreaterThan(10000);

      const meteoPath = path.join(snapshotsDir, `open_meteo_forecast__${farmId}.json`);
      expect(fs.existsSync(meteoPath), `Meteo file for ${farmId} must exist`).toBe(true);
      const meteoData = JSON.parse(fs.readFileSync(meteoPath, "utf-8"));
      expect(meteoData.rows.length).toBe(16);
    }
  });

  it("fail-loud sanity check: a fake year totalling 29,000 mm must throw", () => {
    // Generate a complete leap year (366 days in 2020) totalling 29,000 mm (~79.2 mm/day)
    const fakeRows: Array<{ date: string; rain_mm: number | null }> = [];
    const dailyRain = 29000 / 366;
    let d = new Date("2020-01-01T00:00:00Z");
    for (let i = 0; i < 366; i++) {
      fakeRows.push({
        date: d.toISOString().slice(0, 10),
        rain_mm: dailyRain,
      });
      d.setUTCDate(d.getUTCDate() + 1);
    }

    expect(() => validateNasaYearlyRainfall("farm_test", fakeRows)).toThrow(
      /Sanity check failed for farm farm_test in year 2020: total PRECTOTCORR was 29000\.0 mm, outside allowable range \[600, 2550\] mm/
    );
  });

  it("fixture day with a spike of 724.3 mm becomes null and is recorded in provenance", async () => {
    // 1. Verify single-day spike logic
    const nulled: NulledSpikeDay[] = [];
    const val = parseDailyRainMm("2022-07-15", 724.3, nulled);
    expect(val).toBeNull();
    expect(nulled).toEqual([{ date: "2022-07-15", originalRainMm: 724.3 }]);

    // 2. Fixture test through SnapshotGateway
    const snapshotsDir = path.resolve(process.cwd(), "data", "snapshots");
    const testFileName = "rain_daily__fixture_spike_test.json";
    const testFilePath = path.join(snapshotsDir, testFileName);

    const testNulled: NulledSpikeDay[] = [];
    const rows = [
      {
        farm_id: "farm_test",
        date: "2022-07-14",
        rain_mm: parseDailyRainMm("2022-07-14", 18.5, testNulled),
      },
      {
        farm_id: "farm_test",
        date: "2022-07-15",
        rain_mm: parseDailyRainMm("2022-07-15", 724.3, testNulled),
      },
    ];

    const provenance = `https://power.larc.nasa.gov/api/temporal/daily/point | Nulled spikes (> ${MAX_DAILY_RAIN_MM} mm): ${testNulled
      .map((d) => `${d.date}: ${d.originalRainMm} mm`)
      .join(", ")}`;

    fs.writeFileSync(
      testFilePath,
      JSON.stringify(
        {
          source: "snapshot",
          sourceUrl: "https://power.larc.nasa.gov/api/temporal/daily/point",
          provenance,
          fetchedAt: new Date().toISOString(),
          params: { file: testFileName },
          nulledDays: testNulled,
          rows,
        },
        null,
        2
      ),
      "utf-8"
    );

    try {
      const gateway = new SnapshotGateway(snapshotsDir);
      const res = await gateway.query("SELECT * FROM weather", { file: testFileName });
      const spikeRow = res.rows.find((r: any) => r.date === "2022-07-15") as any;
      expect(spikeRow).toBeDefined();
      expect(spikeRow.rain_mm).toBeNull();
      expect(res.provenance).toContain("2022-07-15");
      expect(res.provenance).toContain("724.3");
    } finally {
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    }
  });

  it("verifies no snapshot file marked 'snapshot' is missing a real sourceUrl or sourceUrls", () => {
    const snapshotsDir = path.resolve(process.cwd(), "data", "snapshots");
    const files = fs.readdirSync(snapshotsDir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      const fullPath = path.join(snapshotsDir, file);
      const parsed = JSON.parse(fs.readFileSync(fullPath, "utf-8"));

      if (parsed.source === "snapshot") {
        const urls: string[] = Array.isArray(parsed.sourceUrls)
          ? parsed.sourceUrls
          : (typeof parsed.sourceUrl === "string" ? [parsed.sourceUrl] : []);

        expect(
          urls.length,
          `File ${file} marked as snapshot must have sourceUrl or sourceUrls`
        ).toBeGreaterThan(0);

        for (const url of urls) {
          expect(
            url.startsWith("http://") || url.startsWith("https://"),
            `File ${file} url must start with http:// or https://: received "${url}"`
          ).toBe(true);
        }
      } else if (parsed.source === "mock" || parsed.source === "assumption") {
        expect(
          typeof parsed.note === "string" && parsed.note.length > 0,
          `File ${file} marked as mock must have an explanatory note`
        ).toBe(true);
      }
    }
  });
});

describe("SnapshotGateway", () => {
  it("returns rows with source 'snapshot' and real source URL as provenance for real fetched files", async () => {
    const gateway = new SnapshotGateway();

    const calResult = await gateway.query("SELECT * FROM crop_calendar WHERE crop = 'maize'");
    expect(calResult.source).toBe("snapshot");
    expect(calResult.provenance).toContain("raw.githubusercontent.com");
    expect(calResult.rows.length).toBeGreaterThan(0);

    const rainResult = await gateway.query("SELECT * FROM v_rain_daily WHERE farm_id = 'farm_bisi_ogbomoso'");
    expect(rainResult.source).toBe("snapshot");
    expect(rainResult.provenance).toContain("power.larc.nasa.gov");
    expect(rainResult.provenance).toContain("open-meteo.com");
    expect(rainResult.rows.length).toBeGreaterThan(0);

    const forecastResult = await gateway.query("SELECT * FROM open_meteo_forecast WHERE farm_id = 'farm_bisi_ogbomoso'");
    expect(forecastResult.source).toBe("snapshot");
    expect(forecastResult.provenance).toContain("https://historical-forecast-api.open-meteo.com");
    expect(forecastResult.rows.length).toBe(16);

    const nasaResult = await gateway.query("SELECT * FROM nasa_power_daily WHERE farm_id = 'farm_bisi_ogbomoso'");
    expect(nasaResult.source).toBe("snapshot");
    expect(nasaResult.provenance).toContain("https://power.larc.nasa.gov");
    expect(nasaResult.rows.length).toBeGreaterThan(10000);
  });

  it("returns source 'mock' with explanatory note as provenance for mock or placeholder files", async () => {
    const gateway = new SnapshotGateway();

    const priceResult = await gateway.query("SELECT * FROM v_maize_price_monthly WHERE state = 'Oyo'");
    expect(priceResult.source).toBe("mock");
    expect(priceResult.provenance).toContain("Placeholder monthly seasonal price index");
    expect(priceResult.rows.length).toBeGreaterThan(0);
    expect(priceResult.rows[0]).toHaveProperty("price_ngn_per_kg");

    const dbResult = await gateway.query("SHOW DATABASES");
    expect(dbResult.source).toBe("mock");
    expect(dbResult.provenance).toContain("Mock SHOW DATABASES");

    const selResult = await gateway.query("SELECT 1");
    expect(selResult.source).toBe("mock");
    expect(selResult.provenance).toContain("Mock SELECT 1");
  });

  it("supports explicit file parameter in params", async () => {
    const gateway = new SnapshotGateway();
    const result = await gateway.query("SELECT 1", { file: "crop_calendar__maize_ng.json" });
    expect(result.source).toBe("snapshot");
    expect(result.provenance).toContain("raw.githubusercontent.com");
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("throws error when requested snapshot file does not exist", async () => {
    const gateway = new SnapshotGateway();
    await expect(gateway.query("SELECT 1", { file: "non_existent_file.json" })).rejects.toThrow(
      "Snapshot file not found"
    );
  });
});

describe("getGateway", () => {
  it("falls back to SnapshotGateway when env is empty", () => {
    const gateway = getGateway({});
    expect(gateway).toBeInstanceOf(SnapshotGateway);
    expect(gateway.mode).toBe("snapshot");
  });

  it("falls back to SnapshotGateway when any required Zetaris env var is missing", () => {
    expect(
      getGateway({ ZETARIS_REST_URL: "https://example.com", ZETARIS_API_KEY: "key" })
    ).toBeInstanceOf(SnapshotGateway);

    expect(
      getGateway({ ZETARIS_API_KEY: "key", ZETARIS_ORG_ID: "org" })
    ).toBeInstanceOf(SnapshotGateway);
  });

  it("falls back to SnapshotGateway when DATA_MODE is snapshot even if Zetaris vars exist", () => {
    const gateway = getGateway({
      ZETARIS_REST_URL: "https://example.com",
      ZETARIS_API_KEY: "key",
      ZETARIS_ORG_ID: "org",
      DATA_MODE: "snapshot",
    });
    expect(gateway).toBeInstanceOf(SnapshotGateway);
  });

  it("returns ZetarisGateway when all Zetaris env vars are set", () => {
    const gateway = getGateway({
      ZETARIS_REST_URL: "https://example.com/api/v1.0",
      ZETARIS_API_KEY: "test-api-key",
      ZETARIS_ORG_ID: "test-org-id",
    });
    expect(gateway).toBeInstanceOf(ZetarisGateway);
    expect(gateway.mode).toBe("live");
  });
});

describe("isReadOnlySql and read-only guard", () => {
  it("accepts SELECT, SHOW, and DESCRIBE queries", () => {
    expect(isReadOnlySql("SELECT 1")).toBe(true);
    expect(isReadOnlySql("select * from v_rain_daily")).toBe(true);
    expect(isReadOnlySql("SHOW DATABASES")).toBe(true);
    expect(isReadOnlySql("describe table crop_calendar")).toBe(true);
    expect(isReadOnlySql("  -- comment\nSELECT * FROM tbl")).toBe(true);
    expect(isReadOnlySql("/* block comment */ SHOW TABLES")).toBe(true);
  });

  it("rejects INSERT, DROP, UPDATE, and DELETE queries", () => {
    expect(isReadOnlySql("INSERT INTO tbl VALUES (1)")).toBe(false);
    expect(isReadOnlySql("DROP TABLE tbl")).toBe(false);
    expect(isReadOnlySql("UPDATE tbl SET a = 1")).toBe(false);
    expect(isReadOnlySql("DELETE FROM tbl WHERE id = 1")).toBe(false);
    expect(isReadOnlySql("ALTER TABLE tbl ADD COLUMN x INT")).toBe(false);
  });

  it("ZetarisGateway throws ZetarisError when rejecting INSERT or DROP", async () => {
    const gateway = new ZetarisGateway({
      restUrl: "https://api.example.com",
      apiKey: "test-key",
      orgId: "test-org",
    });

    await expect(gateway.query("INSERT INTO maize_data VALUES (1)")).rejects.toThrow(ZetarisError);
    await expect(gateway.query("INSERT INTO maize_data VALUES (1)")).rejects.toThrow(
      "Read-only guard rejected SQL"
    );

    await expect(gateway.query("DROP TABLE maize_data")).rejects.toThrow(ZetarisError);
    await expect(gateway.query("DROP TABLE maize_data")).rejects.toThrow(
      "Read-only guard rejected SQL"
    );
  });
});

describe("ZetarisGateway HTTP and retry lifecycle", () => {
  it("sends required headers and body to /sql-editor/sqls/run", async () => {
    let recordedUrl = "";
    let recordedHeaders: Record<string, string> = {};
    let recordedBody: any = null;

    const mockFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      recordedUrl = url.toString();
      recordedHeaders = (init?.headers as Record<string, string>) || {};
      recordedBody = JSON.parse(init?.body as string);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          headers: ["ok"],
          data: [["1"]],
        }),
      } as unknown as Response;
    });

    const gateway = new ZetarisGateway({
      restUrl: "https://api.example.com/api/v1.0",
      apiKey: "secret-key",
      orgId: "org-456",
      queryLimit: 100,
      fetchFn: mockFetch,
    });

    const result = await gateway.query("SELECT 1 AS ok");
    expect(result.source).toBe("live");
    expect(result.rows).toEqual([{ ok: "1" }]);

    expect(recordedUrl).toBe("https://api.example.com/api/v1.0/sql-editor/sqls/run");
    expect(recordedHeaders["Authorization"]).toBe("Bearer secret-key");
    expect(recordedHeaders["X-Org-ID"]).toBe("org-456");
    expect(recordedHeaders["X-Request-ID"]).toBeDefined();
    expect(recordedHeaders["Content-Type"]).toBe("application/json");

    expect(recordedBody.sql).toBe("SELECT 1 AS ok");
    expect(recordedBody.source).toBe("SqlEditor");
    expect(recordedBody.limit).toBe(100);
    expect(recordedBody.queryId).toBeDefined();
  });

  it("handles array of arrays mapped with headers or columnNames to objects", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          headers: ["state", "price_ngn"],
          data: [
            ["Oyo", 42000],
            ["Ogun", 45000],
          ],
        }),
      } as unknown as Response;
    });

    const gateway = new ZetarisGateway({
      restUrl: "https://api.example.com/api/v1.0",
      apiKey: "k",
      orgId: "o",
      fetchFn: mockFetch,
    });

    const result = await gateway.query<{ state: string; price_ngn: number }>("SELECT state, price_ngn FROM prices");
    expect(result.rows).toEqual([
      { state: "Oyo", price_ngn: 42000 },
      { state: "Ogun", price_ngn: 45000 },
    ]);
  });

  it("handles array of objects directly", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: "farm_1", lga: "Ogbomoso" }],
        }),
      } as unknown as Response;
    });

    const gateway = new ZetarisGateway({
      restUrl: "https://api.example.com/api/v1.0",
      apiKey: "k",
      orgId: "o",
      fetchFn: mockFetch,
    });

    const result = await gateway.query("SELECT * FROM farms");
    expect(result.rows).toEqual([{ id: "farm_1", lga: "Ogbomoso" }]);
  });

  it("retries on 5xx errors up to 2 times and succeeds if error resolves", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      const urlStr = url.toString();
      expect(urlStr).toContain("/sql-editor/sqls/run");
      callCount++;
      if (callCount <= 2) {
        return {
          ok: false,
          status: 503,
          text: async () => "Service temporarily unavailable",
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ resolved: true }],
        }),
      } as unknown as Response;
    });

    const gateway = new ZetarisGateway({
      restUrl: "https://api.example.com/api/v1.0",
      apiKey: "secret-key",
      orgId: "org-456",
      fetchFn: mockFetch,
    });

    const result = await gateway.query("SELECT * FROM v_rain_daily");
    expect(callCount).toBe(3); // 2 retries + 1 initial
    expect(result.rows).toEqual([{ resolved: true }]);
  });

  it("does not retry on 4xx errors and throws typed ZetarisError with status and requestId", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        ok: false,
        status: 401,
        text: async () => "Unauthorized API key",
      } as unknown as Response;
    });

    const gateway = new ZetarisGateway({
      restUrl: "https://api.example.com/api/v1.0",
      apiKey: "bad-key",
      orgId: "org-456",
      fetchFn: mockFetch,
    });

    let thrownError: unknown;
    try {
      await gateway.query("SELECT 1");
    } catch (err) {
      thrownError = err;
    }

    expect(callCount).toBe(1); // 4xx must fail immediately without retries
    expect(thrownError).toBeInstanceOf(ZetarisError);
    const zErr = thrownError as ZetarisError;
    expect(zErr.status).toBe(401);
    expect(zErr.requestId).toBeDefined();
    expect(zErr.message).toContain("401");
  });

  it("supports configurable timeout defaulting to 180s", () => {
    const defaultGateway = new ZetarisGateway({
      restUrl: "https://api.example.com",
      apiKey: "k",
      orgId: "o",
    });
    expect((defaultGateway as any).timeoutMs).toBe(180_000);

    const customGateway = new ZetarisGateway({
      restUrl: "https://api.example.com",
      apiKey: "k",
      orgId: "o",
      timeoutMs: 60_000,
    });
    expect((customGateway as any).timeoutMs).toBe(60_000);
  });
});
