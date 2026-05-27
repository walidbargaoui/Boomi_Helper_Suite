import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceProject } from "@/lib/db";
import { decryptValue } from "@/lib/boomi-crypto";
import { lookupBoomiComponents, boomiComponentLookupSchema, BoomiConnectionInput } from "@/lib/boomi-sandbox";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { connectionId, projectId, ...lookupInput } = body;

  if (!connectionId) {
    return NextResponse.json({ error: "Connection ID is required." }, { status: 400 });
  }

  const lookupValidation = boomiComponentLookupSchema.safeParse(lookupInput);
  if (!lookupValidation.success) {
    const flattened = lookupValidation.error.flatten();
    const messages = [
      ...flattened.formErrors,
      ...Object.entries(flattened.fieldErrors).map(([field, errs]) => `${field}: ${errs.join(", ")}`),
    ];
    return NextResponse.json({ error: messages.join("; ") || "Invalid component lookup payload." }, { status: 400 });
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
    const result = await lookupBoomiComponents(decryptedConnection, lookupValidation.data);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Component lookup failed." },
      { status: 500 },
    );
  }
}
