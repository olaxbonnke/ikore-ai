// Engine loader. After `npm run setup`, the H-MEM reference lives in
// vendor/hmem (degit copy). Inside the monorepo, the sibling path works
// without setup. The startup line names which source loaded, so nobody
// debugs the wrong copy.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface LoadedEngine {
  HMEM: new (opts: { clock?: () => number; persistDir?: string; actor?: string; minerFn?: (prompt: string) => Promise<string> }) => any;
  source: string;
}

export async function loadHMEM(): Promise<LoadedEngine> {
  const distEntry = path.join(here, "..", "vendor", "hmem", "dist", "index.js");
  const srcEntry = path.join(here, "..", "vendor", "hmem", "src", "index.ts");
  const monorepoEntry = path.join(here, "..", "..", "..", "engines", "hmem", "reference", "src", "index.ts");

  // Ensure compiled dist/index.js exists if src/index.ts is present
  if (!fs.existsSync(distEntry) && fs.existsSync(srcEntry)) {
    try {
      const { execSync } = await import("node:child_process");
      execSync("npx esbuild vendor/hmem/src/index.ts --bundle --platform=node --format=esm --outfile=vendor/hmem/dist/index.js", {
        cwd: path.join(here, ".."),
        stdio: "ignore",
      });
    } catch {
      // Continue to try direct candidates if build fails
    }
  }

  const CANDIDATES = [
    { label: "vendor/hmem dist", entry: distEntry },
    { label: "vendor/hmem", entry: srcEntry },
    { label: "monorepo sibling", entry: monorepoEntry },
  ];

  for (const c of CANDIDATES) {
    if (fs.existsSync(c.entry)) {
      try {
        const mod = await import(pathToFileURL(c.entry).href);
        if (mod && mod.HMEM) {
          return { HMEM: mod.HMEM, source: c.label };
        }
      } catch {
        // Try next candidate if loader fails (e.g. Node typescript strip error)
      }
    }
  }

  throw new Error("H-MEM engine not found. Run `npm run build:hmem` or `npm run setup`.");
}
