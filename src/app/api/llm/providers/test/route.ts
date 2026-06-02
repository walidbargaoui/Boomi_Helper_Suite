import { NextRequest, NextResponse } from "next/server";
import {
  llmProviderInputSchema,
  llmProviderUpdateSchema,
  loadLlmProviderRuntime,
  normalizeLlmBaseUrl,
  testLlmProviderConfig,
  type LlmProviderRuntimeConfig,
} from "@/lib/llm-providers";

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body." }, { status: 400 });

  try {
    const config = await runtimeFromBody(body);
    const result = await testLlmProviderConfig(config);
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: "LLM provider test failed", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

async function runtimeFromBody(body: Record<string, unknown>): Promise<LlmProviderRuntimeConfig> {
  if (typeof body.id === "string" && Object.keys(body).length === 1) {
    const existing = await loadLlmProviderRuntime(body.id);
    if (!existing) throw new Error("LLM provider not found.");
    return existing;
  }

  if (typeof body.id === "string") {
    const validation = llmProviderUpdateSchema.safeParse(body);
    if (!validation.success) throw new Error(validation.error.issues.map((issue) => issue.message).join("; "));
    const existing = await loadLlmProviderRuntime(validation.data.id);
    if (!existing) throw new Error("LLM provider not found.");
    const input = validation.data;
    return {
      ...existing,
      name: input.name ?? existing.name,
      type: input.type ?? existing.type,
      baseUrl: input.baseUrl ? normalizeLlmBaseUrl(input.baseUrl) : existing.baseUrl,
      model: input.model ?? existing.model,
      authMode: input.authMode ?? existing.authMode,
      apiKey: input.clearApiKey ? undefined : input.apiKey?.trim() || existing.apiKey,
      enabled: input.enabled ?? existing.enabled,
      isDefault: input.isDefault ?? existing.isDefault,
      temperature: input.temperature ?? existing.temperature,
      topP: input.topP ?? existing.topP,
      maxTokens: input.maxTokens ?? existing.maxTokens,
      timeoutMs: input.timeoutMs ?? existing.timeoutMs,
      supportsJsonSchema: input.supportsJsonSchema ?? existing.supportsJsonSchema,
      supportsModelList: input.supportsModelList ?? existing.supportsModelList,
      source: "explicit",
    };
  }

  const validation = llmProviderInputSchema.safeParse(body);
  if (!validation.success) throw new Error(validation.error.issues.map((issue) => issue.message).join("; "));
  const input = validation.data;
  return {
    name: input.name,
    type: input.type,
    baseUrl: normalizeLlmBaseUrl(input.baseUrl),
    model: input.model,
    authMode: input.authMode,
    apiKey: input.apiKey?.trim() || undefined,
    enabled: input.enabled,
    isDefault: input.isDefault,
    temperature: input.temperature,
    topP: input.topP,
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
    supportsJsonSchema: input.supportsJsonSchema,
    supportsModelList: input.supportsModelList,
    source: "explicit",
  };
}
