import { NextRequest, NextResponse } from "next/server";
import { exportFmdWorkbookFromSections, type FmdExportOptions } from "@/lib/fmd-export";
import { getWorkspaceProject } from "@/lib/db";
import "@/lib/fmd-export-renderers";

const validTemplates = ["standard", "japanese", "boomi-design"] as const;

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const templateParam = url.searchParams.get("template") as FmdExportOptions["template"];
    const template = validTemplates.includes(templateParam) ? templateParam : "standard";

    const includeSampleData = url.searchParams.get("sample") === "true";
    const includeXmlPreview = url.searchParams.get("xml") === "true";
    const includeQualityReport = url.searchParams.get("quality") === "true";
    const includeChecklist = url.searchParams.get("checklist") === "true";
    const projectId = url.searchParams.get("projectId") ?? undefined;

    const project = await getWorkspaceProject(projectId);
    const buffer = await exportFmdWorkbookFromSections(project, {
      template,
      includeSampleData,
      includeXmlPreview,
      includeQualityReport,
      includeChecklist,
    });

    const templateLabel = template === "japanese" ? "JP" : template === "boomi-design" ? "BD" : "STD";
    const filename = `${project.processId}_${project.name.replace(/[^a-z0-9]+/gi, "_")}_FMD_${templateLabel}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to export FMD", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
