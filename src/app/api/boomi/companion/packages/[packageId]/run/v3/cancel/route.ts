import { NextRequest, NextResponse } from "next/server";
import { cancelCompanionV3Run } from "@/lib/boomi-companion-v3";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  try {
    const { packageId } = await params;
    const body = await request.json().catch(() => ({})) as { runId?: string };
    if (!body.runId) {
      return NextResponse.json(
        { error: "Missing runId.", detail: "Only an active v3 agent run can be cancelled." },
        { status: 400 },
      );
    }

    const plan = cancelCompanionV3Run(packageId, body.runId);
    return NextResponse.json({
      packageId,
      runId: body.runId,
      status: plan.status,
      plan,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to cancel Companion v3 run.",
        detail: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 400 },
    );
  }
}
