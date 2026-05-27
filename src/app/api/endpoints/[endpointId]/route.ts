import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deleteEndpoint, endpointUpdateSchema, updateEndpoint } from "@/lib/project-mutations";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> },
) {
  const { endpointId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = endpointUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid endpoint payload", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const endpoint = await updateEndpoint(prisma, endpointId, parsed.data);
    return NextResponse.json({ endpoint });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update endpoint", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ endpointId: string }> },
) {
  const { endpointId } = await params;
  try {
    await deleteEndpoint(prisma, endpointId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete endpoint", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
