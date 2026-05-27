import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { deleteFmdSection, updateFmdSection } from "@/lib/fmd-mutations";
import { fmdSectionContentSchema } from "@/lib/fmd-section-schemas";

const patchSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  sectionType: z.string().min(1).optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  exportEnabled: z.boolean().optional(),
  overrides: z.record(z.string(), z.unknown()).optional(),
  linkedEntities: z
    .array(
      z.object({
        entityType: z.string(),
        entityId: z.string(),
        label: z.string().optional(),
      }),
    )
    .optional(),
  sourceMode: z.enum(["manual", "derived", "mixed", "imported", "legacy"]).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sectionId: string }> },
) {
  const { projectId, sectionId } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    if (parsed.data.content) {
      const contentValidation = fmdSectionContentSchema.safeParse(parsed.data.content ?? {});
      if (!contentValidation.success) {
        return NextResponse.json(
          { error: "Invalid content wrapper", issues: contentValidation.error.issues },
          { status: 400 },
        );
      }
    }

    let finalContent: Record<string, unknown> | undefined;
    if (parsed.data.content) {
      finalContent = parsed.data.content;
    } else if (
      parsed.data.exportEnabled !== undefined ||
      parsed.data.overrides !== undefined ||
      parsed.data.linkedEntities !== undefined ||
      parsed.data.sourceMode !== undefined
    ) {
      const existing = await prisma.fmdSection.findUnique({
        where: { id: sectionId },
      });
      if (!existing || existing.projectId !== projectId) {
        return NextResponse.json({ error: "Section not found" }, { status: 404 });
      }
      const existingContent = JSON.parse(existing.contentJson) as Record<string, unknown>;
      finalContent = {
        ...existingContent,
        ...(parsed.data.exportEnabled !== undefined && { exportEnabled: parsed.data.exportEnabled }),
        ...(parsed.data.overrides !== undefined && { overrides: parsed.data.overrides }),
        ...(parsed.data.linkedEntities !== undefined && { linkedEntities: parsed.data.linkedEntities }),
        ...(parsed.data.sourceMode !== undefined && { sourceMode: parsed.data.sourceMode }),
      };
    }

    const updateData: Partial<{ title: string; sectionType: string; content: Record<string, unknown> }> = {};
    if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
    if (parsed.data.sectionType !== undefined) updateData.sectionType = parsed.data.sectionType;
    if (finalContent !== undefined) updateData.content = finalContent;

    const section = await updateFmdSection(projectId, sectionId, updateData);
    if (!section) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    return NextResponse.json({ section });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update section", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sectionId: string }> },
) {
  const { projectId, sectionId } = await params;
  try {
    const deleted = await deleteFmdSection(projectId, sectionId);
    if (!deleted) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete section", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
