import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspaceProject } from "@/lib/db";
import { createFmdSection, getProjectFmdSections } from "@/lib/fmd-mutations";
import { createDefaultFmdSection } from "@/lib/fmd-section-helpers";
import { getRequiredSectionTypes, getSectionTypeMeta } from "@/lib/fmd-section-registry";
import { normalizeSectionType } from "@/lib/fmd-section-schemas";
import type { FmdSectionType } from "@/lib/fmd-section-schemas";

const initializeSchema = z.object({
  mode: z.enum(["blank", "from-project", "from-template", "fill-missing"]).default("from-project"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = initializeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const existingSections = await getProjectFmdSections(projectId);

    if (parsed.data.mode === "fill-missing") {
      const project = await getWorkspaceProject(projectId);
      if (project.mode === "fallback") {
        return NextResponse.json({ error: "Project not found" }, { status: 404 });
      }

      const presentTypes = new Set(existingSections.map((s) => normalizeSectionType(s.sectionType)));
      const requiredTypes = getRequiredSectionTypes();
      if (requiredTypes.every((t) => presentTypes.has(t.sectionType))) {
        return NextResponse.json(
          { error: "All required section types are already present." },
          { status: 409 },
        );
      }

      const optionalTypes: FmdSectionType[] = ["documentControl", "qualityChecklist", "boomiComponents"];
      const typesToCreate: FmdSectionType[] = [
        ...requiredTypes.map((t) => t.sectionType),
        ...optionalTypes,
      ];

      let maxOrder = existingSections.reduce((max, s) => Math.max(max, s.sortOrder), 0);
      const created: Awaited<ReturnType<typeof createFmdSection>>[] = [];
      for (const sectionType of typesToCreate) {
        if (presentTypes.has(sectionType)) continue;
        maxOrder += 1;
        const meta = getSectionTypeMeta(sectionType);
        const defaultSection = createDefaultFmdSection(project, sectionType, {
          overrideTitle: meta.defaultTitle,
        });
        const section = await createFmdSection(projectId, {
          title: defaultSection.title,
          sectionType: defaultSection.sectionType,
          sortOrder: maxOrder,
          content: defaultSection.content,
        });
        created.push(section);
      }

      return NextResponse.json({ sections: created }, { status: 201 });
    }

    if (existingSections.length > 0) {
      return NextResponse.json(
        { error: "FMD sections already exist for this project. Use individual section endpoints to add more." },
        { status: 409 },
      );
    }

    if (parsed.data.mode === "blank") {
      return NextResponse.json({ sections: [] }, { status: 201 });
    }

    const project = await getWorkspaceProject(projectId);
    if (project.mode === "fallback") {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const requiredTypes = getRequiredSectionTypes();
    const optionalTypes: FmdSectionType[] = ["documentControl", "qualityChecklist", "boomiComponents"];
    const typesToCreate: FmdSectionType[] = [
      ...requiredTypes.map((t) => t.sectionType),
      ...optionalTypes,
    ];

    const created: Awaited<ReturnType<typeof createFmdSection>>[] = [];
    for (let i = 0; i < typesToCreate.length; i++) {
      const sectionType = typesToCreate[i];
      const meta = getSectionTypeMeta(sectionType);
      const defaultSection = createDefaultFmdSection(project, sectionType, {
        overrideTitle: meta.defaultTitle,
      });
      const section = await createFmdSection(projectId, {
        title: defaultSection.title,
        sectionType: defaultSection.sectionType,
        sortOrder: i,
        content: defaultSection.content,
      });
      created.push(section);
    }

    return NextResponse.json({ sections: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to initialize FMD sections", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
