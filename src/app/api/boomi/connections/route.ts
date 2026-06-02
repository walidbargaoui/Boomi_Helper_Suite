import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encryptValue, decryptValue, maskValue } from "@/lib/boomi-crypto";
import { boomiConnectionSchema, testBoomiConnection, type BoomiConnectionInput } from "@/lib/boomi-sandbox";

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
  createdAt: string | Date;
}) {
  const username = decryptForDisplay(connection.apiUsername);
  return {
    id: connection.id,
    accountId: connection.accountId,
    environmentName: connection.environmentName,
    baseUrl: connection.baseUrl,
    authMode: connection.authMode,
    mode: connection.mode,
    apiUsername: username === "[re-enter credentials]" ? username : maskValue(username),
    apiPassword: "••••••••",
    createdAt: typeof connection.createdAt === "string" ? connection.createdAt : connection.createdAt.toISOString(),
  };
}

export async function GET() {
  // `projectId` is intentionally ignored for backward-compatible callers.
  const rows = await prisma.boomiConnection.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });
  const connections = rows.map((row) => connectionResponse({
    ...row,
    authMode: row.authMode as "Basic API Token",
    mode: row.mode as "mock" | "sandbox",
  }));

  return NextResponse.json({ connections });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const connectionInput = { ...body };
  delete connectionInput.projectId;
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
  const newConnection = await prisma.boomiConnection.create({
    data: {
      accountId: input.accountId,
      environmentName: input.environmentName,
      baseUrl: input.baseUrl,
      authMode: input.authMode,
      apiUsername: encryptValue(input.apiUsername),
      apiPassword: encryptValue(input.apiPassword),
      mode: input.mode,
    },
  });

  return NextResponse.json({
    connection: connectionResponse({
      ...newConnection,
      authMode: newConnection.authMode as "Basic API Token",
      mode: newConnection.mode as "mock" | "sandbox",
    }),
  });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body." }, { status: 400 });

  const { id, ...updates } = body;
  delete updates.projectId;

  if (!id) {
    return NextResponse.json({ error: "Connection ID is required." }, { status: 400 });
  }
  // Allowlist valid update fields
  const allowedFields = ["accountId", "environmentName", "baseUrl", "authMode", "apiUsername", "apiPassword", "mode"] as const;
  const filtered: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (!(key in updates)) continue;
    const value = updates[key];
    if ((key === "apiUsername" || key === "apiPassword") && typeof value === "string" && value.trim().length === 0) {
      continue;
    }
    filtered[key] = value;
  }
  if (Object.keys(filtered).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  const validation = boomiConnectionSchema.partial().safeParse(filtered);
  if (!validation.success) {
    const messages = validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return NextResponse.json({ error: messages }, { status: 400 });
  }

  const existing = await prisma.boomiConnection.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  }

  const safe: Record<string, string> = {};
  const validatedUpdates = { ...validation.data };
  for (const key of allowedFields) {
    if (!(key in filtered)) {
      delete validatedUpdates[key];
    }
  }
  if (validatedUpdates.apiUsername) safe.apiUsername = encryptValue(validatedUpdates.apiUsername);
  if (validatedUpdates.apiPassword) safe.apiPassword = encryptValue(validatedUpdates.apiPassword);
  const plainUpdates = { ...validatedUpdates };
  delete plainUpdates.apiUsername;
  delete plainUpdates.apiPassword;

  const updated = await prisma.boomiConnection.update({
    where: { id },
    data: { ...plainUpdates, ...safe },
  });

  return NextResponse.json({
    connection: connectionResponse({
      ...updated,
      authMode: updated.authMode as "Basic API Token",
      mode: updated.mode as "mock" | "sandbox",
    }),
  });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Connection ID is required." }, { status: 400 });
  }

  const existing = await prisma.boomiConnection.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  }

  await prisma.boomiConnection.delete({ where: { id } });

  return NextResponse.json({ success: true });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: "Connection ID is required." }, { status: 400 });
  }

  const row = await prisma.boomiConnection.findUnique({ where: { id } });

  if (!row) {
    return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  }

  const connection = {
    ...row,
    authMode: row.authMode as "Basic API Token",
    mode: row.mode as "mock" | "sandbox",
  };

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
