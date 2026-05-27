import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { Project } from "@/lib/domain";
import { fmdImportDraftSchema } from "@/lib/fmd-import";
import { normalizeSectionType } from "@/lib/fmd-section-schemas";

export const applyModeSchema = z.enum(["merge", "mapping", "sections", "create"]);
export type FmdApplyMode = z.infer<typeof applyModeSchema>;

const indexArraySchema = z.array(z.number().int().min(0));

export const applySelectionSchema = z.object({
  endpointIndexes: indexArraySchema.optional(),
  profileIndexes: indexArraySchema.optional(),
  fieldIndexesByProfile: z.record(z.string(), indexArraySchema).optional(),
  mappingSetIndexes: indexArraySchema.optional(),
  ruleIndexesByMappingSet: z.record(z.string(), indexArraySchema).optional(),
  sectionIndexes: indexArraySchema.optional(),
});

export type FmdApplySelection = z.infer<typeof applySelectionSchema>;

export const applyRequestSchema = z.object({
  mode: applyModeSchema,
  projectId: z.string().min(1).optional(),
  draft: fmdImportDraftSchema,
  selection: applySelectionSchema.optional(),
});

export type FmdApplyRequest = z.infer<typeof applyRequestSchema>;

export type FmdConflict = {
  severity: "error" | "warning";
  type:
    | "profile-duplicate"
    | "field-type"
    | "field-required"
    | "endpoint-duplicate"
    | "duplicate-destination"
    | "section-duplicate"
    | "missing-project";
  message: string;
};

export type FmdApplyResult = {
  projectId: string;
  createdProfiles: number;
  reusedProfiles: number;
  createdFields: number;
  createdEndpoints: number;
  createdMappingSets: number;
  reusedMappingSets: number;
  createdRules: number;
  skippedRules: number;
  createdSections: number;
  warnings: string[];
};

type CategoryFlags = {
  metadata: boolean;
  endpoints: boolean;
  profiles: boolean;
  mappingSets: boolean;
  sections: boolean;
};

export function categoriesForMode(mode: FmdApplyMode): CategoryFlags {
  switch (mode) {
    case "merge":
    case "create":
      return { metadata: true, endpoints: true, profiles: true, mappingSets: true, sections: true };
    case "mapping":
      return { metadata: false, endpoints: false, profiles: true, mappingSets: true, sections: false };
    case "sections":
      return { metadata: false, endpoints: false, profiles: false, mappingSets: false, sections: true };
    default:
      return { metadata: false, endpoints: false, profiles: false, mappingSets: false, sections: false };
  }
}

function includeIndex(set: number[] | undefined, index: number) {
  return set === undefined || set.includes(index);
}

function profileKey(role: string, name: string) {
  return `${role}::${name.toLowerCase().trim()}`;
}

function fieldKey(profileId: string, name: string) {
  return `${profileId}::${name.toLowerCase().trim()}`;
}

export function detectFmdConflicts(
  request: FmdApplyRequest,
  currentProject?: Project,
): FmdConflict[] {
  const conflicts: FmdConflict[] = [];

  if (request.mode !== "create") {
    if (!currentProject) {
      conflicts.push({
        severity: "error",
        type: "missing-project",
        message: "No current project to apply into.",
      });
      return conflicts;
    }
  } else {
    return conflicts;
  }

  const project = currentProject!;
  const categories = categoriesForMode(request.mode);
  const selection = request.selection ?? {};
  const draft = request.draft;

  if (categories.endpoints) {
    draft.endpoints.forEach((endpoint, index) => {
      if (!includeIndex(selection.endpointIndexes, index)) return;
      const exists = project.endpoints.some(
        (item) => item.name.toLowerCase().trim() === endpoint.name.toLowerCase().trim() && item.role === endpoint.role,
      );
      if (exists) {
        conflicts.push({
          severity: "warning",
          type: "endpoint-duplicate",
          message: `Endpoint "${endpoint.name}" (${endpoint.role}) already exists; it will be skipped.`,
        });
      }
    });
  }

  const profileLookup = new Map(project.profiles.map((profile) => [profileKey(profile.role, profile.name), profile]));

  if (categories.profiles) {
    draft.profiles.forEach((draftProfile, profileIndex) => {
      if (!includeIndex(selection.profileIndexes, profileIndex)) return;
      const existing = profileLookup.get(profileKey(draftProfile.role, draftProfile.name));
      if (!existing) return;
      conflicts.push({
        severity: "warning",
        type: "profile-duplicate",
        message: `Profile "${draftProfile.name}" (${draftProfile.role}) already exists; fields will be merged into the existing profile.`,
      });
      const fieldSelection = selection.fieldIndexesByProfile?.[String(profileIndex)];
      draftProfile.fields.forEach((draftField, fieldIndex) => {
        if (!includeIndex(fieldSelection, fieldIndex)) return;
        const existingField = existing.fields.find(
          (item) => item.name.toLowerCase().trim() === draftField.name.toLowerCase().trim(),
        );
        if (!existingField) return;
        if (existingField.dataType.toLowerCase() !== draftField.dataType.toLowerCase()) {
          conflicts.push({
            severity: "warning",
            type: "field-type",
            message: `${draftProfile.name}.${draftField.name}: existing type ${existingField.dataType} differs from draft ${draftField.dataType}; existing is kept.`,
          });
        }
        if (existingField.required !== draftField.required) {
          conflicts.push({
            severity: "warning",
            type: "field-required",
            message: `${draftProfile.name}.${draftField.name}: required flag differs (current=${existingField.required}, draft=${draftField.required}); existing is kept.`,
          });
        }
      });
    });
  }

  if (categories.sections) {
    const sectionKeys = new Set(
      project.fmdSections.map((section) => `${section.sectionType}::${section.title.toLowerCase().trim()}`),
    );
    draft.fmdSections.forEach((draftSection, index) => {
      if (!includeIndex(selection.sectionIndexes, index)) return;
      const key = `${draftSection.sectionType}::${draftSection.title.toLowerCase().trim()}`;
      if (sectionKeys.has(key)) {
        conflicts.push({
          severity: "warning",
          type: "section-duplicate",
          message: `Section "${draftSection.title}" (${draftSection.sectionType}) already exists; it will be skipped.`,
        });
      }
    });
  }

  if (categories.mappingSets) {
    draft.mappingSets.forEach((draftSet, msIndex) => {
      if (!includeIndex(selection.mappingSetIndexes, msIndex)) return;
      const existingSet = project.mappingSets.find(
        (item) => item.name.toLowerCase().trim() === draftSet.name.toLowerCase().trim(),
      );
      if (!existingSet) return;
      const destinationProfile = project.profiles.find((p) => p.id === existingSet.destinationProfileId);
      if (!destinationProfile) return;
      const ruleSelection = selection.ruleIndexesByMappingSet?.[String(msIndex)];
      draftSet.rules.forEach((draftRule, ruleIndex) => {
        if (!includeIndex(ruleSelection, ruleIndex)) return;
        const destinationField = destinationProfile.fields.find(
          (f) => f.name.toLowerCase().trim() === draftRule.destinationFieldName.toLowerCase().trim(),
        );
        if (!destinationField) return;
        const alreadyMapped = existingSet.rules.some((r) => r.destinationFieldId === destinationField.id);
        if (alreadyMapped) {
          conflicts.push({
            severity: "warning",
            type: "duplicate-destination",
            message: `Set "${draftSet.name}" already maps "${draftRule.destinationFieldName}"; this draft rule will be skipped.`,
          });
        }
      });
    });
  }

  return conflicts;
}

type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function applyFmdDraft(
  prisma: PrismaClient,
  request: FmdApplyRequest,
): Promise<FmdApplyResult> {
  return prisma.$transaction(async (tx) => applyFmdDraftInTransaction(tx, request));
}

async function applyFmdDraftInTransaction(
  tx: TxClient,
  request: FmdApplyRequest,
): Promise<FmdApplyResult> {
  const result: FmdApplyResult = {
    projectId: "",
    createdProfiles: 0,
    reusedProfiles: 0,
    createdFields: 0,
    createdEndpoints: 0,
    createdMappingSets: 0,
    reusedMappingSets: 0,
    createdRules: 0,
    skippedRules: 0,
    createdSections: 0,
    warnings: [],
  };
  const categories = categoriesForMode(request.mode);
  const selection = request.selection ?? {};
  const draft = request.draft;

  let projectId: string;
  if (request.mode === "create") {
    const created = await tx.project.create({
      data: {
        processId: draft.project.processId,
        name: draft.project.name,
        description: draft.project.description,
        sourceSystem: draft.project.sourceSystem,
        destinationSystem: draft.project.destinationSystem,
        owner: draft.project.owner,
        schedule: draft.project.schedule ?? null,
        status: draft.project.status,
      },
    });
    projectId = created.id;
  } else {
    if (!request.projectId) {
      throw new Error("projectId is required when mode is not 'create'.");
    }
    const existing = await tx.project.findUnique({ where: { id: request.projectId } });
    if (!existing) {
      throw new Error(`Project ${request.projectId} not found.`);
    }
    projectId = existing.id;
    if (categories.metadata && request.mode === "merge") {
      await tx.project.update({
        where: { id: projectId },
        data: {
          description: draft.project.description || existing.description,
          sourceSystem: draft.project.sourceSystem || existing.sourceSystem,
          destinationSystem: draft.project.destinationSystem || existing.destinationSystem,
          schedule: draft.project.schedule ?? existing.schedule,
        },
      });
    }
  }
  result.projectId = projectId;

  if (categories.endpoints) {
    const existingEndpoints = await tx.endpoint.findMany({ where: { projectId } });
    for (let index = 0; index < draft.endpoints.length; index += 1) {
      if (!includeIndex(selection.endpointIndexes, index)) continue;
      const endpoint = draft.endpoints[index];
      const exists = existingEndpoints.some(
        (item) => item.name.toLowerCase().trim() === endpoint.name.toLowerCase().trim() && item.role === endpoint.role,
      );
      if (exists) {
        result.warnings.push(`Endpoint "${endpoint.name}" already exists; skipped.`);
        continue;
      }
      await tx.endpoint.create({
        data: {
          projectId,
          name: endpoint.name,
          role: endpoint.role,
          connectorType: endpoint.connectorType,
          profileType: endpoint.profileType,
          format: endpoint.format,
          purpose: endpoint.purpose,
          connectionInfo: endpoint.connectionInfo,
        },
      });
      result.createdEndpoints += 1;
    }
  }

  const profileIdByKey = new Map<string, string>();
  const fieldIdByKey = new Map<string, string>();
  const profileOrdinalByKey = new Map<string, number>();

  if (categories.profiles || categories.mappingSets) {
    // Mapping sets always need profile/field id lookup; preload existing rows.
    const existingProfiles = await tx.profile.findMany({
      where: { projectId },
      include: { fields: true },
    });
    for (const existing of existingProfiles) {
      const key = profileKey(existing.role, existing.name);
      profileIdByKey.set(key, existing.id);
      profileOrdinalByKey.set(key, existing.fields.length);
      for (const field of existing.fields) {
        fieldIdByKey.set(fieldKey(existing.id, field.name), field.id);
      }
    }
  }

  if (categories.profiles) {
    for (let profileIndex = 0; profileIndex < draft.profiles.length; profileIndex += 1) {
      if (!includeIndex(selection.profileIndexes, profileIndex)) continue;
      const draftProfile = draft.profiles[profileIndex];
      const key = profileKey(draftProfile.role, draftProfile.name);
      let profileId = profileIdByKey.get(key);
      if (!profileId) {
        const created = await tx.profile.create({
          data: {
            projectId,
            name: draftProfile.name,
            role: draftProfile.role,
            type: draftProfile.type,
            format: draftProfile.format,
            rootPath: draftProfile.rootPath ?? null,
          },
        });
        profileId = created.id;
        profileIdByKey.set(key, profileId);
        profileOrdinalByKey.set(key, 0);
        result.createdProfiles += 1;
      } else {
        result.reusedProfiles += 1;
      }

      const fieldSelection = selection.fieldIndexesByProfile?.[String(profileIndex)];
      let ordinal = profileOrdinalByKey.get(key) ?? 0;
      for (let fieldIndex = 0; fieldIndex < draftProfile.fields.length; fieldIndex += 1) {
        if (!includeIndex(fieldSelection, fieldIndex)) continue;
        const draftField = draftProfile.fields[fieldIndex];
        const fKey = fieldKey(profileId, draftField.name);
        if (fieldIdByKey.has(fKey)) continue;
        ordinal += 1;
        const created = await tx.profileField.create({
          data: {
            profileId,
            parentPath: draftField.parentPath ?? null,
            name: draftField.name,
            label: draftField.label ?? null,
            description: draftField.description ?? null,
            dataType: draftField.dataType,
            length: draftField.length ?? null,
            required: draftField.required,
            keyField: draftField.keyField,
            format: draftField.format ?? null,
            sample: draftField.sample ?? null,
            ordinal,
          },
        });
        fieldIdByKey.set(fKey, created.id);
        result.createdFields += 1;
      }
      profileOrdinalByKey.set(key, ordinal);
    }
  }

  if (categories.mappingSets) {
    const existingSets = await tx.mappingSet.findMany({
      where: { projectId },
      include: { rules: true },
    });
    const mappingSetByName = new Map<
      string,
      { id: string; sourceProfileId: string; destinationProfileId: string; ruleDestinationIds: Set<string> }
    >();
    for (const set of existingSets) {
      mappingSetByName.set(set.name.toLowerCase().trim(), {
        id: set.id,
        sourceProfileId: set.sourceProfileId,
        destinationProfileId: set.destinationProfileId,
        ruleDestinationIds: new Set(set.rules.map((rule) => rule.destinationFieldId)),
      });
    }

    for (let msIndex = 0; msIndex < draft.mappingSets.length; msIndex += 1) {
      if (!includeIndex(selection.mappingSetIndexes, msIndex)) continue;
      const draftSet = draft.mappingSets[msIndex];
      const sourceProfileId = profileIdByKey.get(profileKey("source", draftSet.sourceProfileName));
      const destinationProfileId = profileIdByKey.get(profileKey("destination", draftSet.destinationProfileName));
      if (!sourceProfileId || !destinationProfileId) {
        result.warnings.push(
          `Mapping set "${draftSet.name}" skipped — could not resolve ${
            !sourceProfileId ? `source profile "${draftSet.sourceProfileName}"` : `destination profile "${draftSet.destinationProfileName}"`
          }.`,
        );
        result.skippedRules += draftSet.rules.length;
        continue;
      }
      let entry = mappingSetByName.get(draftSet.name.toLowerCase().trim());
      if (!entry) {
        const created = await tx.mappingSet.create({
          data: {
            projectId,
            name: draftSet.name,
            sourceProfileId,
            destinationProfileId,
            direction: draftSet.direction,
            status: draftSet.status,
          },
        });
        entry = {
          id: created.id,
          sourceProfileId,
          destinationProfileId,
          ruleDestinationIds: new Set<string>(),
        };
        mappingSetByName.set(draftSet.name.toLowerCase().trim(), entry);
        result.createdMappingSets += 1;
      } else {
        result.reusedMappingSets += 1;
      }

      const ruleSelection = selection.ruleIndexesByMappingSet?.[String(msIndex)];
      for (let ruleIndex = 0; ruleIndex < draftSet.rules.length; ruleIndex += 1) {
        if (!includeIndex(ruleSelection, ruleIndex)) continue;
        const draftRule = draftSet.rules[ruleIndex];
        const destinationFieldId = fieldIdByKey.get(
          fieldKey(entry.destinationProfileId, draftRule.destinationFieldName),
        );
        if (!destinationFieldId) {
          result.warnings.push(
            `Rule for destination "${draftRule.destinationFieldName}" in set "${draftSet.name}" skipped — destination field not found.`,
          );
          result.skippedRules += 1;
          continue;
        }
        if (entry.ruleDestinationIds.has(destinationFieldId)) {
          result.warnings.push(
            `Rule for destination "${draftRule.destinationFieldName}" in set "${draftSet.name}" skipped — destination already mapped.`,
          );
          result.skippedRules += 1;
          continue;
        }
        const sourceFieldId = draftRule.sourceFieldName
          ? fieldIdByKey.get(fieldKey(entry.sourceProfileId, draftRule.sourceFieldName))
          : undefined;
        await tx.mappingRule.create({
          data: {
            mappingSetId: entry.id,
            sourceFieldId: sourceFieldId ?? null,
            destinationFieldId,
            mappingType: draftRule.mappingType,
            expression: draftRule.expression ?? null,
            defaultValue: draftRule.defaultValue ?? null,
            comment: draftRule.comment ?? null,
          },
        });
        entry.ruleDestinationIds.add(destinationFieldId);
        result.createdRules += 1;
      }
    }
  }

  if (categories.sections) {
    const existingSections = await tx.fmdSection.findMany({ where: { projectId } });
    let maxOrder = existingSections.reduce((max, section) => Math.max(max, section.sortOrder), 0);
    const existingSectionKeys = new Set(
      existingSections.map((section) => `${section.sectionType}::${section.title.toLowerCase().trim()}`),
    );
    for (let index = 0; index < draft.fmdSections.length; index += 1) {
      if (!includeIndex(selection.sectionIndexes, index)) continue;
      const draftSection = draft.fmdSections[index];
      const key = `${draftSection.sectionType}::${draftSection.title.toLowerCase().trim()}`;
      if (existingSectionKeys.has(key)) {
        result.warnings.push(`Section "${draftSection.title}" (${draftSection.sectionType}) already exists; skipped.`);
        continue;
      }
      existingSectionKeys.add(key);
      maxOrder += 1;
      const normalizedType = normalizeSectionType(draftSection.sectionType);
      await tx.fmdSection.create({
        data: {
          projectId,
          title: draftSection.title,
          sectionType: normalizedType === "legacy" ? draftSection.sectionType : normalizedType,
          contentJson: JSON.stringify(draftSection.content),
          sortOrder: maxOrder,
        },
      });
      result.createdSections += 1;
    }
  }

  return result;
}

export type FmdApplyTestable = typeof applyFmdDraftInTransaction;
export const __testApplyFmdDraftInTransaction = applyFmdDraftInTransaction;
