/**
 * GET /api/boomi/publish/events/[eventId]
 *
 * Returns the full publish-event payload (including `requestXml` and
 * `responseXml`) for one event. The general project graph trims these XML
 * bodies because they can be tens of KB each — the UI's history list only
 * needs metadata. This endpoint is the on-demand detail view that backs
 * "expand event" / "view diff" / "view response" actions.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  if (!eventId) {
    return NextResponse.json({ error: "eventId is required." }, { status: 400 });
  }
  try {
    const event = await prisma.boomiPublishEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      return NextResponse.json({ error: "Publish event not found." }, { status: 404 });
    }
    return NextResponse.json({
      event: {
        id: event.id,
        projectId: event.projectId,
        draftId: event.draftId,
        connectionId: event.connectionId ?? undefined,
        componentId: event.componentId,
        componentName: event.componentName,
        componentType: event.componentType,
        version: event.version ?? undefined,
        action: event.action,
        requestXml: event.requestXml,
        responseXml: event.responseXml ?? undefined,
        status: event.status,
        errorDetail: event.errorDetail ?? undefined,
        publishedAt: event.publishedAt.toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch publish event.",
        detail: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    );
  }
}
