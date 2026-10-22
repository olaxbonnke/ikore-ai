import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ZetarisError } from "../src/core/errors.ts";
import { getGateway } from "../src/data/gateway.ts";
import { SnapshotGateway } from "../src/data/snapshot.ts";
import { isReadOnlySql, ZetarisGateway } from "../src/data/zetaris.ts";

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
    const farmIds = ["farm_bisi_ogbomoso", "farm_musa_kaduna", "farm_ade_iseyin"];

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

  it("verifies no snapshot file marked 'snapshot' is missing a real sourceUrl", () => {
    const snapshotsDir = path.resolve(process.cwd(), "data", "snapshots");
    const files = fs.readdirSync(snapshotsDir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      const fullPath = path.join(snapshotsDir, file);
      const parsed = JSON.parse(fs.readFileSync(fullPath, "utf-8"));

      if (parsed.source === "snapshot") {
        expect(
          typeof parsed.sourceUrl === "string" && parsed.sourceUrl.length > 0,
          `File ${file} marked as snapshot must have sourceUrl`
        ).toBe(true);
        expect(
          parsed.sourceUrl.startsWith("http://") || parsed.sourceUrl.startsWith("https://"),
          `File ${file} sourceUrl must start with http:// or https://: received "${parsed.sourceUrl}"`
        ).toBe(true);
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
    expect(rainResult.provenance).toContain("https://historical-forecast-api.open-meteo.com");
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
  it("sends required headers including Authorization, X-Org-ID, and fresh X-Request-ID", async () => {
    const recordedHeaders: Record<string, string>[] = [];
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers as Record<string, string>) || {};
      recordedHeaders.push(headers);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          queryId: "qid-1",
          data: [{ col: 1 }],
          hasMore: false,
        }),
      } as unknown as Response;
    });

    const gateway = new ZetarisGateway({
      restUrl: "https://api.example.com/api/v1.0",
      apiKey: "secret-key",
      orgId: "org-456",
      fetchFn: mockFetch,
    });

    const result = await gateway.query("SELECT 1 AS ok");
    expect(result.source).toBe("live");
    expect(result.rows).toEqual([{ col: 1 }]);

    expect(recordedHeaders.length).toBeGreaterThanOrEqual(1);
    const startHeaders = recordedHeaders[0];
    expect(startHeaders["Authorization"]).toBe("Bearer secret-key");
    expect(startHeaders["X-Org-ID"]).toBe("org-456");
    expect(startHeaders["X-Request-ID"]).toBeDefined();
    expect(startHeaders["X-Request-ID"].length).toBeGreaterThan(10);
  });

  it("retries on 5xx errors up to 2 times and succeeds if error resolves", async () => {
    let startCalls = 0;
    let closeCalls = 0;
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      const urlStr = url.toString();
      if (urlStr.includes("/query/sql/start")) {
        startCalls++;
        if (startCalls <= 2) {
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
            queryId: "qid-retry",
            data: [{ resolved: true }],
            hasMore: false,
          }),
        } as unknown as Response;
      }
      if (urlStr.includes("/query/sql/close")) {
        closeCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    });

    const gateway = new ZetarisGateway({
      restUrl: "https://api.example.com/api/v1.0",
      apiKey: "secret-key",
      orgId: "org-456",
      fetchFn: mockFetch,
    });

    const result = await gateway.query("SELECT * FROM v_rain_daily");
    expect(startCalls).toBe(3); // 2 retries + 1 initial
    expect(closeCalls).toBe(1); // Closed via finally block
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

  it("closes query in finally block when queryId was issued", async () => {
    const endpointsCalled: string[] = [];
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      endpointsCalled.push(url.toString());
      if (url.toString().includes("/query/sql/start")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            queryId: "qid-cleanup-test",
            data: [{ a: 1 }],
            hasMore: false,
          }),
        } as unknown as Response;
      }
      // close endpoint
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as unknown as Response;
    });

    const gateway = new ZetarisGateway({
      restUrl: "https://api.example.com/api/v1.0",
      apiKey: "key",
      orgId: "org",
      fetchFn: mockFetch,
    });

    await gateway.query("SELECT 1");
    expect(endpointsCalled.some((url) => url.includes("/query/sql/start"))).toBe(true);
    expect(endpointsCalled.some((url) => url.includes("/query/sql/close"))).toBe(true);
  });
});
