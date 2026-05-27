import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceProject, updateWorkspaceProject } from "@/lib/db";
import { encryptValue, decryptValue, maskValue } from "@/lib/boomi-crypto";
import { boomiConnectionSchema, testBoomiConnection, BoomiConnectionInput } from "@/lib/boomi-sandbox";
import { randomUUID } from "crypto";

function decryptForDisplay(value: string) {
  try {
    return decryptValue(value);
  } catch {
    // Ciphertext from an unrelated key or corrupted — don't display gibberish
    return "[re-enter credentials]";
  }
}

function connectionResponse(connection: {
  id: string;
  accountId: string;
  environmentName: string;
  baseUrl: string;
  authMode: "Basic API Token";
  apiUsername: string;
  apiPassword: string;
  mode: "mock" | "sandbox";
  createdAt: string;
}) {
  return {
    id: connection.id,
    accountId: connection.accountId,
    environmentName: connection.environmentName,
    baseUrl: connection.baseUrl,
    authMode: connection.authMode,
    mode: connection.mode,
    apiUsername: maskValue(decryptForDisplay(connection.apiUsername)),
    apiPassword: "••••••••",
    createdAt: connection.createdAt,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const project = await getWorkspaceProject(searchParams.get("projectId") ?? undefined);
  const connections = project.boomiConnections.map(connectionResponse);

  return NextResponse.json({ connections });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { projectId, ...connectionInput } = body;
  const validation = boomiConnectionSchema.safeParse(connectionInput);

  if (!validation.success) {
    const flattened = validation.error.flatten();
    const messages = [
      ...flattened.formErrors,
      ...Object.entries(flattened.fieldErrors).map(([field, errs]) => `${field}: ${errs.join(", ")}`),
    ];
    return NextResponse.json({ error: messages.join("; ") || "Invalid connection payload." }, { status: 400 });
  }

  const input = validation.data;
  const project = await getWorkspaceProject(projectId);

  const newConnection = {
    id: randomUUID(),
    accountId: input.accountId,
    environmentName: input.environmentName,
    baseUrl: input.baseUrl,
    authMode: input.authMode,
    apiUsername: encryptValue(input.apiUsername),
    apiPassword: encryptValue(input.apiPassword),
    mode: input.mode,
    createdAt: new Date().toISOString(),
  };

  project.boomiConnections.push(newConnection);
  await updateWorkspaceProject(project);

  return NextResponse.json({
    connection: connectionResponse(newConnection),
  });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body." }, { status: 400 });

  const { id, projectId, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "Connection ID is required." }, { status: 400 });
  }
  // M8 follow-up: previously this route called `getWorkspaceProject()` with no
  // projectId, which silently fell through to "most recently updated project".
  // If two projects each have their own connection rows, a PUT without a
  // projectId could land on the wrong project. Require the caller to be explicit.
  if (typeof projectId !== "string" || projectId.trim().length === 0) {
    return NextResponse.json(
      { error: "projectId is required so connection edits land on the right project." },
      { status: 400 },
    );
  }

  // Allowlist valid update fields
  const allowedFields = ["accountId", "environmentName", "baseUrl", "authMode", "apiUsername", "apiPassword", "mode"] as const;
  const filtered: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in updates) filtered[key] = updates[key];
  }
  if (Object.keys(filtered).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  const validation = boomiConnectionSchema.partial().safeParse(filtered);
  if (!validation.success) {
    const messages = validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return NextResponse.json({ error: messages }, { status: 400 });
  }

  const project = await getWorkspaceProject(projectId);
  const index = project.boomiConnections.findIndex((conn) => conn.id === id);

  if (index === -1) {
    return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  }

  const existing = project.boomiConnections[index];

  const safe: Record<string, string> = {};
  if (validation.data.apiUsername) safe.apiUsername = encryptValue(validation.data.apiUsername);
  if (validation.data.apiPassword) safe.apiPassword = encryptValue(validation.data.apiPassword);

  project.boomiConnections[index] = { ...existing, ...validation.data, ...safe };
  await updateWorkspaceProject(project);

  return NextResponse.json({
    connection: connectionResponse(project.boomiConnections[index]),
  });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const projectId = searchParams.get("projectId") ?? undefined;

  if (!id) {
    return NextResponse.json({ error: "Connection ID is required." }, { status: 400 });
  }

  const project = await getWorkspaceProject(projectId);
  const filtered = project.boomiConnections.filter((conn) => conn.id !== id);

  if (filtered.length === project.boomiConnections.length) {
    return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  }

  project.boomiConnections = filtered;
  await updateWorkspaceProject(project);

  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, projectId } = body;

  if (!id) {
    return NextResponse.json({ error: "Connection ID is required." }, { status: 400 });
  }

  const project = await getWorkspaceProject(projectId);
  const connection = project.boomiConnections.find((conn) => conn.id === id);

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
    const result = await testBoomiConnection(decryptedConnection);
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: "Connection test failed", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
