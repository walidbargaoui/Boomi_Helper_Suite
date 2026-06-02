import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getBoomiBuildPackage } from "@/lib/boomi-companion-mutations";
import { runBuildPipeline, areScriptsVendored } from "@/lib/boomi-bridge-pipeline";
import { testBoomiConnection } from "@/lib/boomi-sandbox";
import { decryptValue, encryptValue } from "@/lib/boomi-crypto";
import { logger } from "@/lib/logger";
import type { BoomiBuildSpec } from "@/lib/domain";

function tryDecrypt(value: string): string {
  if (!value) return "";
  if (!value.includes(":")) {
    return value;
  }
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
    const url = new URL(request.url);
    const approveDeploy = url.searchParams.get("approveDeploy") === "true";
    const keepWorkspace = url.searchParams.get("keepWorkspace") === "true";

    let body: { connectionId?: string } = {};
    try {
      body = await request.json().catch(() => ({}));
    } catch {
      // body is optional; use first available connection
    }

    const pkg = await getBoomiBuildPackage(packageId);
    if (!pkg) {
      return NextResponse.json({ error: "Package not found." }, { status: 404 });
    }

    let spec: BoomiBuildSpec;
    try {
      spec = JSON.parse(pkg.specJson) as BoomiBuildSpec;
    } catch {
      return NextResponse.json(
        { error: "Package spec is invalid JSON." },
        { status: 500 },
      );
    }

    const connectionId = body.connectionId;
    if (!connectionId) {
      return NextResponse.json(
        {
          error: "No Boomi connection configured.",
          detail:
            "Select a Boomi connection in the Companion tab before running.",
        },
        { status: 400 },
      );
    }

    const connRow = await prisma.boomiConnection.findFirst({
      where: { id: connectionId },
    });

    if (!connRow) {
      return NextResponse.json(
        { error: "Boomi connection not found." },
        { status: 400 },
      );
    }

    let decryptedApiUsername: string;
    let decryptedApiToken: string;
    try {
      decryptedApiUsername = tryDecrypt(connRow.apiUsername);
      decryptedApiToken = tryDecrypt(connRow.apiPassword);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Credential decryption failed for connection", undefined, err);
      return NextResponse.json(
        {
          error: "Failed to decrypt Boomi credentials.",
          detail: `Decryption error: ${message}. Re-create the connection in the Companion tab.`,
        },
        { status: 400 },
      );
    }

    ensureConnectionEncrypted(
      connRow.id,
      connRow.apiUsername,
      connRow.apiPassword,
    ).catch(() => {});

    if (connRow.mode === "mock") {
      return NextResponse.json(
        {
          error: "Cannot run pipeline with a mock connection.",
          detail:
            `Connection "${connRow.environmentName}" is in mock mode. ` +
            "Create a sandbox connection with real Boomi credentials to run the build pipeline. " +
            "The mock connection cannot make API calls to create components.",
        },
        { status: 400 },
      );
    }

    if (!areScriptsVendored()) {
      return NextResponse.json(
        {
          error: "Companion scripts are not installed.",
          detail:
            "Run 'npm run companion:setup' to download the Companion scripts from GitHub, then try again.",
        },
        { status: 400 },
      );
    }

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
          detail:
            connectionTest.message ??
            `Could not reach Boomi API at ${connRow.baseUrl} for account ${connRow.accountId}. Check your credentials and network.`,
        },
        { status: 400 },
      );
    }

    const connection = {
      id: connRow.id,
      accountId: connRow.accountId,
      environmentName: connRow.environmentName,
      baseUrl: connRow.baseUrl,
      authMode: "Basic API Token" as const,
      apiUsername: connRow.apiUsername,
      apiPassword: connRow.apiPassword,
      mode: connRow.mode as "mock" | "sandbox",
      createdAt: connRow.createdAt.toISOString(),
      decryptedApiUsername,
      decryptedApiToken,
    };

    runBuildPipeline({
      packageId,
      spec,
      connection,
      approveDeploy,
      keepWorkspace,
      availableComponents: connectionTest.availableComponents,
    }).catch(() => {
      // errors are emitted via SSE; no additional handling needed
    });

    return NextResponse.json({
      packageId,
      status: "running",
      eventsUrl: `/api/boomi/companion/packages/${packageId}/run/events`,
      message:
        `Build pipeline started. Connection to ${connRow.environmentName} (${connRow.accountId}) verified. ` +
        `${connectionTest.availableComponents ?? 0} existing components found in account.`,
      connectionTest: {
        ok: connectionTest.ok,
        accountId: connectionTest.accountId,
        environmentName: connectionTest.environmentName,
        availableComponents: connectionTest.availableComponents,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to start Companion run.",
        detail: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    );
  }
}
