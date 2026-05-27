import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getWorkspaceProject } from "@/lib/db";
import { updateFmdSection } from "@/lib/fmd-mutations";
import { computeSectionHash, deriveSectionData } from "@/lib/fmd-section-helpers";
import { normalizeSectionType } from "@/lib/fmd-section-schemas";

function mergeOverrides(fresh: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result = { ...fresh };
  for (const [key, value] of Object.entries(overrides)) {
    if (key in result) {
      result[key] = value;
    }
  }
  return result;
}

const refreshSchema = z.object({
  resetOverrides: z.boolean().default(false),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sectionId: string }> },
) {
  const { projectId, sectionId } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = refreshSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const section = await prisma.fmdSection.findUnique({
      where: { id: sectionId },
    });
    if (!section || section.projectId !== projectId) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    const project = await getWorkspaceProject(projectId);
    if (project.mode === "fallback") {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const normalizedType = normalizeSectionType(section.sectionType);
    const freshData = deriveSectionData(project, normalizedType);
    const newHash = computeSectionHash(freshData);

    const existingContent = JSON.parse(section.contentJson) as Record<string, unknown>;

    const existingOverrides = (existingContent.overrides as Record<string, unknown>) ?? {};

    const mergedData = parsed.data.resetOverrides
      ? freshData
      : mergeOverrides(freshData as Record<string, unknown>, existingOverrides as Record<string, unknown>);

    const updatedContent: Record<string, unknown> = {
      ...existingContent,
      sourceMode: existingOverrides && typeof existingOverrides === "object" && Object.keys(existingOverrides).length > 0 ? "mixed" : "derived",
      data: mergedData,
      overrides: parsed.data.resetOverrides ? {} : existingOverrides,
      staleState: {
        isStale: false,
        lastSyncedAt: new Date().toISOString(),
        sourceHash: newHash,
        currentHash: newHash,
      },
    };

    const updatedSection = await updateFmdSection(projectId, sectionId, {
      content: updatedContent,
    });

    if (!updatedSection) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    return NextResponse.json({ section: updatedSection });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to refresh section", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
