import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

const SCRIPTS_DIR = path.resolve(process.cwd(), "boomi-companion-scripts");
import {
  BRIDGE_EVENT_EMITTERS,
  removeEmitter,
  runBuildPipeline,
  type PipelineStep,
} from "@/lib/boomi-bridge-pipeline";
import type {
  BoomiBuildSpec,
  BoomiConnection,
} from "@/lib/domain";

const SAMPLE_SPEC: BoomiBuildSpec = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  sourceApp: "Boomi Helper Suite",
  project: {
    processId: "TEST-001",
    name: "Test Integration",
    description: "A test integration",
    sourceSystem: "TestSource",
    destinationSystem: "TestDest",
    status: "Ready for Sandbox",
    folder: "/Test/Folder",
    owner: "tester",
    localProjectId: "proj-1",
  },
  target: {
    goal: "Integrate TestSource to TestDest",
    integrationPattern: "Batch import",
  },
  endpoints: [
    {
      localEndpointId: "ep-1",
      name: "Source Endpoint",
      role: "source",
      connectorType: "Disk",
      profileType: "Flat File",
      format: "CSV",
      purpose: "Read input files",
      connectionInfo: "Local disk",
    },
    {
      localEndpointId: "ep-2",
      name: "Dest Endpoint",
      role: "destination",
      connectorType: "Disk",
      profileType: "JSON",
      format: "JSON Array",
      purpose: "Write output files",
      connectionInfo: "Local disk",
    },
  ],
  profiles: [
    {
      localProfileId: "prof-1",
      name: "Source Profile",
      role: "source",
      type: "Flat File",
      format: "CSV",
      fields: [
        {
          localFieldId: "f-1",
          name: "id",
          dataType: "character",
          required: true,
          keyField: true,
          ordinal: 1,
        },
      ],
    },
    {
      localProfileId: "prof-2",
      name: "Dest Profile",
      role: "destination",
      type: "JSON",
      format: "JSON Array",
      fields: [
        {
          localFieldId: "f-2",
          name: "id",
          dataType: "character",
          required: true,
          keyField: true,
          ordinal: 1,
        },
      ],
    },
  ],
  mappingSets: [
    {
      localMappingSetId: "ms-1",
      name: "Test Map",
      sourceProfileRef: "Source Profile",
      destinationProfileRef: "Dest Profile",
      direction: "source_to_destination",
      status: "Ready for Boomi",
      rules: [
        {
          localRuleId: "r-1",
          destinationFieldId: "f-2",
          sourceFieldId: "f-1",
          sourceFieldName: "id",
          destinationFieldName: "id",
          mappingType: "direct",
          reviewed: true,
        },
      ],
      transformNodes: [],
    },
  ],
  processFlows: [
    {
      localFlowId: "flow-1",
      name: "Main Process",
      nodes: [
        {
          localNodeId: "n-1",
          type: "start",
          label: "Start",
          description: "Process start",
          position: { x: 0, y: 0 },
        },
        {
          localNodeId: "n-2",
          type: "map",
          label: "Transform",
          description: "Map data",
          position: { x: 100, y: 0 },
        },
        {
          localNodeId: "n-3",
          type: "end",
          label: "End",
          description: "Process end",
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        {
          localEdgeId: "e-1",
          source: "n-1",
          target: "n-2",
        },
        {
          localEdgeId: "e-2",
          source: "n-2",
          target: "n-3",
        },
      ],
    },
  ],
  fmdSections: [],
  importedBoomiContext: { components: [], dependencyNotes: [] },
  readiness: { checks: [], overallStatus: "ready" },
  acceptanceCriteria: ["All fields mapped"],
  openQuestions: [],
};

let mockExecFileResults: Array<{
  stdout: string;
  stderr: string;
  error?: Error;
}> = [];

vi.mock("child_process", () => ({
  execFile: vi.fn(
    (
      _scriptPath: string,
      _args: string[],
      _opts: Record<string, unknown>,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const result = mockExecFileResults.shift();
      if (!result) {
        setTimeout(() => callback(null, "OK", ""), 5);
      } else {
        setTimeout(
          () => callback(result.error ?? null, result.stdout, result.stderr),
          5,
        );
      }
      return { kill: vi.fn() } as unknown as ReturnType<typeof import("child_process").execFile>;
    },
  ),
}));

const mockRecordResult = vi.fn();
vi.mock("@/lib/boomi-companion-mutations", () => ({
  recordCompanionResult: (...args: unknown[]) => mockRecordResult(...args),
}));

const SAMPLE_CONNECTION: BoomiConnection & {
  decryptedApiUsername?: string;
  decryptedApiToken?: string;
} = {
  id: "conn-1",
  accountId: "TEST-ACCT",
  environmentName: "Sandbox",
  baseUrl: "https://api.boomi.com",
  authMode: "Basic API Token",
  apiUsername: "testuser",
  apiPassword: "encrypted-token",
  mode: "sandbox",
  createdAt: new Date().toISOString(),
  decryptedApiUsername: "testuser",
  decryptedApiToken: "test-token-123",
};

beforeEach(() => {
  mockExecFileResults = [];
  mockRecordResult.mockReset();
  mockRecordResult.mockResolvedValue({});
  if (!fs.existsSync(SCRIPTS_DIR)) {
    fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  }
  const checkScript = path.join(SCRIPTS_DIR, "boomi-env-check.sh");
  if (!fs.existsSync(checkScript)) {
    fs.writeFileSync(checkScript, "#!/bin/bash\necho OK", "utf8");
    fs.chmodSync(checkScript, 0o755);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildWorkspace", () => {
  it("creates workspace directory with .env and active-development structure", async () => {
    const { buildWorkspace, cleanWorkspace } = await import(
      "@/lib/boomi-bridge-workspace"
    );
    const packageId = "test-pkg-ws-" + Date.now();
    const workspace = buildWorkspace(packageId, SAMPLE_SPEC, SAMPLE_CONNECTION);

    expect(fs.existsSync(workspace.dir)).toBe(true);
    expect(fs.existsSync(path.join(workspace.dir, ".env"))).toBe(true);

    const envContent = fs.readFileSync(path.join(workspace.dir, ".env"), "utf8");
    expect(envContent).toContain("BOOMI_API_URL=https://api.boomi.com");
    expect(envContent).toContain("BOOMI_USERNAME=testuser");
    expect(envContent).toContain("BOOMI_API_TOKEN=test-token-123");
    expect(envContent).toContain("BOOMI_ACCOUNT_ID=TEST-ACCT");
    expect(envContent).toContain("BOOMI_TARGET_FOLDER=/Test/Folder");

    const activeDev = path.join(workspace.dir, "active-development");
    expect(fs.existsSync(activeDev)).toBe(true);

    for (const entry of workspace.entries) {
      const fullPath = path.join(workspace.dir, entry.relativePath);
      expect(fs.existsSync(fullPath)).toBe(true);
    }

    const xmlEntries = workspace.entries.filter((e) =>
      e.relativePath.endsWith(".xml"),
    );
    expect(xmlEntries.length).toBeGreaterThan(0);

    cleanWorkspace(workspace.dir);
    expect(fs.existsSync(workspace.dir)).toBe(false);
  });

  it("cleanWorkspace removes non-existent dirs without error", async () => {
    const { cleanWorkspace } = await import("@/lib/boomi-bridge-workspace");
    expect(() =>
      cleanWorkspace("/tmp/nonexistent-boomi-workspace-xyz"),
    ).not.toThrow();
  });
});

describe("runBuildPipeline", () => {
  it("emits progress events on completion", async () => {
    const { EventEmitter } = await import("events");
    const packageId = "test-pkg-pl-" + Date.now();

    mockExecFileResults = [
      { stdout: "BOOMI_API_URL: SET\nBOOMI_USERNAME: SET\nBOOMI_API_TOKEN: SET\nBOOMI_ACCOUNT_ID: SET\nBOOMI_ENVIRONMENT_ID: SET\nBOOMI_TARGET_FOLDER: SET\nBOOMI_VERIFY_SSL: SET", stderr: "" },
      { stdout: "Folder created: /Test/Folder", stderr: "" },
      { stdout: "Created profile Source Profile\ncomponent id: 11111111-1111-1111-1111-111111111111", stderr: "" },
      { stdout: "Created profile Dest Profile\ncomponent id: 22222222-2222-2222-2222-222222222222", stderr: "" },
      { stdout: "Created connection Source Endpoint\ncomponent id: 33333333-3333-3333-3333-333333333333", stderr: "" },
      { stdout: "Created connection Dest Endpoint\ncomponent id: 44444444-4444-4444-4444-444444444444", stderr: "" },
      { stdout: "Created operation Source Endpoint Operation\ncomponent id: 55555555-5555-5555-5555-555555555555", stderr: "" },
      { stdout: "Created operation Dest Endpoint Operation\ncomponent id: 66666666-6666-6666-6666-666666666666", stderr: "" },
      { stdout: "Created map Test Map\ncomponent id: 77777777-7777-7777-7777-777777777777", stderr: "" },
      { stdout: "Created process Main Process\ncomponent id: 88888888-8888-8888-8888-888888888888", stderr: "" },
      { stdout: "Pushed connection Source Endpoint", stderr: "" },
      { stdout: "Pushed connection Dest Endpoint", stderr: "" },
      { stdout: "Pushed operation Source Endpoint Operation", stderr: "" },
      { stdout: "Pushed operation Dest Endpoint Operation", stderr: "" },
      { stdout: "Pushed map Test Map", stderr: "" },
      { stdout: "Pushed process Main Process", stderr: "" },
      { stdout: "Deploy skipped", stderr: "" },
      { stdout: "Test pending", stderr: "" },
    ];

    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);
    BRIDGE_EVENT_EMITTERS.set(packageId, emitter);

    const progressSteps: PipelineStep[] = [];
    let completeOrResultFired = false;

    const pipelineDone = new Promise<void>((resolve) => {
      emitter.on("progress", (step: PipelineStep) => progressSteps.push(step));
      emitter.on("complete", () => { completeOrResultFired = true; });
      emitter.on("result", () => { completeOrResultFired = true; resolve(); });
      emitter.on("error", () => { resolve(); });
    });

    runBuildPipeline({
      packageId,
      spec: SAMPLE_SPEC,
      connection: SAMPLE_CONNECTION,
      approveDeploy: false,
      keepWorkspace: false,
    }).catch(() => {});

    await pipelineDone;

    expect(progressSteps.length).toBeGreaterThan(0);
    const verifySteps = progressSteps.filter((s) => s.status === "ok");
    expect(verifySteps.length).toBeGreaterThan(0);
    expect(completeOrResultFired).toBe(true);
    expect(mockRecordResult).toHaveBeenCalled();

    removeEmitter(packageId);
  }, 15000);

  it("aborts pipeline on step failure", async () => {
    const { EventEmitter } = await import("events");
    const packageId = "test-pkg-fail-" + Date.now();

    mockExecFileResults = [
      { stdout: "All set", stderr: "" },
      { stdout: "", stderr: "Folder creation failed: permission denied", error: Object.assign(new Error("Command failed"), { code: 1 }) },
    ];

    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);
    BRIDGE_EVENT_EMITTERS.set(packageId, emitter);

    const progressSteps: PipelineStep[] = [];
    const pipelineDone = new Promise<void>((resolve) => {
      emitter.on("progress", (step: PipelineStep) => progressSteps.push(step));
      emitter.on("complete", () => resolve());
      emitter.on("result", () => resolve());
      emitter.on("error", () => resolve());
    });

    runBuildPipeline({
      packageId,
      spec: SAMPLE_SPEC,
      connection: SAMPLE_CONNECTION,
      approveDeploy: false,
      keepWorkspace: false,
    }).catch(() => {});

    await pipelineDone;

    const failedSteps = progressSteps.filter((s) => s.status === "failed");
    expect(failedSteps.length).toBeGreaterThan(0);

    removeEmitter(packageId);
  }, 15000);
});
