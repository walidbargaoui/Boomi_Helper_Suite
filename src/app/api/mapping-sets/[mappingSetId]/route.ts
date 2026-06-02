import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ mappingSetId: string }> },
) {
  const { mappingSetId } = await params;
  try {
    await prisma.mappingSet.delete({ where: { id: mappingSetId } });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Mapping set not found or could not be deleted" }, { status: 404 });
  }
}
