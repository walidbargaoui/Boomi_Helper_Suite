import { z } from "zod";

export const confidenceSchema = z.coerce.number().min(0).max(1).default(0.5);
export const evidenceRefsSchema = z.array(z.string().min(1).max(100)).default([]);

export const fmdDraftFieldSchema = z.object({
  name: z.string().min(1).max(220),
  parentPath: z.string().max(500).optional(),
  label: z.string().max(220).optional(),
  description: z.string().max(1200).optional(),
  dataType: z.string().min(1).max(120).default("String"),
  length: z.string().max(120).optional(),
  required: z.boolean().default(false),
  keyField: z.boolean().default(false),
  format: z.string().max(160).optional(),
  sample: z.string().max(600).optional(),
  ordinal: z.number().int().min(0).default(0),
  confidence: confidenceSchema,
  evidenceRefs: evidenceRefsSchema,
});

export const fmdDraftProfileSchema = z.object({
  name: z.string().min(1).max(240),
  role: z.enum(["source", "destination"]),
  type: z.enum(["Flat File", "JSON", "XML", "Database", "API"]).default("Flat File"),
  format: z.string().min(1).max(160).default("Unknown"),
  rootPath: z.string().max(500).optional(),
  fields: z.array(fmdDraftFieldSchema).default([]),
  confidence: confidenceSchema,
  evidenceRefs: evidenceRefsSchema,
});

export const fmdDraftMappingRuleSchema = z.object({
  sourceProfileName: z.string().max(240).optional(),
  destinationProfileName: z.string().max(240).optional(),
  sourceFieldName: z.string().max(220).optional(),
  sourceParentPath: z.string().max(500).optional(),
  destinationFieldName: z.string().min(1).max(220),
  destinationParentPath: z.string().max(500).optional(),
  mappingType: z.enum(["direct", "constant", "lookup", "function", "join"]).default("direct"),
  expression: z.string().max(2000).optional(),
  defaultValue: z.string().max(1000).optional(),
  comment: z.string().max(2000).optional(),
  confidence: confidenceSchema,
  evidenceRefs: evidenceRefsSchema,
});

export const fmdParserStrategySchema = z.enum(["grouped", "generated"]);
export type FmdParserStrategy = z.infer<typeof fmdParserStrategySchema>;

export const fmdDraftMappingSetSchema = z.object({
  name: z.string().min(1).max(240),
  sourceProfileName: z.string().min(1).max(240),
  destinationProfileName: z.string().min(1).max(240),
  direction: z.string().max(240).default("source-to-destination"),
  status: z.enum(["Draft", "Validated", "Ready for Boomi"]).default("Draft"),
  rules: z.array(fmdDraftMappingRuleSchema).default([]),
  confidence: confidenceSchema,
  evidenceRefs: evidenceRefsSchema,
  warnings: z.array(z.string().max(500)).default([]),
  strategy: fmdParserStrategySchema.optional(),
});

export const fmdDraftEndpointSchema = z.object({
  name: z.string().min(1).max(220),
  role: z.enum(["source", "destination", "notification", "reference"]).default("reference"),
  connectorType: z.string().max(220).default("Unknown"),
  profileType: z.string().max(160).default("Unknown"),
  format: z.string().max(160).default("Unknown"),
  purpose: z.string().max(1200).default(""),
  connectionInfo: z.string().max(2200).default(""),
  confidence: confidenceSchema,
  evidenceRefs: evidenceRefsSchema,
});

export const fmdDraftProcessFlowNodeTypeSchema = z.enum([
  "start",
  "start-connector",
  "start-trading",
  "start-passthrough",
  "start-nodata",
  "connector",
  "map",
  "setproperties",
  "message",
  "notify",
  "programcmd",
  "subprocess",
  "processroute",
  "dataprocess",
  "agent",
  "branch",
  "route",
  "cleanse",
  "decision",
  "exception",
  "stop",
  "end",
  "return",
  "flowcontrol",
  "trycatch",
  "businessrules",
  "findchanges",
  "addtocache",
  "retrievefromcache",
  "removefromcache",
]);

export const fmdDraftProcessFlowNodeSchema = z.object({
  id: z.string().min(1).max(120),
  type: fmdDraftProcessFlowNodeTypeSchema,
  label: z.string().min(1).max(220),
  description: z.string().max(1200).default(""),
  position: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
  }),
});

export const fmdDraftProcessFlowEdgeSchema = z.object({
  id: z.string().min(1).max(120),
  source: z.string().min(1).max(120),
  target: z.string().min(1).max(120),
  label: z.string().max(220).optional(),
});

export const fmdDraftProcessFlowSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().min(1).max(240),
  nodes: z.array(fmdDraftProcessFlowNodeSchema).min(2).max(30),
  edges: z.array(fmdDraftProcessFlowEdgeSchema).min(1).max(60),
  notes: z.string().max(5000).optional(),
  confidence: confidenceSchema,
  evidenceRefs: evidenceRefsSchema,
});

export const fmdDraftSectionSchema = z.object({
  title: z.string().min(1).max(240),
  sectionType: z.enum([
    "documentLog",
    "explanation",
    "overview",
    "fieldMapping",
    "environment",
    "jobHandling",
    "sample",
    "reference",
  ]),
  sortOrder: z.number().int().min(0).default(0),
  content: z.record(z.string(), z.unknown()).default({}),
  confidence: confidenceSchema,
  evidenceRefs: evidenceRefsSchema,
});

export const fmdImportDraftSchema = z.object({
  project: z.object({
    processId: z.string().min(1).max(120),
    name: z.string().min(1).max(240),
    description: z.string().max(3000).default(""),
    sourceSystem: z.string().max(180).default("Unknown source"),
    destinationSystem: z.string().max(180).default("Unknown destination"),
    integrationPattern: z.string().max(200).optional(),
    owner: z.string().max(160).default("Unassigned"),
    schedule: z.string().max(240).optional(),
    status: z.enum(["Draft", "Mapping Review", "Ready for Sandbox", "Published"]).default("Draft"),
    confidence: confidenceSchema,
    evidenceRefs: evidenceRefsSchema,
  }),
  endpoints: z.array(fmdDraftEndpointSchema).default([]),
  profiles: z.array(fmdDraftProfileSchema).default([]),
  mappingSets: z.array(fmdDraftMappingSetSchema).default([]),
  processFlows: z.array(fmdDraftProcessFlowSchema).default([]),
  fmdSections: z.array(fmdDraftSectionSchema).default([]),
  warnings: z.array(z.string().max(700)).default([]),
  unresolvedEvidenceRefs: evidenceRefsSchema,
});

export type FmdImportDraft = z.infer<typeof fmdImportDraftSchema>;
export type FmdDraftProfile = z.infer<typeof fmdDraftProfileSchema>;
export type FmdDraftField = z.infer<typeof fmdDraftFieldSchema>;
export type FmdDraftMappingSet = z.infer<typeof fmdDraftMappingSetSchema>;
export type FmdDraftMappingRule = z.infer<typeof fmdDraftMappingRuleSchema>;
export type FmdDraftProcessFlow = z.infer<typeof fmdDraftProcessFlowSchema>;
