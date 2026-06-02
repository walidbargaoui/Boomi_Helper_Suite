"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Plus,
  ShieldCheck,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import clsx from "clsx";
import type { Project } from "@/lib/domain";
import type { ProjectSummary } from "@/lib/db";

type FolderTreeNode = {
  path: string;
  name: string;
  children: FolderTreeNode[];
  projects: ProjectSummary[];
};

export function WorkspaceSidebar({
  projects,
  activeProject,
  activePage,
  onSwitchProject,
  onShowProjectDialog,
}: {
  projects: ProjectSummary[];
  activeProject: Project | null;
  activePage?: "workspace" | "connections";
  onSwitchProject: (id: string) => void;
  onShowProjectDialog: (folderPath?: string) => void;
}) {
  const safeProjects = projects;
  const router = useRouter();
  const [projectSearch, setProjectSearch] = useState("");
  const [userFolders, setUserFolders] = useState<Set<string>>(new Set());
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderParent, setNewFolderParent] = useState("");
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });

  const filtered: ProjectSummary[] = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return safeProjects;
    return safeProjects.filter((p) => p.processId.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  }, [safeProjects, projectSearch]);

  const folderTree = useMemo(() => buildFolderTree(filtered, userFolders), [filtered, userFolders]);

  // Auto-expand active project's folder path
  const activeFolder = activeProject?.folder ?? "";
  const projectExpandedPaths = useMemo(() => {
    if (!activeFolder) return new Set<string>();
    const s = new Set<string>();
    const parts = activeFolder.split("/");
    let path = "";
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      s.add(path);
    }
    return s;
  }, [activeFolder]);

  // Merge project-expanded paths with user-toggled paths
  const effectiveExpandedPaths = useMemo(() => {
    const merged = new Set(expandedPaths);
    for (const p of projectExpandedPaths) merged.add(p);
    return merged;
  }, [expandedPaths, projectExpandedPaths]);

  function toggleFolder(path: string) {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  function createFolder(parentPath: string) {
    const name = newFolderName.trim();
    if (!name) return;
    const fullPath = parentPath ? `${parentPath}/${name}` : name;
    setUserFolders((prev) => new Set(prev).add(fullPath));
    setExpandedPaths((prev) => new Set(prev).add(fullPath));
    if (parentPath) setExpandedPaths((prev) => new Set(prev).add(parentPath));
    setShowNewFolder(false);
    setNewFolderName("");
  }

  function deleteFolder(path: string) {
    // Remove from user-created folders (empty folders only)
    setUserFolders((prev) => {
      const next = new Set(prev);
      for (const p of prev) { if (p === path || p.startsWith(`${path}/`)) next.delete(p); }
      return next;
    });
    setExpandedPaths((prev) => {
      const next = new Set(prev); next.delete(path);
      for (const p of prev) { if (p.startsWith(`${path}/`)) next.delete(p); }
      return next;
    });
  }

  function folderEmpty(path: string): boolean {
    const node = folderTree.get(path);
    return !node || countAll(node) === 0;
  }

  function handleSwitchProject(id: string) {
    onSwitchProject(id);
    router.push(`/?project=${id}`);
  }

  return (
    <aside className="sticky top-0 h-screen flex flex-col border-b border-[#d9ded8] bg-[#111714] text-white lg:border-b-0 lg:border-r w-[260px] shrink-0">
      <div className="shrink-0 border-b border-white/10 px-5 py-5">
        <button onClick={() => { router.push("/"); }} className="flex cursor-pointer items-center gap-3 text-left hover:opacity-80 transition-opacity w-full" type="button">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-[#3fb58b] text-[#07110d]"><Workflow size={20} /></div>
          <div><p className="text-sm font-semibold">Boomi Helper Suite</p><p className="text-xs text-white/55">Local architect workspace</p></div>
        </button>
      </div>

      <div className="shrink-0 border-b border-white/10 px-3 py-2">
        <button onClick={() => router.push("/admin/connections")} className={clsx("flex h-9 w-full items-center gap-3 rounded-md px-3 text-xs transition hover:bg-white/10 hover:text-white", activePage === "connections" ? "text-white bg-white/[0.08]" : "text-white/65")}>
          <ShieldCheck size={15} /> Connections Admin
        </button>
      </div>

      <div className="flex-1 flex flex-col min-h-0 px-5 pt-4">
        <div className="shrink-0 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/45">Projects</p>
          <div className="flex items-center gap-1">
            <button onClick={() => { setNewFolderParent(""); setNewFolderName(""); setShowNewFolder(true); }} title="Create folder" className="grid h-7 w-7 cursor-pointer place-items-center rounded-md border border-white/15 bg-white/[0.06] text-white hover:border-white/30" type="button"><Folder size={13} /></button>
            <button onClick={() => onShowProjectDialog()} title="Create project" className="grid h-7 w-7 cursor-pointer place-items-center rounded-md border border-white/15 bg-white/[0.06] text-white hover:border-white/30" type="button"><Plus size={13} /></button>
          </div>
        </div>
        {showNewFolder ? (
          <div className="mt-2 flex gap-1">
            <input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") createFolder(newFolderParent); if (e.key === "Escape") setShowNewFolder(false); }} placeholder={newFolderParent ? `Folder in ${newFolderParent}` : "Folder name"} autoFocus className="h-7 flex-1 rounded-md border border-white/15 bg-white/[0.06] px-2 text-xs text-white placeholder-white/30 outline-none focus:border-white/30" />
            <button onClick={() => createFolder(newFolderParent)} className="grid h-7 w-7 place-items-center rounded-md bg-[#3fb58b] text-white"><Plus size={12} /></button>
            <button onClick={() => setShowNewFolder(false)} className="grid h-7 w-7 place-items-center rounded-md border border-white/15 text-white/45"><X size={12} /></button>
          </div>
        ) : null}
        {safeProjects.length > 0 ? (
          <div className="mt-2">
            <input value={projectSearch} onChange={(e) => setProjectSearch(e.target.value)} placeholder="Search projects…" className="h-7 w-full rounded-md border border-white/15 bg-white/[0.06] px-2 text-xs text-white placeholder-white/30 outline-none focus:border-white/30" />
          </div>
        ) : null}
        <div className="flex-1 min-h-0 mb-3 mt-2 overflow-y-auto pr-1">
          <FolderTreeRenderer
            tree={folderTree}
            expandedPaths={effectiveExpandedPaths}
            toggleFolder={toggleFolder}
            activeProjectId={activeProject?.id ?? ""}
            switchProject={handleSwitchProject}
            menuPath={menuPath}
            setMenuPath={setMenuPath}
            setMenuPosition={setMenuPosition}
          />
          {filtered.length === 0 ? (
            <p className="rounded-md border border-dashed border-white/15 p-3 text-xs text-white/55">
              {safeProjects.length === 0 ? "No projects yet. Create one to get started." : "No matching projects."}
            </p>
          ) : null}
        </div>
      </div>

      {/* Context menu rendered at root level to avoid overflow clipping */}
      {menuPath ? (
        <>
          <div className="fixed inset-0 z-[998]" onClick={() => setMenuPath(null)} />
          <div className="fixed z-[999] w-40 rounded-md border border-white/10 bg-[#1e2220] shadow-xl py-1" style={{ left: menuPosition.x, top: menuPosition.y }}>
            <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-white/80 hover:bg-white/[0.08] hover:text-white" onClick={() => { sessionStorage.setItem("newProjectFolder", menuPath); setMenuPath(null); onShowProjectDialog(menuPath); }} type="button"><Plus size={11} /> New Project</button>
            <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-white/80 hover:bg-white/[0.08] hover:text-white" onClick={() => { setNewFolderParent(menuPath); setNewFolderName(""); setShowNewFolder(true); setMenuPath(null); }} type="button"><Folder size={11} /> New Folder</button>
            {folderEmpty(menuPath) ? (
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-white/80 hover:bg-white/[0.08] hover:text-[#f59e9e]" onClick={() => { deleteFolder(menuPath); setMenuPath(null); }} type="button"><Trash2 size={11} /> Delete</button>
            ) : null}
          </div>
        </>
      ) : null}
    </aside>
  );
}

// ─── Tree renderer ────────────────────────────────────────────────────────

function FolderTreeRenderer(props: {
  tree: Map<string, FolderTreeNode>;
  expandedPaths: Set<string>;
  toggleFolder: (path: string) => void;
  activeProjectId: string;
  switchProject: (id: string) => void;
  menuPath: string | null;
  setMenuPath: (path: string | null) => void;
  setMenuPosition: (pos: { x: number; y: number }) => void;
}) {
  const { tree, expandedPaths, toggleFolder, activeProjectId, switchProject, menuPath, setMenuPath, setMenuPosition } = props;
  const rootNodes = [...tree.values()].filter((n) => !n.path.includes("/"));

  function renderNode(node: FolderTreeNode, depth: number): React.ReactNode {
    const isExpanded = expandedPaths.has(node.path);
    const hasChildren = node.children.length > 0;
    const projectCount = countAll(node);

    return (
      <div key={node.path}>
        <div className={clsx("flex items-center gap-1 py-0.5 cursor-pointer group rounded transition-colors hover:bg-white/[0.04]", depth === 0 ? "text-[11px] font-semibold tracking-wide text-white/60 hover:text-white/85" : "text-[12px] text-white/70 hover:text-white")} style={{ paddingLeft: `${4 + depth * 12}px` }}>
          <button className="shrink-0 grid place-items-center w-4 h-4" onClick={() => toggleFolder(node.path)} type="button">
            {hasChildren ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="w-2" />}
          </button>
          {depth === 0 ? <Folder size={12} className="shrink-0 text-white/40" /> : null}
          <span className="truncate flex-1 text-left" onClick={() => toggleFolder(node.path)}>{node.name}</span>
          <span className="text-[11px] text-white/35 shrink-0">{projectCount}</span>
          <button className="shrink-0 opacity-0 group-hover:opacity-100 grid place-items-center w-5 h-5 rounded hover:bg-white/[0.08]" onClick={(e) => { e.stopPropagation(); const rect = (e.target as HTMLElement).closest("button")!.getBoundingClientRect(); setMenuPosition({ x: rect.right + 4, y: rect.top }); setMenuPath(menuPath === node.path ? null : node.path); }} type="button"><Plus size={11} /></button>
        </div>
        {isExpanded && node.projects.map((p) => (
          <button key={p.id} type="button" onClick={() => switchProject(p.id)} className={clsx("flex w-full cursor-pointer items-center gap-2 rounded py-0.5 text-left text-[12px] transition hover:bg-white/[0.06]", activeProjectId === p.id ? "text-white bg-white/[0.08] font-medium" : "text-white/65 hover:text-white")} style={{ paddingLeft: `${24 + (depth + 1) * 12}px` }}>
            <span className="truncate">{p.name}</span>
          </button>
        ))}
        {isExpanded && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  return <div className="space-y-0.5">{rootNodes.map((n) => renderNode(n, 0))}</div>;
}

function countAll(node: FolderTreeNode): number {
  let c = node.projects.length;
  for (const child of node.children) c += countAll(child);
  return c;
}

// ─── Tree builder ─────────────────────────────────────────────────────────

function buildFolderTree(projects: ProjectSummary[], userFolders: Set<string>): Map<string, FolderTreeNode> {
  const roots = new Map<string, FolderTreeNode>();
  const safe = projects ?? [];
  const ensure = (path: string) => {
    if (roots.has(path)) return;
    const parts = path.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!roots.has(current)) roots.set(current, { path: current, name: part, children: [], projects: [] });
    }
  };

  const allPaths = new Set(safe.map((p) => p.folder?.trim() || "Uncategorized"));
  for (const p of userFolders) allPaths.add(p);
  for (const path of allPaths) { const parts = path.split("/"); for (let i = 1; i <= parts.length; i++) ensure(parts.slice(0, i).join("/")); }

  for (const p of safe) {
    const node = roots.get(p.folder?.trim() || "Uncategorized");
    if (node) node.projects.push(p);
  }

  for (const [path, node] of roots) {
    const parentPath = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : null;
    if (parentPath && roots.has(parentPath)) roots.get(parentPath)!.children.push(node);
  }

  return roots;
}
