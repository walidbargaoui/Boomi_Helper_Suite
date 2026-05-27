import type { FmdSectionType } from "@/lib/fmd-section-schemas";

export interface SectionTypeMeta {
  sectionType: FmdSectionType;
  displayLabel: string;
  required: boolean;
  defaultTitle: string;
  description: string;
  icon?: string; // lucide icon name
}

const registry: Record<FmdSectionType, SectionTypeMeta> = {
  documentControl: {
    sectionType: "documentControl",
    displayLabel: "Document Control / Revision Log",
    required: false,
    defaultTitle: "Document Control",
    description: "Version history, authors, reviewers, and change summaries.",
    icon: "FileText",
  },
  projectSummary: {
    sectionType: "projectSummary",
    displayLabel: "Cover / Project Summary",
    required: true,
    defaultTitle: "Project Summary",
    description: "Process ID, name, systems, owner, schedule, status, and document metadata.",
    icon: "BookOpen",
  },
  purposeScope: {
    sectionType: "purposeScope",
    displayLabel: "Purpose / Scope / Assumptions",
    required: true,
    defaultTitle: "Purpose and Scope",
    description: "Purpose, in-scope, out-of-scope, assumptions, dependencies, and open questions.",
    icon: "Target",
  },
  integrationOverview: {
    sectionType: "integrationOverview",
    displayLabel: "Integration Overview",
    required: true,
    defaultTitle: "Integration Overview",
    description: "Narrative overview, direction, schedule, trigger, volume, SLA, and latency.",
    icon: "ArrowLeftRight",
  },
  endpointDetails: {
    sectionType: "endpointDetails",
    displayLabel: "Endpoint / Interface Details",
    required: true,
    defaultTitle: "Endpoint Details",
    description: "Source, destination, and reference endpoints with connector and format details.",
    icon: "Network",
  },
  profileInventory: {
    sectionType: "profileInventory",
    displayLabel: "Profile Inventory",
    required: true,
    defaultTitle: "Profile Inventory",
    description: "One row per profile with role, type, format, field count, and key fields.",
    icon: "Layers",
  },
  fieldDictionary: {
    sectionType: "fieldDictionary",
    displayLabel: "Field Dictionary",
    required: false,
    defaultTitle: "Field Dictionary",
    description: "Profile-specific field details: path, name, type, length, required, sample, notes.",
    icon: "List",
  },
  fieldMapping: {
    sectionType: "fieldMapping",
    displayLabel: "Field Mapping",
    required: true,
    defaultTitle: "Field Mapping",
    description: "Destination-to-source mappings with rules, types, expressions, and business notes.",
    icon: "GitCompare",
  },
  transformationDetails: {
    sectionType: "transformationDetails",
    displayLabel: "Transformation / Lookup Details",
    required: false,
    defaultTitle: "Transformation Details",
    description: "Function, lookup, and join rules with business descriptions and fallback behavior.",
    icon: "Wand2",
  },
  processFlow: {
    sectionType: "processFlow",
    displayLabel: "Process Flow",
    required: false,
    defaultTitle: "Process Flow",
    description: "Flow step list with shape type, label, description, and editable narrative.",
    icon: "Workflow",
  },
  errorHandling: {
    sectionType: "errorHandling",
    displayLabel: "Error Handling / Job Handling",
    required: true,
    defaultTitle: "Error Handling",
    description: "Retry policy, failure routing, notifications, duplicate handling, and operational owner.",
    icon: "ShieldAlert",
  },
  environmentConfig: {
    sectionType: "environmentConfig",
    displayLabel: "Environment / Deployment Configuration",
    required: false,
    defaultTitle: "Environment Configuration",
    description: "DEV, QAS, UAT, PROD environment rows with account, URL, auth, and property values.",
    icon: "Server",
  },
  testCases: {
    sectionType: "testCases",
    displayLabel: "Sample Data / Test Cases",
    required: false,
    defaultTitle: "Test Cases",
    description: "Repeatable test cases with scenario, input, expected output, and status.",
    icon: "FlaskConical",
  },
  qualityChecklist: {
    sectionType: "qualityChecklist",
    displayLabel: "Quality / Readiness Checklist",
    required: false,
    defaultTitle: "Quality Checklist",
    description: "Validation and readiness checks with owner, status, and comments per item.",
    icon: "ClipboardCheck",
  },
  boomiComponents: {
    sectionType: "boomiComponents",
    displayLabel: "Boomi Component / Dependency Notes",
    required: false,
    defaultTitle: "Boomi Components",
    description: "Component inventory from Boomi drafts with validation and publish readiness.",
    icon: "Cpu",
  },
  appendix: {
    sectionType: "appendix",
    displayLabel: "Appendix / References",
    required: false,
    defaultTitle: "Appendix",
    description: "References, glossary, workbook evidence, and resolver debug (gated).",
    icon: "Paperclip",
  },
  legacy: {
    sectionType: "legacy",
    displayLabel: "Legacy / Imported",
    required: false,
    defaultTitle: "Imported Section",
    description: "Content imported from a workbook that does not match a known section type.",
    icon: "Archive",
  },
};

export function getSectionTypeMeta(sectionType: FmdSectionType): SectionTypeMeta {
  return registry[sectionType];
}

export function getAllSectionTypes(): SectionTypeMeta[] {
  return Object.values(registry);
}

export function getRequiredSectionTypes(): SectionTypeMeta[] {
  return Object.values(registry).filter((meta) => meta.required);
}

export function isKnownSectionType(sectionType: string): sectionType is FmdSectionType {
  return sectionType in registry;
}
