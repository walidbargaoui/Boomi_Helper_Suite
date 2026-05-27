import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  deleteProfileField,
  profileFieldUpdateSchema,
  updateProfileField,
} from "@/lib/project-mutations";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ fieldId: string }> },
) {
  const { fieldId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = profileFieldUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid field payload", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const field = await updateProfileField(prisma, fieldId, parsed.data);
    return NextResponse.json({ field });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update field", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ fieldId: string }> },
) {
  const { fieldId } = await params;
  try {
    await deleteProfileField(prisma, fieldId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete field", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
