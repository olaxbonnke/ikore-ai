import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

export async function runZetarisSql(sql: string): Promise<Record<string, unknown>> {
  const restUrl = process.env.ZETARIS_REST_URL?.replace(/\/+$/, "");
  const apiKey = process.env.ZETARIS_API_KEY;
  const orgId = process.env.ZETARIS_ORG_ID;

  if (!restUrl || !apiKey || !orgId) {
    throw new Error("Missing ZETARIS_REST_URL, ZETARIS_API_KEY, or ZETARIS_ORG_ID in environment.");
  }

  const url = `${restUrl}/sql-editor/sqls/run`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Org-ID": orgId,
      "X-Request-ID": crypto.randomUUID(),
    },
    body: JSON.stringify({
      queryId: crypto.randomUUID(),
      sql,
      source: "SqlEditor",
      limit: 1000,
    }),
  });

  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Zetaris SQL failed (${res.status}): ${json.msg || JSON.stringify(json)}`);
  }
  return json;
}

export async function applySqlFiles(): Promise<void> {
  const sqlDir = path.resolve(process.cwd(), "zetaris", "sql");
  if (!fs.existsSync(sqlDir)) {
    console.log(`Directory ${sqlDir} does not exist.`);
    return;
  }

  const files = fs
    .readdirSync(sqlDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No .sql files found in zetaris/sql/.");
    return;
  }

  console.log(`Applying ${files.length} SQL script(s) to Zetaris in order...`);

  for (const file of files) {
    const filePath = path.join(sqlDir, file);
    console.log(`\n--- Applying ${file} ---`);
    const content = fs.readFileSync(filePath, "utf-8");

    // Substitute ${VAR} placeholders with environment variables
    const substituted = content.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => {
      const val = process.env[key];
      if (!val) {
        console.warn(`! Warning: Environment variable ${key} is not set for template in ${file}`);
        return "";
      }
      return val;
    });

    // Strip comments line by line, then split on semicolons
    const cleanedSql = substituted
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    const statements = cleanedSql
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      // Avoid printing sensitive credential statements to console
      const isSensitive = stmt.includes("CREATE DATASOURCE") || stmt.includes("PASSWORD");
      if (isSensitive) {
        console.log(`Executing: ${stmt.slice(0, 30)}... [credentials omitted]`);
      } else {
        console.log(`Executing: ${stmt.slice(0, 60)}...`);
      }
      try {
        const result = await runZetarisSql(stmt);
        console.log(`✓ Succeeded (time: ${result.timeUsed ?? 0}ms)`);
      } catch (err: any) {
        console.warn(`! Note: ${err.message}`);
      }
    }
  }

  console.log("\nAll Zetaris SQL files processed.");
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("zetaris-apply.ts") || process.argv[1].endsWith("zetaris-apply.js"));

if (isDirectRun) {
  applySqlFiles().catch((err) => {
    console.error("zetaris:apply failed:", err);
    process.exit(1);
  });
}
