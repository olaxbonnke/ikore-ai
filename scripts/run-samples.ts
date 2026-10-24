import fs from "node:fs";
import path from "node:path";
import { initEnv } from "../src/core/env.ts";
import { POST } from "../src/app/api/run/route.ts";

async function runSample(filename: string) {
  const reqPath = path.resolve(process.cwd(), "samples", filename);
  const body = JSON.parse(fs.readFileSync(reqPath, "utf-8"));

  let jsonResult: any;
  const baseUrl = process.env.API_BASE_URL;

  if (baseUrl) {
    try {
      const res = await fetch(`${baseUrl}/api/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      jsonResult = await res.json();
    } catch {
      // Fall back to direct route invocation if HTTP server is not reachable
    }
  }

  if (!jsonResult) {
    const req = new Request("http://localhost:3000/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await POST(req);
    jsonResult = await res.json();
  }

  const outName = filename.replace("-request.json", "-response.json");
  const outPath = path.resolve(process.cwd(), "samples", outName);
  fs.writeFileSync(outPath, JSON.stringify(jsonResult, null, 2), "utf-8");

  console.log(
    `[${filename}] mode=${jsonResult.mode} intent=${jsonResult.intent} verdict=${jsonResult.decision?.chosen ?? "n/a"} model=${jsonResult.llm?.responded_model} latency=${jsonResult.llm?.latency_ms}ms`
  );
  return jsonResult;
}

async function main() {
  initEnv();
  if (process.env.SAMPLE_MODE === undefined) {
    process.env.SAMPLE_MODE = "true";
  }

  console.log(`Running sample requests (SAMPLE_MODE=${process.env.SAMPLE_MODE})...`);
  await runSample("sample-1-request.json");
  await runSample("sample-2-request.json");
  await runSample("sample-3-request.json");
  console.log("All sample responses written to samples/*-response.json");
}

main().catch((err) => {
  console.error("Error running samples:", err);
  process.exit(1);
});
