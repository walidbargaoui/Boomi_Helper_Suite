import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceProject, sanitizeProjectForClient } from "@/lib/db";
import { buildBoomiBuildSpec } from "@/lib/boomi-companion-build-spec";
import { buildPackageFiles, buildPackageManifest } from "@/lib/boomi-companion-package";
import { createBoomiBuildPackage } from "@/lib/boomi-companion-mutations";
import { prisma } from "@/lib/db";

function packageResponse(row: {
  id: string;
  projectId: string;
  status: string;
  manifestJson: string;
  readinessJson: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    packageId: row.id,
    projectId: row.projectId,
    status: row.status,
    manifest: JSON.parse(row.manifestJson),
    readiness: JSON.parse(row.readinessJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    }

    const row = await prisma.boomiBuildPackage.findFirst({
      where: { projectId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({ package: row ? packageResponse(row) : null });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to retrieve latest Companion build package.",
        detail: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const projectId =
      typeof body?.projectId === "string" && body.projectId.length > 0
        ? body.projectId
        : undefined;

    const project = await getWorkspaceProject(projectId);

    if (project.mode === "fallback" && !projectId) {
      return NextResponse.json(
        {
          error: "No project available.",
          detail: "Create or select a project before generating a Companion build package.",
        },
        { status: 400 },
      );
    }

    const spec = buildBoomiBuildSpec(project);

    const row = await createBoomiBuildPackage(project.id, spec, spec.readiness);

    const files = buildPackageFiles(spec, row.id);
    const manifest = buildPackageManifest(spec, row.id, files);

    await prisma.$transaction(async (tx) => {
      await tx.boomiBuildPackage.update({
        where: { id: row.id },
        data: {
          manifestJson: JSON.stringify(manifest),
          status: "ready",
        },
      });
    });

    return NextResponse.json({
      packageId: row.id,
      manifest,
      readiness: spec.readiness,
      project: sanitizeProjectForClient(project),
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to generate Companion build package.",
        detail: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    );
  }
}
