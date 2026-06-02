import { NextResponse } from "next/server";
import { getBoomiBuildPackage, updatePackageStatus } from "@/lib/boomi-companion-mutations";
import { buildPackageFiles, buildPackageZip } from "@/lib/boomi-companion-package";
import { boomiBuildSpecSchema } from "@/lib/boomi-companion-schemas";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ packageId: string }> },
) {
  try {
    const { packageId } = await params;
    const row = await getBoomiBuildPackage(packageId);

    if (!row) {
      return NextResponse.json({ error: "Package not found." }, { status: 404 });
    }

    const specResult = boomiBuildSpecSchema.safeParse(JSON.parse(row.specJson));
    if (!specResult.success) {
      return NextResponse.json({ error: "Package spec is corrupted." }, { status: 500 });
    }

    const spec = specResult.data;
    const projectName = (spec.project.name || "package").replace(/[^a-zA-Z0-9_-]/g, "-");
    const date = new Date().toISOString().slice(0, 10);
    const files = buildPackageFiles(spec, packageId);
    const zipBuffer = await buildPackageZip(files);

    await updatePackageStatus(packageId, "downloaded").catch(() => {});

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="boomi-companion-package-${projectName}-${date}.zip"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to download package.",
        detail: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    );
  }
}
