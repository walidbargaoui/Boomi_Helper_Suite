import { NextResponse } from "next/server";
import { getBoomiBuildPackage } from "@/lib/boomi-companion-mutations";
import { buildPackageFiles } from "@/lib/boomi-companion-package";
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

    const files = buildPackageFiles(specResult.data, packageId);
    const promptFile = files.find((file) => file.filename === "COMPANION_AGENT_PROMPT.md");

    if (!promptFile) {
      return NextResponse.json({ error: "Prompt file not found." }, { status: 500 });
    }

    return new NextResponse(promptFile.content, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to retrieve prompt.",
        detail: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    );
  }
}
