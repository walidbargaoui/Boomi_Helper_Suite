import { EventEmitter } from "events";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import type { ChildProcess } from "child_process";
import type {
  BoomiBuildSpec,
  BoomiConnection,
  CompanionAgentPlanComponent,
  CompanionAgentRunPlan,
  CompanionAgentRunStatus,
  CompanionResult,
} from "@/lib/domain";
import { buildPackageFiles } from "@/lib/boomi-companion-package";
import { recordCompanionResult } from "@/lib/boomi-companion-mutations";
import { runCompanionScript } from "@/lib/boomi-bridge-runner";

export type CompanionV3ProgressStatus = "running" | "ok" | "failed" | "blocked";

export type CompanionV3Progress = {
  step: number;
  phase: "preflight" | "plan" | "agent";
  stepName: string;
  status: CompanionV3ProgressStatus;
  output?: string;
  error?: string;
  durationMs?: number;
};

export type CompanionV3LogEvent = {
  stream: "stdout" | "stderr";
  text: string;
};

export type StoredV3Run = {
  runId: string;
  packageId: string;
  projectId: string;
  workspaceDir: string;
  promptPath: string;
  planPath: string;
  envPath: string;
  keepWorkspace: boolean;
  plan: CompanionAgentRunPlan;
  secrets: string[];
  status: CompanionAgentRunStatus;
  emitter: BufferedV3Emitter;
  agentProcess?: ChildProcess;
  cancelRequested?: boolean;
};

export class BufferedV3Emitter extends EventEmitter {
  public buffer: Array<{ event: string; data: unknown }> = [];
  public status: CompanionAgentRunStatus = "preflight_running";

  emit(event: string, ...args: unknown[]): boolean {
    this.buffer.push({ event, data: args[0] });
    return super.emit(event, ...args);
  }

  replay(listener: (event: string, data: unknown) => void): void {
    for (const entry of this.buffer) {
      listener(entry.event, entry.data);
    }
  }

  hasFinalEvent(): boolean {
    return this.buffer.some((entry) => entry.event === "complete" || entry.event === "error");
  }
}

export const COMPANION_V3_RUNS = new Map<string, StoredV3Run>();
const LATEST_RUN_BY_PACKAGE = new Map<string, string>();

const SCRIPTS_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "boomi-companion-scripts");

const CREDENTIAL_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /Basic\s+[A-Za-z0-9+/=]+/gi,
  /BOOMI_API_TOKEN\s*=\s*\S+/gi,
  /BOOMI_USERNAME\s*=\s*\S+/gi,
  /apiPassword\s*[:=]\s*\S+/gi,
  /apiToken\s*[:=]\s*\S+/gi,
  /password\s*[:=]\s*\S+/gi,
  /Authorization:.*$/gim,
];

export function redactCompanionText(text: string, secrets: string[] = []): string {
  let result = text;
  for (const secret of secrets) {
    if (secret) {
      result = result.split(secret).join("[REDACTED]");
    }
  }
  for (const pattern of CREDENTIAL_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

function sanitizePathSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 120);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
}

function writeTextFile(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(/*turbopackIgnore: true*/ filePath, content, "utf8");
}

function profileTypeToComponentType(profileType: string): string {
  const map: Record<string, string> = {
    "Flat File": "profile.flatfile",
    CSV: "profile.flatfile",
    TSV: "profile.flatfile",
    JSON: "profile.json",
    XML: "profile.xml",
    Database: "profile.db",
    API: "profile.json",
  };
  return map[profileType] ?? "profile.json";
}

function envValue(value: string | undefined): string {
  return (value ?? "").replace(/\n/g, "");
}

export type BuildCompanionV3WorkspaceInput = {
  runId: string;
  packageId: string;
  spec: BoomiBuildSpec;
  connection: BoomiConnection & {
    decryptedApiUsername?: string;
    decryptedApiToken?: string;
  };
};

export type CompanionV3Workspace = {
  dir: string;
  promptPath: string;
  planPath: string;
  envPath: string;
  files: string[];
};

export function buildCompanionV3Workspace(input: BuildCompanionV3WorkspaceInput): CompanionV3Workspace {
  const { runId, packageId, spec, connection } = input;
  const workspaceDir = path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    ".boomi-helper",
    "companion-runs",
    sanitizePathSegment(runId),
  );

  if (fs.existsSync(/*turbopackIgnore: true*/ workspaceDir)) {
    fs.rmSync(/*turbopackIgnore: true*/ workspaceDir, { recursive: true, force: true });
  }
  ensureDir(workspaceDir);

  const files = buildPackageFiles(spec, packageId);
  const writtenFiles: string[] = [];
  for (const file of files) {
    const filePath = path.join(/*turbopackIgnore: true*/ workspaceDir, file.filename);
    writeTextFile(filePath, file.content);
    writtenFiles.push(filePath);
  }

  const username = (connection.decryptedApiUsername ?? connection.apiUsername).replace(/^BOOMI_TOKEN\./i, "");
  const envPath = path.join(/*turbopackIgnore: true*/ workspaceDir, ".env");
  const envLines = [
    `BOOMI_API_URL=${envValue(connection.baseUrl)}`,
    `BOOMI_USERNAME=${envValue(username)}`,
    `BOOMI_API_TOKEN=${envValue(connection.decryptedApiToken ?? "")}`,
    `BOOMI_ACCOUNT_ID=${envValue(connection.accountId)}`,
    `BOOMI_ENVIRONMENT_ID=${envValue(connection.environmentName)}`,
    "BOOMI_TEST_ATOM_ID=",
    `BOOMI_TARGET_FOLDER=${envValue(spec.project.folder)}`,
    "BOOMI_VERIFY_SSL=true",
    `BOOMI_COMPANION_SCRIPTS_DIR=${SCRIPTS_DIR}`,
  ];
  writeTextFile(envPath, envLines.join("\n"));
  writtenFiles.push(envPath);

  const promptPath = path.join(/*turbopackIgnore: true*/ workspaceDir, "COMPANION_AGENT_PROMPT.md");
  const planPath = path.join(/*turbopackIgnore: true*/ workspaceDir, "COMPANION_AGENT_RUN_PLAN.json");

  return { dir: workspaceDir, promptPath, planPath, envPath, files: writtenFiles };
}

export function findXmlFiles(dir: string): string[] {
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) return [];
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(/*turbopackIgnore: true*/ current, { withFileTypes: true })) {
      const fullPath = path.join(/*turbopackIgnore: true*/ current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".xml")) {
        found.push(fullPath);
      }
    }
  };
  walk(dir);
  return found;
}

export type SearchRecord = {
  componentId?: string;
  id?: string;
  name?: string;
  type?: string;
  componentType?: string;
  version?: string | number;
  currentVersion?: boolean | string;
};

function normalizeName(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeType(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

function componentId(record: SearchRecord): string {
  return record.componentId ?? record.id ?? "";
}

function componentType(record: SearchRecord): string {
  return record.type ?? record.componentType ?? "";
}

function isCreateFromScratchTemplateQuestion(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("boomi template") &&
    (normalized.includes("no ") || normalized.includes("missing") || normalized.includes("from scratch"))
  );
}

function isLikelyBoomiComponentId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function buildComponentTargets(spec: BoomiBuildSpec): CompanionAgentPlanComponent[] {
  const components: CompanionAgentPlanComponent[] = [];

  for (const profile of spec.profiles) {
    components.push({
      localAppEntityId: profile.localProfileId,
      name: profile.name,
      componentType: profileTypeToComponentType(profile.type),
      source: "profile",
      action: "create",
      reason: "Profile exists in the build spec and needs a Boomi component.",
      risk: "low",
    });
  }

  for (const endpoint of spec.endpoints) {
    components.push({
      localAppEntityId: `${endpoint.localEndpointId}:connection`,
      name: endpoint.name,
      componentType: "connector-settings",
      source: "endpoint",
      action: "create",
      reason: "Endpoint connection intent exists in the build spec.",
      risk: "low",
    });
    components.push({
      localAppEntityId: `${endpoint.localEndpointId}:operation`,
      name: `${endpoint.name} Operation`,
      componentType: "connector-action",
      source: "operation",
      action: "create",
      reason: "Endpoint operation intent exists in the build spec.",
      risk: "low",
    });
  }

  for (const mappingSet of spec.mappingSets) {
    components.push({
      localAppEntityId: mappingSet.localMappingSetId,
      name: mappingSet.name,
      componentType: "transform.map",
      source: "mappingSet",
      action: "create",
      reason: "Mapping set exists in the build spec and needs a Boomi map.",
      risk: "low",
    });
  }

  for (const flow of spec.processFlows) {
    components.push({
      localAppEntityId: flow.localFlowId,
      name: flow.name,
      componentType: "process",
      source: "processFlow",
      action: "create",
      reason: "Process flow exists in the build spec and needs a Boomi process.",
      risk: "low",
    });
  }

  return components;
}

export type BuildCompanionAgentRunPlanInput = {
  runId: string;
  packageId: string;
  projectId: string;
  spec: BoomiBuildSpec;
  connection: BoomiConnection;
  targetFolder: CompanionAgentRunPlan["targetFolder"];
  searchRecords: SearchRecord[];
  warnings?: string[];
  agentCommandConfigured?: boolean;
};

export function buildCompanionAgentRunPlan(input: BuildCompanionAgentRunPlanInput): CompanionAgentRunPlan {
  const targets = buildComponentTargets(input.spec);
  const importedByNameType = new Map<string, { id: string; name: string }>();
  const warnings = [...(input.warnings ?? [])];
  for (const note of input.spec.importedBoomiContext.dependencyNotes) {
    if (
      note.includes("missing Boomi template") ||
      note.includes("No Boomi templates imported") ||
      note.includes("no template")
    ) {
      warnings.push(note);
    }
  }
  let ignoredImportedIds = 0;
  for (const item of input.spec.importedBoomiContext.components) {
    if (item.boomiComponentId && isLikelyBoomiComponentId(item.boomiComponentId)) {
      importedByNameType.set(`${normalizeName(item.name)}::${normalizeType(item.componentType)}`, {
        id: item.boomiComponentId,
        name: item.name,
      });
    } else if (item.boomiComponentId) {
      ignoredImportedIds++;
    }
  }
  if (ignoredImportedIds > 0) {
    warnings.push(
      `${ignoredImportedIds} imported component reference(s) had non-Boomi-looking IDs and were not used as update targets.`,
    );
  }

  const planned = targets.map((target): CompanionAgentPlanComponent => {
    const imported = importedByNameType.get(`${normalizeName(target.name)}::${normalizeType(target.componentType)}`);
    if (imported) {
      return {
        ...target,
        action: "update",
        matchedBoomiComponentId: imported.id,
        matchedBoomiComponentName: imported.name,
        reason: "Imported Boomi context already identifies this component; update it after the agent pulls and verifies current XML.",
        risk: "medium",
      };
    }

    const matches = input.searchRecords.filter(
      (record) =>
        normalizeName(record.name) === normalizeName(target.name) &&
        normalizeType(componentType(record)) === normalizeType(target.componentType),
    );

    if (matches.length === 1) {
      const match = matches[0];
      return {
        ...target,
        action: "reuse",
        matchedBoomiComponentId: componentId(match),
        matchedBoomiComponentName: match.name,
        reason: "Exactly one matching Boomi component was found in the target search scope; reuse it unless the approved agent plan proves an update is required.",
        risk: "low",
      };
    }

    if (matches.length > 1) {
      return {
        ...target,
        action: "blocked",
        reason: `Found ${matches.length} matching Boomi components. A human must choose which component to reuse or update.`,
        risk: "high",
      };
    }

    return target;
  });

  const unresolvedQuestions = [
    ...input.spec.openQuestions.filter((question) => {
      if (!isCreateFromScratchTemplateQuestion(question)) return true;
      warnings.push(`${question} Default action: create the component from scratch.`);
      return false;
    }),
    ...input.spec.readiness.checks
      .filter((check) => check.status === "error")
      .map((check) => `${check.category}: ${check.message}`),
  ];

  const commandConfigured = input.agentCommandConfigured ?? Boolean(process.env.BOOMI_HELPER_COMPANION_AGENT_COMMAND);
  if (!commandConfigured) {
    warnings.push("BOOMI_HELPER_COMPANION_AGENT_COMMAND is not configured; approval cannot start the local agent yet.");
  }

  const blocked = planned.some((component) => component.action === "blocked");

  return {
    schemaVersion: "1.0",
    runId: input.runId,
    packageId: input.packageId,
    projectId: input.projectId,
    generatedAt: new Date().toISOString(),
    status: blocked ? "blocked" : "approval_required",
    selectedConnection: {
      id: input.connection.id,
      accountId: input.connection.accountId,
      environmentName: input.connection.environmentName,
      mode: input.connection.mode,
    },
    targetFolder: input.targetFolder,
    proposedComponents: planned,
    unresolvedQuestions,
    warnings,
    agentCommandConfigured: commandConfigured,
  };
}

function latestInventoryFile(workspaceDir: string): string | null {
  const inventoriesDir = path.join(/*turbopackIgnore: true*/ workspaceDir, "active-development", "inventories");
  if (!fs.existsSync(/*turbopackIgnore: true*/ inventoriesDir)) return null;
  const files = fs
    .readdirSync(/*turbopackIgnore: true*/ inventoriesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(/*turbopackIgnore: true*/ inventoriesDir, file))
    .sort((a, b) => fs.statSync(/*turbopackIgnore: true*/ b).mtimeMs - fs.statSync(/*turbopackIgnore: true*/ a).mtimeMs);
  return files[0] ?? null;
}

function readSearchRecords(workspaceDir: string): SearchRecord[] {
  const filePath = latestInventoryFile(workspaceDir);
  if (!filePath) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf8")) as { records?: SearchRecord[] };
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

function parseFolderId(output: string): string | undefined {
  const patterns = [/FOLDER_ID=([^\s]+)/i, /ID:\s*([^\s]+)/i, /with ID:\s*([^\s]+)/i];
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

function emitProgress(run: StoredV3Run, step: CompanionV3Progress): void {
  run.emitter.emit("progress", step);
}

async function runPreflightScript(
  run: StoredV3Run,
  step: number,
  stepName: string,
  scriptName: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string; durationMs: number }> {
  emitProgress(run, { step, phase: "preflight", stepName, status: "running" });
  const result = await runCompanionScript(scriptName, args, run.workspaceDir, {});
  const stdout = redactCompanionText(result.stdout, run.secrets);
  const stderr = redactCompanionText(result.stderr, run.secrets);
  emitProgress(run, {
    step,
    phase: "preflight",
    stepName,
    status: result.ok ? "ok" : "failed",
    output: stdout.slice(-800),
    error: result.ok ? undefined : (stderr || stdout || "Script failed").slice(0, 800),
    durationMs: result.durationMs,
  });
  return { ok: result.ok, stdout, stderr, durationMs: result.durationMs };
}

export type CreateCompanionV3PreflightInput = {
  packageId: string;
  projectId: string;
  spec: BoomiBuildSpec;
  connection: BoomiConnection & {
    decryptedApiUsername?: string;
    decryptedApiToken?: string;
  };
  keepWorkspace?: boolean;
  availableComponents?: number;
};

export async function createCompanionV3Preflight(
  input: CreateCompanionV3PreflightInput,
): Promise<CompanionAgentRunPlan> {
  const runId = `${input.packageId}-${Date.now()}`;
  const workspace = buildCompanionV3Workspace({
    runId,
    packageId: input.packageId,
    spec: input.spec,
    connection: input.connection,
  });

  const emitter = new BufferedV3Emitter();
  emitter.setMaxListeners(50);
  emitter.status = "preflight_running";

  const run: StoredV3Run = {
    runId,
    packageId: input.packageId,
    projectId: input.projectId,
    workspaceDir: workspace.dir,
    promptPath: workspace.promptPath,
    planPath: workspace.planPath,
    envPath: workspace.envPath,
    keepWorkspace: input.keepWorkspace ?? false,
    secrets: [
      input.connection.decryptedApiUsername ?? input.connection.apiUsername,
      input.connection.decryptedApiToken ?? input.connection.apiPassword,
      input.connection.apiPassword,
    ],
    plan: {
      schemaVersion: "1.0",
      runId,
      packageId: input.packageId,
      projectId: input.projectId,
      generatedAt: new Date().toISOString(),
      status: "preflight_running",
      selectedConnection: {
        id: input.connection.id,
        accountId: input.connection.accountId,
        environmentName: input.connection.environmentName,
        mode: input.connection.mode,
      },
      targetFolder: { name: input.spec.project.folder, status: input.spec.project.folder ? "missing" : "not_specified" },
      proposedComponents: [],
      unresolvedQuestions: [],
      warnings: [],
      agentCommandConfigured: Boolean(process.env.BOOMI_HELPER_COMPANION_AGENT_COMMAND),
    },
    status: "preflight_running",
    emitter,
  };

  COMPANION_V3_RUNS.set(runId, run);
  LATEST_RUN_BY_PACKAGE.set(input.packageId, runId);
  emitter.emit("connected", { packageId: input.packageId, runId, status: "preflight_running" });

  const warnings: string[] = [];
  let targetFolder: CompanionAgentRunPlan["targetFolder"] = input.spec.project.folder
    ? { name: input.spec.project.folder, status: "missing" }
    : { status: "not_specified", detail: "No target folder was specified in the build spec." };

  const envCheck = await runPreflightScript(run, 1, "Verify Companion environment variables", "boomi-env-check.sh", []);
  if (!envCheck.ok) {
    targetFolder = { ...targetFolder, status: "error", detail: envCheck.stderr || envCheck.stdout };
  }

  if (input.availableComponents !== undefined) {
    emitProgress(run, {
      step: 2,
      phase: "preflight",
      stepName: "Verify Boomi API connection",
      status: "ok",
      output: `Connection verified (${input.availableComponents} existing component${input.availableComponents === 1 ? "" : "s"} found in account).`,
    });
  }

  if (envCheck.ok && input.spec.project.folder) {
    const folderCheck = await runPreflightScript(run, 3, "Find target Boomi folder", "boomi-folder-check.sh", [input.spec.project.folder]);
    if (folderCheck.ok) {
      targetFolder = {
        name: input.spec.project.folder,
        folderId: parseFolderId(folderCheck.stdout),
        status: "found",
        detail: folderCheck.stdout.split("\n").slice(-2).join(" "),
      };
    } else {
      const folderCreate = await runPreflightScript(run, 4, "Create target Boomi folder", "boomi-folder-create.sh", [input.spec.project.folder]);
      targetFolder = {
        name: input.spec.project.folder,
        folderId: parseFolderId(folderCreate.stdout),
        status: folderCreate.ok ? "created" : "error",
        detail: (folderCreate.ok ? folderCreate.stdout : folderCreate.stderr || folderCreate.stdout).slice(0, 500),
      };
    }
  }

  const targetTypes = Array.from(
    new Set(buildComponentTargets(input.spec).map((component) => component.componentType)),
  );
  if (envCheck.ok && targetTypes.length > 0) {
    const args = ["--type", targetTypes.join(",")];
    if (input.spec.project.folder) {
      args.push("--folder", input.spec.project.folder);
    }
    const search = await runPreflightScript(run, 5, "Search reusable Boomi components", "boomi-component-search.sh", args);
    if (!search.ok) {
      warnings.push("Component search failed; the agent plan will default unmatched components to create.");
    }
  }

  const plan = buildCompanionAgentRunPlan({
    runId,
    packageId: input.packageId,
    projectId: input.projectId,
    spec: input.spec,
    connection: input.connection,
    targetFolder,
    searchRecords: readSearchRecords(workspace.dir),
    warnings,
    agentCommandConfigured: Boolean(process.env.BOOMI_HELPER_COMPANION_AGENT_COMMAND),
  });

  run.plan = plan;
  run.status = plan.status;
  run.emitter.status = plan.status;
  writeTextFile(run.planPath, JSON.stringify(plan, null, 2));

  emitProgress(run, {
    step: 6,
    phase: "plan",
    stepName: "Generate agent build plan",
    status: plan.status === "blocked" ? "blocked" : "ok",
    output: `${plan.proposedComponents.length} component target(s), ${plan.unresolvedQuestions.length} unresolved question(s).`,
  });
  run.emitter.emit("plan", plan);
  if (plan.status === "blocked") {
    removeEnvIfNeeded(run);
  }

  return plan;
}

export function getCompanionV3Run(runId: string): StoredV3Run | undefined {
  return COMPANION_V3_RUNS.get(runId);
}

export function getLatestCompanionV3RunForPackage(packageId: string): StoredV3Run | undefined {
  const runId = LATEST_RUN_BY_PACKAGE.get(packageId);
  return runId ? COMPANION_V3_RUNS.get(runId) : undefined;
}

export function parseAgentCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of command.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if ((char === "'" || char === '"') && quote === null) {
      quote = char;
      continue;
    }
    if (char === quote) {
      quote = null;
      continue;
    }
    if (/\s/.test(char) && quote === null) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

export type AgentCommand = {
  command: string;
  args: string[];
  display: string;
};

export function buildAgentCommand(
  commandString: string,
  paths: { workspaceDir: string; promptPath: string; planPath: string },
): AgentCommand {
  const parts = parseAgentCommand(commandString);
  if (parts.length === 0) {
    throw new Error("BOOMI_HELPER_COMPANION_AGENT_COMMAND is empty.");
  }

  const replace = (token: string) =>
    token
      .replaceAll("{workspace}", paths.workspaceDir)
      .replaceAll("{prompt}", paths.promptPath)
      .replaceAll("{plan}", paths.planPath);

  const replaced = parts.map(replace);
  const hadPlaceholder = parts.some((part) => /\{workspace\}|\{prompt\}|\{plan\}/.test(part));
  if (!hadPlaceholder) {
    replaced.push(paths.promptPath);
  }

  return {
    command: replaced[0],
    args: replaced.slice(1),
    display: replaced.join(" "),
  };
}

type AgentResultRead = {
  result: CompanionResult;
  populated: boolean;
};

function readAgentResult(run: StoredV3Run, exitCode: number, failureMessage?: string): AgentResultRead {
  const templatePath = path.join(/*turbopackIgnore: true*/ run.workspaceDir, "COMPANION_RESULT_TEMPLATE.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ templatePath, "utf8")) as CompanionResult;
    if (parsed.runTimestamp && parsed.agentTool) {
      return { result: parsed, populated: true };
    }
  } catch {
    // Use fallback result below.
  }

  return {
    populated: false,
    result: {
      schemaVersion: "1.0",
      packageId: run.packageId,
      runTimestamp: new Date().toISOString(),
      agentTool: process.env.BOOMI_HELPER_COMPANION_AGENT_COMMAND ?? "unconfigured",
      boomiAccountId: run.plan.selectedConnection.accountId,
      targetEnvironmentId: run.plan.selectedConnection.environmentName,
      components: { created: [], updated: [], reused: [] },
      deployments: [],
      tests: [],
      warnings: [],
      errors: [
        failureMessage ??
          (exitCode === 0
            ? "Agent exited successfully but did not write a populated COMPANION_RESULT_TEMPLATE.json."
            : `Agent exited with code ${exitCode}.`),
      ],
      openFollowUps: run.plan.unresolvedQuestions,
    },
  };
}

function removeEnvIfNeeded(run: StoredV3Run): void {
  if (!run.keepWorkspace && fs.existsSync(/*turbopackIgnore: true*/ run.envPath)) {
    fs.rmSync(/*turbopackIgnore: true*/ run.envPath, { force: true });
  }
}

export async function approveCompanionV3Run(packageId: string, runId: string): Promise<CompanionAgentRunPlan> {
  const run = COMPANION_V3_RUNS.get(runId);
  if (!run || run.packageId !== packageId) {
    throw new Error("No v3 preflight plan found for this package.");
  }
  if (run.plan.status === "blocked") {
    throw new Error("The v3 plan is blocked. Resolve blocked components or configure the agent command first.");
  }
  if (run.status !== "approval_required") {
    throw new Error(`Run is not awaiting approval (current status: ${run.status}).`);
  }

  const commandString = process.env.BOOMI_HELPER_COMPANION_AGENT_COMMAND;
  if (!commandString) {
    throw new Error("BOOMI_HELPER_COMPANION_AGENT_COMMAND is not configured.");
  }

  const agentCommand = buildAgentCommand(commandString, {
    workspaceDir: run.workspaceDir,
    promptPath: run.promptPath,
    planPath: run.planPath,
  });

  run.status = "agent_running";
  run.plan = { ...run.plan, status: "agent_running" };
  run.emitter.status = "agent_running";
  writeTextFile(run.planPath, JSON.stringify(run.plan, null, 2));
  run.emitter.emit("plan", run.plan);

  void runAgentCommand(run, agentCommand);

  return run.plan;
}

export function cancelCompanionV3Run(packageId: string, runId: string): CompanionAgentRunPlan {
  const run = COMPANION_V3_RUNS.get(runId);
  if (!run || run.packageId !== packageId) {
    throw new Error("No v3 run found for this package.");
  }
  if (run.status !== "agent_running") {
    throw new Error(`Run is not currently running a local agent (current status: ${run.status}).`);
  }

  run.cancelRequested = true;
  if (run.agentProcess) {
    run.agentProcess.kill("SIGTERM");
  }
  return run.plan;
}

async function runAgentCommand(run: StoredV3Run, agentCommand: AgentCommand): Promise<void> {
  const timeoutMs = Number(process.env.BOOMI_HELPER_COMPANION_AGENT_TIMEOUT_MS ?? 10 * 60 * 1000);
  const startedAt = Date.now();
  let timedOut = false;
  let settled = false;
  emitProgress(run, {
    step: 1,
    phase: "agent",
    stepName: "Start local Companion agent",
    status: "running",
    output: redactCompanionText(agentCommand.display, run.secrets),
  });

  const proc = spawn(agentCommand.command, agentCommand.args, {
    cwd: run.workspaceDir,
    env: {
      ...process.env,
      BOOMI_HELPER_COMPANION_WORKSPACE: run.workspaceDir,
      BOOMI_HELPER_COMPANION_PROMPT: run.promptPath,
      BOOMI_HELPER_COMPANION_PLAN: run.planPath,
      BOOMI_COMPANION_SCRIPTS_DIR: SCRIPTS_DIR,
    },
    shell: false,
  });
  run.agentProcess = proc;

  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
  }, timeoutMs);

  proc.stdout?.on("data", (chunk: Buffer) => {
    run.emitter.emit("log", { stream: "stdout", text: redactCompanionText(chunk.toString("utf8"), run.secrets) });
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    run.emitter.emit("log", { stream: "stderr", text: redactCompanionText(chunk.toString("utf8"), run.secrets) });
  });
  proc.on("error", async (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    delete run.agentProcess;
    run.status = "agent_failed";
    run.plan = { ...run.plan, status: "agent_failed" };
    run.emitter.status = "agent_failed";
    const message = redactCompanionText(
      timedOut ? `Agent timed out after ${timeoutMs}ms.` : error.message,
      run.secrets,
    );
    emitProgress(run, {
      step: 1,
      phase: "agent",
      stepName: "Start local Companion agent",
      status: "failed",
      error: message,
      durationMs: Date.now() - startedAt,
    });
    run.emitter.emit("error", { message });
    removeEnvIfNeeded(run);
  });
  proc.on("close", async (code, signal) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    delete run.agentProcess;
    const exitCode = code ?? -1;
    let failureMessage = run.cancelRequested
      ? "Agent run was cancelled."
      : timedOut
        ? `Agent timed out after ${timeoutMs}ms.`
        : signal
          ? `Agent exited after signal ${signal}.`
          : `Agent exited with code ${exitCode}.`;
    const rawOk = exitCode === 0 && !timedOut && !run.cancelRequested;
    const resultRead = readAgentResult(run, exitCode, rawOk ? undefined : failureMessage);
    if (rawOk && !resultRead.populated) {
      failureMessage = "Agent exited successfully but did not write a populated COMPANION_RESULT_TEMPLATE.json.";
    }
    const ok = rawOk && resultRead.populated;
    run.status = ok ? "agent_completed" : "agent_failed";
    run.plan = { ...run.plan, status: run.status };
    run.emitter.status = run.status;
    writeTextFile(run.planPath, JSON.stringify(run.plan, null, 2));

    emitProgress(run, {
      step: 1,
      phase: "agent",
      stepName: "Run local Companion agent",
      status: ok ? "ok" : "failed",
      output: ok ? "Agent command completed." : undefined,
      error: ok ? undefined : failureMessage,
      durationMs: Date.now() - startedAt,
    });

    const result = resultRead.result;
    try {
      await recordCompanionResult(run.packageId, result, ok ? "agent_completed" : "agent_failed");
    } catch (error) {
      result.warnings.push(
        `Could not record Companion result automatically: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    run.emitter.emit("result", result);
    run.emitter.emit("complete", {
      runId: run.runId,
      status: run.status,
      ok,
      exitCode,
      proposedComponents: run.plan.proposedComponents.length,
    });
    removeEnvIfNeeded(run);
  });
}
