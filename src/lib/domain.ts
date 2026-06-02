export type Endpoint = {
  id: string;
  name: string;
  role: "source" | "destination" | "notification" | "reference";
  connectorType: string;
  profileType: string;
  format: string;
  purpose: string;
  connectionInfo: string;
};

export type ProfileField = {
  id: string;
  parentPath?: string;
  name: string;
  label?: string;
  description?: string;
  dataType: string;
  length?: string;
  required: boolean;
  keyField: boolean;
  format?: string;
  sample?: string;
  ordinal: number;
};

export type Profile = {
  id: string;
  name: string;
  role: "source" | "destination";
  type: "Flat File" | "JSON" | "XML" | "Database" | "API";
  format: string;
  rootPath?: string;
  fields: ProfileField[];
};

export type MappingRule = {
  id: string;
  sourceFieldId?: string;
  destinationFieldId: string;
  mappingType: "direct" | "constant" | "lookup" | "function" | "join";
  expression?: string;
  defaultValue?: string;
  comment?: string;
  qualityStatus?: "ok" | "warning" | "error" | "unchecked";
  reviewed?: boolean;
};

export type TransformNode = {
  id: string;
  label: string;
  nodeType: "format" | "lookup" | "script" | "combine" | "split";
  config: Record<string, string>;
  position: { x: number; y: number };
};

export type MappingSet = {
  id: string;
  name: string;
  sourceProfileId: string;
  destinationProfileId: string;
  direction: string;
  status: "Draft" | "Validated" | "Ready for Boomi";
  rules: MappingRule[];
  transformNodes: TransformNode[];
};

export type ProcessFlowNode = {
  id: string;
  type: "start" | "start-connector" | "start-trading" | "start-passthrough" | "start-nodata"
    | "connector" | "map" | "setproperties" | "message" | "notify" | "programcmd"
    | "subprocess" | "processroute" | "dataprocess" | "agent"
    | "branch" | "route" | "cleanse" | "decision" | "exception" | "stop" | "end" | "return" | "flowcontrol"
    | "trycatch" | "businessrules" | "findchanges" | "addtocache" | "retrievefromcache" | "removefromcache";
  label: string;
  description: string;
  position: { x: number; y: number };
};

export type ProcessFlowEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

export type ProcessFlow = {
  id: string;
  name: string;
  nodes: ProcessFlowNode[];
  edges: ProcessFlowEdge[];
  notes?: string;
};

export type FmdSection = {
  id: string;
  title: string;
  sectionType: string;
  content: Record<string, unknown>;
  sortOrder: number;
};

export type BoomiComponentDraft = {
  id: string;
  componentId: string;
  componentType:
    | "transform.map"
    | "transform.function"
    | "profile.flatfile"
    | "profile.xml"
    | "profile.json"
    | "profile.db"
    | "process"
    | "processproperty"
    | "connector-settings"
    | "connector-action";
  componentName: string;
  templateXml?: string;
  proposedXml: string;
  diff: string;
  validationStatus: "Needs template" | "Dry-run valid" | "Blocked" | "Ready";
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type BoomiConnection = {
  id: string;
  accountId: string;
  environmentName: string;
  baseUrl: string;
  authMode: "Basic API Token";
  apiUsername: string;
  apiPassword: string;
  mode: "mock" | "sandbox";
  createdAt: string;
};

export type LlmProviderType = "ollama" | "openai-compatible";

export type LlmProviderAuthMode = "none" | "optional" | "required";

export type LlmProvider = {
  id: string;
  name: string;
  type: LlmProviderType;
  baseUrl: string;
  model: string;
  authMode: LlmProviderAuthMode;
  apiKey: string;
  hasApiKey: boolean;
  enabled: boolean;
  isDefault: boolean;
  temperature: number;
  topP: number;
  maxTokens: number;
  timeoutMs: number;
  supportsJsonSchema: boolean;
  supportsModelList: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BoomiPublishEvent = {
  id: string;
  draftId: string;
  connectionId?: string;
  componentId: string;
  componentName: string;
  componentType: BoomiComponentDraft["componentType"];
  version?: number;
  action: "create" | "update";
  requestXml: string;
  responseXml?: string;
  status: "success" | "failed";
  errorDetail?: string;
  publishedAt: string;
};

export type BuildPackageStatus =
  | "draft"
  | "ready"
  | "downloaded"
  | "result_recorded"
  | "failed";

export type CompanionRunEventStatus =
  | "handoff_created"
  | "preflight_running"
  | "approval_required"
  | "agent_started"
  | "agent_running"
  | "agent_completed"
  | "agent_failed"
  | "blocked"
  | "manual_result_recorded";

export type CompanionAgentRunStatus =
  | "preflight_running"
  | "approval_required"
  | "agent_running"
  | "agent_completed"
  | "agent_failed"
  | "blocked";

export type CompanionAgentPlanAction = "create" | "update" | "reuse" | "blocked";

export type CompanionAgentPlanRisk = "low" | "medium" | "high";

export type CompanionAgentPlanComponent = {
  localAppEntityId: string;
  name: string;
  componentType: string;
  source:
    | "profile"
    | "endpoint"
    | "operation"
    | "mappingSet"
    | "processFlow"
    | "importedBoomiContext";
  action: CompanionAgentPlanAction;
  matchedBoomiComponentId?: string;
  matchedBoomiComponentName?: string;
  reason: string;
  risk: CompanionAgentPlanRisk;
};

export type CompanionAgentRunPlan = {
  schemaVersion: "1.0";
  runId: string;
  packageId: string;
  projectId: string;
  generatedAt: string;
  status: CompanionAgentRunStatus;
  selectedConnection: {
    id: string;
    accountId: string;
    environmentName: string;
    mode: "mock" | "sandbox";
  };
  targetFolder: {
    name?: string;
    folderId?: string;
    status: "found" | "created" | "missing" | "not_specified" | "error";
    detail?: string;
  };
  proposedComponents: CompanionAgentPlanComponent[];
  unresolvedQuestions: string[];
  warnings: string[];
  agentCommandConfigured: boolean;
};

export type BoomiBuildPackage = {
  id: string;
  projectId: string;
  status: BuildPackageStatus;
  specJson: string;
  manifestJson: string;
  readinessJson: string;
  resultJson?: string;
  runEvents: BoomiCompanionRunEvent[];
  createdAt: string;
  updatedAt: string;
};

export type BoomiCompanionRunEvent = {
  id: string;
  packageId: string;
  status: CompanionRunEventStatus;
  resultJson: string;
  createdAt: string;
  updatedAt: string;
};

export type CompanionResultComponent = {
  localAppEntityId?: string;
  componentId: string;
  componentName: string;
  componentType: string;
  action: "created" | "updated" | "reused";
  version?: string;
  filePath?: string;
};

export type CompanionResultDeployment = {
  environmentId?: string;
  status: string;
  deployedAt?: string;
};

export type CompanionResultTest = {
  name: string;
  status: string;
  summary?: string;
};

export type CompanionResult = {
  schemaVersion: string;
  packageId: string;
  runTimestamp: string;
  agentTool: string;
  boomiAccountId?: string;
  targetEnvironmentId?: string;
  components: {
    created: CompanionResultComponent[];
    updated: CompanionResultComponent[];
    reused: CompanionResultComponent[];
  };
  deployments: CompanionResultDeployment[];
  tests: CompanionResultTest[];
  warnings: string[];
  errors: string[];
  openFollowUps: string[];
};

export type Project = {
  id: string;
  processId: string;
  name: string;
  description: string;
  sourceSystem: string;
  destinationSystem: string;
  status: "Draft" | "Mapping Review" | "Ready for Sandbox" | "Published";
  folder?: string;
  version?: number;
  mode?: "live" | "fallback";
  owner: string;
  schedule?: string;
  lastExportedAt?: string;
  endpoints: Endpoint[];
  profiles: Profile[];
  mappingSets: MappingSet[];
  processFlows: ProcessFlow[];
  fmdSections: FmdSection[];
  boomiConnections: BoomiConnection[];
  boomiDrafts: BoomiComponentDraft[];
  boomiPublishEvents?: BoomiPublishEvent[];
};

export type MappingIssue = {
  id: string;
  severity: "error" | "warning" | "info";
  title: string;
  detail: string;
  fieldId?: string;
  ruleId?: string;
};

export type BuildProjectSummary = {
  processId: string;
  name: string;
  description: string;
  sourceSystem: string;
  destinationSystem: string;
  status: string;
  folder?: string;
  owner: string;
  schedule?: string;
  localProjectId: string;
};

export type BuildTargetIntent = {
  goal: string;
  integrationPattern: string;
  notes?: string;
};

export type BuildEndpointFieldRef = {
  localFieldId: string;
  name: string;
  label?: string;
  description?: string;
  dataType: string;
  length?: string;
  required: boolean;
  keyField: boolean;
  format?: string;
  sample?: string;
  ordinal: number;
  parentPath?: string;
};

export type BuildProfileRef = {
  localProfileId: string;
  name: string;
  role: "source" | "destination";
  type: string;
  format: string;
  rootPath?: string;
  fields: BuildEndpointFieldRef[];
};

export type BuildEndpoint = {
  localEndpointId: string;
  name: string;
  role: string;
  connectorType: string;
  profileType: string;
  format: string;
  purpose: string;
  connectionInfo: string;
};

export type BuildMappingRule = {
  localRuleId: string;
  sourceFieldId?: string;
  destinationFieldId: string;
  sourceFieldName?: string;
  destinationFieldName?: string;
  mappingType: string;
  expression?: string;
  defaultValue?: string;
  comment?: string;
  qualityStatus?: string;
  reviewed: boolean;
};

export type BuildTransformNode = {
  localNodeId: string;
  label: string;
  nodeType: string;
  config: Record<string, string>;
  position: { x: number; y: number };
};

export type BuildMappingSet = {
  localMappingSetId: string;
  name: string;
  sourceProfileRef: string;
  destinationProfileRef: string;
  direction: string;
  status: string;
  rules: BuildMappingRule[];
  transformNodes: BuildTransformNode[];
};

export type BuildProcessFlowNode = {
  localNodeId: string;
  type: string;
  label: string;
  description: string;
  position: { x: number; y: number };
};

export type BuildProcessFlowEdge = {
  localEdgeId: string;
  source: string;
  target: string;
  label?: string;
};

export type BuildProcessFlow = {
  localFlowId: string;
  name: string;
  nodes: BuildProcessFlowNode[];
  edges: BuildProcessFlowEdge[];
  notes?: string;
};

export type BuildFmdSectionSummary = {
  localSectionId: string;
  sectionType: string;
  title: string;
  contentSummary: string;
  buildEvidence: string[];
};

export type BuildImportedBoomiComponent = {
  localDraftId: string;
  name: string;
  componentType: string;
  boomiComponentId?: string;
  version?: string;
  hasTemplateXml: boolean;
};

export type BuildImportedBoomiContext = {
  components: BuildImportedBoomiComponent[];
  dependencyNotes: string[];
};

export type ReadinessCheck = {
  category: string;
  status: "ok" | "warning" | "error";
  message: string;
  details?: string[];
};

export type BuildReadinessReport = {
  checks: ReadinessCheck[];
  overallStatus: "ready" | "incomplete" | "blocked";
};

export type BoomiBuildSpec = {
  schemaVersion: "1.0";
  generatedAt: string;
  sourceApp: "Boomi Helper Suite";
  project: BuildProjectSummary;
  target: BuildTargetIntent;
  endpoints: BuildEndpoint[];
  profiles: BuildProfileRef[];
  mappingSets: BuildMappingSet[];
  processFlows: BuildProcessFlow[];
  fmdSections: BuildFmdSectionSummary[];
  importedBoomiContext: BuildImportedBoomiContext;
  readiness: BuildReadinessReport;
  acceptanceCriteria: string[];
  openQuestions: string[];
};

// ── Build Pipeline Types ──────────────────────────────────────────────

export type BuildPipelineStatus =
  | "pending"
  | "preflight"
  | "building"
  | "complete"
  | "failed";

export type BuildPipelinePhase =
  | "preflight"
  | "profile"
  | "connection"
  | "operation"
  | "map"
  | "process";

export type BuildComponentAction = "create" | "update" | "reuse";

export type BuildPlanComponent = {
  localId: string;
  name: string;
  componentType: string;
  action: BuildComponentAction;
  phase: BuildPipelinePhase;
  existingComponentId?: string;
  dependsOn: string[];
};

export type PushedComponentResult = {
  localId: string;
  componentId: string;
  componentName: string;
  componentType: string;
  action: BuildComponentAction;
};

export type BoomiBuildPipelineRun = {
  id: string;
  packageId: string;
  projectId: string;
  connectionId: string;
  status: BuildPipelineStatus;
  phase?: string;
  planJson: string;
  resultsJson: string;
  createdAt: string;
  updatedAt: string;
};
