import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

const profileTypeSchema = z.enum(["Flat File", "JSON", "XML", "Database", "API"]);
const projectStatusSchema = z.enum(["Draft", "Mapping Review", "Ready for Sandbox", "Published"]);
const endpointRoleSchema = z.enum(["source", "destination", "notification", "reference"]);

export const projectCreateSchema = z.object({
  processId: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  sourceSystem: z.string().max(120).default(""),
  destinationSystem: z.string().max(120).default(""),
  owner: z.string().max(120).default(""),
  schedule: z.string().max(200).optional().nullable(),
  folder: z.string().max(120).optional().nullable(),
  status: projectStatusSchema.optional(),
});

export const projectUpdateSchema = projectCreateSchema.partial();

export const endpointCreateSchema = z.object({
  name: z.string().min(1).max(200),
  role: endpointRoleSchema,
  connectorType: z.string().min(1).max(200),
  profileType: z.string().min(1).max(120),
  format: z.string().min(1).max(120),
  purpose: z.string().max(1000).default(""),
  connectionInfo: z.string().max(2000).default(""),
});

export const endpointUpdateSchema = endpointCreateSchema.partial();

export const profileCreateSchema = z.object({
  name: z.string().min(1).max(200),
  role: z.enum(["source", "destination"]),
  type: profileTypeSchema,
  format: z.string().min(1).max(120),
  rootPath: z.string().max(200).optional().nullable(),
});

export const profileFieldCreateSchema = z.object({
  parentPath: z.string().max(200).optional().nullable(),
  name: z.string().min(1).max(200),
  label: z.string().max(200).optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  dataType: z.string().min(1).max(60),
  length: z.string().max(60).optional().nullable(),
  required: z.boolean().optional(),
  keyField: z.boolean().optional(),
  format: z.string().max(120).optional().nullable(),
  sample: z.string().max(500).optional().nullable(),
  ordinal: z.number().int().min(0).optional(),
});

export const profileFieldUpdateSchema = profileFieldCreateSchema.partial();

export const mappingSetCreateSchema = z.object({
  name: z.string().min(1).max(200),
  sourceProfileId: z.string().min(1),
  destinationProfileId: z.string().min(1),
  direction: z.string().max(200).optional(),
});

export type MappingSetCreateInput = z.infer<typeof mappingSetCreateSchema>;

export async function createMappingSet(prisma: PrismaClient, projectId: string, input: MappingSetCreateInput) {
  return prisma.mappingSet.create({
    data: {
      projectId,
      name: input.name,
      sourceProfileId: input.sourceProfileId,
      destinationProfileId: input.destinationProfileId,
      direction: input.direction ?? "source-to-destination",
    },
    include: { rules: true, transformNodes: true },
  });
}

export const fieldImportSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("csv"),
    payload: z.string().min(1),
    delimiter: z.string().min(1).max(2).optional(),
    hasHeader: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("json"), payload: z.string().min(1) }),
  z.object({ kind: z.literal("xml"), payload: z.string().min(1) }),
]);

export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type EndpointCreateInput = z.infer<typeof endpointCreateSchema>;
export type EndpointUpdateInput = z.infer<typeof endpointUpdateSchema>;
export type ProfileCreateInput = z.infer<typeof profileCreateSchema>;
export type ProfileFieldCreateInput = z.infer<typeof profileFieldCreateSchema>;
export type ProfileFieldUpdateInput = z.infer<typeof profileFieldUpdateSchema>;
export type FieldImportInput = z.infer<typeof fieldImportSchema>;

export async function listProjects(prisma: PrismaClient) {
  return prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      processId: true,
      name: true,
      sourceSystem: true,
      destinationSystem: true,
      status: true,
      owner: true,
      schedule: true,
      lastExportedAt: true,
      updatedAt: true,
    },
  });
}

export async function createProject(prisma: PrismaClient, input: ProjectCreateInput) {
  return prisma.project.create({
    data: {
      processId: input.processId,
      name: input.name,
      description: input.description,
      sourceSystem: input.sourceSystem,
      destinationSystem: input.destinationSystem,
      owner: input.owner,
      schedule: input.schedule ?? null,
      folder: input.folder || undefined,
      status: input.status ?? "Draft",
    },
  });
}

export class ProjectVersionMismatchError extends Error {
  constructor(public readonly projectId: string, public readonly expected: number, public readonly actual: number) {
    super(`Project ${projectId} was modified by another writer (expected v${expected}, found v${actual}).`);
    this.name = "ProjectVersionMismatchError";
  }
}

export async function updateProject(
  prisma: PrismaClient,
  projectId: string,
  input: ProjectUpdateInput,
  options: { expectedVersion?: number } = {},
) {
  const data: Record<string, unknown> = {};
  for (const key of ["processId", "name", "description", "sourceSystem", "destinationSystem", "owner", "schedule", "folder", "status"] as const) {
    if (input[key] !== undefined) data[key] = input[key];
  }

  // Optimistic concurrency: if the caller provided an expected version, refuse the
  // write when SQLite has moved on. Always bump version + updatedAt on success so
  // concurrent readers can detect the change on next fetch.
  if (options.expectedVersion !== undefined) {
    const current = await prisma.project.findUnique({
      where: { id: projectId },
      select: { version: true },
    });
    if (!current) {
      // findUnique returning null is a 404 from the caller's perspective; let the
      // update below throw the standard Prisma "Record not found" error.
    } else if (current.version !== options.expectedVersion) {
      throw new ProjectVersionMismatchError(projectId, options.expectedVersion, current.version);
    }
  }

  return prisma.project.update({
    where: { id: projectId },
    data: { ...data, version: { increment: 1 }, updatedAt: new Date() },
  });
}

export async function deleteProject(prisma: PrismaClient, projectId: string) {
  return prisma.project.delete({ where: { id: projectId } });
}

export async function createEndpoint(prisma: PrismaClient, projectId: string, input: EndpointCreateInput) {
  return prisma.endpoint.create({ data: { ...input, projectId } });
}

export async function updateEndpoint(prisma: PrismaClient, endpointId: string, input: EndpointUpdateInput) {
  return prisma.endpoint.update({ where: { id: endpointId }, data: input });
}

export async function deleteEndpoint(prisma: PrismaClient, endpointId: string) {
  return prisma.endpoint.delete({ where: { id: endpointId } });
}

export async function createProfile(prisma: PrismaClient, projectId: string, input: ProfileCreateInput) {
  return prisma.profile.create({
    data: {
      projectId,
      name: input.name,
      role: input.role,
      type: input.type,
      format: input.format,
      rootPath: input.rootPath ?? null,
    },
  });
}

export async function deleteProfile(prisma: PrismaClient, profileId: string) {
  return prisma.profile.delete({ where: { id: profileId } });
}

export async function createProfileField(
  prisma: PrismaClient,
  profileId: string,
  input: ProfileFieldCreateInput,
) {
  const ordinal =
    input.ordinal ?? ((await prisma.profileField.count({ where: { profileId } })) + 1);
  return prisma.profileField.create({
    data: {
      profileId,
      parentPath: input.parentPath ?? null,
      name: input.name,
      label: input.label ?? null,
      description: input.description ?? null,
      dataType: input.dataType,
      length: input.length ?? null,
      required: input.required ?? false,
      keyField: input.keyField ?? false,
      format: input.format ?? null,
      sample: input.sample ?? null,
      ordinal,
    },
  });
}

export async function updateProfileField(
  prisma: PrismaClient,
  fieldId: string,
  input: ProfileFieldUpdateInput,
) {
  const data: Record<string, unknown> = {};
  for (const key of [
    "parentPath",
    "name",
    "label",
    "description",
    "dataType",
    "length",
    "format",
    "sample",
  ] as const) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  if (input.required !== undefined) data.required = input.required;
  if (input.keyField !== undefined) data.keyField = input.keyField;
  if (input.ordinal !== undefined) data.ordinal = input.ordinal;
  return prisma.profileField.update({ where: { id: fieldId }, data });
}

export async function deleteProfileField(prisma: PrismaClient, fieldId: string) {
  return prisma.profileField.delete({ where: { id: fieldId } });
}

export async function bulkCreateProfileFields(
  prisma: PrismaClient,
  profileId: string,
  fields: ProfileFieldCreateInput[],
) {
  const existing = await prisma.profileField.count({ where: { profileId } });
  const created = [] as Awaited<ReturnType<typeof prisma.profileField.create>>[];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    created.push(
      await prisma.profileField.create({
        data: {
          profileId,
          parentPath: field.parentPath ?? null,
          name: field.name,
          label: field.label ?? null,
          description: field.description ?? null,
          dataType: field.dataType,
          length: field.length ?? null,
          required: field.required ?? false,
          keyField: field.keyField ?? false,
          format: field.format ?? null,
          sample: field.sample ?? null,
          ordinal: field.ordinal ?? existing + index + 1,
        },
      }),
    );
  }
  return created;
}
