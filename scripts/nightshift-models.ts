import dotenv from "dotenv";
import { getNightshiftConfig } from "../src/core/nightshift.ts";

dotenv.config();

async function main(): Promise<void> {
  const config = getNightshiftConfig();
  const endpoint = `${config.baseUrl}/models`;

  console.log(`======================================================`);
  console.log(`Querying Meterless Nightshift Models`);
  console.log(`======================================================`);
  console.log(`Endpoint:        ${endpoint}`);
  console.log(`App ID:          ${config.app}`);
  console.log(`Scope:           ${config.scope || "(default)"}`);
  console.log(`Token:           ${config.token ? `${config.token.slice(0, 8)}...` : "(none provided)"}`);
  console.log(`Configured Model:${config.model ? ` ${config.model}` : " (unset / auto)"}`);
  console.log(`------------------------------------------------------`);

  const headers: Record<string, string> = {
    "meterless-app": config.app,
  };
  if (config.token) {
    headers["Authorization"] = `Bearer ${config.token}`;
  }
  if (config.scope) {
    headers["meterless-scope"] = config.scope;
  }

  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`HTTP ${res.status}: Failed to fetch models from Nightshift.`);
      if (errText) console.error(`Response body: ${errText.slice(0, 300)}`);
      process.exit(1);
    }

    const data = (await res.json()) as any;
    const rawList = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];

    console.log(`\nAvailable Models (${rawList.length}):`);
    for (const item of rawList) {
      const id = typeof item === "string" ? item : item.id;
      const isNemotron = (id || "").toLowerCase().includes("nemotron");
      console.log(`  - ${id}${isNemotron ? "  [NVIDIA Nemotron]" : ""}`);
    }

    console.log(`\nNext step: Copy the exact Nemotron model id above and set it in your .env:`);
    console.log(`METERLESS_MODEL=<exact-id>`);
    console.log(`======================================================\n`);
  } catch (err: any) {
    console.error(`\nFailed to connect to Meterless Nightshift at ${endpoint}:`, err.message);
    console.error(`Make sure Meterless Nightshift runtime is running and reachable.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
