import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getBoomiBuildPackage } from "@/lib/boomi-companion-mutations";
import { areScriptsVendored } from "@/lib/boomi-bridge-pipeline";
import { createCompanionV3Preflight } from "@/lib/boomi-companion-v3";
import { testBoomiConnection } from "@/lib/boomi-sandbox";
import { decryptValue, encryptValue } from "@/lib/boomi-crypto";
import { logger } from "@/lib/logger";
import type { BoomiBuildSpec } from "@/lib/domain";

function tryDecrypt(value: string): string {
  if (!value) return "";
  if (!value.includes(":")) return value;
  return decryptValue(value);
}

async function ensureConnectionEncrypted(id: string, username: string, password: string) {
  const needsEncryption = !username.includes(":") || !password.includes(":");
  if (!needsEncryption) return;
  try {
    await prisma.boomiConnection.update({
      where: { id },
      data: {
        apiUsername: username.includes(":") ? username : encryptValue(username),
        apiPassword: password.includes(":") ? password : encryptValue(password),
      },
    });
  } catch (err) {
    logger.warn("Failed to re-encrypt connection credentials", undefined, err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ packageId: string }> },
) {
  try {
    const { packageId } = await params;
    const body = await request.json().catch(() => ({})) as {
      connectionId?: string;
      keepWorkspace?: boolean;
    };

    const pkg = await getBoomiBuildPackage(packageId);
    if (!pkg) {
      return NextResponse.json({ error: "Package not found." }, { status: 404 });
    }

    if (!body.connectionId) {
      return NextResponse.json(
        {
          error: "No Boomi connection configured.",
          detail: "Select a Boomi connection before running v3 preflight.",
        },
        { status: 400 },
      );
    }

    if (!areScriptsVendored()) {
      return NextResponse.json(
        {
          error: "Companion scripts are not installed.",
          detail: "Run 'npm run companion:setup' to download the Companion scripts, then try again.",
        },
        { status: 400 },
      );
    }

    const connRow = await prisma.boomiConnection.findFirst({
      where: { id: body.connectionId },
    });

    if (!connRow) {
      return NextResponse.json({ error: "Boomi connection not found." }, { status: 400 });
    }

    if (connRow.mode === "mock") {
      return NextResponse.json(
        {
          error: "Cannot run v3 Companion preflight with a mock connection.",
          detail: "Create a sandbox connection with real Boomi credentials before running Companion.",
        },
        { status: 400 },
      );
    }

    let spec: BoomiBuildSpec;
    try {
      spec = JSON.parse(pkg.specJson) as BoomiBuildSpec;
    } catch {
      return NextResponse.json({ error: "Package spec is invalid JSON." }, { status: 500 });
    }

    let decryptedApiUsername: string;
    let decryptedApiToken: string;
    try {
      decryptedApiUsername = tryDecrypt(connRow.apiUsername);
      decryptedApiToken = tryDecrypt(connRow.apiPassword);
    } catch (err) {
      logger.error("Credential decryption failed for connection", undefined, err);
      return NextResponse.json(
        {
          error: "Failed to decrypt Boomi credentials.",
          detail: "Re-create the connection in the Companion tab.",
        },
        { status: 400 },
      );
    }

    ensureConnectionEncrypted(connRow.id, connRow.apiUsername, connRow.apiPassword).catch(() => {});

    const connectionTest = await testBoomiConnection({
      accountId: connRow.accountId,
      environmentName: connRow.environmentName,
      baseUrl: connRow.baseUrl,
      apiUsername: decryptedApiUsername,
      apiPassword: decryptedApiToken,
      mode: connRow.mode as "mock" | "sandbox",
      authMode: "Basic API Token",
    });

    if (!connectionTest.ok) {
      return NextResponse.json(
        {
          error: "Boomi connection test failed.",
          detail: connectionTest.message,
        },
        { status: 400 },
      );
    }

    const plan = await createCompanionV3Preflight({
      packageId,
      projectId: pkg.projectId,
      spec,
      connection: {
        id: connRow.id,
        accountId: connRow.accountId,
        environmentName: connRow.environmentName,
        baseUrl: connRow.baseUrl,
        authMode: "Basic API Token",
        apiUsername: connRow.apiUsername,
        apiPassword: connRow.apiPassword,
        mode: connRow.mode as "mock" | "sandbox",
        createdAt: connRow.createdAt.toISOString(),
        decryptedApiUsername,
        decryptedApiToken,
      },
      keepWorkspace: body.keepWorkspace === true,
      availableComponents: connectionTest.availableComponents,
    });

    return NextResponse.json({
      packageId,
      runId: plan.runId,
      status: plan.status,
      plan,
      eventsUrl: `/api/boomi/companion/packages/${packageId}/run/v3/events?runId=${encodeURIComponent(plan.runId)}`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to run Companion v3 preflight.",
        detail: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    );
  }
}
