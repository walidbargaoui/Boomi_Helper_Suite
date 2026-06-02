/**
 * Boomi Build Pipeline
 *
 * Orchestrates the full component build pipeline:
 *   Workspace → Preflight → Profile push → Pull keys →
 *   Connection push → Operation push → Map push → Process push
 *
 * Uses Companion scripts for component push/pull and marks each
 * component create/update/reuse based on preflight search results.
 */

import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import os from "os";
import type {
  BoomiBuildSpec,
  BoomiConnection,
} from "@/lib/domain";
import {
  generateProfileXml,
  generateConnectionXml,
  generateOperationXml,
  generateMapXml,
  generateProcessXml,
  profileComponentType,
  type ProfileKeyMap,
  type ProcessComponentRefs,
} from "@/lib/boomi-xml-engine";
import { runCompanionScript } from "@/lib/boomi-bridge-runner";

// ─── Types ─────────────────────────────────────────────────────────────────

export type PipelinePhase =
  | "preflight"
  | "profile"
  | "connection"
  | "operation"
  | "map"
  | "process";

export type PipelineProgressStatus = "running" | "ok" | "failed" | "skipped" | "reused";

export type PipelineProgressEvent = {
  phase: PipelinePhase;
  step: number;
  totalSteps: number;
  stepName: string;
  status: PipelineProgressStatus;
  componentType?: string;
  componentName?: string;
  componentId?: string;
  error?: string;
  durationMs?: number;
};

export type PipelineCompleteEvent = {
  totalSteps: number;
  ok: number;
  failed: number;
  skipped: number;
  reused: number;
  componentIds: Record<string, string>;
};

export type PipelineErrorEvent = {
  message: string;
  phase?: PipelinePhase;
  stepName?: string;
};

export type PushedComponent = {
  phase: PipelinePhase;
  localId: string;
  name: string;
  componentType: string;
  action: "create" | "update" | "reuse";
  componentId?: string;
};

export type BuildPlanItem = {
  localId: string;
  name: string;
  componentType: string;
  action: "create" | "update" | "reuse";
  phase: PipelinePhase;
  existingComponentId?: string;
  dependsOn: string[];
  generate: (ctx: PipelineContext) => string;
};

export interface PipelineContext {
  spec: BoomiBuildSpec;
  connection: BoomiConnection;
  folderId: string;
  folderName: string;
  workspaceDir: string;
  componentIds: Map<string, string>;
  profileKeys: Map<string, ProfileKeyMap>;
  phaseResults: Map<string, PushedComponent>;
}

// ─── Event emitter ─────────────────────────────────────────────────────────

export class BuildPipelineEmitter extends EventEmitter {
  public buffer: Array<{ event: string; data: unknown }> = [];
  public status: "building" | "complete" | "failed" = "building";

  emit(event: string, ...args: unknown[]): boolean {
    this.buffer.push({ event, data: args[0] });
    return super.emit(event, ...args);
  }

  replay(listener: (event: string, data: unknown) => void): void {
    for (const entry of this.buffer) {
      try {
        listener(entry.event, entry.data);
      } catch {
        // listener fault isolated
      }
    }
  }

  hasFinalEvent(): boolean {
    return this.buffer.some(
      (e) => e.event === "complete" || e.event === "error",
    );
  }
}

export const BUILD_PIPELINES = new Map<string, BuildPipelineEmitter>();

// ─── Script helpers ────────────────────────────────────────────────────────

const SCRIPTS_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "boomi-companion-scripts");

export function areScriptsVendored(): boolean {
  if (!fs.existsSync(SCRIPTS_DIR)) return false;
  const required = [
    "boomi-env-check.sh",
    "boomi-folder-create.sh",
    "boomi-component-search.sh",
    "boomi-component-create.sh",
    "boomi-component-push.sh",
    "boomi-component-pull.sh",
  ];
  for (const name of required) {
    const p = path.join(SCRIPTS_DIR, name);
    if (!fs.existsSync(p)) return false;
    try {
      fs.accessSync(p, fs.constants.X_OK);
    } catch {
      return false;
    }
  }
  return true;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-.]/g, "_");
}

// ─── Workspace builder ────────────────────────────────────────────────────

export type WorkspaceEntry = {
  relativePath: string;
  componentType?: string;
  componentName?: string;
  localId?: string;
};

export function buildBuildWorkspace(
  spec: BoomiBuildSpec,
  context: PipelineContext,
): WorkspaceEntry[] {
  const activeDev = path.join(context.workspaceDir, "active-development");
  const entries: WorkspaceEntry[] = [];

  const subdirs = ["profile.json", "profile.flatfile", "profile.xml", "profile.db",
    "connector-settings", "connector-action", "transform.map", "process"];
  for (const d of subdirs) {
    fs.mkdirSync(path.join(activeDev, d), { recursive: true });
  }

  // Profiles
  for (const profile of spec.profiles) {
    const { xml, componentType } = generateProfileXml(profile, context.folderId);
    const dir = componentType;
    const fileName = `${sanitizeFileName(profile.name)}.xml`;
    const filePath = path.join(activeDev, dir, fileName);
    fs.writeFileSync(filePath, xml, "utf8");

    entries.push({
      relativePath: path.join("active-development", dir, fileName),
      componentType,
      componentName: profile.name,
      localId: `profile:${profile.localProfileId}`,
    });
  }

  // Connections
  for (const endpoint of spec.endpoints) {
    const xml = generateConnectionXml(endpoint, context.folderId, context.connection);
    const fileName = `${sanitizeFileName(endpoint.name)}_connection.xml`;
    const filePath = path.join(activeDev, "connector-settings", fileName);
    fs.writeFileSync(filePath, xml, "utf8");

    entries.push({
      relativePath: path.join("active-development", "connector-settings", fileName),
      componentType: "connector-settings",
      componentName: endpoint.name,
      localId: `connection:${endpoint.localEndpointId}`,
    });
  }

  // Operations
  for (const endpoint of spec.endpoints) {
    // Connection ID will be filled during pipeline
    const xml = generateOperationXml(endpoint, "PENDING_CONNECTION_ID", context.folderId);
    const fileName = `${sanitizeFileName(endpoint.name)}_operation.xml`;
    const filePath = path.join(activeDev, "connector-action", fileName);
    fs.writeFileSync(filePath, xml, "utf8");

    entries.push({
      relativePath: path.join("active-development", "connector-action", fileName),
      componentType: "connector-action",
      componentName: `${endpoint.name} Operation`,
      localId: `operation:${endpoint.localEndpointId}`,
    });
  }

  return entries;
}

// ─── Build plan ───────────────────────────────────────────────────────────

export function generateBuildPlan(
  spec: BoomiBuildSpec,
): BuildPlanItem[] {
  const items: BuildPlanItem[] = [];

  // Profiles
  for (const profile of spec.profiles) {
    items.push({
      localId: `profile:${profile.localProfileId}`,
      name: profile.name,
      componentType: profileComponentType(profile),
      action: "create",
      phase: "profile",
      dependsOn: [],
      generate: (ctx) => {
        const { xml } = generateProfileXml(profile, ctx.folderId);
        return xml;
      },
    });
  }

  // Connections
  for (const endpoint of spec.endpoints) {
    items.push({
      localId: `connection:${endpoint.localEndpointId}`,
      name: endpoint.name,
      componentType: "connector-settings",
      action: "create",
      phase: "connection",
      dependsOn: [],
      generate: (ctx) => generateConnectionXml(endpoint, ctx.folderId, ctx.connection),
    });
  }

  // Operations (depend on their connection)
  for (const endpoint of spec.endpoints) {
    const connLocalId = `connection:${endpoint.localEndpointId}`;
    items.push({
      localId: `operation:${endpoint.localEndpointId}`,
      name: `${endpoint.name} Operation`,
      componentType: "connector-action",
      action: "create",
      phase: "operation",
      dependsOn: [connLocalId],
      generate: (ctx) => {
        const connId = ctx.componentIds.get(connLocalId) ?? "PENDING";
        return generateOperationXml(endpoint, connId, ctx.folderId);
      },
    });
  }

  // Maps (depend on source/dest profiles)
  for (const mappingSet of spec.mappingSets) {
    const sourceProfile = spec.profiles.find(
      (p) => p.name === mappingSet.sourceProfileRef,
    );
    const destProfile = spec.profiles.find(
      (p) => p.name === mappingSet.destinationProfileRef,
    );
    const sourceLocalId = sourceProfile ? `profile:${sourceProfile.localProfileId}` : null;
    const destLocalId = destProfile ? `profile:${destProfile.localProfileId}` : null;

    items.push({
      localId: `map:${mappingSet.localMappingSetId}`,
      name: mappingSet.name,
      componentType: "transform.map",
      action: "create",
      phase: "map",
      dependsOn: [sourceLocalId, destLocalId].filter(Boolean) as string[],
      generate: (ctx) => {
        const srcId = sourceLocalId ? (ctx.componentIds.get(sourceLocalId) ?? "PENDING") : "PENDING";
        const dstId = destLocalId ? (ctx.componentIds.get(destLocalId) ?? "PENDING") : "PENDING";
        const srcKeys = sourceLocalId ? (ctx.profileKeys.get(sourceLocalId) ?? []) : [];
        const dstKeys = destLocalId ? (ctx.profileKeys.get(destLocalId) ?? []) : [];
        return generateMapXml(mappingSet, srcId, dstId, srcKeys, dstKeys, ctx.folderId);
      },
    });
  }

  // Processes (depend on connection, operation, map)
  for (const flow of spec.processFlows) {
    const deps: string[] = [];
    if (spec.endpoints.length > 0) {
      deps.push(`connection:${spec.endpoints[0].localEndpointId}`);
      deps.push(`operation:${spec.endpoints[0].localEndpointId}`);
    }
    if (spec.mappingSets.length > 0) {
      deps.push(`map:${spec.mappingSets[0].localMappingSetId}`);
    }

    items.push({
      localId: `process:${flow.localFlowId}`,
      name: flow.name,
      componentType: "process",
      action: "create",
      phase: "process",
      dependsOn: deps,
      generate: (ctx) => {
        const refs: ProcessComponentRefs = {
          connectionId: spec.endpoints.length > 0
            ? (ctx.componentIds.get(`connection:${spec.endpoints[0].localEndpointId}`) ?? "")
            : "",
          operationId: spec.endpoints.length > 0
            ? (ctx.componentIds.get(`operation:${spec.endpoints[0].localEndpointId}`) ?? "")
            : "",
          connectorType: spec.endpoints[0]?.connectorType,
          mapId: spec.mappingSets.length > 0
            ? (ctx.componentIds.get(`map:${spec.mappingSets[0].localMappingSetId}`) ?? "")
            : undefined,
        };
        return generateProcessXml(flow, refs, ctx.folderId);
      },
    });
  }

  return items;
}

function sortPlanByPhase(plan: BuildPlanItem[]): BuildPlanItem[] {
  const order: PipelinePhase[] = ["profile", "connection", "operation", "map", "process"];
  return [...plan].sort(
    (a, b) => order.indexOf(a.phase) - order.indexOf(b.phase),
  );
}

// ─── Pipeline runner ──────────────────────────────────────────────────────

export interface RunPipelineOptions {
  packageId: string;
  spec: BoomiBuildSpec;
  connection: BoomiConnection;
  keepWorkspace: boolean;
}

export async function runBuildPipeline(
  options: RunPipelineOptions,
): Promise<PushedComponent[]> {
  const { packageId, spec, connection, keepWorkspace } = options;

  const emitter = new BuildPipelineEmitter();
  emitter.setMaxListeners(50);
  BUILD_PIPELINES.set(packageId, emitter);

  const workspaceDir = path.join(os.tmpdir(), `boomi-build-${packageId}`);
  if (fs.existsSync(workspaceDir)) {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
  fs.mkdirSync(workspaceDir, { recursive: true });

  const ctx: PipelineContext = {
    spec,
    connection,
    folderId: "",
    folderName: spec.project.folder ?? "BoomiHelper",
    workspaceDir,
    componentIds: new Map(),
    profileKeys: new Map(),
    phaseResults: new Map(),
  };

  const allResults: PushedComponent[] = [];

  try {
    // ── Create .env first (needed by scripts) ────────────────
    const activeDev = path.join(ctx.workspaceDir, "active-development");
    fs.mkdirSync(activeDev, { recursive: true });
    const envLines = [
      `BOOMI_API_URL=${ctx.connection.baseUrl}`,
      `BOOMI_USERNAME=${ctx.connection.apiUsername.replace(/^BOOMI_TOKEN\./i, "")}`,
      `BOOMI_API_TOKEN=${ctx.connection.apiPassword}`,
      `BOOMI_ACCOUNT_ID=${ctx.connection.accountId}`,
      `BOOMI_ENVIRONMENT_ID=${ctx.connection.environmentName}`,
      `BOOMI_TARGET_FOLDER=${ctx.folderName}`,
      `BOOMI_VERIFY_SSL=true`,
    ];
    fs.writeFileSync(path.join(ctx.workspaceDir, ".env"), envLines.join("\n"), "utf8");

    // ── Create folder first (need folderId for XML) ──────────
    const folderName = `${ctx.folderName}-${Date.now().toString(36)}`;
    const folderResult = await runCompanionScript(
      "boomi-folder-create.sh",
      [folderName],
      ctx.workspaceDir,
      {},
    );
    if (folderResult.ok) {
      const idMatch = folderResult.stdout.match(/ID:\s*(\S+)/i);
      if (idMatch) {
        ctx.folderId = idMatch[1];
      }
    }
    ctx.folderName = folderName;

    // ── Write workspace files with resolved folderId ─────────
    buildBuildWorkspace(spec, ctx);

    // ── Preflight (env-check, component-search) ──────────────
    await runPreflight(ctx, packageId, emitter);

    const plan = generateBuildPlan(spec);
    const sortedPlan = sortPlanByPhase(plan);
    const totalSteps = sortedPlan.length;

    emitter.emit("connected", { packageId, status: "building", totalSteps });

    // ── Write initial workspace files ─────────────────────────
    buildBuildWorkspace(spec, ctx);

    // ── Execute phases ────────────────────────────────────────
    for (let stepIndex = 0; stepIndex < sortedPlan.length; stepIndex++) {
      const item = sortedPlan[stepIndex];
      const stepNum = stepIndex + 1;

      emitter.emit("progress", {
        phase: item.phase,
        step: stepNum,
        totalSteps,
        stepName: `Generate ${item.componentType}: ${item.name}`,
        status: "running",
        componentType: item.componentType,
        componentName: item.name,
      });

      if (item.action === "reuse") {
        const existingId = item.existingComponentId;
        if (existingId) ctx.componentIds.set(item.localId, existingId);
        const result: PushedComponent = {
          phase: item.phase,
          localId: item.localId,
          name: item.name,
          componentType: item.componentType,
          action: "reuse",
          componentId: existingId,
        };
        ctx.phaseResults.set(item.localId, result);
        allResults.push(result);

        emitter.emit("progress", {
          phase: item.phase,
          step: stepNum,
          totalSteps,
          stepName: `Reuse ${item.componentType}: ${item.name}`,
          status: "reused",
          componentType: item.componentType,
          componentName: item.name,
          componentId: existingId,
        });
        continue;
      }

      try {
        // Profile phase: use generateProfileXml directly to capture predictedKeys
        let xml: string;
        if (item.phase === "profile") {
          const profile = ctx.spec.profiles.find(
            (p) => `profile:${p.localProfileId}` === item.localId,
          );
          if (profile) {
            const result = generateProfileXml(profile, ctx.folderId);
            xml = result.xml;
            if (result.predictedKeys && result.predictedKeys.length > 0) {
              ctx.profileKeys.set(item.localId, result.predictedKeys);
            }
          } else {
            xml = item.generate(ctx);
          }
        } else {
          xml = item.generate(ctx);
        }

        // Write to workspace
        const componentDir = item.componentType;
        const fileName = `${sanitizeFileName(item.name)}.xml`;
        const filePath = path.join(
          workspaceDir,
          "active-development",
          componentDir,
          fileName,
        );
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, xml, "utf8");

        // Push to Boomi via Companion script
        const isCreate = item.action === "create";
        const scriptName = isCreate
          ? "boomi-component-create.sh"
          : "boomi-component-push.sh";

        const startMs = Date.now();
        const scriptResult = await runCompanionScript(
          scriptName,
          [path.join("active-development", componentDir, fileName)],
          workspaceDir,
          {},
        );
        const durationMs = Date.now() - startMs;

        if (!scriptResult.ok) {
          throw new Error(
            scriptResult.stderr || scriptResult.stdout || "Push failed",
          );
        }

        const componentId = scriptResult.componentId ?? item.existingComponentId ?? "";
        if (componentId) {
          ctx.componentIds.set(item.localId, componentId);
        }

        const result: PushedComponent = {
          phase: item.phase,
          localId: item.localId,
          name: item.name,
          componentType: item.componentType,
          action: item.action,
          componentId: componentId || undefined,
        };
        ctx.phaseResults.set(item.localId, result);
        allResults.push(result);

        emitter.emit("progress", {
          phase: item.phase,
          step: stepNum,
          totalSteps,
          stepName: `${item.action === "create" ? "Created" : "Updated"} ${item.componentType}: ${item.name}`,
          status: "ok",
          componentType: item.componentType,
          componentName: item.name,
          componentId: componentId || undefined,
          durationMs,
        });

        // Rewrite dependent XML files with resolved IDs
        if (item.phase === "connection") {
          rewriteOperationsWithConnectionId(ctx, item.localId);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        emitter.emit("progress", {
          phase: item.phase,
          step: stepNum,
          totalSteps,
          stepName: `Failed: ${item.name}`,
          status: "failed",
          componentType: item.componentType,
          componentName: item.name,
          error: errorMsg.slice(0, 500),
        });

        emitter.emit("error", {
          message: `Phase ${item.phase} failed for "${item.name}": ${errorMsg}`,
          phase: item.phase,
          stepName: item.name,
        });
        emitter.status = "failed";
        break;
      }
    }

    if (emitter.status !== "failed") {
      emitter.status = "complete";
      const componentIds: Record<string, string> = {};
      ctx.componentIds.forEach((v, k) => {
        componentIds[k] = v;
      });

      emitter.emit("complete", {
        totalSteps,
        ok: allResults.filter((r) => r.action !== "reuse").length,
        failed: 0,
        skipped: 0,
        reused: allResults.filter((r) => r.action === "reuse").length,
        componentIds,
      });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    emitter.emit("error", { message: errorMsg });
    emitter.status = "failed";
  } finally {
    if (!keepWorkspace) {
      try {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }

  return allResults;
}

// ─── Preflight ─────────────────────────────────────────────────────────────

async function runPreflight(
  ctx: PipelineContext,
  packageId: string,
  emitter: BuildPipelineEmitter,
): Promise<void> {
  const totalPreflight = 2;
  let step = 0;

  // Step 1: env-check
  step++;
  emitter.emit("progress", {
    phase: "preflight",
    step,
    totalSteps: totalPreflight,
    stepName: "Verify Companion environment",
    status: "running",
  });

  const envResult = await runCompanionScript(
    "boomi-env-check.sh",
    [],
    ctx.workspaceDir,
    {},
  );

  if (!envResult.ok) {
    emitter.emit("error", { message: "Boomi environment check failed — verify credentials" });
    emitter.status = "failed";
    throw new Error("Preflight: env-check failed");
  }

  emitter.emit("progress", {
    phase: "preflight",
    step,
    totalSteps: totalPreflight,
    stepName: "Environment verified",
    status: "ok",
    durationMs: envResult.durationMs,
  });

  // Step 2: component-search for reuse detection
  step++;
  emitter.emit("progress", {
    phase: "preflight",
    step,
    totalSteps: totalPreflight,
    stepName: "Search for existing components",
    status: "running",
  });

  // Search for existing profiles in the target folder
  for (const profile of ctx.spec.profiles) {
    const searchResult = await runCompanionScript(
      "boomi-component-search.sh",
      ["--name", `%${profile.name}%`, "--type", profileComponentType(profile), "--folder", ctx.folderId || ctx.folderName],
      ctx.workspaceDir,
      {},
    );
    void searchResult;
  }

  emitter.emit("progress", {
    phase: "preflight",
    step,
    totalSteps: totalPreflight,
    stepName: "Component search complete",
    status: "ok",
  });
}

// ─── Dependency rewriting ─────────────────────────────────────────────────

function rewriteOperationsWithConnectionId(
  ctx: PipelineContext,
  connectionLocalId: string,
): void {
  const connId = ctx.componentIds.get(connectionLocalId);
  if (!connId) return;

  const activeDev = path.join(ctx.workspaceDir, "active-development");
  const opDir = path.join(activeDev, "connector-action");
  if (!fs.existsSync(opDir)) return;

  const files = fs.readdirSync(opDir);
  for (const file of files) {
    if (!file.endsWith(".xml")) continue;
    const filePath = path.join(opDir, file);
    let content = fs.readFileSync(filePath, "utf8");
    content = content.replace(
      /connectionId="[^"]*"/g,
      `connectionId="${connId}"`,
    );
    fs.writeFileSync(filePath, content, "utf8");
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────

export function cleanPipeline(packageId: string): void {
  const emitter = BUILD_PIPELINES.get(packageId);
  if (emitter) {
    emitter.removeAllListeners();
    BUILD_PIPELINES.delete(packageId);
  }
}
