import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { companionResultSchema } from "@/lib/boomi-companion-schemas";
import { isLegacyPublishEnabled } from "@/lib/boomi-companion-mutations";
import { GET as getLatestPackage, POST as createPackage } from "@/app/api/boomi/companion/packages/route";
import { GET as getPackage } from "@/app/api/boomi/companion/packages/[packageId]/route";
import { POST as recordResult } from "@/app/api/boomi/companion/packages/[packageId]/result/route";
import { POST as publishRoute } from "@/app/api/boomi/publish/route";
import { POST as rollbackRoute } from "@/app/api/boomi/publish/rollback/route";
import { POST as runPackage } from "@/app/api/boomi/companion/packages/[packageId]/run/route";

function jsonRequest(method: string, body: unknown) {
  return new Request("http://localhost/test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function params(values: Record<string, string>) {
  return Promise.resolve(values);
}

describe("companion integration tests", () => {
  let projectId = "";

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        processId: `companion-test-${Date.now()}`,
        name: "Companion Test Project",
        description: "Test project for companion integration",
        sourceSystem: "TestSource",
        destinationSystem: "TestDest",
        status: "Draft",
        owner: "Test",
      },
    });
    projectId = project.id;

    await prisma.profile.create({
      data: {
        id: "comp-test-src",
        projectId,
        name: "Source CSV",
        role: "source",
        type: "Flat File",
        format: "CSV",
      },
    });
    await prisma.profile.create({
      data: {
        id: "comp-test-dst",
        projectId,
        name: "Dest JSON",
        role: "destination",
        type: "JSON",
        format: "JSON",
      },
    });
    await prisma.profileField.create({
      data: {
        id: "comp-test-f1",
        profileId: "comp-test-src",
        name: "source_field",
        dataType: "String",
        ordinal: 1,
      },
    });
    await prisma.profileField.create({
      data: {
        id: "comp-test-f2",
        profileId: "comp-test-dst",
        name: "dest_field",
        dataType: "String",
        required: true,
        ordinal: 1,
      },
    });
    await prisma.mappingSet.create({
      data: {
        id: "comp-test-ms",
        projectId,
        name: "Test Map",
        sourceProfileId: "comp-test-src",
        destinationProfileId: "comp-test-dst",
        direction: "inbound",
        status: "Ready for Boomi",
      },
    });
    await prisma.mappingRule.create({
      data: {
        id: "comp-test-rule",
        mappingSetId: "comp-test-ms",
        sourceFieldId: "comp-test-f1",
        destinationFieldId: "comp-test-f2",
        mappingType: "direct",
        reviewed: true,
      },
    });
    await prisma.processFlow.create({
      data: {
        id: "comp-test-flow",
        projectId,
        name: "Main",
        nodesJson: JSON.stringify([{ id: "n1", type: "start", label: "Start", description: "", position: { x: 0, y: 0 } }]),
        edgesJson: JSON.stringify([]),
      },
    });
    await prisma.fmdSection.create({
      data: {
        id: "comp-test-fmd",
        projectId,
        title: "Overview",
        sectionType: "overview",
        contentJson: JSON.stringify({ summary: "Test integration" }),
        sortOrder: 1,
      },
    });
    await prisma.endpoint.create({
      data: {
        id: "comp-test-ep1",
        projectId,
        name: "Source EP",
        role: "source",
        connectorType: "HTTP",
        profileType: "Flat File",
        format: "CSV",
        purpose: "Test",
        connectionInfo: "http://test",
      },
    });
    await prisma.endpoint.create({
      data: {
        id: "comp-test-ep2",
        projectId,
        name: "Dest EP",
        role: "destination",
        connectorType: "HTTP",
        profileType: "JSON",
        format: "JSON",
        purpose: "Test",
        connectionInfo: "http://test",
      },
    });
    await prisma.boomiComponentDraft.create({
      data: {
        id: "comp-test-draft",
        projectId,
        componentId: "mock-map-001",
        componentType: "transform.map",
        componentName: "Test Map",
        proposedXml: "<Component><Map/></Component>",
        diff: "+ new",
        validationStatus: "Needs template",
      },
    });
  });

  afterAll(async () => {
    if (projectId) {
      await prisma.project.delete({ where: { id: projectId } }).catch(() => {});
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BOOMI_HELPER_ENABLE_LEGACY_XML_PUBLISH;
  });

  // WS10#6: API route tests for package generation
  describe("package generation routes", () => {
    it("POST /api/boomi/companion/packages creates a package", async () => {
      const res = await createPackage(jsonRequest("POST", { projectId }));
      expect(res.status).toBe(201);

      const body = await res.json() as { packageId: string; manifest: { fileCount: number }; readiness: { overallStatus: string } };
      expect(body.packageId).toBeTruthy();
      expect(body.manifest.fileCount).toBeGreaterThan(0);
      expect(body.readiness.overallStatus).toBeTruthy();
    });

    it("POST /api/boomi/companion/packages returns package even without projectId (uses fallback)", async () => {
      const res = await createPackage(jsonRequest("POST", {}));
      // Without a projectId, falls back to sample project
      expect(res.status).toBe(201);
    });

    it("GET /api/boomi/companion/packages/[packageId] returns metadata", async () => {
      const createRes = await createPackage(jsonRequest("POST", { projectId }));
      const { packageId } = await createRes.json() as { packageId: string };

      const res = await getPackage(new Request("http://localhost/test"), { params: params({ packageId }) });
      expect(res.status).toBe(200);

      const body = await res.json() as { status: string; manifest: { fileCount: number }; readiness: { overallStatus: string } };
      expect(body.status).toBe("ready");
      expect(body.manifest.fileCount).toBeGreaterThan(0);
    });

    it("GET /api/boomi/companion/packages returns the latest package for a project", async () => {
      const createRes = await createPackage(jsonRequest("POST", { projectId }));
      const { packageId } = await createRes.json() as { packageId: string };

      const res = await getLatestPackage(new Request(`http://localhost/test?projectId=${projectId}`));
      expect(res.status).toBe(200);

      const body = await res.json() as { package: { packageId: string; manifest: { fileCount: number } } | null };
      expect(body.package?.packageId).toBe(packageId);
      expect(body.package?.manifest.fileCount).toBeGreaterThan(0);
    });

    it("GET /api/boomi/companion/packages/[packageId] returns 404 for missing", async () => {
      const res = await getPackage(new Request("http://localhost/test"), { params: params({ packageId: "nonexistent" }) });
      expect(res.status).toBe(404);
    });
  });

  // /run and ?action=status tests
  describe("/run and ?action=status", () => {
    it("GET ?action=status returns run history structure", async () => {
      const createRes = await createPackage(jsonRequest("POST", { projectId }));
      const { packageId } = await createRes.json() as { packageId: string };

      const req = new Request(`http://localhost/test?action=status`);
      const res = await getPackage(req, { params: params({ packageId }) });
      expect(res.status).toBe(200);

      const body = await res.json() as { packageId: string; status: string; runCount: number; runs: Array<{ id: string }> };
      expect(body.packageId).toBe(packageId);
      expect(typeof body.runCount).toBe("number");
      expect(Array.isArray(body.runs)).toBe(true);
    });

    it("POST /run returns 400 without connectionId", async () => {
      const createRes = await createPackage(jsonRequest("POST", { projectId }));
      const { packageId } = await createRes.json() as { packageId: string };

      const res = await runPackage(
        jsonRequest("POST", {}),
        { params: params({ packageId }) },
      );
      expect(res.status).toBe(400);

      const body = await res.json() as { error: string; detail?: string };
      expect(body.error).toContain("connection");
    });

    it("POST /run returns 404 for nonexistent package", async () => {
      const res = await runPackage(
        jsonRequest("POST", {}),
        { params: params({ packageId: "nonexistent" }) },
      );
      expect(res.status).toBe(404);
    });
  });

  // WS10#8: Result recording validation tests
  describe("result recording validation", () => {
    it("POST result with valid JSON succeeds", async () => {
      const createRes = await createPackage(jsonRequest("POST", { projectId }));
      const { packageId } = await createRes.json() as { packageId: string };

      const validResult = {
        schemaVersion: "1.0",
        packageId,
        runTimestamp: "2026-05-31T00:00:00Z",
        agentTool: "claude-code",
        components: { created: [], updated: [], reused: [] },
        deployments: [],
        tests: [],
        warnings: [],
        errors: [],
        openFollowUps: [],
      };

      const res = await recordResult(
        jsonRequest("POST", { result: validResult }),
        { params: params({ packageId }) },
      );
      expect(res.status).toBe(201);

      const body = await res.json() as { recorded: boolean };
      expect(body.recorded).toBe(true);
    });

    it("POST result with invalid JSON returns 400", async () => {
      const createRes = await createPackage(jsonRequest("POST", { projectId }));
      const { packageId } = await createRes.json() as { packageId: string };

      const invalidResult = { schemaVersion: "wrong" };
      const res = await recordResult(
        jsonRequest("POST", { result: invalidResult }),
        { params: params({ packageId }) },
      );
      expect(res.status).toBe(400);
    });

    it("POST result without result field returns 400", async () => {
      const createRes = await createPackage(jsonRequest("POST", { projectId }));
      const { packageId } = await createRes.json() as { packageId: string };

      const res = await recordResult(
        jsonRequest("POST", { notResult: true }),
        { params: params({ packageId }) },
      );
      expect(res.status).toBe(400);
    });

    it("Zod schema validates correct CompanionResult shape", () => {
      const valid = {
        schemaVersion: "1.0",
        packageId: "pkg-1",
        runTimestamp: "2026-05-31T00:00:00Z",
        agentTool: "test",
        components: { created: [], updated: [], reused: [] },
        deployments: [],
        tests: [],
        warnings: [],
        errors: [],
        openFollowUps: [],
      };
      expect(companionResultSchema.safeParse(valid).success).toBe(true);
    });

    it("Zod schema rejects missing required fields", () => {
      const invalid = { schemaVersion: "1.0" };
      const parsed = companionResultSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it("Zod schema validates component arrays", () => {
      const valid = {
        schemaVersion: "1.0",
        packageId: "pkg-1",
        runTimestamp: "2026-05-31T00:00:00Z",
        agentTool: "test",
        components: {
          created: [{
            componentId: "comp-1",
            componentName: "Test Component",
            componentType: "transform.map",
            action: "created",
            localAppEntityId: "draft-1",
          }],
          updated: [],
          reused: [],
        },
        deployments: [{ status: "deployed", environmentId: "env-1" }],
        tests: [{ name: "smoke", status: "passed" }],
        warnings: [],
        errors: [],
        openFollowUps: [],
      };
      expect(companionResultSchema.safeParse(valid).success).toBe(true);
    });
  });

  // WS10#9: Legacy publish feature-flag tests
  describe("legacy publish feature flag", () => {
    it("returns 410 when feature flag is disabled (default)", async () => {
      expect(isLegacyPublishEnabled()).toBe(false);

      const res = await publishRoute(jsonRequest("POST", {
        projectId,
        connectionId: "any",
        draftId: "any",
      }));
      expect(res.status).toBe(410);

      const body = await res.json() as { error: string };
      expect(body.error).toContain("no longer supported");
    });

    it("allows publish when feature flag is enabled", async () => {
      process.env.BOOMI_HELPER_ENABLE_LEGACY_XML_PUBLISH = "true";
      expect(isLegacyPublishEnabled()).toBe(true);

      const res = await publishRoute(jsonRequest("POST", {
        projectId: "nonexistent",
        connectionId: "any",
        draftId: "any",
      }));
      // Should be a different error (not 410), because project doesn't exist
      expect(res.status).not.toBe(410);
    });
  });

  // WS10#11: Migration/backward compatibility tests
  describe("migration and backward compatibility", () => {
    it("existing legacy tables are intact", async () => {
      const draft = await prisma.boomiComponentDraft.findFirst({
        where: { projectId },
      });
      expect(draft).toBeTruthy();

      const publishEvents = await prisma.boomiPublishEvent.findMany({
        where: { projectId },
      });
      expect(Array.isArray(publishEvents)).toBe(true);
    });

    it("existing project loads without migration data loss", async () => {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          endpoints: true,
          profiles: { include: { fields: true } },
          mappingSets: { include: { rules: true } },
          processFlows: true,
          fmdSections: true,
          boomiDrafts: true,
        },
      });

      expect(project).toBeTruthy();
      expect(project!.name).toBe("Companion Test Project");
      expect(project!.profiles.length).toBeGreaterThanOrEqual(2);
      expect(project!.mappingSets.length).toBeGreaterThanOrEqual(1);
      expect(project!.processFlows.length).toBeGreaterThanOrEqual(1);
      expect(project!.endpoints.length).toBeGreaterThanOrEqual(2);
    });

    it("new BoomiBuildPackage table exists and is queryable", async () => {
      const packages = await prisma.boomiBuildPackage.findMany({
        where: { projectId },
      });
      expect(Array.isArray(packages)).toBe(true);
    });

    it("new BoomiCompanionRunEvent table exists and is queryable", async () => {
      const events = await prisma.boomiCompanionRunEvent.findMany();
      expect(Array.isArray(events)).toBe(true);
    });

    it("project with existing boomiDrafts can generate a package", async () => {
      const res = await createPackage(jsonRequest("POST", { projectId }));
      expect(res.status).toBe(201);

      const body = await res.json() as { packageId: string };
      expect(body.packageId).toBeTruthy();
    });

    it("package generation preserves Japanese text", async () => {
      await prisma.project.update({
        where: { id: projectId },
        data: { name: "テスト統合" },
      });

      const res = await createPackage(jsonRequest("POST", { projectId }));
      expect(res.status).toBe(201);

      const body = await res.json() as { packageId: string };
      const getRes = await getPackage(new Request("http://localhost/test"), { params: params({ packageId: body.packageId }) });
      const json = await getRes.json();
      const str = JSON.stringify(json);
      expect(str).toContain("テスト統合");

      await prisma.project.update({
        where: { id: projectId },
        data: { name: "Companion Test Project" },
      });
    });
  });

  // WS9#5: Rollback also blocked by legacy flag
  describe("rollback feature flag", () => {
    it("returns 410 when legacy publish is disabled (default)", async () => {
      expect(isLegacyPublishEnabled()).toBe(false);

      const res = await rollbackRoute(jsonRequest("POST", {
        projectId,
        connectionId: "any",
        eventId: "any",
      }));
      expect(res.status).toBe(410);

      const body = await res.json() as { error: string };
      expect(body.error).toContain("no longer supported");
    });

    it("proceeds past 410 when legacy publish is enabled", async () => {
      process.env.BOOMI_HELPER_ENABLE_LEGACY_XML_PUBLISH = "true";
      expect(isLegacyPublishEnabled()).toBe(true);

      const res = await rollbackRoute(jsonRequest("POST", {
        projectId: "nonexistent",
        connectionId: "any",
        eventId: "any",
      }));
      // Should fail later (project not found), not at the 410 gate
      expect(res.status).not.toBe(410);
    });
  });

  // WS7: DB-level credential leak test
  describe("db credential leak prevention", () => {
    it("no stored build package contains credentials", async () => {
      const packages = await prisma.boomiBuildPackage.findMany({
        where: { projectId },
      });

      const sensitive = ["apiPassword", "mock-password", "mock-username",
        "apiToken", "Basic", "Authorization", "••••••••"];

      for (const pkg of packages) {
        const combined = pkg.specJson + (pkg.resultJson ?? "") + pkg.manifestJson;
        for (const needle of sensitive) {
          expect(combined, `Package ${pkg.id} leaked "${needle}"`).not.toContain(needle);
        }
      }
    });

    it("no stored build package contains XML components", async () => {
      const packages = await prisma.boomiBuildPackage.findMany({
        where: { projectId },
      });

      for (const pkg of packages) {
        expect(pkg.specJson, `Package ${pkg.id} leaked XML`).not.toContain("<bns:Component");
        expect(pkg.specJson, `Package ${pkg.id} leaked templateXml`).not.toContain("templateXml");
        expect(pkg.specJson, `Package ${pkg.id} leaked proposedXml`).not.toContain("proposedXml");
      }
    });

    it("no stored run event contains credentials", async () => {
      const events = await prisma.boomiCompanionRunEvent.findMany();
      const sensitive = ["apiPassword", "mock-password", "mock-username", "Basic"];

      for (const event of events) {
        for (const needle of sensitive) {
          expect(event.resultJson, `Run event ${event.id} leaked "${needle}"`)
            .not.toContain(needle);
        }
      }
    });
  });
});
