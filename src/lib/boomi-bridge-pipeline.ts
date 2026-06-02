import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import type { BoomiBuildSpec, BoomiConnection, CompanionResult, CompanionResultComponent } from "@/lib/domain";
import { runCompanionScript } from "@/lib/boomi-bridge-runner";
import { buildWorkspace, cleanWorkspace, type Workspace } from "@/lib/boomi-bridge-workspace";
import { recordCompanionResult } from "@/lib/boomi-companion-mutations";

const SCRIPTS_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "boomi-companion-scripts");

export type PipelineStepStatus = "running" | "ok" | "failed" | "skipped";

export type PipelinePhase = "verify" | "create" | "update" | "deploy" | "test";

export type PipelineStep = {
  step: number;
  phase: PipelinePhase;
  stepName: string;
  status: PipelineStepStatus;
  output?: string;
  error?: string;
  componentId?: string;
  componentType?: string;
  workspaceFile?: string;
  durationMs?: number;
};

export type PipelineEvent =
  | { type: "connected"; data: { packageId: string; status: string } }
  | { type: "progress"; data: PipelineStep }
  | { type: "complete"; data: { totalSteps: number; ok: number; failed: number; skipped: number; createdComponents: Array<{ componentId: string; componentName: string; componentType: string }> } }
  | { type: "result"; data: CompanionResult }
  | { type: "error"; data: { message: string; step?: PipelineStep } };

class BufferedEmitter extends EventEmitter {
  public buffer: Array<{ event: string; data: unknown }> = [];
  public pipelineStatus = "starting";

  emit(event: string, ...args: unknown[]): boolean {
    this.buffer.push({ event, data: args[0] });
    return super.emit(event, ...args);
  }

  replay(listener: (event: string, data: unknown) => void): void {
    for (const entry of this.buffer) {
      try {
        listener(entry.event, entry.data);
      } catch {
        // listener error shouldn't break replay
      }
    }
  }

  hasFinalEvent(): boolean {
    return this.buffer.some(
      (e) => e.event === "complete" || e.event === "error" || e.event === "result",
    );
  }
}

export const BRIDGE_EVENT_EMITTERS = new Map<string, BufferedEmitter>();

function getOrCreateEmitter(packageId: string): BufferedEmitter {
  let emitter = BRIDGE_EVENT_EMITTERS.get(packageId);
  if (!emitter) {
    emitter = new BufferedEmitter();
    emitter.setMaxListeners(50);
    BRIDGE_EVENT_EMITTERS.set(packageId, emitter);
  }
  return emitter;
}

export function removeEmitter(packageId: string): void {
  const emitter = BRIDGE_EVENT_EMITTERS.get(packageId);
  if (emitter) {
    emitter.removeAllListeners();
    BRIDGE_EVENT_EMITTERS.delete(packageId);
  }
}

function emitProgress(packageId: string, step: PipelineStep): void {
  const emitter = BRIDGE_EVENT_EMITTERS.get(packageId);
  if (emitter) {
    emitter.emit("progress", step);
  }
}

function emitComplete(
  packageId: string,
  totalSteps: number,
  ok: number,
  failed: number,
  skipped: number,
  createdComponents: Array<{ componentId: string; componentName: string; componentType: string }>,
): void {
  const emitter = BRIDGE_EVENT_EMITTERS.get(packageId);
  if (emitter) {
    emitter.pipelineStatus = "complete";
    emitter.emit("complete", { totalSteps, ok, failed, skipped, createdComponents });
  }
}

function emitResult(packageId: string, result: CompanionResult): void {
  const emitter = BRIDGE_EVENT_EMITTERS.get(packageId);
  if (emitter) {
    emitter.emit("result", result);
  }
}

function emitError(packageId: string, message: string, step?: PipelineStep): void {
  const emitter = BRIDGE_EVENT_EMITTERS.get(packageId);
  if (emitter) {
    emitter.pipelineStatus = "failed";
    emitter.emit("error", { message, step });
  }
}

export function areScriptsVendored(): boolean {
  if (!fs.existsSync(SCRIPTS_DIR)) return false;
  const required = ["boomi-env-check.sh", "boomi-folder-check.sh", "boomi-component-search.sh"];
  try {
    for (const scriptName of required) {
      const scriptPath = path.join(SCRIPTS_DIR, scriptName);
      if (!fs.existsSync(scriptPath)) return false;
      fs.accessSync(scriptPath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function injectFolderIdIntoWorkspace(workspaceDir: string, folderId: string): void {
  const activeDev = path.join(workspaceDir, "active-development");
  if (!fs.existsSync(activeDev)) return;
  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".xml")) {
        let xml = fs.readFileSync(fullPath, "utf8");
        if (!xml.includes("folderId=")) {
          xml = xml.replace(
            /(componentId="[^"]*")/,
            `folderId="${folderId}" $1`,
          );
          fs.writeFileSync(fullPath, xml, "utf8");
        }
      }
    }
  }
  walk(activeDev);
}

interface RunBuildPipelineOptions {
  packageId: string;
  spec: BoomiBuildSpec;
  connection: BoomiConnection & { decryptedApiUsername?: string; decryptedApiToken?: string };
  approveDeploy: boolean;
  keepWorkspace: boolean;
  availableComponents?: number;
}

export async function runBuildPipeline(
  options: RunBuildPipelineOptions,
): Promise<void> {
  const { packageId, spec, connection, approveDeploy, keepWorkspace, availableComponents } = options;
  let workspace: Workspace | null = null;

  const emitter = getOrCreateEmitter(packageId);
  emitter.pipelineStatus = "running";
  emitter.emit("connected", { packageId, status: "running" });

  if (!areScriptsVendored()) {
    const msg =
      "Companion scripts are not installed. Run 'npm run companion:setup' to download them from GitHub, then try again.";
    emitError(packageId, msg);
    emitter.pipelineStatus = "failed";
    return;
  }

  try {
    workspace = buildWorkspace(packageId, spec, connection);
    const steps = buildStepList(spec, workspace, approveDeploy, availableComponents);

    let okCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const createdComponents: CompanionResultComponent[] = [];
    let shouldAbort = false;
    let folderId = "";

    for (const stepDef of steps) {
      if (shouldAbort) break;

      emitProgress(packageId, {
        step: stepDef.step,
        phase: stepDef.phase,
        stepName: stepDef.stepName,
        status: "running",
        componentType: stepDef.componentType,
        workspaceFile: stepDef.workspaceFile,
      });

      if (stepDef.skipReason) {
        skippedCount++;
        emitProgress(packageId, {
          step: stepDef.step,
          phase: stepDef.phase,
          stepName: stepDef.stepName,
          status: "skipped",
          output: stepDef.skipReason,
          componentType: stepDef.componentType,
          workspaceFile: stepDef.workspaceFile,
        });
        continue;
      }

      const cwd = workspace.dir;
      const env: Record<string, string> = {};

      try {
        const result = await runCompanionScript(
          stepDef.scriptName,
          stepDef.args,
          cwd,
          env,
        );

        if (result.ok) {
          okCount++;

          if (stepDef.scriptName === "boomi-folder-create.sh") {
            const folderMatch = result.stdout.match(/ID:\s*(\S+)/i);
            if (folderMatch) {
              folderId = folderMatch[1];
              if (workspace) {
                injectFolderIdIntoWorkspace(workspace.dir, folderId);
              }
            }
          }

          if (result.componentId && stepDef.componentType) {
            createdComponents.push({
              componentId: result.componentId,
              componentName: stepDef.componentName ?? stepDef.stepName,
              componentType: stepDef.componentType,
              action: "created",
            });
          }
          emitProgress(packageId, {
            step: stepDef.step,
            phase: stepDef.phase,
            stepName: stepDef.stepName,
            status: "ok",
            output: result.stdout.slice(-500),
            componentId: result.componentId,
            componentType: stepDef.componentType,
            workspaceFile: stepDef.workspaceFile,
            durationMs: result.durationMs,
          });
        } else {
          failedCount++;
          const errorDetail = (result.stderr || result.stdout || "Unknown error").slice(0, 500);
          emitProgress(packageId, {
            step: stepDef.step,
            phase: stepDef.phase,
            stepName: stepDef.stepName,
            status: "failed",
            output: result.stdout.slice(-500),
            error: errorDetail,
            componentType: stepDef.componentType,
            workspaceFile: stepDef.workspaceFile,
            durationMs: result.durationMs,
          });
          shouldAbort = true;
        }
      } catch (err) {
        failedCount++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        const cleanMsg = errorMsg.split("Command failed:")[0].trim() || errorMsg;
        emitProgress(packageId, {
          step: stepDef.step,
          phase: stepDef.phase,
          stepName: stepDef.stepName,
          status: "failed",
          error: cleanMsg.slice(0, 500),
          componentType: stepDef.componentType,
          workspaceFile: stepDef.workspaceFile,
        });
        shouldAbort = true;
      }
    }

    const totalSteps = steps.length;
    const completedComponents = createdComponents.map((c) => ({
      componentId: c.componentId,
      componentName: c.componentName,
      componentType: c.componentType,
    }));
    emitComplete(packageId, totalSteps, okCount, failedCount, skippedCount, completedComponents);

    const result: CompanionResult = {
      schemaVersion: "1.0",
      packageId,
      runTimestamp: new Date().toISOString(),
      agentTool: "boomi-helper-bridge-v2",
      boomiAccountId: connection.accountId,
      targetEnvironmentId: connection.environmentName,
      components: {
        created: createdComponents.filter((c) => c.action === "created"),
        updated: [],
        reused: [],
      },
      deployments: [],
      tests: [],
      warnings: skippedCount > 0 ? [`${skippedCount} step(s) skipped`] : [],
      errors: failedCount > 0 ? [`${failedCount} step(s) failed`] : [],
      openFollowUps: [],
    };

    emitResult(packageId, result);

    try {
      await recordCompanionResult(
        packageId,
        result,
        failedCount > 0 ? "agent_failed" : "agent_completed",
      );
    } catch {
      // best-effort recording
    }

    if (!keepWorkspace) {
      cleanWorkspace(workspace.dir);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const cleanMsg = errorMsg.split("Command failed:")[0].trim() || errorMsg;
    emitError(packageId, cleanMsg.slice(0, 500));

    if (workspace && !keepWorkspace) {
      cleanWorkspace(workspace.dir);
    }
  }
}

interface PipelineStepDef {
  step: number;
  phase: PipelinePhase;
  stepName: string;
  scriptName: string;
  args: string[];
  componentType?: string;
  componentName?: string;
  workspaceFile?: string;
  skipReason?: string;
}

function humanComponentType(componentType: string): string {
  const map: Record<string, string> = {
    "profile.flatfile": "Flat File profile",
    "profile.json": "JSON profile",
    "profile.xml": "XML profile",
    "profile.db": "Database profile",
    "connector-settings": "connection",
    "connector-action": "operation",
    "transform.map": "map",
    "process": "process",
  };
  return map[componentType] ?? componentType;
}

function buildStepList(
  spec: BoomiBuildSpec,
  workspace: Workspace,
  approveDeploy: boolean,
  availableComponents?: number,
): PipelineStepDef[] {
  const steps: PipelineStepDef[] = [];
  let stepNum = 0;

  steps.push({
    step: ++stepNum,
    phase: "verify",
    stepName: "Verify Companion environment variables",
    scriptName: "boomi-env-check.sh",
    args: [],
  });

  steps.push({
    step: ++stepNum,
    phase: "verify",
    stepName: "Test Boomi API connection",
    scriptName: "",
    args: [],
    skipReason:
      availableComponents !== undefined
        ? `Connection verified (${availableComponents} existing component${availableComponents === 1 ? "" : "s"} found in account)`
        : "Connection verified",
  });

  if (spec.project.folder) {
    steps.push({
      step: ++stepNum,
      phase: "verify",
      stepName: `Verify/create Boomi folder "${spec.project.folder}"`,
      scriptName: "boomi-folder-create.sh",
      args: [spec.project.folder],
    });
  }

  for (const entry of workspace.entries.filter(
    (e) =>
      e.componentType &&
      (e.componentType.startsWith("profile.") || e.componentType.startsWith("profile_")),
  )) {
    steps.push({
      step: ++stepNum,
      phase: "create",
      stepName: `Create ${humanComponentType(entry.componentType ?? "")} "${entry.componentName ?? ""}"`,
      scriptName: "boomi-component-create.sh",
      args: [entry.relativePath],
      componentType: entry.componentType,
      componentName: entry.componentName,
      workspaceFile: entry.relativePath,
    });
  }

  for (const entry of workspace.entries.filter(
    (e) => e.componentType === "connector-settings",
  )) {
    steps.push({
      step: ++stepNum,
      phase: "create",
      stepName: `Create connection "${entry.componentName ?? ""}"`,
      scriptName: "boomi-component-create.sh",
      args: [entry.relativePath],
      componentType: entry.componentType,
      componentName: entry.componentName,
      workspaceFile: entry.relativePath,
      skipReason:
        "Connections require manual setup in Boomi — connector type IDs must match Boomi's API. Create this connection in the Boomi UI.",
    });
  }

  for (const entry of workspace.entries.filter(
    (e) => e.componentType === "connector-action",
  )) {
    steps.push({
      step: ++stepNum,
      phase: "create",
      stepName: `Create operation "${entry.componentName ?? ""}"`,
      scriptName: "boomi-component-create.sh",
      args: [entry.relativePath],
      componentType: entry.componentType,
      componentName: entry.componentName,
      workspaceFile: entry.relativePath,
      skipReason:
        "Operations require manual setup — they reference connection component IDs that must exist first.",
    });
  }

  for (const entry of workspace.entries.filter(
    (e) => e.componentType === "transform.map",
  )) {
    steps.push({
      step: ++stepNum,
      phase: "create",
      stepName: `Create transform map "${entry.componentName ?? ""}"`,
      scriptName: "boomi-component-create.sh",
      args: [entry.relativePath],
      componentType: entry.componentType,
      componentName: entry.componentName,
      workspaceFile: entry.relativePath,
      skipReason:
        "Map creation requires profile component IDs from Boomi. Create the map in Boomi UI after profiles are created.",
    });
  }

  for (const entry of workspace.entries.filter(
    (e) => e.componentType === "process",
  )) {
    steps.push({
      step: ++stepNum,
      phase: "create",
      stepName: `Create process "${entry.componentName ?? ""}"`,
      scriptName: "boomi-component-create.sh",
      args: [entry.relativePath],
      componentType: entry.componentType,
      componentName: entry.componentName,
      workspaceFile: entry.relativePath,
      skipReason:
        "Process creation requires existing component IDs. Create the process in Boomi UI after maps/connections are set up.",
    });
  }

  for (const entry of workspace.entries.filter(
    (e) => e.componentType === "transform.map" || e.componentType === "process",
  )) {
    steps.push({
      step: ++stepNum,
      phase: "update",
      stepName: `Push "${entry.componentName ?? ""}" (${humanComponentType(entry.componentType ?? "")})`,
      scriptName: "boomi-component-push.sh",
      args: [entry.relativePath],
      componentType: entry.componentType,
      componentName: entry.componentName,
      workspaceFile: entry.relativePath,
      skipReason:
        "Push deferred — component created successfully, push via Companion UI when ready",
    });
  }

  steps.push({
    step: ++stepNum,
    phase: "deploy",
    stepName: "Deploy to runtime",
    scriptName: "boomi-deploy.sh",
    args: [],
    skipReason: approveDeploy ? undefined : "Deploy step blocked — human approval required",
  });

  steps.push({
    step: ++stepNum,
    phase: "test",
    stepName: "Execute integration test",
    scriptName: "boomi-test-execute.sh",
    args: [],
    skipReason: "Test execution skipped — run manually or approve deploy first",
  });

  return steps;
}
