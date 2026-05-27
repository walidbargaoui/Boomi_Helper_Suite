import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceProject, updateWorkspaceProject, sanitizeProjectForClient } from "@/lib/db";
import { decryptValue } from "@/lib/boomi-crypto";
import { importBoomiTemplate, boomiTemplateImportSchema, BoomiConnectionInput, validateComponentXml, computeXmlDiff } from "@/lib/boomi-sandbox";
import type { BoomiComponentDraft } from "@/lib/domain";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { connectionId, projectId, ...templateInput } = body;

  if (!connectionId) {
    return NextResponse.json({ error: "Connection ID is required." }, { status: 400 });
  }

  const templateValidation = boomiTemplateImportSchema.safeParse(templateInput);
  if (!templateValidation.success) {
    const flattened = templateValidation.error.flatten();
    const messages = [
      ...flattened.formErrors,
      ...Object.entries(flattened.fieldErrors).map(([field, errs]) => `${field}: ${errs.join(", ")}`),
    ];
    return NextResponse.json({ error: messages.join("; ") || "Invalid template import payload." }, { status: 400 });
  }

  const project = await getWorkspaceProject(projectId);
  const connection = project.boomiConnections.find((conn) => conn.id === connectionId);

  if (!connection) {
    return NextResponse.json({ error: "Connection not found." }, { status: 404 });
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
    const importResult = await importBoomiTemplate(decryptedConnection, templateValidation.data);

    const validation = validateComponentXml(importResult.templateXml);
    const existingDraft = project.boomiDrafts.find(
      (d) => d.componentId === importResult.componentId,
    );

    let diff = "";
    let proposedXml = importResult.templateXml;

    if (existingDraft) {
      diff = computeXmlDiff(existingDraft.templateXml ?? "", importResult.templateXml);
      proposedXml = importResult.templateXml;
    }

    const draft: BoomiComponentDraft = {
      id: existingDraft?.id ?? randomUUID(),
      componentId: importResult.componentId,
      componentName: importResult.componentName,
      componentType: importResult.componentType as BoomiComponentDraft["componentType"],
      templateXml: importResult.templateXml,
      proposedXml,
      diff,
      validationStatus: validation.ok ? "Dry-run valid" : "Blocked",
      notes: validation.issues.length > 0 ? validation.issues.join(" ") : "Template imported successfully.",
      createdAt: existingDraft?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (existingDraft) {
      const index = project.boomiDrafts.findIndex((d) => d.id === existingDraft.id);
      project.boomiDrafts[index] = draft;
    } else {
      project.boomiDrafts.unshift(draft);
    }

    await updateWorkspaceProject(project);
    const refreshed = await getWorkspaceProject(project.id);

    return NextResponse.json({
      result: importResult,
      draft,
      project: sanitizeProjectForClient(refreshed),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Template import failed." },
      { status: 500 },
    );
  }
}
