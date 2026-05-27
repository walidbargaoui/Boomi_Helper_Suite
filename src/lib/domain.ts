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
