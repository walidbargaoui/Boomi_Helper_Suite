import { NextRequest, NextResponse } from "next/server";
import { getBoomiBuildPackage, updatePackageStatus } from "@/lib/boomi-companion-mutations";
import { buildPackageFiles, buildPackageZip } from "@/lib/boomi-companion-package";
import { boomiBuildSpecSchema } from "@/lib/boomi-companion-schemas";
import { prisma } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  try {
    const { packageId } = await params;
    const action = new URL(request.url).searchParams.get("action") ?? null;

    const row = await getBoomiBuildPackage(packageId);
    if (!row) {
      return NextResponse.json({ error: "Package not found." }, { status: 404 });
    }

    const specResult = boomiBuildSpecSchema.safeParse(JSON.parse(row.specJson));
    if (!specResult.success) {
      return NextResponse.json({ error: "Package spec is corrupted." }, { status: 500 });
    }

    const spec = specResult.data;
    const files = buildPackageFiles(spec, packageId);

    if (action === "download") {
      const projectName = (spec.project.name || "package").replace(/[^a-zA-Z0-9_-]/g, "-");
      const date = new Date().toISOString().slice(0, 10);
      const zipBuffer = await buildPackageZip(files);
      await updatePackageStatus(packageId, "downloaded").catch(() => {});
      return new NextResponse(new Uint8Array(zipBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="boomi-companion-package-${projectName}-${date}.zip"`,
        },
      });
    }

    if (action === "prompt") {
      const promptFile = files.find((f) => f.filename === "COMPANION_AGENT_PROMPT.md");
      if (!promptFile) {
        return NextResponse.json({ error: "Prompt file not found." }, { status: 500 });
      }
      return new NextResponse(promptFile.content, {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }

    if (action === "status") {
      const runEvents = await prisma.boomiCompanionRunEvent.findMany({
        where: { packageId },
        orderBy: { createdAt: "desc" },
      });

      return NextResponse.json({
        packageId: row.id,
        status: row.status,
        runCount: runEvents.length,
        lastRun: runEvents[0] ?? null,
        runs: runEvents.map((e) => ({
          id: e.id,
          status: e.status,
          createdAt: e.createdAt.toISOString(),
        })),
      });
    }

    const manifest = JSON.parse(row.manifestJson);
    const readiness = JSON.parse(row.readinessJson);

    return NextResponse.json({
      packageId: row.id,
      projectId: row.projectId,
      status: row.status,
      readiness,
      manifest,
      warnings: [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to retrieve package.",
        detail: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    );
  }
}
