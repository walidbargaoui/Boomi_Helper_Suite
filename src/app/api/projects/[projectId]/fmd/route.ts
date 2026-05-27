import { NextRequest, NextResponse } from "next/server";
import { getProjectFmdSections } from "@/lib/fmd-mutations";
import { getAllSectionTypes, getRequiredSectionTypes } from "@/lib/fmd-section-registry";
import { normalizeSectionType } from "@/lib/fmd-section-schemas";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  try {
    const sections = await getProjectFmdSections(projectId);
    const allTypes = getAllSectionTypes();
    const requiredTypes = getRequiredSectionTypes();
    const presentTypes = new Set(sections.map((s) => normalizeSectionType(s.sectionType)));

    const completion = {
      totalRequired: requiredTypes.length,
      totalPresent: sections.length,
      requiredPresent: requiredTypes.filter((t) => presentTypes.has(t.sectionType)).length,
      optionalPresent: sections.filter((s) => !requiredTypes.some((r) => r.sectionType === normalizeSectionType(s.sectionType))).length,
    };

    return NextResponse.json({
      sections,
      completion,
      registry: allTypes,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch FMD sections", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
