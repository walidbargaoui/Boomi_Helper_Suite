import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { decryptValue } from "@/lib/boomi-crypto";
import {
  buildPublishSafetyContext,
  publishActionForDraft,
  publishBoomiComponent,
  validateComponentXml,
  validatePublishSafety,
  type BoomiConnectionInput,
} from "@/lib/boomi-sandbox";
import { getWorkspaceProject, recordBoomiPublishEvent, sanitizeProjectForClient } from "@/lib/db";

const publishRequestSchema = z.object({
  projectId: z.string().min(1),
  connectionId: z.string().min(1),
  draftId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = publishRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid publish payload.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { projectId, connectionId, draftId } = parsed.data;
  const project = await getWorkspaceProject(projectId);
  const connection = project.boomiConnections.find((candidate) => candidate.id === connectionId);
  if (!connection) {
    return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  }

  const draft = project.boomiDrafts.find((candidate) => candidate.id === draftId);
  if (!draft) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }

  const safety = validatePublishSafety(
    {
      componentType: draft.componentType,
      validationStatus: draft.validationStatus,
      templateXml: draft.templateXml,
      diff: draft.diff,
    },
    buildPublishSafetyContext(project, draft, connection.mode),
  );
  const xmlValidation = validateComponentXml(draft.proposedXml);
  const blockers = [
    ...safety.blockers,
    ...xmlValidation.issues.map((issue) => `Proposed XML: ${issue}`),
  ];
  const action = publishActionForDraft(draft);

  if (blockers.length > 0) {
    const event = await recordBoomiPublishEvent(project.id, {
      draftId: draft.id,
      connectionId: connection.id,
      componentId: draft.componentId,
      componentName: draft.componentName,
      componentType: draft.componentType,
      action,
      requestXml: draft.proposedXml,
      status: "failed",
      errorDetail: blockers.join(" "),
    });
    const refreshed = await getWorkspaceProject(project.id);
    return NextResponse.json(
      {
        error: "Publish blocked.",
        blockers,
        warnings: safety.warnings,
        event,
        project: sanitizeProjectForClient(refreshed),
      },
      { status: 422 },
    );
  }

  let decryptedConnection: BoomiConnectionInput;
  try {
    decryptedConnection = {
      accountId: connection.accountId,
      environmentName: connection.environmentName,
      baseUrl: connection.baseUrl,
      authMode: connection.authMode,
      apiUsername: decryptValue(connection.apiUsername),
      apiPassword: decryptValue(connection.apiPassword),
      mode: connection.mode,
    };
  } catch {
    decryptedConnection = {
      accountId: connection.accountId,
      environmentName: connection.environmentName,
      baseUrl: connection.baseUrl,
      authMode: connection.authMode,
      apiUsername: connection.apiUsername,
      apiPassword: connection.apiPassword,
      mode: connection.mode,
    };
  }

  try {
    const result = await publishBoomiComponent(decryptedConnection, draft);
    const rollbackXml = result.action === "update" && draft.templateXml?.trim()
      ? draft.templateXml
      : draft.proposedXml;
    const event = await recordBoomiPublishEvent(project.id, {
      draftId: draft.id,
      connectionId: connection.id,
      componentId: result.componentId,
      componentName: draft.componentName,
      componentType: draft.componentType,
      version: result.version,
      action: result.action,
      requestXml: rollbackXml,
      responseXml: result.responseXml,
      status: result.ok ? "success" : "failed",
      errorDetail: result.errorDetail,
    });
    const refreshed = await getWorkspaceProject(project.id);

    if (!result.ok) {
      return NextResponse.json(
        {
          error: "Boomi publish failed.",
          detail: result.errorDetail,
          event,
          result,
          project: sanitizeProjectForClient(refreshed),
        },
        { status: result.status || 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      event,
      result,
      project: sanitizeProjectForClient(refreshed),
    });
  } catch (error) {
    const event = await recordBoomiPublishEvent(project.id, {
      draftId: draft.id,
      connectionId: connection.id,
      componentId: draft.componentId,
      componentName: draft.componentName,
      componentType: draft.componentType,
      action,
      requestXml: draft.proposedXml,
      status: "failed",
      errorDetail: error instanceof Error ? error.message : "Unknown publish error.",
    });
    const refreshed = await getWorkspaceProject(project.id);
    return NextResponse.json(
      {
        error: "Publish failed.",
        detail: error instanceof Error ? error.message : "Unknown publish error.",
        event,
        project: sanitizeProjectForClient(refreshed),
      },
      { status: 500 },
    );
  }
}
