import type { DataGateway, QueryResult } from "./gateway.ts";

/** Offline replay of data/snapshots (DESIGN.md section 7.4). */
export class SnapshotGateway implements DataGateway {
  readonly mode = "snapshot" as const;

  async query(_name: string, _params: Record<string, string | number>): Promise<QueryResult> {
    throw new Error("SnapshotGateway not implemented yet");
  }
}
