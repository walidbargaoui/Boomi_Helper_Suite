"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  CheckCircle2,
  Database,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import type { BoomiConnection } from "@/lib/domain";
import { PanelHeader, StatusPill, WorkspacePanel } from "@/components/atoms";
import { useConnections } from "@/hooks/use-connections";
import { extractError } from "@/lib/api-utils";
import { useToast } from "@/components/toast";

type ConnectionFormState = {
  id: string;
  accountId: string;
  environmentName: string;
  baseUrl: string;
  authMode: "Basic API Token";
  apiUsername: string;
  apiPassword: string;
  mode: "mock" | "sandbox";
};

type ConnectionSaveResponse = {
  connection?: BoomiConnection;
};

type ConnectionTestResponse = {
  result?: {
    ok?: boolean;
    message?: string;
  };
  error?: string;
  detail?: string;
};

function blankConnectionForm(): ConnectionFormState {
  return {
    id: "",
    accountId: "",
    environmentName: "",
    baseUrl: "https://api.boomi.com",
    authMode: "Basic API Token",
    apiUsername: "",
    apiPassword: "",
    mode: "mock",
  };
}

function formFromConnection(connection: BoomiConnection): ConnectionFormState {
  return {
    id: connection.id,
    accountId: connection.accountId,
    environmentName: connection.environmentName,
    baseUrl: connection.baseUrl,
    authMode: connection.authMode,
    apiUsername: "",
    apiPassword: "",
    mode: connection.mode,
  };
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function connectionTitle(connection: BoomiConnection) {
  return `${connection.environmentName} (${connection.accountId})`;
}

export function BoomiConnectionsAdmin() {
  const toast = useToast();
  const { connections, mutate, isLoading, error } = useConnections();
  const [form, setForm] = useState<ConnectionFormState>(() => blankConnectionForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const selectedConnection = useMemo(
    () => connections.find((connection) => connection.id === form.id),
    [connections, form.id],
  );
  const isEditing = Boolean(form.id);
  const sandboxCount = connections.filter((connection) => connection.mode === "sandbox").length;

  function updateField<K extends keyof ConnectionFormState>(key: K, value: ConnectionFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError(null);
  }

  function startCreate() {
    setForm(blankConnectionForm());
    setFormError(null);
  }

  function startEdit(connection: BoomiConnection) {
    setForm(formFromConnection(connection));
    setFormError(null);
  }

  function buildPayload() {
    const payload: Record<string, string> = {
      accountId: form.accountId.trim(),
      environmentName: form.environmentName.trim(),
      baseUrl: form.baseUrl.trim(),
      authMode: form.authMode,
      mode: form.mode,
    };

    const username = form.apiUsername.trim();
    const password = form.apiPassword.trim();

    if (!isEditing && (!username || !password)) {
      throw new Error("Username and API token are required for new connections.");
    }

    if (isEditing) payload.id = form.id;
    if (username) payload.apiUsername = username;
    if (password) payload.apiPassword = password;

    return payload;
  }

  async function saveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveBusy(true);
    setFormError(null);

    try {
      const payload = buildPayload();
      const response = await fetch("/api/boomi/connections", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await extractError(response));
      }

      const body = (await response.json()) as ConnectionSaveResponse;
      await mutate();
      if (body.connection) {
        setForm(formFromConnection(body.connection));
      }
      toast.addToast({
        message: isEditing ? "Connection updated" : "Connection created",
        type: "success",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection save failed.";
      setFormError(message);
      toast.addToast({ message, type: "error" });
    } finally {
      setSaveBusy(false);
    }
  }

  async function testConnection(connection: BoomiConnection) {
    setTestingId(connection.id);
    try {
      const response = await fetch("/api/boomi/connections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: connection.id }),
      });

      if (!response.ok) {
        throw new Error(await extractError(response));
      }

      const body = (await response.json()) as ConnectionTestResponse;
      const ok = Boolean(body.result?.ok);
      toast.addToast({
        message: body.result?.message ?? (ok ? "Connection test passed" : "Connection test failed"),
        type: ok ? "success" : "error",
      });
    } catch (err) {
      toast.addToast({
        message: err instanceof Error ? err.message : "Connection test failed.",
        type: "error",
      });
    } finally {
      setTestingId(null);
    }
  }

  async function deleteConnection(connection: BoomiConnection) {
    const ok = await toast.confirm(`Delete ${connectionTitle(connection)}?`);
    if (!ok) return;

    setDeletingId(connection.id);
    try {
      const response = await fetch(`/api/boomi/connections?id=${encodeURIComponent(connection.id)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(await extractError(response));
      }

      await mutate();
      if (form.id === connection.id) startCreate();
      toast.addToast({ message: "Connection deleted", type: "success" });
    } catch (err) {
      toast.addToast({
        message: err instanceof Error ? err.message : "Connection delete failed.",
        type: "error",
      });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f6f4]">
      <WorkspacePanel>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_420px]">
          <section className="panel min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <PanelHeader icon={Database} title="Global Connections" action={isLoading ? "syncing" : undefined} />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => mutate()}
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-[#cfd6cf] bg-white px-3 text-sm font-medium text-[#111714] hover:bg-[#eef1ee]"
                >
                  <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={startCreate}
                  className="inline-flex h-8 items-center gap-2 rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d]"
                >
                  <Plus size={14} />
                  New
                </button>
              </div>
            </div>

            {error ? (
              <div className="mt-4 rounded-md border border-[#f0c7c7] bg-[#fff8f8] p-3 text-sm text-[#9c2a2a]">
                Failed to load connections.
              </div>
            ) : null}

            {connections.length === 0 ? (
              <div className="mt-6 rounded-md border border-dashed border-[#cfd6cf] bg-[#fbfbfa] p-8 text-center">
                <ShieldCheck size={36} className="mx-auto mb-3 text-[#9fb7aa]" />
                <p className="text-sm font-semibold text-[#111714]">No global connections</p>
                <p className="mt-1 text-sm text-[#66706a]">Create one connection here, then select it in any project Companion tab.</p>
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-md border border-[#d9ded8]">
                <table className="min-w-full divide-y divide-[#e1e6e1] text-left text-sm">
                  <thead className="bg-[#fbfbfa] text-xs uppercase text-[#66706a]">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Environment</th>
                      <th className="px-3 py-2 font-semibold">Account</th>
                      <th className="px-3 py-2 font-semibold">Mode</th>
                      <th className="px-3 py-2 font-semibold">Base URL</th>
                      <th className="px-3 py-2 font-semibold">Created</th>
                      <th className="px-3 py-2 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e1e6e1] bg-white">
                    {connections.map((connection) => (
                      <tr
                        key={connection.id}
                        className={clsx(
                          "align-middle",
                          selectedConnection?.id === connection.id && "bg-[#f0faf5]",
                        )}
                      >
                        <td className="px-3 py-2">
                          <p className="font-medium text-[#111714]">{connection.environmentName}</p>
                          <p className="text-xs text-[#66706a]">{connection.apiUsername}</p>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-[#4a524d]">{connection.accountId}</td>
                        <td className="px-3 py-2">
                          <StatusPill label={connection.mode} tone={connection.mode === "sandbox" ? "green" : "amber"} />
                        </td>
                        <td className="max-w-[260px] truncate px-3 py-2 text-xs text-[#66706a]">{connection.baseUrl}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-[#66706a]">{formatDate(connection.createdAt)}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => startEdit(connection)}
                              className="grid h-8 w-8 place-items-center rounded-md border border-[#cfd6cf] bg-white text-[#111714] hover:bg-[#eef1ee]"
                              title="Edit connection"
                              aria-label={`Edit ${connectionTitle(connection)}`}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => testConnection(connection)}
                              disabled={testingId === connection.id}
                              className="grid h-8 w-8 place-items-center rounded-md border border-[#cfd6cf] bg-white text-[#1b5e4a] hover:bg-[#e3f3ed] disabled:opacity-60"
                              title="Test connection"
                              aria-label={`Test ${connectionTitle(connection)}`}
                            >
                              {testingId === connection.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteConnection(connection)}
                              disabled={deletingId === connection.id}
                              className="grid h-8 w-8 place-items-center rounded-md border border-[#f0c7c7] bg-white text-[#9c2a2a] hover:bg-[#fff8f8] disabled:opacity-60"
                              title="Delete connection"
                              aria-label={`Delete ${connectionTitle(connection)}`}
                            >
                              {deletingId === connection.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
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
            <PanelHeader icon={isEditing ? Pencil : Plus} title={isEditing ? "Edit Connection" : "New Connection"} action={form.mode} />
            <form className="mt-4 space-y-3" onSubmit={saveConnection}>
              <Field label="Environment">
                <input
                  value={form.environmentName}
                  onChange={(event) => updateField("environmentName", event.target.value)}
                  className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
                  required
                />
              </Field>
              <Field label="Account ID">
                <input
                  value={form.accountId}
                  onChange={(event) => updateField("accountId", event.target.value)}
                  className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
                  required
                />
              </Field>
              <Field label="Base URL">
                <input
                  value={form.baseUrl}
                  onChange={(event) => updateField("baseUrl", event.target.value)}
                  className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
                  required
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Auth">
                  <select
                    value={form.authMode}
                    onChange={(event) => updateField("authMode", event.target.value as "Basic API Token")}
                    className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
                  >
                    <option value="Basic API Token">Basic API Token</option>
                  </select>
                </Field>
                <Field label="Mode">
                  <select
                    value={form.mode}
                    onChange={(event) => updateField("mode", event.target.value as "mock" | "sandbox")}
                    className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
                  >
                    <option value="mock">mock</option>
                    <option value="sandbox">sandbox</option>
                  </select>
                </Field>
              </div>
              <Field label="Username">
                <input
                  value={form.apiUsername}
                  onChange={(event) => updateField("apiUsername", event.target.value)}
                  className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
                  placeholder={isEditing ? "Leave blank to keep current" : ""}
                  required={!isEditing}
                />
              </Field>
              <Field label="API Token">
                <input
                  value={form.apiPassword}
                  onChange={(event) => updateField("apiPassword", event.target.value)}
                  className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
                  placeholder={isEditing ? "Leave blank to keep current" : ""}
                  required={!isEditing}
                  type="password"
                />
              </Field>

              {formError ? (
                <div className="flex gap-2 rounded-md border border-[#f0c7c7] bg-[#fff8f8] p-3 text-sm text-[#9c2a2a]">
                  <XCircle size={16} className="mt-0.5 shrink-0" />
                  <p>{formError}</p>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="submit"
                  disabled={saveBusy}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d] disabled:opacity-60"
                >
                  {saveBusy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {isEditing ? "Save Changes" : "Create Connection"}
                </button>
                {isEditing ? (
                  <button
                    type="button"
                    onClick={startCreate}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-[#cfd6cf] bg-white px-3 text-sm font-medium text-[#111714] hover:bg-[#eef1ee]"
                  >
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
