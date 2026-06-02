"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type NodeChange,
  type Edge,
  type EdgeChange,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  Database,
  GitBranch,
  GitCompareArrows,
  Layers3,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Table2,
  Trash2,
  Upload,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type {
  ProcessFlow,
  ProcessFlowNode,
  Project,
} from "@/lib/domain";
import { buildProcessXml } from "@/lib/boomi-xml";
import { useToast } from "@/components/toast";
import { PanelHeader, WorkspacePanel } from "@/components/atoms";
import { extractError } from "@/lib/api-utils";

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-[#66706a]">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

// Module-scoped Boomi shape definitions. Hoisted out of FlowDesigner so the
// reference is stable across renders / project switches — ReactFlow warns when
// `nodeTypes` identity changes between renders.
const BOOMI_SHAPE_DEFS: Record<string, { label: string; color: string; bg: string; icon: LucideIcon; category: string; supported: boolean }> = {
  "start":               { label: "Start (legacy)",   color: "#3fb58b", bg: "#e8f7f1", icon: PlayCircle,       category: "Start",     supported: true },
  "start-connector":     { label: "Connector",        color: "#3fb58b", bg: "#e8f7f1", icon: PlayCircle,       category: "Start",     supported: true },
  "start-trading":       { label: "Trading Partner",  color: "#3fb58b", bg: "#e8f7f1", icon: PlayCircle,       category: "Start",     supported: true },
  "start-passthrough":   { label: "Passthrough",      color: "#3fb58b", bg: "#e8f7f1", icon: PlayCircle,       category: "Start",     supported: true },
  "start-nodata":        { label: "No Data",          color: "#3fb58b", bg: "#e8f7f1", icon: PlayCircle,       category: "Start",     supported: true },

  "connector":           { label: "Connector",        color: "#3a82f7", bg: "#ebf3fe", icon: Database,         category: "Connector", supported: true },

  "map":                 { label: "Map",              color: "#8b5cf6", bg: "#f3effe", icon: GitCompareArrows, category: "Execute",   supported: true },
  "setproperties":       { label: "Set Properties",   color: "#06b6d4", bg: "#ecfeff", icon: Cpu,              category: "Execute",   supported: true },
  "message":             { label: "Message",          color: "#14b8a6", bg: "#e6fffa", icon: ClipboardCheck,   category: "Execute",   supported: true },
  "notify":              { label: "Notify",           color: "#ef4444", bg: "#fef2f2", icon: AlertTriangle,    category: "Execute",   supported: true },
  "programcmd":          { label: "Program Command",  color: "#6366f1", bg: "#eef0ff", icon: Cpu,              category: "Execute",   supported: true },
  "subprocess":          { label: "Process Call",     color: "#0ea5e9", bg: "#e0f2fe", icon: Workflow,         category: "Execute",   supported: true },
  "processroute":        { label: "Process Route",    color: "#0284c7", bg: "#dbeafe", icon: GitBranch,        category: "Execute",   supported: true },
  "dataprocess":         { label: "Data Process",     color: "#7c3aed", bg: "#ede9fe", icon: Layers3,          category: "Execute",   supported: true },
  "agent":               { label: "Agent",            color: "#d946ef", bg: "#fae8ff", icon: Cpu,              category: "Execute",   supported: true },

  "branch":              { label: "Branch",           color: "#f59e0b", bg: "#fef9eb", icon: GitBranch,        category: "Logic",     supported: true },
  "route":               { label: "Route",            color: "#f59e0b", bg: "#fef9eb", icon: GitBranch,        category: "Logic",     supported: true },
  "cleanse":             { label: "Cleanse",          color: "#f59e0b", bg: "#fef9eb", icon: ShieldCheck,      category: "Logic",     supported: false },
  "decision":            { label: "Decision",         color: "#f59e0b", bg: "#fef9eb", icon: GitBranch,        category: "Logic",     supported: true },
  "exception":           { label: "Exception",        color: "#ef4444", bg: "#fee2e2", icon: AlertTriangle,    category: "Logic",     supported: true },
  "stop":                { label: "Stop",             color: "#b77816", bg: "#fdf3ea", icon: CheckCircle2,     category: "Logic",     supported: true },
  "end":                 { label: "Stop",             color: "#b77816", bg: "#fdf3ea", icon: CheckCircle2,     category: "Logic",     supported: true },
  "return":              { label: "Return Documents", color: "#84cc16", bg: "#f7fee7", icon: Upload,            category: "Logic",     supported: true },
  "flowcontrol":         { label: "Flow Control",     color: "#f43f5e", bg: "#ffe4e6", icon: Workflow,         category: "Logic",     supported: true },

  "trycatch":            { label: "Try/Catch",        color: "#ec4899", bg: "#fdf2f8", icon: ShieldCheck,      category: "Advanced",  supported: true },
  "businessrules":       { label: "Business Rules",   color: "#a855f7", bg: "#f3e8ff", icon: Table2,           category: "Advanced",  supported: false },
  "findchanges":         { label: "Find Changes",     color: "#a855f7", bg: "#f3e8ff", icon: Search,           category: "Advanced",  supported: false },
  "addtocache":          { label: "Add to Cache",     color: "#a855f7", bg: "#f3e8ff", icon: Database,         category: "Advanced",  supported: true },
  "retrievefromcache":   { label: "Retrieve from Cache", color: "#a855f7", bg: "#f3e8ff", icon: Database, category: "Advanced", supported: true },
  "removefromcache":     { label: "Remove from Cache",   color: "#a855f7", bg: "#f3e8ff", icon: Database, category: "Advanced", supported: true },
};

function BoomiFlowNode({ data, selected }: { data: { type: string; label: string; description?: string }; selected?: boolean }) {
  const def = BOOMI_SHAPE_DEFS[data.type] ?? BOOMI_SHAPE_DEFS.start;
  const Icon = def.icon;
  return (
    <div style={{
      border: `2px solid ${selected ? "#298b68" : def.color}`,
      borderRadius: 10, background: def.bg, padding: "8px 12px", minWidth: 150,
      boxShadow: selected ? "0 0 0 3px rgba(41,139,104,.25)" : "0 2px 8px rgba(0,0,0,.08)",
      position: "relative",
    }}>
      <Handle type="target" position={Position.Top} id="top" style={{ background: def.color, width: 14, height: 14, border: "2px solid white", top: -7 }} />
      <Handle type="target" position={Position.Left} id="left" style={{ background: def.color, width: 14, height: 14, border: "2px solid white", left: -7 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon size={18} style={{ color: def.color }} />
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: def.color, letterSpacing: ".5px" }}>{def.label}</p>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#1b1f23", marginTop: 2 }}>{data.label}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="right" style={{ background: def.color, width: 14, height: 14, border: "2px solid white", right: -7 }} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ background: def.color, width: 14, height: 14, border: "2px solid white", bottom: -7 }} />
    </div>
  );
}

// Stable nodeTypes / edgeTypes references — see ReactFlow docs:
// https://reactflow.dev/learn/troubleshooting/remove-attribution#it-looks-like-you-have-created-a-new-nodetypes-or-edgetypes-object
const REACTFLOW_NODE_TYPES = { boomi: BoomiFlowNode };
const REACTFLOW_EDGE_TYPES = {};

export function FlowEmptyState({ projectId, project, setProject }: { projectId: string; project: Project; setProject: (project: Project) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createFlow() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/flows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New Process Flow",
          nodes: [
            { id: "start", type: "start-connector", label: "Connector Start", description: "Process entry point.", position: { x: 80, y: 120 } },
            { id: "end", type: "stop", label: "Stop", description: "Process exits here.", position: { x: 480, y: 120 } },
          ],
          edges: [{ id: "e1", source: "start", target: "end" }],
        }),
      });
      if (!response.ok) throw new Error(await extractError(response));
      const data = await response.json() as { flow: { id: string; name: string; nodes: ProcessFlow["nodes"]; edges: ProcessFlow["edges"] } };
      setProject({
        ...project,
        processFlows: [{ id: data.flow.id, name: data.flow.name, nodes: data.flow.nodes, edges: data.flow.edges }],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create flow");
    } finally { setBusy(false); }
  }

  return (
    <WorkspacePanel>
      <div className="flex flex-col items-center justify-center py-16">
        <Workflow size={40} className="text-[#cfd6cf]" />
        <p className="mt-4 text-sm font-semibold text-[#111714]">No process flow yet</p>
        <p className="mt-1 text-sm text-[#66706a]">Create a process flow to design your Boomi process visually.</p>
        <button
          className="mt-6 inline-flex h-9 items-center gap-2 rounded-md bg-[#1b5e4a] px-4 text-sm font-medium text-white hover:bg-[#164d3d] disabled:opacity-50"
          onClick={createFlow}
          disabled={busy}
          type="button"
        >
          <Plus size={14} />
          {busy ? "Creating…" : "Create flow"}
        </button>
        {error ? <p className="mt-3 text-sm text-[#9c2a2a]">{error}</p> : null}
      </div>
    </WorkspacePanel>
  );
}

export function FlowDesigner({ flow, project, projectId, setProject }: { flow: ProcessFlow | undefined; project: Project; projectId: string; setProject: (p: Project | ((prev: Project) => Project)) => void }) {
  const toast = useToast();
  // Reference the module-scoped definitions; renaming for the rest of the component.
  const boomiShapeDefs = BOOMI_SHAPE_DEFS;
  const boomiNodeTypes = REACTFLOW_NODE_TYPES;
  const boomiEdgeTypes = REACTFLOW_EDGE_TYPES;

  const [nodeState, setNodeState, onNodesChange] = useNodesState(
    (flow?.nodes ?? []).map((n) => ({
      id: n.id,
      type: "boomi",
      position: n.position,
      data: { type: n.type, label: n.label, description: n.description || "" },
    })),
  );
  const [edgeState, setEdgeState, onEdgesChange] = useEdgesState(
    (flow?.edges ?? []).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label || undefined,
      animated: e.label?.toLowerCase().includes("error") ?? false,
      style: { stroke: e.label?.toLowerCase().includes("error") ? "#b77816" : "#298b68", strokeWidth: 2 },
      labelStyle: { fill: "#66706a", fontSize: 10, fontWeight: 600 },
      labelBgStyle: { fill: "#fbfbfa", fillOpacity: 0.9 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
    })),
  );
  const [flowName, setFlowName] = useState(flow?.name ?? "");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [flowNotes, setFlowNotes] = useState(flow?.notes ?? "");
  const [dirty, setDirty] = useState(false);

  const [idCounter, setIdCounter] = useState((flow?.nodes?.length ?? 0) + 20);
  const activeFlowId = flow?.id ?? "";

  const selectedNode = nodeState.find((n) => n.id === selectedNodeId);
  const selectedEdge = edgeState.find((e) => e.id === selectedEdgeId);

  const onConnect = useCallback((conn: Connection) => {
    const eid = `e${idCounter}`;
    setIdCounter((c) => c + 1);
    setEdgeState((eds) => addEdge({
      ...conn, id: eid, label: "",
      style: { stroke: "#298b68", strokeWidth: 2 },
      labelStyle: { fill: "#66706a", fontSize: 10, fontWeight: 600 },
      labelBgStyle: { fill: "#fbfbfa", fillOpacity: 0.9 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
      data: { comment: "" },
    }, eds));
    setDirty(true);
  }, [setEdgeState, setDirty, idCounter]);

  function addNode(type: string, position?: { x: number; y: number }) {
    // Only one start shape allowed
    if (type.startsWith("start-")) {
      const hasStart = nodeState.some((n) => String(n.data?.type).startsWith("start-"));
      if (hasStart) { toast.addToast({ message: "A process can only have one start shape.", type: "error" }); return; }
    }
    const n = idCounter;
    setIdCounter((c) => c + 1);
    const label = boomiShapeDefs[type]?.label ?? type;
    const pos = position ?? { x: 130 + (n % 4) * 200, y: 100 + Math.floor(n / 4) * 130 };
    const newNodeId = `node-${n}`;
    const newNode: Node = { id: newNodeId, type: "boomi", position: pos, data: { type, label, description: "" } };
    setNodeState((nds) => [...nds, newNode]);

    // Auto-create mandatory downstream shapes and edges for multi-path shapes
    if (type === "decision") {
      const trueId = `node-${n + 1}`; const falseId = `node-${n + 2}`;
      const trueStop: Node = { id: trueId, type: "boomi", position: { x: pos.x + 250, y: pos.y - 60 }, data: { type: "stop", label: "True", description: "" } };
      const falseStop: Node = { id: falseId, type: "boomi", position: { x: pos.x + 250, y: pos.y + 80 }, data: { type: "stop", label: "False", description: "" } };
      const trueEdge: Edge = { id: `e${n}_true`, source: newNodeId, target: trueId, label: "True", style: { stroke: "#298b68", strokeWidth: 2 }, labelStyle: { fill: "#66706a", fontSize: 10, fontWeight: 600 }, labelBgStyle: { fill: "#fbfbfa", fillOpacity: 0.9 }, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 4, data: { comment: "True path" } };
      const falseEdge: Edge = { id: `e${n}_false`, source: newNodeId, target: falseId, label: "False", style: { stroke: "#9c2a2a", strokeWidth: 2 }, labelStyle: { fill: "#66706a", fontSize: 10, fontWeight: 600 }, labelBgStyle: { fill: "#fbfbfa", fillOpacity: 0.9 }, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 4, data: { comment: "False path" } };
      setNodeState((nds) => [...nds, trueStop, falseStop]);
      setEdgeState((eds) => [...eds, trueEdge, falseEdge]);
      setIdCounter((c) => c + 3);
    } else if (type === "branch") {
      const b1Id = `node-${n + 1}`; const b2Id = `node-${n + 2}`;
      const b1Stop: Node = { id: b1Id, type: "boomi", position: { x: pos.x + 250, y: pos.y - 60 }, data: { type: "stop", label: "Branch 1", description: "" } };
      const b2Stop: Node = { id: b2Id, type: "boomi", position: { x: pos.x + 250, y: pos.y + 80 }, data: { type: "stop", label: "Branch 2", description: "" } };
      const b1Edge: Edge = { id: `e${n}_b1`, source: newNodeId, target: b1Id, label: "1", style: { stroke: "#298b68", strokeWidth: 2 }, labelStyle: { fill: "#66706a", fontSize: 10, fontWeight: 600 }, labelBgStyle: { fill: "#fbfbfa", fillOpacity: 0.9 }, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 4, data: { comment: "Branch 1" } };
      const b2Edge: Edge = { id: `e${n}_b2`, source: newNodeId, target: b2Id, label: "2", style: { stroke: "#298b68", strokeWidth: 2 }, labelStyle: { fill: "#66706a", fontSize: 10, fontWeight: 600 }, labelBgStyle: { fill: "#fbfbfa", fillOpacity: 0.9 }, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 4, data: { comment: "Branch 2" } };
      setNodeState((nds) => [...nds, b1Stop, b2Stop]);
      setEdgeState((eds) => [...eds, b1Edge, b2Edge]);
      setIdCounter((c) => c + 3);
    } else if (type === "trycatch") {
      const tryId = `node-${n + 1}`; const catchId = `node-${n + 2}`;
      const tryStop: Node = { id: tryId, type: "boomi", position: { x: pos.x + 250, y: pos.y - 60 }, data: { type: "stop", label: "Try", description: "" } };
      const catchStop: Node = { id: catchId, type: "boomi", position: { x: pos.x + 250, y: pos.y + 80 }, data: { type: "stop", label: "Catch", description: "" } };
      const tryEdge: Edge = { id: `e${n}_try`, source: newNodeId, target: tryId, label: "Try", style: { stroke: "#298b68", strokeWidth: 2 }, labelStyle: { fill: "#66706a", fontSize: 10, fontWeight: 600 }, labelBgStyle: { fill: "#fbfbfa", fillOpacity: 0.9 }, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 4, data: { comment: "Try path" } };
      const catchEdge: Edge = { id: `e${n}_catch`, source: newNodeId, target: catchId, label: "Catch", style: { stroke: "#ef4444", strokeWidth: 2 }, labelStyle: { fill: "#66706a", fontSize: 10, fontWeight: 600 }, labelBgStyle: { fill: "#fbfbfa", fillOpacity: 0.9 }, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 4, data: { comment: "Catch error path" } };
      setNodeState((nds) => [...nds, tryStop, catchStop]);
      setEdgeState((eds) => [...eds, tryEdge, catchEdge]);
      setIdCounter((c) => c + 3);
    } else if (type === "route") {
      const defaultId = `node-${n + 1}`; const matchId = `node-${n + 2}`;
      const defaultStop: Node = { id: defaultId, type: "boomi", position: { x: pos.x + 250, y: pos.y - 60 }, data: { type: "stop", label: "Default", description: "" } };
      const matchStop: Node = { id: matchId, type: "boomi", position: { x: pos.x + 250, y: pos.y + 80 }, data: { type: "stop", label: "Match", description: "" } };
      const defaultEdge: Edge = { id: `e${n}_default`, source: newNodeId, target: defaultId, label: "Default", style: { stroke: "#66706a", strokeWidth: 2 }, labelStyle: { fill: "#66706a", fontSize: 10, fontWeight: 600 }, labelBgStyle: { fill: "#fbfbfa", fillOpacity: 0.9 }, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 4, data: { comment: "Default (no match) path" } };
      const matchEdge: Edge = { id: `e${n}_match`, source: newNodeId, target: matchId, label: "Match", style: { stroke: "#298b68", strokeWidth: 2 }, labelStyle: { fill: "#66706a", fontSize: 10, fontWeight: 600 }, labelBgStyle: { fill: "#fbfbfa", fillOpacity: 0.9 }, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 4, data: { comment: "First match path" } };
      setNodeState((nds) => [...nds, defaultStop, matchStop]);
      setEdgeState((eds) => [...eds, defaultEdge, matchEdge]);
      setIdCounter((c) => c + 3);
    } else {
      setIdCounter((c) => c + 1);
    }
    setDirty(true);
  }

  function onDragOver(event: React.DragEvent) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    const type = event.dataTransfer.getData("application/boomi-shape");
    if (!type) return;
    const rf = (event.currentTarget as HTMLElement).querySelector(".react-flow__viewport");
    if (!rf) return;
    const b = rf.getBoundingClientRect();
    addNode(type, { x: event.clientX - b.left, y: event.clientY - b.top });
  }

  function autoArrange() {
    const nodes = [...nodeState];
    const edges = edgeState;

    // Build adjacency: incoming count and outgoing list
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    for (const n of nodes) { incoming.set(n.id, 0); outgoing.set(n.id, []); }
    for (const e of edges) {
      incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
      const list = outgoing.get(e.source) ?? [];
      list.push(e.target);
      outgoing.set(e.source, list);
    }

    // Topological sort: start with nodes that have no incoming edges
    const levels = new Map<string, number>();
    const queue: string[] = [];
    for (const [id, count] of incoming) {
      if (count === 0) { queue.push(id); levels.set(id, 0); }
    }
    // If no root found (e.g. all nodes have incoming), pick the first
    if (queue.length === 0) { queue.push(nodes[0]?.id ?? ""); levels.set(nodes[0]?.id ?? "", 0); }

    let maxLevel = 0;
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      const currentLevel = levels.get(current) ?? 0;
      for (const next of outgoing.get(current) ?? []) {
        const newLevel = currentLevel + 1;
        if ((levels.get(next) ?? -1) < newLevel) {
          levels.set(next, newLevel);
          maxLevel = Math.max(maxLevel, newLevel);
        }
        const remaining = (incoming.get(next) ?? 1) - 1;
        incoming.set(next, remaining);
        if (remaining === 0) queue.push(next);
      }
    }
    // Any unvisited nodes get appended at the end
    for (const n of nodes) {
      if (!levels.has(n.id)) levels.set(n.id, ++maxLevel);
    }

    // Group by level
    const byLevel = new Map<number, Node[]>();
    for (const n of nodes) {
      const level = levels.get(n.id) ?? 0;
      const group = byLevel.get(level) ?? [];
      group.push(n);
      byLevel.set(level, group);
    }

    // Position nodes
    const xGap = 260;
    const yGap = 140;
    for (const [level, group] of byLevel) {
      const totalHeight = (group.length - 1) * yGap;
      const startY = 50 + (maxLevel > 0 ? (4 * yGap - Math.min(totalHeight, 4 * yGap)) / 2 : 0);
      group.forEach((node, i) => {
        node.position = { x: 50 + level * xGap, y: startY + i * yGap };
      });
    }

    setNodeState([...nodes]);
    setDirty(true);
  }

  function handleNodesChange(changes: NodeChange[]) { onNodesChange(changes); if (changes.some((c) => c.type === "position" || c.type === "remove")) setDirty(true); }
  function handleEdgesChange(changes: EdgeChange[]) { onEdgesChange(changes); if (changes.some((c) => c.type === "remove")) setDirty(true); }

  function updateSelectedNode(field: string, value: string) {
    if (!selectedNodeId) return;
    if (field === "type" && value.startsWith("start-")) {
      const otherStart = nodeState.some((n) => n.id !== selectedNodeId && String(n.data?.type).startsWith("start-"));
      if (otherStart) { toast.addToast({ message: "A process can only have one start shape.", type: "error" }); return; }
    }
    setNodeState((nds) => nds.map((n) => n.id === selectedNodeId ? { ...n, data: { ...n.data, [field]: value } } : n));
    setDirty(true);
  }

  function updateSelectedEdge(field: string, value: string) {
    if (!selectedEdgeId) return;
    setEdgeState((eds) => eds.map((e) => {
      if (e.id !== selectedEdgeId) return e;
      if (field === "label") return { ...e, label: value };
      return { ...e, data: { ...e.data, [field]: value } };
    }));
    setDirty(true);
  }

  function deleteSelectedEdge() {
    if (!selectedEdgeId) return;
    setEdgeState((eds) => eds.filter((e) => e.id !== selectedEdgeId));
    setSelectedEdgeId(null); setDirty(true);
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return;
    toast.confirm("Delete this shape and its connected edges?").then((ok) => {
      if (!ok) return;
      setNodeState((nds) => nds.filter((n) => n.id !== selectedNodeId));
      setEdgeState((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
      setSelectedNodeId(null); setDirty(true);
    });
  }

  async function saveFlow() {
    if (!activeFlowId) return;
    setSaving(true);
    try {
      const nodes = nodeState.map((n) => ({ id: n.id, type: n.data.type as ProcessFlow["nodes"][number]["type"], label: n.data.label, description: n.data.description || "", position: n.position }));
      const edges = edgeState.map((e) => ({ id: e.id, source: e.source, target: e.target, label: ((e.label as string)?.trim() || undefined) ?? undefined }));
      const r = await fetch(`/api/projects/${projectId}/flows/${activeFlowId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: flowName, nodes, edges, notes: flowNotes || null }) });
      if (!r.ok) throw new Error(await extractError(r));
      setProject((prev) => ({ ...prev, processFlows: prev.processFlows.map((f) => f.id === activeFlowId ? { ...f, name: flowName, nodes, edges, notes: flowNotes } : f) }));
      setDirty(false);
    } catch (err) { toast.addToast({ message: err instanceof Error ? err.message : "Failed to save flow", type: "error" }); } finally { setSaving(false); }
  }

  // Keyboard shortcuts. saveFlow / deleteSelectedNode / deleteSelectedEdge are
  // defined in this same component and close over the latest state via the deps
  // listed below — restating them in the dep array would just trigger an
  // unnecessary listener swap on every render.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); saveFlow(); }
      if ((e.key === "Backspace" || e.key === "Delete") && (selectedNodeId || selectedEdgeId)) {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
        if (selectedNodeId) deleteSelectedNode();
        else if (selectedEdgeId) deleteSelectedEdge();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, selectedEdgeId, nodeState, edgeState, flowName, flowNotes]);

  const processXml = useMemo(() => {
    const n = nodeState.map((nd) => ({
      id: nd.id,
      type: String(nd.data.type) as ProcessFlowNode["type"],
      label: String(nd.data.label),
      description: String(nd.data.description ?? ""),
      position: nd.position,
    }));
    const e = edgeState.map((ed) => ({ id: ed.id, source: ed.source, target: ed.target, label: ed.label as string | undefined }));
    return buildProcessXml(undefined, { id: activeFlowId, name: flowName, nodes: n, edges: e });
  }, [nodeState, edgeState, flowName, activeFlowId]);

  const shapeCategories = [
    {
      label: "Start",
      shapes: ["start-connector", "start-passthrough", "start-nodata", "start-trading"],
    },
    {
      label: "Execute",
      shapes: ["connector", "map", "setproperties", "message", "notify", "programcmd", "subprocess", "processroute", "dataprocess", "agent"],
    },
    {
      label: "Logic",
      shapes: ["branch", "decision", "route", "exception", "stop", "return", "flowcontrol"],
    },
    {
      label: "Advanced",
      shapes: ["trycatch", "addtocache", "retrievefromcache", "removefromcache"],
    },
  ];

  return !flow ? (
    <WorkspacePanel>
      <FlowEmptyState projectId={projectId} project={project} setProject={setProject as (p: Project | ((prev: Project) => Project)) => void} />
    </WorkspacePanel>
  ) : (
    <WorkspacePanel>
      <div className="grid min-h-[calc(100vh-112px)] grid-cols-1 gap-5 xl:grid-cols-[220px_1fr_300px]">
        <div className="panel overflow-auto p-0">
          <div className="border-b border-[#d9ded8] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#66706a]">Shapes</p>
          </div>
          <div className="p-2 space-y-3">
            {shapeCategories.map((cat) => (
              <div key={cat.label}>
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[#9fb7aa]">{cat.label}</p>
                {cat.shapes.map((type) => {
                  const def = boomiShapeDefs[type];
                  if (!def) return null;
                  const Icon = def.icon;
                  return (
                    <button
                      key={type}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("application/boomi-shape", type); e.dataTransfer.effectAllowed = "move"; }}
                      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:opacity-90 transition-opacity cursor-grab active:cursor-grabbing"
                      style={{ backgroundColor: def.bg, border: `1px solid ${def.color}40`, marginBottom: 2 }}
                      type="button"
                    >
                      <Icon size={14} style={{ color: def.color }} />
                      <span className="text-xs font-medium" style={{ color: def.color }}>{def.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="panel min-h-[620px] overflow-hidden p-0">
          <div className="flex h-12 items-center justify-between border-b border-[#d9ded8] px-4">
            <input
              value={flowName}
              onChange={(e) => { setFlowName(e.target.value); setDirty(true); }}
              className="h-8 w-48 rounded-md border border-[#cfd6cf] bg-white px-2 text-sm font-semibold outline-none focus:border-[#298b68]"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#66706a]">{nodeState.length} shapes</span>
              {dirty ? <span className="text-xs font-medium text-[#b77816]">Unsaved</span> : null}
              <button
                className="inline-flex h-8 items-center gap-1 rounded-md border border-[#cfd6cf] bg-white px-2 text-xs font-medium text-[#66706a] hover:bg-[#eef1ee]"
                onClick={autoArrange}
                type="button"
              >
                <Layers3 size={12} />
                Arrange
              </button>
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#1b5e4a] px-3 text-xs font-medium text-white hover:bg-[#164d3d] disabled:opacity-50"
                onClick={saveFlow}
                disabled={saving}
                type="button"
              >
                {saving ? <RefreshCw size={12} className="animate-spin" /> : null}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          <div className="h-[560px] xl:h-[calc(100%-48px)]" onDragOver={onDragOver} onDrop={onDrop}>
            <ReactFlow
              nodes={nodeState}
              edges={edgeState}
              nodeTypes={boomiNodeTypes}
              edgeTypes={boomiEdgeTypes}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_e, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }}
              onEdgeClick={(_e, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
              onPaneClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null); }}
              deleteKeyCode={["Backspace", "Delete"]}
              fitView
            >
              <MiniMap pannable zoomable nodeColor={(n) => boomiShapeDefs[String(n.data?.type)]?.color ?? "#cfd6cf"} />
              <Controls />
              <Background gap={20} size={1} color="#d9ded8" />
            </ReactFlow>
          </div>
        </div>

        <div className="panel overflow-auto">
          <PanelHeader icon={selectedNode ? GitBranch : selectedEdge ? GitCompareArrows : Layers3} title={selectedNode ? "Shape Properties" : selectedEdge ? "Link Properties" : "Properties"} action={selectedNode || selectedEdge ? "selected" : "none"} />
          {selectedNode ? (
            <div className="mt-4 space-y-3">
              <Labeled label="Label">
                <input value={String(selectedNode.data.label)} onChange={(e) => updateSelectedNode("label", e.target.value)} className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]" />
              </Labeled>
              <Labeled label="Type">
                <select value={String(selectedNode.data.type)} onChange={(e) => updateSelectedNode("type", e.target.value)} className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]">
                  {(String(selectedNode.data.type).startsWith("start-") || selectedNode.data.type === "start")
                    ? (
                      <optgroup label="Start variants">
                        <option value="start-connector">Connector</option>
                        <option value="start-passthrough">Data Passthrough</option>
                        <option value="start-nodata">No Data</option>
                        <option value="start-trading">Trading Partner</option>
                      </optgroup>
                    ) : null}
                  <optgroup label="Shapes">
                    {Object.entries(boomiShapeDefs)
                      .filter(([k, v]) => v.supported && k !== "end" && !k.startsWith("start"))
                      .map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </optgroup>
                </select>
              </Labeled>
              <Labeled label="Description">
                <textarea value={String(selectedNode.data.description ?? "")} onChange={(e) => updateSelectedNode("description", e.target.value)} className="min-h-[60px] w-full rounded-md border border-[#cfd6cf] bg-white px-3 py-2 text-sm outline-none focus:border-[#298b68]" />
              </Labeled>
              <button className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-[#d9ded8] bg-white px-3 text-sm font-medium text-[#9c2a2a] hover:bg-[#fdf3f3]" onClick={deleteSelectedNode} type="button" aria-label="Delete selected shape"><Trash2 size={14} />Delete shape</button>
            </div>
          ) : selectedEdge ? (
            <div className="mt-4 space-y-3">
              <Labeled label="Name">
                <input value={String(selectedEdge.label ?? "")} onChange={(e) => updateSelectedEdge("label", e.target.value)} placeholder="e.g. On Success" className="h-9 w-full rounded-md border border-[#cfd6cf] bg-white px-3 text-sm outline-none focus:border-[#298b68]" />
              </Labeled>
              <Labeled label="From">{typeof selectedEdge.source === "string" ? (nodeState.find((n) => n.id === selectedEdge.source)?.data?.label ?? selectedEdge.source) : selectedEdge.source}</Labeled>
              <Labeled label="To">{typeof selectedEdge.target === "string" ? (nodeState.find((n) => n.id === selectedEdge.target)?.data?.label ?? selectedEdge.target) : selectedEdge.target}</Labeled>
              <Labeled label="Comment">
                <textarea value={String((selectedEdge.data as Record<string, string> | undefined)?.comment ?? "")} onChange={(e) => updateSelectedEdge("comment", e.target.value)} className="min-h-[60px] w-full rounded-md border border-[#cfd6cf] bg-white px-3 py-2 text-sm outline-none focus:border-[#298b68]" />
              </Labeled>
              <button className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-[#d9ded8] bg-white px-3 text-sm font-medium text-[#9c2a2a] hover:bg-[#fdf3f3]" onClick={deleteSelectedEdge} type="button" aria-label="Delete selected link"><Trash2 size={14} />Delete link</button>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[#66706a]">Click a shape or link to edit.<br />Drag from palette to add.<br />Press Delete to remove.</p>
          )}

          <div className="mt-6 border-t border-[#d9ded8] pt-4">
            <Labeled label="Notes (optional)">
              <textarea value={flowNotes} onChange={(e) => { setFlowNotes(e.target.value); setDirty(true); }} className="min-h-[80px] w-full rounded-md border border-[#cfd6cf] bg-white px-3 py-2 text-sm outline-none focus:border-[#298b68]" />
            </Labeled>
            <div className="mt-4 rounded-md border border-[#d9ded8] bg-[#fbfbfa] p-3 max-h-56 overflow-auto">
              <p className="text-xs font-semibold text-[#66706a]">XML Preview</p>
              <pre className="mt-2 text-[10px] leading-tight text-[#66706a] whitespace-pre-wrap">{processXml.slice(0, 1500)}{processXml.length > 1500 ? "…" : ""}</pre>
            </div>
          </div>
        </div>
      </div>
    </WorkspacePanel>
  );
}
