import crypto from "node:crypto";
import { ZetarisError } from "../core/errors.ts";
import type { DataGateway, GatewayResult } from "./gateway.ts";

export interface ZetarisGatewayOptions {
  restUrl: string;
  apiKey: string;
  orgId: string;
  queryLimit?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export function isReadOnlySql(sql: string): boolean {
  const cleanSql = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .trim();
  return /^(select|show|describe)\b/i.test(cleanSql);
}

export class ZetarisGateway implements DataGateway {
  readonly mode = "live" as const;
  private readonly restUrl: string;
  private readonly apiKey: string;
  private readonly orgId: string;
  private readonly queryLimit: number;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: ZetarisGatewayOptions) {
    this.restUrl = options.restUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.orgId = options.orgId;
    this.queryLimit = options.queryLimit ?? 5000;
    const envTimeout = process.env.ZETARIS_TIMEOUT_MS ? Number(process.env.ZETARIS_TIMEOUT_MS) : undefined;
    this.timeoutMs =
      options.timeoutMs ?? (Number.isFinite(envTimeout) && envTimeout! > 0 ? envTimeout! : 180_000);
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: Record<string, unknown>
  ): Promise<GatewayResult<T>> {
    if (!isReadOnlySql(sql)) {
      throw new ZetarisError({
        message: `Read-only guard rejected SQL: only SELECT, SHOW, and DESCRIBE are allowed. Received: "${sql.slice(0, 60)}"`,
      });
    }

    try {
      return await this.executeRun<T>(sql, params);
    } catch (err: unknown) {
      if (
        err instanceof ZetarisError &&
        err.status === 400 &&
        /SHOW NAMESPACES \/ SHOW TABLES are disabled/i.test(err.message) &&
        /^\s*show\s+databases\s*;?\s*$/i.test(sql)
      ) {
        return await this.executeRun<T>("SHOW UC NAMESPACES IN spark_catalog", params);
      }
      throw err;
    }
  }

  private async executeRun<T>(
    sql: string,
    params?: Record<string, unknown>
  ): Promise<GatewayResult<T>> {
    const queryId = crypto.randomUUID();
    const limit = params?.limit ? Number(params.limit) : this.queryLimit;
    const body = {
      queryId,
      sql,
      source: "SqlEditor",
      limit,
    };

    const response = await this.postJson<Record<string, unknown>>("/sql-editor/sqls/run", body);
    const rows = this.extractRows<T>(response);

    return {
      rows: rows.slice(0, limit),
      source: "live",
      fetchedAt: new Date().toISOString(),
      provenance: "Zetaris (local)",
    };
  }

  private extractRows<T>(json: Record<string, unknown>): T[] {
    const rawData = json.data ?? json.rows ?? json.result;

    if (!Array.isArray(rawData)) {
      const topLevelKeys = Object.keys(json);
      console.error(
        "[ZetarisGateway] Response data is not an array. Top-level keys:",
        topLevelKeys,
        "Data type:",
        typeof rawData
      );
      throw new ZetarisError({
        message: `Zetaris response data is not an array. Keys: [${topLevelKeys.join(", ")}]`,
      });
    }

    if (rawData.length === 0) {
      return [];
    }

    const firstRow = rawData[0];

    // Case 1: Array of objects
    if (firstRow !== null && typeof firstRow === "object" && !Array.isArray(firstRow)) {
      return rawData as T[];
    }

    // Case 2: Array of arrays -> map column names to objects
    if (Array.isArray(firstRow)) {
      const colNames = this.findColumnNames(json);
      if (colNames && colNames.length > 0) {
        return rawData.map((rowArr: unknown[]) => {
          const obj: Record<string, unknown> = {};
          colNames.forEach((colName, idx) => {
            obj[colName] = rowArr[idx];
          });
          return obj as T;
        });
      }

      // Cannot find column names
      const topLevelKeys = Object.keys(json);
      const firstRowShape = `array[${firstRow.length}] (${firstRow.map((v) => typeof v).join(", ")})`;
      console.error(
        "[ZetarisGateway] Cannot determine column names for row array. Top-level keys:",
        topLevelKeys,
        "First row shape:",
        firstRowShape
      );
      throw new ZetarisError({
        message: `Cannot determine column names from Zetaris response. Keys: [${topLevelKeys.join(", ")}], first row shape: ${firstRowShape}`,
      });
    }

    // Neither object nor array
    const topLevelKeys = Object.keys(json);
    const firstRowShape = typeof firstRow;
    console.error(
      "[ZetarisGateway] Unexpected row item shape. Top-level keys:",
      topLevelKeys,
      "First row shape:",
      firstRowShape
    );
    throw new ZetarisError({
      message: `Unexpected row item shape in Zetaris response. Keys: [${topLevelKeys.join(", ")}], shape: ${firstRowShape}`,
    });
  }

  private findColumnNames(json: Record<string, unknown>): string[] | null {
    if (Array.isArray(json.headers) && json.headers.every((h) => typeof h === "string")) {
      return json.headers as string[];
    }
    if (Array.isArray(json.columns)) {
      return json.columns.map((c) => (typeof c === "string" ? c : (c as any)?.name ?? String(c)));
    }
    if (Array.isArray(json.schema)) {
      return json.schema.map((c) => (typeof c === "string" ? c : (c as any)?.name ?? String(c)));
    }
    if (Array.isArray(json.columnNames) && json.columnNames.every((h) => typeof h === "string")) {
      return json.columnNames as string[];
    }
    if (Array.isArray(json.fields)) {
      return json.fields.map((c) => (typeof c === "string" ? c : (c as any)?.name ?? String(c)));
    }
    return null;
  }

  private async postJson<R>(endpoint: string, body: Record<string, unknown>): Promise<R> {
    const url = `${this.restUrl}${endpoint}`;
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const requestId = crypto.randomUUID();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const requestPayload =
        typeof body === "object" && body !== null && "queryId" in body
          ? { ...body, queryId: crypto.randomUUID() }
          : body;

      try {
        const response = await this.fetchFn(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "X-Org-ID": this.orgId,
            "X-Request-ID": requestId,
          },
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
        });

        if (response.ok) {
          return (await response.json()) as R;
        }

        const is5xx = response.status >= 500 && response.status < 600;
        if (is5xx && attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt)));
          continue;
        }

        const errorBody = await response.text().catch(() => "");
        throw new ZetarisError({
          status: response.status,
          requestId,
          message: `Zetaris API request failed (${response.status}): ${errorBody}`,
        });
      } catch (err) {
        if (err instanceof ZetarisError) {
          throw err;
        }
        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt)));
          continue;
        }
        throw new ZetarisError({
          requestId,
          message: `Network error connecting to Zetaris at ${url}: ${(err as Error).message}`,
          cause: err,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw new ZetarisError({ message: "Zetaris request failed after maximum retry attempts" });
  }
}
