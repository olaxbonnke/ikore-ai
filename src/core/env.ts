import dotenv from "dotenv";

let envLoaded = false;

/**
 * Loads .env exactly once per process to prevent duplicate injection log messages.
 */
export function initEnv(): void {
  if (!envLoaded) {
    envLoaded = true;
    dotenv.config();
  }
}

// Auto-initialize on import
initEnv();
