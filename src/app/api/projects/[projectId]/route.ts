import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceProject, sanitizeProjectForClient } from "@/lib/db";
import { deleteProject, projectUpdateSchema, updateProject } from "@/lib/project-mutations";
import { prisma } from "@/lib/db";
import { markSectionsStale } from "@/lib/fmd-mutations";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  try {
    const project = await getWorkspaceProject(projectId);
    if (project.mode === "fallback") {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ project: sanitizeProjectForClient(project) });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch project", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const json = await request.json().catch(() => null);
  const parsed = projectUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project payload", issues: parsed.error.issues }, { status: 400 });
  }
  // Optimistic concurrency: prefer If-Match header, fall back to body.version.
  const ifMatch = request.headers.get("if-match");
  const bodyVersion = typeof (json as { version?: unknown })?.version === "number"
    ? (json as { version: number }).version
    : undefined;
  const expectedVersion = ifMatch !== null && !Number.isNaN(Number(ifMatch))
    ? Number(ifMatch)
    : bodyVersion;
  try {
    const { ProjectVersionMismatchError } = await import("@/lib/project-mutations");
    try {
      const project = await updateProject(prisma, projectId, parsed.data, { expectedVersion });
      markSectionsStale(projectId).catch(() => {});
      return NextResponse.json({ project });
    } catch (error) {
      if (error instanceof ProjectVersionMismatchError) {
        return NextResponse.json(
          {
            error: error.message,
            expected: error.expected,
            actual: error.actual,
            code: "VERSION_MISMATCH",
          },
          { status: 409 },
        );
      }
      throw error;
    }
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to update project", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  try {
    await deleteProject(prisma, projectId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete project", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
