import type { Project, FmdSection } from "@/lib/domain";
import { z } from "zod";
import {
  fmdSectionContentSchema,
  type FmdSectionContentV1,
  normalizeSectionType,
  documentControlDataSchema,
  projectSummaryDataSchema,
  purposeScopeDataSchema,
  integrationOverviewDataSchema,
  endpointDetailsDataSchema,
  profileInventoryDataSchema,
  fieldDictionaryDataSchema,
  fieldMappingDataSchema,
  transformationDetailsDataSchema,
  processFlowDataSchema,
  errorHandlingDataSchema,
  environmentConfigDataSchema,
  testCasesDataSchema,
  qualityChecklistDataSchema,
  boomiComponentsDataSchema,
  appendixDataSchema,
  legacyDataSchema,
  type FmdSectionType,
} from "@/lib/fmd-section-schemas";
import { getSectionTypeMeta } from "@/lib/fmd-section-registry";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Section-specific data schema map
// ---------------------------------------------------------------------------

const dataSchemaByType: Record<FmdSectionType, z.ZodType<unknown>> = {
  documentControl: documentControlDataSchema,
  projectSummary: projectSummaryDataSchema,
  purposeScope: purposeScopeDataSchema,
  integrationOverview: integrationOverviewDataSchema,
  endpointDetails: endpointDetailsDataSchema,
  profileInventory: profileInventoryDataSchema,
  fieldDictionary: fieldDictionaryDataSchema,
  fieldMapping: fieldMappingDataSchema,
  transformationDetails: transformationDetailsDataSchema,
  processFlow: processFlowDataSchema,
  errorHandling: errorHandlingDataSchema,
  environmentConfig: environmentConfigDataSchema,
  testCases: testCasesDataSchema,
  qualityChecklist: qualityChecklistDataSchema,
  boomiComponents: boomiComponentsDataSchema,
  appendix: appendixDataSchema,
  legacy: legacyDataSchema,
};

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Parse raw FMD section content JSON into the typed V1 wrapper.
 * Returns the wrapper with the `data` field as-is (section-specific validation
 * can be done separately via `validateSectionData`).
 *
 * If parsing fails, returns a legacy wrapper that preserves the original content.
 */
export function parseFmdSectionContent(raw: unknown): FmdSectionContentV1 {
  if (typeof raw !== "object" || raw === null) {
    return {
      schemaVersion: 1,
      sourceMode: "legacy",
      exportEnabled: true,
      linkedEntities: [],
      data: raw ?? {},
    };
  }

  const parsed = fmdSectionContentSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }

  // Try to coerce legacy content (plain object without wrapper) into V1
  const obj = raw as Record<string, unknown>;
  if ("schemaVersion" in obj) {
    // Has schemaVersion but failed validation — log and wrap as legacy
    logger.warn("FMD section content wrapper validation failed", { issues: parsed.error.issues });
  }

  return {
    schemaVersion: 1,
    sourceMode: "legacy",
    exportEnabled: true,
    linkedEntities: [],
    data: raw,
  };
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

export interface SectionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate an FMD section's content data against its section-type schema.
 */
export function validateFmdSection(section: FmdSection): SectionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const normalizedType = normalizeSectionType(section.sectionType);

  const content = parseFmdSectionContent(section.content);
  const schema = dataSchemaByType[normalizedType];
  const dataResult = schema.safeParse(content.data);

  if (!dataResult.success) {
    for (const issue of dataResult.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
  }

  if (!section.title.trim()) {
    errors.push("Title is required");
  }

  const meta = getSectionTypeMeta(normalizedType);
  if (meta.required) {
    const hasContent =
      content.data !== null &&
      content.data !== undefined &&
      (typeof content.data !== "object" || Object.keys(content.data as object).length > 0);
    if (!hasContent) {
      warnings.push(`Required section "${meta.displayLabel}" appears empty`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Create default
// ---------------------------------------------------------------------------

export interface CreateSectionOptions {
  sourceMode?: FmdSectionContentV1["sourceMode"];
  overrideTitle?: string;
  overrideData?: unknown;
}

/**
 * Create a default FMD section for a given section type.
 */
export function createDefaultFmdSection(
  project: Project,
  sectionType: FmdSectionType,
  options: CreateSectionOptions = {},
): Omit<FmdSection, "id" | "createdAt" | "updatedAt"> & { projectId: string } {
  const meta = getSectionTypeMeta(sectionType);
  const data = options.overrideData ?? deriveSectionData(project, sectionType);

  const sourceHash = computeSectionHash(data);

  return {
    projectId: project.id,
    title: options.overrideTitle ?? meta.defaultTitle,
    sectionType,
    sortOrder: 0, // caller should recompute
    content: {
      schemaVersion: 1,
      sourceMode: options.sourceMode ?? "derived",
      exportEnabled: true,
      linkedEntities: deriveLinkedEntities(project, sectionType),
      data,
      staleState: {
        isStale: false,
        lastSyncedAt: new Date().toISOString(),
        sourceHash,
        currentHash: sourceHash,
      },
    } as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Derive
// ---------------------------------------------------------------------------

/**
 * Derive default data for a section type from current project state.
 */
export function deriveSectionData(project: Project, sectionType: FmdSectionType): unknown {
  switch (sectionType) {
    case "documentControl": {
      return {
        revisions: [
          {
            version: "1.0",
            date: new Date().toISOString().slice(0, 10),
            author: project.owner || "",
            changeSummary: "Initial document creation",
          },
        ],
      };
    }

    case "projectSummary": {
      return {
        linkedProcessId: project.processId,
        linkedProcessName: project.name,
        linkedSourceSystem: project.sourceSystem ?? "",
        linkedDestinationSystem: project.destinationSystem ?? "",
        linkedOwner: project.owner ?? "",
        linkedSchedule: project.schedule ?? "",
        linkedStatus: project.status,
      };
    }

    case "purposeScope": {
      return {
        purpose: project.description ?? "",
        inScope: [],
        outOfScope: [],
        assumptions: [],
        dependencies: [],
        openQuestions: [],
      };
    }

    case "integrationOverview": {
      return {
        narrative: project.description ?? "",
        sourceSystem: project.sourceSystem ?? "",
        destinationSystem: project.destinationSystem ?? "",
        linkedProcessFlowId: project.processFlows[0]?.id,
      };
    }

    case "endpointDetails": {
      return {
        endpoints: project.endpoints.map((ep) => ({
          role: ep.role,
          name: ep.name,
          connectorType: ep.connectorType,
          profileType: ep.profileType,
          format: ep.format,
          purpose: ep.purpose,
          linkedEndpointId: ep.id,
        })),
      };
    }

    case "profileInventory": {
      return {
        profiles: project.profiles.map((profile) => ({
          role: profile.role,
          name: profile.name,
          type: profile.type,
          format: profile.format,
          rootPath: profile.rootPath ?? "",
          fieldCount: profile.fields.length,
          keyFields: profile.fields.filter((f) => f.keyField).map((f) => f.name),
          requiredCount: profile.fields.filter((f) => f.required).length,
          linkedProfileId: profile.id,
          includeFieldDictionary: false,
        })),
      };
    }

    case "fieldDictionary": {
      const firstProfile = project.profiles[0];
      return {
        linkedProfileId: firstProfile?.id,
        fields:
          firstProfile?.fields.map((field) => ({
            parentPath: field.parentPath ?? "",
            name: field.name,
            label: field.label ?? "",
            description: field.description ?? "",
            dataType: field.dataType ?? "",
            length: field.length ?? "",
            required: field.required,
            key: field.keyField,
            format: field.format ?? "",
            sample: field.sample ?? "",
            notes: field.description ?? "",
            linkedFieldId: field.id,
          })) ?? [],
      };
    }

    case "fieldMapping": {
      const firstMappingSet = project.mappingSets[0];
      const sourceProfile = project.profiles.find((p) => p.id === firstMappingSet?.sourceProfileId);
      const destinationProfile = project.profiles.find((p) => p.id === firstMappingSet?.destinationProfileId);
      const sourceFields = new Map(sourceProfile?.fields.map((f) => [f.id, f]) ?? []);
      const destFields = new Map(destinationProfile?.fields.map((f) => [f.id, f]) ?? []);
      return {
        linkedMappingSetId: firstMappingSet?.id,
        rules:
          firstMappingSet?.rules.map((rule) => {
            const srcField = rule.sourceFieldId ? sourceFields.get(rule.sourceFieldId) : undefined;
            const dstField = destFields.get(rule.destinationFieldId);
            return {
              destinationPath: dstField?.parentPath ?? "",
              destinationField: dstField?.name ?? "",
              destinationRequired: dstField?.required ?? false,
              destinationType: dstField?.dataType ?? "",
              sourcePath: srcField?.parentPath ?? "",
              sourceField: srcField?.name ?? "",
              sourceType: srcField?.dataType ?? "",
              mappingType: rule.mappingType,
              expression: rule.expression ?? "",
              defaultValue: rule.defaultValue ?? "",
              transformationNotes: rule.comment ?? "",
              linkedRuleId: rule.id,
            };
          }) ?? [],
      };
    }

    case "transformationDetails": {
      return {
        transformations: project.processFlows.flatMap((flow) =>
          flow.nodes
            .filter(
              (node) =>
                node.type === "map" ||
                node.type === "programcmd" ||
                node.type === "retrievefromcache" ||
                node.type === "addtocache",
            )
            .map((node) => ({
              name: node.label ?? node.type,
              businessDescription: "",
              linkedTransformNodeId: node.id,
            })),
        ),
      };
    }

    case "processFlow": {
      const flow = project.processFlows[0];
      return {
        linkedProcessFlowId: flow?.id,
        steps:
          flow?.nodes.map((node, index) => ({
            stepNumber: index + 1,
            shapeType: node.type,
            label: node.label ?? node.type,
            description: node.description ?? "",
            linkedNodeId: node.id,
          })) ?? [],
      };
    }

    case "errorHandling": {
      return {
        retryPolicy: "",
        failureRouting: "",
        notifications: "",
        loggingAudit: "",
        duplicateHandling: "",
        validationFailureBehavior: "",
        partialFailureRules: "",
        operationalOwner: project.owner ?? "",
      };
    }

    case "environmentConfig": {
      return {
        environments: [
          { environment: "DEV", notes: "" },
          { environment: "QAS", notes: "" },
          { environment: "UAT", notes: "" },
          { environment: "PROD", notes: "" },
        ],
      };
    }

    case "testCases": {
      return {
        cases: [],
      };
    }

    case "qualityChecklist": {
      return {
        items: buildDefaultChecklist(project),
      };
    }

    case "boomiComponents": {
      return {
        components: project.boomiDrafts.map((draft) => ({
          name: draft.componentName ?? draft.componentId,
          componentType: draft.componentType,
          componentId: draft.componentId,
          templateImported: draft.validationStatus === "Ready",
          validationStatus: draft.validationStatus,
        })),
      };
    }

    case "appendix": {
      return {
        references: [],
        glossary: {},
      };
    }

    case "legacy": {
      return {};
    }

    default: {
      const _exhaustive: never = sectionType;
      logger.warn("Unhandled section type in deriveSectionData", { sectionType: _exhaustive });
      return {};
    }
  }
}

function deriveLinkedEntities(project: Project, sectionType: FmdSectionType): FmdSectionContentV1["linkedEntities"] {
  switch (sectionType) {
    case "projectSummary":
    case "integrationOverview":
      return [{ entityType: "project", entityId: project.id, label: project.name }];
    case "endpointDetails":
      return project.endpoints.map((ep) => ({
        entityType: "endpoint" as const,
        entityId: ep.id,
        label: ep.name,
      }));
    case "profileInventory":
    case "fieldDictionary":
      return project.profiles.map((p) => ({
        entityType: "profile" as const,
        entityId: p.id,
        label: p.name,
      }));
    case "fieldMapping":
      return project.mappingSets.map((ms) => ({
        entityType: "mappingSet" as const,
        entityId: ms.id,
        label: ms.name,
      }));
    case "transformationDetails":
    case "processFlow":
      return project.processFlows.map((f) => ({
        entityType: "processFlow" as const,
        entityId: f.id,
        label: f.name,
      }));
    case "boomiComponents":
      return project.boomiDrafts.map((d) => ({
        entityType: "boomiDraft" as const,
        entityId: d.id,
        label: d.componentName ?? d.componentId,
      }));
    default:
      return [];
  }
}

function buildDefaultChecklist(project: Project): unknown[] {
  const items = [
    { check: "All required destinations mapped", passed: undefined as boolean | undefined },
    { check: "No duplicate destination mappings", passed: undefined },
    { check: "No type mismatch errors", passed: undefined },
    { check: "All function/lookup rules have business comments", passed: undefined },
    { check: "Endpoints documented", passed: project.endpoints.length > 0 },
    { check: "Environment rows present", passed: undefined },
    { check: "Error handling documented", passed: undefined },
    { check: "Test cases present", passed: undefined },
    { check: "Process flow exists", passed: project.processFlows.length > 0 },
    { check: "Boomi templates imported when publish intended", passed: project.boomiDrafts.length > 0 },
  ];
  return items;
}

// ---------------------------------------------------------------------------
// Hash / stale detection
// ---------------------------------------------------------------------------

/**
 * Stable JSON stringify that sorts keys recursively at all nesting levels.
 */
function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return "";
}

/**
 * Compute a simple hash for a value (used for stale detection).
 * Uses recursive stable stringify to handle nested keys.
 * Not cryptographically secure — for UI comparison only.
 */
export function computeSectionHash(data: unknown): string {
  try {
    const str = stableStringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return String(hash);
  } catch {
    return "";
  }
}
