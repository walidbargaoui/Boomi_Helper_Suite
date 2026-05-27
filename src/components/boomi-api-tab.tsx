"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  ClipboardCheck,
  Download,
  GitCompareArrows,
  Network,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import clsx from "clsx";
import type {
  BoomiComponentDraft,
  BoomiConnection,
  Project,
} from "@/lib/domain";
import { buildPublishSafetyContext, validatePublishSafety } from "@/lib/boomi-sandbox";
import { PanelHeader, StatusPill, WorkspacePanel, InfoRow } from "@/components/atoms";
import { extractError } from "@/lib/api-utils";
import { useToast } from "@/components/toast";
import { formatXmlForDisplay } from "@/lib/xml-utils";
import { useConnections } from "@/hooks/use-connections";

/**
 * Derive a real local inventory from the project's imported drafts + mapping
 * sets + profiles. Replaces the old mockInventory() placeholder. Mapping sets
 * are listed individually (no more hardcoded mappingSets[0]).
 */
type InventoryItem = {
  id: string;
  type: string;
  name: string;
  dependencyCount: number;
  status: string;
};
function deriveLocalInventory(project: Project): InventoryItem[] {
  const items: InventoryItem[] = [];
  for (const draft of project.boomiDrafts) {
    items.push({
      id: draft.id,
      type: draft.componentType,
      name: draft.componentName,
      dependencyCount: 0,
      status: draft.validationStatus,
    });
  }
  for (const set of project.mappingSets) {
    items.push({
      id: `local-map-${set.id}`,
      type: "transform.map (local)",
      name: set.name,
      dependencyCount: 2,
      status: set.status,
    });
  }
  for (const profile of project.profiles) {
    items.push({
      id: `local-profile-${profile.id}`,
      type: `${profile.type.toLowerCase()} (local)`,
      name: profile.name,
      dependencyCount: profile.fields.length,
      status: profile.role,
    });
  }
  return items;
}

type DependencyResult = {
  componentId: string;
  role: string;
  shapeType?: string;
  alreadyImported: boolean;
};

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-[#66706a]">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function CodePanel({ title, value, format = "text" }: { title: string; value: string; format?: "text" | "xml" }) {
  const displayValue = useMemo(
    () => (format === "xml" ? formatXmlForDisplay(value) : value),
    [format, value],
  );

  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs font-semibold uppercase text-[#66706a]">{title}</p>
      <pre className="h-[360px] overflow-auto rounded-md border border-[#d9ded8] bg-[#101511] p-4 text-xs leading-5 text-[#d9f7e8]">
        {displayValue}
      </pre>
    </div>
  );
}

export function BoomiApiLab({
  project,
  setProject,
}: {
  project: Project;
  setProject: (project: Project) => void;
}) {
  const toast = useToast();
  const [dryRunState, setDryRunState] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>(deriveLocalInventory(project));
  const [activeDraft, setActiveDraft] = useState<BoomiComponentDraft | undefined>(project.boomiDrafts[0]);
  const [dependencyScan, setDependencyScan] = useState<{
    sourceComponentId: string;
    sourceComponentName: string;
    dependencies: DependencyResult[];
  } | null>(null);
  const [dependencyBusy, setDependencyBusy] = useState(false);
  const [dependencyError, setDependencyError] = useState<string | null>(null);
  const { connections, mutate: mutateConnections } = useConnections(project.id, project.boomiConnections);
  const [activeConnectionId, setActiveConnectionId] = useState(project.boomiConnections[0]?.id ?? "");

  function setConnections(next: BoomiConnection[] | ((prev: BoomiConnection[]) => BoomiConnection[])) {
    mutateConnections((current) => {
      const prev = current ?? project.boomiConnections;
      return typeof next === "function" ? (next as (prev: BoomiConnection[]) => BoomiConnection[])(prev) : next;
    }, false);
  }
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);
  const [lookupResults, setLookupResults] = useState<Array<{ componentId: string; version: number; currentVersion: boolean; name: string; type: string; status: string }>>([]);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupFilter, setLookupFilter] = useState("");
  const [showConnectionForm, setShowConnectionForm] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null);

  async function runDryRun() {
    setDryRunState("running");
    setDryRunError(null);

    try {
      const response = await fetch("/api/boomi/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      if (!response.ok) {
        throw new Error(await extractError(response));
      }
      const result = (await response.json()) as {
        drafts: BoomiComponentDraft[];
        warnings?: string[];
        project?: Project;
      };
      setInventory(result.project ? deriveLocalInventory(result.project) : deriveLocalInventory(project));
      const firstDraft = result.drafts[0];
      setActiveDraft(firstDraft);
      if (result.project) {
        setProject(result.project);
        setConnections(result.project.boomiConnections);
      } else if (firstDraft) {
        const generatedIds = new Set(result.drafts.map((d) => d.componentId));
        const preserved = project.boomiDrafts.filter((d) => !generatedIds.has(d.componentId));
        setProject({ ...project, boomiDrafts: [...result.drafts, ...preserved] });
      }
      setDryRunState("complete");
    } catch (err) {
      setDryRunState("error");
      setDryRunError(err instanceof Error ? err.message : "Dry-run failed.");
    }
  }

  async function testConnection() {
    if (!activeConnectionId) {
      setConnectionStatus("No connection selected.");
      return;
    }
    setConnectionStatus("testing");
    try {
      const response = await fetch("/api/boomi/connections", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: activeConnectionId, projectId: project.id }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const msg = typeof body?.error === "string" ? body.error : typeof body?.detail === "string" ? body.detail : `Test failed (${response.status})`;
        throw new Error(msg);
      }
      const result = body?.result as { ok?: boolean; message?: string } | undefined;
      if (result?.ok) {
        setConnectionStatus(`Connected: ${result.message ?? "OK"}`);
      } else {
        setConnectionStatus(`Failed: ${result?.message ?? "Unknown"}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setConnectionStatus(`Error: ${msg}`);
    }
  }

  async function deleteConnection() {
    if (!activeConnectionId) return;
    const conn = connections.find((c) => c.id === activeConnectionId);
    if (!conn) return;
    const confirmed = await toast.confirm(`Delete connection "${conn.environmentName}" (${conn.accountId})?`);
    if (!confirmed) return;
    try {
      const response = await fetch(
        `/api/boomi/connections?id=${encodeURIComponent(activeConnectionId)}&projectId=${encodeURIComponent(project.id)}`,
        { method: "DELETE" },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof body?.error === "string" ? body.error : `Delete failed (${response.status})`);
      }
      const remaining = connections.filter((c) => c.id !== activeConnectionId);
      setConnections(remaining);
      setProject({ ...project, boomiConnections: remaining });
      setActiveConnectionId(remaining[0]?.id ?? "");
      setConnectionStatus(null);
    } catch (err) {
      setConnectionStatus(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  }

  async function lookupComponents() {
    if (!activeConnectionId) return;
    setLookupBusy(true);
    setLookupError(null);
    try {
      const response = await fetch("/api/boomi/components/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: activeConnectionId,
          projectId: project.id,
          componentName: lookupFilter || undefined,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof body?.error === "string" ? body.error : typeof body?.detail === "string" ? body.detail : `Lookup failed (${response.status}).`);
      }
      const data = body as { components: Array<{ componentId: string; version: number; currentVersion: boolean; name: string; type: string; status: string }>; total: number };
      setLookupResults(data.components);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLookupBusy(false);
    }
  }

  async function importTemplate(component: { componentId: string; version: number; currentVersion: boolean; name: string; type: string }) {
    if (!activeConnectionId) return;
    setImportBusy(true);
    setImportError(null);
    setImportSuccess(null);
    try {
      const response = await fetch("/api/boomi/templates/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: activeConnectionId,
          projectId: project.id,
          componentId: component.componentId,
          componentName: component.name,
          componentType: component.type,
          version: component.version,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof body?.error === "string" ? body.error : typeof body?.detail === "string" ? body.detail : `Import failed (${response.status}).`);
      }
      const data = body as { draft: BoomiComponentDraft; project?: Project };
      if (data.project) {
        setProject(data.project);
        setConnections(data.project.boomiConnections);
      } else {
        setProject({
          ...project,
          boomiDrafts: [
            data.draft,
            ...project.boomiDrafts.filter(
              (draft) => draft.id !== data.draft.id && draft.componentId !== data.draft.componentId,
            ),
          ],
        });
      }
      setActiveDraft(data.draft);
      setImportSuccess(`Imported ${component.name} v${component.version}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportBusy(false);
    }
  }

  async function publishDraft() {
    if (!activeDraft || !activeConnectionId) return;
    setPublishBusy(true);
    setPublishError(null);
    setPublishSuccess(null);
    try {
      const response = await fetch("/api/boomi/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          connectionId: activeConnectionId,
          draftId: activeDraft.id,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const blockers = Array.isArray(body?.blockers) ? body.blockers.join(" ") : "";
        const msg = typeof body?.error === "string"
          ? `${body.error}${blockers ? ` ${blockers}` : ""}`
          : typeof body?.detail === "string"
            ? body.detail
            : `Publish failed (${response.status}).`;
        if (body?.project) {
          setProject(body.project as Project);
          setConnections((body.project as Project).boomiConnections);
        }
        throw new Error(msg);
      }
      const data = body as {
        project?: Project;
        event?: { componentName?: string; version?: number; status?: string };
        result?: { noop?: boolean };
      };
      if (data.project) {
        setProject(data.project);
        setConnections(data.project.boomiConnections);
        setActiveDraft(data.project.boomiDrafts.find((draft) => draft.id === activeDraft.id) ?? data.project.boomiDrafts[0]);
      }
      const version = data.event?.version ? ` v${data.event.version}` : "";
      setPublishSuccess(data.result?.noop
        ? `No changes to publish for ${data.event?.componentName ?? activeDraft.componentName}; sandbox XML already matches.`
        : `Published ${data.event?.componentName ?? activeDraft.componentName}${version} to sandbox.`);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishBusy(false);
    }
  }

  async function scanDependencies(draft: BoomiComponentDraft) {
    setDependencyBusy(true);
    setDependencyError(null);
    setDependencyScan(null);
    try {
      const response = await fetch("/api/boomi/components/dependencies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, sourceComponentId: draft.componentId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof body?.error === "string" ? body.error : `Scan failed (${response.status})`);
      }
      setDependencyScan({
        sourceComponentId: draft.componentId,
        sourceComponentName: draft.componentName,
        dependencies: body.dependencies ?? [],
      });
    } catch (err) {
      setDependencyError(err instanceof Error ? err.message : "Dependency scan failed");
    } finally {
      setDependencyBusy(false);
    }
  }

  async function importDependency(dep: DependencyResult) {
    if (!activeConnectionId) {
      setDependencyError("Select a connection first.");
      return;
    }
    setDependencyBusy(true);
    try {
      const response = await fetch("/api/boomi/templates/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: activeConnectionId,
          projectId: project.id,
          componentId: dep.componentId,
          componentName: dep.componentId,
          componentType: dep.role,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof body?.error === "string" ? body.error : `Import failed (${response.status})`);
      }
      const data = body as { draft: BoomiComponentDraft; project?: Project };
      if (data.project) {
        setProject(data.project);
        setConnections(data.project.boomiConnections);
        setInventory(deriveLocalInventory(data.project));
      }
      // Mark this dep as imported in the current scan.
      setDependencyScan((prev) => prev ? {
        ...prev,
        dependencies: prev.dependencies.map((d) =>
          d.componentId === dep.componentId ? { ...d, alreadyImported: true } : d,
        ),
      } : prev);
      toast.addToast({ message: `Imported ${data.draft.componentName}`, type: "success" });
    } catch (err) {
      setDependencyError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setDependencyBusy(false);
    }
  }

  async function rollbackPublish(historyEvent: { id: string; componentName: string; componentType: string }) {
    if (!activeConnectionId) return;
    const confirmed = await toast.confirm(`Rollback "${historyEvent.componentName}" (${historyEvent.componentType}) to the version stored in this publish history event? This creates a new revision in Boomi.`);
    if (!confirmed) return;
    setPublishBusy(true);
    setPublishError(null);
    setPublishSuccess(null);
    try {
      const response = await fetch("/api/boomi/publish/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          connectionId: activeConnectionId,
          eventId: historyEvent.id,
        }),
      });
      const body = await response.json().catch(() => null);
      if (body?.project) {
        setProject(body.project as Project);
        setConnections((body.project as Project).boomiConnections);
      }
      if (!response.ok) {
        throw new Error(typeof body?.error === "string" ? body.error : typeof body?.detail === "string" ? body.detail : `Rollback failed (${response.status}).`);
      }
      setPublishSuccess(`Rollback of "${historyEvent.componentName}" completed.`);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Rollback failed");
    } finally {
      setPublishBusy(false);
    }
  }

  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const safetyCheck = activeDraft ? validatePublishSafety({
    componentType: activeDraft.componentType,
    validationStatus: activeDraft.validationStatus,
    templateXml: activeDraft.templateXml,
    diff: activeDraft.diff,
  }, buildPublishSafetyContext(project, activeDraft, activeConnection?.mode)) : null;
  const publishEvents = project.boomiPublishEvents ?? [];

  return (
    <WorkspacePanel>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
        <div className="space-y-5">
          <div className="panel">
            <PanelHeader icon={Braces} title="Boomi Connection" action={activeConnection?.mode ?? "none"} />
            <div className="mt-4 space-y-3">
              {connections.length > 0 ? (
                <select
                  value={activeConnectionId}
                  onChange={(e) => { setActiveConnectionId(e.target.value); setConnectionStatus(null); }}
                  className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
                >
                  {connections.map((conn) => (
                    <option key={conn.id} value={conn.id}>{conn.environmentName} ({conn.accountId})</option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-[#66706a]">No connections configured.</p>
              )}
              {activeConnection ? (
                <div className="space-y-1">
                  <InfoRow label="Account" value={activeConnection.accountId} />
                  <InfoRow label="Environment" value={activeConnection.environmentName} />
                  <InfoRow label="Base URL" value={activeConnection.baseUrl} />
                  <InfoRow label="Auth" value={activeConnection.authMode} />
                  <InfoRow label="Mode" value={activeConnection.mode} />
                </div>
              ) : null}
              {connectionStatus ? (
                <p className={clsx("text-xs", connectionStatus.startsWith("Connected") ? "text-[#298b68]" : "text-[#9c2a2a]")}>{connectionStatus}</p>
              ) : null}
              <div className="flex gap-2">
                <button
                  className="inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d] disabled:opacity-50"
                  onClick={testConnection}
                  disabled={!activeConnectionId}
                  type="button"
                >
                  <RefreshCw size={14} />
                  Test
                </button>
                <button
                  className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[#cfd6cf] bg-white px-3 text-sm font-medium text-[#111714] hover:bg-[#eef1ee] disabled:opacity-50"
                  onClick={() => setShowConnectionForm(!showConnectionForm)}
                  type="button"
                >
                  <Plus size={14} />
                  Add
                </button>
                <button
                  className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[#d9ded8] bg-white px-3 text-sm font-medium text-[#9c2a2a] hover:bg-[#fdf3f3] disabled:opacity-50"
                  onClick={deleteConnection}
                  disabled={!activeConnectionId}
                  type="button"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
            </div>
          </div>

          {showConnectionForm ? (
            <ConnectionForm
              projectId={project.id}
              onClose={() => setShowConnectionForm(false)}
              onCreated={(conn) => {
                const nextConnections = [...connections, conn];
                setConnections(nextConnections);
                setProject({ ...project, boomiConnections: nextConnections });
                setActiveConnectionId(conn.id);
                setShowConnectionForm(false);
              }}
            />
          ) : null}

          <div className="panel">
            <PanelHeader icon={Search} title="Component Lookup" action={`${lookupResults.length}`} />
            <div className="mt-4 space-y-3">
              <input
                value={lookupFilter}
                onChange={(e) => setLookupFilter(e.target.value)}
                placeholder="Filter by name or component ID…"
                className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
              />
              <button
                className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d] disabled:opacity-50"
                onClick={lookupComponents}
                disabled={!activeConnectionId || lookupBusy}
                type="button"
              >
                {lookupBusy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                {lookupBusy ? "Searching…" : "Lookup components"}
              </button>
              {lookupError ? <p className="text-xs text-[#9c2a2a]">{lookupError}</p> : null}
              <div className="max-h-64 space-y-2 overflow-auto">
                {lookupResults.map((comp) => (
                  <div key={`${comp.componentId}~${comp.version}`} className={clsx(
                    "flex items-center justify-between rounded-md border p-2",
                    comp.currentVersion
                      ? "border-[#298b68] bg-[#f0faf5]"
                      : "border-[#d9ded8] bg-white opacity-70",
                  )}>
                    <div>
                      <p className="text-sm font-semibold">
                        {comp.name}
                        <span className="ml-1 text-xs font-normal text-[#66706a]">v{comp.version}</span>
                        {comp.currentVersion ? (
                          <span className="ml-2 inline-flex items-center rounded-full bg-[#298b68] px-1.5 py-0.5 text-[10px] font-semibold text-white">CURRENT</span>
                        ) : (
                          <span className="ml-2 inline-flex items-center rounded-full bg-[#d9ded8] px-1.5 py-0.5 text-[10px] font-semibold text-[#66706a]">OLD</span>
                        )}
                      </p>
                      <p className="text-xs text-[#66706a]">{comp.type} · {comp.status}</p>
                    </div>
                    <button
                      className="inline-flex h-7 items-center gap-1 rounded-md bg-[#e3f3ed] px-2 text-xs font-medium text-[#1b5e4a] hover:bg-[#d0ece2] disabled:opacity-50"
                      onClick={() => importTemplate(comp)}
                      disabled={importBusy}
                      type="button"
                    >
                      <Download size={12} />
                      Import
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="panel">
            <PanelHeader icon={Network} title="Local Inventory" action={`${inventory.length}`} />
            <div className="mt-4 space-y-3">
              {inventory.map((component) => (
                <div key={component.id} className="rounded-md border border-[#d9ded8] bg-white p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{component.name}</p>
                    <StatusPill label={component.type} tone="gray" />
                  </div>
                  <p className="mt-1 text-xs text-[#66706a]">
                    {component.dependencyCount} dependencies · {component.status}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <PanelHeader
              icon={Network}
              title="Dependency Scan"
              action={dependencyScan ? `${dependencyScan.dependencies.length}` : "none"}
            />
            <div className="mt-4 space-y-3">
              <p className="text-xs text-[#66706a]">
                Scan an imported draft&apos;s XML for referenced Boomi components (sub-processes, maps, profiles,
                connectors) so they can be pulled into this project.
              </p>
              {activeDraft ? (
                <button
                  className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d] disabled:opacity-50"
                  onClick={() => scanDependencies(activeDraft)}
                  disabled={dependencyBusy || !activeDraft.templateXml?.trim()}
                  type="button"
                >
                  {dependencyBusy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                  {dependencyBusy ? "Scanning…" : `Scan "${activeDraft.componentName}"`}
                </button>
              ) : (
                <p className="text-sm text-[#66706a]">Select a draft to scan its dependencies.</p>
              )}
              {dependencyError ? <p className="text-xs text-[#9c2a2a]">{dependencyError}</p> : null}
              {dependencyScan ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-[#66706a]">
                    {dependencyScan.sourceComponentName} → {dependencyScan.dependencies.length} refs
                  </p>
                  {dependencyScan.dependencies.length === 0 ? (
                    <p className="text-xs text-[#66706a]">No component references found in this draft.</p>
                  ) : (
                    <div className="max-h-56 space-y-2 overflow-auto">
                      {dependencyScan.dependencies.map((dep) => (
                        <div key={dep.componentId} className="flex items-center justify-between gap-2 rounded-md border border-[#d9ded8] bg-white p-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-xs">{dep.componentId}</p>
                            <p className="text-xs text-[#66706a]">{dep.role}{dep.shapeType ? ` · ${dep.shapeType}` : ""}</p>
                          </div>
                          {dep.alreadyImported ? (
                            <StatusPill label="imported" tone="green" />
                          ) : (
                            <button
                              type="button"
                              className="inline-flex h-7 items-center gap-1 rounded-md bg-[#e3f3ed] px-2 text-xs font-medium text-[#1b5e4a] hover:bg-[#d0ece2] disabled:opacity-50"
                              onClick={() => importDependency(dep)}
                              disabled={dependencyBusy || !activeConnectionId}
                            >
                              <Download size={12} />
                              Import
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="panel min-w-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <PanelHeader icon={GitCompareArrows} title="Component XML Preview" action={dryRunState} />
            <div className="flex flex-wrap justify-end gap-2">
              <button
                className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d]"
                onClick={runDryRun}
                disabled={dryRunState === "running"}
                type="button"
              >
                <RefreshCw size={16} />
                Run dry-run
              </button>
              <button
                disabled={!activeDraft || !safetyCheck?.ok || publishBusy}
                className={clsx(
                  "inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50",
                  safetyCheck?.ok
                    ? "border-[#1b5e4a] bg-[#1b5e4a] text-white hover:bg-[#164d3d]"
                    : "border-[#cfd6cf] bg-[#eef1ee] text-[#66706a]",
                )}
                onClick={publishDraft}
                type="button"
              >
                {publishBusy ? <RefreshCw size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                {publishBusy ? "Publishing..." : "Publish to sandbox"}
              </button>
            </div>
          </div>

          {importError ? <p className="mt-3 text-sm text-[#9c2a2a]">{importError}</p> : null}
          {importSuccess ? <p className="mt-3 text-sm text-[#298b68]">{importSuccess}</p> : null}
          {publishError ? <p className="mt-3 text-sm text-[#9c2a2a]">{publishError}</p> : null}
          {publishSuccess ? <p className="mt-3 text-sm text-[#298b68]">{publishSuccess}</p> : null}
          {dryRunError ? (
            <div className="mt-3 flex gap-2 rounded-md border border-[#f0c7c7] bg-[#fff8f8] p-3 text-sm text-[#9c2a2a]" role="alert">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">Dry-run failed</p>
                <p className="mt-1 leading-5">{dryRunError}</p>
              </div>
            </div>
          ) : null}

          {project.boomiDrafts.length > 0 ? (
            <div className="mt-4 grid grid-cols-3 gap-3">
              {project.boomiDrafts.map((draft) => (
                <button
                  key={draft.id}
                  className={clsx(
                    "rounded-md border p-3 text-left text-sm",
                    activeDraft?.id === draft.id
                      ? "border-[#298b68] bg-[#e3f3ed]"
                      : "border-[#d9ded8] bg-white hover:border-[#9fb7aa]",
                  )}
                  onClick={() => setActiveDraft(draft)}
                  type="button"
                >
                  <p className="font-semibold">{draft.componentName}</p>
                  <p className="mt-1 text-xs text-[#66706a]">{draft.componentType}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-[#66706a]">No drafts yet. Run a dry-run or import a template.</p>
          )}

          {activeDraft ? (
            <>
              <div className="mt-4 grid grid-cols-1 gap-4 2xl:grid-cols-2">
                <CodePanel title="Proposed XML" value={activeDraft.proposedXml} format="xml" />
                <CodePanel title="Diff" value={activeDraft.diff} />
              </div>
              <div className="mt-4 rounded-md border border-[#d9ded8] bg-[#fbfbfa] p-4">
                <div className="flex items-center gap-2">
                  {activeDraft.validationStatus === "Dry-run valid" ? (
                    <CheckCircle2 className="text-[#298b68]" size={18} />
                  ) : (
                    <AlertTriangle className="text-[#b77816]" size={18} />
                  )}
                  <p className="text-sm font-semibold">{activeDraft.validationStatus}</p>
                </div>
                <p className="mt-2 text-sm leading-6 text-[#66706a]">{activeDraft.notes}</p>
              </div>
              {safetyCheck ? (
                <div className="mt-4 rounded-md border border-[#d9ded8] bg-[#fbfbfa] p-4">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={18} className={safetyCheck.ok ? "text-[#298b68]" : "text-[#9c2a2a]"} />
                    <p className="text-sm font-semibold">Publish Safety Check</p>
                  </div>
                  {safetyCheck.blockers.length > 0 ? (
                    <ul className="mt-2 list-disc pl-5 text-sm text-[#9c2a2a]">
                      {safetyCheck.blockers.map((b, i) => <li key={i}>{b}</li>)}
                    </ul>
                  ) : null}
                  {safetyCheck.warnings.length > 0 ? (
                    <ul className="mt-2 list-disc pl-5 text-sm text-[#b77816]">
                      {safetyCheck.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  ) : null}
                  {safetyCheck.ok && safetyCheck.warnings.length === 0 ? (
                    <p className="mt-2 text-sm text-[#298b68]">No blockers or warnings. Ready for sandbox review.</p>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-4 rounded-md border border-[#d9ded8] bg-white p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck size={18} className="text-[#66706a]" />
                    <p className="text-sm font-semibold">Publish History</p>
                  </div>
                  <StatusPill label={`${publishEvents.length}`} tone="gray" />
                </div>
                {publishEvents.length > 0 ? (
                  <div className="mt-3 max-h-56 space-y-2 overflow-auto">
                    {publishEvents.slice(0, 8).map((event) => (
                      <div key={event.id} className="rounded-md border border-[#e1e6e1] bg-[#fbfbfa] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm font-semibold">{event.componentName}</p>
                          <div className="flex items-center gap-2">
                            <StatusPill label={event.status} tone={event.status === "success" ? "green" : "red"} />
                            {event.status === "success"
                              && event.action === "update"
                              && event.requestXml
                              && !/same configuration values as the previous version/i.test(event.responseXml ?? "") ? (
                              <button
                                className="inline-flex h-7 items-center gap-1 rounded-md border border-[#cfd6cf] bg-white px-2 text-xs font-medium text-[#1b5e4a] hover:bg-[#e3f3ed] disabled:opacity-50"
                                onClick={() => rollbackPublish({ id: event.id, componentName: event.componentName, componentType: event.componentType })}
                                disabled={publishBusy}
                                title="Rollback to this version"
                                type="button"
                              >
                                <RefreshCw size={12} />
                                Rollback
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-[#66706a]">
                          {event.action} · {event.componentType}
                          {event.version ? ` · v${event.version}` : ""} · {new Date(event.publishedAt).toLocaleString()}
                        </p>
                        {event.errorDetail ? (
                          <p className="mt-2 text-xs leading-5 text-[#9c2a2a]">{event.errorDetail}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-[#66706a]">No sandbox publish attempts recorded yet.</p>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </WorkspacePanel>
  );
}

export function ConnectionForm({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (conn: BoomiConnection) => void;
}) {
  const [form, setForm] = useState({
    accountId: "",
    environmentName: "",
    baseUrl: "https://api.boomi.com",
    apiUsername: "",
    apiPassword: "",
    mode: "sandbox" as "mock" | "sandbox",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate() {
    const errors: Record<string, string> = {};
    if (!form.accountId.trim()) errors.accountId = "Account ID is required.";
    if (!form.environmentName.trim()) errors.environmentName = "Environment name is required.";
    if (!form.baseUrl.trim()) errors.baseUrl = "Base URL is required.";
    else {
      try { new URL(form.baseUrl); } catch { errors.baseUrl = "Must be a valid URL."; }
    }
    if (!form.apiUsername.trim()) errors.apiUsername = "API username is required.";
    if (!form.apiPassword.trim()) errors.apiPassword = "API password is required.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function save() {
    setError(null);
    setFieldErrors({});
    if (!validate()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/boomi/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          projectId,
          authMode: "Basic API Token",
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (body?.issues) {
          const messages = body.issues.map((issue: { path: string[]; message: string }) =>
            `${issue.path.join(".")}: ${issue.message}`,
          );
          throw new Error(messages.join("; "));
        }
        const errMsg = typeof body?.error === "string"
          ? body.error
          : typeof body?.detail === "string"
            ? body.detail
            : `Failed to create connection (${response.status}).`;
        throw new Error(errMsg);
      }
      const data = (await response.json()) as { connection: BoomiConnection };
      onCreated(data.connection);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create connection");
    } finally {
      setBusy(false);
    }
  }

  function setField(field: string, value: string) {
    setForm({ ...form, [field]: value });
    if (fieldErrors[field]) setFieldErrors({ ...fieldErrors, [field]: "" });
  }

  function fieldClass(field: string) {
    return clsx("h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]", fieldErrors[field] && "border-[#9c2a2a] focus:border-[#9c2a2a]");
  }

  return (
    <div className="panel">
      <PanelHeader icon={Plus} title="New Connection" />
      <div className="mt-4 space-y-3">
        <Labeled label="Account ID">
          <input value={form.accountId} onChange={(e) => setField("accountId", e.target.value)} placeholder="e.g. ABC12345" className={fieldClass("accountId")} />
          {fieldErrors.accountId ? <p className="mt-1 text-xs text-[#9c2a2a]">{fieldErrors.accountId}</p> : null}
        </Labeled>
        <Labeled label="Environment Name">
          <input value={form.environmentName} onChange={(e) => setField("environmentName", e.target.value)} placeholder="e.g. Sandbox" className={fieldClass("environmentName")} />
          {fieldErrors.environmentName ? <p className="mt-1 text-xs text-[#9c2a2a]">{fieldErrors.environmentName}</p> : null}
        </Labeled>
        <Labeled label="Base URL">
          <input value={form.baseUrl} onChange={(e) => setField("baseUrl", e.target.value)} className={fieldClass("baseUrl")} />
          {fieldErrors.baseUrl ? <p className="mt-1 text-xs text-[#9c2a2a]">{fieldErrors.baseUrl}</p> : null}
        </Labeled>
        <Labeled label="API Username">
          <input value={form.apiUsername} onChange={(e) => setField("apiUsername", e.target.value)} type="text" className={fieldClass("apiUsername")} />
          {fieldErrors.apiUsername ? <p className="mt-1 text-xs text-[#9c2a2a]">{fieldErrors.apiUsername}</p> : null}
        </Labeled>
        <Labeled label="API Password">
          <input value={form.apiPassword} onChange={(e) => setField("apiPassword", e.target.value)} type="password" className={fieldClass("apiPassword")} />
          {fieldErrors.apiPassword ? <p className="mt-1 text-xs text-[#9c2a2a]">{fieldErrors.apiPassword}</p> : null}
        </Labeled>
        <Labeled label="Mode">
          <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as "mock" | "sandbox" })} className={fieldClass("mode")}>
            <option value="sandbox">Sandbox</option>
            <option value="mock">Mock</option>
          </select>
        </Labeled>
        {error ? <p className="text-sm text-[#9c2a2a]">{error}</p> : null}
        <div className="flex gap-2">
          <button
            className="inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d] disabled:opacity-50"
            onClick={save}
            disabled={busy}
            type="button"
          >
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
            {busy ? "Creating…" : "Create connection"}
          </button>
          <button
            className="inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-md border border-[#cfd6cf] bg-white px-3 text-sm font-medium text-[#111714] hover:bg-[#eef1ee]"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
