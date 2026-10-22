/** Result row from a named Zetaris query. */
export interface QueryResult {
  queryName: string;
  sql: string;
  executedAt: string;
  rowCount: number;
  source: string;
  rows: Record<string, unknown>[];
}

/** All runtime agronomic data flows through this interface (DESIGN.md section 7). */
export interface DataGateway {
  /** Run a named, parameterised query from queries.ts. */
  query(name: string, params: Record<string, string | number>): Promise<QueryResult>;

  readonly mode: "live" | "snapshot";
}
