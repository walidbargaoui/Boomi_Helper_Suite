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
