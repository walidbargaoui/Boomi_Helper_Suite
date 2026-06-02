"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ExternalLink,
  RefreshCw,
  BookOpen,
  Network,
  Layers,
  List,
  GitCompare,
  GitCommit,
  Workflow,
  Cpu,
  type LucideIcon,
} from "lucide-react";
import type { FmdSection, Project } from "@/lib/domain";
import { normalizeSectionType } from "@/lib/fmd-section-schemas";
import { getSectionTypeMeta } from "@/lib/fmd-section-registry";
import { validateFmdSection, parseFmdSectionContent } from "@/lib/fmd-section-helpers";

const entityIcons: Record<string, LucideIcon> = {
  project: BookOpen,
  endpoint: Network,
  profile: Layers,
  profileField: List,
  mappingSet: GitCompare,
  mappingRule: GitCommit,
  processFlow: Workflow,
  processFlowNode: Workflow,
  boomiDraft: Cpu,
};

const entityTabMap: Record<string, string> = {
  endpoint: "dashboard",
  profile: "dashboard",
  mappingSet: "mapping",
  mappingRule: "mapping",
  processFlow: "flow",
  processFlowNode: "flow",
  boomiDraft: "boomi",
  project: "fmd",
  profileField: "mapping",
};

interface FmdContextPanelProps {
  section: FmdSection | null;
  project: Project;
  onRefresh?: () => void;
  onNavigateTab?: (tab: string) => void;
}

interface ContextItem {
  icon: LucideIcon;
  label: string;
  value: string;
}

export function FmdContextPanel({ section, project, onRefresh, onNavigateTab }: FmdContextPanelProps) {
  if (!section) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-[#66706a]">
        Select a section to see details
      </div>
    );
  }

  const normalizedType = normalizeSectionType(section.sectionType);
  const meta = getSectionTypeMeta(normalizedType);
  const validation = validateFmdSection(section);
  const content = parseFmdSectionContent(section.content);
  const sectionContext = buildSectionContext(section, project);

  const navigateTo = (entityType: string) => {
    const tab = entityTabMap[entityType] ?? "fmd";
    sessionStorage.setItem("pendingFmdTab", tab);
    onNavigateTab?.(tab);
  };

  const entityLabel = (entityType: string): string => {
    switch (entityType) {
      case "project":
        return "Project";
      case "endpoint":
        return "Endpoint";
      case "profile":
        return "Profile";
      case "profileField":
        return "Profile Field";
      case "mappingSet":
        return "Mapping Set";
      case "mappingRule":
        return "Mapping Rule";
      case "processFlow":
        return "Process Flow";
      case "processFlowNode":
        return "Flow Node";
      case "boomiDraft":
        return "Boomi Draft";
      default:
        return entityType;
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 p-3 text-xs">
      {/* Section info */}
      <div className="rounded-md border border-[#d9ded8] bg-white p-3">
        <p className="text-[10px] font-semibold uppercase text-[#66706a]">Section Info</p>
        <p className="mt-2 text-sm font-semibold">{section.title}</p>
        <p className="mt-0.5 text-[#66706a]">{meta?.description ?? ""}</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="rounded-md border border-[#cfd6cf] bg-[#fbfbfa] px-1.5 py-0.5 text-[10px] uppercase">
            {content.sourceMode}
          </span>
          {meta?.required ? (
            <span className="rounded-md border border-[#cfd6cf] bg-[#fbfbfa] px-1.5 py-0.5 text-[10px] uppercase">
              Required
            </span>
          ) : null}
        </div>
      </div>

      {/* Quick actions */}
      <div className="rounded-md border border-[#d9ded8] bg-white p-3">
        <p className="text-[10px] font-semibold uppercase text-[#66706a]">Actions</p>
        <div className="mt-2 flex flex-col gap-1.5">
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              className="flex items-center gap-1.5 rounded border border-[#cfd6cf] px-2 py-1 text-[11px] hover:bg-[#eef1ee]"
            >
              <RefreshCw size={12} />
              Refresh from source
            </button>
          ) : null}
          {content.sourceMode === "mixed" || content.sourceMode === "manual" ? (
            <button
              type="button"
              onClick={() => navigateTo("project")}
              className="flex items-center gap-1.5 rounded border border-[#cfd6cf] px-2 py-1 text-[11px] hover:bg-[#eef1ee]"
            >
              <BookOpen size={12} />
              Edit source data
            </button>
          ) : null}
        </div>
      </div>

      {/* Section context summary */}
      {sectionContext.length > 0 ? (
        <div className="rounded-md border border-[#d9ded8] bg-white p-3">
          <p className="text-[10px] font-semibold uppercase text-[#66706a]">Context</p>
          <div className="mt-2 space-y-1.5">
            {sectionContext.map((item, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[#66706a]">
                <item.icon size={12} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-[#3f4c52]">{item.label}</p>
                  <p className="truncate text-[10px]">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Linked entities */}
      {content.linkedEntities.length > 0 ? (
        <div className="rounded-md border border-[#d9ded8] bg-white p-3">
          <p className="text-[10px] font-semibold uppercase text-[#66706a]">Linked Data</p>
          <div className="mt-2 space-y-1">
            {content.linkedEntities.map((entity, i) => {
              const Icon = entityIcons[entity.entityType] ?? ExternalLink;
              return (
                <button
                  key={`${entity.entityType}-${entity.entityId}-${i}`}
                  type="button"
                  onClick={() => navigateTo(entity.entityType)}
                  className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[#66706a] hover:bg-[#eef1ee]"
                >
                  <Icon size={10} className="shrink-0" />
                  <span className="flex-1 truncate">{entity.label ?? entityLabel(entity.entityType)}</span>
                  <ExternalLink size={8} className="shrink-0 text-[#cfd6cf]" />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Stale state */}
      {content.staleState?.isStale ? (
        <div className="rounded-md border border-[#e8c8a8] bg-[#fff8e8] p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-[#7a5211]">Stale data</p>
            {onRefresh ? (
              <button type="button" onClick={onRefresh} aria-label="Refresh stale data">
                <RefreshCw size={12} className="text-[#7a5211]" />
              </button>
            ) : null}
          </div>
          <div className="mt-1 space-y-0.5 text-[10px] text-[#7a5211]">
            <p>Last synced: {content.staleState.lastSyncedAt ?? "never"}</p>
            {content.staleState.changedPaths && content.staleState.changedPaths.length > 0 ? (
              <div>
                <p className="mt-1 font-medium">Changed fields:</p>
                <ul className="ml-3 list-disc">
                  {content.staleState.changedPaths.map((path, i) => (
                    <li key={i}>{path}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Validation */}
      <div className="rounded-md border border-[#d9ded8] bg-white p-3">
        <p className="text-[10px] font-semibold uppercase text-[#66706a]">Validation</p>
        <div className="mt-2 space-y-1">
          {validation.errors.length > 0 ? (
            validation.errors.map((err, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[#9c2a2a]">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>{err}</span>
              </div>
            ))
          ) : validation.warnings.length > 0 ? (
            validation.warnings.map((warn, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[#7a5211]">
                <Info size={12} className="mt-0.5 shrink-0" />
                <span>{warn}</span>
              </div>
            ))
          ) : (
            <div className="flex items-center gap-1.5 text-[#298b68]">
              <CheckCircle2 size={12} />
              <span>No issues</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function buildSectionContext(section: FmdSection, project: Project): ContextItem[] {
  const type = normalizeSectionType(section.sectionType);
  const content = parseFmdSectionContent(section.content);
  const data = content.data as Record<string, unknown>;

  switch (type) {
    case "projectSummary":
      return [
        { icon: BookOpen, label: "Process ID", value: (data?.linkedProcessId as string) || project.processId || "" },
        { icon: BookOpen, label: "Owner", value: (data?.linkedOwner as string) || project.owner || "" },
        { icon: Network, label: "Source System", value: (data?.linkedSourceSystem as string) || project.sourceSystem || "" },
        { icon: Network, label: "Destination System", value: (data?.linkedDestinationSystem as string) || project.destinationSystem || "" },
        { icon: RefreshCw, label: "Schedule", value: (data?.linkedSchedule as string) || project.schedule || "" },
      ];
    case "endpointDetails": {
      const endpoints = Array.isArray(data?.endpoints) ? data.endpoints as Array<{ role?: string; name?: string }> : [];
      return [
        { icon: Network, label: "Total endpoints", value: String(endpoints.length) },
        { icon: Network, label: "Source", value: String(endpoints.filter((e) => e.role === "source").length) },
        { icon: Network, label: "Destination", value: String(endpoints.filter((e) => e.role === "destination").length) },
        { icon: Layers, label: "Project endpoints", value: String(project.endpoints.length) },
      ];
    }
    case "profileInventory": {
      const profiles = Array.isArray(data?.profiles) ? data.profiles as Array<{ role?: string; name?: string }> : [];
      return [
        { icon: Layers, label: "Documented profiles", value: String(profiles.length) },
        { icon: Layers, label: "Project profiles", value: String(project.profiles.length) },
        { icon: List, label: "Total fields", value: String(project.profiles.reduce((a, p) => a + p.fields.length, 0)) },
      ];
    }
    case "fieldMapping": {
      const rules = Array.isArray(data?.rules) ? data.rules as Array<{ destination?: string }> : [];
      return [
        { icon: GitCompare, label: "Mapping rules", value: String(rules.length) },
        { icon: GitCommit, label: "Mapping sets", value: String(project.mappingSets.length) },
      ];
    }
    case "environmentConfig": {
      const envs = Array.isArray(data?.environmentRows) ? data.environmentRows as Array<{ environment?: string }> : [];
      return [
        { icon: Cpu, label: "Environments", value: String(envs.length) },
        ...envs.slice(0, 4).map((env) => ({
          icon: Cpu, label: env.environment ?? "", value: "",
        })),
      ];
    }
    case "processFlow": {
      const flowCount = project.processFlows.length;
      const nodeCount = project.processFlows.reduce((a, f) => a + (f.nodes?.length ?? 0), 0);
      return [
        { icon: Workflow, label: "Process flows", value: String(flowCount) },
        { icon: Workflow, label: "Total steps", value: String(nodeCount) },
      ];
    }
    case "errorHandling":
      return [
        { icon: AlertTriangle, label: "Retry policy", value: (data?.retryPolicy as string) || "Not configured" },
        { icon: AlertTriangle, label: "Failure routing", value: (data?.failureRouting as string) || "Not configured" },
      ];
    case "boomiComponents": {
      const comps = Array.isArray(data?.componentRows) ? data.componentRows : [];
      const draftCount = project.boomiDrafts?.length ?? 0;
      return [
        { icon: Cpu, label: "Components documented", value: String(comps.length) },
        { icon: Cpu, label: "Imported templates", value: String(draftCount) },
      ];
    }
    case "testCases":
      return [
        { icon: CheckCircle2, label: "Test cases", value: String(Array.isArray(data?.cases) ? data.cases.length : 0) },
      ];
    case "qualityChecklist": {
      const items = Array.isArray(data?.items) ? data.items as Array<{ status?: string }> : [];
      const done = items.filter((i) => i.status === "done" || i.status === "passed").length;
      return [
        { icon: CheckCircle2, label: "Checklist items", value: String(items.length) },
        { icon: CheckCircle2, label: "Completed", value: String(done) },
      ];
    }
    default:
      return [];
  }
}
