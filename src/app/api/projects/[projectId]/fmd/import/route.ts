import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getProjectFmdSections } from "@/lib/fmd-mutations";
import { normalizeSectionType } from "@/lib/fmd-section-schemas";

const importSectionSchema = z.object({
  title: z.string().min(1).max(500),
  sectionType: z.string().min(1),
  sortOrder: z.number().int().min(0),
  content: z.record(z.string(), z.unknown()),
});

const importSectionsSchema = z.object({
  sections: z.array(importSectionSchema).min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = importSectionsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const existingSections = await getProjectFmdSections(projectId);
    const existingKeys = new Set(
      existingSections.map((s) => `${normalizeSectionType(s.sectionType)}::${s.title.toLowerCase().trim()}`),
    );

    let maxOrder = existingSections.reduce((max, s) => Math.max(max, s.sortOrder), 0);
    const created: Array<{ id: string; title: string; sectionType: string }> = [];

    for (const draft of parsed.data.sections) {
      const key = `${normalizeSectionType(draft.sectionType)}::${draft.title.toLowerCase().trim()}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      maxOrder += 1;

      const normalizedType = normalizeSectionType(draft.sectionType);
      const sectionType = normalizedType === "legacy" ? draft.sectionType : normalizedType;
      const section = await prisma.fmdSection.create({
        data: {
          projectId,
          title: draft.title,
          sectionType,
          contentJson: JSON.stringify(draft.content),
          sortOrder: maxOrder,
        },
      });
      created.push({ id: section.id, title: section.title, sectionType });
    }

    return NextResponse.json({ sections: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to import FMD sections", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
