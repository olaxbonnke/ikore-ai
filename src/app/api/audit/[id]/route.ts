import { NextResponse } from "next/server";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ memoryId: id, message: "Audit not implemented yet" }, { status: 501 });
}
