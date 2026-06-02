import type { FmdSection } from "@/lib/domain";
import type { Project } from "@/lib/domain";
import { parseFmdSectionContent } from "@/lib/fmd-section-helpers";

export interface ExportSheetData {
  sheetName: string;
  headers: string[];
  rows: string[][];
}

type SectionRenderer = (section: FmdSection, project: Project) => ExportSheetData | null;

const rendererMap = new Map<string, SectionRenderer>();

export function registerExportRenderer(sectionType: string, renderer: SectionRenderer): void {
  rendererMap.set(sectionType, renderer);
}

export function getExportRenderer(sectionType: string): SectionRenderer | null {
  return rendererMap.get(sectionType) ?? null;
}

// ---------------------------------------------------------------------------
// documentControl → "Document Log"
// ---------------------------------------------------------------------------

const documentControlRenderer: SectionRenderer = (section) => {
  const wrapper = parseFmdSectionContent(section.content);
  const data = wrapper.data as { revisions?: Array<{ version: string; date: string; author: string; reviewer?: string; changeSummary: string; status?: string }> };
  const revisions = data.revisions ?? [];
  if (revisions.length === 0) return null;

  return {
    sheetName: "Document Log",
    headers: ["Version", "Date", "Author", "Reviewer", "Change Summary", "Status"],
    rows: revisions.map((r) => [
      r.version ?? "",
      r.date ?? "",
      r.author ?? "",
      r.reviewer ?? "",
      r.changeSummary ?? "",
      r.status ?? "",
    ]),
  };
};

registerExportRenderer("documentControl", documentControlRenderer);

// ---------------------------------------------------------------------------
// projectSummary → "Project Summary"
// ---------------------------------------------------------------------------

const projectSummaryRenderer: SectionRenderer = (section, project) => {
  const wrapper = parseFmdSectionContent(section.content);
  const data = wrapper.data as {
    linkedProcessId?: string;
    linkedProcessName?: string;
    linkedSourceSystem?: string;
    linkedDestinationSystem?: string;
    linkedOwner?: string;
    linkedSchedule?: string;
    linkedStatus?: string;
    fmdTitle?: string;
    documentVersion?: string;
    classification?: string;
  };

  const rows: string[][] = [];

  const fieldValue = (label: string, value: string | undefined | null): void => {
    rows.push([label, value ?? ""]);
  };

  fieldValue("Process ID", data.linkedProcessId ?? project.processId);
  fieldValue("Project Name", data.linkedProcessName ?? project.name);
  fieldValue("Source System", data.linkedSourceSystem ?? project.sourceSystem);
  fieldValue("Destination System", data.linkedDestinationSystem ?? project.destinationSystem);
  fieldValue("Owner", data.linkedOwner ?? project.owner);
  fieldValue("Schedule", data.linkedSchedule ?? project.schedule);
  fieldValue("Status", data.linkedStatus ?? project.status);
  fieldValue("FMD Title", data.fmdTitle);
  fieldValue("Document Version", data.documentVersion);
  fieldValue("Classification", data.classification);

  if (rows.length === 0) return null;

  return {
    sheetName: "Project Summary",
    headers: ["Field", "Value"],
    rows,
  };
};

registerExportRenderer("projectSummary", projectSummaryRenderer);

// ---------------------------------------------------------------------------
// endpointDetails → "Endpoints"
// ---------------------------------------------------------------------------

const endpointDetailsRenderer: SectionRenderer = (section) => {
  const wrapper = parseFmdSectionContent(section.content);
  const data = wrapper.data as {
    endpoints?: Array<{
      role: string;
      name: string;
      connectorType: string;
      profileType: string;
      format: string;
      purpose?: string;
      authNotes?: string;
      environmentNotes?: string;
    }>;
  };
  const endpoints = data.endpoints ?? [];
  if (endpoints.length === 0) return null;

  return {
    sheetName: "Endpoints",
    headers: ["Role", "Name", "Connector Type", "Profile Type", "Format", "Purpose", "Auth Notes", "Environment Notes"],
    rows: endpoints.map((ep) => [
      ep.role ?? "",
      ep.name ?? "",
      ep.connectorType ?? "",
      ep.profileType ?? "",
      ep.format ?? "",
      ep.purpose ?? "",
      ep.authNotes ?? "",
      ep.environmentNotes ?? "",
    ]),
  };
};

registerExportRenderer("endpointDetails", endpointDetailsRenderer);

// ---------------------------------------------------------------------------
// profileInventory → "Profiles"
// ---------------------------------------------------------------------------

const profileInventoryRenderer: SectionRenderer = (section) => {
  const wrapper = parseFmdSectionContent(section.content);
  const data = wrapper.data as {
    profiles?: Array<{
      role: string;
      name: string;
      type: string;
      format: string;
      rootPath?: string;
      fieldCount?: number;
      keyFields?: string[];
      requiredCount?: number;
      notes?: string;
    }>;
  };
  const profiles = data.profiles ?? [];
  if (profiles.length === 0) return null;

  return {
    sheetName: "Profiles",
    headers: ["Role", "Name", "Type", "Format", "Root Path", "Field Count", "Key Fields", "Required Count", "Notes"],
    rows: profiles.map((p) => [
      p.role ?? "",
      p.name ?? "",
      p.type ?? "",
      p.format ?? "",
      p.rootPath ?? "",
      String(p.fieldCount ?? ""),
      (p.keyFields ?? []).join(", "),
      String(p.requiredCount ?? ""),
      p.notes ?? "",
    ]),
  };
};

registerExportRenderer("profileInventory", profileInventoryRenderer);

// ---------------------------------------------------------------------------
// environmentConfig → "Environment Config"
// ---------------------------------------------------------------------------

const environmentConfigRenderer: SectionRenderer = (section) => {
  const wrapper = parseFmdSectionContent(section.content);
  const data = wrapper.data as {
    environments?: Array<{
      environment: string;
      boomiAccount?: string;
      boomiEnvironment?: string;
      endpointBaseUrl?: string;
      authMode?: string;
      notes?: string;
    }>;
  };
  const environments = data.environments ?? [];
  if (environments.length === 0) return null;

  return {
    sheetName: "Environment Config",
    headers: ["Environment", "Boomi Account", "Boomi Environment", "Endpoint URL", "Auth Mode", "Notes"],
    rows: environments.map((env) => [
      env.environment ?? "",
      env.boomiAccount ?? "",
      env.boomiEnvironment ?? "",
      env.endpointBaseUrl ?? "",
      env.authMode ?? "",
      env.notes ?? "",
    ]),
  };
};

registerExportRenderer("environmentConfig", environmentConfigRenderer);

// ---------------------------------------------------------------------------
// errorHandling → "Error Handling"
// ---------------------------------------------------------------------------

const errorHandlingRenderer: SectionRenderer = (section) => {
  const wrapper = parseFmdSectionContent(section.content);
  const data = wrapper.data as {
    retryPolicy?: string;
    failureRouting?: string;
    notifications?: string;
    loggingAudit?: string;
    duplicateHandling?: string;
    validationFailureBehavior?: string;
    partialFailureRules?: string;
    operationalOwner?: string;
  };

  const categories: Array<{ label: string; value: string | undefined }> = [
    { label: "Retry Policy", value: data.retryPolicy },
    { label: "Failure Routing", value: data.failureRouting },
    { label: "Notifications", value: data.notifications },
    { label: "Logging / Audit", value: data.loggingAudit },
    { label: "Duplicate Handling", value: data.duplicateHandling },
    { label: "Validation Failure Behavior", value: data.validationFailureBehavior },
    { label: "Partial Failure Rules", value: data.partialFailureRules },
    { label: "Operational Owner", value: data.operationalOwner },
  ];

  const rows = categories
    .filter((c) => c.value !== undefined && c.value !== "")
    .map((c) => [c.label, c.value!]);

  if (rows.length === 0) return null;

  return {
    sheetName: "Error Handling",
    headers: ["Category", "Detail"],
    rows,
  };
};

registerExportRenderer("errorHandling", errorHandlingRenderer);

// ---------------------------------------------------------------------------
// purposeScope → "Purpose & Scope"
// ---------------------------------------------------------------------------

const purposeScopeRenderer: SectionRenderer = (section) => {
  const wrapper = parseFmdSectionContent(section.content);
  const data = wrapper.data as {
    businessProblem?: string;
    businessObjective?: string;
    scope?: string;
    outOfScope?: string;
    stakeholders?: string;
    assumptions?: string;
  };
  const categories: Array<{ label: string; value: string | undefined }> = [
    { label: "Business Problem", value: data.businessProblem },
    { label: "Business Objective", value: data.businessObjective },
    { label: "Scope", value: data.scope },
    { label: "Out of Scope", value: data.outOfScope },
    { label: "Stakeholders", value: data.stakeholders },
    { label: "Assumptions", value: data.assumptions },
  ];
  const rows = categories.filter((c) => c.value).map((c) => [c.label, c.value!]);
  if (rows.length === 0) return null;
  return { sheetName: "Purpose & Scope", headers: ["Category", "Detail"], rows };
};

registerExportRenderer("purposeScope", purposeScopeRenderer);

// ---------------------------------------------------------------------------
// integrationOverview → "Integration Overview"
// ---------------------------------------------------------------------------

const integrationOverviewRenderer: SectionRenderer = (section, project) => {
  const wrapper = parseFmdSectionContent(section.content);
  const data = wrapper.data as {
    overview?: string;
    sourceSystem?: string;
    destinationSystem?: string;
    schedule?: string;
    dataFlowDescription?: string;
    endpoints?: Array<{ name: string; role: string; connectorType: string; profileType: string; format: string; purpose: string }>;
  };
  const rows: string[][] = [];
  const addRow = (label: string, value: string | undefined | null) => { if (value) rows.push([label, value]); };
  addRow("Overview", data.overview ?? project.description);
  addRow("Source System", data.sourceSystem ?? project.sourceSystem);
  addRow("Destination System", data.destinationSystem ?? project.destinationSystem);
  addRow("Schedule", data.schedule ?? project.schedule);
  addRow("Data Flow", data.dataFlowDescription);
  const endpoints = data.endpoints ?? [];
  if (endpoints.length > 0) {
    rows.push([]);
    rows.push(["Endpoint Name", "Role", "Connector Type", "Profile Type", "Format", "Purpose"]);
    for (const ep of endpoints) {
      rows.push([ep.name ?? "", ep.role ?? "", ep.connectorType ?? "", ep.profileType ?? "", ep.format ?? "", ep.purpose ?? ""]);
    }
  }
  if (rows.length === 0) return null;
  return { sheetName: "Integration Overview", headers: ["Field", "Value"], rows };
};

registerExportRenderer("integrationOverview", integrationOverviewRenderer);

// ---------------------------------------------------------------------------
// processFlow → "Process Flow"
// ---------------------------------------------------------------------------

const processFlowRenderer: SectionRenderer = (section, project) => {
  const flow = project.processFlows[0];
  if (!flow) return null;
  const wrapper = parseFmdSectionContent(section.content);
  const data = wrapper.data as { flowNotes?: string; };
  const rows: string[][] = [
    ["Step", "Type", "Label", "Description"],
    ...flow.nodes.map((node, i) => [String(i + 1), node.type, node.label, node.description]),
  ];
  if (flow.edges.length > 0) {
    rows.push([]);
    rows.push(["Edge ID", "Source", "Target", "Condition"]);
    for (const edge of flow.edges) {
      rows.push([edge.id, edge.source, edge.target, edge.label ?? ""]);
    }
  }
  if (data.flowNotes) {
    rows.push([]);
    rows.push(["Notes", data.flowNotes]);
  }
  return { sheetName: "Process Flow", headers: ["Step", "Type", "Label", "Description"], rows };
};

registerExportRenderer("processFlow", processFlowRenderer);

// ---------------------------------------------------------------------------
// fieldMapping → "Field Mapping Summary" (single-sheet overview)
// ---------------------------------------------------------------------------
// Note: Individual mapping-set sheets are created in exportFmdWorkbookFromSections.

const fieldMappingRenderer: SectionRenderer = (section, project) => {
  const wrapper = parseFmdSectionContent(section.content);
  const data = wrapper.data as { description?: string; strategy?: string; };
  const mappingSets = project.mappingSets;
  if (mappingSets.length === 0) return null;
  const rows: string[][] = [];
  if (data.description) rows.push(["Description", data.description]);
  if (data.strategy) rows.push(["Strategy", data.strategy]);
  rows.push([]);
  rows.push(["Mapping Set", "Source Profile", "Destination Profile", "Rules", "Status"]);
  for (const ms of mappingSets) {
    const src = project.profiles.find((p) => p.id === ms.sourceProfileId);
    const dst = project.profiles.find((p) => p.id === ms.destinationProfileId);
    rows.push([ms.name, src?.name ?? "", dst?.name ?? "", String(ms.rules.length), ms.status]);
  }
  return { sheetName: "Field Mapping Summary", headers: ["Item", "Value"], rows };
};

registerExportRenderer("fieldMapping", fieldMappingRenderer);

// ---------------------------------------------------------------------------
// fieldDictionary → "Field Dictionary"
// ---------------------------------------------------------------------------

const fieldDictionaryRenderer: SectionRenderer = (section, project) => {
  const wrapper = parseFmdSectionContent(section.content);
  const data = wrapper.data as { fields?: Array<{ name: string; type: string; description: string; source: string }> };
  const fields = data.fields ?? [];
  if (fields.length === 0) {
    // Fall back to listing fields from all profiles
    const profileFields: string[][] = [];
    for (const profile of project.profiles) {
      for (const f of profile.fields) {
        profileFields.push([f.name, f.dataType, f.description ?? f.label ?? "", profile.name]);
      }
    }
    if (profileFields.length === 0) return null;
    return { sheetName: "Field Dictionary", headers: ["Field Name", "Data Type", "Description", "Source Profile"], rows: profileFields };
  }
  return {
    sheetName: "Field Dictionary",
    headers: ["Field Name", "Data Type", "Description", "Source"],
    rows: fields.map((f) => [f.name, f.type, f.description, f.source]),
  };
};

registerExportRenderer("fieldDictionary", fieldDictionaryRenderer);

// ---------------------------------------------------------------------------
// transformationDetails → "Transformations"
// ---------------------------------------------------------------------------

const transformationDetailsRenderer: SectionRenderer = (section, project) => {
  const wrapper = parseFmdSectionContent(section.content);
  const data = wrapper.data as { functions?: Array<{ name: string; type: string; description: string; usedIn: string }> };
  const functions = data.functions ?? [];
  if (functions.length === 0) {
    const transformRows: string[][] = [];
    for (const ms of project.mappingSets) {
      const destProfile = project.profiles.find((p) => p.id === ms.destinationProfileId);
      for (const rule of ms.rules) {
        if (rule.mappingType === "function" || rule.mappingType === "lookup" || rule.mappingType === "join") {
          const destField = destProfile?.fields.find((f) => f.id === rule.destinationFieldId);
          transformRows.push([ms.name, destField?.name ?? rule.destinationFieldId, rule.mappingType, rule.expression ?? "", rule.comment ?? ""]);
        }
      }
    }
    if (transformRows.length === 0) return null;
    return {
      sheetName: "Transformations",
      headers: ["Mapping Set", "Destination Field", "Type", "Expression", "Comment"],
      rows: transformRows,
    };
  }
  return {
    sheetName: "Transformations",
    headers: ["Function Name", "Type", "Description", "Used In"],
    rows: functions.map((f) => [f.name, f.type, f.description, f.usedIn]),
  };
};

registerExportRenderer("transformationDetails", transformationDetailsRenderer);

// ---------------------------------------------------------------------------
// testCases → "Test Cases"
// ---------------------------------------------------------------------------

const testCasesRenderer: SectionRenderer = (section) => {
  const wrapper = parseFmdSectionContent(section.content);
  const data = wrapper.data as {
    testCases?: Array<{ id: string; name: string; scenario: string; inputData: string; expectedResult: string; status: string }>;
  };
  const testCases = data.testCases ?? [];
  if (testCases.length === 0) return null;
  return {
    sheetName: "Test Cases",
    headers: ["ID", "Name", "Scenario", "Input Data", "Expected Result", "Status"],
    rows: testCases.map((tc) => [tc.id, tc.name, tc.scenario, tc.inputData, tc.expectedResult, tc.status]),
  };
};

registerExportRenderer("testCases", testCasesRenderer);

// ---------------------------------------------------------------------------
// qualityChecklist → "Quality Checklist"
// ---------------------------------------------------------------------------

const qualityChecklistRenderer: SectionRenderer = (section) => {
  const wrapper = parseFmdSectionContent(section.content);
  const data = wrapper.data as {
    items?: Array<{ category: string; item: string; pass: boolean; notes: string }>;
  };
  const items = data.items ?? [];
  if (items.length === 0) return null;
  return {
    sheetName: "Quality Checklist",
    headers: ["Category", "Item", "Pass", "Notes"],
    rows: items.map((i) => [i.category, i.item, i.pass ? "PASS" : "FAIL", i.notes]),
  };
};

registerExportRenderer("qualityChecklist", qualityChecklistRenderer);

// ---------------------------------------------------------------------------
// boomiComponents → "Boomi Components"
// ---------------------------------------------------------------------------

const boomiComponentsRenderer: SectionRenderer = (section, project) => {
  const drafts = project.boomiDrafts;
  if (drafts.length === 0) return null;
  return {
    sheetName: "Boomi Components",
    headers: ["Component Type", "Component Name", "Component ID", "Validation Status", "Notes"],
    rows: drafts.map((d) => [d.componentType, d.componentName, d.componentId ?? "", d.validationStatus, d.notes ?? ""]),
  };
};

registerExportRenderer("boomiComponents", boomiComponentsRenderer);

// ---------------------------------------------------------------------------
// appendix → "Appendix"
// ---------------------------------------------------------------------------

const appendixRenderer: SectionRenderer = (section) => {
  const wrapper = parseFmdSectionContent(section.content);
  const data = wrapper.data as { sections?: Array<{ title: string; content: string }> };
  const sections = data.sections ?? [];
  if (sections.length === 0) return null;
  const rows: string[][] = [];
  for (const s of sections) {
    rows.push([s.title, s.content]);
  }
  return { sheetName: "Appendix", headers: ["Section", "Content"], rows };
};

registerExportRenderer("appendix", appendixRenderer);
