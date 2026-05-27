import { NextRequest, NextResponse } from "next/server";
import { getProjectFmdSections } from "@/lib/fmd-mutations";
import { validateFmdSection } from "@/lib/fmd-section-helpers";
import { getRequiredSectionTypes } from "@/lib/fmd-section-registry";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  try {
    const sections = await getProjectFmdSections(projectId);
    const requiredTypes = getRequiredSectionTypes();
    const presentTypes = new Set(sections.map((s) => s.sectionType));

    const issues = sections.map((section) => {
      const validation = validateFmdSection(section);
      return {
        sectionId: section.id,
        sectionTitle: section.title,
        errors: validation.errors,
        warnings: validation.warnings,
      };
    });

    const requiredMissing = requiredTypes
      .filter((t) => !presentTypes.has(t.sectionType))
      .map((t) => t.sectionType);

    const valid = issues.every((i) => i.errors.length === 0) && requiredMissing.length === 0;

    return NextResponse.json({
      valid,
      issues,
      requiredMissing,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to validate FMD sections", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
