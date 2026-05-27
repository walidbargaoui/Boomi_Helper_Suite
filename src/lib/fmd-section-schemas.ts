import { z } from "zod";

/**
 * Base wrapper schema for all FMD section content.
 * Every section content JSON must conform to this wrapper.
 */
export const fmdSectionContentSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  sourceMode: z.enum(["manual", "derived", "mixed", "imported", "legacy"]).default("manual"),
  exportEnabled: z.boolean().default(true),
  linkedEntities: z
    .array(
      z.object({
        entityType: z.enum([
          "project",
          "endpoint",
          "profile",
          "profileField",
          "mappingSet",
          "mappingRule",
          "processFlow",
          "processFlowNode",
          "boomiDraft",
        ]),
        entityId: z.string(),
        label: z.string().optional(),
      }),
    )
    .default([]),
  staleState: z
    .object({
      isStale: z.boolean(),
      lastSyncedAt: z.string().optional(),
      sourceHash: z.string().optional(),
      currentHash: z.string().optional(),
      changedPaths: z.array(z.string()).optional(),
    })
    .optional(),
  overrides: z.record(z.string(), z.unknown()).optional(),
  data: z.unknown(),
});

export type FmdSectionContentV1 = z.infer<typeof fmdSectionContentSchema>;

// ---------------------------------------------------------------------------
// Section-specific data schemas
// ---------------------------------------------------------------------------

export const documentControlDataSchema = z.object({
  revisions: z
    .array(
      z.object({
        version: z.string(),
        date: z.string(),
        author: z.string(),
        reviewer: z.string().optional(),
        changeSummary: z.string(),
        status: z.string().optional(),
      }),
    )
    .default([]),
});

export const projectSummaryDataSchema = z.object({
  fmdTitle: z.string().optional(),
  documentVersion: z.string().optional(),
  classification: z.string().optional(),
  customerOrTeam: z.string().optional(),
  preparedBy: z.string().optional(),
  reviewedBy: z.string().optional(),
  approvedBy: z.string().optional(),
  linkedProcessId: z.string().optional(),
  linkedProcessName: z.string().optional(),
  linkedSourceSystem: z.string().optional(),
  linkedDestinationSystem: z.string().optional(),
  linkedOwner: z.string().optional(),
  linkedSchedule: z.string().optional(),
  linkedStatus: z.string().optional(),
  overrides: z.record(z.string(), z.unknown()).default({}),
});

export const purposeScopeDataSchema = z.object({
  purpose: z.string().optional(),
  inScope: z.array(z.string()).default([]),
  outOfScope: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  openQuestions: z
    .array(
      z.object({
        question: z.string(),
        owner: z.string().optional(),
        status: z.string().optional(),
        dueDate: z.string().optional(),
      }),
    )
    .default([]),
});

export const integrationOverviewDataSchema = z.object({
  narrative: z.string().optional(),
  direction: z.string().optional(),
  sourceSystem: z.string().optional(),
  destinationSystem: z.string().optional(),
  schedule: z.string().optional(),
  frequency: z.string().optional(),
  triggerType: z.string().optional(),
  dataVolume: z.string().optional(),
  sla: z.string().optional(),
  latency: z.string().optional(),
  linkedProcessFlowId: z.string().optional(),
});

export const endpointDetailsDataSchema = z.object({
  endpoints: z
    .array(
      z.object({
        role: z.string(),
        name: z.string(),
        connectorType: z.string(),
        profileType: z.string(),
        format: z.string(),
        purpose: z.string().optional(),
        authNotes: z.string().optional(),
        environmentNotes: z.string().optional(),
        linkedEndpointId: z.string().optional(),
      }),
    )
    .default([]),
});

export const profileInventoryDataSchema = z.object({
  profiles: z
    .array(
      z.object({
        role: z.string(),
        name: z.string(),
        type: z.string(),
        format: z.string(),
        rootPath: z.string().optional(),
        fieldCount: z.number().optional(),
        keyFields: z.array(z.string()).default([]),
        requiredCount: z.number().optional(),
        notes: z.string().optional(),
        linkedProfileId: z.string().optional(),
        includeFieldDictionary: z.boolean().default(false),
      }),
    )
    .default([]),
});

export const fieldDictionaryDataSchema = z.object({
  linkedProfileId: z.string().optional(),
  fields: z
    .array(
      z.object({
        parentPath: z.string().optional(),
        name: z.string(),
        label: z.string().optional(),
        description: z.string().optional(),
        dataType: z.string().optional(),
        length: z.string().optional(),
        required: z.boolean().optional(),
        key: z.boolean().optional(),
        format: z.string().optional(),
        sample: z.string().optional(),
        notes: z.string().optional(),
        linkedFieldId: z.string().optional(),
      }),
    )
    .default([]),
});

export const fieldMappingDataSchema = z.object({
  linkedMappingSetId: z.string().optional(),
  rules: z
    .array(
      z.object({
        destinationPath: z.string().optional(),
        destinationField: z.string(),
        destinationRequired: z.boolean().optional(),
        destinationType: z.string().optional(),
        sourcePath: z.string().optional(),
        sourceField: z.string().optional(),
        sourceType: z.string().optional(),
        mappingType: z.string(),
        expression: z.string().optional(),
        defaultValue: z.string().optional(),
        transformationNotes: z.string().optional(),
        businessRule: z.string().optional(),
        reviewed: z.boolean().default(false),
        qualityStatus: z.string().optional(),
        linkedRuleId: z.string().optional(),
      }),
    )
    .default([]),
});

export const transformationDetailsDataSchema = z.object({
  transformations: z
    .array(
      z.object({
        name: z.string(),
        businessDescription: z.string().optional(),
        lookupSource: z.string().optional(),
        fallbackBehavior: z.string().optional(),
        errorBehavior: z.string().optional(),
        examples: z.string().optional(),
        linkedTransformNodeId: z.string().optional(),
        linkedMappingRuleId: z.string().optional(),
      }),
    )
    .default([]),
});

export const processFlowDataSchema = z.object({
  linkedProcessFlowId: z.string().optional(),
  steps: z
    .array(
      z.object({
        stepNumber: z.number(),
        shapeType: z.string(),
        label: z.string(),
        description: z.string().optional(),
        nextStep: z.string().optional(),
        branchLabel: z.string().optional(),
        narrative: z.string().optional(),
        businessBehavior: z.string().optional(),
        errorBehavior: z.string().optional(),
        operationNotes: z.string().optional(),
        linkedNodeId: z.string().optional(),
      }),
    )
    .default([]),
});

export const errorHandlingDataSchema = z.object({
  retryPolicy: z.string().optional(),
  failureRouting: z.string().optional(),
  notifications: z.string().optional(),
  loggingAudit: z.string().optional(),
  duplicateHandling: z.string().optional(),
  validationFailureBehavior: z.string().optional(),
  partialFailureRules: z.string().optional(),
  operationalOwner: z.string().optional(),
});

export const environmentConfigDataSchema = z.object({
  environments: z
    .array(
      z.object({
        environment: z.string(),
        boomiAccount: z.string().optional(),
        boomiEnvironment: z.string().optional(),
        endpointBaseUrl: z.string().optional(),
        authMode: z.string().optional(),
        connectorSettingsRef: z.string().optional(),
        processPropertyValues: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .default([]),
});

export const testCasesDataSchema = z.object({
  cases: z
    .array(
      z.object({
        caseId: z.string(),
        scenario: z.string(),
        inputProfile: z.string().optional(),
        expectedOutput: z.string().optional(),
        mappingRulesCovered: z.array(z.string()).default([]),
        status: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .default([]),
});

export const qualityChecklistDataSchema = z.object({
  items: z
    .array(
      z.object({
        check: z.string(),
        passed: z.boolean().optional(),
        owner: z.string().optional(),
        status: z.string().optional(),
        comments: z.string().optional(),
      }),
    )
    .default([]),
});

export const boomiComponentsDataSchema = z.object({
  components: z
    .array(
      z.object({
        name: z.string(),
        componentType: z.string(),
        componentId: z.string().optional(),
        templateImported: z.boolean().optional(),
        validationStatus: z.string().optional(),
        dependencies: z.array(z.string()).default([]),
        publishReadiness: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .default([]),
});

export const appendixDataSchema = z.object({
  references: z.array(z.string()).default([]),
  glossary: z.record(z.string(), z.string()).default({}),
  workbookEvidence: z.string().optional(),
  resolverPrompt: z.string().optional(),
  resolverResponse: z.string().optional(),
});

/** Catch-all for legacy or unknown section types. */
export const legacyDataSchema = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------------------
// Section type discriminator
// ---------------------------------------------------------------------------

export const sectionTypeSchema = z.enum([
  "documentControl",
  "projectSummary",
  "purposeScope",
  "integrationOverview",
  "endpointDetails",
  "profileInventory",
  "fieldDictionary",
  "fieldMapping",
  "transformationDetails",
  "processFlow",
  "errorHandling",
  "environmentConfig",
  "testCases",
  "qualityChecklist",
  "boomiComponents",
  "appendix",
  "legacy",
]);

export type FmdSectionType = z.infer<typeof sectionTypeSchema>;

const legacyTypeMap: Record<string, FmdSectionType> = {
  documentLog: "documentControl",
  explanation: "purposeScope",
  overview: "integrationOverview",
  environment: "environmentConfig",
  jobHandling: "errorHandling",
  sample: "testCases",
  reference: "appendix",
  fieldMapping: "fieldMapping",
};

export function normalizeSectionType(sectionType: string): FmdSectionType {
  if (isKnownSectionType(sectionType)) return sectionType as FmdSectionType;
  return legacyTypeMap[sectionType] ?? "legacy";
}

function isKnownSectionType(sectionType: string): boolean {
  const result = sectionTypeSchema.safeParse(sectionType);
  return result.success;
}
