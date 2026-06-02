import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLlmChatProvider,
  llmProviderResponse,
  testLlmProviderConfig,
  validateProviderAuth,
  type LlmProviderRuntimeConfig,
} from "@/lib/llm-providers";
import { encryptValue } from "@/lib/boomi-crypto";

const openAiProvider: LlmProviderRuntimeConfig = {
  name: "LM Studio",
  type: "openai-compatible",
  baseUrl: "http://localhost:1234/v1",
  model: "qwen3",
  authMode: "optional",
  apiKey: "local-key",
  enabled: true,
  isDefault: true,
  temperature: 0,
  topP: 0.2,
  maxTokens: 4000,
  timeoutMs: 30000,
  supportsJsonSchema: true,
  supportsModelList: true,
  source: "explicit",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LLM provider adapters", () => {
  it("builds OpenAI-compatible chat-completions requests with JSON schema and bearer auth", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "qwen3" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createLlmChatProvider(openAiProvider);
    await provider.listModels();
    const content = await provider.chat({
      pass: "project",
      systemPrompt: "system",
      prompt: "user",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    });

    expect(content).toBe("{\"ok\":true}");
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:1234/v1/models", expect.objectContaining({
      headers: { Authorization: "Bearer local-key" },
    }));
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:1234/v1/chat/completions", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer local-key" }),
    }));
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(body.model).toBe("qwen3");
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "fmd_project", strict: true },
    });
  });

  it("allows local OpenAI-compatible providers without an API key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createLlmChatProvider({ ...openAiProvider, apiKey: undefined, supportsModelList: false });
    await provider.chat({
      pass: "inventory",
      systemPrompt: "system",
      prompt: "user",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual(expect.not.objectContaining({ Authorization: expect.any(String) }));
  });

  it("accepts Qwen reasoning_content as an OpenAI-compatible response fallback", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: "", reasoning_content: "{\"ok\":true}" } }] }),
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createLlmChatProvider({ ...openAiProvider, supportsModelList: false });
    const content = await provider.chat({
      pass: "project",
      systemPrompt: "system",
      prompt: "user",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    });

    expect(content).toBe("{\"ok\":true}");
  });

  it("tests model listing plus a structured-output probe", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "qwen3" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true,\"message\":\"ready\"}" } }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await testLlmProviderConfig(openAiProvider);

    expect(result.ok).toBe(true);
    expect(result.models).toEqual(["qwen3"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses Ollama /api/chat with schema format", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: { content: "{\"ok\":true}" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createLlmChatProvider({
      ...openAiProvider,
      name: "Ollama",
      type: "ollama",
      baseUrl: "http://localhost:11434",
      model: "qwen3:8b",
      authMode: "none",
    });
    await provider.listModels();
    await provider.chat({
      pass: "profiles",
      systemPrompt: "system",
      prompt: "user",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/tags", expect.any(Object));
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(body.format).toMatchObject({ type: "object" });
    expect(body.model).toBe("qwen3:8b");
  });
});

describe("LLM provider configuration", () => {
  it("masks encrypted API keys in provider responses", () => {
    const response = llmProviderResponse({
      id: "llm-1",
      name: "Remote",
      type: "openai-compatible",
      baseUrl: "https://example.test/v1",
      model: "remote-model",
      authMode: "required",
      apiKeyEncrypted: encryptValue("secret"),
      enabled: true,
      isDefault: true,
      temperature: 0,
      topP: 0.2,
      maxTokens: 4000,
      timeoutMs: 120000,
      supportsJsonSchema: true,
      supportsModelList: true,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(response.hasApiKey).toBe(true);
    expect(response.apiKey).toBe("••••••••");
  });

  it("rejects required-auth providers without a saved or submitted API key", () => {
    expect(() => validateProviderAuth({
      type: "openai-compatible",
      authMode: "required",
      apiKey: "",
      baseUrl: "https://example.test/v1",
    }, false)).toThrow(/API key is required/);
  });

  it("requires remote OpenAI-compatible keys unless auth is explicitly none", () => {
    expect(() => validateProviderAuth({
      type: "openai-compatible",
      authMode: "optional",
      apiKey: "",
      baseUrl: "https://example.test/v1",
    }, false)).toThrow(/API key is required/);
    expect(() => validateProviderAuth({
      type: "openai-compatible",
      authMode: "none",
      apiKey: "",
      baseUrl: "https://example.test/v1",
    }, false)).not.toThrow();
    expect(() => validateProviderAuth({
      type: "openai-compatible",
      authMode: "optional",
      apiKey: "",
      baseUrl: "http://localhost:1234/v1",
    }, false)).not.toThrow();
  });
});
