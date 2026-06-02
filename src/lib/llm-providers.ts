import { z } from "zod";
import { prisma } from "@/lib/db";
import { decryptValue, encryptValue } from "@/lib/boomi-crypto";
import type { LlmProvider, LlmProviderAuthMode, LlmProviderType } from "@/lib/domain";

const defaultOllamaModel = "qwen3:8b";
const defaultOllamaBaseUrl = "http://localhost:11434";
const defaultLmStudioBaseUrl = "http://localhost:1234/v1";

export const llmProviderTypeSchema = z.enum(["ollama", "openai-compatible"]);
export const llmProviderAuthModeSchema = z.enum(["none", "optional", "required"]);

export const llmProviderInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: llmProviderTypeSchema,
  baseUrl: z.string().trim().min(1).max(600),
  model: z.string().trim().min(1).max(200),
  authMode: llmProviderAuthModeSchema.default("optional"),
  apiKey: z.string().max(4000).optional(),
  clearApiKey: z.boolean().optional(),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  temperature: z.coerce.number().min(0).max(2).default(0),
  topP: z.coerce.number().min(0).max(1).default(0.2),
  maxTokens: z.coerce.number().int().min(1).max(100000).default(4000),
  timeoutMs: z.coerce.number().int().min(1000).max(600000).default(120000),
  supportsJsonSchema: z.boolean().default(true),
  supportsModelList: z.boolean().default(true),
});

export const llmProviderUpdateSchema = llmProviderInputSchema.partial().extend({
  id: z.string().min(1),
});

export type LlmProviderInput = z.infer<typeof llmProviderInputSchema>;
export type LlmProviderUpdateInput = z.infer<typeof llmProviderUpdateSchema>;

export type LlmProviderRuntimeConfig = {
  id?: string;
  name: string;
  type: LlmProviderType;
  baseUrl: string;
  model: string;
  authMode: LlmProviderAuthMode;
  apiKey?: string;
  enabled: boolean;
  isDefault: boolean;
  temperature: number;
  topP: number;
  maxTokens: number;
  timeoutMs: number;
  supportsJsonSchema: boolean;
  supportsModelList: boolean;
  source: "db" | "env" | "explicit";
};

export type LlmProviderOverride = {
  providerId?: string;
  providerType?: LlmProviderType;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
};

export type LlmChatProvider = LlmProviderRuntimeConfig & {
  chat: (input: { pass: string; systemPrompt: string; prompt: string; schema: object }) => Promise<string>;
  listModels: () => Promise<string[]>;
};

type LlmProviderRow = {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  model: string;
  authMode: string;
  apiKeyEncrypted: string | null;
  enabled: boolean;
  isDefault: boolean;
  temperature: number;
  topP: number;
  maxTokens: number;
  timeoutMs: number;
  supportsJsonSchema: boolean;
  supportsModelList: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export function normalizeLlmBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function llmProviderResponse(row: LlmProviderRow): LlmProvider {
  const hasApiKey = Boolean(row.apiKeyEncrypted);
  return {
    id: row.id,
    name: row.name,
    type: normalizeProviderType(row.type),
    baseUrl: row.baseUrl,
    model: row.model,
    authMode: normalizeAuthMode(row.authMode),
    apiKey: hasApiKey ? "••••••••" : "",
    hasApiKey,
    enabled: row.enabled,
    isDefault: row.isDefault,
    temperature: row.temperature,
    topP: row.topP,
    maxTokens: row.maxTokens,
    timeoutMs: row.timeoutMs,
    supportsJsonSchema: row.supportsJsonSchema,
    supportsModelList: row.supportsModelList,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export async function listLlmProviders(): Promise<LlmProvider[]> {
  const rows = await prisma.llmProvider.findMany({
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(llmProviderResponse);
}

export async function loadLlmProviderRuntime(id: string): Promise<LlmProviderRuntimeConfig | null> {
  const row = await prisma.llmProvider.findUnique({ where: { id } });
  if (!row) return null;
  return runtimeFromRow(row);
}

export async function getConfiguredLlmProvider(
  override: LlmProviderOverride = {},
): Promise<LlmProviderRuntimeConfig> {
  if (override.providerId) {
    const selected = await loadLlmProviderRuntime(override.providerId);
    if (!selected) throw new Error("Selected LLM provider not found.");
    return applyRuntimeOverride(selected, override);
  }

  if (override.providerType || override.baseUrl || override.model || override.apiKey) {
    const explicit = explicitProviderFromOverride(override);
    return explicit;
  }

  const row = await prisma.llmProvider.findFirst({
    where: { enabled: true, isDefault: true },
    orderBy: [{ updatedAt: "desc" }],
  }) ?? await prisma.llmProvider.findFirst({
    where: { enabled: true },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  if (row) return runtimeFromRow(row);

  return providerFromEnv();
}

export function createLlmChatProvider(config: LlmProviderRuntimeConfig): LlmChatProvider {
  const base = { ...config, baseUrl: normalizeLlmBaseUrl(config.baseUrl) };
  if (base.type === "ollama") return createOllamaChatProvider(base);
  return createOpenAiCompatibleChatProvider(base);
}

export async function testLlmProviderConfig(config: LlmProviderRuntimeConfig): Promise<{
  ok: boolean;
  message: string;
  models: string[];
}> {
  const provider = createLlmChatProvider(config);
  const models = await provider.listModels();
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean" },
      message: { type: "string" },
    },
    required: ["ok", "message"],
  };
  const content = await provider.chat({
    pass: "provider_test",
    systemPrompt: "Return only JSON matching the provided schema.",
    prompt: "Return {\"ok\": true, \"message\": \"ready\"}.",
    schema,
  });
  const parsed = parseJsonObject(content);
  const probe = z.object({ ok: z.boolean(), message: z.string() }).safeParse(parsed);
  if (!probe.success || !probe.data.ok) {
    throw new Error("Structured output probe did not return the expected JSON object.");
  }
  return {
    ok: true,
    message: `Connected to ${config.name} with model ${config.model}.`,
    models,
  };
}

export function buildCreateData(input: LlmProviderInput) {
  return {
    name: input.name,
    type: input.type,
    baseUrl: normalizeLlmBaseUrl(input.baseUrl),
    model: input.model,
    authMode: input.authMode,
    apiKeyEncrypted: input.apiKey?.trim() ? encryptValue(input.apiKey.trim()) : null,
    enabled: input.enabled,
    isDefault: input.isDefault,
    temperature: input.temperature,
    topP: input.topP,
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
    supportsJsonSchema: input.supportsJsonSchema,
    supportsModelList: input.supportsModelList,
  };
}

export function buildUpdateData(input: LlmProviderUpdateInput) {
  const data: Record<string, unknown> = {};
  const fields: Array<keyof LlmProviderInput> = [
    "name",
    "type",
    "baseUrl",
    "model",
    "authMode",
    "enabled",
    "isDefault",
    "temperature",
    "topP",
    "maxTokens",
    "timeoutMs",
    "supportsJsonSchema",
    "supportsModelList",
  ];
  for (const field of fields) {
    if (!(field in input)) continue;
    data[field] = field === "baseUrl" && typeof input.baseUrl === "string" ? normalizeLlmBaseUrl(input.baseUrl) : input[field];
  }
  if (input.clearApiKey) data.apiKeyEncrypted = null;
  if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    data.apiKeyEncrypted = encryptValue(input.apiKey.trim());
  }
  return data;
}

export function validateProviderAuth(input: Pick<LlmProviderInput, "type" | "authMode" | "apiKey" | "baseUrl">, existingHasKey = false) {
  if (input.type !== "openai-compatible") return;
  const requiresKey = input.authMode === "required" || (input.authMode !== "none" && !isLocalLlmBaseUrl(input.baseUrl));
  if (!requiresKey) return;
  const hasKey = Boolean(input.apiKey?.trim()) || existingHasKey;
  if (!hasKey) {
    throw new Error("API key is required for this provider unless auth is explicitly set to none.");
  }
}

function createOllamaChatProvider(config: LlmProviderRuntimeConfig): LlmChatProvider {
  return {
    ...config,
    async listModels() {
      if (!config.supportsModelList) return [];
      const response = await fetch(`${config.baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(Math.min(config.timeoutMs, 10000)),
      });
      if (!response.ok) throw new Error(`Ollama model list returned HTTP ${response.status}.`);
      const payload = (await response.json()) as { models?: Array<{ name?: string }> };
      return (payload.models ?? []).map((model) => model.name).filter((name): name is string => Boolean(name));
    },
    async chat(input) {
      const response = await fetch(`${config.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          stream: false,
          format: input.schema,
          think: false,
          options: {
            temperature: config.temperature,
            top_p: config.topP,
            num_ctx: 8192,
            num_predict: config.maxTokens,
          },
          messages: [
            { role: "system", content: input.systemPrompt },
            { role: "user", content: input.prompt },
          ],
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status} on pass "${input.pass}".`);
      const payload = (await response.json()) as { message?: { content?: string }; response?: string };
      const content = payload.message?.content ?? payload.response ?? "";
      if (!content.trim()) throw new Error(`Empty response on pass "${input.pass}".`);
      return content;
    },
  };
}

function createOpenAiCompatibleChatProvider(config: LlmProviderRuntimeConfig): LlmChatProvider {
  const authHeaders: Record<string, string> = config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};
  return {
    ...config,
    async listModels() {
      if (!config.supportsModelList) return [];
      const response = await fetch(`${config.baseUrl}/models`, {
        method: "GET",
        headers: authHeaders,
        signal: AbortSignal.timeout(Math.min(config.timeoutMs, 10000)),
      });
      if (!response.ok) throw new Error(`Model list returned HTTP ${response.status}.`);
      const payload = (await response.json()) as { data?: Array<{ id?: string }> };
      return (payload.data ?? []).map((model) => model.id).filter((id): id is string => Boolean(id));
    },
    async chat(input) {
      const responseFormat = config.supportsJsonSchema
        ? {
            type: "json_schema",
            json_schema: {
              name: schemaName(input.pass),
              strict: true,
              schema: input.schema,
            },
          }
        : { type: "json_object" };
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          model: config.model,
          stream: false,
          temperature: config.temperature,
          top_p: config.topP,
          max_tokens: config.maxTokens,
          response_format: responseFormat,
          messages: [
            { role: "system", content: input.systemPrompt },
            { role: "user", content: input.prompt },
          ],
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      if (!response.ok) throw new Error(`OpenAI-compatible provider returned HTTP ${response.status} on pass "${input.pass}".`);
      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> };
      const message = payload.choices?.[0]?.message;
      const content = message?.content || message?.reasoning_content || "";
      if (!content.trim()) throw new Error(`Empty response on pass "${input.pass}".`);
      return content;
    },
  };
}

function runtimeFromRow(row: LlmProviderRow): LlmProviderRuntimeConfig {
  return {
    id: row.id,
    name: row.name,
    type: normalizeProviderType(row.type),
    baseUrl: normalizeLlmBaseUrl(row.baseUrl),
    model: row.model,
    authMode: normalizeAuthMode(row.authMode),
    apiKey: decryptApiKey(row.apiKeyEncrypted),
    enabled: row.enabled,
    isDefault: row.isDefault,
    temperature: row.temperature,
    topP: row.topP,
    maxTokens: row.maxTokens,
    timeoutMs: row.timeoutMs,
    supportsJsonSchema: row.supportsJsonSchema,
    supportsModelList: row.supportsModelList,
    source: "db",
  };
}

function explicitProviderFromOverride(override: LlmProviderOverride): LlmProviderRuntimeConfig {
  const type = override.providerType ?? "ollama";
  return {
    name: "Request override",
    type,
    baseUrl: normalizeLlmBaseUrl(override.baseUrl ?? (type === "ollama" ? defaultOllamaBaseUrl : defaultLmStudioBaseUrl)),
    model: override.model ?? (type === "ollama" ? defaultOllamaModel : "local-model"),
    authMode: override.apiKey ? "required" : "optional",
    apiKey: override.apiKey,
    enabled: true,
    isDefault: false,
    temperature: 0,
    topP: 0.2,
    maxTokens: 4000,
    timeoutMs: override.timeoutMs ?? 120000,
    supportsJsonSchema: true,
    supportsModelList: true,
    source: "explicit",
  };
}

function providerFromEnv(): LlmProviderRuntimeConfig {
  const genericType = process.env.BOOMI_HELPER_LLM_TYPE as LlmProviderType | undefined;
  const genericBaseUrl = process.env.BOOMI_HELPER_LLM_BASE_URL;
  const genericModel = process.env.BOOMI_HELPER_LLM_MODEL;
  const genericApiKey = process.env.BOOMI_HELPER_LLM_API_KEY;
  if (genericType || genericBaseUrl || genericModel || genericApiKey) {
    const type = llmProviderTypeSchema.safeParse(genericType).success ? genericType! : "openai-compatible";
    return {
      name: "Environment LLM",
      type,
      baseUrl: normalizeLlmBaseUrl(genericBaseUrl ?? (type === "ollama" ? defaultOllamaBaseUrl : defaultLmStudioBaseUrl)),
      model: genericModel ?? (type === "ollama" ? defaultOllamaModel : "local-model"),
      authMode: genericApiKey ? "required" : "optional",
      apiKey: genericApiKey,
      enabled: true,
      isDefault: false,
      temperature: Number(process.env.BOOMI_HELPER_LLM_TEMPERATURE ?? 0),
      topP: Number(process.env.BOOMI_HELPER_LLM_TOP_P ?? 0.2),
      maxTokens: Number(process.env.BOOMI_HELPER_LLM_MAX_TOKENS ?? 4000),
      timeoutMs: Number(process.env.BOOMI_HELPER_LLM_TIMEOUT_MS ?? 120000),
      supportsJsonSchema: process.env.BOOMI_HELPER_LLM_JSON_SCHEMA !== "0",
      supportsModelList: process.env.BOOMI_HELPER_LLM_MODEL_LIST !== "0",
      source: "env",
    };
  }

  return {
    name: "Ollama",
    type: "ollama",
    baseUrl: normalizeLlmBaseUrl(process.env.BOOMI_HELPER_OLLAMA_URL ?? defaultOllamaBaseUrl),
    model: process.env.BOOMI_HELPER_OLLAMA_MODEL ?? defaultOllamaModel,
    authMode: "none",
    enabled: true,
    isDefault: false,
    temperature: 0,
    topP: 0.2,
    maxTokens: 4000,
    timeoutMs: Number(process.env.BOOMI_HELPER_OLLAMA_TIMEOUT_MS ?? 120000),
    supportsJsonSchema: true,
    supportsModelList: true,
    source: "env",
  };
}

function applyRuntimeOverride(
  base: LlmProviderRuntimeConfig,
  override: LlmProviderOverride,
): LlmProviderRuntimeConfig {
  return {
    ...base,
    baseUrl: override.baseUrl ? normalizeLlmBaseUrl(override.baseUrl) : base.baseUrl,
    model: override.model ?? base.model,
    apiKey: override.apiKey ?? base.apiKey,
    timeoutMs: override.timeoutMs ?? base.timeoutMs,
  };
}

function decryptApiKey(value: string | null) {
  if (!value) return undefined;
  try {
    return decryptValue(value);
  } catch {
    throw new Error("Stored LLM API key could not be decrypted. Re-enter the provider API key.");
  }
}

function normalizeProviderType(value: string): LlmProviderType {
  return value === "ollama" ? "ollama" : "openai-compatible";
}

function normalizeAuthMode(value: string): LlmProviderAuthMode {
  if (value === "none" || value === "required") return value;
  return "optional";
}

function isLocalLlmBaseUrl(baseUrl: string) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function schemaName(pass: string) {
  const safe = pass.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+/, "");
  return `fmd_${safe || "resolver"}`;
}

function toIso(value: string | Date) {
  return typeof value === "string" ? value : value.toISOString();
}

function parseJsonObject(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    const first = content.indexOf("{");
    const last = content.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) {
      throw new Error("No JSON object found in provider output.");
    }
    return JSON.parse(content.slice(first, last + 1));
  }
}
