import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ briefings: [], message: "Not implemented yet" });
}
