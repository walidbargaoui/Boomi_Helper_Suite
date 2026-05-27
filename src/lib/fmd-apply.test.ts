import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  applyFmdDraft,
  applyRequestSchema,
  categoriesForMode,
  detectFmdConflicts,
  type FmdApplyRequest,
} from "@/lib/fmd-apply";
import type { Project } from "@/lib/domain";

function makeDraft(overrides: Partial<FmdApplyRequest["draft"]> = {}): FmdApplyRequest["draft"] {
  return {
    project: {
      processId: "DEMO042",
      name: "Demo",
      description: "",
      sourceSystem: "SFTP",
      destinationSystem: "Snowflake",
      owner: "QA",
      status: "Draft",
      schedule: undefined,
      confidence: 0.7,
      evidenceRefs: [],
    },
    endpoints: [],
    profiles: [],
    mappingSets: [],
    fmdSections: [],
    warnings: [],
    unresolvedEvidenceRefs: [],
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    processId: "EXIST001",
    name: "Existing",
    description: "",
    sourceSystem: "A",
    destinationSystem: "B",
    status: "Draft",
    owner: "Me",
    schedule: undefined,
    endpoints: [],
    profiles: [],
    mappingSets: [],
    processFlows: [],
    fmdSections: [],
    boomiConnections: [],
    boomiDrafts: [],
    ...overrides,
  };
}

describe("applyRequestSchema", () => {
  it("requires mode and draft", () => {
    expect(applyRequestSchema.safeParse({}).success).toBe(false);
    expect(applyRequestSchema.safeParse({ mode: "merge", draft: makeDraft(), projectId: "proj-1" }).success).toBe(
      true,
    );
  });

  it("accepts create mode without projectId", () => {
    expect(applyRequestSchema.safeParse({ mode: "create", draft: makeDraft() }).success).toBe(true);
  });

  it("rejects unknown mode", () => {
    expect(applyRequestSchema.safeParse({ mode: "wat", draft: makeDraft() }).success).toBe(false);
  });
});

describe("categoriesForMode", () => {
  it("merge / create include everything", () => {
    expect(categoriesForMode("merge")).toEqual({
      metadata: true,
      endpoints: true,
      profiles: true,
      mappingSets: true,
      sections: true,
    });
    expect(categoriesForMode("create")).toEqual({
      metadata: true,
      endpoints: true,
      profiles: true,
      mappingSets: true,
      sections: true,
    });
  });

  it("mapping mode covers profiles + mapping sets only", () => {
    expect(categoriesForMode("mapping")).toEqual({
      metadata: false,
      endpoints: false,
      profiles: true,
      mappingSets: true,
      sections: false,
    });
  });

  it("sections mode covers sections only", () => {
    expect(categoriesForMode("sections")).toEqual({
      metadata: false,
      endpoints: false,
      profiles: false,
      mappingSets: false,
      sections: true,
    });
  });
});

describe("detectFmdConflicts", () => {
  const draft = makeDraft({
    endpoints: [
      {
        name: "ServiceNow",
        role: "destination",
        connectorType: "HTTP",
        profileType: "JSON",
        format: "JSON",
        purpose: "",
        connectionInfo: "",
        confidence: 0.5,
        evidenceRefs: [],
      },
    ],
    profiles: [
      {
        name: "Order",
        role: "source",
        type: "Flat File",
        format: "TSV",
        rootPath: undefined,
        fields: [
          {
            name: "po_no",
            dataType: "String",
            required: true,
            keyField: false,
            ordinal: 1,
            confidence: 0.7,
            evidenceRefs: [],
          },
        ],
        confidence: 0.7,
        evidenceRefs: [],
      },
    ],
    mappingSets: [
      {
        name: "Order to SN",
        sourceProfileName: "Order",
        destinationProfileName: "ServiceNow",
        direction: "source-to-destination",
        status: "Draft",
        rules: [
          {
            destinationFieldName: "u_po_no",
            sourceFieldName: "po_no",
            mappingType: "direct",
            confidence: 0.7,
            evidenceRefs: [],
          },
        ],
        confidence: 0.7,
        evidenceRefs: [],
        warnings: [],
      },
    ],
  });

  it("reports missing-project error for non-create mode without project", () => {
    const conflicts = detectFmdConflicts({ mode: "merge", draft, projectId: "proj-x" });
    expect(conflicts.some((c) => c.type === "missing-project" && c.severity === "error")).toBe(true);
  });

  it("returns empty conflicts for create mode", () => {
    const conflicts = detectFmdConflicts({ mode: "create", draft });
    expect(conflicts).toEqual([]);
  });

  it("flags duplicate endpoints", () => {
    const project = makeProject({
      endpoints: [
        {
          id: "ep-1",
          name: "ServiceNow",
          role: "destination",
          connectorType: "HTTP",
          profileType: "JSON",
          format: "JSON",
          purpose: "",
          connectionInfo: "",
        },
      ],
    });
    const conflicts = detectFmdConflicts({ mode: "merge", draft, projectId: project.id }, project);
    expect(conflicts.some((c) => c.type === "endpoint-duplicate")).toBe(true);
  });

  it("flags duplicate profile and field-type / field-required differences", () => {
    const project = makeProject({
      profiles: [
        {
          id: "pf-1",
          name: "Order",
          role: "source",
          type: "Flat File",
          format: "TSV",
          fields: [
            {
              id: "f-1",
              name: "po_no",
              dataType: "Integer",
              required: false,
              keyField: false,
              ordinal: 1,
            },
          ],
        },
      ],
    });
    const conflicts = detectFmdConflicts({ mode: "merge", draft, projectId: project.id }, project);
    expect(conflicts.some((c) => c.type === "profile-duplicate")).toBe(true);
    expect(conflicts.some((c) => c.type === "field-type")).toBe(true);
    expect(conflicts.some((c) => c.type === "field-required")).toBe(true);
  });

  it("flags duplicate destinations within an existing mapping set", () => {
    const project = makeProject({
      profiles: [
        {
          id: "pf-1",
          name: "Order",
          role: "source",
          type: "Flat File",
          format: "TSV",
          fields: [{ id: "fs-1", name: "po_no", dataType: "String", required: true, keyField: false, ordinal: 1 }],
        },
        {
          id: "pf-2",
          name: "ServiceNow",
          role: "destination",
          type: "JSON",
          format: "JSON",
          fields: [{ id: "fd-1", name: "u_po_no", dataType: "String", required: true, keyField: false, ordinal: 1 }],
        },
      ],
      mappingSets: [
        {
          id: "ms-1",
          name: "Order to SN",
          sourceProfileId: "pf-1",
          destinationProfileId: "pf-2",
          direction: "source-to-destination",
          status: "Draft",
          rules: [
            {
              id: "rule-1",
              destinationFieldId: "fd-1",
              sourceFieldId: "fs-1",
              mappingType: "direct",
            },
          ],
          transformNodes: [],
        },
      ],
    });
    const conflicts = detectFmdConflicts({ mode: "merge", draft, projectId: project.id }, project);
    expect(conflicts.some((c) => c.type === "duplicate-destination")).toBe(true);
  });

  it("flags section-duplicate conflict when a draft section title matches existing", () => {
    const draftWithSections = makeDraft({
      fmdSections: [
        {
          title: "Overview",
          sectionType: "overview",
          sortOrder: 1,
          content: {},
          confidence: 0.6,
          evidenceRefs: [],
        },
      ],
    });
    const project = makeProject({
      fmdSections: [
        {
          id: "sec-1",
          title: "Overview",
          sectionType: "overview",
          content: {},
          sortOrder: 1,
        },
      ],
    });
    const conflicts = detectFmdConflicts({ mode: "merge", projectId: project.id, draft: draftWithSections }, project);
    expect(conflicts.some((c) => c.type === "section-duplicate")).toBe(true);
  });

  it("honors selection filters: nothing selected = no conflicts", () => {
    const project = makeProject({
      endpoints: [
        {
          id: "ep-1",
          name: "ServiceNow",
          role: "destination",
          connectorType: "HTTP",
          profileType: "JSON",
          format: "JSON",
          purpose: "",
          connectionInfo: "",
        },
      ],
    });
    const conflicts = detectFmdConflicts(
      {
        mode: "merge",
        draft,
        projectId: project.id,
        selection: { endpointIndexes: [], profileIndexes: [], mappingSetIndexes: [] },
      },
      project,
    );
    expect(conflicts.length).toBe(0);
  });
});

function buildPrismaApplyMock(initial?: {
  endpoints?: Array<{ id: string; name: string; role: string }>;
  profiles?: Array<{ id: string; name: string; role: string; fields: Array<{ id: string; name: string }> }>;
  mappingSets?: Array<{
    id: string;
    name: string;
    sourceProfileId: string;
    destinationProfileId: string;
    rules: Array<{ id: string; destinationFieldId: string }>;
  }>;
  sections?: Array<{ id: string; sortOrder: number }>;
}) {
  const state = {
    project: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    endpoint: { findMany: vi.fn(), create: vi.fn() },
    profile: { findMany: vi.fn(), create: vi.fn() },
    profileField: { create: vi.fn(), count: vi.fn() },
    mappingSet: { findMany: vi.fn(), create: vi.fn() },
    mappingRule: { create: vi.fn() },
    fmdSection: { findMany: vi.fn(), create: vi.fn() },
  };

  state.project.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve({
      id: where.id,
      description: "current",
      sourceSystem: "A",
      destinationSystem: "B",
      schedule: null,
    }),
  );
  state.project.create.mockImplementation(({ data }: { data: { processId: string } }) =>
    Promise.resolve({ id: "proj-created", ...data }),
  );
  state.project.update.mockResolvedValue({ id: "proj-1" });

  state.endpoint.findMany.mockResolvedValue(initial?.endpoints ?? []);
  state.endpoint.create.mockImplementation(({ data }: { data: object }) =>
    Promise.resolve({ id: `ep-${Math.random()}`, ...data }),
  );

  const profileRows = initial?.profiles ?? [];
  state.profile.findMany.mockResolvedValue(profileRows);
  state.profile.create.mockImplementation(({ data }: { data: object }) =>
    Promise.resolve({ id: `pf-${Math.random()}`, ...data }),
  );

  state.profileField.create.mockImplementation(({ data }: { data: object }) =>
    Promise.resolve({ id: `field-${Math.random()}`, ...data }),
  );
  state.profileField.count.mockResolvedValue(0);

  state.mappingSet.findMany.mockResolvedValue(initial?.mappingSets ?? []);
  state.mappingSet.create.mockImplementation(({ data }: { data: object }) =>
    Promise.resolve({ id: `ms-${Math.random()}`, ...data }),
  );

  state.mappingRule.create.mockImplementation(({ data }: { data: object }) =>
    Promise.resolve({ id: `rule-${Math.random()}`, ...data }),
  );

  state.fmdSection.findMany.mockResolvedValue(initial?.sections ?? []);
  state.fmdSection.create.mockImplementation(({ data }: { data: object }) =>
    Promise.resolve({ id: `section-${Math.random()}`, ...data }),
  );

  const tx = state as unknown as Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
  const prisma = {
    $transaction: vi.fn(async (cb: (txClient: typeof tx) => Promise<unknown>) => cb(tx)),
    ...state,
  } as unknown as PrismaClient & typeof state;
  return { prisma, state };
}

describe("applyFmdDraft", () => {
  it("creates a new project in create mode and applies everything", async () => {
    const draft = makeDraft({
      endpoints: [
        {
          name: "SFTP source",
          role: "source",
          connectorType: "SFTP",
          profileType: "Flat File",
          format: "TSV",
          purpose: "",
          connectionInfo: "",
          confidence: 0.6,
          evidenceRefs: [],
        },
      ],
      profiles: [
        {
          name: "Source",
          role: "source",
          type: "Flat File",
          format: "TSV",
          rootPath: undefined,
          fields: [
            {
              name: "po_no",
              dataType: "String",
              required: true,
              keyField: true,
              ordinal: 1,
              confidence: 0.7,
              evidenceRefs: [],
            },
          ],
          confidence: 0.7,
          evidenceRefs: [],
        },
        {
          name: "Dest",
          role: "destination",
          type: "JSON",
          format: "JSON",
          rootPath: undefined,
          fields: [
            {
              name: "u_po_no",
              dataType: "String",
              required: true,
              keyField: false,
              ordinal: 1,
              confidence: 0.7,
              evidenceRefs: [],
            },
          ],
          confidence: 0.7,
          evidenceRefs: [],
        },
      ],
      mappingSets: [
        {
          name: "S2D",
          sourceProfileName: "Source",
          destinationProfileName: "Dest",
          direction: "source-to-destination",
          status: "Draft",
          rules: [
            {
              sourceFieldName: "po_no",
              destinationFieldName: "u_po_no",
              mappingType: "direct",
              confidence: 0.7,
              evidenceRefs: [],
            },
          ],
          confidence: 0.7,
          evidenceRefs: [],
          warnings: [],
        },
      ],
      fmdSections: [
        {
          title: "Overview",
          sectionType: "overview",
          sortOrder: 1,
          content: { note: "x" },
          confidence: 0.6,
          evidenceRefs: [],
        },
      ],
    });
    const { prisma, state } = buildPrismaApplyMock();
    const result = await applyFmdDraft(prisma, { mode: "create", draft });
    expect(result.projectId).toBe("proj-created");
    expect(state.project.create).toHaveBeenCalledTimes(1);
    expect(state.endpoint.create).toHaveBeenCalledTimes(1);
    expect(state.profile.create).toHaveBeenCalledTimes(2);
    expect(state.profileField.create).toHaveBeenCalledTimes(2);
    expect(state.mappingSet.create).toHaveBeenCalledTimes(1);
    expect(state.mappingRule.create).toHaveBeenCalledTimes(1);
    expect(state.fmdSection.create).toHaveBeenCalledTimes(1);
    expect(result.createdProfiles).toBe(2);
    expect(result.createdRules).toBe(1);
  });

  it("merges into existing project, reuses profile, adds new fields only", async () => {
    const draft = makeDraft({
      profiles: [
        {
          name: "Order",
          role: "source",
          type: "Flat File",
          format: "TSV",
          rootPath: undefined,
          fields: [
            { name: "po_no", dataType: "String", required: true, keyField: false, ordinal: 1, confidence: 0.7, evidenceRefs: [] },
            { name: "qty", dataType: "Integer", required: false, keyField: false, ordinal: 2, confidence: 0.7, evidenceRefs: [] },
          ],
          confidence: 0.7,
          evidenceRefs: [],
        },
      ],
    });
    const { prisma, state } = buildPrismaApplyMock({
      profiles: [
        {
          id: "pf-existing",
          name: "Order",
          role: "source",
          fields: [{ id: "field-existing", name: "po_no" }],
        },
      ],
    });
    const result = await applyFmdDraft(prisma, { mode: "merge", projectId: "proj-1", draft });
    expect(result.reusedProfiles).toBe(1);
    expect(result.createdProfiles).toBe(0);
    expect(result.createdFields).toBe(1); // only qty, po_no exists
    expect(state.profile.create).not.toHaveBeenCalled();
    expect(state.profileField.create).toHaveBeenCalledTimes(1);
  });

  it("mapping mode skips endpoints, sections, and project metadata update", async () => {
    const draft = makeDraft({
      endpoints: [
        { name: "X", role: "source", connectorType: "", profileType: "", format: "", purpose: "", connectionInfo: "", confidence: 0.5, evidenceRefs: [] },
      ],
      profiles: [
        {
          name: "P",
          role: "source",
          type: "Flat File",
          format: "TSV",
          rootPath: undefined,
          fields: [],
          confidence: 0.7,
          evidenceRefs: [],
        },
      ],
      fmdSections: [
        { title: "Overview", sectionType: "overview", sortOrder: 1, content: {}, confidence: 0.5, evidenceRefs: [] },
      ],
    });
    const { prisma, state } = buildPrismaApplyMock();
    await applyFmdDraft(prisma, { mode: "mapping", projectId: "proj-1", draft });
    expect(state.endpoint.create).not.toHaveBeenCalled();
    expect(state.fmdSection.create).not.toHaveBeenCalled();
    expect(state.project.update).not.toHaveBeenCalled();
    expect(state.profile.create).toHaveBeenCalledTimes(1);
  });

  it("sections mode creates only sections", async () => {
    const draft = makeDraft({
      profiles: [
        {
          name: "P",
          role: "source",
          type: "Flat File",
          format: "TSV",
          rootPath: undefined,
          fields: [],
          confidence: 0.7,
          evidenceRefs: [],
        },
      ],
      fmdSections: [
        { title: "Overview", sectionType: "overview", sortOrder: 1, content: {}, confidence: 0.5, evidenceRefs: [] },
        { title: "Env", sectionType: "environment", sortOrder: 2, content: {}, confidence: 0.5, evidenceRefs: [] },
      ],
    });
    const { prisma, state } = buildPrismaApplyMock();
    await applyFmdDraft(prisma, { mode: "sections", projectId: "proj-1", draft });
    expect(state.profile.create).not.toHaveBeenCalled();
    expect(state.fmdSection.create).toHaveBeenCalledTimes(2);
  });

  it("skips rule when destination field cannot be resolved and warns", async () => {
    const draft = makeDraft({
      profiles: [
        {
          name: "Source",
          role: "source",
          type: "Flat File",
          format: "TSV",
          rootPath: undefined,
          fields: [{ name: "po_no", dataType: "String", required: false, keyField: false, ordinal: 1, confidence: 0.7, evidenceRefs: [] }],
          confidence: 0.7,
          evidenceRefs: [],
        },
        {
          name: "Dest",
          role: "destination",
          type: "JSON",
          format: "JSON",
          rootPath: undefined,
          fields: [], // No destination fields
          confidence: 0.7,
          evidenceRefs: [],
        },
      ],
      mappingSets: [
        {
          name: "S2D",
          sourceProfileName: "Source",
          destinationProfileName: "Dest",
          direction: "source-to-destination",
          status: "Draft",
          rules: [
            {
              sourceFieldName: "po_no",
              destinationFieldName: "u_missing",
              mappingType: "direct",
              confidence: 0.5,
              evidenceRefs: [],
            },
          ],
          confidence: 0.7,
          evidenceRefs: [],
          warnings: [],
        },
      ],
    });
    const { prisma, state } = buildPrismaApplyMock();
    const result = await applyFmdDraft(prisma, { mode: "merge", projectId: "proj-1", draft });
    expect(result.skippedRules).toBe(1);
    expect(result.warnings.some((warning) => warning.includes("destination field not found"))).toBe(true);
    expect(state.mappingRule.create).not.toHaveBeenCalled();
  });

  it("dedupes sections by sectionType + title on re-apply", async () => {
    const draft = makeDraft({
      fmdSections: [
        { title: "Overview", sectionType: "overview", sortOrder: 1, content: {}, confidence: 0.6, evidenceRefs: [] },
        { title: "Overview", sectionType: "overview", sortOrder: 2, content: {}, confidence: 0.6, evidenceRefs: [] },
      ],
    });
    const { prisma, state } = buildPrismaApplyMock({
      sections: [{ id: "sec-existing", sortOrder: 1 }],
    });
    state.fmdSection.findMany.mockResolvedValue([
      { id: "sec-existing", title: "Overview", sectionType: "overview", sortOrder: 1 },
    ]);
    const result = await applyFmdDraft(prisma, { mode: "sections", projectId: "proj-1", draft });
    expect(result.createdSections).toBe(0);
    expect(result.warnings.length).toBe(2);
    expect(result.warnings.every((warning) => warning.includes("already exists"))).toBe(true);
  });

  it("respects selection filters", async () => {
    const draft = makeDraft({
      profiles: [
        {
          name: "A",
          role: "source",
          type: "Flat File",
          format: "TSV",
          rootPath: undefined,
          fields: [],
          confidence: 0.7,
          evidenceRefs: [],
        },
        {
          name: "B",
          role: "source",
          type: "Flat File",
          format: "TSV",
          rootPath: undefined,
          fields: [],
          confidence: 0.7,
          evidenceRefs: [],
        },
      ],
    });
    const { prisma, state } = buildPrismaApplyMock();
    await applyFmdDraft(prisma, {
      mode: "merge",
      projectId: "proj-1",
      draft,
      selection: { profileIndexes: [0] },
    });
    expect(state.profile.create).toHaveBeenCalledTimes(1);
  });
});
