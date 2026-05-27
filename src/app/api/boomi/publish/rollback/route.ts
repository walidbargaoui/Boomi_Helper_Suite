import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceProject, recordBoomiPublishEvent, sanitizeProjectForClient } from "@/lib/db";
import { decryptValue } from "@/lib/boomi-crypto";
import { rollbackBoomiComponent, type BoomiConnectionInput } from "@/lib/boomi-sandbox";
import { prisma } from "@/lib/db";
import { z } from "zod";
import type { BoomiComponentDraft } from "@/lib/domain";

const rollbackRequestSchema = z.object({
  projectId: z.string().min(1),
  connectionId: z.string().min(1),
  eventId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = rollbackRequestSchema.safeParse(body);

  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return NextResponse.json({ error: messages }, { status: 400 });
  }

  const { projectId, connectionId, eventId } = parsed.data;

  const project = await getWorkspaceProject(projectId);
  const connection = project.boomiConnections.find((conn) => conn.id === connectionId);

  if (!connection) {
    return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  }

  const dbEvent = await prisma.boomiPublishEvent.findUnique({ where: { id: eventId } });
  if (!dbEvent || dbEvent.projectId !== projectId) {
    return NextResponse.json({ error: "Publish history event not found." }, { status: 404 });
  }

  if (!dbEvent.requestXml?.trim()) {
    return NextResponse.json({ error: "No request XML in this publish history event." }, { status: 400 });
  }

  if (dbEvent.action === "create") {
    return NextResponse.json(
      { error: "Rollback is only available for update publishes. Created components require manual cleanup in Boomi." },
      { status: 400 },
    );
  }

  const decryptedConnection: BoomiConnectionInput = {
    accountId: connection.accountId,
    environmentName: connection.environmentName,
    baseUrl: connection.baseUrl,
    authMode: connection.authMode,
    apiUsername: decryptValue(connection.apiUsername),
    apiPassword: decryptValue(connection.apiPassword),
    mode: connection.mode,
  };

  try {
    const result = await rollbackBoomiComponent(decryptedConnection, {
      componentId: dbEvent.componentId ?? "",
      componentName: dbEvent.componentName ?? "",
      componentType: dbEvent.componentType ?? "",
      requestXml: dbEvent.requestXml,
    });

    await recordBoomiPublishEvent(projectId, {
      draftId: `rollback-${eventId}`,
      connectionId,
      componentId: result.componentId,
      componentName: result.componentName,
      componentType: result.componentType as BoomiComponentDraft["componentType"],
      version: result.version,
      action: result.action,
      requestXml: dbEvent.requestXml,
      responseXml: result.responseXml,
      status: result.ok ? "success" : "failed",
      errorDetail: result.errorDetail,
    });

    const refreshed = await getWorkspaceProject(projectId);
    return NextResponse.json({ result, project: sanitizeProjectForClient(refreshed) });
  } catch (error) {
    return NextResponse.json(
      { error: "Rollback failed.", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
