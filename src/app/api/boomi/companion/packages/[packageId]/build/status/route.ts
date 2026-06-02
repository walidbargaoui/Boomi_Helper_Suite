import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { BUILD_PIPELINES } from "@/lib/boomi-build-pipeline";
import type { PushedComponent } from "@/lib/boomi-build-pipeline";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  const { packageId } = await params;

  const run = await prisma.boomiBuildPipelineRun.findFirst({
    where: { packageId },
    orderBy: { createdAt: "desc" },
  });

  if (!run) {
    return NextResponse.json({ error: "No build pipeline run found." }, { status: 404 });
  }

  const emitter = BUILD_PIPELINES.get(packageId);
  let results: PushedComponent[] = [];

  try {
    if (run.resultsJson) {
      results = JSON.parse(run.resultsJson) as PushedComponent[];
    }
  } catch {
    // ignore parse errors
  }

  return NextResponse.json({
    pipelineRunId: run.id,
    packageId,
    status: emitter?.status === "building" && run.status === "complete"
      ? "building"
      : run.status,
    isRunning: emitter?.status === "building" || false,
    results: results.map((r) => ({
      localId: r.localId,
      name: r.name,
      componentType: r.componentType,
      action: r.action,
      componentId: r.componentId,
      phase: r.phase,
    })),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  });
}
