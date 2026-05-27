import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  bulkCreateProfileFields,
  createEndpoint,
  createMappingSet,
  createProfile,
  createProfileField,
  createProject,
  deleteEndpoint,
  deleteProfileField,
  endpointCreateSchema,
  fieldImportSchema,
  mappingSetCreateSchema,
  profileCreateSchema,
  profileFieldCreateSchema,
  projectCreateSchema,
  updateProject,
  updateProfileField,
} from "@/lib/project-mutations";

function buildPrismaMock() {
  const project = {
    create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "proj-new", ...data })),
    update: vi.fn().mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
    delete: vi.fn().mockResolvedValue({ id: "proj-del" }),
  };
  const endpoint = {
    create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "ep-new", ...data })),
    update: vi.fn().mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
    delete: vi.fn().mockResolvedValue({ id: "ep-del" }),
  };
  const profile = {
    create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "pf-new", ...data })),
  };
  const profileField = {
    create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: `f-${Math.random()}`, ...data })),
    update: vi.fn().mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
    delete: vi.fn().mockResolvedValue({ id: "f-del" }),
    count: vi.fn().mockResolvedValue(0),
  };
  const mappingSet = {
    create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "ms-new", status: "Draft", ...data })),
  };
  return {
    project,
    endpoint,
    profile,
    profileField,
    mappingSet,
  } as unknown as PrismaClient & {
    project: typeof project;
    endpoint: typeof endpoint;
    profile: typeof profile;
    profileField: typeof profileField;
    mappingSet: typeof mappingSet;
  };
}

describe("project schemas", () => {
  it("requires processId, name, source, destination, owner", () => {
    expect(projectCreateSchema.safeParse({}).success).toBe(false);
    expect(
      projectCreateSchema.safeParse({
        processId: "X1",
        name: "Demo",
        sourceSystem: "Salesforce",
        destinationSystem: "Snowflake",
        owner: "Team",
      }).success,
    ).toBe(true);
  });

  it("rejects empty endpoint role", () => {
    expect(endpointCreateSchema.safeParse({ name: "X", role: "elsewhere" }).success).toBe(false);
  });

  it("validates profile types", () => {
    expect(profileCreateSchema.safeParse({ name: "X", role: "source", type: "Custom", format: "TSV" }).success).toBe(false);
    expect(profileCreateSchema.safeParse({ name: "X", role: "source", type: "Flat File", format: "TSV" }).success).toBe(true);
  });

  it("validates field import discriminator", () => {
    expect(fieldImportSchema.safeParse({ kind: "csv", payload: "a,b" }).success).toBe(true);
    expect(fieldImportSchema.safeParse({ kind: "yaml", payload: "x" }).success).toBe(false);
    expect(fieldImportSchema.safeParse({ kind: "json", payload: "" }).success).toBe(false);
  });

  it("validates mapping set inputs", () => {
    expect(mappingSetCreateSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(
      mappingSetCreateSchema.safeParse({
        name: "A",
        sourceProfileId: "p1",
        destinationProfileId: "p2",
      }).success,
    ).toBe(true);
  });
});

describe("project mutations", () => {
  it("creates a project with defaults", async () => {
    const prisma = buildPrismaMock();
    await createProject(prisma, {
      processId: "P1",
      name: "New",
      description: "",
      sourceSystem: "A",
      destinationSystem: "B",
      owner: "Me",
    });
    expect(prisma.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        processId: "P1",
        status: "Draft",
        schedule: null,
      }),
    });
  });

  it("updates only provided project fields", async () => {
    const prisma = buildPrismaMock();
    await updateProject(prisma, "proj-1", { description: "Updated" });
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: "proj-1" },
      // M8: every successful update bumps version + updatedAt for optimistic
      // concurrency. Match the descriptive fields explicitly and allow the rest.
      data: expect.objectContaining({
        description: "Updated",
        version: { increment: 1 },
      }),
    });
    const callArgs = prisma.project.update.mock.calls[0][0];
    expect(callArgs.data.updatedAt).toBeInstanceOf(Date);
  });

  it("rejects update when expectedVersion doesn't match SQLite", async () => {
    const prisma = buildPrismaMock();
    // Mock findUnique to return version 3 — caller expected version 1.
    prisma.project.findUnique = vi.fn().mockResolvedValue({ version: 3 });
    await expect(
      updateProject(prisma, "proj-1", { description: "x" }, { expectedVersion: 1 }),
    ).rejects.toThrow(/expected v1, found v3/);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it("accepts update when expectedVersion matches", async () => {
    const prisma = buildPrismaMock();
    prisma.project.findUnique = vi.fn().mockResolvedValue({ version: 5 });
    await updateProject(prisma, "proj-1", { description: "x" }, { expectedVersion: 5 });
    expect(prisma.project.update).toHaveBeenCalled();
  });
});

describe("endpoint and profile mutations", () => {
  it("creates an endpoint scoped to a project", async () => {
    const prisma = buildPrismaMock();
    await createEndpoint(prisma, "proj-1", {
      name: "ServiceNow",
      role: "destination",
      connectorType: "HTTP",
      profileType: "JSON",
      format: "JSON",
      purpose: "",
      connectionInfo: "",
    });
    expect(prisma.endpoint.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: "proj-1", role: "destination" }),
    });
  });

  it("deletes an endpoint by id", async () => {
    const prisma = buildPrismaMock();
    await deleteEndpoint(prisma, "ep-9");
    expect(prisma.endpoint.delete).toHaveBeenCalledWith({ where: { id: "ep-9" } });
  });

  it("creates a profile with rootPath null when omitted", async () => {
    const prisma = buildPrismaMock();
    await createProfile(prisma, "proj-1", { name: "P", role: "source", type: "JSON", format: "JSON" });
    expect(prisma.profile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: "proj-1", rootPath: null }),
    });
  });
});

describe("profile field mutations", () => {
  it("assigns sequential ordinal when missing", async () => {
    const prisma = buildPrismaMock();
    prisma.profileField.count.mockResolvedValueOnce(7);
    await createProfileField(prisma, "pf-1", { name: "x", dataType: "String" });
    expect(prisma.profileField.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ profileId: "pf-1", name: "x", ordinal: 8 }),
    });
  });

  it("updates only provided field properties", async () => {
    const prisma = buildPrismaMock();
    await updateProfileField(prisma, "f-1", { required: true });
    expect(prisma.profileField.update).toHaveBeenCalledWith({
      where: { id: "f-1" },
      data: { required: true },
    });
  });

  it("deletes a profile field", async () => {
    const prisma = buildPrismaMock();
    await deleteProfileField(prisma, "f-9");
    expect(prisma.profileField.delete).toHaveBeenCalledWith({ where: { id: "f-9" } });
  });

  it("bulk-imports fields with continuous ordinals", async () => {
    const prisma = buildPrismaMock();
    prisma.profileField.count.mockResolvedValueOnce(3);
    await bulkCreateProfileFields(prisma, "pf-1", [
      { name: "a", dataType: "String" },
      { name: "b", dataType: "Integer" },
    ]);
    expect(prisma.profileField.create).toHaveBeenCalledTimes(2);
    expect(prisma.profileField.create.mock.calls[0][0].data.ordinal).toBe(4);
    expect(prisma.profileField.create.mock.calls[1][0].data.ordinal).toBe(5);
  });
});

describe("mapping set creation", () => {
  it("defaults direction to source-to-destination", async () => {
    const prisma = buildPrismaMock();
    await createMappingSet(prisma, "proj-1", {
      name: "M",
      sourceProfileId: "p1",
      destinationProfileId: "p2",
    });
    expect(prisma.mappingSet.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ direction: "source-to-destination" }),
    });
  });
});

describe("profileFieldCreateSchema", () => {
  it("treats required and keyField as optional booleans", () => {
    expect(profileFieldCreateSchema.safeParse({ name: "x", dataType: "String" }).success).toBe(true);
    expect(
      profileFieldCreateSchema.safeParse({ name: "x", dataType: "String", required: true, keyField: true }).success,
    ).toBe(true);
  });
});
