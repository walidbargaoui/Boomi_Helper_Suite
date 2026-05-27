import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { profileUpdateSchema, updateProfile } from "@/lib/mapping-mutations";
import { deleteProfile } from "@/lib/project-mutations";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const { profileId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = profileUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid profile payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const profile = await updateProfile(prisma, profileId, parsed.data);
    return NextResponse.json({ profile });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update profile", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const { profileId } = await params;
  try {
    await deleteProfile(prisma, profileId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete profile", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
