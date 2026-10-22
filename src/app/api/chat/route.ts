import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Chat API not implemented yet. See INSTRUCTIONS.md Day 3." },
    { status: 501 },
  );
}
