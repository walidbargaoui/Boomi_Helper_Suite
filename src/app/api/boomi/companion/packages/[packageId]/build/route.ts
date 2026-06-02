import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getBoomiBuildPackage } from "@/lib/boomi-companion-mutations";
import { areScriptsVendored } from "@/lib/boomi-build-pipeline";
import { runBuildPipeline, generateBuildPlan } from "@/lib/boomi-build-pipeline";
import { testBoomiConnection } from "@/lib/boomi-sandbox";
import { decryptValue, encryptValue } from "@/lib/boomi-crypto";
import { logger } from "@/lib/logger";
import type { BoomiBuildSpec, BoomiConnection } from "@/lib/domain";

function tryDecrypt(value: string): string {
  if (!value) return "";
  if (!value.includes(":")) return value;
  try {
    return decryptValue(value);
  } catch {
    return value;
  }
}

async function ensureEncrypted(id: string, username: string, password: string) {
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
      planOnly?: boolean;
    };

    const pkg = await getBoomiBuildPackage(packageId);
    if (!pkg) {
      return NextResponse.json({ error: "Package not found." }, { status: 404 });
    }

    if (!body.connectionId) {
      return NextResponse.json(
        { error: "No Boomi connection configured.", detail: "Select a Boomi connection before building." },
        { status: 400 },
      );
    }

    if (!areScriptsVendored()) {
      return NextResponse.json(
        {
          error: "Companion scripts not installed.",
          detail: "Run 'npm run companion:setup' to download Companion scripts, then try again.",
        },
        { status: 400 },
      );
    }

    const connRow = await prisma.boomiConnection.findFirst({
      where: { id: body.connectionId },
    });
    if (!connRow) {
      return NextResponse.json(
        { error: "Connection not found." },
        { status: 404 },
      );
    }

    if (connRow.mode === "mock") {
      return NextResponse.json(
        { error: "Build requires a sandbox connection, not mock.", detail: "Configure a real Boomi sandbox connection." },
        { status: 400 },
      );
    }

    const decryptedUsername = tryDecrypt(connRow.apiUsername);
    const decryptedPassword = tryDecrypt(connRow.apiPassword);

    const connection: BoomiConnection = {
      id: connRow.id,
      accountId: connRow.accountId,
      environmentName: connRow.environmentName,
      baseUrl: connRow.baseUrl,
      authMode: "Basic API Token",
      apiUsername: decryptedUsername,
      apiPassword: decryptedPassword,
      mode: connRow.mode as "sandbox",
      createdAt: connRow.createdAt.toISOString(),
    };

    const testResult = await testBoomiConnection({
      accountId: connection.accountId,
      environmentName: connection.environmentName,
      baseUrl: connection.baseUrl,
      authMode: "Basic API Token",
      apiUsername: decryptedUsername,
      apiPassword: decryptedPassword,
      mode: "sandbox",
    });

    if (!testResult.ok) {
      return NextResponse.json(
        { error: "Boomi connection test failed.", detail: testResult.message },
        { status: 400 },
      );
    }

    await ensureEncrypted(connRow.id, connRow.apiUsername, connRow.apiPassword);

    let spec: BoomiBuildSpec;
    try {
      spec = JSON.parse(pkg.specJson) as BoomiBuildSpec;
    } catch {
      return NextResponse.json({ error: "Invalid build spec in package." }, { status: 500 });
    }

    // Plan-only mode: return build plan without executing
    if (body.planOnly) {
      const plan = generateBuildPlan(spec);
      return NextResponse.json({
        packageId,
        components: plan.map((item) => ({
          localId: item.localId,
          name: item.name,
          componentType: item.componentType,
          action: item.action,
          phase: item.phase,
          dependsOn: item.dependsOn,
        })),
      });
    }

    const pipelineRun = await prisma.boomiBuildPipelineRun.create({
      data: {
        packageId,
        projectId: pkg.projectId,
        connectionId: connRow.id,
        status: "preflight",
        planJson: "[]",
      },
    });

    // Fire-and-forget pipeline execution
    runBuildPipeline({
      packageId,
      spec,
      connection,
      keepWorkspace: body.keepWorkspace ?? false,
    })
      .then(async (results) => {
        await prisma.boomiBuildPipelineRun
          .update({
            where: { id: pipelineRun.id },
            data: {
              status: "complete",
              resultsJson: JSON.stringify(results),
            },
          })
          .catch(() => {});
      })
      .catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[build-pipeline] Pipeline failed:", msg);
        await prisma.boomiBuildPipelineRun
          .update({
            where: { id: pipelineRun.id },
            data: { status: "failed", resultsJson: JSON.stringify([{ error: msg }]) },
          })
          .catch(() => {});
      });

    return NextResponse.json(
      {
        pipelineRunId: pipelineRun.id,
        packageId,
        status: "building",
        eventsUrl: `/api/boomi/companion/packages/${packageId}/build/events`,
        statusUrl: `/api/boomi/companion/packages/${packageId}/build/status`,
      },
      { status: 202 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Build pipeline failed to start.", detail: msg }, { status: 500 });
  }
}
