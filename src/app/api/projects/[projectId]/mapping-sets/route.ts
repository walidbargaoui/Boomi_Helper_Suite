import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createMappingSet, mappingSetCreateSchema } from "@/lib/project-mutations";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = mappingSetCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid mapping-set payload", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const mappingSet = await createMappingSet(prisma, projectId, parsed.data);
    return NextResponse.json({ mappingSet }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create mapping set", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
