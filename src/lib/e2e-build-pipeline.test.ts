import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/db";
import { seedSampleProject } from "@/lib/db";
import { buildBoomiBuildSpec } from "@/lib/boomi-companion-build-spec";
import {
  generateProfileXml,
  generateConnectionXml,
  generateOperationXml,
  generateMapXml,
  generateProcessXml,
  type ProfileKeyMap,
  type ProcessComponentRefs,
} from "@/lib/boomi-xml-engine";
import { generateBuildPlan } from "@/lib/boomi-build-pipeline";
import type { BoomiConnection, BuildMappingSet, Project } from "@/lib/domain";

describe("e2e: project-seiren-order-in (avaxia-9FCJIF)", () => {
  beforeAll(async () => {
    await seedSampleProject();
  });

  it("seeded project exists with expected data", async () => {
    const project = await prisma.project.findUnique({
      where: { processId: "SRSN001" },
      include: {
        endpoints: true,
        profiles: { include: { fields: { orderBy: { ordinal: "asc" } } } },
        mappingSets: { include: { rules: true } },
        processFlows: true,
      },
    });
    expect(project).toBeTruthy();
    expect(project!.id).toBe("project-seiren-order-in");
    expect(project!.name).toContain("Seiren");
    expect(project!.profiles.length).toBe(2);
    expect(project!.endpoints.length).toBe(3);
    expect(project!.mappingSets.length).toBe(1);
  });

  it("extracts a valid build spec", () => {
    const project: Project = {
      id: "project-seiren-order-in",
      processId: "SRSN001",
      name: "セーレン商事 受注_in",
      description: "",
      sourceSystem: "SharePoint",
      destinationSystem: "SMILE",
      status: "Draft" as const,
      owner: "",
      endpoints: [
        {
          id: "ep-sharepoint",
          name: "SharePoint",
          role: "source" as const,
          connectorType: "REST",
          profileType: "Flat File",
          format: "CSV",
          purpose: "GET data",
          connectionInfo: "",
        },
      ],
      profiles: [
        {
          id: "profile-source",
          name: "購買伝票（Source）",
          role: "source" as const,
          type: "Flat File" as const,
          format: "CSV",
          fields: [
            { id: "sf-1", parentPath: undefined, name: "購買伝票番号", dataType: "character", required: false, keyField: true, ordinal: 1 },
            { id: "sf-2", parentPath: undefined, name: "購買伝票日付", dataType: "datetime", required: false, keyField: false, ordinal: 2 },
          ],
        },
        {
          id: "profile-dest",
          name: "受注データ（Destination）",
          role: "destination" as const,
          type: "JSON" as const,
          format: "JSON",
          fields: [
            { id: "df-1", parentPath: undefined, name: "orderId", dataType: "character", required: true, keyField: true, ordinal: 1 },
            { id: "df-2", parentPath: undefined, name: "orderDate", dataType: "datetime", required: false, keyField: false, ordinal: 2 },
          ],
        },
      ],
      mappingSets: [
        {
          id: "ms-1",
          name: "受注マッピング",
          sourceProfileId: "profile-source",
          destinationProfileId: "profile-dest",
          direction: "source-to-dest",
          status: "Draft" as const,
          rules: [
            {
              id: "r-1",
              sourceFieldId: "sf-1",
              destinationFieldId: "df-1",
              mappingType: "direct" as const,
              qualityStatus: "unchecked" as const,
              reviewed: false,
            },
          ],
          transformNodes: [],
        },
      ],
      processFlows: [],
      fmdSections: [],
      boomiConnections: [],
      boomiDrafts: [],
    };

    const spec = buildBoomiBuildSpec(project);
    expect(spec.schemaVersion).toBe("1.0");
    expect(spec.profiles.length).toBeGreaterThan(0);
    expect(spec.mappingSets.length).toBeGreaterThan(0);
    expect(spec.project.localProjectId).toBe("project-seiren-order-in");
  });

  it("generates valid XML profiles", () => {
    const profile = {
      localProfileId: "profile-source",
      name: "購買伝票（Source）",
      role: "source" as const,
      type: "Flat File",
      format: "CSV",
      fields: [
        { localFieldId: "sf-1", name: "購買伝票番号", dataType: "character", required: false, keyField: true, ordinal: 1 },
        { localFieldId: "sf-2", name: "購買伝票日付", dataType: "datetime", required: false, keyField: false, ordinal: 2 },
      ],
    };

    const result = generateProfileXml(profile, "TEST-FOLDER");
    expect(result.xml).toContain("購買伝票番号");
    expect(result.xml).toContain("購買伝票日付");
    expect(result.xml).toContain('type="profile.flatfile"');
    expect(result.xml).toContain('enforceUnique="false"');

    // JSON dest profile
    const destProfile = {
      localProfileId: "profile-dest",
      name: "受注データ（Destination）",
      role: "destination" as const,
      type: "JSON",
      format: "JSON",
      fields: [
        { localFieldId: "df-1", name: "orderId", dataType: "character", required: true, keyField: true, ordinal: 1 },
        { localFieldId: "df-2", name: "orderDate", dataType: "datetime", required: false, keyField: false, ordinal: 2 },
      ],
    };

    const destResult = generateProfileXml(destProfile, "TEST-FOLDER");
    expect(destResult.xml).toContain("orderId");
    expect(destResult.xml).toContain("orderDate");
    expect(destResult.xml).toContain('type="profile.json"');
    expect(destResult.xml).toContain('strict="false"');
  });

  it("generates valid REST connection XML", () => {
    const endpoint = {
      localEndpointId: "ep-sharepoint",
      name: "SharePoint API",
      role: "source",
      connectorType: "REST",
      profileType: "Flat File",
      format: "CSV",
      purpose: "GET data",
      connectionInfo: "https://sharepoint.example.com",
    };
    const conn: BoomiConnection = {
      id: "conn-1",
      accountId: "avaxia-9FCJIF",
      environmentName: "Sandbox",
      baseUrl: "https://api.boomi.com",
      authMode: "Basic API Token",
      apiUsername: "test-user",
      apiPassword: "test-token",
      mode: "sandbox",
      createdAt: "2026-01-01",
    };

    const xml = generateConnectionXml(endpoint, "TEST-FOLDER", conn);
    expect(xml).toContain('type="connector-settings"');
    expect(xml).toContain('subType="officialboomi-X3979C-rest-prod"');
    expect(xml).toContain('id="url"');
    expect(xml).toContain('id="auth"');
    expect(xml).toContain('value="BASIC"');
  });

  it("generates valid REST operation XML", () => {
    const endpoint = {
      localEndpointId: "ep-sharepoint",
      name: "SharePoint API",
      role: "source",
      connectorType: "REST",
      profileType: "Flat File",
      format: "CSV",
      purpose: "GET data",
      connectionInfo: "https://sharepoint.example.com",
    };

    const xml = generateOperationXml(endpoint, "conn-component-id-123", "TEST-FOLDER");
    expect(xml).toContain('type="connector-action"');
    expect(xml).toContain('subType="officialboomi-X3979C-rest-prod"');
    expect(xml).toContain('customOperationType="GET"');
    expect(xml).not.toContain("requestProfileType");
    expect(xml).not.toContain("responseProfileType");
  });

  it("generates valid transform map XML", () => {
    const mappingSet: BuildMappingSet = {
      localMappingSetId: "ms-1",
      name: "受注マッピング",
      sourceProfileRef: "購買伝票（Source）",
      destinationProfileRef: "受注データ（Destination）",
      direction: "source-to-dest",
      status: "Draft",
      rules: [
        {
          localRuleId: "r-1",
          sourceFieldId: "sf-1",
          destinationFieldId: "df-1",
          sourceFieldName: "購買伝票番号",
          mappingType: "direct",
          reviewed: false,
        },
      ],
      transformNodes: [],
    };

    const srcKeys: ProfileKeyMap = [
      { key: 3, fieldId: "sf-1", fieldName: "購買伝票番号", path: "購買伝票番号", isMappable: true },
      { key: 4, fieldId: "sf-2", fieldName: "購買伝票日付", path: "購買伝票日付", isMappable: true },
    ];

    const destKeys: ProfileKeyMap = [
      { key: 3, fieldId: "df-1", fieldName: "orderId", path: "orderId", isMappable: true },
      { key: 4, fieldId: "df-2", fieldName: "orderDate", path: "orderDate", isMappable: true },
    ];

    const xml = generateMapXml(mappingSet, "src-profile-id", "dst-profile-id", srcKeys, destKeys, "TEST-FOLDER");
    expect(xml).toContain('type="transform.map"');
    expect(xml).toContain('<Map fromProfile="src-profile-id" toProfile="dst-profile-id">');
    expect(xml).toContain("<Mappings>");
    expect(xml).toContain('fromType="profile"');
    expect(xml).toContain('toType="profile"');
    expect(xml).toContain("<Functions");
    expect(xml).toContain("<Defaults>");
    expect(xml).toContain("<DocumentCacheJoins/>");
  });

  it("generates valid process XML with connector and map shapes", () => {
    const flow = {
      localFlowId: "flow-1",
      name: "受注連携フロー",
      nodes: [
        { localNodeId: "n1", type: "start-passthrough", label: "", description: "", position: { x: 48, y: 46 } },
        { localNodeId: "n2", type: "connector", label: "GET SharePoint", description: "", position: { x: 273, y: 46 } },
        { localNodeId: "n3", type: "map", label: "マッピング", description: "", position: { x: 498, y: 46 } },
        { localNodeId: "n4", type: "connector", label: "POST SMILE", description: "", position: { x: 723, y: 46 } },
        { localNodeId: "n5", type: "stop", label: "", description: "", position: { x: 948, y: 46 } },
      ],
      edges: [
        { localEdgeId: "e1", source: "n1", target: "n2" },
        { localEdgeId: "e2", source: "n2", target: "n3" },
        { localEdgeId: "e3", source: "n3", target: "n4" },
        { localEdgeId: "e4", source: "n4", target: "n5" },
      ],
    };

    const refs: ProcessComponentRefs = {
      connectionId: "conn-123",
      operationId: "op-456",
      mapId: "map-789",
      connectorType: "officialboomi-X3979C-rest-prod",
    };

    const xml = generateProcessXml(flow, refs, "TEST-FOLDER");
    expect(xml).toContain('type="process"');
    expect(xml).toContain("<shapes>");
    expect(xml).toContain("shape1");
    expect(xml).toContain("shape5");
    expect(xml).toContain("<passthroughaction/>");
    expect(xml).toContain('continue="true"');
    expect(xml).toContain("connectoraction");
    expect(xml).toContain('connectionId="conn-123"');
    expect(xml).toContain('map_icon');
    expect(xml).toContain(`mapId="map-789"`);
  });

  it("generates complete build plan with correct dependency order", () => {
    const spec = {
      schemaVersion: "1.0" as const,
      generatedAt: new Date().toISOString(),
      sourceApp: "Boomi Helper Suite" as const,
      project: { processId: "SRSN001", name: "Test", description: "", sourceSystem: "A", destinationSystem: "B", status: "Draft", owner: "", localProjectId: "p1", folder: "TestFolder" },
      target: { goal: "Integrate", integrationPattern: "REST-to-JSON" },
      endpoints: [
        { localEndpointId: "ep-1", name: "TestAPI", role: "source", connectorType: "REST", profileType: "JSON", format: "JSON", purpose: "GET", connectionInfo: "" },
      ],
      profiles: [
        { localProfileId: "p-src", name: "SourceProfile", role: "source" as const, type: "JSON", format: "JSON", fields: [{ localFieldId: "f1", name: "field1", dataType: "character", required: false, keyField: false, ordinal: 1 }] },
        { localProfileId: "p-dst", name: "DestProfile", role: "destination" as const, type: "JSON", format: "JSON", fields: [{ localFieldId: "f2", name: "field2", dataType: "character", required: false, keyField: false, ordinal: 1 }] },
      ],
      mappingSets: [
        { localMappingSetId: "ms-1", name: "TestMap", sourceProfileRef: "SourceProfile", destinationProfileRef: "DestProfile", direction: "src-to-dst", status: "Draft", rules: [], transformNodes: [] },
      ],
      processFlows: [
        {
          localFlowId: "pf-1", name: "TestFlow",
          nodes: [
            { localNodeId: "n1", type: "start-passthrough", label: "", description: "", position: { x: 48, y: 46 } },
            { localNodeId: "n2", type: "stop", label: "", description: "", position: { x: 273, y: 46 } },
          ],
          edges: [{ localEdgeId: "e1", source: "n1", target: "n2" }],
        },
      ],
      fmdSections: [],
      importedBoomiContext: { components: [], dependencyNotes: [] },
      readiness: { checks: [], overallStatus: "ready" as const },
      acceptanceCriteria: [],
      openQuestions: [],
    };

    const plan = generateBuildPlan(spec);

    // Should have correct number of items
    const profileItems = plan.filter((i) => i.phase === "profile");
    const connectionItems = plan.filter((i) => i.phase === "connection");
    const operationItems = plan.filter((i) => i.phase === "operation");
    const mapItems = plan.filter((i) => i.phase === "map");
    const processItems = plan.filter((i) => i.phase === "process");

    expect(profileItems.length).toBe(2);
    expect(connectionItems.length).toBe(1);
    expect(operationItems.length).toBe(1);
    expect(mapItems.length).toBe(1);
    expect(processItems.length).toBe(1);

    // Maps depend on profiles
    expect(mapItems[0].dependsOn).toContain("profile:p-src");
    expect(mapItems[0].dependsOn).toContain("profile:p-dst");

    // Operations depend on connections
    expect(operationItems[0].dependsOn).toContain("connection:ep-1");
  });

  it("generated XML contains no credentials or secrets", () => {
    const profiles = [
      { localProfileId: "p-src", name: "Src", role: "source" as const, type: "JSON", format: "JSON", fields: [{ localFieldId: "f1", name: "field1", dataType: "character", required: false, keyField: false, ordinal: 1 }] },
    ];

    for (const profile of profiles) {
      const result = generateProfileXml(profile, "TEST-FOLDER");
      expect(result.xml).not.toMatch(/apiPassword/i);
      expect(result.xml).not.toMatch(/apiToken/i);
      expect(result.xml).not.toMatch(/Bearer\s/i);
      expect(result.xml).not.toMatch(/Authorization/i);
    }

    const conn: BoomiConnection = {
      id: "conn-1", accountId: "avaxia-9FCJIF", environmentName: "Sandbox",
      baseUrl: "https://api.boomi.com", authMode: "Basic API Token",
      apiUsername: "test-user", apiPassword: "secret-token-12345", mode: "sandbox", createdAt: "2026-01-01",
    };
    const ep = { localEndpointId: "ep-1", name: "API", role: "source", connectorType: "REST", profileType: "JSON", format: "JSON", purpose: "GET", connectionInfo: "" };
    const connXml = generateConnectionXml(ep, "TEST-FOLDER", conn);
    // Connection XML should contain the password (it's needed by Boomi, but not the raw token in SSE)
    expect(connXml).toContain("secret-token-12345");
  });
});
