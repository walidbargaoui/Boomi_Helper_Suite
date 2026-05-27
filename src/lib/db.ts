import { PrismaClient } from "@prisma/client";
import type { BoomiPublishEvent, Project } from "@/lib/domain";
import { sampleProject } from "@/lib/sample-data";
import { maskValue, decryptValue } from "@/lib/boomi-crypto";
import { logger } from "@/lib/logger";

/**
 * Strip server-only secrets and trim heavy payloads from a Project before it
 * crosses the network boundary into a client payload.
 *
 * Specifically:
 * - `boomiConnections`: ciphertext `apiUsername` is decrypted and masked;
 *   `apiPassword` is replaced with the canonical `••••••••` bullets.
 *   Decryption failures fall back to `"[re-enter credentials]"` so the UI can
 *   prompt the user rather than render gibberish.
 * - `boomiPublishEvents`: `requestXml` and `responseXml` can each be tens of KB
 *   of full Boomi Component XML. The client list view only needs metadata
 *   (componentName, status, timestamp) plus a short error preview. We omit the
 *   XML bodies here and expose them via `/api/boomi/publish/events/[eventId]`
 *   so the UI fetches them only when the user opens a specific event.
 *   `hasRequestXml` / `hasResponseXml` flags let the UI know whether the
 *   detail fetch will actually return something.
 *
 * Call this any time a Project is about to be JSON-serialized to the browser.
 * The unsanitized object is server-only.
 */
export function sanitizeProjectForClient(project: Project): Project {
  return {
    ...project,
    boomiConnections: project.boomiConnections.map((conn) => {
      let usernameDisplay = "";
      try {
        usernameDisplay = maskValue(decryptValue(conn.apiUsername));
      } catch {
        usernameDisplay = conn.apiUsername ? "[re-enter credentials]" : "";
      }
      return {
        ...conn,
        apiUsername: usernameDisplay,
        apiPassword: conn.apiPassword ? "••••••••" : "",
      };
    }),
    boomiPublishEvents: project.boomiPublishEvents?.map((event) => {
      const errorPreview = event.errorDetail && event.errorDetail.length > 500
        ? `${event.errorDetail.slice(0, 500)}…`
        : event.errorDetail;
      return {
        ...event,
        requestXml: "",
        responseXml: undefined,
        errorDetail: errorPreview,
        // Non-destructive hints so the UI knows what's available on-demand.
        hasRequestXml: Boolean(event.requestXml?.trim()),
        hasResponseXml: Boolean(event.responseXml?.trim()),
      } as BoomiPublishEvent & { hasRequestXml: boolean; hasResponseXml: boolean };
    }),
  };
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type ProjectSummary = {
  id: string;
  processId: string;
  name: string;
  sourceSystem: string;
  destinationSystem: string;
  status: string;
  folder?: string;
  updatedAt: string;
  mode?: "live" | "fallback";
};

export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  try {
    const rows = await prisma.project.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        processId: true,
        name: true,
        sourceSystem: true,
        destinationSystem: true,
        status: true,
        folder: true,
        updatedAt: true,
      },
    });
    return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString(), mode: "live" as const }));
  } catch (error) {
    logger.warn("Prisma unavailable; falling back to sample summary.", undefined, error);
    return [
      {
        id: sampleProject.id,
        processId: sampleProject.processId,
        name: sampleProject.name,
        sourceSystem: sampleProject.sourceSystem,
        destinationSystem: sampleProject.destinationSystem,
        status: sampleProject.status,
        updatedAt: new Date().toISOString(),
        mode: "fallback" as const,
      },
    ];
  }
}

export async function getWorkspaceProject(projectId?: string): Promise<Project> {
  try {
    const existing = projectId
      ? await prisma.project.findUnique({
          where: { id: projectId },
          include: {
            endpoints: true,
            profiles: { include: { fields: { orderBy: { ordinal: "asc" } } } },
            mappingSets: { include: { rules: true, transformNodes: true } },
            processFlows: true,
            fmdSections: { orderBy: { sortOrder: "asc" } },
            boomiConnections: true,
            boomiDrafts: true,
            boomiPublishEvents: { orderBy: { publishedAt: "desc" } },
          },
        })
      : await prisma.project.findFirst({
          orderBy: { updatedAt: "desc" },
          include: {
            endpoints: true,
            profiles: { include: { fields: { orderBy: { ordinal: "asc" } } } },
            mappingSets: { include: { rules: true, transformNodes: true } },
            processFlows: true,
            fmdSections: { orderBy: { sortOrder: "asc" } },
            boomiConnections: true,
            boomiDrafts: true,
            boomiPublishEvents: { orderBy: { publishedAt: "desc" } },
          },
        });

    if (!existing) {
      return { ...sampleProject, mode: "fallback" };
    }

    return {
      id: existing.id,
      processId: existing.processId,
      name: existing.name,
      description: existing.description,
      sourceSystem: existing.sourceSystem,
      destinationSystem: existing.destinationSystem,
      status: existing.status as Project["status"],
      version: existing.version,
      folder: existing.folder,
      owner: existing.owner,
      schedule: existing.schedule ?? undefined,
      lastExportedAt: existing.lastExportedAt?.toISOString(),
      mode: "live",
      endpoints: existing.endpoints.map((endpoint) => ({
        id: endpoint.id,
        name: endpoint.name,
        role: endpoint.role as Project["endpoints"][number]["role"],
        connectorType: endpoint.connectorType,
        profileType: endpoint.profileType,
        format: endpoint.format,
        purpose: endpoint.purpose,
        connectionInfo: endpoint.connectionInfo,
      })),
      profiles: existing.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        role: profile.role as Project["profiles"][number]["role"],
        type: profile.type as Project["profiles"][number]["type"],
        format: profile.format,
        rootPath: profile.rootPath ?? undefined,
        fields: profile.fields.map((field) => ({
          id: field.id,
          parentPath: field.parentPath ?? undefined,
          name: field.name,
          label: field.label ?? undefined,
          description: field.description ?? undefined,
          dataType: field.dataType,
          length: field.length ?? undefined,
          required: field.required,
          keyField: field.keyField,
          format: field.format ?? undefined,
          sample: field.sample ?? undefined,
          ordinal: field.ordinal,
        })),
      })),
      mappingSets: existing.mappingSets.map((mappingSet) => ({
        id: mappingSet.id,
        name: mappingSet.name,
        sourceProfileId: mappingSet.sourceProfileId,
        destinationProfileId: mappingSet.destinationProfileId,
        direction: mappingSet.direction,
        status: mappingSet.status as Project["mappingSets"][number]["status"],
        rules: mappingSet.rules.map((rule) => ({
          id: rule.id,
          sourceFieldId: rule.sourceFieldId ?? undefined,
          destinationFieldId: rule.destinationFieldId,
          mappingType: rule.mappingType as Project["mappingSets"][number]["rules"][number]["mappingType"],
          expression: rule.expression ?? undefined,
          defaultValue: rule.defaultValue ?? undefined,
          comment: rule.comment ?? undefined,
          qualityStatus: rule.qualityStatus as Project["mappingSets"][number]["rules"][number]["qualityStatus"],
          reviewed: rule.reviewed ?? false,
        })),
        transformNodes: mappingSet.transformNodes.map((node) => ({
          id: node.id,
          label: node.label,
          nodeType: node.nodeType as Project["mappingSets"][number]["transformNodes"][number]["nodeType"],
          config: JSON.parse(node.configJson) as Record<string, string>,
          position: { x: node.positionX, y: node.positionY },
        })),
      })),
      processFlows: existing.processFlows.map((flow) => ({
        id: flow.id,
        name: flow.name,
        nodes: JSON.parse(flow.nodesJson),
        edges: JSON.parse(flow.edgesJson),
        notes: flow.notes ?? undefined,
      })),
      fmdSections: existing.fmdSections.map((section) => ({
        id: section.id,
        title: section.title,
        sectionType: section.sectionType as Project["fmdSections"][number]["sectionType"],
        content: JSON.parse(section.contentJson),
        sortOrder: section.sortOrder,
      })),
      boomiConnections: existing.boomiConnections.map((connection) => ({
        id: connection.id,
        accountId: connection.accountId,
        environmentName: connection.environmentName,
        baseUrl: connection.baseUrl,
        authMode: connection.authMode as Project["boomiConnections"][number]["authMode"],
        apiUsername: connection.apiUsername,
        apiPassword: connection.apiPassword,
        mode: connection.mode as Project["boomiConnections"][number]["mode"],
        createdAt: connection.createdAt.toISOString(),
      })),
      boomiDrafts: existing.boomiDrafts.map((draft) => ({
        id: draft.id,
        componentId: draft.componentId,
        componentType: draft.componentType as Project["boomiDrafts"][number]["componentType"],
        componentName: draft.componentName,
        templateXml: draft.templateXml ?? undefined,
        proposedXml: draft.proposedXml,
        diff: draft.diff,
        validationStatus: draft.validationStatus as Project["boomiDrafts"][number]["validationStatus"],
        notes: draft.notes ?? undefined,
        createdAt: draft.createdAt.toISOString(),
        updatedAt: draft.updatedAt.toISOString(),
      })),
      boomiPublishEvents: existing.boomiPublishEvents.map((event) => ({
        id: event.id,
        draftId: event.draftId,
        connectionId: event.connectionId ?? undefined,
        componentId: event.componentId,
        componentName: event.componentName,
        componentType: event.componentType as Project["boomiDrafts"][number]["componentType"],
        version: event.version ?? undefined,
        action: event.action as BoomiPublishEvent["action"],
        requestXml: event.requestXml,
        responseXml: event.responseXml ?? undefined,
        status: event.status as BoomiPublishEvent["status"],
        errorDetail: event.errorDetail ?? undefined,
        publishedAt: event.publishedAt.toISOString(),
      })),
    };
  } catch (error) {
    logger.warn("Prisma unavailable; falling back to sample workspace.", undefined, error);
    return { ...sampleProject, mode: "fallback" };
  }
}

export async function recordBoomiPublishEvent(
  projectId: string,
  event: Omit<BoomiPublishEvent, "id" | "publishedAt"> & { publishedAt?: string },
): Promise<BoomiPublishEvent> {
  const row = await prisma.boomiPublishEvent.create({
    data: {
      projectId,
      draftId: event.draftId,
      connectionId: event.connectionId,
      componentId: event.componentId,
      componentName: event.componentName,
      componentType: event.componentType,
      version: event.version,
      action: event.action,
      requestXml: event.requestXml,
      responseXml: event.responseXml,
      status: event.status,
      errorDetail: event.errorDetail,
      publishedAt: event.publishedAt ? new Date(event.publishedAt) : undefined,
    },
  });

  return {
    id: row.id,
    draftId: row.draftId,
    connectionId: row.connectionId ?? undefined,
    componentId: row.componentId,
    componentName: row.componentName,
    componentType: row.componentType as BoomiPublishEvent["componentType"],
    version: row.version ?? undefined,
    action: row.action as BoomiPublishEvent["action"],
    requestXml: row.requestXml,
    responseXml: row.responseXml ?? undefined,
    status: row.status as BoomiPublishEvent["status"],
    errorDetail: row.errorDetail ?? undefined,
    publishedAt: row.publishedAt.toISOString(),
  };
}

export async function seedSampleProject() {
  await prisma.project.deleteMany({ where: { processId: sampleProject.processId } });
  await prisma.project.create({
    data: {
      id: sampleProject.id,
      processId: sampleProject.processId,
      name: sampleProject.name,
      description: sampleProject.description,
      sourceSystem: sampleProject.sourceSystem,
      destinationSystem: sampleProject.destinationSystem,
      status: sampleProject.status,
      owner: sampleProject.owner,
      schedule: sampleProject.schedule,
      lastExportedAt: sampleProject.lastExportedAt ? new Date(sampleProject.lastExportedAt) : undefined,
    },
  });

  for (const endpoint of sampleProject.endpoints) {
    await prisma.endpoint.create({
      data: { ...endpoint, projectId: sampleProject.id },
    });
  }

  for (const profile of sampleProject.profiles) {
    await prisma.profile.create({
      data: {
        id: profile.id,
        projectId: sampleProject.id,
        name: profile.name,
        role: profile.role,
        type: profile.type,
        format: profile.format,
        rootPath: profile.rootPath,
      },
    });
    for (const field of profile.fields) {
      await prisma.profileField.create({
        data: { ...field, profileId: profile.id },
      });
    }
  }

  for (const mappingSet of sampleProject.mappingSets) {
    await prisma.mappingSet.create({
      data: {
        id: mappingSet.id,
        projectId: sampleProject.id,
        name: mappingSet.name,
        sourceProfileId: mappingSet.sourceProfileId,
        destinationProfileId: mappingSet.destinationProfileId,
        direction: mappingSet.direction,
        status: mappingSet.status,
      },
    });
    for (const rule of mappingSet.rules) {
      await prisma.mappingRule.create({
        data: {
          id: rule.id,
          mappingSetId: mappingSet.id,
          sourceFieldId: rule.sourceFieldId,
          destinationFieldId: rule.destinationFieldId,
          mappingType: rule.mappingType,
          expression: rule.expression,
          defaultValue: rule.defaultValue,
          comment: rule.comment,
          qualityStatus: rule.qualityStatus ?? "unchecked",
          reviewed: rule.reviewed ?? false,
        },
      });
    }
    for (const node of mappingSet.transformNodes) {
      await prisma.transformNode.create({
        data: {
          id: node.id,
          mappingSetId: mappingSet.id,
          label: node.label,
          nodeType: node.nodeType,
          configJson: JSON.stringify(node.config),
          positionX: node.position.x,
          positionY: node.position.y,
        },
      });
    }
  }

  for (const flow of sampleProject.processFlows) {
    await prisma.processFlow.create({
      data: {
        id: flow.id,
        projectId: sampleProject.id,
        name: flow.name,
        nodesJson: JSON.stringify(flow.nodes),
        edgesJson: JSON.stringify(flow.edges),
        notes: flow.notes,
      },
    });
  }

  for (const section of sampleProject.fmdSections) {
    await prisma.fmdSection.create({
      data: {
        id: section.id,
        projectId: sampleProject.id,
        title: section.title,
        sectionType: section.sectionType,
        contentJson: JSON.stringify(section.content),
        sortOrder: section.sortOrder,
      },
    });
  }

  for (const connection of sampleProject.boomiConnections) {
    await prisma.boomiConnection.create({
      data: { ...connection, projectId: sampleProject.id },
    });
  }

  for (const draft of sampleProject.boomiDrafts) {
    await prisma.boomiComponentDraft.create({
      data: { ...draft, projectId: sampleProject.id },
    });
  }
}

/**
 * Thrown by updateWorkspaceProject when the in-memory project's `version`
 * does not match the version persisted in SQLite. The caller can choose to
 * refetch the project graph and retry, or surface a "Reload to see other
 * changes" UI to the user.
 */
export class ConcurrentModificationError extends Error {
  constructor(public readonly projectId: string, public readonly expected: number, public readonly actual: number) {
    super(`Project ${projectId} was modified concurrently (expected v${expected}, found v${actual}).`);
    this.name = "ConcurrentModificationError";
  }
}

export async function updateWorkspaceProject(project: Project): Promise<Project> {
  // Distinguish "Prisma unavailable / fallback project" from "real persistence error".
  // Only the first deserves a soft fallback; the second must surface so the UI doesn't
  // silently show data the user thinks is saved.
  if (project.mode === "fallback") {
    return project;
  }

  // Optimistic concurrency: check version matches before writing.
  if (project.version !== undefined) {
    const current = await prisma.project.findUnique({
      where: { id: project.id },
      select: { version: true },
    });
    if (current && current.version !== project.version) {
      throw new ConcurrentModificationError(project.id, project.version, current.version);
    }
  }

  // Per-entity upserts instead of delete/recreate (M8.2 #10).
  const existingConnIds = new Set(
    (await prisma.boomiConnection.findMany({ where: { projectId: project.id }, select: { id: true } })).map((c) => c.id),
  );
  for (const conn of project.boomiConnections) {
    await prisma.boomiConnection.upsert({
      where: { id: conn.id },
      create: {
        id: conn.id,
        projectId: project.id,
        accountId: conn.accountId,
        environmentName: conn.environmentName,
        baseUrl: conn.baseUrl,
        authMode: conn.authMode,
        apiUsername: conn.apiUsername,
        apiPassword: conn.apiPassword,
        mode: conn.mode,
        createdAt: new Date(conn.createdAt),
      },
      update: {
        accountId: conn.accountId,
        environmentName: conn.environmentName,
        baseUrl: conn.baseUrl,
        apiUsername: conn.apiUsername,
        apiPassword: conn.apiPassword,
        mode: conn.mode,
      },
    });
    existingConnIds.delete(conn.id);
  }
  for (const staleId of existingConnIds) {
    await prisma.boomiConnection.delete({ where: { id: staleId } });
  }

  const existingDraftIds = new Set(
    (await prisma.boomiComponentDraft.findMany({ where: { projectId: project.id }, select: { id: true } })).map((d) => d.id),
  );
  for (const draft of project.boomiDrafts) {
    await prisma.boomiComponentDraft.upsert({
      where: { id: draft.id },
      create: {
        id: draft.id,
        projectId: project.id,
        componentId: draft.componentId,
        componentName: draft.componentName,
        componentType: draft.componentType,
        templateXml: draft.templateXml,
        proposedXml: draft.proposedXml,
        diff: draft.diff,
        validationStatus: draft.validationStatus,
        notes: draft.notes,
        createdAt: new Date(draft.createdAt),
        updatedAt: new Date(draft.updatedAt),
      },
      update: {
        componentId: draft.componentId,
        componentName: draft.componentName,
        componentType: draft.componentType,
        templateXml: draft.templateXml,
        proposedXml: draft.proposedXml,
        diff: draft.diff,
        validationStatus: draft.validationStatus,
        notes: draft.notes,
        updatedAt: new Date(draft.updatedAt),
      },
    });
    existingDraftIds.delete(draft.id);
  }
  for (const staleId of existingDraftIds) {
    await prisma.boomiComponentDraft.delete({ where: { id: staleId } });
  }

  const updated = await prisma.project.update({
    where: { id: project.id },
    data: { updatedAt: new Date(), version: { increment: 1 } },
    select: { version: true },
  });

  return { ...project, version: updated.version };
}

async function cleanup() {
  await prisma.$disconnect();
  process.exit(0);
}

process.once("SIGTERM", () => { cleanup(); });
process.once("SIGINT", () => { disconnectPrisma().catch(() => {}); });

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

process.on("beforeExit", async () => {
  await disconnectPrisma().catch(() => {});
});

process.once("SIGUSR2", async () => {
  await disconnectPrisma().catch(() => {});
  process.exit(0);
});
