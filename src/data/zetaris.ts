import crypto from "node:crypto";
import { ZetarisError } from "../core/errors.ts";
import type { DataGateway, GatewayResult } from "./gateway.ts";

export interface ZetarisGatewayOptions {
  restUrl: string;
  apiKey: string;
  orgId: string;
  queryLimit?: number;
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
  private readonly fetchFn: typeof fetch;

  constructor(options: ZetarisGatewayOptions) {
    this.restUrl = options.restUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.orgId = options.orgId;
    this.queryLimit = options.queryLimit ?? 5000;
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

    let queryId: string | undefined;
    const rows: T[] = [];

    try {
      const startResult = await this.postJson<{
        queryId?: string;
        id?: string;
        rows?: T[];
        data?: T[];
        result?: T[];
        hasMore?: boolean;
      }>("/query/sql/start", {
        sql,
        params,
        limit: this.queryLimit,
      });

      queryId = startResult.queryId ?? startResult.id;
      const initialRows = this.extractRows<T>(startResult);
      rows.push(...initialRows);

      let hasMore = Boolean(startResult.hasMore);
      while (hasMore && queryId && rows.length < this.queryLimit) {
        const nextBatch = await this.postJson<{
          rows?: T[];
          data?: T[];
          result?: T[];
          hasMore?: boolean;
        }>("/query/sql/next", {
          queryId,
          limit: Math.min(1000, this.queryLimit - rows.length),
        });

        const nextRows = this.extractRows<T>(nextBatch);
        if (nextRows.length === 0) break;
        rows.push(...nextRows);
        hasMore = Boolean(nextBatch.hasMore);
      }

      return {
        rows: rows.slice(0, this.queryLimit),
        source: "live",
        fetchedAt: new Date().toISOString(),
        provenance: `Zetaris Cloud (${this.restUrl})`,
      };
    } finally {
      if (queryId) {
        await this.closeQuery(queryId);
      }
    }
  }

  private extractRows<T>(body: { rows?: T[]; data?: T[]; result?: T[] }): T[] {
    if (Array.isArray(body.rows)) return body.rows;
    if (Array.isArray(body.data)) return body.data;
    if (Array.isArray(body.result)) return body.result;
    return [];
  }

  private async closeQuery(queryId: string): Promise<void> {
    try {
      await this.postJson("/query/sql/close", { queryId });
    } catch {
      // Best-effort cleanup, do not mask primary query errors
    }
  }

  private async postJson<R>(endpoint: string, body: Record<string, unknown>): Promise<R> {
    const url = `${this.restUrl}${endpoint}`;
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const requestId = crypto.randomUUID();

      try {
        const response = await this.fetchFn(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "X-Org-ID": this.orgId,
            "X-Request-ID": requestId,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
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
      }
    }

    throw new ZetarisError({ message: "Zetaris request failed after maximum retry attempts" });
  }
}
