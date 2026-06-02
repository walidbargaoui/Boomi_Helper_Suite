"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  CheckCircle2,
  Cpu,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ServerCog,
  Trash2,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import type { LlmProvider, LlmProviderAuthMode, LlmProviderType } from "@/lib/domain";
import { PanelHeader, StatusPill, WorkspacePanel } from "@/components/atoms";
import { useToast } from "@/components/toast";
import { useLlmProviders } from "@/hooks/use-llm-providers";
import { extractError } from "@/lib/api-utils";

type ProviderFormState = {
  id: string;
  name: string;
  type: LlmProviderType;
  baseUrl: string;
  model: string;
  authMode: LlmProviderAuthMode;
  apiKey: string;
  clearApiKey: boolean;
  enabled: boolean;
  isDefault: boolean;
  temperature: number;
  topP: number;
  maxTokens: number;
  timeoutMs: number;
  supportsJsonSchema: boolean;
  supportsModelList: boolean;
};

type ProviderSaveResponse = {
  provider?: LlmProvider;
};

type ProviderTestResponse = {
  result?: {
    ok?: boolean;
    message?: string;
    models?: string[];
  };
  error?: string;
  detail?: string;
};

const presets: Array<{ label: string; description: string; values: Partial<ProviderFormState> }> = [
  {
    label: "LM Studio",
    description: "Local OpenAI-compatible server",
    values: {
      name: "LM Studio",
      type: "openai-compatible",
      baseUrl: "http://localhost:1234/v1",
      model: "local-model",
      authMode: "optional",
      supportsJsonSchema: true,
      supportsModelList: true,
    },
  },
  {
    label: "Ollama",
    description: "Local Ollama /api/chat",
    values: {
      name: "Ollama",
      type: "ollama",
      baseUrl: "http://localhost:11434",
      model: "qwen3:8b",
      authMode: "none",
      supportsJsonSchema: true,
      supportsModelList: true,
    },
  },
  {
    label: "Remote API",
    description: "Internet OpenAI-compatible API",
    values: {
      name: "OpenAI-compatible API",
      type: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini",
      authMode: "required",
      supportsJsonSchema: true,
      supportsModelList: true,
    },
  },
];

function blankProviderForm(): ProviderFormState {
  return {
    id: "",
    name: "LM Studio",
    type: "openai-compatible",
    baseUrl: "http://localhost:1234/v1",
    model: "local-model",
    authMode: "optional",
    apiKey: "",
    clearApiKey: false,
    enabled: true,
    isDefault: true,
    temperature: 0,
    topP: 0.2,
    maxTokens: 4000,
    timeoutMs: 120000,
    supportsJsonSchema: true,
    supportsModelList: true,
  };
}

function formFromProvider(provider: LlmProvider): ProviderFormState {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    baseUrl: provider.baseUrl,
    model: provider.model,
    authMode: provider.authMode,
    apiKey: "",
    clearApiKey: false,
    enabled: provider.enabled,
    isDefault: provider.isDefault,
    temperature: provider.temperature,
    topP: provider.topP,
    maxTokens: provider.maxTokens,
    timeoutMs: provider.timeoutMs,
    supportsJsonSchema: provider.supportsJsonSchema,
    supportsModelList: provider.supportsModelList,
  };
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function LlmProvidersAdmin() {
  const toast = useToast();
  const { providers, mutate, isLoading, error } = useLlmProviders();
  const [form, setForm] = useState<ProviderFormState>(() => blankProviderForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testingForm, setTestingForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [modelHint, setModelHint] = useState<string | null>(null);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === form.id),
    [providers, form.id],
  );
  const isEditing = Boolean(form.id);
  const enabledCount = providers.filter((provider) => provider.enabled).length;

  function updateField<K extends keyof ProviderFormState>(key: K, value: ProviderFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  }

  function applyPreset(values: Partial<ProviderFormState>) {
    setForm((current) => ({ ...current, ...values, id: "", apiKey: "", clearApiKey: false }));
    setFormError(null);
    setModelHint(null);
  }

  function startCreate() {
    setForm(blankProviderForm());
    setFormError(null);
    setModelHint(null);
  }

  function startEdit(provider: LlmProvider) {
    setForm(formFromProvider(provider));
    setFormError(null);
    setModelHint(null);
  }

  function buildPayload() {
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      type: form.type,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      authMode: form.authMode,
      enabled: form.enabled,
      isDefault: form.isDefault,
      temperature: Number(form.temperature),
      topP: Number(form.topP),
      maxTokens: Number(form.maxTokens),
      timeoutMs: Number(form.timeoutMs),
      supportsJsonSchema: form.supportsJsonSchema,
      supportsModelList: form.supportsModelList,
    };
    if (isEditing) payload.id = form.id;
    if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim();
    if (isEditing && form.clearApiKey) payload.clearApiKey = true;
    return payload;
  }

  async function saveProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveBusy(true);
    setFormError(null);

    try {
      const response = await fetch("/api/llm/providers", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      if (!response.ok) throw new Error(await extractError(response));

      const body = (await response.json()) as ProviderSaveResponse;
      await mutate();
      if (body.provider) setForm(formFromProvider(body.provider));
      toast.addToast({ message: isEditing ? "LLM provider updated" : "LLM provider created", type: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "LLM provider save failed.";
      setFormError(message);
      toast.addToast({ message, type: "error" });
    } finally {
      setSaveBusy(false);
    }
  }

  async function testProvider(provider: LlmProvider) {
    setTestingId(provider.id);
    try {
      const response = await fetch("/api/llm/providers/test", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: provider.id }),
      });
      if (!response.ok) throw new Error(await extractError(response));
      const body = (await response.json()) as ProviderTestResponse;
      toast.addToast({ message: body.result?.message ?? "Provider test passed", type: "success" });
    } catch (err) {
      toast.addToast({ message: err instanceof Error ? err.message : "Provider test failed.", type: "error" });
    } finally {
      setTestingId(null);
    }
  }

  async function testCurrentForm() {
    setTestingForm(true);
    setModelHint(null);
    try {
      const response = await fetch("/api/llm/providers/test", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      if (!response.ok) throw new Error(await extractError(response));
      const body = (await response.json()) as ProviderTestResponse;
      const models = body.result?.models ?? [];
      setModelHint(models.length ? `${models.slice(0, 6).join(", ")}${models.length > 6 ? "..." : ""}` : "No model list returned.");
      toast.addToast({ message: body.result?.message ?? "Provider test passed", type: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Provider test failed.";
      setModelHint(message);
      toast.addToast({ message, type: "error" });
    } finally {
      setTestingForm(false);
    }
  }

  async function deleteProvider(provider: LlmProvider) {
    const ok = await toast.confirm(`Delete ${provider.name}?`);
    if (!ok) return;

    setDeletingId(provider.id);
    try {
      const response = await fetch(`/api/llm/providers?id=${encodeURIComponent(provider.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await extractError(response));
      await mutate();
      if (form.id === provider.id) startCreate();
      toast.addToast({ message: "LLM provider deleted", type: "success" });
    } catch (err) {
      toast.addToast({ message: err instanceof Error ? err.message : "LLM provider delete failed.", type: "error" });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f6f4]">
      <WorkspacePanel>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_440px]">
          <section className="panel min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <PanelHeader icon={ServerCog} title="Global LLM Providers" action={`${enabledCount} enabled`} />
              <div className="flex gap-2">
                <button type="button" onClick={() => mutate()} className="inline-flex h-8 items-center gap-2 rounded-md border border-[#cfd6cf] bg-white px-3 text-sm font-medium text-[#111714] hover:bg-[#eef1ee]">
                  <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
                  Refresh
                </button>
                <button type="button" onClick={startCreate} className="inline-flex h-8 items-center gap-2 rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d]">
                  <Plus size={14} />
                  New
                </button>
              </div>
            </div>

            {error ? (
              <div className="mt-4 rounded-md border border-[#f0c7c7] bg-[#fff8f8] p-3 text-sm text-[#9c2a2a]">
                Failed to load LLM providers.
              </div>
            ) : null}

            {providers.length === 0 ? (
              <div className="mt-6 rounded-md border border-dashed border-[#cfd6cf] bg-[#fbfbfa] p-8 text-center">
                <Cpu size={36} className="mx-auto mb-3 text-[#9fb7aa]" />
                <p className="text-sm font-semibold text-[#111714]">No global LLM providers</p>
                <p className="mt-1 text-sm text-[#66706a]">Create a default provider for FMD resolver metadata, profile, endpoint, and mapping passes.</p>
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-md border border-[#d9ded8]">
                <table className="min-w-full divide-y divide-[#e1e6e1] text-left text-sm">
                  <thead className="bg-[#fbfbfa] text-xs uppercase text-[#66706a]">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Provider</th>
                      <th className="px-3 py-2 font-semibold">Model</th>
                      <th className="px-3 py-2 font-semibold">Auth</th>
                      <th className="px-3 py-2 font-semibold">Base URL</th>
                      <th className="px-3 py-2 font-semibold">Updated</th>
                      <th className="px-3 py-2 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e1e6e1] bg-white">
                    {providers.map((provider) => (
                      <tr key={provider.id} className={clsx("align-middle", selectedProvider?.id === provider.id && "bg-[#f0faf5]")}>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-[#111714]">{provider.name}</p>
                            {provider.isDefault ? <StatusPill label="default" tone="green" /> : null}
                            {!provider.enabled ? <StatusPill label="disabled" tone="amber" /> : null}
                          </div>
                          <p className="text-xs text-[#66706a]">{provider.type}</p>
                        </td>
                        <td className="max-w-[180px] truncate px-3 py-2 font-mono text-xs text-[#4a524d]">{provider.model}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2 text-xs text-[#66706a]">
                            <KeyRound size={13} />
                            {provider.authMode}
                            {provider.hasApiKey ? <span className="font-mono">{provider.apiKey}</span> : null}
                          </div>
                        </td>
                        <td className="max-w-[260px] truncate px-3 py-2 text-xs text-[#66706a]">{provider.baseUrl}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-[#66706a]">{formatDate(provider.updatedAt)}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <button type="button" onClick={() => startEdit(provider)} className="grid h-8 w-8 place-items-center rounded-md border border-[#cfd6cf] bg-white text-[#111714] hover:bg-[#eef1ee]" title="Edit provider" aria-label={`Edit ${provider.name}`}>
                              <Pencil size={14} />
                            </button>
                            <button type="button" onClick={() => testProvider(provider)} disabled={testingId === provider.id} className="grid h-8 w-8 place-items-center rounded-md border border-[#cfd6cf] bg-white text-[#1b5e4a] hover:bg-[#e3f3ed] disabled:opacity-60" title="Test provider" aria-label={`Test ${provider.name}`}>
                              {testingId === provider.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                            </button>
                            <button type="button" onClick={() => deleteProvider(provider)} disabled={deletingId === provider.id} className="grid h-8 w-8 place-items-center rounded-md border border-[#f0c7c7] bg-white text-[#9c2a2a] hover:bg-[#fff8f8] disabled:opacity-60" title="Delete provider" aria-label={`Delete ${provider.name}`}>
                              {deletingId === provider.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <PanelHeader icon={isEditing ? Pencil : Plus} title={isEditing ? "Edit Provider" : "New Provider"} action={form.type} />
            <div className="mt-4 grid grid-cols-3 gap-2">
              {presets.map((preset) => (
                <button key={preset.label} type="button" onClick={() => applyPreset(preset.values)} className="rounded-md border border-[#cfd6cf] bg-white px-2 py-2 text-left hover:bg-[#eef1ee]">
                  <span className="block text-xs font-semibold text-[#111714]">{preset.label}</span>
                  <span className="mt-1 block text-[11px] text-[#66706a]">{preset.description}</span>
                </button>
              ))}
            </div>

            <form className="mt-4 space-y-3" onSubmit={saveProvider}>
              <Field label="Name">
                <input value={form.name} onChange={(event) => updateField("name", event.target.value)} className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]" required />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type">
                  <select value={form.type} onChange={(event) => updateField("type", event.target.value as LlmProviderType)} className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]">
                    <option value="openai-compatible">OpenAI-compatible</option>
                    <option value="ollama">Ollama</option>
                  </select>
                </Field>
                <Field label="Auth">
                  <select value={form.authMode} onChange={(event) => updateField("authMode", event.target.value as LlmProviderAuthMode)} className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]">
                    <option value="optional">optional</option>
                    <option value="required">required</option>
                    <option value="none">none</option>
                  </select>
                </Field>
              </div>
              <Field label="Base URL">
                <input value={form.baseUrl} onChange={(event) => updateField("baseUrl", event.target.value)} className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]" required />
              </Field>
              <Field label="Model">
                <input value={form.model} onChange={(event) => updateField("model", event.target.value)} className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]" required />
              </Field>
              <Field label="API Key">
                <input value={form.apiKey} onChange={(event) => updateField("apiKey", event.target.value)} className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]" placeholder={isEditing ? "Leave blank to keep current key" : "Optional for local LM Studio"} type="password" />
              </Field>
              {isEditing && selectedProvider?.hasApiKey ? (
                <label className="flex items-center gap-2 text-sm text-[#4a524d]">
                  <input type="checkbox" checked={form.clearApiKey} onChange={(event) => updateField("clearApiKey", event.target.checked)} />
                  Clear saved API key
                </label>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Temperature">
                  <input type="number" min={0} max={2} step={0.05} value={form.temperature} onChange={(event) => updateField("temperature", Number(event.target.value))} className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]" />
                </Field>
                <Field label="Top P">
                  <input type="number" min={0} max={1} step={0.05} value={form.topP} onChange={(event) => updateField("topP", Number(event.target.value))} className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]" />
                </Field>
                <Field label="Max Tokens">
                  <input type="number" min={1} value={form.maxTokens} onChange={(event) => updateField("maxTokens", Number(event.target.value))} className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]" />
                </Field>
                <Field label="Timeout MS">
                  <input type="number" min={1000} step={1000} value={form.timeoutMs} onChange={(event) => updateField("timeoutMs", Number(event.target.value))} className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]" />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm text-[#4a524d]">
                <Toggle checked={form.enabled} onChange={(value) => updateField("enabled", value)} label="Enabled" />
                <Toggle checked={form.isDefault} onChange={(value) => updateField("isDefault", value)} label="Default" />
                <Toggle checked={form.supportsJsonSchema} onChange={(value) => updateField("supportsJsonSchema", value)} label="JSON schema" />
                <Toggle checked={form.supportsModelList} onChange={(value) => updateField("supportsModelList", value)} label="Model list" />
              </div>

              {modelHint ? (
                <div className="rounded-md border border-[#d9ded8] bg-[#fbfbfa] p-3 text-xs text-[#66706a]">
                  <span className="font-semibold text-[#111714]">Test result:</span> {modelHint}
                </div>
              ) : null}

              {formError ? (
                <div className="flex gap-2 rounded-md border border-[#f0c7c7] bg-[#fff8f8] p-3 text-sm text-[#9c2a2a]">
                  <XCircle size={16} className="mt-0.5 shrink-0" />
                  <p>{formError}</p>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <button type="submit" disabled={saveBusy} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d] disabled:opacity-60">
                  {saveBusy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {isEditing ? "Save Changes" : "Create Provider"}
                </button>
                <button type="button" onClick={testCurrentForm} disabled={testingForm} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#cfd6cf] bg-white px-3 text-sm font-medium text-[#1b5e4a] hover:bg-[#e3f3ed] disabled:opacity-60">
                  {testingForm ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                  Test
                </button>
                {isEditing ? (
                  <button type="button" onClick={startCreate} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#cfd6cf] bg-white px-3 text-sm font-medium text-[#111714] hover:bg-[#eef1ee]">
                    <Plus size={15} />
                    New
                  </button>
                ) : null}
              </div>
            </form>
          </section>
        </div>
      </WorkspacePanel>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase text-[#66706a]">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-[#d9ded8] bg-white px-3 py-2">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
