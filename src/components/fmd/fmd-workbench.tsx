"use client";

import { useCallback, useEffect, useMemo, useState, startTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Download,
  FileSpreadsheet,
  GitCompareArrows,
  Layers3,
  Network,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import clsx from "clsx";
import type { Project } from "@/lib/domain";
import { useFmdSections } from "@/hooks/use-fmd-sections";
import { useToast } from "@/components/toast";
import type { NormalizedFmdWorkbook } from "@/lib/fmd";
import type { FmdResolveResponse } from "@/lib/fmd-import";
import {
  categoriesForMode,
  detectFmdConflicts,
  type FmdApplyMode,
  type FmdApplyRequest,
  type FmdApplyResult,
  type FmdConflict,
} from "@/lib/fmd-apply";
import { PanelHeader, StatusPill, WorkspacePanel, InfoRow } from "@/components/atoms";
import { extractError } from "@/lib/api-utils";
import { FmdOutline } from "@/components/fmd/fmd-outline";
import { FmdContextPanel } from "@/components/fmd/fmd-context-panel";
import type { FmdSectionType } from "@/lib/fmd-section-schemas";
import { normalizeSectionType } from "@/lib/fmd-section-schemas";
import { computeImportDiffs, type SectionDiff } from "@/lib/fmd-section-diff";
import { createDefaultFmdSection, parseFmdSectionContent } from "@/lib/fmd-section-helpers";
import { registerEditor, getEditor } from "@/lib/fmd-editor-registry";
import { DocumentControlEditor } from "@/components/fmd/editors/document-control-editor";
import { ProjectSummaryEditor } from "@/components/fmd/editors/project-summary-editor";
import { PurposeScopeEditor } from "@/components/fmd/editors/purpose-scope-editor";
import { OverviewEditor } from "@/components/fmd/editors/overview-editor";
import { EndpointTableEditor } from "@/components/fmd/editors/endpoint-table-editor";
import { EnvironmentEditor } from "@/components/fmd/editors/environment-editor";
import { ErrorHandlingEditor } from "@/components/fmd/editors/error-handling-editor";
import { ProfileInventoryEditor } from "@/components/fmd/editors/profile-inventory-editor";
import { FieldDictionaryEditor } from "@/components/fmd/editors/field-dictionary-editor";
import { MappingTableEditor } from "@/components/fmd/editors/mapping-table-editor";
import { TransformationDetailsEditor } from "@/components/fmd/editors/transformation-details-editor";
import { ProcessFlowEditor } from "@/components/fmd/editors/process-flow-editor";
import { ChecklistEditor } from "@/components/fmd/editors/checklist-editor";
import { BoomiComponentsEditor } from "@/components/fmd/editors/boomi-components-editor";
import { TestCasesEditor } from "@/components/fmd/editors/test-cases-editor";
import { AppendixEditor } from "@/components/fmd/editors/appendix-editor";
import { LegacyEditor } from "@/components/fmd/editors/legacy-editor";

registerEditor("documentControl", DocumentControlEditor);
registerEditor("projectSummary", ProjectSummaryEditor);
registerEditor("purposeScope", PurposeScopeEditor);
registerEditor("integrationOverview", OverviewEditor);
registerEditor("endpointDetails", EndpointTableEditor);
registerEditor("environmentConfig", EnvironmentEditor);
registerEditor("errorHandling", ErrorHandlingEditor);
registerEditor("profileInventory", ProfileInventoryEditor);
registerEditor("fieldDictionary", FieldDictionaryEditor);
registerEditor("fieldMapping", MappingTableEditor);
registerEditor("transformationDetails", TransformationDetailsEditor);
registerEditor("processFlow", ProcessFlowEditor);
registerEditor("qualityChecklist", ChecklistEditor);
registerEditor("boomiComponents", BoomiComponentsEditor);
registerEditor("testCases", TestCasesEditor);
registerEditor("appendix", AppendixEditor);
registerEditor("legacy", LegacyEditor);

function FmdBuilder({
  project,
  setProject,
  setWorkspaceLockReason,
}: {
  project: Project;
  setProject: (project: Project) => void;
  setWorkspaceLockReason: (reason: string | null) => void;
}) {
  const [uploadState, setUploadState] = useState<"idle" | "resolving" | "done" | "error">("idle");
  const [summary, setSummary] = useState<NormalizedFmdWorkbook | null>(null);
  const [resolveResult, setResolveResult] = useState<FmdResolveResponse | null>(null);
  const [uploadFileName, setUploadFileName] = useState("");
  const [resolveStartedAt, setResolveStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importTab, setImportTab] = useState<"review" | "changes">("review");
  const [showImportSummary, setShowImportSummary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const resolving = uploadState === "resolving";
  const toast = useToast();

  const { sections: fmdSections, mutate: mutateFmd, completion } = useFmdSections(project.id);

  const sortedSections = useMemo(
    () => [...(fmdSections.length > 0 ? fmdSections : project.fmdSections)].sort((a, b) => a.sortOrder - b.sortOrder),
    [fmdSections, project.fmdSections],
  );

  const activeSection = useMemo(
    () => sortedSections.find((s) => s.id === activeSectionId) ?? null,
    [sortedSections, activeSectionId],
  );

  useEffect(() => {
    if (!resolveStartedAt || !resolving) return undefined;
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - resolveStartedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resolveStartedAt, resolving]);

  useEffect(() => {
    const pending = sessionStorage.getItem("pendingFmdImport");
    if (!pending) return;
    sessionStorage.removeItem("pendingFmdImport");
    try {
      const result = JSON.parse(pending) as FmdResolveResponse;
      startTransition(() => {
        setResolveResult(result);
        setSummary(result.summary);
        setUploadState("done");
        setShowImportPanel(true);
        setShowImportSummary(true);
        setProject({
          ...project,
          fmdSections: [
            ...project.fmdSections.filter((section) => section.id !== "fmd-last-import"),
            {
              id: "fmd-last-import",
              title: "Last FMD Import",
              sectionType: "reference",
              sortOrder: 99,
              content: {
                summary: result.summary,
                resolver: result.resolver,
                proposedProfiles: result.draft.profiles.length,
                proposedMappingSets: result.draft.mappingSets.length,
                warnings: result.draft.warnings,
              } as unknown as Record<string, unknown>,
            },
          ],
        });
      });
    } catch {
      // ignore stale data
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const pendingFileStr = sessionStorage.getItem("pendingFmdFile");
    if (!pendingFileStr) return;
    sessionStorage.removeItem("pendingFmdFile");
    try {
      const { name, type, base64 } = JSON.parse(pendingFileStr) as {
        name: string;
        type: string;
        base64: string;
      };
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], name, { type: type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      resolveFmdFile(file);
    } catch {
      // ignore corrupted data
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const hasPendingImport = sessionStorage.getItem("pendingFmdImport");
    if (summary || hasPendingImport) return;
    try {
      const stored = localStorage.getItem(`fmd-import-summary-${project.id}`);
      if (stored) {
        const parsed = JSON.parse(stored) as NormalizedFmdWorkbook;
        startTransition(() => {
          setShowImportSummary(true);
          setSummary(parsed);
        });
      }
    } catch {
      // ignore stale data
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  async function resolveFmdFile(file: File) {
    setUploadState("resolving");
    setUploadFileName(file.name);
    setResolveStartedAt(Date.now());
    setElapsedSeconds(0);
    setResolveResult(null);
    setSummary(null);
    setShowImportSummary(true);
    setWorkspaceLockReason("Resolving FMD");
    const formData = new FormData();
    formData.append("file", file);
    formData.append("model", "qwen3:8b");
    try {
      const response = await fetch("/api/fmd/resolve", { method: "POST", body: formData });
      if (!response.ok) {
        setUploadState("error");
        return;
      }
      const result = (await response.json()) as FmdResolveResponse;
      setResolveResult(result);
      setSummary(result.summary);
      try {
        localStorage.setItem(`fmd-import-summary-${project.id}`, JSON.stringify(result.summary));
      } catch { /* localStorage may be full */ }
      setProject({
        ...project,
        fmdSections: [
          ...project.fmdSections.filter((section) => section.id !== "fmd-last-import"),
          {
            id: "fmd-last-import",
            title: "Last FMD Import",
            sectionType: "reference",
            sortOrder: 99,
            content: {
              summary: result.summary,
              resolver: result.resolver,
              proposedProfiles: result.draft.profiles.length,
              proposedMappingSets: result.draft.mappingSets.length,
              warnings: result.draft.warnings,
            } as unknown as Record<string, unknown>,
          },
        ],
      });
      setUploadState("done");
      setShowImportPanel(true);
    } catch {
      setUploadState("error");
    } finally {
      setWorkspaceLockReason(null);
    }
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    await resolveFmdFile(file);
  }

  const handleAddSection = useCallback(
    async (sectionType: FmdSectionType) => {
      const maxOrder = sortedSections.reduce((max, s) => Math.max(max, s.sortOrder), 0);
      const section = createDefaultFmdSection(project, sectionType, {});
      const body = {
        title: section.title,
        sectionType,
        sortOrder: maxOrder + 1,
        content: section.content,
      };
      try {
        const res = await fetch(`/api/projects/${project.id}/fmd/sections`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await extractError(res));
        const data = (await res.json()) as { section: { id: string } };
        setProject({
          ...project,
          fmdSections: [
            ...project.fmdSections,
            { ...section, id: data.section.id, sortOrder: maxOrder + 1 } as Project["fmdSections"][number],
          ],
        });
        setActiveSectionId(data.section.id);
        await mutateFmd();
      } catch (err) {
        toast.addToast({
          message: err instanceof Error ? err.message : "Failed to add section",
          type: "error",
        });
      }
    },
    [project, sortedSections, setProject, mutateFmd, toast],
  );

  const handleSaveSection = useCallback(
    async (content: Record<string, unknown>, extra?: { title?: string; sectionType?: string }) => {
      if (!activeSectionId) return;
      setSaving(true);
      try {
        const body: Record<string, unknown> = { content };
        if (extra?.title !== undefined) body.title = extra.title;
        if (extra?.sectionType !== undefined) body.sectionType = extra.sectionType;
        const res = await fetch(`/api/projects/${project.id}/fmd/sections/${activeSectionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await extractError(res));
        const data = (await res.json()) as { section: { content: Record<string, unknown>; title?: string; sectionType?: string } };
        setProject({
          ...project,
          fmdSections: project.fmdSections.map((s) =>
            s.id === activeSectionId
              ? {
                  ...s,
                  content: data.section.content,
                  title: data.section.title ?? s.title,
                  sectionType: data.section.sectionType ?? s.sectionType,
                }
              : s,
          ),
        });
        await mutateFmd();
      } catch (err) {
        toast.addToast({
          message: err instanceof Error ? err.message : "Failed to save section",
          type: "error",
        });
      } finally {
        setSaving(false);
      }
    },
    [activeSectionId, project, setProject, mutateFmd, toast],
  );

  const handleInitializeFmd = useCallback(async () => {
    setInitializing(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/fmd/initialize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "from-project" }),
      });
      if (!res.ok) throw new Error(await extractError(res));
      await mutateFmd();
    } catch (err) {
      toast.addToast({
        message: err instanceof Error ? err.message : "Failed to initialize FMD",
        type: "error",
      });
    } finally {
      setInitializing(false);
    }
  }, [project.id, mutateFmd, toast]);

  const handleAddMissingSections = useCallback(async () => {
    setInitializing(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/fmd/initialize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "fill-missing" }),
      });
      if (!res.ok) throw new Error(await extractError(res));
      await mutateFmd();
      toast.addToast({ message: "Missing required sections added.", type: "success" });
    } catch (err) {
      toast.addToast({
        message: err instanceof Error ? err.message : "Failed to add missing sections",
        type: "error",
      });
    } finally {
      setInitializing(false);
    }
  }, [project.id, mutateFmd, toast]);

  const handleToggleExportEnabled = useCallback(async (sectionId: string) => {
    const section = sortedSections.find((s) => s.id === sectionId);
    if (!section) return;
    const content = parseFmdSectionContent(section.content);
    const nextExportEnabled = !content.exportEnabled;
    try {
      const res = await fetch(`/api/projects/${project.id}/fmd/sections/${sectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exportEnabled: nextExportEnabled }),
      });
      if (!res.ok) throw new Error(await extractError(res));
      await mutateFmd();
    } catch (err) {
      toast.addToast({
        message: err instanceof Error ? err.message : "Failed to toggle section visibility",
        type: "error",
      });
    }
  }, [project.id, sortedSections, mutateFmd, toast]);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDeleteSection = useCallback(() => {
    if (!activeSectionId) return;
    setShowDeleteConfirm(true);
  }, [activeSectionId]);

  const confirmDeleteSection = useCallback(async () => {
    if (!activeSectionId) return;
    setShowDeleteConfirm(false);
    try {
      const res = await fetch(`/api/projects/${project.id}/fmd/sections/${activeSectionId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await extractError(res));
      setActiveSectionId(null);
      setProject({
        ...project,
        fmdSections: project.fmdSections.filter((s) => s.id !== activeSectionId),
      });
      await mutateFmd();
    } catch (err) {
      toast.addToast({
        message: err instanceof Error ? err.message : "Failed to delete section",
        type: "error",
      });
    }
  }, [activeSectionId, project, setProject, mutateFmd, toast]);

  const handleDuplicateSection = useCallback(async () => {
    if (!activeSection) return;
    const maxOrder = sortedSections.reduce((max, s) => Math.max(max, s.sortOrder), 0);
    const body = {
      title: `${activeSection.title} (copy)`,
      sectionType: activeSection.sectionType,
      sortOrder: maxOrder + 1,
      content: activeSection.content,
    };
    try {
      const res = await fetch(`/api/projects/${project.id}/fmd/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await extractError(res));
      const data = (await res.json()) as { section: { id: string } };
      setProject({
        ...project,
        fmdSections: [
          ...project.fmdSections,
          { ...activeSection, id: data.section.id, title: body.title, sortOrder: maxOrder + 1 } as Project["fmdSections"][number],
        ],
      });
      setActiveSectionId(data.section.id);
      await mutateFmd();
    } catch (err) {
      toast.addToast({
        message: err instanceof Error ? err.message : "Failed to duplicate section",
        type: "error",
      });
    }
  }, [activeSection, project, sortedSections, setProject, mutateFmd, toast]);

  const handleRefreshSection = useCallback(async () => {
    if (!activeSectionId) return;
    try {
      const res = await fetch(`/api/projects/${project.id}/fmd/sections/${activeSectionId}/refresh`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(await extractError(res));
      const data = (await res.json()) as { section: { content: Record<string, unknown> } };
      setProject({
        ...project,
        fmdSections: project.fmdSections.map((s) =>
          s.id === activeSectionId ? { ...s, content: data.section.content } : s,
        ),
      });
      await mutateFmd();
    } catch (err) {
      toast.addToast({
        message: err instanceof Error ? err.message : "Failed to refresh section",
        type: "error",
      });
    }
  }, [activeSectionId, project, setProject, mutateFmd, toast]);

  const handleReorder = useCallback(async (orderedIds: string[]) => {
    try {
      const res = await fetch(`/api/projects/${project.id}/fmd/sections/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      });
      if (!res.ok) throw new Error(await extractError(res));
      await mutateFmd();
    } catch (err) {
      toast.addToast({
        message: err instanceof Error ? err.message : "Failed to reorder sections",
        type: "error",
      });
    }
  }, [project.id, mutateFmd, toast]);

  return (
    <WorkspacePanel>
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[#d9ded8] px-4 py-2">
        <div className="flex items-center gap-2">
          <PanelHeader icon={FileSpreadsheet} title="FMD Workbench" action={`${sortedSections.length} sections`} />
        </div>
        <div className="flex items-center gap-2">
          {sortedSections.length === 0 ? (
            <button
              type="button"
              onClick={handleInitializeFmd}
              disabled={initializing}
              className={clsx(
                "inline-flex h-8 items-center gap-1.5 rounded-md border border-[#cfd6cf] bg-white px-3 text-xs font-medium hover:border-[#298b68]",
                initializing && "cursor-not-allowed opacity-55",
              )}
            >
              {initializing ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
              {initializing ? "Initializing..." : "Initialize FMD"}
            </button>
          ) : completion.totalRequired > completion.requiredPresent ? (
            <button
              type="button"
              onClick={handleAddMissingSections}
              disabled={initializing}
              className={clsx(
                "inline-flex h-8 items-center gap-1.5 rounded-md border border-[#e8c8a8] bg-[#fff8e8] px-3 text-xs font-medium text-[#7a5211] hover:border-[#298b68]",
                initializing && "cursor-not-allowed opacity-55",
              )}
            >
              {initializing ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
              {initializing ? "Adding..." : `Add missing required (${completion.totalRequired - completion.requiredPresent})`}
            </button>
          ) : null}
          {completion.totalRequired > 0 ? (
            <span className="text-xs text-[#66706a]">
              {completion.requiredPresent}/{completion.totalRequired} required
            </span>
          ) : null}
          <label
            className={clsx(
              "inline-flex h-8 items-center gap-1.5 rounded-md border border-[#298b68] bg-[#e3f3ed] px-3 text-xs font-medium text-[#1b5e4a] hover:bg-[#cfe1d9]",
              resolving ? "cursor-not-allowed opacity-55" : "cursor-pointer",
            )}
          >
            {resolving ? <RefreshCw size={13} className="animate-spin" /> : <Upload size={13} />}
            {resolving ? "Resolving..." : "Import + resolve"}
            <input
              className="hidden"
              type="file"
              accept=".xlsx,.xls"
              onChange={onFileChange}
              disabled={resolving}
            />
          </label>
          <button
            type="button"
            onClick={() => setShowImportSummary(!showImportSummary)}
            className={clsx(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs",
              showImportSummary
                ? "border-[#298b68] bg-[#e3f3ed] text-[#1b5e4a]"
                : "border-[#cfd6cf] bg-white text-[#4a524d] hover:border-[#298b68]",
            )}
          >
            Summary
          </button>
          <div className="ml-auto">
            <FmdExportControls projectId={project.id} resolving={resolving} />
          </div>
        </div>
      </div>

      {/* Three-pane layout */}
      <div className="flex h-[calc(100vh-16rem)] gap-0">
        {/* Left: Outline */}
        <div className="w-64 shrink-0 border-r border-[#d9ded8] bg-white">
          <FmdOutline
            sections={sortedSections}
            activeSectionId={activeSectionId}
            onSelectSection={setActiveSectionId}
            onAddSection={handleAddSection}
            onReorder={handleReorder}
            onToggleExportEnabled={handleToggleExportEnabled}
          />
        </div>

        {/* Center: Editor */}
        <div className="min-w-0 flex-1 overflow-auto bg-[#fbfbfa]">
          {activeSection ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-[#d9ded8] px-4 py-2">
                <h2 className="text-sm font-semibold">{activeSection.title}</h2>
                <div className="relative flex items-center gap-1">
                  {saving ? (
                    <span className="flex items-center gap-1 text-xs text-[#66706a]">
                      <RefreshCw size={12} className="animate-spin" /> Saving...
                    </span>
                  ) : null}
                  <StatusPill label={activeSection.sectionType} tone="gray" />
                  {(() => {
                    const content = parseFmdSectionContent(activeSection.content);
                    const showRefresh = content.sourceMode === "derived" || content.sourceMode === "mixed";
                    return (
                      <>
                        {showRefresh ? (
                          <button type="button" onClick={handleRefreshSection} className="grid h-7 w-7 place-items-center rounded-md text-[#66706a] hover:bg-[#eef1ee] hover:text-[#1b1f23]" aria-label="Refresh from source">
                            <RefreshCw size={14} />
                          </button>
                        ) : null}
                        <button type="button" onClick={handleDuplicateSection} className="grid h-7 w-7 place-items-center rounded-md text-[#66706a] hover:bg-[#eef1ee] hover:text-[#1b1f23]" aria-label="Duplicate section">
                          <Copy size={14} />
                        </button>
                        <button type="button" onClick={handleDeleteSection} className="grid h-7 w-7 place-items-center rounded-md text-[#66706a] hover:bg-[#eef1ee] hover:text-[#1b1f23]" aria-label="Delete section">
                          <Trash2 size={14} />
                        </button>
                        {showDeleteConfirm ? (
                          <div className="absolute right-4 top-full z-50 mt-1 flex items-center gap-2 rounded-md border border-[#d9ded8] bg-white px-3 py-2 shadow-lg">
                            <span className="text-xs text-[#66706a]">Delete this section?</span>
                            <button type="button" onClick={confirmDeleteSection} className="inline-flex h-7 items-center rounded-md bg-[#9c2a2a] px-2 text-xs font-medium text-white hover:bg-[#7a2424]">Yes</button>
                            <button type="button" onClick={() => setShowDeleteConfirm(false)} className="inline-flex h-7 items-center rounded-md border border-[#cfd6cf] px-2 text-xs font-medium text-[#4a524d] hover:bg-[#eef1ee]">No</button>
                          </div>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4">
                {(() => {
                  const normalizedType = normalizeSectionType(activeSection.sectionType);
                  const Editor = getEditor(normalizedType) ?? getEditor("legacy");
                  if (Editor) {
                    return (
                      <Editor
                        key={activeSection.id}
                        section={activeSection}
                        project={project}
                        onSave={handleSaveSection}
                        saving={saving}
                      />
                    );
                  }
                  return (
                    <div className="flex h-full items-center justify-center text-sm text-[#66706a]">
                      No editor available for this section type.
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <FileSpreadsheet size={40} className="mx-auto text-[#cfd6cf]" />
                <p className="mt-3 text-sm font-medium text-[#66706a]">
                  Select or create a section
                </p>
                <p className="mt-1 text-xs text-[#66706a]">
                  Use the outline to navigate sections, or click + to add a new one
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right: Context panel */}
        <div className="w-64 shrink-0 border-l border-[#d9ded8] bg-white">
          <FmdContextPanel section={activeSection} />
        </div>
      </div>

      {/* Conditional import summary strip */}
      {showImportSummary && (
        <div className="border-t border-[#d9ded8] bg-white">
          <div className="flex items-center justify-between px-4 py-2">
            <p className="text-xs font-semibold uppercase text-[#66706a]">
              Import Summary
            </p>
            <button
              type="button"
              onClick={() => setShowImportSummary(false)}
              className="grid h-6 w-6 place-items-center rounded text-[#66706a] hover:bg-[#eef1ee]"
              aria-label="Close import summary"
            >
              <X size={13} />
            </button>
          </div>
          {resolving ? (
            <div className="px-4 pb-4">
              <FmdResolveProgress fileName={uploadFileName} elapsedSeconds={elapsedSeconds} />
            </div>
          ) : summary ? (
            <div className="space-y-3 px-4 pb-4">
              <InfoRow label="Filename" value={summary.filename} />
              <InfoRow label="Mapping Sheets" value={String(summary.mappingSheets)} />
              <InfoRow label="Design Sections" value={String(summary.designSections)} />
              <div className="max-h-[200px] overflow-auto rounded-md border border-[#d9ded8]">
                {summary.sheets.map((sheet) => (
                  <div key={sheet.name} className="border-b border-[#e3e7e2] bg-white p-2 last:border-b-0">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-xs font-medium">{sheet.name}</p>
                      <StatusPill label={sheet.role} tone="green" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="px-4 pb-4 text-xs text-[#66706a]">
              {uploadState === "error"
                ? "Resolver failed. Try again."
                : "Import a workbook to see a summary."}
            </div>
          )}
        </div>
      )}

      {/* Import review modal */}
      {resolveResult && showImportPanel ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/30 pt-10">
          <div className="relative w-full max-w-5xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#d9ded8] px-4 py-3">
              <p className="text-sm font-semibold">Import Review</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setImportTab("review")}
                  className={clsx(
                    "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
                    importTab === "review"
                      ? "bg-[#e3f3ed] text-[#1b5e4a]"
                      : "text-[#66706a] hover:bg-[#eef1ee]",
                  )}
                >
                  <CheckCircle2 size={13} />
                  Review
                </button>
                <button
                  type="button"
                  onClick={() => setImportTab("changes")}
                  className={clsx(
                    "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
                    importTab === "changes"
                      ? "bg-[#e3f3ed] text-[#1b5e4a]"
                      : "text-[#66706a] hover:bg-[#eef1ee]",
                  )}
                >
                  <GitCompareArrows size={13} />
                  Changes
                </button>
                <button
                  type="button"
                  onClick={() => setShowImportPanel(false)}
                  className="grid h-7 w-7 place-items-center rounded-md text-[#66706a] hover:bg-[#eef1ee]"
                  aria-label="Close import review"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
            <div className="max-h-[80vh] overflow-auto">
              {importTab === "review" ? (
                <FmdImportReview
                  result={resolveResult}
                  project={project}
                  setProject={setProject}
                  setWorkspaceLockReason={setWorkspaceLockReason}
                  onApplySuccess={async () => {
                    await mutateFmd();
                    setShowImportPanel(false);
                    if (summary) {
                      try {
                        localStorage.setItem(`fmd-import-summary-${project.id}`, JSON.stringify(summary));
                      } catch { /* ignore */ }
                    }
                  }}
                />
              ) : (
                <FmdImportChanges diffs={computeImportDiffs(project, resolveResult.draft)} />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </WorkspacePanel>
  );
}

const fmdResolveStages = [
  {
    at: 0,
    label: "Uploading workbook",
    detail: "Sending the selected file to the local resolver.",
  },
  {
    at: 3,
    label: "Reading sheets",
    detail: "Detecting workbook sheets, section roles, headers, and row evidence.",
  },
  {
    at: 8,
    label: "Building draft",
    detail: "Extracting proposed project data, endpoints, profiles, fields, mappings, and notes.",
  },
  {
    at: 14,
    label: "Redacting values",
    detail: "Removing emails, tokens, passwords, and secret-looking values before model review.",
  },
  {
    at: 20,
    label: "Qwen3-8B review",
    detail: "Asking local Ollama to return a compact correction patch for scattered FMD content.",
  },
  {
    at: 45,
    label: "Validating output",
    detail: "Checking the response schema, merging corrections, and preparing the review draft.",
  },
];

function FmdExportControls({ projectId, resolving }: { projectId: string; resolving: boolean }) {
  const [template, setTemplate] = useState<"standard" | "japanese" | "boomi-design">("standard");
  const [showOptions, setShowOptions] = useState(false);
  const [includeSampleData, setIncludeSampleData] = useState(false);
  const [includeXmlPreview, setIncludeXmlPreview] = useState(false);
  const [includeQualityReport, setIncludeQualityReport] = useState(false);
  const [includeChecklist, setIncludeChecklist] = useState(false);

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("projectId", projectId);
    params.set("template", template);
    if (includeSampleData) params.set("sample", "true");
    if (includeXmlPreview) params.set("xml", "true");
    if (includeQualityReport) params.set("quality", "true");
    if (includeChecklist) params.set("checklist", "true");
    return `/api/fmd/export?${params.toString()}`;
  }, [projectId, template, includeSampleData, includeXmlPreview, includeQualityReport, includeChecklist]);

  const disabled = resolving;

  return (
    <div className="relative flex items-center gap-2">
      <select
        value={template}
        onChange={(e) => setTemplate(e.target.value as typeof template)}
        disabled={disabled}
        className="h-8 rounded-md border border-[#cfd6cf] bg-white px-2 text-xs outline-none focus:border-[#298b68] disabled:opacity-55"
      >
        <option value="standard">Standard EN</option>
        <option value="japanese">Japanese JP</option>
        <option value="boomi-design">Boomi Design</option>
      </select>
      <button
        type="button"
        onClick={() => setShowOptions(!showOptions)}
        disabled={disabled}
        className={clsx(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium",
          showOptions
            ? "border-[#298b68] bg-[#e3f3ed] text-[#1b5e4a]"
            : "border-[#cfd6cf] bg-white text-[#4a524d] hover:border-[#298b68]",
          disabled && "pointer-events-none opacity-55",
        )}
      >
        Options
      </button>
      <a
        className={clsx(
          "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
          disabled
            ? "pointer-events-none cursor-not-allowed bg-[#cfd6cf] text-[#66706a]"
            : "bg-[#1b5e4a] text-white hover:bg-[#164d3d]",
        )}
        href={disabled ? undefined : exportUrl}
        aria-disabled={disabled}
      >
        <Download size={13} />
        Export
      </a>
      {showOptions ? (
        <div className="absolute right-0 top-full z-40 mt-1 w-60 rounded-lg border border-[#d9ded8] bg-white p-3 shadow-lg">
          <p className="mb-2 text-xs font-semibold uppercase text-[#66706a]">Include in export</p>
          <label className="flex items-center gap-2 py-1 text-sm">
            <input type="checkbox" checked={includeSampleData} onChange={(e) => setIncludeSampleData(e.target.checked)} />
            Sample data
          </label>
          <label className="flex items-center gap-2 py-1 text-sm">
            <input type="checkbox" checked={includeXmlPreview} onChange={(e) => setIncludeXmlPreview(e.target.checked)} />
            Boomi XML preview
          </label>
          <label className="flex items-center gap-2 py-1 text-sm">
            <input type="checkbox" checked={includeQualityReport} onChange={(e) => setIncludeQualityReport(e.target.checked)} />
            Quality report
          </label>
          <label className="flex items-center gap-2 py-1 text-sm">
            <input type="checkbox" checked={includeChecklist} onChange={(e) => setIncludeChecklist(e.target.checked)} />
            Deployment checklist
          </label>
        </div>
      ) : null}
    </div>
  );
}

function FmdResolveProgress({
  fileName,
  elapsedSeconds,
}: {
  fileName: string;
  elapsedSeconds: number;
}) {
  const activeStageIndex = fmdResolveStages.reduce(
    (activeIndex, stage, index) => (elapsedSeconds >= stage.at ? index : activeIndex),
    0,
  );
  const activeStage = fmdResolveStages[activeStageIndex];
  const progress = Math.min(94, Math.max(8, 8 + elapsedSeconds * 2));

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-md border border-[#d9ded8] bg-[#fbfbfa] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#1b1f23]">
              {fileName || "Workbook"}
            </p>
            <p className="mt-1 text-xs text-[#66706a]">Elapsed {elapsedSeconds}s</p>
          </div>
          <StatusPill label="working" tone="green" />
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#d9ded8]">
          <div
            className="h-full rounded-full bg-[#298b68] transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-4 rounded-md border border-[#cfe1d9] bg-white p-3">
          <div className="flex items-center gap-2">
            <RefreshCw size={15} className="animate-spin text-[#298b68]" />
            <p className="text-sm font-semibold">{activeStage.label}</p>
          </div>
          <p className="mt-2 text-xs leading-5 text-[#66706a]">{activeStage.detail}</p>
        </div>
      </div>

      <div className="space-y-2">
        {fmdResolveStages.map((stage, index) => {
          const complete = index < activeStageIndex;
          const active = index === activeStageIndex;
          return (
            <div
              key={stage.label}
              className={clsx(
                "flex gap-3 rounded-md border p-3 text-xs",
                active
                  ? "border-[#9fcbbd] bg-[#eef8f4] text-[#1b1f23]"
                  : "border-[#e3e7e2] bg-white text-[#66706a]",
              )}
            >
              <div className="mt-0.5 shrink-0">
                {complete ? (
                  <CheckCircle2 size={15} className="text-[#298b68]" />
                ) : active ? (
                  <RefreshCw size={15} className="animate-spin text-[#298b68]" />
                ) : (
                  <span className="block h-[15px] w-[15px] rounded-full border border-[#cfd6cf]" />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-semibold">{stage.label}</p>
                <p className="mt-1 leading-5">{stage.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const fmdApplyModes: Array<{ id: FmdApplyMode; label: string; description: string }> = [
  { id: "merge", label: "Merge", description: "Add the draft to the current project (profiles, mappings, sections, endpoints)." },
  { id: "mapping", label: "Mapping only", description: "Add only profiles + mapping sets and rules to the current project." },
  { id: "sections", label: "Sections only", description: "Add only the FMD sections to the current project." },
  { id: "create", label: "Create new", description: "Create a new project from the draft and apply everything to it." },
];

function FmdImportReview({
  result,
  project,
  setProject,
  setWorkspaceLockReason,
  onApplySuccess,
}: {
  result: FmdResolveResponse;
  project: Project;
  setProject: (project: Project) => void;
  setWorkspaceLockReason: (reason: string | null) => void;
  onApplySuccess?: () => unknown;
}) {
  const router = useRouter();
  const totalFields = result.draft.profiles.reduce((count, profile) => count + profile.fields.length, 0);
  const totalRules = result.draft.mappingSets.reduce((count, mappingSet) => count + mappingSet.rules.length, 0);
  const resolverTone = result.resolver.ok ? "green" : "amber";
  const strategySummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const mappingSet of result.draft.mappingSets) {
      const strategy = mappingSet.strategy ?? "unknown";
      counts[strategy] = (counts[strategy] ?? 0) + 1;
    }
    return counts;
  }, [result.draft.mappingSets]);
  const ruleConfidenceStats = useMemo(() => {
    const values: number[] = [];
    for (const mappingSet of result.draft.mappingSets) {
      for (const rule of mappingSet.rules) {
        values.push(rule.confidence);
      }
    }
    if (values.length === 0) return null;
    values.sort((a, b) => a - b);
    const sum = values.reduce((acc, value) => acc + value, 0);
    return {
      min: values[0],
      max: values[values.length - 1],
      avg: sum / values.length,
      median: values[Math.floor(values.length / 2)],
      lowConfidence: values.filter((value) => value < 0.6).length,
    };
  }, [result.draft.mappingSets]);
  const [showAllWarnings, setShowAllWarnings] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [showCompare, setShowCompare] = useState(false);

  const comparisonStats = useMemo(() => {
    const projectProfileCount = project.profiles.length;
    const draftProfileCount = result.draft.profiles.length;
    const projectMappingSetCount = project.mappingSets.length;
    const draftMappingSetCount = result.draft.mappingSets.length;
    const projectRuleCount = project.mappingSets.reduce((sum, ms) => sum + ms.rules.length, 0);
    const draftRuleCount = result.draft.mappingSets.reduce((sum, ms) => sum + ms.rules.length, 0);
    const projectEndpointCount = project.endpoints.length;
    const draftEndpointCount = result.draft.endpoints.length;
    const projectSectionCount = project.fmdSections.length;
    const draftSectionCount = result.draft.fmdSections.length;
    return {
      profiles: { project: projectProfileCount, draft: draftProfileCount, diff: draftProfileCount - projectProfileCount },
      mappingSets: { project: projectMappingSetCount, draft: draftMappingSetCount, diff: draftMappingSetCount - projectMappingSetCount },
      rules: { project: projectRuleCount, draft: draftRuleCount, diff: draftRuleCount - projectRuleCount },
      endpoints: { project: projectEndpointCount, draft: draftEndpointCount, diff: draftEndpointCount - projectEndpointCount },
      sections: { project: projectSectionCount, draft: draftSectionCount, diff: draftSectionCount - projectSectionCount },
    };
  }, [project, result.draft]);

  const [mode, setMode] = useState<FmdApplyMode>("merge");
  const categories = categoriesForMode(mode);

  // Default selection: everything included
  const defaultEndpoints = useMemo(
    () => result.draft.endpoints.map((_, index) => index),
    [result.draft.endpoints],
  );
  const defaultProfiles = useMemo(
    () => result.draft.profiles.map((_, index) => index),
    [result.draft.profiles],
  );
  const defaultMappingSets = useMemo(
    () => result.draft.mappingSets.map((_, index) => index),
    [result.draft.mappingSets],
  );
  const defaultSections = useMemo(
    () => result.draft.fmdSections.map((_, index) => index),
    [result.draft.fmdSections],
  );
  const defaultFields = useMemo(() => {
    const out: Record<number, number[]> = {};
    result.draft.profiles.forEach((profile, profileIndex) => {
      out[profileIndex] = profile.fields.map((_, fieldIndex) => fieldIndex);
    });
    return out;
  }, [result.draft.profiles]);
  const defaultRules = useMemo(() => {
    const out: Record<number, number[]> = {};
    result.draft.mappingSets.forEach((mappingSet, mappingSetIndex) => {
      out[mappingSetIndex] = mappingSet.rules.map((_, ruleIndex) => ruleIndex);
    });
    return out;
  }, [result.draft.mappingSets]);

  const [endpointSelection, setEndpointSelection] = useState<number[]>(defaultEndpoints);
  const [profileSelection, setProfileSelection] = useState<number[]>(defaultProfiles);
  const [mappingSetSelection, setMappingSetSelection] = useState<number[]>(defaultMappingSets);
  const [sectionSelection, setSectionSelection] = useState<number[]>(defaultSections);
  const [fieldSelection, setFieldSelection] = useState<Record<number, number[]>>(defaultFields);
  const [ruleSelection, setRuleSelection] = useState<Record<number, number[]>>(defaultRules);

  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<FmdApplyResult | null>(null);

  const buildSelection = useMemo(
    () => () => ({
      endpointIndexes: endpointSelection,
      profileIndexes: profileSelection,
      fieldIndexesByProfile: Object.fromEntries(
        Object.entries(fieldSelection).map(([key, value]) => [key, value]),
      ),
      mappingSetIndexes: mappingSetSelection,
      ruleIndexesByMappingSet: Object.fromEntries(
        Object.entries(ruleSelection).map(([key, value]) => [key, value]),
      ),
      sectionIndexes: sectionSelection,
    }),
    [endpointSelection, profileSelection, fieldSelection, mappingSetSelection, ruleSelection, sectionSelection],
  );

  const conflicts: FmdConflict[] = useMemo(() => {
    const request: FmdApplyRequest = {
      mode,
      projectId: project.id,
      draft: result.draft,
      selection: buildSelection(),
    };
    return detectFmdConflicts(request, mode === "create" ? undefined : project);
  }, [mode, project, result.draft, buildSelection]);

  const blockingConflicts = conflicts.filter((c) => c.severity === "error");

  async function handleApply() {
    setApplying(true);
    setApplyError(null);
    setApplyResult(null);
    setWorkspaceLockReason("Applying FMD draft");
    try {
      const body: FmdApplyRequest = {
        mode,
        projectId: mode === "create" ? undefined : project.id,
        draft: result.draft,
        selection: buildSelection(),
      };
      const response = await fetch("/api/fmd/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await extractError(response));
      const data = (await response.json()) as { result: FmdApplyResult; project: Project };
      setApplyResult(data.result);
      if (mode === "create") {
        router.push(`/?project=${data.result.projectId}`);
        router.refresh();
      } else {
        setProject(data.project);
        onApplySuccess?.();
        router.refresh();
      }
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : "Failed to apply FMD draft.");
    } finally {
      setApplying(false);
      setWorkspaceLockReason(null);
    }
  }

  function toggleIndex(setSelection: (value: number[]) => void, current: number[], index: number) {
    if (current.includes(index)) {
      setSelection(current.filter((value) => value !== index));
    } else {
      setSelection([...current, index].sort((a, b) => a - b));
    }
  }

  function toggleNestedIndex(
    setSelection: (value: Record<number, number[]>) => void,
    current: Record<number, number[]>,
    parentIndex: number,
    childIndex: number,
  ) {
    const list = current[parentIndex] ?? [];
    const next = list.includes(childIndex)
      ? list.filter((value) => value !== childIndex)
      : [...list, childIndex].sort((a, b) => a - b);
    setSelection({ ...current, [parentIndex]: next });
  }

  return (
    <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
      <div className="panel">
        <PanelHeader icon={Cpu} title="Resolver" action={result.resolver.provider} />
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-md border border-[#d9ded8] bg-white p-3">
            <div>
              <p className="text-sm font-semibold">{result.resolver.model}</p>
              <p className="mt-1 text-xs leading-5 text-[#66706a]">{result.resolver.message}</p>
            </div>
            <StatusPill label={result.resolver.ok ? "ready" : "fallback"} tone={resolverTone} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <InfoRow label="Profiles" value={String(result.draft.profiles.length)} />
            <InfoRow label="Fields" value={String(totalFields)} />
            <InfoRow label="Mapping Sets" value={String(result.draft.mappingSets.length)} />
            <InfoRow label="Rules" value={String(totalRules)} />
          </div>
          <div className="rounded-md border border-[#d9ded8] bg-[#fbfbfa] p-3">
            <p className="text-xs font-semibold uppercase text-[#66706a]">Proposed Project</p>
            <p className="mt-2 text-sm font-semibold text-[#1b1f23]">{result.draft.project.processId}</p>
            <p className="text-sm text-[#1b1f23]">{result.draft.project.name}</p>
            <p className="mt-2 text-xs leading-5 text-[#66706a]">
              {result.draft.project.sourceSystem} to {result.draft.project.destinationSystem}
            </p>
          </div>

          <div className="rounded-md border border-[#d9ded8] bg-[#fbfbfa] p-3">
            <p className="text-xs font-semibold uppercase text-[#66706a]">Telemetry</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[#1b1f23]">
              <div>
                <p className="text-[10px] uppercase text-[#66706a]">Warnings</p>
                <p className="text-sm font-semibold">{result.draft.warnings.length}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-[#66706a]">Unresolved refs</p>
                <p className="text-sm font-semibold">{result.draft.unresolvedEvidenceRefs.length}</p>
              </div>
              {ruleConfidenceStats ? (
                <>
                  <div>
                    <p className="text-[10px] uppercase text-[#66706a]">Rule confidence</p>
                    <p className="text-sm font-semibold">
                      {Math.round(ruleConfidenceStats.min * 100)}–{Math.round(ruleConfidenceStats.max * 100)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-[#66706a]">Avg / low conf</p>
                    <p className="text-sm font-semibold">
                      {Math.round(ruleConfidenceStats.avg * 100)}% · {ruleConfidenceStats.lowConfidence} below 60%
                    </p>
                  </div>
                </>
              ) : null}
            </div>
            {Object.keys(strategySummary).length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {Object.entries(strategySummary).map(([strategy, count]) => (
                  <span
                    key={strategy}
                    className="rounded-md border border-[#cfd6cf] bg-white px-2 py-0.5 text-[10px] uppercase text-[#1b5e4a]"
                  >
                    {strategy} × {count}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {result.draft.warnings.length > 0 ? (
            <div className="space-y-2">
              {(showAllWarnings ? result.draft.warnings : result.draft.warnings.slice(0, 5)).map((warning) => (
                <div key={warning} className="flex gap-2 rounded-md bg-[#fff8e8] p-3 text-xs leading-5 text-[#7a5211]">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{warning}</span>
                </div>
              ))}
              {result.draft.warnings.length > 5 ? (
                <button
                  type="button"
                  onClick={() => setShowAllWarnings((value) => !value)}
                  className="text-xs font-medium text-[#1b5e4a] hover:underline"
                >
                  {showAllWarnings
                    ? "Show fewer warnings"
                    : `Show all ${result.draft.warnings.length} warnings`}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {result.debug ? (
          <div className="mt-4 space-y-3">
            <button
              type="button"
              onClick={() => setShowDebug(!showDebug)}
              className="flex w-full items-center gap-1.5 text-xs font-semibold uppercase text-[#66706a] hover:text-[#1b1f23]"
            >
              {showDebug ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Debug: Resolver Context
            </button>
            {showDebug ? (
              <>
                <div className="rounded-md border border-[#d9ded8] bg-white p-3">
                  <p className="text-xs font-semibold uppercase text-[#66706a]">Workbook Evidence</p>
                  <div className="mt-2 max-h-40 overflow-auto">
                    {result.summary.sheets.map((sheet) => (
                      <div key={sheet.name} className="flex items-center justify-between py-1 text-xs">
                        <span className="font-medium">{sheet.name}</span>
                        <span className="text-[#66706a]">{sheet.rowCount} rows · {sheet.columnCount} cols · {sheet.role}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {result.debug.promptText ? (
                  <div className="rounded-md border border-[#d9ded8] bg-white p-3">
                    <p className="text-xs font-semibold uppercase text-[#66706a]">LLM Prompt</p>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[10px] leading-4 text-[#66706a]">
                      {result.debug.promptText.slice(0, 2000)}
                      {result.debug.promptText.length > 2000 ? "…" : ""}
                    </pre>
                  </div>
                ) : null}
                {result.debug.rawLlmResponse ? (
                  <div className="rounded-md border border-[#d9ded8] bg-white p-3">
                    <p className="text-xs font-semibold uppercase text-[#66706a]">LLM Response</p>
                    <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-[10px] leading-4 text-[#66706a]">
                      {result.debug.rawLlmResponse}
                    </pre>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-4">
        <div className="panel">
          <PanelHeader icon={GitCompareArrows} title="Apply Import" action={mode} />
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {fmdApplyModes.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setMode(option.id);
                  setApplyResult(null);
                  setApplyError(null);
                }}
                className={clsx(
                  "rounded-md border px-3 py-2 text-left text-sm transition",
                  mode === option.id
                    ? "border-[#298b68] bg-[#e3f3ed] text-[#1b1f23]"
                    : "border-[#d9ded8] bg-white text-[#4a524d] hover:border-[#9fb7aa]",
                )}
              >
                <p className="font-semibold">{option.label}</p>
                <p className="mt-1 text-xs leading-5 text-[#66706a]">{option.description}</p>
              </button>
            ))}
          </div>

          {conflicts.length > 0 ? (
            <div className="mt-4 space-y-2">
              {conflicts.map((conflict, index) => (
                <div
                  key={`${conflict.type}-${index}`}
                  className={clsx(
                    "flex gap-2 rounded-md p-3 text-xs leading-5",
                    conflict.severity === "error"
                      ? "bg-[#fdecec] text-[#7a2424]"
                      : "bg-[#fff8e8] text-[#7a5211]",
                  )}
                >
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{conflict.message}</span>
                </div>
              ))}
            </div>
          ) : null}

          {applyError ? (
            <div className="mt-3 rounded-md border border-[#f3c5c5] bg-[#fdecec] p-3 text-xs text-[#7a2424]">
              {applyError}
            </div>
          ) : null}

          {applyResult ? (
            <div className="mt-3 rounded-md border border-[#c2e0d3] bg-[#eef8f4] p-3 text-xs leading-5 text-[#155a40]">
              <p className="font-semibold">Applied to project {applyResult.projectId}</p>
              <p className="mt-1">
                Created {applyResult.createdProfiles} profiles, {applyResult.createdFields} fields,{" "}
                {applyResult.createdMappingSets} mapping sets, {applyResult.createdRules} rules,{" "}
                {applyResult.createdEndpoints} endpoints, {applyResult.createdSections} sections.
              </p>
              {applyResult.warnings.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {applyResult.warnings.slice(0, 6).map((warning, idx) => (
                    <li key={`${idx}-${warning}`}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleApply}
              disabled={applying || blockingConflicts.length > 0}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {applying ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
              {applying ? "Applying…" : "Apply draft"}
            </button>
          </div>
        </div>

        <div className="panel">
          <button
            type="button"
            onClick={() => setShowCompare(!showCompare)}
            className="flex w-full items-center gap-2 text-xs font-semibold uppercase text-[#66706a] hover:text-[#1b1f23]"
          >
            {showCompare ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Compare: Project vs Draft
          </button>
          {showCompare ? (
            <div className="mt-3 overflow-hidden rounded-md border border-[#d9ded8]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#eef1ee] uppercase text-[#66706a]">
                  <tr>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2 text-right">Project</th>
                    <th className="px-3 py-2 text-right">Draft</th>
                    <th className="px-3 py-2 text-right">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e3e7e2] bg-white">
                  {[
                    { label: "Profiles", key: "profiles" as const },
                    { label: "Mapping Sets", key: "mappingSets" as const },
                    { label: "Rules", key: "rules" as const },
                    { label: "Endpoints", key: "endpoints" as const },
                    { label: "Sections", key: "sections" as const },
                  ].map(({ label, key }) => {
                    const stat = comparisonStats[key];
                    return (
                      <tr key={key}>
                        <td className="px-3 py-2 font-medium">{label}</td>
                        <td className="px-3 py-2 text-right">{stat.project}</td>
                        <td className="px-3 py-2 text-right">{stat.draft}</td>
                        <td className="px-3 py-2 text-right">
                          {stat.diff > 0 ? (
                            <span className="text-[#298b68]">+{stat.diff}</span>
                          ) : stat.diff < 0 ? (
                            <span className="text-[#9c2a2a]">{stat.diff}</span>
                          ) : (
                            <span className="text-[#66706a]">0</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
          {categories.mappingSets ? (
            <div className="panel">
              <PanelHeader
                icon={GitCompareArrows}
                title="Mapping sets"
                action={`${mappingSetSelection.length} / ${result.draft.mappingSets.length}`}
              />
              <div className="mt-3 space-y-3">
                {result.draft.mappingSets.map((mappingSet, msIndex) => {
                  const selected = mappingSetSelection.includes(msIndex);
                  const ruleConfidences = mappingSet.rules.map((rule) => rule.confidence);
                  const minRuleConfidence = ruleConfidences.length
                    ? Math.min(...ruleConfidences)
                    : null;
                  const maxRuleConfidence = ruleConfidences.length
                    ? Math.max(...ruleConfidences)
                    : null;
                  return (
                    <div key={mappingSet.name} className="rounded-md border border-[#d9ded8] bg-white p-3">
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleIndex(setMappingSetSelection, mappingSetSelection, msIndex)}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="truncate text-sm font-semibold">{mappingSet.name}</p>
                            <div className="flex shrink-0 items-center gap-1">
                              {mappingSet.strategy ? (
                                <span className="rounded-md border border-[#cfd6cf] bg-[#fbfbfa] px-1.5 py-0.5 text-[10px] uppercase text-[#1b5e4a]">
                                  {mappingSet.strategy}
                                </span>
                              ) : null}
                              <StatusPill
                                label={`${Math.round(mappingSet.confidence * 100)}%`}
                                tone={mappingSet.confidence >= 0.7 ? "green" : "amber"}
                              />
                            </div>
                          </div>
                          <p className="mt-0.5 text-xs leading-5 text-[#66706a]">
                            {mappingSet.sourceProfileName} → {mappingSet.destinationProfileName}
                          </p>
                          <p className="mt-1 text-xs text-[#66706a]">
                            {mappingSet.rules.length} rules · {(ruleSelection[msIndex] ?? []).length} selected
                            {minRuleConfidence !== null && maxRuleConfidence !== null
                              ? ` · rules ${Math.round(minRuleConfidence * 100)}–${Math.round(maxRuleConfidence * 100)}%`
                              : ""}
                          </p>
                        </div>
                      </label>
                      {selected ? (
                        <div className="mt-2 max-h-44 overflow-auto border-t border-[#eef1ee] pt-2">
                          {mappingSet.rules.slice(0, 50).map((rule, ruleIndex) => {
                            const ruleChecked = (ruleSelection[msIndex] ?? []).includes(ruleIndex);
                            return (
                              <label
                                key={`${rule.destinationFieldName}-${ruleIndex}`}
                                className="flex items-start gap-2 py-1 text-xs"
                              >
                                <input
                                  type="checkbox"
                                  checked={ruleChecked}
                                  onChange={() =>
                                    toggleNestedIndex(setRuleSelection, ruleSelection, msIndex, ruleIndex)
                                  }
                                  className="mt-0.5"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="font-medium">{rule.destinationFieldName}</span>
                                  <span className="ml-1 text-[#66706a]">
                                    ← {rule.sourceFieldName ?? rule.defaultValue ?? "derived"}
                                  </span>
                                </span>
                                <StatusPill
                                  label={rule.mappingType}
                                  tone={rule.mappingType === "direct" ? "green" : "amber"}
                                />
                              </label>
                            );
                          })}
                          {mappingSet.rules.length > 50 ? (
                            <p className="pt-2 text-xs text-[#66706a]">
                              Showing first 50 of {mappingSet.rules.length} rules. All remain selected by default.
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {result.draft.mappingSets.length === 0 ? (
                  <p className="rounded-md border border-dashed border-[#cfd6cf] p-3 text-xs text-[#66706a]">
                    No mapping sets in this draft.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {categories.profiles ? (
            <div className="panel">
              <PanelHeader
                icon={Layers3}
                title="Profiles"
                action={`${profileSelection.length} / ${result.draft.profiles.length}`}
              />
              <div className="mt-3 space-y-3">
                {result.draft.profiles.map((profile, profileIndex) => {
                  const selected = profileSelection.includes(profileIndex);
                  const profileFieldSelection = fieldSelection[profileIndex] ?? [];
                  return (
                    <div key={`${profile.role}-${profile.name}`} className="rounded-md border border-[#d9ded8] bg-white p-3">
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleIndex(setProfileSelection, profileSelection, profileIndex)}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{profile.name}</p>
                          <p className="mt-0.5 text-xs text-[#66706a]">
                            {profile.role} · {profile.type} · {profile.format} · {profile.fields.length} fields
                          </p>
                          <p className="mt-1 text-xs text-[#66706a]">{profileFieldSelection.length} selected</p>
                        </div>
                      </label>
                      {selected && profile.fields.length > 0 ? (
                        <div className="mt-2 flex max-h-44 flex-wrap gap-1 overflow-auto border-t border-[#eef1ee] pt-2">
                          {profile.fields.slice(0, 60).map((field, fieldIndex) => {
                            const fieldChecked = profileFieldSelection.includes(fieldIndex);
                            return (
                              <label
                                key={`${field.parentPath ?? ""}-${field.name}-${fieldIndex}`}
                                className={clsx(
                                  "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs cursor-pointer",
                                  fieldChecked ? "border-[#298b68] bg-[#e3f3ed]" : "border-[#d9ded8] bg-white",
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={fieldChecked}
                                  onChange={() =>
                                    toggleNestedIndex(setFieldSelection, fieldSelection, profileIndex, fieldIndex)
                                  }
                                />
                                {field.name}
                              </label>
                            );
                          })}
                          {profile.fields.length > 60 ? (
                            <span className="text-xs text-[#66706a]">…{profile.fields.length - 60} more</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {result.draft.profiles.length === 0 ? (
                  <p className="rounded-md border border-dashed border-[#cfd6cf] p-3 text-xs text-[#66706a]">
                    No profiles in this draft.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {categories.endpoints ? (
            <div className="panel">
              <PanelHeader
                icon={Network}
                title="Endpoints"
                action={`${endpointSelection.length} / ${result.draft.endpoints.length}`}
              />
              <div className="mt-3 space-y-2">
                {result.draft.endpoints.map((endpoint, index) => (
                  <label key={`${endpoint.role}-${endpoint.name}`} className="flex items-start gap-2 rounded-md border border-[#d9ded8] bg-white p-3">
                    <input
                      type="checkbox"
                      checked={endpointSelection.includes(index)}
                      onChange={() => toggleIndex(setEndpointSelection, endpointSelection, index)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{endpoint.name}</p>
                      <p className="mt-0.5 text-xs text-[#66706a]">
                        {endpoint.role} · {endpoint.connectorType} · {endpoint.format}
                      </p>
                    </div>
                  </label>
                ))}
                {result.draft.endpoints.length === 0 ? (
                  <p className="rounded-md border border-dashed border-[#cfd6cf] p-3 text-xs text-[#66706a]">
                    No endpoints in this draft.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {categories.sections ? (
            <div className="panel">
              <PanelHeader
                icon={FileSpreadsheet}
                title="FMD Sections"
                action={`${sectionSelection.length} / ${result.draft.fmdSections.length}`}
              />
              <div className="mt-3 space-y-2">
                {result.draft.fmdSections.map((section, index) => (
                  <label key={`${section.sectionType}-${section.title}`} className="flex items-start gap-2 rounded-md border border-[#d9ded8] bg-white p-3">
                    <input
                      type="checkbox"
                      checked={sectionSelection.includes(index)}
                      onChange={() => toggleIndex(setSectionSelection, sectionSelection, index)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{section.title}</p>
                      <p className="mt-0.5 text-xs text-[#66706a]">{section.sectionType}</p>
                    </div>
                  </label>
                ))}
                {result.draft.fmdSections.length === 0 ? (
                  <p className="rounded-md border border-dashed border-[#cfd6cf] p-3 text-xs text-[#66706a]">
                    No sections in this draft.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function JsonTree({ data, level = 0, label }: { data: unknown; level?: number; label?: string }) {
  const [expanded, setExpanded] = useState(level < 1);

  if (level >= 3) {
    return (
      <div className="flex items-center gap-1 py-0.5 text-xs text-[#66706a]" style={{ paddingLeft: level * 16 }}>
        {label !== undefined ? <span className="font-medium text-[#1b1f23]">{label}:</span> : null}
        <span className="italic">{typeof data === "object" && data !== null ? "{…}" : String(data)}</span>
      </div>
    );
  }

  if (data === null || data === undefined) {
    return (
      <div className="flex items-center gap-1 py-0.5 text-xs" style={{ paddingLeft: level * 16 }}>
        {label !== undefined ? <span className="font-medium text-[#1b1f23]">{label}:</span> : null}
        <span className="text-[#9c2a2a]">{String(data)}</span>
      </div>
    );
  }

  if (typeof data !== "object") {
    const valueStr = typeof data === "string" && data.length > 80 ? `${data.slice(0, 80)}…` : String(data);
    return (
      <div className="flex items-center gap-1 py-0.5 text-xs" style={{ paddingLeft: level * 16 }}>
        {label !== undefined ? <span className="font-medium text-[#1b1f23]">{label}:</span> : null}
        <span className="text-[#298b68]">{valueStr}</span>
      </div>
    );
  }

  const isArray = Array.isArray(data);
  const entries = isArray ? data.map((v, i) => [String(i), v] as const) : Object.entries(data as Record<string, unknown>);
  const isEmpty = entries.length === 0;
  const typeLabel = isArray ? `Array[${entries.length}]` : `Object{${entries.length}}`;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 py-0.5 text-xs hover:bg-[#eef1ee] w-full text-left rounded"
        style={{ paddingLeft: level * 16 }}
      >
        <span className="text-[#66706a] shrink-0">{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
        {label !== undefined ? <span className="font-medium text-[#1b1f23]">{label}:</span> : null}
        <span className="text-[#66706a]">{isEmpty ? (isArray ? "[]" : "{}") : typeLabel}</span>
      </button>
      {expanded && !isEmpty ? (
        <div>
          {entries.slice(0, 50).map(([key, value]) => (
            <JsonTree key={key} data={value} level={level + 1} label={key} />
          ))}
          {entries.length > 50 ? (
            <div className="py-0.5 text-xs text-[#66706a]" style={{ paddingLeft: (level + 1) * 16 }}>
              …{entries.length - 50} more entries
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FmdImportChanges({ diffs }: { diffs: SectionDiff[] }) {
  if (diffs.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-[#66706a]">No sections in the draft.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-4">
      {diffs.map((diff) => (
        <div
          key={diff.sectionType}
          className="rounded-md border border-[#d9ded8] bg-white p-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {diff.currentData === null ? (
                  <Plus size={15} className="text-[#298b68]" />
                ) : diff.changed ? (
                  <RefreshCw size={15} className="text-[#c68f1f]" />
                ) : (
                  <CheckCircle2 size={15} className="text-[#66706a]" />
                )}
                <p className="truncate text-sm font-semibold">{diff.title}</p>
              </div>
              <p className="mt-0.5 text-xs text-[#66706a]">{diff.sectionType}</p>
            </div>
            <span
              className={clsx(
                "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase",
                diff.currentData === null
                  ? "bg-[#e3f3ed] text-[#1b5e4a]"
                  : diff.changed
                    ? "bg-[#fff8e8] text-[#7a5211]"
                    : "bg-[#eef1ee] text-[#66706a]",
              )}
            >
              {diff.currentData === null ? "New" : diff.changed ? "Changed" : "Unchanged"}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-[#66706a]">{diff.summary}</p>
        </div>
      ))}
    </div>
  );
}

export { FmdBuilder, FmdExportControls, FmdResolveProgress, FmdImportReview, FmdImportChanges, JsonTree };
