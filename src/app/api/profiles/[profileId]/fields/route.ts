import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  bulkCreateProfileFields,
  createProfileField,
  fieldImportSchema,
  profileFieldCreateSchema,
} from "@/lib/project-mutations";
import { importFields } from "@/lib/field-import";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const { profileId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = profileFieldCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid field payload", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const field = await createProfileField(prisma, profileId, parsed.data);
    return NextResponse.json({ field }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create field", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const { profileId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = fieldImportSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid import payload", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const candidates = importFields(parsed.data);
    if (candidates.length === 0) {
      return NextResponse.json({ error: "No fields detected in the input." }, { status: 422 });
    }
    const fields = await bulkCreateProfileFields(prisma, profileId, candidates);
    return NextResponse.json({ fields }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to import fields", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
