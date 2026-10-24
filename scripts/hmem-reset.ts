import fs from "node:fs";
import path from "node:path";
import { clearHMEMCache } from "../src/memory/hmem.ts";

export function resetHMEM(): { success: boolean; renamedTo?: string; message: string } {
  clearHMEMCache();
  const stateDir = process.env.OKO_STATE_DIR || ".oko";
  const hmemDir = path.resolve(process.cwd(), stateDir, "hmem");

  if (!fs.existsSync(hmemDir)) {
    return { success: true, message: `No H-MEM directory found at ${hmemDir}` };
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = `${hmemDir}.bak-${timestamp}`;
  fs.renameSync(hmemDir, backupDir);
  console.log(`[HMEM] Renamed ${hmemDir} -> ${backupDir}`);
  return { success: true, renamedTo: backupDir, message: `Backed up to ${backupDir}` };
}

if (
  process.argv[1] &&
  (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` ||
    process.argv[1].replace(/\\/g, "/").endsWith("scripts/hmem-reset.ts"))
) {
  resetHMEM();
}
