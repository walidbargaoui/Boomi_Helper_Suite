import { NextRequest, NextResponse } from "next/server";
import { approveCompanionV3Run } from "@/lib/boomi-companion-v3";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  try {
    const { packageId } = await params;
    const body = await request.json().catch(() => ({})) as { runId?: string };
    if (!body.runId) {
      return NextResponse.json(
        { error: "Missing runId.", detail: "Run v3 preflight before approving agent execution." },
        { status: 400 },
      );
    }

    const plan = await approveCompanionV3Run(packageId, body.runId);
    return NextResponse.json({
      packageId,
      runId: body.runId,
      status: plan.status,
      plan,
      eventsUrl: `/api/boomi/companion/packages/${packageId}/run/v3/events?runId=${encodeURIComponent(body.runId)}`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to approve Companion v3 run.",
        detail: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 400 },
    );
  }
}
