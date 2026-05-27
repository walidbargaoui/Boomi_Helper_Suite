/**
 * POST /api/boomi/components/dependencies
 *
 * Body: { projectId?: string, sourceComponentId: string }
 *
 * Scans the templateXml of the named draft in the active project for referenced
 * component UUIDs (maps, profiles, connector settings, sub-processes) and returns
 * a list with role hints. Does NOT auto-import — UI lets the user pick which
 * dependencies to fetch via the existing /api/boomi/templates/import endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractProcessDependencies } from "@/lib/boomi-sandbox";
import { getWorkspaceProject } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const projectId = typeof body.projectId === "string" ? body.projectId : undefined;
    const sourceComponentId = typeof body.sourceComponentId === "string" ? body.sourceComponentId : undefined;
    if (!sourceComponentId) {
      return NextResponse.json({ error: "sourceComponentId is required." }, { status: 400 });
    }

    const project = await getWorkspaceProject(projectId);
    const sourceDraft = project.boomiDrafts.find((d) => d.componentId === sourceComponentId);
    if (!sourceDraft) {
      return NextResponse.json(
        { error: "Component not found in this project's drafts.", detail: sourceComponentId },
        { status: 404 },
      );
    }
    if (!sourceDraft.templateXml?.trim()) {
      return NextResponse.json(
        { error: "Component has no imported template XML to scan.", detail: sourceDraft.componentName },
        { status: 400 },
      );
    }

    const deps = extractProcessDependencies(sourceDraft.templateXml, sourceComponentId);

    // Annotate each dep with whether it's already imported locally
    const annotated = deps.map((d) => ({
      ...d,
      alreadyImported: project.boomiDrafts.some((x) => x.componentId === d.componentId),
    }));

    return NextResponse.json({
      sourceComponentId,
      sourceComponentName: sourceDraft.componentName,
      sourceComponentType: sourceDraft.componentType,
      dependencies: annotated,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Dependency scan failed.",
        detail: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    );
  }
}
