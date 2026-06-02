"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  Download,
  GitCompareArrows,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import clsx from "clsx";
import type {
  Project,
} from "@/lib/domain";
import { PanelHeader, StatusPill, WorkspacePanel, InfoRow } from "@/components/atoms";
import { extractError } from "@/lib/api-utils";
import { useToast } from "@/components/toast";
import { useConnections } from "@/hooks/use-connections";

type CompanionPackage = {
  packageId: string;
  status?: string;
  manifest: {
    fileCount: number;
    files: { filename: string; size: number }[];
    readinessStatus: string;
  };
  readiness: {
    overallStatus: string;
    checks: { category: string; status: string; message: string; details?: string[] }[];
  };
};

type PipelineStepUI = {
  step: number;
  phase: string;
  stepName: string;
  status: "running" | "ok" | "failed" | "reused";
  componentId?: string;
  componentType?: string;
  componentName?: string;
  error?: string;
  durationMs?: number;
};

type BuildStatus = "idle" | "building" | "complete" | "failed";

function parseEventData<T>(event: Event): T | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string" || event.data.length === 0) return null;
  try { return JSON.parse(event.data) as T; } catch { return null; }
}

export function BoomiCompanionTab({
  project,
  setProject,
}: {
  project: Project;
  setProject: (project: Project) => void;
}) {
  const toast = useToast();
  const { connections } = useConnections(project.boomiConnections);
  const [activeConnectionId, setActiveConnectionId] = useState(project.boomiConnections[0]?.id ?? "");
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);

  const [buildBusy, setBuildBusy] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [companionPackage, setCompanionPackage] = useState<CompanionPackage | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);

  const [resultJson, setResultJson] = useState("");
  const [resultBusy, setResultBusy] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const [resultSuccess, setResultSuccess] = useState<string | null>(null);

  const [buildStatus, setBuildStatus] = useState<BuildStatus>("idle");
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStepUI[]>([]);
  const [buildSummary, setBuildSummary] = useState<{ totalSteps: number; ok: number; failed: number; reused: number } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => { return () => eventSourceRef.current?.close(); }, []);

  const selectedConnectionId = connections.some((c) => c.id === activeConnectionId) ? activeConnectionId : connections[0]?.id ?? "";
  const activeConnection = connections.find((c) => c.id === selectedConnectionId);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/boomi/companion/packages?projectId=${encodeURIComponent(project.id)}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = await res.json() as { package: CompanionPackage | null };
        if (!ctrl.signal.aborted) setCompanionPackage(data.package);
      } catch {
        // silent
      }
    })();
    return () => ctrl.abort();
  }, [project.id]);

  function resetBuild() {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setBuildStatus("idle");
    setPipelineSteps([]);
    setBuildSummary(null);
  }

  async function testConnection() {
    if (!selectedConnectionId) { setConnectionStatus("No connection selected."); return; }
    setConnectionStatus("testing");
    try {
      const res = await fetch("/api/boomi/connections", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selectedConnectionId }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `Test failed (${res.status})`);
      const result = body?.result as { ok?: boolean; message?: string } | undefined;
      setConnectionStatus(result?.ok ? `Connected: ${result.message ?? "OK"}` : `Failed: ${result?.message ?? "Unknown"}`);
    } catch (err) {
      setConnectionStatus(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  }

  async function generateBuildPackage() {
    setBuildBusy(true);
    setBuildError(null);
    setCompanionPackage(null);
    resetBuild();
    try {
      const res = await fetch("/api/boomi/companion/packages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: project.id }) });
      if (!res.ok) throw new Error(await extractError(res));
      const data = await res.json() as CompanionPackage & { project?: Project };
      setCompanionPackage(data);
      if (data.project) setProject(data.project);
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : "Build package generation failed.");
    } finally { setBuildBusy(false); }
  }

  async function downloadPackage() {
    if (!companionPackage) return;
    setDownloadBusy(true);
    try {
      const res = await fetch(`/api/boomi/companion/packages/${companionPackage.packageId}/download`);
      if (!res.ok) throw new Error(await extractError(res));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `boomi-companion-package-${project.name.replace(/[^a-zA-Z0-9_-]/g, "-")}-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.addToast({ message: err instanceof Error ? err.message : "Download failed", type: "error" });
    } finally { setDownloadBusy(false); }
  }

  async function runDirectBuild() {
    if (!companionPackage || !selectedConnectionId) return;
    resetBuild();
    setBuildStatus("building");

    try {
      const res = await fetch(`/api/boomi/companion/packages/${companionPackage.packageId}/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: selectedConnectionId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? err?.detail ?? `Build start failed (${res.status})`);
      }
      const data = await res.json() as { eventsUrl: string };

      const es = new EventSource(data.eventsUrl);
      eventSourceRef.current = es;
      let received = false;

      es.addEventListener("connected", () => { received = true; });

      es.addEventListener("progress", (e) => {
        received = true;
        const step = parseEventData<PipelineStepUI>(e);
        if (!step) return;
        setPipelineSteps((prev) => {
          const idx = prev.findIndex((s) => s.step === step.step && s.phase === step.phase);
          if (idx >= 0) { const next = [...prev]; next[idx] = step; return next; }
          return [...prev, step];
        });
      });

      es.addEventListener("complete", (e) => {
        received = true;
        const summary = parseEventData<{ totalSteps: number; ok: number; failed: number; reused: number; componentIds: Record<string, string> }>(e);
        if (summary) {
          setBuildSummary(summary);
          setBuildStatus(summary.failed > 0 ? "failed" : "complete");
          toast.addToast({ message: `Build done: ${summary.ok} created, ${summary.reused ?? 0} reused`, type: summary.failed > 0 ? "error" : "success" });
        } else {
          setBuildStatus("complete");
        }
        es.close();
        eventSourceRef.current = null;
      });

      es.addEventListener("error", (e) => {
        if (e instanceof MessageEvent && e.data) {
          const err = parseEventData<{ message?: string; phase?: string }>(e);
          if (err?.message) toast.addToast({ message: err.message, type: "error" });
        }
        if (es.readyState === EventSource.CLOSED && !received) {
          setBuildStatus("failed");
        }
      });

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED && !received) setBuildStatus("failed");
      };
    } catch (err) {
      setBuildStatus("failed");
      toast.addToast({ message: err instanceof Error ? err.message : "Build failed", type: "error" });
    }
  }

  async function recordResult() {
    if (!companionPackage || !resultJson.trim()) return;
    setResultBusy(true); setResultError(null); setResultSuccess(null);
    try {
      let parsed: unknown;
      try { parsed = JSON.parse(resultJson); } catch { throw new Error("Invalid JSON"); }
      const res = await fetch(`/api/boomi/companion/packages/${companionPackage.packageId}/result`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result: parsed, runStatus: "manual_result_recorded" }),
      });
      if (!res.ok) { const e = await res.json().catch(() => null); throw new Error(e?.detail ?? "Failed"); }
      setResultSuccess("Result recorded.");
    } catch (err) {
      setResultError(err instanceof Error ? err.message : "Failed");
    } finally { setResultBusy(false); }
  }

  const publishEvents = (project.boomiPublishEvents ?? []).slice(0, 8);
  const canBuild = Boolean(selectedConnectionId && activeConnection?.mode === "sandbox" && companionPackage && buildStatus !== "building");

  const readinessIcon = (status: string) => {
    switch (status) {
      case "ok": return <CheckCircle2 size={14} className="text-[#298b68]" />;
      case "warning": return <AlertTriangle size={14} className="text-[#b77816]" />;
      case "error": return <XCircle size={14} className="text-[#9c2a2a]" />;
      default: return null;
    }
  };

  return (
    <WorkspacePanel>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
        <div className="space-y-5">
          <div className="panel">
            <PanelHeader icon={Braces} title="Boomi Connection" action={activeConnection?.mode ?? "none"} />
            <div className="mt-4 space-y-3">
              {connections.length > 0 ? (
                <select value={selectedConnectionId} onChange={(e) => { setActiveConnectionId(e.target.value); setConnectionStatus(null); }} className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]">
                  {connections.map((c) => (<option key={c.id} value={c.id}>{c.environmentName} ({c.accountId})</option>))}
                </select>
              ) : (<p className="text-sm text-[#66706a]">No connections configured.</p>)}
              {activeConnection ? (
                <div className="space-y-1">
                  <InfoRow label="Account" value={activeConnection.accountId} />
                  <InfoRow label="Environment" value={activeConnection.environmentName} />
                  <InfoRow label="Base URL" value={activeConnection.baseUrl} />
                  <div className="flex items-center gap-2">
                    <InfoRow label="Mode" value={activeConnection.mode} />
                    {activeConnection.mode === "sandbox"
                      ? <span className="inline-flex items-center rounded-full bg-[#e3f3ed] px-2 py-0.5 text-[10px] font-semibold text-[#1b5e4a]">Live</span>
                      : <span className="inline-flex items-center rounded-full bg-[#fef3c7] px-2 py-0.5 text-[10px] font-semibold text-[#b77816]">Mock</span>}
                  </div>
                </div>
              ) : null}
              {connectionStatus ? (
                <p className={clsx("text-xs", connectionStatus.startsWith("Connected") ? "text-[#298b68]" : "text-[#9c2a2a]")}>{connectionStatus}</p>
              ) : null}
              <div className="flex gap-2">
                <button className="inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d] disabled:opacity-50" onClick={testConnection} disabled={!selectedConnectionId} type="button"><RefreshCw size={14} /> Test</button>
                <a className="inline-flex h-8 items-center justify-center rounded-md border border-[#cfd6cf] bg-white px-3 text-sm font-medium text-[#111714] hover:bg-[#eef1ee]" href="/admin/connections">Manage</a>
              </div>
            </div>
          </div>
          {publishEvents.length > 0 ? (
            <div className="panel">
              <PanelHeader icon={ShieldCheck} title="Publish History" action={`${publishEvents.length}`} />
              <div className="mt-3 max-h-64 overflow-auto space-y-2">
                {publishEvents.map((e) => (
                  <div key={e.id} className="rounded-md border border-[#e1e6e1] bg-[#fbfbfa] p-2">
                    <div className="flex items-center justify-between"><span className="text-xs font-mono text-[#111714] truncate">{e.componentName}</span><StatusPill label={e.action} tone={e.status === "success" ? "green" : "red"} /></div>
                    <p className="text-[10px] text-[#66706a] mt-0.5">{e.componentType} · {e.status} · {new Date(e.publishedAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-5 min-w-0">
          <div className="panel">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <PanelHeader icon={Package} title="Companion Build Center" action={companionPackage ? companionPackage.readiness.overallStatus : "idle"} />
              <div className="flex flex-wrap justify-end gap-2">
                <button className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d] disabled:opacity-50" onClick={generateBuildPackage} disabled={buildBusy} type="button">
                  {buildBusy ? <RefreshCw size={16} className="animate-spin" /> : <Package size={16} />}
                  {buildBusy ? "Generating..." : "Generate"}
                </button>
                {companionPackage ? (
                  <>
                    <button className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md bg-gradient-to-r from-[#1b5e4a] to-[#237a5a] px-3 text-sm font-medium text-white hover:from-[#164d3d] hover:to-[#1b5e4a] disabled:opacity-50"
                      onClick={runDirectBuild}
                      disabled={!canBuild}
                      title={!selectedConnectionId ? "Select a Boomi connection" : activeConnection?.mode !== "sandbox" ? "Switch to sandbox mode" : buildStatus === "building" ? "Build in progress" : "Push components to Boomi"}
                      type="button">
                      {buildStatus === "building" ? <Loader2 size={16} className="animate-spin" /> : <GitCompareArrows size={16} />}
                      {buildStatus === "building" ? "Pushing..." : "Push to Boomi"}
                    </button>
                    <button className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-[#1b5e4a] bg-white px-3 text-sm font-medium text-[#1b5e4a] hover:bg-[#e3f3ed] disabled:opacity-50" onClick={downloadPackage} disabled={downloadBusy} type="button"><Download size={16} /> Download</button>
                  </>
                ) : null}
              </div>
            </div>

            {buildError ? (
              <div className="mt-3 flex gap-2 rounded-md border border-[#f0c7c7] bg-[#fff8f8] p-3 text-sm text-[#9c2a2a]" role="alert">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div><p>{buildError}</p><button className="mt-2 inline-flex h-7 items-center gap-1 rounded-md border border-[#cfd6cf] bg-white px-2 text-xs font-medium text-[#111714] hover:bg-[#eef1ee]" onClick={generateBuildPackage} disabled={buildBusy} type="button"><RefreshCw size={12} /> Retry</button></div>
              </div>
            ) : null}

            {!companionPackage ? (
              <div className="mt-6 rounded-md border border-dashed border-[#cfd6cf] bg-[#fbfbfa] p-8 text-center">
                <Package size={40} className="mx-auto mb-3 text-[#9fb7aa]" />
                <p className="text-sm font-semibold text-[#111714]">No build package yet</p>
                <p className="mt-1 text-sm text-[#66706a]">Click Generate to create a build package from this project&apos;s profiles, mappings, and process flow.</p>
              </div>
            ) : (
              <>
                <div className="mt-4 rounded-md border border-[#d9ded8] bg-[#fbfbfa] p-4">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={18} className={companionPackage.readiness.overallStatus === "ready" ? "text-[#298b68]" : "text-[#b77816]"} />
                    <p className="text-sm font-semibold">Readiness</p>
                  </div>
                  <div className="mt-3 space-y-2">
                    {companionPackage.readiness.checks.map((c, i) => (
                      <div key={i} className="rounded-md border border-[#e1e6e1] bg-white p-2">
                        <div className="flex items-start gap-2">{readinessIcon(c.status)}<div><p className="text-xs font-semibold">{c.category}</p><p className="text-xs text-[#66706a]">{c.message}</p></div></div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 rounded-md border border-[#d9ded8] bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><Package size={18} className="text-[#298b68]" /><p className="text-sm font-semibold">Package</p></div>
                    <StatusPill label={`${companionPackage.manifest.fileCount} files`} tone="gray" />
                  </div>
                  <div className="mt-3 max-h-48 overflow-auto">
                    {companionPackage.manifest.files.map((f) => (<div key={f.filename} className="flex items-center justify-between py-1 text-xs"><span className="font-mono text-[#111714]">{f.filename}</span><span className="text-[#66706a]">{f.size > 1024 ? `${(f.size / 1024).toFixed(1)}KB` : `${f.size}B`}</span></div>))}
                  </div>
                </div>

                {buildStatus !== "idle" && (
                  <div className="mt-4 rounded-md border border-[#d9ded8] bg-white p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {buildStatus === "building" ? <Loader2 size={18} className="animate-spin text-[#298b68]" /> : buildStatus === "complete" ? <CheckCircle2 size={18} className="text-[#298b68]" /> : <XCircle size={18} className="text-[#9c2a2a]" />}
                        <p className="text-sm font-semibold">Build Pipeline</p>
                      </div>
                      <StatusPill label={buildStatus.toUpperCase()} tone={buildStatus === "complete" ? "green" : buildStatus === "failed" ? "red" : "gray"} />
                    </div>
                    {buildSummary ? <p className="mt-2 text-xs text-[#66706a]">{buildSummary.ok} created{buildSummary.reused > 0 ? `, ${buildSummary.reused} reused` : ""}{buildSummary.failed > 0 ? `, ${buildSummary.failed} failed` : ""}</p> : null}
                    <div className="mt-3 space-y-1">
                      {pipelineSteps.map((step) => (
                        <div key={`${step.step}-${step.phase}`} className={clsx("flex items-center gap-2 rounded px-3 py-1.5 text-xs", step.status === "running" && "bg-[#f0faf5]", step.status === "failed" && "bg-[#fff8f8]")}>
                          {step.status === "ok" ? <CheckCircle2 size={14} className="text-[#298b68] shrink-0" /> : step.status === "running" ? <Loader2 size={14} className="animate-spin text-[#298b68] shrink-0" /> : step.status === "failed" ? <XCircle size={14} className="text-[#9c2a2a] shrink-0" /> : step.status === "reused" ? <CheckCircle2 size={14} className="text-[#66706a] shrink-0" /> : <span className="block h-3.5 w-3.5 rounded-full border border-[#cfd6cf] shrink-0" />}
                          <span className="flex-1 truncate">{step.stepName}</span>
                          {step.durationMs != null && <span className="text-[10px] text-[#66706a] tabular-nums shrink-0">{step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}</span>}
                          {step.componentId && <span className="text-[10px] text-[#298b68] font-mono shrink-0" title={step.componentId}>{step.componentId.slice(-8)}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 rounded-md border border-[#d9ded8] bg-white p-4">
                  <p className="text-sm font-semibold">Record Result</p>
                  <textarea value={resultJson} onChange={(e) => setResultJson(e.target.value)} placeholder="Paste result JSON..." className="mt-2 h-24 w-full rounded-md border border-[#cfd6cf] bg-white p-3 text-xs font-mono outline-none focus:border-[#298b68] resize-y" />
                  {resultError && <p className="mt-1 text-xs text-[#9c2a2a]">{resultError}</p>}
                  {resultSuccess && <p className="mt-1 text-xs text-[#298b68]">{resultSuccess}</p>}
                  <button className="mt-2 inline-flex h-8 items-center gap-2 rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d] disabled:opacity-50" onClick={recordResult} disabled={resultBusy || !resultJson.trim()} type="button">{resultBusy ? <RefreshCw size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Record</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </WorkspacePanel>
  );
}
