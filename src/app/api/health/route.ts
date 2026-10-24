import { NextResponse } from "next/server";
import { initEnv } from "@/core/env";

export async function GET() {
  initEnv();

  const sample_mode = process.env.SAMPLE_MODE === "true";
  const nightshift_configured = Boolean(
    process.env.METERLESS_BASE_URL &&
    process.env.METERLESS_RUNTIME_TOKEN &&
    process.env.METERLESS_RUNTIME_TOKEN.trim().length > 0
  );
  const zetaris_configured = Boolean(
    process.env.ZETARIS_REST_URL &&
    process.env.ZETARIS_API_KEY &&
    process.env.ZETARIS_ORG_ID
  );

  return NextResponse.json({
    ok: true,
    sample_mode,
    nightshift_configured,
    zetaris_configured,
  });
}
