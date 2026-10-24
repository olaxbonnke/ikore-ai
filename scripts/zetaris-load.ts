import fs from "node:fs";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import "../src/core/env.ts";
import { getGateway } from "../src/data/gateway.ts";
import { runZetarisSql } from "./zetaris-apply.ts";

const CODESPACE_NAME = "urban-rotary-phone-4r45wxx56g5cqvwq";

function runCodespace(cmd: string): string {
  try {
    return execSync(`gh codespace ssh -c ${CODESPACE_NAME} -- "${cmd}"`, {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (err: any) {
    throw new Error(`Failed to run command in codespace: ${err.message}`);
  }
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result.map((v) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/""/g, '"') : v));
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });
    return row;
  });
}

export function buildOkoPostgresSql(): string {
  const projectRoot = process.cwd();
  const sqlChunks: string[] = [];

  sqlChunks.push(`
BEGIN;

DROP TABLE IF EXISTS rain_daily CASCADE;
DROP TABLE IF EXISTS farm_records CASCADE;
DROP TABLE IF EXISTS prices CASCADE;
DROP TABLE IF EXISTS nimet_onset CASCADE;
DROP TABLE IF EXISTS farms CASCADE;

CREATE TABLE farms (
  id VARCHAR(64) PRIMARY KEY,
  owner_name VARCHAR(128) NOT NULL,
  lat NUMERIC(6, 4) NOT NULL,
  lon NUMERIC(6, 4) NOT NULL,
  state VARCHAR(64) NOT NULL,
  lga VARCHAR(64) NOT NULL,
  crop VARCHAR(64) NOT NULL,
  hectares NUMERIC(6, 2) NOT NULL,
  storage VARCHAR(64) NOT NULL,
  preferred_lang VARCHAR(16) NOT NULL,
  risk_aversion VARCHAR(32) NOT NULL,
  zone VARCHAR(64) NOT NULL
);

CREATE TABLE nimet_onset (
  state VARCHAR(64) NOT NULL,
  season INT NOT NULL,
  onset_start DATE NOT NULL,
  onset_end DATE NOT NULL,
  wait_after_onset_days_min INT NOT NULL,
  wait_after_onset_days_max INT NOT NULL,
  source_name VARCHAR(256) NOT NULL,
  source_url VARCHAR(512) NOT NULL,
  note TEXT,
  PRIMARY KEY (state, season)
);

CREATE TABLE rain_daily (
  farm_id VARCHAR(64) NOT NULL,
  date DATE NOT NULL,
  rain_mm NUMERIC(8, 3),
  PRIMARY KEY (farm_id, date)
);

CREATE TABLE farm_records (
  farm_id VARCHAR(64) NOT NULL,
  season_year INT NOT NULL,
  planting_date DATE,
  germination_ok VARCHAR(16),
  yield_bags INT,
  sale_month VARCHAR(32),
  sale_price_per_bag NUMERIC(10, 2),
  PRIMARY KEY (farm_id, season_year)
);

CREATE TABLE prices (
  state VARCHAR(64) NOT NULL,
  market VARCHAR(64) NOT NULL,
  commodity VARCHAR(64) NOT NULL,
  unit VARCHAR(16) NOT NULL,
  pricetype VARCHAR(32) NOT NULL,
  ym VARCHAR(16) NOT NULL,
  price_ngn_per_kg NUMERIC(10, 2) NOT NULL,
  PRIMARY KEY (state, market, ym, commodity, unit, pricetype)
);
`);

  // 1. Farms
  const farmsCsv = fs.readFileSync(path.join(projectRoot, "data", "farms_seed.csv"), "utf-8");
  const farms = parseCsv(farmsCsv);
  for (const f of farms) {
    sqlChunks.push(
      `INSERT INTO farms (id, owner_name, lat, lon, state, lga, crop, hectares, storage, preferred_lang, risk_aversion, zone) VALUES ('${f.id}', '${f.owner_name}', ${f.lat}, ${f.lon}, '${f.state}', '${f.lga}', '${f.crop}', ${f.hectares}, '${f.storage}', '${f.preferred_lang}', '${f.risk_aversion}', '${f.zone}');`
    );
  }

  // 2. Farm records
  const recordsCsv = fs.readFileSync(path.join(projectRoot, "data", "farm_records.csv"), "utf-8");
  const records = parseCsv(recordsCsv);
  for (const r of records) {
    sqlChunks.push(
      `INSERT INTO farm_records (farm_id, season_year, planting_date, germination_ok, yield_bags, sale_month, sale_price_per_bag) VALUES ('${r.farm_id}', ${r.season_year}, '${r.planting_date}', '${r.germination_ok}', ${r.yield_bags}, '${r.sale_month}', ${r.sale_price_per_bag});`
    );
  }

  // 3. Prices
  const pricePath = path.join(projectRoot, "data", "snapshots", "price_monthly__oyo.json");
  if (fs.existsSync(pricePath)) {
    const priceJson = JSON.parse(fs.readFileSync(pricePath, "utf-8"));
    const priceRows = priceJson.rows || [];
    for (const p of priceRows) {
      sqlChunks.push(
        `INSERT INTO prices (state, market, commodity, unit, pricetype, ym, price_ngn_per_kg) VALUES ('${p.state}', '${p.market}', '${p.commodity}', '${p.unit}', '${p.pricetype}', '${p.ym}', ${p.price_ngn_per_kg});`
      );
    }
  }

  // 4. Rain daily (batched 1000 rows per insert)
  const rainFiles = ["rain_daily__farm_bisi_ogbomoso.json", "rain_daily__farm_ade_iseyin.json"];
  for (const rf of rainFiles) {
    const rPath = path.join(projectRoot, "data", "snapshots", rf);
    if (!fs.existsSync(rPath)) continue;
    const rJson = JSON.parse(fs.readFileSync(rPath, "utf-8"));
    const rows = rJson.rows || [];

    const batchSize = 1000;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const valuesStr = batch
        .map((r: any) => {
          const rainVal =
            r.rain_mm !== null && r.rain_mm !== undefined && Number.isFinite(Number(r.rain_mm))
              ? Number(r.rain_mm).toFixed(3)
              : "NULL";
          return `('${r.farm_id}', '${r.date}', ${rainVal})`;
        })
        .join(",\n");

      sqlChunks.push(
        `INSERT INTO rain_daily (farm_id, date, rain_mm) VALUES \n${valuesStr}\nON CONFLICT (farm_id, date) DO NOTHING;`
      );
    }
  }

  // 5. NiMet onset
  const nimetPath = path.join(projectRoot, "data", "nimet_onset_2026.csv");
  if (fs.existsSync(nimetPath)) {
    const nimetCsv = fs.readFileSync(nimetPath, "utf-8");
    const nimetRows = parseCsv(nimetCsv);
    for (const n of nimetRows) {
      const srcName = (n.source_name || "").replace(/'/g, "''");
      const srcUrl = (n.source_url || "").replace(/'/g, "''");
      const note = (n.note || "").replace(/'/g, "''");
      sqlChunks.push(
        `INSERT INTO nimet_onset (state, season, onset_start, onset_end, wait_after_onset_days_min, wait_after_onset_days_max, source_name, source_url, note) VALUES ('${n.state}', ${n.season}, '${n.onset_start}', '${n.onset_end}', ${n.wait_after_onset_days_min}, ${n.wait_after_onset_days_max}, '${srcName}', '${srcUrl}', '${note}');`
      );
    }
  }

  sqlChunks.push(`\nCOMMIT;\n`);
  return sqlChunks.join("\n");
}

function streamSqlToPostgres(
  sqlContent: string,
  pgHost: string,
  pgUser: string,
  pgDb: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "gh",
      [
        "codespace",
        "ssh",
        "-c",
        CODESPACE_NAME,
        "--",
        `docker exec -i ${pgHost} psql -U ${pgUser} -d ${pgDb}`,
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`psql failed with exit code ${code}: ${stderr}`));
      }
    });

    child.stdin.write(sqlContent);
    child.stdin.end();
  });
}

async function main(): Promise<void> {
  console.log("=== Loading Oko Data into PostgreSQL & Registering in Zetaris ===");

  const pgHost = process.env.OKO_PG_HOST || "oko-postgres";
  const pgPort = process.env.OKO_PG_PORT || "5432";
  const pgDb = process.env.OKO_PG_DB || "oko";
  const pgUser = process.env.OKO_PG_USER || "oko";
  const pgPassword = process.env.OKO_PG_PASSWORD;

  if (!pgPassword) {
    throw new Error("Missing required environment variable OKO_PG_PASSWORD");
  }

  console.log(`Checking container '${pgHost}' on codespace ${CODESPACE_NAME}...`);
  const running = runCodespace(
    `docker ps -q --filter name=${pgHost} --filter status=running`
  ).trim();

  if (!running) {
    console.log(`Starting ${pgHost} container on network zetaris_default...`);
    runCodespace(
      `docker run -d --name ${pgHost} --network zetaris_default --restart unless-stopped -e POSTGRES_DB=${pgDb} -e POSTGRES_USER=${pgUser} -e POSTGRES_PASSWORD=${pgPassword} -v oko_postgres_data:/var/lib/postgresql/data postgres:16-alpine`
    );
  }

  console.log("Waiting for PostgreSQL to be ready...");
  runCodespace(
    `until docker exec ${pgHost} pg_isready -U ${pgUser} -d ${pgDb}; do sleep 1; done`
  );

  console.log("Generating SQL dump for Oko tables...");
  const sqlContent = buildOkoPostgresSql();
  console.log(`Generated ${(sqlContent.length / (1024 * 1024)).toFixed(2)} MB SQL script.`);

  console.log("Streaming SQL directly into PostgreSQL in Codespace...");
  await streamSqlToPostgres(sqlContent, pgHost, pgUser, pgDb);
  console.log("✓ PostgreSQL tables created and loaded successfully.");

  console.log("\nDropping existing Datasource oko_pg in Zetaris if present...");
  try {
    await runZetarisSql("DROP DATASOURCE oko_pg");
    console.log("✓ Dropped previous oko_pg datasource in Zetaris.");
  } catch (err: any) {
    console.log(`! Drop note: ${err.message}`);
  }

  console.log("Registering PostgreSQL Datasource in Zetaris from template...");
  const templatePath = path.resolve(process.cwd(), "zetaris", "sql", "01_register_oko.sql");
  const templateSql = fs.readFileSync(templatePath, "utf-8");

  const substitutedSql = templateSql.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => {
    const val = process.env[key];
    if (!val) {
      throw new Error(`Missing environment variable ${key} required by 01_register_oko.sql template`);
    }
    return val;
  });

  const cleanedSql = substitutedSql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  const regStatements = cleanedSql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of regStatements) {
    const isSensitive = stmt.includes("CREATE DATASOURCE") || stmt.includes("PASSWORD");
    if (isSensitive) {
      console.log(`Executing: ${stmt.slice(0, 30)}... [credentials omitted]`);
    } else {
      console.log(`Executing: ${stmt.slice(0, 60)}...`);
    }
    await runZetarisSql(stmt);
  }
  console.log("✓ Datasource registered and tables imported into Zetaris.");

  console.log("\n=== Verifying through ZetarisGateway ===");
  const gateway = getGateway();

  const farmsCount = await gateway.query("SELECT COUNT(*) AS c FROM oko_pg.farms");
  console.log(`oko_pg.farms count:`, farmsCount.rows[0]);

  const recordsCount = await gateway.query("SELECT COUNT(*) AS c FROM oko_pg.farm_records");
  console.log(`oko_pg.farm_records count:`, recordsCount.rows[0]);

  const pricesCount = await gateway.query("SELECT COUNT(*) AS c FROM oko_pg.prices");
  console.log(`oko_pg.prices count:`, pricesCount.rows[0]);

  const rainCount = await gateway.query("SELECT COUNT(*) AS c FROM oko_pg.rain_daily");
  console.log(`oko_pg.rain_daily count:`, rainCount.rows[0]);

  const nimetCount = await gateway.query("SELECT COUNT(*) AS c FROM oko_pg.nimet_onset");
  console.log(`oko_pg.nimet_onset count:`, nimetCount.rows[0]);

  console.log("\n--- Proof Query ---");
  const proofSql =
    "SELECT farm_id, year(date) y, sum(rain_mm) as annual_rain FROM oko_pg.rain_daily WHERE farm_id='farm_bisi_ogbomoso' GROUP BY 1,2 ORDER BY 2 LIMIT 5";
  console.log(`SQL: ${proofSql}`);
  const proofResult = await gateway.query(proofSql);
  console.log("Result (First 5 years):", proofResult.rows);

  const year2000Sql =
    "SELECT farm_id, year(date) y, sum(rain_mm) as annual_rain FROM oko_pg.rain_daily WHERE farm_id='farm_bisi_ogbomoso' AND year(date) = 2000 GROUP BY 1,2";
  const year2000Result = await gateway.query(year2000Sql);
  console.log("Year 2000 Result:", year2000Result.rows);

  console.log("\nProvenance:", proofResult.provenance);
  console.log("=== Load and Verification Completed Successfully! ===");
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith("zetaris-load.ts") || process.argv[1].endsWith("zetaris-load.js"));

if (isDirect) {
  main().catch((err) => {
    console.error("Zetaris load failed:", err);
    process.exit(1);
  });
}
