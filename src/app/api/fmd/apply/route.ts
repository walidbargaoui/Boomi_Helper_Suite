import { NextRequest, NextResponse } from "next/server";
import { applyFmdDraft, applyRequestSchema, detectFmdConflicts } from "@/lib/fmd-apply";
import { getWorkspaceProject, prisma, sanitizeProjectForClient } from "@/lib/db";

export async function POST(request: NextRequest) {
  const json = await request.json().catch(() => null);
  const parsed = applyRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid apply payload", issues: parsed.error.issues }, { status: 400 });
  }

  if (parsed.data.mode !== "create" && !parsed.data.projectId) {
    return NextResponse.json(
      { error: "projectId is required when mode is not 'create'." },
      { status: 400 },
    );
  }

  // Run conflict detection (informational; non-blocking for warnings).
  let currentProject;
  if (parsed.data.mode !== "create" && parsed.data.projectId) {
    try {
      currentProject = await getWorkspaceProject(parsed.data.projectId);
    } catch {
      currentProject = undefined;
    }
  }
  const conflicts = detectFmdConflicts(parsed.data, currentProject);
  const blockingConflicts = conflicts.filter((conflict) => conflict.severity === "error");
  if (blockingConflicts.length > 0) {
    return NextResponse.json(
      { error: "Blocking conflicts prevent apply", conflicts: blockingConflicts },
      { status: 422 },
    );
  }

  try {
    const result = await applyFmdDraft(prisma, parsed.data);
    const refreshed = await getWorkspaceProject(result.projectId);
    return NextResponse.json({ result, conflicts, project: sanitizeProjectForClient(refreshed) }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to apply FMD draft",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
