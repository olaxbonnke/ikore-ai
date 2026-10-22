/** App configuration from env (DESIGN.md section 11). */

export function getConfig() {
  return {
    dataMode: (process.env.DATA_MODE === "snapshot" ? "snapshot" : "live") as "live" | "snapshot",
    tz: process.env.OKO_TZ ?? "Africa/Lagos",
    stateDir: process.env.OKO_STATE_DIR ?? ".oko",
    demoDate: process.env.OKO_DEMO_DATE?.trim() || undefined,
  };
}
