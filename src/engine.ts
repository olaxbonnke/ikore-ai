// Engine loader for Meterless H-MEM.
// Resolves paths from project root (process.cwd()) so Next.js server routes find vendor/hmem.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface LoadedEngine {
  HMEM: new (opts: { clock?: () => number; persistDir?: string; actor?: string; minerFn?: (prompt: string) => Promise<string> }) => any;
  source: string;
}

/**
 * Finds project root by checking process.cwd() and walking up towards package.json.
 */
function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      if (fs.existsSync(path.join(dir, "vendor", "hmem"))) {
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export async function loadHMEM(): Promise<LoadedEngine> {
  const root = findProjectRoot();
  const distEntry = path.join(root, "vendor", "hmem", "dist", "index.js");
  const srcEntry = path.join(root, "vendor", "hmem", "src", "index.ts");
  const monorepoEntry = path.join(root, "..", "..", "engines", "hmem", "reference", "src", "index.ts");

  const CANDIDATES = [
    { label: "vendor/hmem dist", entry: distEntry },
    { label: "vendor/hmem", entry: srcEntry },
    { label: "monorepo sibling", entry: monorepoEntry },
  ];

  for (const c of CANDIDATES) {
    if (fs.existsSync(c.entry)) {
      try {
        const mod = await import(/* webpackIgnore: true */ pathToFileURL(c.entry).href);
        if (mod && mod.HMEM) {
          return { HMEM: mod.HMEM, source: c.label };
        }
      } catch {
        // Try next candidate if loader fails (e.g. Node raw typescript strip issue)
      }
    }
  }

  throw new Error(`H-MEM engine not found. Looked in ${distEntry}. Run \`npm run build:hmem\` or \`npm run setup\`.`);
}
