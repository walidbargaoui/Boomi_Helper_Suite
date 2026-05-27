import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createEndpoint, endpointCreateSchema } from "@/lib/project-mutations";
import { markSectionsStale } from "@/lib/fmd-mutations";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = endpointCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid endpoint payload", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const endpoint = await createEndpoint(prisma, projectId, parsed.data);
    markSectionsStale(projectId).catch(() => {});
    return NextResponse.json({ endpoint }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create endpoint", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
