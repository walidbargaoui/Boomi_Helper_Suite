"use client";

import { useCallback, useEffect, useMemo, useState, startTransition } from "react";
import { useRouter } from "next/navigation";
import "reactflow/dist/style.css";
import { useProject } from "@/hooks/use-project";
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Database,
  Download,
  FileSpreadsheet,
  GitCompareArrows,
  Layers3,
  Network,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Table2,
  Trash2,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import type {
  Endpoint,
  MappingIssue,
  Profile,
  Project,
} from "@/lib/domain";
import type { ProjectSummary } from "@/lib/db";
import { FlowDesigner, FlowEmptyState } from "@/components/flow-tab";
import { GlobalDashboard } from "@/components/global-dashboard";
import { qualityScore, validateMappingSet } from "@/lib/mapping-quality";
import { MappingStudio } from "@/components/mapping-studio";
import { IssueRow, PanelHeader, StatusPill, WorkspacePanel, InfoRow } from "@/components/atoms";
import { extractError } from "@/lib/api-utils";
import { useToast } from "@/components/toast";
import { BoomiApiLab } from "@/components/boomi-api-tab";
import { FmdBuilder } from "@/components/fmd/fmd-workbench";
import { ImportExcelButton } from "@/components/import-excel-button";

const projectStatuses: Project["status"][] = [
  "Draft",
  "Mapping Review",
  "Ready for Sandbox",
  "Published",
];

const endpointRoles: Endpoint["role"][] = ["source", "destination", "notification", "reference"];

const profileTypes: Profile["type"][] = ["Flat File", "JSON", "XML", "Database", "API"];
const profileRoles: Profile["role"][] = ["source", "destination"];

const profileFormatOptionsByType: Record<Profile["type"], string[]> = {
  "Flat File": ["TSV", "CSV", "Fixed Width", "Pipe", "JSON", "XML"],
  JSON: ["JSON"],
  XML: ["XML"],
  Database: ["Table", "View", "Stored Procedure"],
  API: ["REST", "SOAP", "OData", "GraphQL", "JSON", "XML"],
};

function defaultFormatForType(type: Profile["type"]): string {
  return profileFormatOptionsByType[type]?.[0] ?? "";
}

type WorkspaceAppProps = {
  initialProject: Project | null;
  initialProjects: ProjectSummary[];
};

type WorkspaceTab = "dashboard" | "mapping" | "fmd" | "flow" | "boomi";

const tabs: Array<{
  id: WorkspaceTab;
  label: string;
  icon: typeof Table2;
}> = [
  { id: "dashboard", label: "Workspace", icon: Table2 },
  { id: "mapping", label: "Mapping", icon: GitCompareArrows },
  { id: "fmd", label: "FMD", icon: FileSpreadsheet },
  { id: "flow", label: "Flow", icon: Workflow },
  { id: "boomi", label: "Boomi API", icon: Braces },
];

export function WorkspaceApp({ initialProject, initialProjects }: WorkspaceAppProps) {
  const router = useRouter();
  const { project, mutate: mutateProject } = useProject(initialProject?.id, initialProject);
  const [projects, setProjects] = useState(initialProjects);

  const setProject = useCallback(
    (next: Project | ((prev: Project) => Project)) => {
      mutateProject((current) => {
        const prev = current as Project;
        return typeof next === "function" ? (next as (prev: Project) => Project)(prev) : next;
      }, false);
    },
    [mutateProject],
  );
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("dashboard");
  const [showProjectDialog, setShowProjectDialog] = useState(false);
  const [switchingProject, setSwitchingProject] = useState(false);
  const [workspaceLockReason, setWorkspaceLockReason] = useState<string | null>(null);
  const workspaceLocked = Boolean(workspaceLockReason);
  const [projectSearch, setProjectSearch] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [selectedMappingSetIndex, setSelectedMappingSetIndex] = useState(0);
  const toast = useToast();

  useEffect(() => {
    if (project?.mode === "fallback") {
      toast.addToast({
        message: "Database unavailable — project loaded from sample data. Edits are disabled.",
        type: "info",
        duration: 8000,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [project?.mode]);

  useEffect(() => {
    const pendingTab = sessionStorage.getItem("pendingFmdTab");
    if (pendingTab) {
      sessionStorage.removeItem("pendingFmdTab");
      startTransition(() => setActiveTab(pendingTab as WorkspaceTab));
    }
  }, []);

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      p.processId.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
    );
  }, [projects, projectSearch]);

  const groupedProjects = useMemo(() => {
    const groups = new Map<string, ProjectSummary[]>();
    for (const p of filteredProjects) {
      const folder = (p.folder?.trim() || "Uncategorized");
      const list = groups.get(folder) ?? [];
      list.push(p);
      groups.set(folder, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredProjects]);

  const mappingSet = project ? (project.mappingSets[selectedMappingSetIndex] ?? project.mappingSets[0]) : undefined;
  const sourceProfile = mappingSet && project
    ? project.profiles.find((profile) => profile.id === mappingSet.sourceProfileId)
    : undefined;
  const destinationProfile = mappingSet && project
    ? project.profiles.find((profile) => profile.id === mappingSet.destinationProfileId)
    : undefined;
  const issues = useMemo(() => {
    if (!mappingSet || !sourceProfile || !destinationProfile) return [];
    return validateMappingSet(mappingSet, sourceProfile, destinationProfile);
  }, [mappingSet, sourceProfile, destinationProfile]);

  function updateProjectSidebar(next: Partial<Project>) {
    setProjects((prev) => prev.map((p) => (p.id === project?.id ? { ...p, ...next } as ProjectSummary : p)));
  }

  function reflectProject(next: Project) {
    setProject(next);
    updateProjectSidebar(next);
  }

  function switchProject(projectId: string) {
    if (workspaceLocked) return;
    if (project?.id === projectId) return;
    setSwitchingProject(true);
    router.push(`/?project=${projectId}`);
    router.refresh();
  }

  async function handleProjectCreated(created: ProjectSummary) {
    setProjects((prev) => [created, ...prev.filter((summary) => summary.id !== created.id)]);
    router.push(`/?project=${created.id}`);
    router.refresh();
  }

  async function handleDeleteProject() {
    if (workspaceLocked || !project) return;
    const ok = await toast.confirm(`Delete project "${project.name}"? This removes all data for ${project.processId}.`);
    if (!ok) return;
    const removedId = project.id;
    const removedProjects = projects;
    const timeoutId = setTimeout(async () => {
      const response = await fetch(`/api/projects/${removedId}`, { method: "DELETE" });
      if (!response.ok) {
        toast.addToast({ message: "Failed to delete project", type: "error" });
        return;
      }
      const remaining = removedProjects.filter((summary) => summary.id !== removedId);
      setProjects(remaining);
      const next = remaining[0]?.id ?? "";
      router.push(next ? `/?project=${next}` : "/");
      router.refresh();
    }, 5000);
    toast.addToast({
      message: `Deleting "${project.name}"…`,
      type: "info",
      duration: 5000,
      action: {
        label: "Undo",
        onAction: () => { clearTimeout(timeoutId); },
      },
    });
  }

  return (
    <div className="relative min-h-screen bg-[#f5f6f4] lg:grid lg:grid-cols-[260px_1fr]">
      {switchingProject ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#f5f6f4]/80">
          <div className="flex items-center gap-3 rounded-lg bg-white px-5 py-3 shadow-lg">
            <RefreshCw size={18} className="animate-spin text-[#298b68]" />
            <span className="text-sm font-medium text-[#111714]">Loading project…</span>
          </div>
        </div>
      ) : null}
      <aside className="border-b border-[#d9ded8] bg-[#111714] text-white lg:border-b-0 lg:border-r">
        <div className="border-b border-white/10 px-5 py-5">
          <button
            onClick={() => { router.push("/"); router.refresh(); }}
            className="flex cursor-pointer items-center gap-3 text-left hover:opacity-80 transition-opacity"
            title="Go to dashboard"
            type="button"
          >
            <div className="grid h-9 w-9 place-items-center rounded-md bg-[#3fb58b] text-[#07110d]">
              <Workflow size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold">Boomi Helper Suite</p>
              <p className="text-xs text-white/55">Local architect workspace</p>
            </div>
          </button>
        </div>
        <div className="px-5 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/45">Projects</p>
            <button
              type="button"
              onClick={() => setShowProjectDialog(true)}
              disabled={workspaceLocked}
              title="Create project"
              aria-label="Create project"
              className="grid h-7 w-7 cursor-pointer place-items-center rounded-md border border-white/15 bg-white/[0.06] text-white hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Plus size={13} />
            </button>
          </div>
          {projects.length > 0 ? (
            <div className="mt-2">
              <input
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                placeholder="Search projects…"
                aria-label="Search projects"
                className="h-7 w-full rounded-md border border-white/15 bg-white/[0.06] px-2 text-xs text-white placeholder-white/30 outline-none focus:border-white/30"
              />
            </div>
          ) : null}
          <div className="mt-2 max-h-[340px] space-y-0.5 overflow-y-auto pr-1">
            {groupedProjects.map(([folder, folderProjects]) => {
              const isCollapsed = collapsedFolders.has(folder);
              return (
                <div key={folder}>
                  <button
                    className="flex w-full cursor-pointer items-center gap-1 px-1 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-white/35 hover:text-white/55"
                    onClick={() => {
                      const next = new Set(collapsedFolders);
                      if (next.has(folder)) next.delete(folder); else next.add(folder);
                      setCollapsedFolders(next);
                    }}
                    type="button"
                  >
                    {isCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                    {folder}
                    <span className="ml-auto text-white/25">{folderProjects.length}</span>
                  </button>
                  {!isCollapsed ? folderProjects.map((summary) => {
                    const isActive = project && summary.id === project.id;
                    return (
                      <button
                        key={summary.id}
                        type="button"
                        onClick={() => switchProject(summary.id)}
                        disabled={workspaceLocked}
                        className={clsx(
                          "flex w-full cursor-pointer items-center gap-2 rounded-md py-0.5 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-55",
                          isActive
                            ? "text-white font-medium"
                            : "text-white/55 hover:text-white/80",
                        )}
                      >
                        <span className="shrink-0 w-16 truncate font-mono text-[10px] text-white/35">{summary.processId}</span>
                        <span className="truncate">{summary.name}</span>
                      </button>
                    );
                  }) : null}
                </div>
              );
            })}
            {filteredProjects.length === 0 ? (
              <p className="rounded-md border border-dashed border-white/15 p-3 text-xs text-white/55">
                {projects.length === 0 ? "No projects yet. Create one to get started." : "No matching projects."}
              </p>
            ) : null}
          </div>
      </div>
        {project ? (
          <>
            <div className="px-3 py-4">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    disabled={workspaceLocked && tab.id !== activeTab}
                    className={clsx(
                      "mb-1 flex h-10 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-45",
                      activeTab === tab.id
                        ? "bg-white text-[#111714]"
                        : "text-white/72 hover:bg-white/10 hover:text-white",
                    )}
                    onClick={() => setActiveTab(tab.id)}
                    type="button"
                  >
                    <Icon size={17} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 px-5 pb-5">
              <button
                type="button"
                onClick={handleDeleteProject}
                disabled={workspaceLocked}
                className="inline-flex h-8 w-full cursor-pointer items-center justify-center gap-1 rounded-md border border-white/10 px-2 text-xs text-white/55 hover:border-[#a14444] hover:text-[#f59e9e] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Trash2 size={12} />
                Delete current project
              </button>
            </div>
          </>
        ) : (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-white/40">Select a project to start working</p>
          </div>
        )}
      </aside>

      <main className="min-w-0">
        {project ? (
          <>
            <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-[#d9ded8] bg-white px-6 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <h1 className="truncate text-lg font-semibold">{project.name}</h1>
                  <StatusPill label={project.status} tone="green" />
                  <StatusPill label={project.boomiConnections[0]?.mode ?? "mock"} tone="amber" />
                </div>
                <p className="mt-1 text-xs text-[#66706a]">
                  {project.sourceSystem} <span className="mx-1">to</span> {project.destinationSystem}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {workspaceLockReason ? (
                  <div className="mr-2 inline-flex h-9 items-center gap-2 rounded-md border border-[#d9ded8] bg-[#fbfbfa] px-3 text-xs text-[#66706a]">
                    <RefreshCw size={14} className="animate-spin text-[#298b68]" />
                    {workspaceLockReason}
                  </div>
                ) : null}
                <IconButton href={`/api/fmd/export?projectId=${encodeURIComponent(project.id)}`} title="Export FMD" disabled={workspaceLocked}>
                  <Download size={16} />
                </IconButton>
                <IconButton title="Run dry-run" onClick={() => setActiveTab("boomi")} disabled={workspaceLocked}>
                  <PlayCircle size={16} />
                </IconButton>
              </div>
            </header>

            {activeTab === "dashboard" && (
              <Dashboard project={project} issues={issues} sourceProfile={sourceProfile} selectedMappingSetIndex={selectedMappingSetIndex} setProject={reflectProject} updateProjectSidebar={updateProjectSidebar} />
            )}
            {activeTab === "mapping" && (
              mappingSet && sourceProfile && destinationProfile ? (
                <MappingStudio
                  project={project}
                  setProject={setProject}
                  sourceProfile={sourceProfile}
                  destinationProfile={destinationProfile}
                  issues={issues}
                  selectedMappingSetIndex={selectedMappingSetIndex}
                  setSelectedMappingSetIndex={setSelectedMappingSetIndex}
                />
              ) : (
                <EmptyMappingState project={project} setProject={setProject} />
              )
            )}
            {activeTab === "fmd" && (
              <FmdBuilder
                project={project}
                setProject={setProject}
                setWorkspaceLockReason={setWorkspaceLockReason}
              />
            )}
            {activeTab === "flow" && project.processFlows[0] ? (
              <FlowDesigner flow={project.processFlows[0]} projectId={project.id} setProject={setProject as (p: Project | ((prev: Project) => Project)) => void} />
            ) : activeTab === "flow" ? (
              <FlowEmptyState projectId={project.id} project={project} setProject={setProject as (p: Project) => void} />
            ) : null}
            {activeTab === "boomi" && <BoomiApiLab project={project} setProject={setProject as (p: Project) => void} />}
          </>
        ) : (
          <GlobalDashboard projects={projects} onCreateProject={() => setShowProjectDialog(true)} />
        )}
      </main>

      {showProjectDialog ? (
        <ProjectCreateDialog
          onClose={() => setShowProjectDialog(false)}
          onCreated={(created) => {
            setShowProjectDialog(false);
            handleProjectCreated(created);
          }}
        />
      ) : null}
    </div>
  );
}

function EmptyMappingState({
  project,
  setProject,
}: {
  project: Project;
  setProject: (project: Project) => void;
}) {
  const sourceProfiles = project.profiles.filter((profile) => profile.role === "source");
  const destProfiles = project.profiles.filter((profile) => profile.role === "destination");
  const [name, setName] = useState("Map source to destination");
  const [sourceId, setSourceId] = useState(sourceProfiles[0]?.id ?? "");
  const [destId, setDestId] = useState(destProfiles[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!sourceId || !destId) {
      setError("Pick both a source and destination profile.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${project.id}/mapping-sets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, sourceProfileId: sourceId, destinationProfileId: destId }),
      });
      if (!response.ok) throw new Error(await extractError(response));
      const data = (await response.json()) as {
        mappingSet: { id: string; name: string; sourceProfileId: string; destinationProfileId: string; direction: string; status: string };
      };
      setProject({
        ...project,
        mappingSets: [
          ...project.mappingSets,
          {
            id: data.mappingSet.id,
            name: data.mappingSet.name,
            sourceProfileId: data.mappingSet.sourceProfileId,
            destinationProfileId: data.mappingSet.destinationProfileId,
            direction: data.mappingSet.direction,
            status: data.mappingSet.status as Project["mappingSets"][number]["status"],
            rules: [],
            transformNodes: [],
          },
        ],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create mapping set.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-5">
      <div className="panel max-w-xl">
        <PanelHeader icon={GitCompareArrows} title="No mapping set yet" />
        <p className="mt-2 text-sm text-[#66706a]">
          Create source and destination profiles first, then start a mapping set linking them.
        </p>
        {project.profiles.length < 2 ? (
          <div className="mt-4 rounded-md border border-dashed border-[#cfd6cf] bg-[#fbfbfa] p-4 text-sm text-[#66706a]">
            This project needs at least one source and one destination profile. Add profiles from the Workspace tab.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <Labeled label="Name">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
              />
            </Labeled>
            <Labeled label="Source profile">
              <select
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
                className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
              >
                <option value="">Select source…</option>
                {sourceProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </select>
            </Labeled>
            <Labeled label="Destination profile">
              <select
                value={destId}
                onChange={(event) => setDestId(event.target.value)}
                className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]"
              >
                <option value="">Select destination…</option>
                {destProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </select>
            </Labeled>
            {error ? <p className="text-xs text-[#9c2a2a]">{error}</p> : null}
            <button
              type="button"
              onClick={create}
              disabled={busy}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d] disabled:opacity-60"
            >
              <Plus size={16} />
              Create mapping set
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Dashboard({
  project,
  issues,
  sourceProfile,
  selectedMappingSetIndex,
  setProject,
  updateProjectSidebar,
}: {
  project: Project;
  issues: MappingIssue[];
  sourceProfile?: Profile;
  selectedMappingSetIndex: number;
  setProject: (project: Project) => void;
  updateProjectSidebar: (next: Partial<Project>) => void;
}) {
  const toast = useToast();
  const score = qualityScore(issues);
  const latestExport = project.lastExportedAt
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(project.lastExportedAt),
      )
    : "Not exported";
  const [editingMeta, setEditingMeta] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState<Endpoint | null>(null);
  const [creatingEndpoint, setCreatingEndpoint] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);

  return (
    <WorkspacePanel>
      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCard icon={Database} label="Endpoints" value={project.endpoints.length} />
        <MetricCard icon={Layers3} label="Profile Fields" value={project.profiles.reduce((sum, profile) => sum + profile.fields.length, 0)} />
        <MetricCard icon={GitCompareArrows} label="Mappings" value={project.mappingSets[selectedMappingSetIndex]?.rules.length ?? 0} />
        <MetricCard icon={ShieldCheck} label="Quality Score" value={`${score}%`} />
      </section>

      <section className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.35fr_.65fr]">
        <div className="panel">
          <div className="flex items-center justify-between">
            <PanelHeader icon={Network} title="Project Dashboard" action={project.processId} />
            <button
              type="button"
              onClick={() => setEditingMeta(true)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-[#cfd6cf] bg-white px-2 text-xs hover:border-[#298b68]"
            >
              <Pencil size={12} />
              Edit metadata
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <InfoRow label="Description" value={project.description || "—"} wide />
            <InfoRow label="Owner" value={project.owner} />
            <InfoRow label="Schedule" value={project.schedule ?? "Unscheduled"} />
            <InfoRow label="Last FMD Export" value={latestExport} />
            <InfoRow label="Source Profile" value={sourceProfile?.name ?? "Not selected"} />
          </div>

          <div className="mt-5 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-[#66706a]">Endpoints</p>
            <button
              type="button"
              onClick={() => setCreatingEndpoint(true)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-[#cfd6cf] bg-white px-2 text-xs hover:border-[#298b68]"
            >
              <Plus size={12} />
              Add endpoint
            </button>
          </div>
          <div className="mt-2 overflow-hidden rounded-md border border-[#d9ded8]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#eef1ee] text-xs uppercase text-[#66706a]">
                <tr>
                  <th className="px-3 py-2">Endpoint</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Connector</th>
                  <th className="px-3 py-2">Format</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e3e7e2] bg-white">
                {project.endpoints.map((endpoint) => (
                  <tr key={endpoint.id}>
                    <td className="px-3 py-3 font-medium">{endpoint.name}</td>
                    <td className="px-3 py-3 text-[#66706a]">{endpoint.role}</td>
                    <td className="px-3 py-3 text-[#66706a]">{endpoint.connectorType}</td>
                    <td className="px-3 py-3 text-[#66706a]">{endpoint.format}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingEndpoint(endpoint)}
                          className="grid h-7 w-7 place-items-center rounded-md text-[#66706a] hover:bg-[#eef1ee]"
                          title="Edit"
                          aria-label="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const timeoutId = setTimeout(async () => {
                              const response = await fetch(`/api/endpoints/${endpoint.id}`, { method: "DELETE" });
                              if (!response.ok) {
                                toast.addToast({ message: "Failed to delete endpoint", type: "error" });
                                return;
                              }
                              setProject({
                                ...project,
                                endpoints: project.endpoints.filter((item) => item.id !== endpoint.id),
                              });
                            }, 5000);
                            toast.addToast({
                              message: `Deleting endpoint "${endpoint.name}"…`,
                              type: "info",
                              duration: 5000,
                              action: { label: "Undo", onAction: () => clearTimeout(timeoutId) },
                            });
                          }}
                          className="grid h-7 w-7 place-items-center rounded-md text-[#9c2a2a] hover:bg-[#fdecec]"
                          title="Delete"
                          aria-label="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {project.endpoints.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-sm text-[#66706a]">
                      No endpoints yet. Add the source, destination, and any notification or reference endpoints.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-[#66706a]">Profiles</p>
            <button
              type="button"
              onClick={() => setCreatingProfile(true)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-[#cfd6cf] bg-white px-2 text-xs hover:border-[#298b68]"
            >
              <Plus size={12} />
              Add profile
            </button>
          </div>
          <div className="mt-2 overflow-hidden rounded-md border border-[#d9ded8]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#eef1ee] text-xs uppercase text-[#66706a]">
                <tr>
                  <th className="px-3 py-2">Profile</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Format</th>
                  <th className="px-3 py-2">Fields</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e3e7e2] bg-white">
                {project.profiles.map((profile) => (
                  <tr key={profile.id}>
                    <td className="px-3 py-3 font-medium">{profile.name}</td>
                    <td className="px-3 py-3 text-[#66706a]">{profile.role}</td>
                    <td className="px-3 py-3 text-[#66706a]">{profile.type}</td>
                    <td className="px-3 py-3 text-[#66706a]">{profile.format}</td>
                    <td className="px-3 py-3 text-[#66706a]">{profile.fields.length}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingProfile(profile)}
                          className="grid h-7 w-7 place-items-center rounded-md text-[#4a524d] hover:bg-[#eef1ee]"
                          title="Edit"
                          aria-label="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const timeoutId = setTimeout(async () => {
                              const response = await fetch(`/api/profiles/${profile.id}`, { method: "DELETE" });
                              if (!response.ok) {
                                toast.addToast({ message: "Failed to delete profile", type: "error" });
                                return;
                              }
                              setProject({
                                ...project,
                                profiles: project.profiles.filter((item) => item.id !== profile.id),
                                mappingSets: project.mappingSets.filter(
                                  (set) => set.sourceProfileId !== profile.id && set.destinationProfileId !== profile.id,
                                ),
                              });
                            }, 5000);
                            toast.addToast({
                              message: `Deleting profile "${profile.name}"…`,
                              type: "info",
                              duration: 5000,
                              action: { label: "Undo", onAction: () => clearTimeout(timeoutId) },
                            });
                          }}
                          className="grid h-7 w-7 place-items-center rounded-md text-[#9c2a2a] hover:bg-[#fdecec]"
                          title="Delete"
                          aria-label="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {project.profiles.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-[#66706a]">
                      No profiles yet. Add a source and a destination profile to start mapping.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <PanelHeader icon={ClipboardCheck} title="Deployment Readiness" action="dry-run" />
          <ReadinessList
            items={[
              ["FMD sections normalized", project.fmdSections.length > 0],
              ["Required destinations mapped", !issues.some((issue) => issue.id.startsWith("unmapped"))],
              ["No duplicate destinations", !issues.some((issue) => issue.id.startsWith("duplicate"))],
              ["Boomi XML template attached", project.boomiDrafts.some((draft) => draft.templateXml)],
              ["Sandbox publish enabled", false],
            ]}
          />
          <div className="mt-5 rounded-md border border-[#d9ded8] bg-[#fbfbfa] p-3">
            <p className="text-xs font-semibold uppercase text-[#66706a]">Open quality items</p>
            <div className="mt-3 space-y-2">
              {issues.slice(0, 4).map((issue) => (
                <IssueRow key={issue.id} issue={issue} />
              ))}
              {issues.length === 0 ? (
                <p className="rounded-md border border-dashed border-[#cfd6cf] p-3 text-xs text-[#66706a]">
                  No mapping set yet — quality checks will appear once you add one.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {editingMeta ? (
        <ProjectMetadataDialog
          project={project}
          onClose={() => setEditingMeta(false)}
          onSaved={(next) => {
            setEditingMeta(false);
            if (project) setProject({ ...project, ...next });
            updateProjectSidebar(next);
          }}
        />
      ) : null}

      {creatingProfile ? (
        <ProfileDialog
          projectId={project.id}
          onClose={() => setCreatingProfile(false)}
          onSaved={(profile) => {
            setCreatingProfile(false);
            setProject({ ...project, profiles: [...project.profiles, { ...profile, fields: [] }] });
          }}
        />
      ) : null}

      {editingProfile ? (
        <ProfileEditDialog
          profile={editingProfile}
          onClose={() => setEditingProfile(null)}
          onSaved={(updated) => {
            setEditingProfile(null);
            setProject({
              ...project,
              profiles: project.profiles.map((item) => (item.id === updated.id ? updated : item)),
            });
          }}
        />
      ) : null}

      {creatingEndpoint || editingEndpoint ? (
        <EndpointDialog
          projectId={project.id}
          endpoint={editingEndpoint ?? undefined}
          onClose={() => {
            setCreatingEndpoint(false);
            setEditingEndpoint(null);
          }}
          onSaved={(endpoint) => {
            setCreatingEndpoint(false);
            setEditingEndpoint(null);
            if (project.endpoints.some((existing) => existing.id === endpoint.id)) {
              setProject({
                ...project,
                endpoints: project.endpoints.map((existing) =>
                  existing.id === endpoint.id ? endpoint : existing,
                ),
              });
            } else {
              setProject({ ...project, endpoints: [...project.endpoints, endpoint] });
            }
          }}
        />
      ) : null}
    </WorkspacePanel>
  );
}

function ProjectMetadataDialog({
  project,
  onClose,
  onSaved,
}: {
  project: Project;
  onClose: () => void;
  onSaved: (data: Partial<Project>) => void;
}) {
  const [form, setForm] = useState({
    processId: project.processId,
    name: project.name,
    description: project.description,
    sourceSystem: project.sourceSystem,
    destinationSystem: project.destinationSystem,
    owner: project.owner,
    schedule: project.schedule ?? "",
    folder: project.folder ?? "",
    status: project.status,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          folder: form.folder || null,
          schedule: form.schedule || null,
        }),
      });
      if (!response.ok) throw new Error(await extractError(response));
      const data = (await response.json()) as { project: typeof form & { id: string; folder?: string } }; 
      onSaved({
        processId: data.project.processId,
        name: data.project.name,
        description: data.project.description,
        sourceSystem: data.project.sourceSystem,
        destinationSystem: data.project.destinationSystem,
        owner: data.project.owner,
        schedule: form.schedule || undefined,
        folder: data.project.folder || undefined,
        status: form.status as Project["status"],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DrawerShell title="Edit project" onClose={onClose}>
      <DrawerBody>
        <Labeled label="Process ID">
          <input value={form.processId} onChange={(event) => setForm({ ...form, processId: event.target.value })} className={inputClass} />
        </Labeled>
        <Labeled label="Name">
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} />
        </Labeled>
        <Labeled label="Description">
          <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={`${inputClass} min-h-[80px]`} />
        </Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Source system">
            <input value={form.sourceSystem} onChange={(event) => setForm({ ...form, sourceSystem: event.target.value })} className={inputClass} />
          </Labeled>
          <Labeled label="Destination system">
            <input value={form.destinationSystem} onChange={(event) => setForm({ ...form, destinationSystem: event.target.value })} className={inputClass} />
          </Labeled>
        </div>
        <Labeled label="Owner">
          <input value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} className={inputClass} />
        </Labeled>
        <Labeled label="Schedule">
          <input value={form.schedule} onChange={(event) => setForm({ ...form, schedule: event.target.value })} placeholder="e.g. Mon-Fri 14:00" className={inputClass} />
        </Labeled>
        <Labeled label="Folder">
          <input value={form.folder} onChange={(event) => setForm({ ...form, folder: event.target.value })} placeholder="e.g. Finance, B2B" className={inputClass} />
        </Labeled>
        <Labeled label="Status">
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Project["status"] })} className={inputClass}>
            {projectStatuses.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </Labeled>
        {error ? <p className="text-xs text-[#9c2a2a]">{error}</p> : null}
      </DrawerBody>
      <DrawerFooter onClose={onClose} primaryLabel="Save changes" onPrimary={save} busy={busy} />
    </DrawerShell>
  );
}

function EndpointDialog({
  projectId,
  endpoint,
  onClose,
  onSaved,
}: {
  projectId: string;
  endpoint?: Endpoint;
  onClose: () => void;
  onSaved: (endpoint: Endpoint) => void;
}) {
  const [form, setForm] = useState<Endpoint>(
    endpoint ?? {
      id: "",
      name: "",
      role: "source",
      connectorType: "",
      profileType: "",
      format: "",
      purpose: "",
      connectionInfo: "",
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = Boolean(endpoint);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const url = isEdit ? `/api/endpoints/${endpoint!.id}` : `/api/projects/${projectId}/endpoints`;
      const response = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          role: form.role,
          connectorType: form.connectorType,
          profileType: form.profileType,
          format: form.format,
          purpose: form.purpose,
          connectionInfo: form.connectionInfo,
        }),
      });
      if (!response.ok) throw new Error(await extractError(response));
      const data = (await response.json()) as { endpoint: Endpoint };
      onSaved(data.endpoint);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DrawerShell title={isEdit ? "Edit endpoint" : "New endpoint"} onClose={onClose}>
      <DrawerBody>
        <Labeled label="Name">
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} />
        </Labeled>
        <Labeled label="Role">
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Endpoint["role"] })} className={inputClass}>
            {endpointRoles.map((role) => (
              <option key={role} value={role}>{role}</option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Connector type">
          <input value={form.connectorType} onChange={(event) => setForm({ ...form, connectorType: event.target.value })} placeholder="HTTP Client / REST API" className={inputClass} />
        </Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Profile type">
            <input value={form.profileType} onChange={(event) => setForm({ ...form, profileType: event.target.value })} placeholder="Flat File / JSON / XML" className={inputClass} />
          </Labeled>
          <Labeled label="Format">
            <input value={form.format} onChange={(event) => setForm({ ...form, format: event.target.value })} placeholder="TSV / JSON / Fixed Width" className={inputClass} />
          </Labeled>
        </div>
        <Labeled label="Purpose">
          <textarea value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} className={`${inputClass} min-h-[60px]`} />
        </Labeled>
        <Labeled label="Connection info">
          <textarea value={form.connectionInfo} onChange={(event) => setForm({ ...form, connectionInfo: event.target.value })} className={`${inputClass} min-h-[60px]`} placeholder="URL, path, table name, etc." />
        </Labeled>
        {error ? <p className="text-xs text-[#9c2a2a]">{error}</p> : null}
      </DrawerBody>
      <DrawerFooter onClose={onClose} primaryLabel={isEdit ? "Save changes" : "Create endpoint"} onPrimary={save} busy={busy} />
    </DrawerShell>
  );
}

function ProfileDialog({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: string;
  onClose: () => void;
  onSaved: (profile: Profile) => void;
}) {
  const [form, setForm] = useState<{
    name: string;
    role: Profile["role"];
    type: Profile["type"];
    format: string;
    rootPath: string;
  }>({
    name: "",
    role: "source",
    type: "Flat File",
    format: "TSV",
    rootPath: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          role: form.role,
          type: form.type,
          format: form.format,
          rootPath: form.rootPath || null,
        }),
      });
      if (!response.ok) throw new Error(await extractError(response));
      const data = (await response.json()) as { profile: Profile };
      onSaved(data.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  const formatOptions = profileFormatOptionsByType[form.type] ?? [];
  const formatChoices = Array.from(new Set([...formatOptions, form.format].filter(Boolean)));

  return (
    <DrawerShell title="New profile" onClose={onClose}>
      <DrawerBody>
        <Labeled label="Name">
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} />
        </Labeled>
        <Labeled label="Role">
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Profile["role"] })} className={inputClass}>
            {profileRoles.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Type">
          <select
            value={form.type}
            onChange={(event) => {
              const nextType = event.target.value as Profile["type"];
              setForm((prev) => ({
                ...prev,
                type: nextType,
                format: profileFormatOptionsByType[nextType]?.includes(prev.format) ? prev.format : defaultFormatForType(nextType),
              }));
            }}
            className={inputClass}
          >
            {profileTypes.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Format">
          <select value={form.format} onChange={(event) => setForm({ ...form, format: event.target.value })} className={inputClass}>
            {formatChoices.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Root path (optional)">
          <input value={form.rootPath} onChange={(event) => setForm({ ...form, rootPath: event.target.value })} placeholder="e.g. record" className={inputClass} />
        </Labeled>
        {error ? <p className="text-xs text-[#9c2a2a]">{error}</p> : null}
      </DrawerBody>
      <DrawerFooter onClose={onClose} primaryLabel="Create profile" onPrimary={save} busy={busy} />
    </DrawerShell>
  );
}

function ProfileEditDialog({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile;
  onClose: () => void;
  onSaved: (profile: Profile) => void;
}) {
  const [form, setForm] = useState<{ name: string; type: Profile["type"]; format: string; rootPath: string }>({
    name: profile.name,
    type: profile.type,
    format: profile.format,
    rootPath: profile.rootPath ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatOptions = profileFormatOptionsByType[form.type] ?? [];
  const formatChoices = Array.from(new Set([...formatOptions, form.format].filter(Boolean)));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          format: form.format,
          rootPath: form.rootPath || null,
        }),
      });
      if (!response.ok) throw new Error(await extractError(response));
      const data = (await response.json()) as { profile: Profile };
      onSaved({ ...profile, ...data.profile, fields: data.profile.fields ?? profile.fields });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DrawerShell title={`Edit profile · ${profile.name}`} onClose={onClose}>
      <DrawerBody>
        <Labeled label="Name">
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} />
        </Labeled>
        <Labeled label="Type">
          <select
            value={form.type}
            onChange={(event) => {
              const nextType = event.target.value as Profile["type"];
              setForm((prev) => ({
                ...prev,
                type: nextType,
                format: profileFormatOptionsByType[nextType]?.includes(prev.format) ? prev.format : defaultFormatForType(nextType),
              }));
            }}
            className={inputClass}
          >
            {profileTypes.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Format">
          <select value={form.format} onChange={(event) => setForm({ ...form, format: event.target.value })} className={inputClass}>
            {formatChoices.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Root path (optional)">
          <input value={form.rootPath} onChange={(event) => setForm({ ...form, rootPath: event.target.value })} placeholder="e.g. record" className={inputClass} />
        </Labeled>
        {error ? <p className="text-xs text-[#9c2a2a]">{error}</p> : null}
      </DrawerBody>
      <DrawerFooter onClose={onClose} primaryLabel="Save changes" onPrimary={save} busy={busy} />
    </DrawerShell>
  );
}

function ProjectCreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: ProjectSummary) => void;
}) {
  const [form, setForm] = useState({
    processId: "",
    name: "",
    description: "",
    sourceSystem: "",
    destinationSystem: "",
    owner: "",
    schedule: "",
    folder: "",
    status: "Draft" as Project["status"],
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate() {
    const errors: Record<string, string> = {};
    if (!form.processId.trim()) errors.processId = "Process ID is required.";
    else if (form.processId.length > 64) errors.processId = "Process ID must be 64 characters or fewer.";
    if (!form.name.trim()) errors.name = "Project name is required.";
    else if (form.name.length > 200) errors.name = "Name must be 200 characters or fewer.";
    if (!form.sourceSystem.trim()) errors.sourceSystem = "Source system is required.";
    if (!form.destinationSystem.trim()) errors.destinationSystem = "Destination system is required.";
    if (!form.owner.trim()) errors.owner = "Owner is required.";
    if (form.schedule && form.schedule.length > 200) errors.schedule = "Schedule must be 200 characters or fewer.";
    if (form.description && form.description.length > 2000) errors.description = "Description must be 2000 characters or fewer.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function save() {
    setError(null);
    setFieldErrors({});
    if (!validate()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          folder: form.folder || null,
          schedule: form.schedule || null,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (response.status === 409) {
          throw new Error(`A project with processId "${form.processId}" already exists.`);
        }
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
            : `Failed to create project (${response.status}).`;
        throw new Error(errMsg);
      }
      const data = (await response.json()) as { project: ProjectSummary & { updatedAt: string } };
      onCreated({
        id: data.project.id,
        processId: data.project.processId,
        name: data.project.name,
        sourceSystem: data.project.sourceSystem,
        destinationSystem: data.project.destinationSystem,
        status: data.project.status,
        updatedAt: data.project.updatedAt ?? new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  }

  function setField(field: string, value: string) {
    setForm({ ...form, [field]: value });
    if (fieldErrors[field]) {
      setFieldErrors({ ...fieldErrors, [field]: "" });
    }
  }

  function fieldClass(field: string) {
    return clsx(inputClass, fieldErrors[field] && "border-[#9c2a2a] focus:border-[#9c2a2a]");
  }

  return (
    <DrawerShell title="New project" onClose={onClose}>
      <DrawerBody>
        <Labeled label="Process ID">
          <input value={form.processId} onChange={(event) => setField("processId", event.target.value)} placeholder="e.g. ABCD001" className={fieldClass("processId")} />
          {fieldErrors.processId ? <p className="mt-1 text-xs text-[#9c2a2a]">{fieldErrors.processId}</p> : null}
        </Labeled>
        <Labeled label="Name">
          <input value={form.name} onChange={(event) => setField("name", event.target.value)} className={fieldClass("name")} />
          {fieldErrors.name ? <p className="mt-1 text-xs text-[#9c2a2a]">{fieldErrors.name}</p> : null}
        </Labeled>
        <Labeled label="Description">
          <textarea value={form.description} onChange={(event) => setField("description", event.target.value)} className={`${fieldClass("description")} min-h-[60px]`} />
          {fieldErrors.description ? <p className="mt-1 text-xs text-[#9c2a2a]">{fieldErrors.description}</p> : null}
        </Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Source system">
            <input value={form.sourceSystem} onChange={(event) => setField("sourceSystem", event.target.value)} className={fieldClass("sourceSystem")} />
            {fieldErrors.sourceSystem ? <p className="mt-1 text-xs text-[#9c2a2a]">{fieldErrors.sourceSystem}</p> : null}
          </Labeled>
          <Labeled label="Destination system">
            <input value={form.destinationSystem} onChange={(event) => setField("destinationSystem", event.target.value)} className={fieldClass("destinationSystem")} />
            {fieldErrors.destinationSystem ? <p className="mt-1 text-xs text-[#9c2a2a]">{fieldErrors.destinationSystem}</p> : null}
          </Labeled>
        </div>
        <Labeled label="Owner">
          <input value={form.owner} onChange={(event) => setField("owner", event.target.value)} className={fieldClass("owner")} />
          {fieldErrors.owner ? <p className="mt-1 text-xs text-[#9c2a2a]">{fieldErrors.owner}</p> : null}
        </Labeled>
        <Labeled label="Schedule (optional)">
          <input value={form.schedule} onChange={(event) => setField("schedule", event.target.value)} className={fieldClass("schedule")} />
          {fieldErrors.schedule ? <p className="mt-1 text-xs text-[#9c2a2a]">{fieldErrors.schedule}</p> : null}
        </Labeled>
        <Labeled label="Folder (optional)">
          <input value={form.folder} onChange={(event) => setField("folder", event.target.value)} placeholder="e.g. Finance, B2B" className={fieldClass("folder")} />
          {fieldErrors.folder ? <p className="mt-1 text-xs text-[#9c2a2a]">{fieldErrors.folder}</p> : null}
        </Labeled>
        <Labeled label="Status">
          <select value={form.status} onChange={(event) => setField("status", event.target.value)} className={inputClass}>
            {projectStatuses.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </Labeled>
        <div className="border-t border-[#d9ded8] pt-4">
          <p className="mb-3 text-xs text-[#66706a]">Or import from an existing FMD workbook:</p>
          <ImportExcelButton />
        </div>
        {error ? <p className="mt-2 text-sm text-[#9c2a2a]">{error}</p> : null}
      </DrawerBody>
      <DrawerFooter onClose={onClose} primaryLabel="Create project" onPrimary={save} busy={busy} />
    </DrawerShell>
  );
}

function DrawerShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-30 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} aria-hidden />
      <aside className="w-full max-w-[460px] overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#d9ded8] px-5 py-4">
          <p className="text-sm font-semibold">{title}</p>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-[#66706a] hover:bg-[#eef1ee]"
            title="Close"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}

function DrawerBody({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 px-5 py-4">{children}</div>;
}

function DrawerFooter({
  onClose,
  primaryLabel,
  onPrimary,
  busy,
}: {
  onClose: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-[#d9ded8] px-5 py-3">
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-9 items-center rounded-md border border-[#cfd6cf] bg-white px-3 text-sm"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onPrimary}
        disabled={busy}
        className="inline-flex h-9 items-center rounded-md bg-[#1b5e4a] px-3 text-sm font-medium text-white hover:bg-[#164d3d] disabled:opacity-60"
      >
        {busy ? "Saving…" : primaryLabel}
      </button>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-[#66706a]">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputClass =
  "h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]";

export { ProjectCreateDialog, ProjectMetadataDialog, EndpointDialog, ProfileDialog, ProfileEditDialog, DrawerShell, DrawerBody, DrawerFooter, Labeled, inputClass, projectStatuses, endpointRoles, profileTypes, profileRoles, profileFormatOptionsByType, defaultFormatForType };

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
}) {
  return (
    <div className="panel">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase text-[#66706a]">{label}</p>
        <Icon size={17} className="text-[#298b68]" />
      </div>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function IconButton({
  children,
  title,
  href,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const className = clsx(
    "grid h-9 w-9 place-items-center rounded-md border border-[#cfd6cf] bg-white text-[#1b1f23]",
    disabled ? "cursor-not-allowed opacity-50" : "hover:border-[#298b68]",
  );
  if (href && !disabled) {
    return (
      <a className={className} href={href} title={title} aria-label={title}>
        {children}
      </a>
    );
  }
  return (
    <button className={className} onClick={onClick} title={title} aria-label={title} type="button" disabled={disabled}>
      {children}
    </button>
  );
}

function ReadinessList({ items }: { items: Array<[string, boolean]> }) {
  return (
    <div className="mt-4 space-y-2">
      {items.map(([label, checked]) => (
        <div key={label} className="flex items-center gap-2 rounded-md bg-white p-3 text-sm">
          {checked ? (
            <CheckCircle2 size={16} className="text-[#298b68]" />
          ) : (
            <AlertTriangle size={16} className="text-[#b77816]" />
          )}
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}


export { Dashboard, EmptyMappingState, MetricCard, ReadinessList, IconButton };