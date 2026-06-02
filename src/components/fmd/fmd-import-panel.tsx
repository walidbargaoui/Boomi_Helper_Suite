"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  FileSpreadsheet,
  GitCompareArrows,
  Layers,
  Network,
  X,
  Server,
  FlaskConical,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import type { Project } from "@/lib/domain";
import type { FmdResolveResponse } from "@/lib/fmd-import";
import {
  detectFmdConflicts,
  type FmdApplyMode,
  type FmdApplyRequest,
  type FmdApplyResult,
  type FmdConflict,
  type ItemTarget,
} from "@/lib/fmd-apply";
import { extractError } from "@/lib/api-utils";
import { useToast } from "@/components/toast";

type ImportTab = "sections" | "endpoints" | "profiles" | "mappings" | "environment" | "evidence";

const importTabs: Array<{ id: ImportTab; label: string; icon: LucideIcon }> = [
  { id: "sections", label: "Sections", icon: FileSpreadsheet },
  { id: "endpoints", label: "Endpoints", icon: Network },
  { id: "profiles", label: "Profiles", icon: Layers },
  { id: "mappings", label: "Mappings", icon: GitCompareArrows },
  { id: "environment", label: "Environment", icon: Server },
  { id: "evidence", label: "Evidence", icon: FlaskConical },
];

interface FmdImportPanelProps {
  result: FmdResolveResponse;
  project: Project;
  setProject: (project: Project) => void;
  setWorkspaceLockReason: (reason: string | null) => void;
  setShowImportPanel: (show: boolean) => void;
  onApplied: () => void;
}

export function FmdImportPanel({
  result,
  project,
  setProject,
  setWorkspaceLockReason,
  setShowImportPanel,
  onApplied,
}: FmdImportPanelProps) {
  const router = useRouter();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<ImportTab>("sections");
  const [showAllWarnings, setShowAllWarnings] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [itemTargets, setItemTargets] = useState<Record<string, ItemTarget>>({});

  // Selection state per category
  const [mode, setMode] = useState<FmdApplyMode>("merge");
  const defaultEndpoints = useMemo(() => result.draft.endpoints.map((_, i) => i), [result.draft.endpoints]);
  const defaultProfiles = useMemo(() => result.draft.profiles.map((_, i) => i), [result.draft.profiles]);
  const defaultMappingSets = useMemo(() => result.draft.mappingSets.map((_, i) => i), [result.draft.mappingSets]);
  const defaultSections = useMemo(() => result.draft.fmdSections.map((_, i) => i), [result.draft.fmdSections]);

  const [endpointSelection, setEndpointSelection] = useState<number[]>(defaultEndpoints);
  const [profileSelection, setProfileSelection] = useState<number[]>(defaultProfiles);
  const [mappingSetSelection, setMappingSetSelection] = useState<number[]>(defaultMappingSets);
  const [sectionSelection, setSectionSelection] = useState<number[]>(defaultSections);
  const [fieldSelection] = useState<Record<number, number[]>>({});
  const [ruleSelection] = useState<Record<number, number[]>>({});

  // Per-item targets: "create" | "merge" | "update" | "ignore"

  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<FmdApplyResult | null>(null);

  const blockingConflicts: FmdConflict[] = useMemo(() => {
    const request: FmdApplyRequest = {
      mode,
      projectId: project.id,
      draft: result.draft,
      selection: {
        endpointIndexes: endpointSelection,
        profileIndexes: profileSelection,
        fieldIndexesByProfile: Object.fromEntries(Object.entries(fieldSelection)),
        mappingSetIndexes: mappingSetSelection,
        ruleIndexesByMappingSet: Object.fromEntries(Object.entries(ruleSelection)),
        sectionIndexes: sectionSelection,
      },
    };
    return detectFmdConflicts(request, mode === "create" ? undefined : project).filter((c) => c.severity === "error");
  }, [mode, project, result.draft, endpointSelection, profileSelection, mappingSetSelection, sectionSelection, fieldSelection, ruleSelection]);

  const canApply = mode === "create" || blockingConflicts.length === 0;

  function toggleIndex(setSelection: (v: number[]) => void, current: number[], index: number) {
    if (current.includes(index)) setSelection(current.filter((v) => v !== index));
    else setSelection([...current, index].sort((a, b) => a - b));
  }

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
        selection: {
          endpointIndexes: endpointSelection,
          profileIndexes: profileSelection,
          fieldIndexesByProfile: Object.fromEntries(Object.entries(fieldSelection)),
          mappingSetIndexes: mappingSetSelection,
          ruleIndexesByMappingSet: Object.fromEntries(Object.entries(ruleSelection)),
          sectionIndexes: sectionSelection,
        },
        itemTargets,
      };
      const response = await fetch("/api/fmd/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await extractError(response));
      const data = (await response.json()) as { result: FmdApplyResult; project: Project };
      setApplyResult(data.result);
      if (mode === "create") {
        router.push(`/?project=${data.result.projectId}`);
        router.refresh();
      } else {
        setProject(data.project);
        onApplied();
        router.refresh();
      }
      setShowImportPanel(false);
      toast.addToast({ message: "Draft applied successfully", type: "success" });
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : "Failed to apply FMD draft.");
    } finally {
      setApplying(false);
      setWorkspaceLockReason(null);
    }
  }

  function setItemTarget(category: string, index: number, target: ItemTarget) {
    setItemTargets((prev) => ({ ...prev, [`${category}:${index}`]: target }));
    if (target === "ignore") {
      // Uncheck the item when ignored
      if (category === "section") toggleIndex(setSectionSelection, sectionSelection, index);
      else if (category === "endpoint") toggleIndex(setEndpointSelection, endpointSelection, index);
      else if (category === "profile") toggleIndex(setProfileSelection, profileSelection, index);
      else if (category === "mapping") toggleIndex(setMappingSetSelection, mappingSetSelection, index);
    }
  }

  const tabContent = (() => {
    switch (activeTab) {
      case "sections":
        return <SectionTab sections={result.draft.fmdSections} selection={sectionSelection} projectSections={project.fmdSections} onToggle={(i) => toggleIndex(setSectionSelection, sectionSelection, i)} itemTargets={itemTargets} onSetTarget={(i, t) => setItemTarget("section", i, t)} />;
      case "endpoints":
        return <EndpointTab endpoints={result.draft.endpoints} selection={endpointSelection} projectEndpoints={project.endpoints} onToggle={(i) => toggleIndex(setEndpointSelection, endpointSelection, i)} itemTargets={itemTargets} onSetTarget={(i, t) => setItemTarget("endpoint", i, t)} />;
      case "profiles":
        return <ProfileTab profiles={result.draft.profiles} selection={profileSelection} projectProfiles={project.profiles} onToggle={(i) => toggleIndex(setProfileSelection, profileSelection, i)} itemTargets={itemTargets} onSetTarget={(i, t) => setItemTarget("profile", i, t)} />;
      case "mappings":
        return <MappingTab mappingSets={result.draft.mappingSets} selection={mappingSetSelection} projectMappingSets={project.mappingSets} onToggle={(i) => toggleIndex(setMappingSetSelection, mappingSetSelection, i)} itemTargets={itemTargets} onSetTarget={(i, t) => setItemTarget("mapping", i, t)} />;
      case "environment":
        return <EnvironmentTab />;
      case "evidence":
        return <EvidenceTab result={result} showDebug={showDebug} setShowDebug={setShowDebug} />;
    }
  })();

  return (
    <div className="border-t border-[#d9ded8] bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#d9ded8] px-4 py-2">
        <div className="flex items-center gap-2">
          <FileSpreadsheet size={15} className="text-[#66706a]" />
          <p className="text-xs font-semibold uppercase text-[#66706a]">Import Workspace</p>
          {applyResult ? (
            <span className="rounded bg-[#e3f3ed] px-1.5 py-0.5 text-[10px] text-[#1b5e4a]">Applied</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowDebug(!showDebug)} className="rounded px-2 py-1 text-[10px] text-[#66706a] hover:bg-[#eef1ee]">
            {showDebug ? "Hide evidence" : "Show debug"}
          </button>
          <button type="button" onClick={() => setShowImportPanel(false)} className="grid h-6 w-6 place-items-center rounded text-[#66706a] hover:bg-[#eef1ee]" aria-label="Close import workspace">
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#d9ded8] bg-[#fbfbfa] px-2">
        {importTabs.map((tab) => (
          <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
            className={clsx("inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[11px] font-medium", activeTab === tab.id ? "border-[#1b5e4a] text-[#1b5e4a]" : "border-transparent text-[#66706a] hover:text-[#3f4c52]")}
          >
            <tab.icon size={13} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="max-h-[320px] overflow-auto">{tabContent}</div>

      {/* Footer: mode, conflicts, apply */}
      <div className="flex items-center justify-between border-t border-[#d9ded8] px-4 py-2">
        <div className="flex items-center gap-3">
          {/* Mode selector */}
          <div className="flex items-center gap-1.5 rounded border border-[#cfd6cf] p-0.5">
            {([
              { id: "merge" as FmdApplyMode, label: "Merge" },
              { id: "mapping" as FmdApplyMode, label: "Mapping" },
              { id: "sections" as FmdApplyMode, label: "Sections" },
              { id: "create" as FmdApplyMode, label: "Create" },
            ]).map((modeOpt) => (
              <button key={modeOpt.id} type="button" onClick={() => { setMode(modeOpt.id); setItemTargets({}); }}
                className={clsx("rounded px-2 py-0.5 text-[10px] font-medium", modeOpt.id === mode ? "bg-[#e3f3ed] text-[#1b5e4a]" : "text-[#66706a] hover:bg-[#eef1ee]")}
              >
                {modeOpt.label}
              </button>
            ))}
          </div>

          {/* Warnings toggle */}
          {result.draft.warnings.length > 0 ? (
            <button type="button" onClick={() => setShowAllWarnings(!showAllWarnings)}
              className="flex items-center gap-1 text-[10px] text-[#7a5211] hover:underline"
            >
              <AlertTriangle size={11} />
              {result.draft.warnings.length} warning{result.draft.warnings.length !== 1 ? "s" : ""}
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {applyError ? <p className="text-[10px] text-[#9c2a2a]">{applyError}</p> : null}
          {blockingConflicts.length > 0 ? (
            <p className="text-[10px] text-[#9c2a2a]">{blockingConflicts.length} blocking conflict{blockingConflicts.length !== 1 ? "s" : ""}</p>
          ) : null}
          <button type="button" onClick={handleApply} disabled={applying || !canApply}
            className={clsx("rounded-md px-3 py-1 text-xs font-semibold", applying || !canApply ? "bg-[#e3e7e2] text-[#66706a] cursor-not-allowed" : "bg-[#1b5e4a] text-white hover:bg-[#144a3a]")}
          >
            {applying ? "Applying..." : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Tab sub-components */

type DraftSectionItem = { title?: string; sectionType?: string; content?: { data?: { narrative?: string } }; contentJson?: { narrative?: string } };

function SectionTab({ sections, selection, projectSections, onToggle, itemTargets, onSetTarget }: { sections: DraftSectionItem[]; selection: number[]; projectSections: Array<{ title?: string; sectionType?: string }>; onToggle: (i:number)=>void; itemTargets: Record<string,ItemTarget>; onSetTarget: (i:number,t:ItemTarget)=>void }) {
  return (
    <div className="space-y-0 p-3">
      {sections.length === 0 ? <EmptyTab text="No sections found in workbook." /> : sections.map((section, i) => {
        const existing = projectSections.find((s) => s.sectionType === section.sectionType);
        const importValue = section.contentJson?.narrative || section.content?.data?.narrative || "Content imported";
        return (
          <ComparisonRow key={i} label={String(section.title || section.sectionType)} subtitle={String(section.sectionType)}
            selected={selection.includes(i)} onToggle={() => onToggle(i)}
            currentValue={existing ? String(existing.title) : "—"}
            importValue={importValue}
            meta={existing ? "Existing" : "New"}
            target={itemTargets[`section:${i}`] ?? "auto"}
            onTargetChange={(t) => onSetTarget(i, t)}
            itemData={section as Record<string,unknown>}
          />
        );
      })}
    </div>
  );
}

type DraftEndpointItem = { name?: string; role?: string; type?: string; format?: string };

function EndpointTab({ endpoints, selection, projectEndpoints, onToggle, itemTargets, onSetTarget }: { endpoints: DraftEndpointItem[]; selection: number[]; projectEndpoints: Array<{ name?: string; role?: string; type?: string }>; onToggle: (i:number)=>void; itemTargets: Record<string,ItemTarget>; onSetTarget: (i:number,t:ItemTarget)=>void }) {
  return (
    <div className="space-y-0 p-3">
      {endpoints.length === 0 ? <EmptyTab text="No endpoints found in workbook." /> : endpoints.map((ep, i) => {
        const existing = projectEndpoints.find((e) => e.name === ep.name);
        return (
          <ComparisonRow key={i} label={String(ep.name || `Endpoint ${i + 1}`)} subtitle={`${String(ep.role || "")} · ${String(ep.type || "")}`}
            selected={selection.includes(i)} onToggle={() => onToggle(i)}
            currentValue={existing ? `${String(existing.role)} · ${String(existing.type)}` : "—"}
            importValue={`${String(ep.role)} · ${String(ep.format || "")}`}
            meta={existing ? "Will update" : "Will create"}
            target={itemTargets[`endpoint:${i}`] ?? "auto"}
            onTargetChange={(t) => onSetTarget(i, t)}
            itemData={ep as Record<string,unknown>}
          />
        );
      })}
    </div>
  );
}

type DraftProfileItem = { name?: string; role?: string; fieldCount?: number; fields?: Array<unknown> };

function ProfileTab({ profiles, selection, projectProfiles, onToggle, itemTargets, onSetTarget }: { profiles: DraftProfileItem[]; selection: number[]; projectProfiles: Array<{ name?: string; role?: string; fields?: Array<unknown> }>; onToggle: (i:number)=>void; itemTargets: Record<string,ItemTarget>; onSetTarget: (i:number,t:ItemTarget)=>void }) {
  return (
    <div className="space-y-0 p-3">
      {profiles.length === 0 ? <EmptyTab text="No profiles found in workbook." /> : profiles.map((profile, i) => {
        const existing = projectProfiles.find((p) => p.name === profile.name);
        const fieldCount = profile.fieldCount || profile.fields?.length || 0;
        const existingFieldCount = existing?.fields?.length || 0;
        return (
          <ComparisonRow key={i} label={String(profile.name || `Profile ${i + 1}`)} subtitle={`${String(profile.role || "")} · ${fieldCount} fields`}
            selected={selection.includes(i)} onToggle={() => onToggle(i)}
            currentValue={existing ? `${String(existing.role)} · ${existingFieldCount} fields` : "—"}
            importValue={`${String(profile.role)} · ${fieldCount} fields`}
            meta={existing ? "Will merge fields" : "Will create"}
            target={itemTargets[`profile:${i}`] ?? "auto"}
            onTargetChange={(t) => onSetTarget(i, t)}
            itemData={profile as Record<string,unknown>}
          />
        );
      })}
    </div>
  );
}

type DraftMappingSetItem = { name?: string; rules?: Array<unknown>; strategy?: string };

function MappingTab({ mappingSets, selection, projectMappingSets, onToggle, itemTargets, onSetTarget }: { mappingSets: DraftMappingSetItem[]; selection: number[]; projectMappingSets: Array<{ name?: string; rules?: Array<unknown> }>; onToggle: (i:number)=>void; itemTargets: Record<string,ItemTarget>; onSetTarget: (i:number,t:ItemTarget)=>void }) {
  return (
    <div className="space-y-0 p-3">
      {mappingSets.length === 0 ? <EmptyTab text="No mapping sets found in workbook." /> : mappingSets.map((ms, i) => {
        const existing = projectMappingSets.find((m) => m.name === ms.name);
        const ruleCount = ms.rules?.length || 0;
        const existingRuleCount = existing?.rules?.length || 0;
        return (
          <ComparisonRow key={i} label={String(ms.name || `Mapping Set ${i + 1}`)} subtitle={`${ruleCount} rule${ruleCount !== 1 ? "s" : ""} · strategy: ${String(ms.strategy || "unknown")}`}
            selected={selection.includes(i)} onToggle={() => onToggle(i)}
            currentValue={existing ? `${existingRuleCount} rules` : "—"}
            importValue={`${ruleCount} rules`}
            meta={existing ? "Will merge" : "Will create"}
            target={itemTargets[`mapping:${i}`] ?? "auto"}
            onTargetChange={(t) => onSetTarget(i, t)}
            itemData={ms as Record<string,unknown>}
          />
        );
      })}
    </div>
  );
}

function EnvironmentTab() {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-xs text-[#66706a] gap-2">
      <Server size={24} className="text-[#cfd6cf]" />
      <p>Environment and deployment configuration from imported workbook</p>
      <p className="text-[10px]">Populated during import review based on mapped environment rows.</p>
    </div>
  );
}

function EvidenceTab({ result, showDebug, setShowDebug }: { result: FmdResolveResponse; showDebug: boolean; setShowDebug: (v:boolean)=>void }) {
  const draft = result.draft;
  return (
    <div className="space-y-2 p-3">
      <div className="rounded-md border border-[#d9ded8] bg-[#fbfbfa] p-3 text-xs">
        <p className="font-medium">Resolver info</p>
        <p className="mt-1 text-[#66706a]">Model: {result.resolver.model}</p>
        <p className="text-[#66706a]">Score: {result.resolver.ok ? "OK" : "Fallback"}</p>
        {typeof result.resolver.confidence === "number" ? (
          <p className="text-[#66706a]">Confidence: {Math.round(result.resolver.confidence * 100)}%</p>
        ) : null}
        {result.resolver.cache ? (
          <p className="text-[#66706a]">Cache: {result.resolver.cache}</p>
        ) : null}
      </div>
      <ResolverSuggestionSummary result={result} />
      {draft.warnings.length > 0 ? (
        <div className="rounded-md border border-[#e8c8a8] bg-[#fff8e8] p-3 text-xs">
          <p className="font-medium text-[#7a5211]">Warnings ({draft.warnings.length})</p>
          <ul className="mt-1 list-disc pl-4 text-[#7a5211]">
            {draft.warnings.slice(0, showDebug ? draft.warnings.length : 3).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
            {!showDebug && draft.warnings.length > 3 ? (
              <button type="button" onClick={() => setShowDebug(true)} className="text-[#66706a] hover:underline mt-1 block">Show all {draft.warnings.length} warnings</button>
            ) : null}
          </ul>
        </div>
      ) : null}
      {draft.unresolvedEvidenceRefs.length > 0 ? (
        <div className="rounded-md border border-[#d9ded8] bg-white p-3 text-xs">
          <p className="font-medium">Unresolved references ({draft.unresolvedEvidenceRefs.length})</p>
          <ul className="mt-1 list-disc pl-4 text-[#66706a]">
            {draft.unresolvedEvidenceRefs.slice(0, 5).map((ref, i) => {
              const refStr = typeof ref === "string" ? ref : JSON.stringify(ref);
              return <li key={i}>{refStr}</li>;
            })}
            {draft.unresolvedEvidenceRefs.length > 5 ? <li className="text-[#66706a]">...and {draft.unresolvedEvidenceRefs.length - 5} more</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ResolverSuggestionSummary({ result }: { result: FmdResolveResponse }) {
  const accepted = result.resolver.acceptedSuggestions ?? [];
  const needsReview = result.resolver.needsReview ?? [];
  const suggestions = result.resolver.suggestions ?? [];
  if (suggestions.length === 0) return null;
  return (
    <div className="rounded-md border border-[#d9ded8] bg-white p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">LLM suggestions</span>
        <span className="rounded bg-[#e3f3ed] px-1.5 py-0.5 text-[10px] text-[#1b5e4a]">
          {accepted.length} auto-applied
        </span>
        {needsReview.length > 0 ? (
          <span className="rounded bg-[#fff8e8] px-1.5 py-0.5 text-[10px] text-[#7a5211]">
            {needsReview.length} review
          </span>
        ) : null}
      </div>
      <div className="mt-2 space-y-2">
        {[...accepted.slice(0, 4), ...needsReview.slice(0, 4)].slice(0, 8).map((suggestion) => (
          <div key={suggestion.id} className="rounded border border-[#e3e7e2] bg-[#fbfbfa] p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={clsx(
                "rounded px-1.5 py-0.5 text-[10px] uppercase",
                suggestion.status === "accepted" ? "bg-[#e3f3ed] text-[#1b5e4a]" : "bg-[#fff8e8] text-[#7a5211]",
              )}>
                {suggestion.status === "accepted" ? "applied" : "review"}
              </span>
              <span className="font-medium">{suggestion.target}</span>
              <span className="text-[#66706a]">{Math.round(suggestion.confidence * 100)}%</span>
            </div>
            {suggestion.proposedValue ? (
              <p className="mt-1 break-words text-[#1b1f23]">{suggestion.proposedValue}</p>
            ) : null}
            {suggestion.reason ? (
              <p className="mt-1 break-words text-[#66706a]">{suggestion.reason}</p>
            ) : null}
            {suggestion.conflictNotes.length > 0 ? (
              <p className="mt-1 break-words text-[#7a5211]">{suggestion.conflictNotes.join("; ")}</p>
            ) : null}
            {suggestion.evidenceRefs.length > 0 ? (
              <p className="mt-1 break-words text-[10px] text-[#66706a]">
                Evidence: {suggestion.evidenceRefs.slice(0, 4).join(", ")}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      {suggestions.length > 8 ? (
        <p className="mt-2 text-[10px] text-[#66706a]">Showing 8 of {suggestions.length} suggestions.</p>
      ) : null}
    </div>
  );
}

const targetOptions: Array<{ value: ItemTarget; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "create", label: "Create" },
  { value: "merge", label: "Merge" },
  { value: "ignore", label: "Ignore" },
];

const targetColors: Record<ItemTarget, string> = {
  auto: "bg-[#eef1ee] text-[#66706a]",
  create: "bg-[#e3f3ed] text-[#1b5e4a]",
  merge: "bg-[#eef1ee] text-[#66706a]",
  ignore: "bg-[#f5f0e8] text-[#a08050]",
};

function ComparisonRow({ label, subtitle, selected, onToggle, currentValue, importValue, meta, target, onTargetChange, itemData }: { label: string; subtitle: string; selected: boolean; onToggle: ()=>void; currentValue: string; importValue: string; meta: string; target: ItemTarget; onTargetChange: (t:ItemTarget)=>void; itemData?: Record<string,unknown> }) {
  const [showTargetPicker, setShowTargetPicker] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  return (
    <div className={clsx("flex items-center gap-2 rounded-md border px-3 py-2", selected ? "border-[#1b5e4a] bg-[#f3f8f5]" : "border-[#d9ded8] bg-white")}>
      <input type="checkbox" checked={selected} onChange={onToggle} className="h-3.5 w-3.5 shrink-0 accent-[#1b5e4a]" />
      <div className="min-w-0 flex-[2]">
        <p className="truncate text-xs font-medium">{label}</p>
        <p className="truncate text-[10px] text-[#66706a]">{subtitle}</p>
      </div>
      <div className="hidden min-w-0 flex-1 sm:block">
        <p className="text-[10px] uppercase text-[#66706a]">Current</p>
        <p className="truncate text-xs">{currentValue}</p>
      </div>
      <div className="hidden min-w-0 flex-1 sm:block">
        <p className="text-[10px] uppercase text-[#66706a]">Import</p>
        <p className="truncate text-xs font-medium text-[#1b5e4a]">{importValue}</p>
      </div>
      <button type="button" onClick={() => setShowDetail(true)}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[#66706a] hover:bg-[#eef1ee]">
        Edit
      </button>
      <div className="relative shrink-0">
        <button type="button" onClick={() => setShowTargetPicker(!showTargetPicker)}
          className={clsx("rounded px-1.5 py-0.5 text-[10px] font-medium", targetColors[target])}>
          {targetOptions.find((o) => o.value === target)?.label ?? "Auto"}
        </button>
        {showTargetPicker ? (
          <div className="absolute right-0 top-full z-10 mt-1 w-24 rounded-md border border-[#d9ded8] bg-white shadow-md">
            {targetOptions.map((opt) => (
              <button key={opt.value} type="button" onClick={() => { onTargetChange(opt.value); setShowTargetPicker(false); }}
                className={clsx("block w-full px-2 py-1 text-left text-[10px] hover:bg-[#eef1ee]", opt.value === target ? "font-semibold text-[#1b5e4a]" : "text-[#66706a]")}>
                {opt.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <span className={clsx("hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] sm:block", meta === "Will update" || meta === "Will merge" ? "bg-[#eef1ee] text-[#66706a]" : meta === "Will create" || meta === "New" ? "bg-[#e3f3ed] text-[#1b5e4a]" : "bg-[#fbfbfa] text-[#66706a]")}>
        {meta}
      </span>
      {showDetail && itemData ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowDetail(false)}>
          <div className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase text-[#66706a]">Item Detail</p>
              <button type="button" onClick={() => setShowDetail(false)} className="grid h-5 w-5 place-items-center rounded text-[#66706a] hover:bg-[#eef1ee]"><X size={12} /></button>
            </div>
            <pre className="overflow-auto rounded bg-[#fbfbfa] p-3 text-[11px] leading-relaxed">{JSON.stringify(itemData, null, 2)}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EmptyTab({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-xs text-[#66706a]">
      <AlertTriangle size={20} className="mb-2 text-[#cfd6cf]" />
      <p>{text}</p>
    </div>
  );
}
