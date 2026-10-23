import dotenv from "dotenv";
import { SnapshotGateway } from "./snapshot.ts";
import { ZetarisGateway } from "./zetaris.ts";

dotenv.config();

export type GatewaySource = "live" | "snapshot" | "mock";

export interface GatewayResult<T = Record<string, unknown>> {
  rows: T[];
  source: GatewaySource;
  fetchedAt: string;
  provenance: string;
}

export interface DataGateway {
  readonly mode?: "live" | "snapshot" | "mock";
  query<T = Record<string, unknown>>(
    sql: string,
    params?: Record<string, unknown>
  ): Promise<GatewayResult<T>>;
}

export function getGateway(env: Record<string, string | undefined> = process.env): DataGateway {
  const restUrl = env.ZETARIS_REST_URL?.trim();
  const apiKey = env.ZETARIS_API_KEY?.trim();
  const orgId = env.ZETARIS_ORG_ID?.trim();
  const dataMode = env.DATA_MODE?.trim();

  const isZetarisConfigured = Boolean(restUrl && apiKey && orgId) && dataMode !== "snapshot";

  if (isZetarisConfigured) {
    console.log("[DataGateway] Active gateway: ZetarisGateway (live)");
    return new ZetarisGateway({
      restUrl: restUrl!,
      apiKey: apiKey!,
      orgId: orgId!,
      queryLimit: Number(env.ZETARIS_QUERY_LIMIT) || 50000,
      timeoutMs: Number(env.ZETARIS_TIMEOUT_MS) || undefined,
    });
  }

  console.log("[DataGateway] Active gateway: SnapshotGateway (snapshot)");
  return new SnapshotGateway();
}
