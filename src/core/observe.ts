import type { DataGateway } from "../data/gateway.ts";
import type { Farm, Observation } from "./types.ts";

/** Builds Observation from Zetaris via DataGateway (DESIGN.md step 3). */
export async function observe(
  _gateway: DataGateway,
  _farm: Farm,
  _asOf: string,
): Promise<Observation> {
  throw new Error("observe() not implemented yet");
}
