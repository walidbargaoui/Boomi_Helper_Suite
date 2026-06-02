import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBoomiBuildSpec } from "@/lib/boomi-companion-build-spec";
import {
  BufferedV3Emitter,
  COMPANION_V3_RUNS,
  approveCompanionV3Run,
  buildAgentCommand,
  buildCompanionAgentRunPlan,
  buildCompanionV3Workspace,
  cancelCompanionV3Run,
  findXmlFiles,
  parseAgentCommand,
  redactCompanionText,
  type StoredV3Run,
} from "@/lib/boomi-companion-v3";
import type { BoomiConnection } from "@/lib/domain";
import { sampleProject } from "@/lib/sample-data";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  recordCompanionResult: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: mocks.spawn,
}));

vi.mock("@/lib/boomi-companion-mutations", () => ({
  recordCompanionResult: mocks.recordCompanionResult,
}));

const connection: BoomiConnection & {
  decryptedApiUsername?: string;
  decryptedApiToken?: string;
} = {
  id: "conn-v3",
  accountId: "ACCOUNT-1",
  environmentName: "ENV-1",
  baseUrl: "https://api.boomi.com",
  authMode: "Basic API Token",
  apiUsername: "encrypted-user",
  apiPassword: "encrypted-password",
  decryptedApiUsername: "BOOMI_TOKEN.real-user",
  decryptedApiToken: "secret-token",
  mode: "sandbox",
  createdAt: "2026-05-31T00:00:00.000Z",
};

function removeWorkspace(runId: string): void {
  const dir = path.resolve(process.cwd(), ".boomi-helper", "companion-runs", runId);
  fs.rmSync(dir, { recursive: true, force: true });
}

describe("boomi-companion-v3 workspace", () => {
  afterEach(() => {
    removeWorkspace("unit-v3-workspace");
  });

  it("writes build assets and a temporary env file without app-generated XML", () => {
    const spec = buildBoomiBuildSpec(sampleProject);
    const workspace = buildCompanionV3Workspace({
      runId: "unit-v3-workspace",
      packageId: "pkg-v3",
      spec,
      connection,
    });

    const filenames = workspace.files.map((filePath) => path.relative(workspace.dir, filePath));
    expect(filenames).toContain("BOOMI_BUILD_SPEC.json");
    expect(filenames).toContain("COMPANION_AGENT_PROMPT.md");
    expect(filenames).toContain("COMPANION_RESULT_TEMPLATE.json");
    expect(filenames).toContain("active-development/README.md");
    expect(filenames).toContain(".env");

    expect(fs.readFileSync(workspace.envPath, "utf8")).toContain("BOOMI_API_TOKEN=secret-token");
    expect(findXmlFiles(workspace.dir)).toEqual([]);
  });
});

describe("boomi-companion-v3 planner", () => {
  const spec = buildBoomiBuildSpec(sampleProject);

  it("defaults unmatched targets to create when the local agent command is configured", () => {
    const plan = buildCompanionAgentRunPlan({
      runId: "run-create",
      packageId: "pkg-v3",
      projectId: sampleProject.id,
      spec,
      connection,
      targetFolder: { name: "/Boomi Helper", status: "found", folderId: "folder-1" },
      searchRecords: [],
      agentCommandConfigured: true,
    });

    expect(plan.status).toBe("approval_required");
    expect(plan.proposedComponents.some((component) => component.action === "create")).toBe(true);
    expect(plan.agentCommandConfigured).toBe(true);
  });

  it("does not block missing-template creates or missing local command configuration during preflight", () => {
    const plan = buildCompanionAgentRunPlan({
      runId: "run-create-missing-template",
      packageId: "pkg-v3",
      projectId: sampleProject.id,
      spec,
      connection,
      targetFolder: { name: "/Boomi Helper", status: "found", folderId: "folder-1" },
      searchRecords: [],
      agentCommandConfigured: false,
    });

    const processTarget = plan.proposedComponents.find((component) => component.componentType === "process");
    expect(plan.status).toBe("approval_required");
    expect(plan.agentCommandConfigured).toBe(false);
    expect(processTarget?.action).toBe("create");
    expect(plan.unresolvedQuestions.join("\n")).not.toContain("have no Boomi template");
    expect(plan.warnings.join("\n")).toContain("create from scratch by default");
  });

  it("converts stale no-template open questions into create guidance", () => {
    const staleSpec = {
      ...spec,
      openQuestions: [
        ...spec.openQuestions,
        "1 component(s) have no Boomi template — should the Companion agent create them from scratch or pull existing components from the Boomi account?",
      ],
    };

    const plan = buildCompanionAgentRunPlan({
      runId: "run-stale-template-question",
      packageId: "pkg-v3",
      projectId: sampleProject.id,
      spec: staleSpec,
      connection,
      targetFolder: { name: "/Boomi Helper", status: "found", folderId: "folder-1" },
      searchRecords: [],
      agentCommandConfigured: true,
    });

    expect(plan.status).toBe("approval_required");
    expect(plan.unresolvedQuestions.join("\n")).not.toContain("have no Boomi template");
    expect(plan.warnings.join("\n")).toContain("Default action: create the component from scratch");
  });

  it("reuses one exact Boomi name/type match", () => {
    const plan = buildCompanionAgentRunPlan({
      runId: "run-reuse",
      packageId: "pkg-v3",
      projectId: sampleProject.id,
      spec,
      connection,
      targetFolder: { name: "/Boomi Helper", status: "found", folderId: "folder-1" },
      searchRecords: [
        {
          componentId: "profile-123",
          name: "PO_SEIREN TSV",
          type: "profile.flatfile",
        },
      ],
      agentCommandConfigured: true,
    });

    const profileTarget = plan.proposedComponents.find((component) => component.name === "PO_SEIREN TSV");
    expect(profileTarget?.action).toBe("reuse");
    expect(profileTarget?.matchedBoomiComponentId).toBe("profile-123");
  });

  it("blocks ambiguous Boomi matches for human choice", () => {
    const plan = buildCompanionAgentRunPlan({
      runId: "run-blocked",
      packageId: "pkg-v3",
      projectId: sampleProject.id,
      spec,
      connection,
      targetFolder: { name: "/Boomi Helper", status: "found", folderId: "folder-1" },
      searchRecords: [
        { componentId: "profile-1", name: "PO_SEIREN TSV", type: "profile.flatfile" },
        { componentId: "profile-2", name: "PO_SEIREN TSV", type: "profile.flatfile" },
      ],
      agentCommandConfigured: true,
    });

    const profileTarget = plan.proposedComponents.find((component) => component.name === "PO_SEIREN TSV");
    expect(plan.status).toBe("blocked");
    expect(profileTarget?.action).toBe("blocked");
  });

  it("updates when imported Boomi context gives an exact component id", () => {
    const importedSpec = {
      ...spec,
      importedBoomiContext: {
        ...spec.importedBoomiContext,
        components: [
          ...spec.importedBoomiContext.components,
          {
            localDraftId: "draft-profile",
            name: "PO_SEIREN TSV",
            componentType: "profile.flatfile",
            boomiComponentId: "baf8877c-7969-4921-9e34-699c704a2f9b",
            hasTemplateXml: true,
          },
        ],
      },
    };

    const plan = buildCompanionAgentRunPlan({
      runId: "run-update",
      packageId: "pkg-v3",
      projectId: sampleProject.id,
      spec: importedSpec,
      connection,
      targetFolder: { name: "/Boomi Helper", status: "found", folderId: "folder-1" },
      searchRecords: [],
      agentCommandConfigured: true,
    });

    const profileTarget = plan.proposedComponents.find((component) => component.name === "PO_SEIREN TSV");
    expect(profileTarget?.action).toBe("update");
    expect(profileTarget?.matchedBoomiComponentId).toBe("baf8877c-7969-4921-9e34-699c704a2f9b");
  });

  it("ignores synthetic local draft ids and uses exact search matches instead", () => {
    const importedSpec = {
      ...spec,
      importedBoomiContext: {
        ...spec.importedBoomiContext,
        components: [
          {
            localDraftId: "draft-profile",
            name: "PO_SEIREN TSV",
            componentType: "profile.flatfile",
            boomiComponentId: "draft-profile-profile-source-po-tsv",
            hasTemplateXml: true,
          },
        ],
      },
    };

    const plan = buildCompanionAgentRunPlan({
      runId: "run-synthetic-id",
      packageId: "pkg-v3",
      projectId: sampleProject.id,
      spec: importedSpec,
      connection,
      targetFolder: { name: "/Boomi Helper", status: "found", folderId: "folder-1" },
      searchRecords: [
        {
          componentId: "baf8877c-7969-4921-9e34-699c704a2f9b",
          name: "PO_SEIREN TSV",
          type: "profile.flatfile",
        },
      ],
      agentCommandConfigured: true,
    });

    const profileTarget = plan.proposedComponents.find((component) => component.name === "PO_SEIREN TSV");
    expect(profileTarget?.action).toBe("reuse");
    expect(profileTarget?.matchedBoomiComponentId).toBe("baf8877c-7969-4921-9e34-699c704a2f9b");
    expect(plan.warnings).toContain("1 imported component reference(s) had non-Boomi-looking IDs and were not used as update targets.");
  });
});

describe("boomi-companion-v3 agent command", () => {
  const previousCommand = process.env.BOOMI_HELPER_COMPANION_AGENT_COMMAND;
  const previousTimeout = process.env.BOOMI_HELPER_COMPANION_AGENT_TIMEOUT_MS;

  beforeEach(() => {
    mocks.spawn.mockReset();
    mocks.recordCompanionResult.mockReset();
    mocks.recordCompanionResult.mockResolvedValue(undefined);
    process.env.BOOMI_HELPER_COMPANION_AGENT_COMMAND = "companion-agent --workspace {workspace} --prompt {prompt} --plan {plan}";
    process.env.BOOMI_HELPER_COMPANION_AGENT_TIMEOUT_MS = "5000";
  });

  afterEach(() => {
    if (previousCommand === undefined) {
      delete process.env.BOOMI_HELPER_COMPANION_AGENT_COMMAND;
    } else {
      process.env.BOOMI_HELPER_COMPANION_AGENT_COMMAND = previousCommand;
    }
    if (previousTimeout === undefined) {
      delete process.env.BOOMI_HELPER_COMPANION_AGENT_TIMEOUT_MS;
    } else {
      process.env.BOOMI_HELPER_COMPANION_AGENT_TIMEOUT_MS = previousTimeout;
    }
    COMPANION_V3_RUNS.clear();
    removeWorkspace("unit-v3-agent");
  });

  it("parses quoted commands and appends the prompt path when no placeholder is present", () => {
    expect(parseAgentCommand("codex exec --model 'gpt test'")).toEqual(["codex", "exec", "--model", "gpt test"]);

    const command = buildAgentCommand("codex exec", {
      workspaceDir: "/tmp/workspace",
      promptPath: "/tmp/workspace/COMPANION_AGENT_PROMPT.md",
      planPath: "/tmp/workspace/COMPANION_AGENT_RUN_PLAN.json",
    });

    expect(command.command).toBe("codex");
    expect(command.args).toEqual(["exec", "/tmp/workspace/COMPANION_AGENT_PROMPT.md"]);
  });

  it("redacts configured secrets and credential-like log patterns", () => {
    const redacted = redactCompanionText(
      "secret-token\nAuthorization: Bearer abc123\nBOOMI_USERNAME=real-user",
      ["secret-token"],
    );

    expect(redacted).not.toContain("secret-token");
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("real-user");
    expect(redacted).toContain("[REDACTED]");
  });

  it("starts the approved local agent without shell interpolation and deletes the temp env file", async () => {
    const spec = buildBoomiBuildSpec(sampleProject);
    const workspace = buildCompanionV3Workspace({
      runId: "unit-v3-agent",
      packageId: "pkg-v3",
      spec,
      connection,
    });
    const plan = buildCompanionAgentRunPlan({
      runId: "unit-v3-agent",
      packageId: "pkg-v3",
      projectId: sampleProject.id,
      spec,
      connection,
      targetFolder: { name: "/Boomi Helper", status: "found", folderId: "folder-1" },
      searchRecords: [],
      agentCommandConfigured: true,
    });
    const emitter = new BufferedV3Emitter();
    const logs: Array<{ stream: string; text: string }> = [];
    emitter.on("log", (log) => logs.push(log as { stream: string; text: string }));

    const run: StoredV3Run = {
      runId: "unit-v3-agent",
      packageId: "pkg-v3",
      projectId: sampleProject.id,
      workspaceDir: workspace.dir,
      promptPath: workspace.promptPath,
      planPath: workspace.planPath,
      envPath: workspace.envPath,
      keepWorkspace: false,
      plan,
      secrets: ["secret-token", "real-user"],
      status: "approval_required",
      emitter,
    };
    COMPANION_V3_RUNS.set(run.runId, run);

    mocks.spawn.mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      setTimeout(() => {
        proc.stdout.emit("data", Buffer.from("secret-token created component\n"));
        proc.stderr.emit("data", Buffer.from("Authorization: Bearer abc123\n"));
        const resultPath = path.join(workspace.dir, "COMPANION_RESULT_TEMPLATE.json");
        const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
        result.runTimestamp = new Date().toISOString();
        result.agentTool = "test-agent";
        fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
        proc.emit("close", 0);
      }, 0);
      return proc;
    });

    const complete = new Promise<void>((resolve) => emitter.once("complete", () => resolve()));
    const approved = await approveCompanionV3Run("pkg-v3", "unit-v3-agent");
    await complete;

    expect(approved.status).toBe("agent_running");
    expect(mocks.spawn).toHaveBeenCalledWith(
      "companion-agent",
      [
        "--workspace",
        workspace.dir,
        "--prompt",
        workspace.promptPath,
        "--plan",
        workspace.planPath,
      ],
      expect.objectContaining({
        cwd: workspace.dir,
        shell: false,
        env: expect.objectContaining({
          BOOMI_HELPER_COMPANION_WORKSPACE: workspace.dir,
          BOOMI_HELPER_COMPANION_PROMPT: workspace.promptPath,
          BOOMI_HELPER_COMPANION_PLAN: workspace.planPath,
        }),
      }),
    );
    expect(logs.map((log) => log.text).join("")).not.toContain("secret-token");
    expect(logs.map((log) => log.text).join("")).not.toContain("abc123");
    expect(fs.existsSync(workspace.envPath)).toBe(false);
    expect(mocks.recordCompanionResult).toHaveBeenCalledWith("pkg-v3", expect.any(Object), "agent_completed");
  });

  it("cancels a running local agent process", async () => {
    const spec = buildBoomiBuildSpec(sampleProject);
    const workspace = buildCompanionV3Workspace({
      runId: "unit-v3-agent",
      packageId: "pkg-v3",
      spec,
      connection,
    });
    const plan = buildCompanionAgentRunPlan({
      runId: "unit-v3-agent",
      packageId: "pkg-v3",
      projectId: sampleProject.id,
      spec,
      connection,
      targetFolder: { name: "/Boomi Helper", status: "found", folderId: "folder-1" },
      searchRecords: [],
      agentCommandConfigured: true,
    });
    const emitter = new BufferedV3Emitter();
    const run: StoredV3Run = {
      runId: "unit-v3-agent",
      packageId: "pkg-v3",
      projectId: sampleProject.id,
      workspaceDir: workspace.dir,
      promptPath: workspace.promptPath,
      planPath: workspace.planPath,
      envPath: workspace.envPath,
      keepWorkspace: false,
      plan,
      secrets: ["secret-token"],
      status: "approval_required",
      emitter,
    };
    COMPANION_V3_RUNS.set(run.runId, run);

    const kill = vi.fn();
    mocks.spawn.mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = kill.mockImplementation(() => {
        setTimeout(() => proc.emit("close", null, "SIGTERM"), 0);
        return true;
      });
      return proc;
    });

    const complete = new Promise<void>((resolve) => emitter.once("complete", () => resolve()));
    await approveCompanionV3Run("pkg-v3", "unit-v3-agent");
    cancelCompanionV3Run("pkg-v3", "unit-v3-agent");
    await complete;

    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(run.status).toBe("agent_failed");
    expect(run.cancelRequested).toBe(true);
    expect(fs.existsSync(workspace.envPath)).toBe(false);
  });

  it("fails the run when the agent exits without writing a populated result", async () => {
    const spec = buildBoomiBuildSpec(sampleProject);
    const workspace = buildCompanionV3Workspace({
      runId: "unit-v3-agent",
      packageId: "pkg-v3",
      spec,
      connection,
    });
    const plan = buildCompanionAgentRunPlan({
      runId: "unit-v3-agent",
      packageId: "pkg-v3",
      projectId: sampleProject.id,
      spec,
      connection,
      targetFolder: { name: "/Boomi Helper", status: "found", folderId: "folder-1" },
      searchRecords: [],
      agentCommandConfigured: true,
    });
    const emitter = new BufferedV3Emitter();
    const run: StoredV3Run = {
      runId: "unit-v3-agent",
      packageId: "pkg-v3",
      projectId: sampleProject.id,
      workspaceDir: workspace.dir,
      promptPath: workspace.promptPath,
      planPath: workspace.planPath,
      envPath: workspace.envPath,
      keepWorkspace: false,
      plan,
      secrets: [],
      status: "approval_required",
      emitter,
    };
    COMPANION_V3_RUNS.set(run.runId, run);

    mocks.spawn.mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      setTimeout(() => proc.emit("close", 0), 0);
      return proc;
    });

    const complete = new Promise<unknown>((resolve) => emitter.once("complete", resolve));
    await approveCompanionV3Run("pkg-v3", "unit-v3-agent");
    const summary = await complete;

    expect(run.status).toBe("agent_failed");
    expect(summary).toMatchObject({ ok: false, status: "agent_failed" });
    expect(mocks.recordCompanionResult).toHaveBeenCalledWith(
      "pkg-v3",
      expect.objectContaining({
        errors: ["Agent exited successfully but did not write a populated COMPANION_RESULT_TEMPLATE.json."],
      }),
      "agent_failed",
    );
  });
});
