import { z } from "zod";

const buildEndpointFieldRefSchema = z.object({
  localFieldId: z.string(),
  name: z.string(),
  label: z.string().optional(),
  description: z.string().optional(),
  dataType: z.string(),
  length: z.string().optional(),
  required: z.boolean(),
  keyField: z.boolean(),
  format: z.string().optional(),
  sample: z.string().optional(),
  ordinal: z.number(),
  parentPath: z.string().optional(),
});

const buildProfileRefSchema = z.object({
  localProfileId: z.string(),
  name: z.string(),
  role: z.enum(["source", "destination"]),
  type: z.string(),
  format: z.string(),
  rootPath: z.string().optional(),
  fields: z.array(buildEndpointFieldRefSchema),
});

const buildEndpointSchema = z.object({
  localEndpointId: z.string(),
  name: z.string(),
  role: z.string(),
  connectorType: z.string(),
  profileType: z.string(),
  format: z.string(),
  purpose: z.string(),
  connectionInfo: z.string(),
});

const buildMappingRuleSchema = z.object({
  localRuleId: z.string(),
  sourceFieldId: z.string().optional(),
  destinationFieldId: z.string(),
  sourceFieldName: z.string().optional(),
  destinationFieldName: z.string().optional(),
  mappingType: z.string(),
  expression: z.string().optional(),
  defaultValue: z.string().optional(),
  comment: z.string().optional(),
  qualityStatus: z.string().optional(),
  reviewed: z.boolean(),
});

const buildTransformNodeSchema = z.object({
  localNodeId: z.string(),
  label: z.string(),
  nodeType: z.string(),
  config: z.record(z.string(), z.string()),
  position: z.object({ x: z.number(), y: z.number() }),
});

const buildMappingSetSchema = z.object({
  localMappingSetId: z.string(),
  name: z.string(),
  sourceProfileRef: z.string(),
  destinationProfileRef: z.string(),
  direction: z.string(),
  status: z.string(),
  rules: z.array(buildMappingRuleSchema),
  transformNodes: z.array(buildTransformNodeSchema),
});

const buildProcessFlowNodeSchema = z.object({
  localNodeId: z.string(),
  type: z.string(),
  label: z.string(),
  description: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
});

const buildProcessFlowEdgeSchema = z.object({
  localEdgeId: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
});

const buildProcessFlowSchema = z.object({
  localFlowId: z.string(),
  name: z.string(),
  nodes: z.array(buildProcessFlowNodeSchema),
  edges: z.array(buildProcessFlowEdgeSchema),
  notes: z.string().optional(),
});

const buildFmdSectionSummarySchema = z.object({
  localSectionId: z.string(),
  sectionType: z.string(),
  title: z.string(),
  contentSummary: z.string(),
  buildEvidence: z.array(z.string()),
});

const buildImportedBoomiComponentSchema = z.object({
  localDraftId: z.string(),
  name: z.string(),
  componentType: z.string(),
  boomiComponentId: z.string().optional(),
  version: z.string().optional(),
  hasTemplateXml: z.boolean(),
});

const buildImportedBoomiContextSchema = z.object({
  components: z.array(buildImportedBoomiComponentSchema),
  dependencyNotes: z.array(z.string()),
});

const readinessCheckSchema = z.object({
  category: z.string(),
  status: z.enum(["ok", "warning", "error"]),
  message: z.string(),
  details: z.array(z.string()).optional(),
});

const buildReadinessReportSchema = z.object({
  checks: z.array(readinessCheckSchema),
  overallStatus: z.enum(["ready", "incomplete", "blocked"]),
});

const buildProjectSummarySchema = z.object({
  processId: z.string(),
  name: z.string(),
  description: z.string(),
  sourceSystem: z.string(),
  destinationSystem: z.string(),
  status: z.string(),
  folder: z.string().optional(),
  owner: z.string(),
  schedule: z.string().optional(),
  localProjectId: z.string(),
});

const buildTargetIntentSchema = z.object({
  goal: z.string(),
  integrationPattern: z.string(),
  notes: z.string().optional(),
});

export const boomiBuildSpecSchema = z.object({
  schemaVersion: z.literal("1.0"),
  generatedAt: z.string(),
  sourceApp: z.literal("Boomi Helper Suite"),
  project: buildProjectSummarySchema,
  target: buildTargetIntentSchema,
  endpoints: z.array(buildEndpointSchema),
  profiles: z.array(buildProfileRefSchema),
  mappingSets: z.array(buildMappingSetSchema),
  processFlows: z.array(buildProcessFlowSchema),
  fmdSections: z.array(buildFmdSectionSummarySchema),
  importedBoomiContext: buildImportedBoomiContextSchema,
  readiness: buildReadinessReportSchema,
  acceptanceCriteria: z.array(z.string()),
  openQuestions: z.array(z.string()),
});

export type BoomiBuildSpecInput = z.infer<typeof boomiBuildSpecSchema>;

const companionResultComponentSchema = z.object({
  localAppEntityId: z.string().optional(),
  componentId: z.string(),
  componentName: z.string(),
  componentType: z.string(),
  action: z.enum(["created", "updated", "reused"]),
  version: z.string().optional(),
  filePath: z.string().optional(),
});

const companionResultDeploymentSchema = z.object({
  environmentId: z.string().optional(),
  status: z.string(),
  deployedAt: z.string().optional(),
});

const companionResultTestSchema = z.object({
  name: z.string(),
  status: z.string(),
  summary: z.string().optional(),
});

export const companionResultSchema = z.object({
  schemaVersion: z.string(),
  packageId: z.string(),
  runTimestamp: z.string(),
  agentTool: z.string(),
  boomiAccountId: z.string().optional(),
  targetEnvironmentId: z.string().optional(),
  components: z.object({
    created: z.array(companionResultComponentSchema),
    updated: z.array(companionResultComponentSchema),
    reused: z.array(companionResultComponentSchema),
  }),
  deployments: z.array(companionResultDeploymentSchema),
  tests: z.array(companionResultTestSchema),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  openFollowUps: z.array(z.string()),
});

export type CompanionResultInput = z.infer<typeof companionResultSchema>;

const companionAgentPlanComponentSchema = z.object({
  localAppEntityId: z.string(),
  name: z.string(),
  componentType: z.string(),
  source: z.enum([
    "profile",
    "endpoint",
    "operation",
    "mappingSet",
    "processFlow",
    "importedBoomiContext",
  ]),
  action: z.enum(["create", "update", "reuse", "blocked"]),
  matchedBoomiComponentId: z.string().optional(),
  matchedBoomiComponentName: z.string().optional(),
  reason: z.string(),
  risk: z.enum(["low", "medium", "high"]),
});

export const companionAgentRunPlanSchema = z.object({
  schemaVersion: z.literal("1.0"),
  runId: z.string(),
  packageId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  status: z.enum([
    "preflight_running",
    "approval_required",
    "agent_running",
    "agent_completed",
    "agent_failed",
    "blocked",
  ]),
  selectedConnection: z.object({
    id: z.string(),
    accountId: z.string(),
    environmentName: z.string(),
    mode: z.enum(["mock", "sandbox"]),
  }),
  targetFolder: z.object({
    name: z.string().optional(),
    folderId: z.string().optional(),
    status: z.enum(["found", "created", "missing", "not_specified", "error"]),
    detail: z.string().optional(),
  }),
  proposedComponents: z.array(companionAgentPlanComponentSchema),
  unresolvedQuestions: z.array(z.string()),
  warnings: z.array(z.string()),
  agentCommandConfigured: z.boolean(),
});

export type CompanionAgentRunPlanInput = z.infer<typeof companionAgentRunPlanSchema>;
