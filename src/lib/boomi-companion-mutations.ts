import { prisma } from "@/lib/db";
import { boomiBuildSpecSchema } from "@/lib/boomi-companion-schemas";
import { companionResultSchema } from "@/lib/boomi-companion-schemas";
import type { BoomiBuildSpec, CompanionResult, CompanionResultComponent, BuildReadinessReport } from "@/lib/domain";
import type { PackageManifest } from "@/lib/boomi-companion-package";

export type BoomiBuildPackageRow = {
  id: string;
  projectId: string;
  status: string;
  specJson: string;
  manifestJson: string;
  readinessJson: string;
  resultJson: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BoomiCompanionRunEventRow = {
  id: string;
  packageId: string;
  status: string;
  resultJson: string;
  createdAt: string;
  updatedAt: string;
};

function validateCompanionResultJson(json: unknown): { ok: true } | { ok: false; errors: string[] } {
  const parsed = companionResultSchema.safeParse(json);
  if (parsed.success) return { ok: true };

  const errors = parsed.error.issues.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`,
  );
  return { ok: false, errors };
}

export async function createBoomiBuildPackage(
  projectId: string,
  spec: BoomiBuildSpec,
  readiness: BuildReadinessReport,
): Promise<BoomiBuildPackageRow> {
  const validation = boomiBuildSpecSchema.safeParse(spec);
  if (!validation.success) {
    throw new Error(`Invalid build spec: ${validation.error.message}`);
  }

  const row = await prisma.boomiBuildPackage.create({
    data: {
      projectId,
      status: "ready",
      specJson: JSON.stringify(spec),
      manifestJson: "{}",
      readinessJson: JSON.stringify(readiness),
    },
  });

  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    specJson: row.specJson,
    manifestJson: row.manifestJson,
    readinessJson: row.readinessJson,
    resultJson: row.resultJson,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getBoomiBuildPackage(packageId: string): Promise<BoomiBuildPackageRow | null> {
  const row = await prisma.boomiBuildPackage.findUnique({
    where: { id: packageId },
    include: { runEvents: { orderBy: { createdAt: "desc" } } },
  });

  if (!row) return null;

  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    specJson: row.specJson,
    manifestJson: row.manifestJson,
    readinessJson: row.readinessJson,
    resultJson: row.resultJson,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function updatePackageStatus(
  packageId: string,
  status: string,
): Promise<void> {
  await prisma.boomiBuildPackage.update({
    where: { id: packageId },
    data: { status },
  });
}

export async function updatePackageManifest(
  packageId: string,
  manifest: PackageManifest,
): Promise<void> {
  await prisma.boomiBuildPackage.update({
    where: { id: packageId },
    data: { manifestJson: JSON.stringify(manifest) },
  });
}

export async function recordCompanionResult(
  packageId: string,
  resultJson: unknown,
  runStatus: string,
): Promise<BoomiCompanionRunEventRow> {
  const validation = validateCompanionResultJson(resultJson);
  if (!validation.ok) {
    throw new Error(`Invalid result JSON: ${validation.errors.join(", ")}`);
  }

  const resultStr = JSON.stringify(resultJson);

  const event = await prisma.boomiCompanionRunEvent.create({
    data: {
      packageId,
      status: runStatus,
      resultJson: resultStr,
    },
  });

  await prisma.boomiBuildPackage.update({
    where: { id: packageId },
    data: { status: "result_recorded", resultJson: resultStr },
  });

  return {
    id: event.id,
    packageId: event.packageId,
    status: event.status,
    resultJson: event.resultJson,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

export function isLegacyPublishEnabled(): boolean {
  return process.env.BOOMI_HELPER_ENABLE_LEGACY_XML_PUBLISH === "true";
}

export type ReconciliationResult = {
  updatedDrafts: number;
  details: string[];
};

export async function reconcileCompanionResultContext(
  projectId: string,
  result: CompanionResult,
): Promise<ReconciliationResult> {
  const allComponents: CompanionResultComponent[] = [
    ...result.components.created,
    ...result.components.updated,
    ...result.components.reused,
  ];

  const details: string[] = [];
  let updatedDrafts = 0;

  for (const comp of allComponents) {
    if (!comp.localAppEntityId) continue;

    try {
      const draft = await prisma.boomiComponentDraft.findFirst({
        where: {
          projectId,
          OR: [
            { id: comp.localAppEntityId },
            { componentId: comp.localAppEntityId },
          ],
        },
      });

      if (draft) {
        await prisma.boomiComponentDraft.update({
          where: { id: draft.id },
          data: {
            componentId: comp.componentId,
            componentName: comp.componentName || draft.componentName,
            notes: `${draft.notes ?? ""} [Companion: ${comp.action} as ${comp.componentId}]`.trim(),
          },
        });
        updatedDrafts++;
        details.push(
          `Updated draft "${draft.componentName}": componentId → ${comp.componentId} (${comp.action})`,
        );
      }
    } catch {
      details.push(`Failed to reconcile component ${comp.componentId} (${comp.componentName})`);
    }
  }

  return { updatedDrafts, details };
}
