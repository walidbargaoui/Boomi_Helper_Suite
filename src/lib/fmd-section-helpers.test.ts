import { describe, it, expect } from "vitest";
import {
  parseFmdSectionContent,
  validateFmdSection,
  createDefaultFmdSection,
  deriveSectionData,
  computeSectionHash,
} from "@/lib/fmd-section-helpers";
import type { Project, FmdSection } from "@/lib/domain";

function makeProject(partial: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    processId: "PROC-001",
    name: "Test Project",
    description: "A test project",
    sourceSystem: "SAP",
    destinationSystem: "Salesforce",
    owner: "Alice",
    schedule: "Daily 02:00",
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    endpoints: [],
    profiles: [],
    mappingSets: [],
    processFlows: [],
    fmdSections: [],
    boomiConnections: [],
    boomiDrafts: [],
    boomiPublishEvents: [],
    ...partial,
  };
}

function makeSection(partial: Partial<FmdSection> = {}): FmdSection {
  return {
    id: "sec-1",
    projectId: "proj-1",
    title: "Test Section",
    sectionType: "projectSummary",
    sortOrder: 0,
    content: {},
    ...partial,
  };
}

describe("parseFmdSectionContent", () => {
  it("parses valid V1 wrapper", () => {
    const raw = {
      schemaVersion: 1,
      sourceMode: "derived",
      exportEnabled: true,
      linkedEntities: [],
      data: { key: "value" },
    };
    const parsed = parseFmdSectionContent(raw);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.sourceMode).toBe("derived");
    expect(parsed.data).toEqual({ key: "value" });
  });

  it("wraps legacy plain object into V1", () => {
    const raw = { oldField: "oldValue" };
    const parsed = parseFmdSectionContent(raw);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.sourceMode).toBe("legacy");
    expect(parsed.data).toEqual({ oldField: "oldValue" });
  });

  it("handles null", () => {
    const parsed = parseFmdSectionContent(null);
    expect(parsed.sourceMode).toBe("legacy");
    expect(parsed.data).toEqual({});
  });
});

describe("validateFmdSection", () => {
  it("validates a well-formed project summary", () => {
    const section = makeSection({
      sectionType: "projectSummary",
      content: {
        schemaVersion: 1,
        sourceMode: "derived",
        data: { linkedProcessId: "PROC-001" },
      },
    });
    const result = validateFmdSection(section);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("flags empty title", () => {
    const section = makeSection({ title: "  " });
    const result = validateFmdSection(section);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Title"))).toBe(true);
  });

  it("normalizes unknown section type to legacy", () => {
    const section = makeSection({ sectionType: "bogus" as "projectSummary" });
    const result = validateFmdSection(section);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("createDefaultFmdSection", () => {
  it("creates a project summary with linked fields", () => {
    const project = makeProject();
    const section = createDefaultFmdSection(project, "projectSummary");
    expect(section.title).toBe("Project Summary");
    expect(section.sectionType).toBe("projectSummary");
    const content = parseFmdSectionContent(section.content);
    expect(content.sourceMode).toBe("derived");
    expect((content.data as Record<string, unknown>).linkedProcessId).toBe("PROC-001");
  });

  it("uses override title and data when provided", () => {
    const project = makeProject();
    const section = createDefaultFmdSection(project, "projectSummary", {
      overrideTitle: "Custom Title",
      overrideData: { custom: true },
    });
    expect(section.title).toBe("Custom Title");
    const content = parseFmdSectionContent(section.content);
    expect((content.data as Record<string, unknown>).custom).toBe(true);
  });
});

describe("deriveSectionData", () => {
  it("derives endpoint details from project endpoints", () => {
    const project = makeProject({
      endpoints: [
        {
          id: "ep-1",
          projectId: "proj-1",
          name: "ERP Inbound",
          role: "source",
          connectorType: "Flat File",
          profileType: "Flat File",
          format: "CSV",
          purpose: "Inbound orders",
          connectionInfo: "",
        },
      ],
    });
    const data = deriveSectionData(project, "endpointDetails") as { endpoints: unknown[] };
    expect(data.endpoints).toHaveLength(1);
    expect(data.endpoints[0]).toMatchObject({ name: "ERP Inbound", role: "source" });
  });

  it("derives quality checklist with project-aware checks", () => {
    const project = makeProject({ endpoints: [], processFlows: [], boomiDrafts: [] });
    const data = deriveSectionData(project, "qualityChecklist") as { items: Array<{ check: string; passed: boolean | undefined }> };
    expect(data.items.length).toBeGreaterThan(0);
    const endpointsItem = data.items.find((i) => i.check === "Endpoints documented");
    expect(endpointsItem?.passed).toBe(false);
  });
});

describe("computeSectionHash", () => {
  it("returns consistent hash for same object", () => {
    const data = { a: 1, b: "two" };
    expect(computeSectionHash(data)).toBe(computeSectionHash(data));
  });

  it("returns different hash for different objects", () => {
    const h1 = computeSectionHash({ a: 1 });
    const h2 = computeSectionHash({ a: 2 });
    expect(h1).not.toBe(h2);
  });
});
