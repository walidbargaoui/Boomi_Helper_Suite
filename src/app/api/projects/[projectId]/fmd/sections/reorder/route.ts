import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reorderFmdSections } from "@/lib/fmd-mutations";

const reorderSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    await reorderFmdSections(projectId, parsed.data.orderedIds);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to reorder sections", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
