import dotenv from "dotenv";
import { ZetarisGateway } from "../src/data/zetaris.ts";

dotenv.config();

async function verify(): Promise<void> {
  const restUrl = process.env.ZETARIS_REST_URL?.trim();
  const apiKey = process.env.ZETARIS_API_KEY?.trim();
  const orgId = process.env.ZETARIS_ORG_ID?.trim();

  if (!restUrl || !apiKey || !orgId) {
    console.log("Zetaris not configured - using SnapshotGateway");
    process.exit(0);
  }

  try {
    const gateway = new ZetarisGateway({
      restUrl,
      apiKey,
      orgId,
      queryLimit: Number(process.env.ZETARIS_QUERY_LIMIT) || 5000,
    });

    const select1 = await gateway.query("SELECT 1 AS ok");
    console.log(`SELECT 1 rows: ${select1.rows.length}`);

    const dbs = await gateway.query("SHOW DATABASES");
    console.log(`SHOW DATABASES rows: ${dbs.rows.length}`);

    process.exit(0);
  } catch (err) {
    console.error("Zetaris verification error:", (err as Error).message);
    process.exit(1);
  }
}

void verify();
