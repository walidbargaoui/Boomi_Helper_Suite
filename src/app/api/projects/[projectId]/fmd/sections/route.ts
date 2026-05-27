import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createFmdSection } from "@/lib/fmd-mutations";
import { sectionTypeSchema } from "@/lib/fmd-section-schemas";

const createSectionSchema = z.object({
  title: z.string().min(1).max(500),
  sectionType: sectionTypeSchema,
  sortOrder: z.number().int().optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  sourceMode: z.enum(["manual", "derived", "mixed", "imported", "legacy"]).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = createSectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    let sortOrder = parsed.data.sortOrder;
    if (sortOrder === undefined) {
      const lastSection = await prisma.fmdSection.findFirst({
        where: { projectId },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      sortOrder = (lastSection?.sortOrder ?? -1) + 1;
    }

    const content = parsed.data.content ?? {
      schemaVersion: 1,
      sourceMode: parsed.data.sourceMode ?? "manual",
      exportEnabled: true,
      linkedEntities: [],
      data: {},
    };

    const section = await createFmdSection(projectId, {
      title: parsed.data.title,
      sectionType: parsed.data.sectionType,
      sortOrder,
      content,
    });

    return NextResponse.json({ section }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create section", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
