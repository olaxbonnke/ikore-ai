import { ZetarisError } from "../core/errors.ts";
import type { DataGateway, QueryResult } from "./gateway.ts";

/** Live Zetaris REST client (DESIGN.md section 7.1). */
export class ZetarisGateway implements DataGateway {
  readonly mode = "live" as const;

  async query(_name: string, _params: Record<string, string | number>): Promise<QueryResult> {
    throw new ZetarisError(_name, "ZetarisGateway not implemented yet");
  }
}
