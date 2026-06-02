import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET as getProjects, POST as createProject } from "@/app/api/projects/route";
import { GET as getProject, PATCH as updateProject, DELETE as deleteProject } from "@/app/api/projects/[projectId]/route";
import { POST as createRule } from "@/app/api/mapping-sets/[mappingSetId]/rules/route";
import { PATCH as updateRule } from "@/app/api/mapping-sets/[mappingSetId]/rules/[ruleId]/route";
import { POST as createProfile } from "@/app/api/projects/[projectId]/profiles/route";
import { POST as createField, PUT as importFields } from "@/app/api/profiles/[profileId]/fields/route";
import { PATCH as updateField, DELETE as deleteField } from "@/app/api/profile-fields/[fieldId]/route";
import { POST as createEndpoint } from "@/app/api/projects/[projectId]/endpoints/route";
import { PATCH as updateEndpoint, DELETE as deleteEndpoint } from "@/app/api/endpoints/[endpointId]/route";
import { PATCH as updateProfileRoute, DELETE as deleteProfileRoute } from "@/app/api/profiles/[profileId]/route";
import { PUT as updateConnection } from "@/app/api/boomi/connections/route";
import { prisma } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  prisma: {
    project: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    endpoint: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    profile: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    profileField: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    mappingRule: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    mappingSet: {
      create: vi.fn(),
    },
    boomiConnection: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
  getWorkspaceProject: vi.fn(),
  updateWorkspaceProject: vi.fn(),
  sanitizeProjectForClient: vi.fn((p: Record<string, unknown>) => {
    const project = { ...p } as Record<string, unknown>;
    if (Array.isArray(project.boomiConnections)) {
      project.boomiConnections = project.boomiConnections.map((conn: Record<string, unknown>) => ({
        ...conn,
        apiUsername: "[re-enter credentials]",
        apiPassword: "••••••••",
      }));
    }
    if (Array.isArray(project.boomiPublishEvents)) {
      project.boomiPublishEvents = project.boomiPublishEvents.map((event: Record<string, unknown>) => ({
        ...event,
        requestXml: "",
        responseXml: null,
        hasRequestXml: Boolean(event.requestXml),
        hasResponseXml: Boolean(event.responseXml),
      }));
    }
    return project;
  }),
  scrubPrismaProjectForClient: vi.fn((p: Record<string, unknown>) => ({
    ...p,
    boomiConnections: Array.isArray(p.boomiConnections)
      ? p.boomiConnections.map((conn) => ({
          ...(conn as Record<string, unknown>),
          apiUsername: "[re-enter credentials]",
          apiPassword: "••••••••",
        }))
      : p.boomiConnections,
    boomiPublishEvents: Array.isArray(p.boomiPublishEvents)
      ? p.boomiPublishEvents.map((event) => ({
          ...(event as Record<string, unknown>),
          requestXml: "",
          responseXml: null,
          hasRequestXml: Boolean((event as { requestXml?: string | null }).requestXml),
          hasResponseXml: Boolean((event as { responseXml?: string | null }).responseXml),
        }))
      : p.boomiPublishEvents,
  })),
}));

function mockRequest(jsonBody: unknown) {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jsonBody),
  });
}

function mockPatchRequest(jsonBody: unknown) {
  return new Request("http://localhost/test", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jsonBody),
  });
}

function mockPutRequest(jsonBody: unknown) {
  return new Request("http://localhost/test", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jsonBody),
  });
}

function params(id: string) {
  return Promise.resolve({ projectId: id });
}

function ruleParams(mappingSetId: string, ruleId: string) {
  return Promise.resolve({ mappingSetId, ruleId });
}

function profileParams(profileId: string) {
  return Promise.resolve({ profileId });
}

function endpointParams(endpointId: string) {
  return Promise.resolve({ endpointId });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("projects API routes", () => {
  it("GET returns project list", async () => {
    vi.mocked(prisma.project.findMany).mockResolvedValue([
      { id: "p1", processId: "X1", name: "Demo", sourceSystem: "A", destinationSystem: "B", status: "Draft", owner: "Me", schedule: null, lastExportedAt: null, createdAt: new Date(), updatedAt: new Date() },
    ]);

    const response = await getProjects();
    expect(response.status).toBe(200);
    const data = await response.json() as { projects: unknown[] };
    expect(data.projects).toHaveLength(1);
  });

  it("POST creates a project", async () => {
    vi.mocked(prisma.project.create).mockResolvedValue({
      id: "p-new", processId: "X2", name: "New", description: "", sourceSystem: "A", destinationSystem: "B", status: "Draft", owner: "Me", schedule: null, lastExportedAt: null, createdAt: new Date(), updatedAt: new Date(),
    });

    const response = await createProject(mockRequest({
      processId: "X2", name: "New", sourceSystem: "A", destinationSystem: "B", owner: "Me",
    }));
    expect(response.status).toBe(201);
  });

  it("POST returns 400 for invalid payload", async () => {
    const response = await createProject(mockRequest({}));
    expect(response.status).toBe(400);
  });

  it("GET single project returns 404 when not found", async () => {
    const { getWorkspaceProject } = await import("@/lib/db");
    vi.mocked(getWorkspaceProject).mockResolvedValue({ mode: "fallback" } as never);

    const response = await getProject(mockRequest(null) as never, { params: params("missing") });
    expect(response.status).toBe(404);
  });

  it("GET single project returns project when found", async () => {
    const { getWorkspaceProject } = await import("@/lib/db");
    vi.mocked(getWorkspaceProject).mockResolvedValue({
      id: "p1", processId: "X1", name: "Demo", description: "", sourceSystem: "A", destinationSystem: "B", status: "Draft", owner: "Me", schedule: null, lastExportedAt: null,
      mode: "live", version: 1, endpoints: [], profiles: [], mappingSets: [], processFlows: [], fmdSections: [], boomiConnections: [], boomiDrafts: [], boomiPublishEvents: [],
    } as never);

    const response = await getProject(mockRequest(null) as never, { params: params("p1") });
    expect(response.status).toBe(200);
  });

  it("GET single project sanitizes encrypted credentials in response", async () => {
    const { getWorkspaceProject } = await import("@/lib/db");
    vi.mocked(getWorkspaceProject).mockResolvedValue({
      id: "p2", processId: "X2", name: "Cred Demo", description: "", sourceSystem: "A", destinationSystem: "B",
      status: "Draft", owner: "Me", schedule: null, lastExportedAt: null,
      mode: "live", version: 1, endpoints: [], profiles: [], mappingSets: [], processFlows: [], fmdSections: [],
      boomiConnections: [
        { id: "c1", projectId: "p2", accountId: "acc", environmentName: "Sandbox",
          baseUrl: "https://api.boomi.com", authMode: "Basic API Token",
          apiUsername: "RAW_ENCRYPTED_USERNAME", apiPassword: "RAW_ENCRYPTED_PASSWORD",
          mode: "sandbox", createdAt: new Date().toISOString() },
      ],
      boomiDrafts: [], boomiPublishEvents: [],
    } as never);

    const response = await getProject(mockRequest(null) as never, { params: params("p2") });
    expect(response.status).toBe(200);
    const body = await response.json();
    const conn = body.project.boomiConnections[0];
    expect(conn.apiUsername).not.toBe("RAW_ENCRYPTED_USERNAME");
    expect(conn.apiPassword).not.toBe("RAW_ENCRYPTED_PASSWORD");
    expect(conn.apiPassword).toBe("••••••••");
  });

  it("GET single project trims publish-event XML payloads from the response", async () => {
    const { getWorkspaceProject } = await import("@/lib/db");
    const heavyXml = `<bns:Component>${"x".repeat(20_000)}</bns:Component>`;
    vi.mocked(getWorkspaceProject).mockResolvedValue({
      id: "p3", processId: "X3", name: "Big History", description: "", sourceSystem: "A", destinationSystem: "B",
      status: "Draft", owner: "Me", schedule: null, lastExportedAt: null,
      mode: "live", version: 1, endpoints: [], profiles: [], mappingSets: [], processFlows: [], fmdSections: [],
      boomiConnections: [], boomiDrafts: [],
      boomiPublishEvents: [
        {
          id: "ev1", projectId: "p3", draftId: "d1", connectionId: "c1",
          componentId: "abc", componentName: "Big Map", componentType: "transform.map",
          version: 1, action: "update", requestXml: heavyXml, responseXml: heavyXml,
          status: "success", errorDetail: null, publishedAt: new Date().toISOString(),
        },
      ],
    } as never);

    const response = await getProject(mockRequest(null) as never, { params: params("p3") });
    expect(response.status).toBe(200);
    const body = await response.json();
    const event = body.project.boomiPublishEvents[0];
    // XML bodies must not be in the list-view payload.
    expect(event.requestXml).toBe("");
    expect(event.responseXml).toBeNull();
    // But the UI needs to know whether on-demand fetch will return something.
    expect(event.hasRequestXml).toBe(true);
    expect(event.hasResponseXml).toBe(true);
    // The whole response body must be well under the original 20KB×2 worst case.
    expect(JSON.stringify(body).length).toBeLessThan(5_000);
  });

  it("PATCH updates a project", async () => {
    vi.mocked(prisma.project.update).mockResolvedValue({
      id: "p1", processId: "X1", name: "Updated", description: "New desc", sourceSystem: "A", destinationSystem: "B", status: "Mapping Review", owner: "Me", schedule: null, lastExportedAt: null, createdAt: new Date(), updatedAt: new Date(),
    });

    const response = await updateProject(mockPatchRequest({ name: "Updated" }), { params: params("p1") });
    expect(response.status).toBe(200);
  });

  it("DELETE removes a project", async () => {
    vi.mocked(prisma.project.delete).mockResolvedValue({ id: "p1" });

    const response = await deleteProject(mockRequest(null) as never, { params: params("p1") });
    expect(response.status).toBe(200);
  });
});

describe("mapping rules API routes", () => {
  it("POST creates a rule when no duplicate exists", async () => {
    vi.mocked(prisma.mappingRule.findMany).mockResolvedValue([]);
    vi.mocked(prisma.mappingRule.create).mockResolvedValue({
      id: "r1", mappingSetId: "ms1", destinationFieldId: "dst-1", sourceFieldId: "src-1", mappingType: "direct", expression: null, defaultValue: null, comment: null, qualityStatus: "unchecked", createdAt: new Date(), updatedAt: new Date(),
    });

    const response = await createRule(mockRequest({
      destinationFieldId: "dst-1", sourceFieldId: "src-1", mappingType: "direct",
    }), { params: Promise.resolve({ mappingSetId: "ms1" }) });
    expect(response.status).toBe(201);
  });

  it("POST rejects duplicate destination", async () => {
    vi.mocked(prisma.mappingRule.findMany).mockResolvedValue([
      { id: "r-existing", mappingSetId: "ms1", destinationFieldId: "dst-1", sourceFieldId: "src-1", mappingType: "direct", expression: null, defaultValue: null, comment: null, qualityStatus: "unchecked", createdAt: new Date(), updatedAt: new Date() },
    ]);

    const response = await createRule(mockRequest({
      destinationFieldId: "dst-1", sourceFieldId: "src-2", mappingType: "direct",
    }), { params: Promise.resolve({ mappingSetId: "ms1" }) });
    expect(response.status).toBe(422);
  });

  it("POST rejects function mapping without comment", async () => {
    vi.mocked(prisma.mappingRule.findMany).mockResolvedValue([]);

    const response = await createRule(mockRequest({
      destinationFieldId: "dst-1", sourceFieldId: "src-1", mappingType: "function", expression: "f(x)",
    }), { params: Promise.resolve({ mappingSetId: "ms1" }) });
    expect(response.status).toBe(422);
  });

  it("PATCH updates a rule with existing comment preserved", async () => {
    vi.mocked(prisma.mappingRule.findUnique).mockResolvedValue({
      id: "r1", mappingSetId: "ms1", destinationFieldId: "dst-1", sourceFieldId: "src-1", mappingType: "function", expression: "f(x)", defaultValue: null, comment: "Existing comment", qualityStatus: "unchecked", createdAt: new Date(), updatedAt: new Date(),
    });
    vi.mocked(prisma.mappingRule.findMany).mockResolvedValue([]);
    vi.mocked(prisma.mappingRule.update).mockResolvedValue({
      id: "r1", mappingSetId: "ms1", destinationFieldId: "dst-1", sourceFieldId: "src-2", mappingType: "function", expression: "g(x)", defaultValue: null, comment: "Existing comment", qualityStatus: "unchecked", createdAt: new Date(), updatedAt: new Date(),
    });

    const response = await updateRule(mockPatchRequest({ sourceFieldId: "src-2" }), { params: ruleParams("ms1", "r1") });
    expect(response.status).toBe(200);
  });

  it("PATCH toggles `reviewed` without re-running semantic validation on the rest of the rule", async () => {
    // Regression: a reviewed-only patch used to re-run validateRuleSemantics on
    // the merged rule. If the existing rule had any latent semantic issue (e.g.
    // a function mapping without a comment), the PATCH returned 422 and the
    // optimistic checkbox flickered back to unchecked.
    const existing = {
      id: "r1",
      mappingSetId: "ms1",
      destinationFieldId: "dst-1",
      sourceFieldId: "src-1",
      mappingType: "function" as const,
      expression: "f(x)",
      defaultValue: null,
      comment: null, // intentionally missing — would fail semantic validation
      qualityStatus: "unchecked",
      reviewed: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(prisma.mappingRule.findUnique).mockResolvedValue(existing as never);
    vi.mocked(prisma.mappingRule.update).mockResolvedValue({ ...existing, reviewed: true } as never);

    const response = await updateRule(mockPatchRequest({ reviewed: true }), { params: ruleParams("ms1", "r1") });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.rule.reviewed).toBe(true);
  });

  it("PATCH returns 404 for missing rule", async () => {
    vi.mocked(prisma.mappingRule.findUnique).mockResolvedValue(null);

    const response = await updateRule(mockPatchRequest({ comment: "test" }), { params: ruleParams("ms1", "missing") });
    expect(response.status).toBe(404);
  });
});

describe("profile fields API routes", () => {
  it("POST creates a field with auto ordinal", async () => {
    vi.mocked(prisma.profileField.count).mockResolvedValue(2);
    vi.mocked(prisma.profileField.create).mockResolvedValue({
      id: "f1", profileId: "pf1", name: "test_field", label: null, description: null, dataType: "String", length: null, required: false, keyField: false, format: null, sample: null, ordinal: 3, parentPath: null,
    });

    const response = await createField(mockRequest({ name: "test_field", dataType: "String" }), { params: profileParams("pf1") });
    expect(response.status).toBe(201);
  });

  it("PUT bulk imports fields from CSV", async () => {
    vi.mocked(prisma.profileField.create).mockResolvedValue({
      id: "f1", profileId: "pf1", name: "a", label: null, description: null, dataType: "String", length: null, required: false, keyField: false, format: null, sample: null, ordinal: 1, parentPath: null,
    });

    const response = await importFields(mockPutRequest({
      kind: "csv", payload: "name,type\nfield_a,String",
    }), { params: profileParams("pf1") });
    expect(response.status).toBe(201);
  });

  it("PUT returns 400 for empty payload string", async () => {
    const response = await importFields(mockPutRequest({
      kind: "csv", payload: "",
    }), { params: profileParams("pf1") });
    expect(response.status).toBe(400);
  });

  it("PATCH updates a field", async () => {
    vi.mocked(prisma.profileField.update).mockResolvedValue({
      id: "f1", profileId: "pf1", name: "updated", label: null, description: null, dataType: "String", length: null, required: true, keyField: false, format: null, sample: null, ordinal: 1, parentPath: null,
    });

    const response = await updateField(mockPatchRequest({ required: true }), { params: { fieldId: "f1" } });
    expect(response.status).toBe(200);
  });

  it("DELETE removes a field", async () => {
    vi.mocked(prisma.profileField.delete).mockResolvedValue({ id: "f1" });

    const response = await deleteField(mockRequest(null) as never, { params: { fieldId: "f1" } });
    expect(response.status).toBe(200);
  });
});

describe("endpoints API routes", () => {
  it("POST creates an endpoint", async () => {
    vi.mocked(prisma.endpoint.create).mockResolvedValue({
      id: "ep1", projectId: "p1", name: "Test", role: "source", connectorType: "HTTP", profileType: "JSON", format: "JSON", purpose: "", connectionInfo: "", createdAt: new Date(), updatedAt: new Date(),
    });

    const response = await createEndpoint(mockRequest({
      name: "Test", role: "source", connectorType: "HTTP", profileType: "JSON", format: "JSON",
    }), { params: params("p1") });
    expect(response.status).toBe(201);
  });

  it("PATCH updates an endpoint", async () => {
    vi.mocked(prisma.endpoint.update).mockResolvedValue({
      id: "ep1", projectId: "p1", name: "Updated", role: "source", connectorType: "HTTP", profileType: "JSON", format: "XML", purpose: "", connectionInfo: "", createdAt: new Date(), updatedAt: new Date(),
    });

    const response = await updateEndpoint(mockPatchRequest({ format: "XML" }), { params: endpointParams("ep1") });
    expect(response.status).toBe(200);
  });

  it("DELETE removes an endpoint", async () => {
    vi.mocked(prisma.endpoint.delete).mockResolvedValue({ id: "ep1" });

    const response = await deleteEndpoint(mockRequest(null) as never, { params: endpointParams("ep1") });
    expect(response.status).toBe(200);
  });
});

describe("profiles API routes", () => {
  it("POST creates a profile", async () => {
    vi.mocked(prisma.profile.create).mockResolvedValue({
      id: "pf1", projectId: "p1", name: "Test Profile", role: "source", type: "JSON", format: "JSON", rootPath: null, createdAt: new Date(), updatedAt: new Date(),
    });

    const response = await createProfile(mockRequest({
      name: "Test Profile", role: "source", type: "JSON", format: "JSON",
    }), { params: params("p1") });
    expect(response.status).toBe(201);
  });

  it("PATCH updates a profile", async () => {
    vi.mocked(prisma.profile.update).mockResolvedValue({
      id: "pf1", projectId: "p1", name: "Test Profile", role: "source", type: "JSON", format: "XML", rootPath: null, createdAt: new Date(), updatedAt: new Date(),
    });

    const response = await updateProfileRoute(mockPatchRequest({ format: "XML" }), { params: profileParams("pf1") });
    expect(response.status).toBe(200);
  });

  it("DELETE removes a profile", async () => {
    vi.mocked(prisma.profile.delete).mockResolvedValue({ id: "pf1" });

    const response = await deleteProfileRoute(mockRequest(null) as never, { params: profileParams("pf1") });
    expect(response.status).toBe(200);
  });
});

describe("Boomi connections route", () => {
  it("PUT updates a global connection without projectId", async () => {
    const now = new Date();
    vi.mocked(prisma.boomiConnection.findUnique).mockResolvedValue({
      id: "conn-1",
      accountId: "acct",
      environmentName: "Sandbox",
      baseUrl: "https://api.boomi.com",
      authMode: "Basic API Token",
      apiUsername: "stored-user",
      apiPassword: "stored-token",
      mode: "sandbox",
      createdAt: now,
      updatedAt: now,
    });
    vi.mocked(prisma.boomiConnection.update).mockResolvedValue({
      id: "conn-1",
      accountId: "acct",
      environmentName: "Sandbox",
      baseUrl: "https://api.boomi.com",
      authMode: "Basic API Token",
      apiUsername: "stored-user",
      apiPassword: "stored-token",
      mode: "sandbox",
      createdAt: now,
      updatedAt: now,
    });

    const request = new Request("http://localhost/test", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "conn-1", baseUrl: "https://api.boomi.com" }),
    });
    const response = await updateConnection(request as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.connection.baseUrl).toBe("https://api.boomi.com");
    expect(prisma.boomiConnection.update).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      data: { baseUrl: "https://api.boomi.com" },
    });
  });

  it("PUT with id but no payload fields rejects before reaching the database", async () => {
    const request = new Request("http://localhost/test", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "conn-1" }),
    });
    const response = await updateConnection(request as never);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/no valid fields/i);
    expect(prisma.boomiConnection.findUnique).not.toHaveBeenCalled();
  });
});
