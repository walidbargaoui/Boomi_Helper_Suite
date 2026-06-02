import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  buildCreateData,
  buildUpdateData,
  listLlmProviders,
  llmProviderAuthModeSchema,
  llmProviderInputSchema,
  llmProviderResponse,
  llmProviderTypeSchema,
  llmProviderUpdateSchema,
  validateProviderAuth,
} from "@/lib/llm-providers";

export async function GET() {
  const providers = await listLlmProviders();
  return NextResponse.json({ providers });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body." }, { status: 400 });

  const validation = llmProviderInputSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: formatZodError(validation.error) }, { status: 400 });
  }

  const input = validation.data;
  try {
    validateProviderAuth(input, false);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid auth configuration." }, { status: 400 });
  }

  const existingCount = await prisma.llmProvider.count();
  const shouldBeDefault = input.isDefault || existingCount === 0;
  const data = buildCreateData({ ...input, isDefault: shouldBeDefault, enabled: shouldBeDefault ? true : input.enabled });

  const created = await prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.llmProvider.updateMany({ data: { isDefault: false } });
    }
    return tx.llmProvider.create({ data });
  });

  return NextResponse.json({ provider: llmProviderResponse(created) });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body." }, { status: 400 });

  const validation = llmProviderUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: formatZodError(validation.error) }, { status: 400 });
  }

  const input = validation.data;
  const existing = await prisma.llmProvider.findUnique({ where: { id: input.id } });
  if (!existing) return NextResponse.json({ error: "LLM provider not found." }, { status: 404 });

  const mergedAuth = {
    type: input.type ?? llmProviderTypeSchema.parse(existing.type),
    authMode: input.authMode ?? llmProviderAuthModeSchema.parse(existing.authMode),
    apiKey: input.clearApiKey ? undefined : input.apiKey,
    baseUrl: input.baseUrl ?? existing.baseUrl,
  };

  try {
    validateProviderAuth(mergedAuth, input.clearApiKey ? false : Boolean(existing.apiKeyEncrypted));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid auth configuration." }, { status: 400 });
  }

  const data = buildUpdateData(input);
  delete data.id;
  if (input.isDefault) data.enabled = true;
  if (input.enabled === false) data.isDefault = false;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (data.isDefault === true) {
      await tx.llmProvider.updateMany({ where: { id: { not: input.id } }, data: { isDefault: false } });
    }
    const row = await tx.llmProvider.update({ where: { id: input.id }, data });
    if (existing.isDefault && row.isDefault === false) {
      const replacement = await tx.llmProvider.findFirst({
        where: { enabled: true, id: { not: input.id } },
        orderBy: [{ updatedAt: "desc" }],
      });
      if (replacement) {
        await tx.llmProvider.update({ where: { id: replacement.id }, data: { isDefault: true } });
      }
    }
    return tx.llmProvider.findUniqueOrThrow({ where: { id: input.id } });
  });

  return NextResponse.json({ provider: llmProviderResponse(updated) });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "LLM provider ID is required." }, { status: 400 });

  const existing = await prisma.llmProvider.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "LLM provider not found." }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.llmProvider.delete({ where: { id } });
    if (existing.isDefault) {
      const replacement = await tx.llmProvider.findFirst({
        where: { enabled: true },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      });
      if (replacement) {
        await tx.llmProvider.update({ where: { id: replacement.id }, data: { isDefault: true } });
      }
    }
  });

  return NextResponse.json({ success: true });
}

function formatZodError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
}
