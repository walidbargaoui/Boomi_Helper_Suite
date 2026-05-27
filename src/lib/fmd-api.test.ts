import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as getFmdSections } from "@/app/api/projects/[projectId]/fmd/route";
import { POST as initializeFmd } from "@/app/api/projects/[projectId]/fmd/initialize/route";
import { POST as createFmdSectionRoute } from "@/app/api/projects/[projectId]/fmd/sections/route";
import {
  PATCH as updateFmdSectionRoute,
  DELETE as deleteFmdSectionRoute,
} from "@/app/api/projects/[projectId]/fmd/sections/[sectionId]/route";
import { POST as reorderFmdSectionsRoute } from "@/app/api/projects/[projectId]/fmd/sections/reorder/route";
import { POST as refreshFmdSectionRoute } from "@/app/api/projects/[projectId]/fmd/sections/[sectionId]/refresh/route";
import { POST as validateFmdRoute } from "@/app/api/projects/[projectId]/fmd/validate/route";
import { prisma } from "@/lib/db";
import type { Project } from "@/lib/domain";

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...original,
    prisma: {
      fmdSection: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      project: {
        findUnique: vi.fn(),
      },
      $transaction: vi.fn((promises: Promise<unknown>[]) => Promise.all(promises)),
    },
    getWorkspaceProject: vi.fn(),
  };
});

function mockRequest(jsonBody: unknown, method = "POST") {
  return new Request("http://localhost/test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jsonBody),
  });
}

function mockGetRequest() {
  return new Request("http://localhost/test", { method: "GET" });
}

function mockPatchRequest(jsonBody: unknown) {
  return new Request("http://localhost/test", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jsonBody),
  });
}

function params(projectId: string, sectionId?: string) {
  if (sectionId) {
    return Promise.resolve({ projectId, sectionId });
  }
  return Promise.resolve({ projectId });
}

function makeProject(partial: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    processId: "PROC-001",
    name: "Test Project",
    description: "A test project",
    sourceSystem: "SAP",
    destinationSystem: "Salesforce",
    owner: "Alice",
    schedule: "Daily 02:00",
    status: "Draft",
    endpoints: [],
    profiles: [],
    mappingSets: [],
    processFlows: [],
    fmdSections: [],
    boomiConnections: [],
    boomiDrafts: [],
    boomiPublishEvents: [],
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FMD API routes", () => {
  describe("GET /fmd", () => {
    it("returns sections with completion and registry", async () => {
      vi.mocked(prisma.fmdSection.findMany).mockResolvedValue([
        {
          id: "s1",
          projectId: "proj-1",
          title: "Project Summary",
          sectionType: "projectSummary",
          contentJson: JSON.stringify({ schemaVersion: 1, data: {} }),
          sortOrder: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const response = await getFmdSections(mockGetRequest() as never, { params: params("proj-1") });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.sections).toHaveLength(1);
      expect(data.completion.totalRequired).toBeGreaterThan(0);
      expect(data.registry).toBeInstanceOf(Array);
    });

    it("returns empty sections when none exist", async () => {
      vi.mocked(prisma.fmdSection.findMany).mockResolvedValue([]);

      const response = await getFmdSections(mockGetRequest() as never, { params: params("proj-1") });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.sections).toHaveLength(0);
      expect(data.completion.requiredPresent).toBe(0);
    });
  });

  describe("POST /fmd/initialize", () => {
    it("creates default sections when project exists and no sections exist", async () => {
      vi.mocked(prisma.fmdSection.findMany).mockResolvedValue([]);
      const { getWorkspaceProject } = await import("@/lib/db");
      vi.mocked(getWorkspaceProject).mockResolvedValue(makeProject());
      vi.mocked(prisma.fmdSection.create).mockImplementation(
        async (args: { data: { id?: string; projectId: string; title: string; sectionType: string; contentJson: string; sortOrder: number } }) => ({
          id: args.data.id ?? "new-id",
          projectId: args.data.projectId,
          title: args.data.title,
          sectionType: args.data.sectionType,
          contentJson: args.data.contentJson,
          sortOrder: args.data.sortOrder,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const response = await initializeFmd(mockRequest({ mode: "from-project" }), { params: params("proj-1") });
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.sections.length).toBeGreaterThan(0);
    });

    it("returns 409 when sections already exist", async () => {
      vi.mocked(prisma.fmdSection.findMany).mockResolvedValue([
        {
          id: "s1",
          projectId: "proj-1",
          title: "Existing",
          sectionType: "projectSummary",
          contentJson: "{}",
          sortOrder: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const response = await initializeFmd(mockRequest({ mode: "from-project" }), { params: params("proj-1") });
      expect(response.status).toBe(409);
    });

    it("returns empty sections for blank mode", async () => {
      vi.mocked(prisma.fmdSection.findMany).mockResolvedValue([]);

      const response = await initializeFmd(mockRequest({ mode: "blank" }), { params: params("proj-1") });
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.sections).toHaveLength(0);
    });
  });

  describe("POST /fmd/sections", () => {
    it("creates a single section with explicit sortOrder", async () => {
      vi.mocked(prisma.fmdSection.create).mockResolvedValue({
        id: "s-new",
        projectId: "proj-1",
        title: "New Section",
        sectionType: "projectSummary",
        contentJson: JSON.stringify({ schemaVersion: 1, data: {} }),
        sortOrder: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await createFmdSectionRoute(
        mockRequest({ title: "New Section", sectionType: "projectSummary", sortOrder: 5 }),
        { params: params("proj-1") },
      );
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.section.title).toBe("New Section");
      expect(data.section.sortOrder).toBe(5);
    });

    it("auto-assigns sortOrder when not provided", async () => {
      vi.mocked(prisma.fmdSection.findFirst).mockResolvedValue({
        id: "s-last",
        projectId: "proj-1",
        title: "Last",
        sectionType: "projectSummary",
        contentJson: "{}",
        sortOrder: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(prisma.fmdSection.create).mockResolvedValue({
        id: "s-new",
        projectId: "proj-1",
        title: "New Section",
        sectionType: "projectSummary",
        contentJson: JSON.stringify({ schemaVersion: 1, data: {} }),
        sortOrder: 4,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await createFmdSectionRoute(
        mockRequest({ title: "New Section", sectionType: "projectSummary" }),
        { params: params("proj-1") },
      );
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.section.sortOrder).toBe(4);
    });

    it("returns 400 for invalid sectionType", async () => {
      const response = await createFmdSectionRoute(
        mockRequest({ title: "Bad", sectionType: "invalidType" }),
        { params: params("proj-1") },
      );
      expect(response.status).toBe(400);
    });
  });

  describe("PATCH /fmd/sections/[sectionId]", () => {
    it("updates a section title and content", async () => {
      vi.mocked(prisma.fmdSection.findUnique).mockResolvedValue({
        id: "s1",
        projectId: "proj-1",
        title: "Old Title",
        sectionType: "projectSummary",
        contentJson: JSON.stringify({ schemaVersion: 1, exportEnabled: true, data: {} }),
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(prisma.fmdSection.update).mockResolvedValue({
        id: "s1",
        projectId: "proj-1",
        title: "New Title",
        sectionType: "projectSummary",
        contentJson: JSON.stringify({ schemaVersion: 1, exportEnabled: false, data: {} }),
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await updateFmdSectionRoute(
        mockPatchRequest({ title: "New Title", content: { schemaVersion: 1, exportEnabled: false, data: {} } }),
        { params: params("proj-1", "s1") },
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.section.title).toBe("New Title");
    });

    it("merges partial content fields into existing content", async () => {
      vi.mocked(prisma.fmdSection.findUnique).mockResolvedValue({
        id: "s1",
        projectId: "proj-1",
        title: "Title",
        sectionType: "projectSummary",
        contentJson: JSON.stringify({ schemaVersion: 1, exportEnabled: true, data: {} }),
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(prisma.fmdSection.update).mockResolvedValue({
        id: "s1",
        projectId: "proj-1",
        title: "Title",
        sectionType: "projectSummary",
        contentJson: JSON.stringify({ schemaVersion: 1, exportEnabled: false, data: {} }),
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await updateFmdSectionRoute(
        mockPatchRequest({ exportEnabled: false }),
        { params: params("proj-1", "s1") },
      );
      expect(response.status).toBe(200);
    });

    it("returns 404 for missing section", async () => {
      vi.mocked(prisma.fmdSection.findUnique).mockResolvedValue(null);

      const response = await updateFmdSectionRoute(
        mockPatchRequest({ title: "X" }),
        { params: params("proj-1", "missing") },
      );
      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /fmd/sections/[sectionId]", () => {
    it("deletes an existing section", async () => {
      vi.mocked(prisma.fmdSection.findUnique).mockResolvedValue({
        id: "s1",
        projectId: "proj-1",
        title: "To Delete",
        sectionType: "projectSummary",
        contentJson: "{}",
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(prisma.fmdSection.delete).mockResolvedValue({ id: "s1" } as never);

      const response = await deleteFmdSectionRoute(mockRequest(null, "DELETE") as never, { params: params("proj-1", "s1") });
      expect(response.status).toBe(200);
    });

    it("returns 404 for missing section", async () => {
      vi.mocked(prisma.fmdSection.findUnique).mockResolvedValue(null);

      const response = await deleteFmdSectionRoute(mockRequest(null, "DELETE") as never, { params: params("proj-1", "missing") });
      expect(response.status).toBe(404);
    });
  });

  describe("POST /fmd/sections/reorder", () => {
    it("reorders sections by provided ids", async () => {
      vi.mocked(prisma.fmdSection.findMany).mockResolvedValue([
        { id: "s1" },
        { id: "s2" },
        { id: "s3" },
      ] as never);
      vi.mocked(prisma.fmdSection.update).mockResolvedValue({} as never);

      const response = await reorderFmdSectionsRoute(
        mockRequest({ orderedIds: ["s3", "s1", "s2"] }),
        { params: params("proj-1") },
      );
      expect(response.status).toBe(200);
      expect(prisma.fmdSection.update).toHaveBeenCalledTimes(3);
    });

    it("ignores invalid ids", async () => {
      vi.mocked(prisma.fmdSection.findMany).mockResolvedValue([{ id: "s1" }] as never);
      vi.mocked(prisma.fmdSection.update).mockResolvedValue({} as never);

      const response = await reorderFmdSectionsRoute(
        mockRequest({ orderedIds: ["s1", "invalid"] }),
        { params: params("proj-1") },
      );
      expect(response.status).toBe(200);
      expect(prisma.fmdSection.update).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST /fmd/sections/[sectionId]/refresh", () => {
    it("refreshes a section with derived data", async () => {
      vi.mocked(prisma.fmdSection.findUnique).mockResolvedValue({
        id: "s1",
        projectId: "proj-1",
        title: "Project Summary",
        sectionType: "projectSummary",
        contentJson: JSON.stringify({ schemaVersion: 1, data: {} }),
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const { getWorkspaceProject } = await import("@/lib/db");
      vi.mocked(getWorkspaceProject).mockResolvedValue(makeProject());
      vi.mocked(prisma.fmdSection.update).mockResolvedValue({
        id: "s1",
        projectId: "proj-1",
        title: "Project Summary",
        sectionType: "projectSummary",
        contentJson: JSON.stringify({ schemaVersion: 1, sourceMode: "derived", data: { linkedProcessId: "PROC-001" } }),
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await refreshFmdSectionRoute(
        mockRequest({ resetOverrides: false }),
        { params: params("proj-1", "s1") },
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.section.content.sourceMode).toBe("derived");
    });

    it("returns 404 for missing section", async () => {
      vi.mocked(prisma.fmdSection.findUnique).mockResolvedValue(null);

      const response = await refreshFmdSectionRoute(
        mockRequest({}),
        { params: params("proj-1", "missing") },
      );
      expect(response.status).toBe(404);
    });
  });

  describe("POST /fmd/validate", () => {
    it("returns validation results for a well-formed section with missing required types", async () => {
      vi.mocked(prisma.fmdSection.findMany).mockResolvedValue([
        {
          id: "s1",
          projectId: "proj-1",
          title: "Project Summary",
          sectionType: "projectSummary",
          contentJson: JSON.stringify({
            schemaVersion: 1,
            sourceMode: "derived",
            data: { linkedProcessId: "PROC-001" },
          }),
          sortOrder: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const response = await validateFmdRoute(mockRequest({}), { params: params("proj-1") });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.issues).toHaveLength(1);
      expect(data.issues[0].errors).toHaveLength(0);
      expect(data.requiredMissing.length).toBeGreaterThan(0);
      expect(data.valid).toBe(false);
    });

    it("flags missing required sections", async () => {
      vi.mocked(prisma.fmdSection.findMany).mockResolvedValue([]);

      const response = await validateFmdRoute(mockRequest({}), { params: params("proj-1") });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.valid).toBe(false);
      expect(data.requiredMissing.length).toBeGreaterThan(0);
    });

    it("flags validation errors in section content", async () => {
      vi.mocked(prisma.fmdSection.findMany).mockResolvedValue([
        {
          id: "s1",
          projectId: "proj-1",
          title: "",
          sectionType: "projectSummary",
          contentJson: JSON.stringify({ schemaVersion: 1, data: {} }),
          sortOrder: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const response = await validateFmdRoute(mockRequest({}), { params: params("proj-1") });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.valid).toBe(false);
      expect(data.issues[0].errors.length).toBeGreaterThan(0);
    });
  });
});
