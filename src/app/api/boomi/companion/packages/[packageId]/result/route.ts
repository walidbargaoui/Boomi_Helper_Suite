import { NextRequest, NextResponse } from "next/server";
import { getBoomiBuildPackage, recordCompanionResult } from "@/lib/boomi-companion-mutations";
import type { CompanionResult } from "@/lib/domain";

const VALID_RUN_STATUSES = new Set([
  "agent_started",
  "agent_running",
  "agent_completed",
  "agent_failed",
  "preflight_running",
  "approval_required",
  "blocked",
  "manual_result_recorded",
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  try {
    const { packageId } = await params;
    const row = await getBoomiBuildPackage(packageId);

    if (!row) {
      return NextResponse.json(
        { error: "Package not found." },
        { status: 404 },
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid request body.", detail: "Expected JSON object." },
        { status: 400 },
      );
    }

    const { result, runStatus } = body as { result?: unknown; runStatus?: string };

    if (!result) {
      return NextResponse.json(
        { error: "Missing result.", detail: "A `result` JSON object is required." },
        { status: 400 },
      );
    }

    if (
      typeof result === "object" &&
      result !== null &&
      "packageId" in result &&
      (result as CompanionResult).packageId !== packageId
    ) {
      return NextResponse.json(
        {
          error: "Result packageId mismatch.",
          detail: `The result's packageId (${String((result as CompanionResult).packageId)}) does not match the route package (${packageId}).`,
        },
        { status: 400 },
      );
    }

    const status = typeof runStatus === "string" && VALID_RUN_STATUSES.has(runStatus)
      ? runStatus
      : "manual_result_recorded";

    const event = await recordCompanionResult(packageId, result, status);

    return NextResponse.json({
      event: {
        id: event.id,
        packageId: event.packageId,
        status: event.status,
        createdAt: event.createdAt,
      },
      recorded: true,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to record Companion result.",
        detail: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 400 },
    );
  }
}
