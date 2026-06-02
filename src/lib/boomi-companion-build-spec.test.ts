import { describe, it, expect } from "vitest";
import { buildBoomiBuildSpec } from "@/lib/boomi-companion-build-spec";
import { sampleProject } from "@/lib/sample-data";
import type { Project } from "@/lib/domain";

function minimalProject(): Project {
  return {
    id: "test-proj",
    processId: "TEST001",
    name: "Test Integration",
    description: "",
    sourceSystem: "",
    destinationSystem: "",
    status: "Draft",
    owner: "",
    endpoints: [],
    profiles: [],
    mappingSets: [],
    processFlows: [],
    fmdSections: [],
    boomiConnections: [],
    boomiDrafts: [],
  };
}

describe("buildBoomiBuildSpec", () => {
  it("generates a valid spec from the sample project", () => {
    const spec = buildBoomiBuildSpec(sampleProject);

    expect(spec.schemaVersion).toBe("1.0");
    expect(spec.sourceApp).toBe("Boomi Helper Suite");
    expect(spec.generatedAt).toBeTruthy();

    expect(spec.project.processId).toBe("SRSN001");
    expect(spec.project.localProjectId).toBe("project-seiren-order-in");

    expect(spec.endpoints).toHaveLength(3);
    expect(spec.endpoints[0].localEndpointId).toBe("ep-sharepoint");

    expect(spec.profiles).toHaveLength(2);
    expect(spec.profiles[0].fields).toHaveLength(9);
    expect(spec.profiles[0].fields[0].name).toBe("購買伝票番号");

    expect(spec.mappingSets).toHaveLength(1);
    expect(spec.mappingSets[0].rules).toHaveLength(9);
    expect(spec.mappingSets[0].rules[0].destinationFieldName).toBeTruthy();

    expect(spec.processFlows).toHaveLength(1);
    expect(spec.processFlows[0].nodes).toHaveLength(8);
    expect(spec.processFlows[0].edges).toHaveLength(8);

    expect(spec.fmdSections).toHaveLength(4);

    expect(spec.importedBoomiContext.components).toHaveLength(2);

    expect(spec.readiness.checks.length).toBeGreaterThan(0);
    expect(spec.acceptanceCriteria.length).toBeGreaterThan(0);
    expect(spec.openQuestions.length).toBeGreaterThan(0);
  });

  it("contains no XML in the build spec", () => {
    const spec = buildBoomiBuildSpec(sampleProject);
    const json = JSON.stringify(spec);

    expect(json).not.toContain("<bns:Component");
    expect(json).not.toContain("proposedXml");
    expect(json).not.toContain("templateXml");
  });

  it("contains no credentials in the build spec", () => {
    const spec = buildBoomiBuildSpec(sampleProject);
    const json = JSON.stringify(spec);

    expect(json).not.toContain("mock-password");
    expect(json).not.toContain("mock-username");
    expect(json).not.toContain("apiPassword");
    expect(json).not.toContain("apiUsername");
  });

  it("treats missing Boomi templates as create-from-scratch guidance, not an open question", () => {
    const spec = buildBoomiBuildSpec(sampleProject);

    expect(spec.openQuestions.join("\n")).not.toContain("have no Boomi template");
    expect(spec.importedBoomiContext.dependencyNotes.join("\n")).toContain("create from scratch by default");
  });

  it("preserves Japanese text in field names", () => {
    const spec = buildBoomiBuildSpec(sampleProject);
    const json = JSON.stringify(spec);

    expect(json).toContain("購買伝票番号");
    expect(json).toContain("会社コード");
    expect(json).toContain("伝票日付");
  });

  it("handles empty project gracefully", () => {
    const spec = buildBoomiBuildSpec(minimalProject());

    expect(spec.schemaVersion).toBe("1.0");
    expect(spec.endpoints).toHaveLength(0);
    expect(spec.profiles).toHaveLength(0);
    expect(spec.mappingSets).toHaveLength(0);
    expect(spec.processFlows).toHaveLength(0);
    expect(spec.fmdSections).toHaveLength(0);
    expect(spec.importedBoomiContext.components).toHaveLength(0);
    expect(spec.readiness.overallStatus).toBe("blocked");
    expect(spec.openQuestions.length).toBeGreaterThan(0);
  });

  it("flags missing required destination fields as readiness errors", () => {
    const proj = minimalProject();
    proj.profiles = [
      {
        id: "src",
        name: "Source",
        role: "source",
        type: "Flat File",
        format: "CSV",
        fields: [],
      },
      {
        id: "dst",
        name: "Dest",
        role: "destination",
        type: "JSON",
        format: "JSON",
        fields: [
          {
            id: "req1",
            name: "required_field",
            dataType: "String",
            required: true,
            keyField: false,
            ordinal: 1,
          },
        ],
      },
    ];
    proj.mappingSets = [
      {
        id: "ms1",
        name: "Map",
        sourceProfileId: "src",
        destinationProfileId: "dst",
        direction: "inbound",
        status: "Draft",
        rules: [],
        transformNodes: [],
      },
    ];

    const spec = buildBoomiBuildSpec(proj);
    const mappingCheck = spec.readiness.checks.find(
      (c) =>
        c.status === "error" &&
        c.message.includes("required destination field")
    );
    expect(mappingCheck).toBeDefined();
  });

  it("reports ready status when all checks pass", () => {
    const proj = minimalProject();
    proj.profiles = [
      {
        id: "src",
        name: "Source",
        role: "source",
        type: "Flat File",
        format: "CSV",
        fields: [
          {
            id: "f1",
            name: "source_field",
            dataType: "String",
            required: false,
            keyField: false,
            ordinal: 1,
          },
        ],
      },
      {
        id: "dst",
        name: "Dest",
        role: "destination",
        type: "JSON",
        format: "JSON",
        fields: [
          {
            id: "f2",
            name: "dest_field",
            dataType: "String",
            required: true,
            keyField: false,
            ordinal: 1,
          },
        ],
      },
    ];
    proj.mappingSets = [
      {
        id: "ms1",
        name: "Map",
        sourceProfileId: "src",
        destinationProfileId: "dst",
        direction: "inbound",
        status: "Ready for Boomi",
        rules: [
          {
            id: "r1",
            sourceFieldId: "f1",
            destinationFieldId: "f2",
            mappingType: "direct",
            reviewed: true,
            qualityStatus: "ok",
          },
        ],
        transformNodes: [],
      },
    ];
    proj.processFlows = [
      {
        id: "pf1",
        name: "Main",
        nodes: [
          {
            id: "n1",
            type: "start",
            label: "Start",
            description: "",
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      },
    ];
    proj.endpoints = [
      {
        id: "e1",
        name: "Source EP",
        role: "source",
        connectorType: "HTTP",
        profileType: "Flat File",
        format: "CSV",
        purpose: "",
        connectionInfo: "http://example.com",
      },
      {
        id: "e2",
        name: "Dest EP",
        role: "destination",
        connectorType: "HTTP",
        profileType: "JSON",
        format: "JSON",
        purpose: "",
        connectionInfo: "http://example.com",
      },
    ];
    proj.folder = "/Test";
    proj.fmdSections = [
      {
        id: "s1",
        title: "Overview",
        sectionType: "overview",
        content: {},
        sortOrder: 1,
      },
    ];

    const spec = buildBoomiBuildSpec(proj);
    expect(spec.readiness.overallStatus).toBe("ready");
  });
});
