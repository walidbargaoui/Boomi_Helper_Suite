import { describe, it, expect } from "vitest";
import { computeImportDiffs } from "@/lib/fmd-section-diff";
import type { Project, FmdSection } from "@/lib/domain";

function makeProject(sections: Partial<FmdSection>[] = []): Project {
  return {
    id: "proj-1",
    processId: "PROC-001",
    name: "Test",
    description: "",
    sourceSystem: "SAP",
    destinationSystem: "SF",
    owner: "Alice",
    schedule: "",
    status: "draft",
    createdAt: "",
    updatedAt: "",
    endpoints: [],
    profiles: [],
    mappingSets: [],
    processFlows: [],
    fmdSections: sections.map((s, i) => ({
      id: `sec-${i}`,
      projectId: "proj-1",
      title: s.title ?? `Section ${i}`,
      sectionType: s.sectionType ?? "appendix",
      sortOrder: i,
      content: s.content ?? {},
    })),
    boomiConnections: [],
    boomiDrafts: [],
    boomiPublishEvents: [],
  };
}

function makeDraft(sections: Array<{ sectionType: string; title: string; content?: Record<string, unknown> }>) {
  return {
    project: { processId: "", name: "", sourceSystem: "", destinationSystem: "" },
    profiles: [],
    mappingSets: [],
    fmdSections: sections.map((s) => ({
      sectionType: s.sectionType,
      title: s.title,
      content: s.content ?? { schemaVersion: 1, data: {} },
      revisionLog: [],
      warnings: [],
    })),
    endpoints: [],
    warnings: [],
    unresolvedEvidenceRefs: [],
  };
}

describe("computeImportDiffs", () => {
  it("returns new sections when project has none", () => {
    const project = makeProject();
    const draft = makeDraft([
      { sectionType: "projectSummary", title: "Summary" },
      { sectionType: "endpointDetails", title: "Endpoints" },
    ]);
    const diffs = computeImportDiffs(project, draft as Parameters<typeof computeImportDiffs>[1]);
    expect(diffs).toHaveLength(2);
    expect(diffs.every((d) => d.changed)).toBe(true);
    expect(diffs.every((d) => d.currentData === null)).toBe(true);
  });

  it("detects unchanged sections", () => {
    const project = makeProject([
      { sectionType: "projectSummary", title: "Summary", content: { data: { linkedProcessId: "P1" } } },
    ]);
    const draft = makeDraft([
      { sectionType: "projectSummary", title: "Summary", content: { data: { linkedProcessId: "P1" } } },
    ]);
    const diffs = computeImportDiffs(project, draft as Parameters<typeof computeImportDiffs>[1]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].changed).toBe(false);
  });

  it("detects changed sections", () => {
    const project = makeProject([
      { sectionType: "projectSummary", title: "Summary", content: { data: { linkedProcessId: "P1" } } },
    ]);
    const draft = makeDraft([
      { sectionType: "projectSummary", title: "Summary", content: { data: { linkedProcessId: "P2" } } },
    ]);
    const diffs = computeImportDiffs(project, draft as Parameters<typeof computeImportDiffs>[1]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].changed).toBe(true);
  });
});

import { parseFmdSectionContent, createDefaultFmdSection, validateFmdSection, computeSectionHash } from "@/lib/fmd-section-helpers";

describe("parseFmdSectionContent", () => {
  it("handles V1 wrapper", () => {
    const result = parseFmdSectionContent({ schemaVersion: 1, sourceMode: "manual", data: { x: 1 } });
    expect(result.sourceMode).toBe("manual");
    expect((result.data as Record<string, number>).x).toBe(1);
  });
  it("wraps plain objects", () => {
    const result = parseFmdSectionContent({ x: 1 });
    expect(result.sourceMode).toBe("legacy");
    expect(result.data).toEqual({ x: 1 });
  });
});

describe("createDefaultFmdSection", () => {
  it("creates a section with linked entities", () => {
    const project = makeProject();
    const section = createDefaultFmdSection(project, "projectSummary");
    const content = parseFmdSectionContent(section.content);
    expect(content.linkedEntities.length).toBeGreaterThan(0);
    expect(content.linkedEntities[0].entityType).toBe("project");
  });
});

describe("validateFmdSection", () => {
  it("flags empty title", () => {
    const section: FmdSection = {
      id: "s", projectId: "p", title: "  ", sectionType: "projectSummary",
      sortOrder: 0, content: {},
    };
    const result = validateFmdSection(section);
    expect(result.valid).toBe(false);
  });
});

describe("computeSectionHash", () => {
  it("is consistent", () => {
    expect(computeSectionHash({ a: 1 })).toBe(computeSectionHash({ a: 1 }));
  });
});

import { getSectionTypeMeta, getAllSectionTypes, isKnownSectionType } from "@/lib/fmd-section-registry";

describe("fmd-section-registry", () => {
  it("has 17 section types (16 canonical + legacy)", () => {
    const types = getAllSectionTypes();
    expect(types).toHaveLength(17);
  });
  it("marks projectSummary as required", () => {
    expect(getSectionTypeMeta("projectSummary").required).toBe(true);
  });
  it("legacy is not required", () => {
    expect(getSectionTypeMeta("legacy").required).toBe(false);
  });
  it("isKnownSectionType works", () => {
    expect(isKnownSectionType("projectSummary")).toBe(true);
    expect(isKnownSectionType("bogus")).toBe(false);
  });
});

import { getEditor, registerEditor } from "@/lib/fmd-editor-registry";

describe("fmd-editor-registry", () => {
  it("returns null for unregistered type", () => {
    expect(getEditor("nonexistent")).toBeNull();
  });
  it("returns component for registered type", () => {
    const Dummy = () => null;
    registerEditor("appendix", Dummy as never);
    expect(getEditor("appendix")).toBe(Dummy);
  });
});

import { getExportRenderer, registerExportRenderer } from "@/lib/fmd-export-renderers";

describe("fmd-export-renderers", () => {
  it("returns null for unregistered type", () => {
    expect(getExportRenderer("nonexistent")).toBeNull();
  });
  it("returns renderer for registered type", () => {
    const Dummy = () => null;
    registerExportRenderer("appendix", Dummy as never);
    expect(getExportRenderer("appendix")).toBe(Dummy);
  });
});
