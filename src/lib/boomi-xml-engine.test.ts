import { describe, it, expect } from "vitest";
import {
  generateJsonProfileXml,
  generateFlatFileProfileXml,
  generateXmlProfileXml,
  generateRestConnectionXml,
  generateRestOperationXml,
  generateMapXml,
  generateProcessXml,
  generateConnectionXml,
  mapBoomiDataType,
  type ProfileKeyMap,
  type ProcessComponentRefs,
} from "@/lib/boomi-xml-engine";
import type {
  BoomiConnection,
  BuildEndpointFieldRef,
  BuildEndpoint,
  BuildMappingSet,
  BuildMappingRule,
  BuildProfileRef,
  BuildProcessFlow,
} from "@/lib/domain";

const testFolderId = "TEST-FOLDER-ID";

function makeField(overrides: Partial<BuildEndpointFieldRef> = {}): BuildEndpointFieldRef {
  return {
    localFieldId: overrides.localFieldId ?? "f-1",
    name: overrides.name ?? "testField",
    dataType: overrides.dataType ?? "character",
    required: overrides.required ?? false,
    keyField: overrides.keyField ?? false,
    ordinal: overrides.ordinal ?? 1,
    parentPath: overrides.parentPath,
    format: overrides.format,
    label: overrides.label,
    description: overrides.description,
    length: overrides.length,
    sample: overrides.sample,
  };
}

function makeSpecProfile(overrides: Partial<BuildProfileRef> = {}): BuildProfileRef {
  return {
    localProfileId: overrides.localProfileId ?? "p-1",
    name: overrides.name ?? "TestProfile",
    role: overrides.role ?? "source",
    type: overrides.type ?? "JSON",
    format: overrides.format ?? "JSON",
    rootPath: overrides.rootPath,
    fields: overrides.fields ?? [],
  };
}

function makeConnection(): BoomiConnection {
  return {
    id: "conn-1",
    accountId: "test-account",
    environmentName: "Sandbox",
    baseUrl: "https://api.test.boomi.com",
    authMode: "Basic API Token",
    apiUsername: "testuser",
    apiPassword: "testpass",
    mode: "sandbox",
    createdAt: "2025-01-01",
  };
}

function makeEndpoint(overrides: Partial<BuildEndpoint> = {}): BuildEndpoint {
  return {
    localEndpointId: overrides.localEndpointId ?? "ep-1",
    name: overrides.name ?? "TestAPI",
    role: overrides.role ?? "source",
    connectorType: overrides.connectorType ?? "REST",
    profileType: overrides.profileType ?? "JSON",
    format: overrides.format ?? "JSON",
    purpose: overrides.purpose ?? "GET data",
    connectionInfo: overrides.connectionInfo ?? "https://api.example.com",
  };
}

// ── Data type mapping ────────────────────────────────────────────────────

describe("mapBoomiDataType", () => {
  it("maps integer types to number", () => {
    expect(mapBoomiDataType(makeField({ dataType: "integer" }))).toBe("number");
  });
  it("maps decimal to number", () => {
    expect(mapBoomiDataType(makeField({ dataType: "decimal" }))).toBe("number");
  });
  it("maps datetime to datetime", () => {
    expect(mapBoomiDataType(makeField({ dataType: "datetime" }))).toBe("datetime");
  });
  it("maps boolean to boolean", () => {
    expect(mapBoomiDataType(makeField({ dataType: "boolean" }))).toBe("boolean");
  });
  it("defaults unknown types to character", () => {
    expect(mapBoomiDataType(makeField({ dataType: "uuid" }))).toBe("character");
  });
});

// ── JSON Profile ─────────────────────────────────────────────────────────

describe("generateJsonProfileXml", () => {
  it("generates a valid component envelope with correct namespaces", () => {
    const profile = makeSpecProfile({
      fields: [makeField({ name: "name", dataType: "character", ordinal: 1 })],
    });
    const result = generateJsonProfileXml(profile, testFolderId);

    expect(result.xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(result.xml).toContain('xmlns:bns="http://api.platform.boomi.com/"');
    expect(result.xml).toContain('xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
    expect(result.xml).toContain('type="profile.json"');
    expect(result.xml).toContain(`folderId="${testFolderId}"`);
    expect(result.xml).toContain(`name="${profile.name}"`);
    expect(result.xml).toContain("componentId=");
  });

  it("includes required JSON profile structure", () => {
    const profile = makeSpecProfile({
      fields: [makeField({ name: "name", dataType: "character", ordinal: 1 })],
    });
    const result = generateJsonProfileXml(profile, testFolderId);

    expect(result.xml).toContain('strict="false"');
    expect(result.xml).toContain("<JSONProfile");
    expect(result.xml).toContain("<tagLists/>");
    expect(result.xml).toContain("<JSONRootValue");
    expect(result.xml).toContain('<Qualifiers><QualifierList/></Qualifiers>');
    expect(result.xml).toContain("<bns:encryptedValues/>");
  });

  it("sets isMappable=true on leaf fields", () => {
    const profile = makeSpecProfile({
      fields: [makeField({ name: "name", dataType: "character", ordinal: 1 })],
    });
    const result = generateJsonProfileXml(profile, testFolderId);

    expect(result.xml).toContain('isMappable="true"');
    expect(result.xml).toContain('name="name"');
  });

  it("sets isMappable=false on JSONObject container", () => {
    const profile = makeSpecProfile({
      fields: [makeField({ name: "name", dataType: "character", ordinal: 1 })],
    });
    const result = generateJsonProfileXml(profile, testFolderId);

    expect(result.xml).toMatch(/<JSONObject isMappable="false"/);
  });

  it("generates correct data format for number type", () => {
    const profile = makeSpecProfile({
      fields: [makeField({ name: "amount", dataType: "number", ordinal: 1 })],
    });
    const result = generateJsonProfileXml(profile, testFolderId);

    expect(result.xml).toContain('<ProfileNumberFormat numberFormat=""/>');
  });

  it("generates correct data format for boolean type", () => {
    const profile = makeSpecProfile({
      fields: [makeField({ name: "active", dataType: "boolean", ordinal: 1 })],
    });
    const result = generateJsonProfileXml(profile, testFolderId);

    expect(result.xml).toContain("<ProfileBooleanFormat/>");
  });

  it("generates correct data format for datetime type", () => {
    const profile = makeSpecProfile({
      fields: [makeField({ name: "date", dataType: "datetime", format: "yyyy-MM-dd", ordinal: 1 })],
    });
    const result = generateJsonProfileXml(profile, testFolderId);

    expect(result.xml).toContain("<ProfileDateFormat");
    expect(result.xml).toContain('dateFormat="yyyy-MM-dd"');
  });

  it("handles nested objects via parentPath", () => {
    const profile = makeSpecProfile({
      fields: [
        makeField({ localFieldId: "f-1", name: "outer", dataType: "character", ordinal: 1, parentPath: "address" }),
      ],
    });
    const result = generateJsonProfileXml(profile, testFolderId);

    expect(result.xml).toContain('name="address"');
    expect(result.xml).toContain('name="outer"');
  });

  it("places blank and Root/Object parent paths under the JSON root object", () => {
    const profile = makeSpecProfile({
      fields: [
        makeField({ localFieldId: "f-1", name: "employee_number", dataType: "character", ordinal: 1, parentPath: "" }),
        makeField({ localFieldId: "f-2", name: "mobile_phone", dataType: "character", ordinal: 2, parentPath: "Root/Object" }),
      ],
    });
    const result = generateJsonProfileXml(profile, testFolderId);

    expect(result.xml).toContain('<JSONObject isMappable="false" isNode="true" key="2" name="Object">');
    expect(result.xml).toContain('name="employee_number"');
    expect(result.xml).toContain('name="mobile_phone"');
    expect(result.xml).not.toMatch(/<JSONObjectEntry[^>]+name="Root"/);
    expect(result.predictedKeys?.find((k) => k.fieldName === "employee_number")?.path).toBe("Root/Object/employee_number");
    expect(result.predictedKeys?.find((k) => k.fieldName === "mobile_phone")?.path).toBe("Root/Object/mobile_phone");
  });

  it("handles array fields via parentPath with []", () => {
    const profile = makeSpecProfile({
      fields: [
        makeField({ localFieldId: "f-1", name: "sku", dataType: "character", ordinal: 1, parentPath: "items[]" }),
      ],
    });
    const result = generateJsonProfileXml(profile, testFolderId);

    expect(result.xml).toContain("JSONArray");
    expect(result.xml).toContain('elementType="repeating"');
    expect(result.xml).toContain("JSONArrayElement");
    expect(result.xml).toContain('maxOccurs="-1"');
    expect(result.xml).toContain('minOccurs="0"');
  });

  it("assigns sequential keys depth-first", () => {
    const profile = makeSpecProfile({
      fields: [
        makeField({ localFieldId: "f-1", name: "id", dataType: "character", ordinal: 1 }),
        makeField({ localFieldId: "f-2", name: "name", dataType: "character", ordinal: 2 }),
      ],
    });
    const result = generateJsonProfileXml(profile, testFolderId);

    // Root = key 1, JSONObject = key 2, first field = key 3, second field = key 4
    expect(result.xml).toContain('key="1"');
    expect(result.xml).toContain('key="2"');
    expect(result.xml).toContain('key="3"');
    expect(result.xml).toContain('key="4"');
  });

  it("returns predicted keys", () => {
    const profile = makeSpecProfile({
      fields: [
        makeField({ localFieldId: "f-1", name: "id", dataType: "character", ordinal: 1 }),
      ],
    });
    const result = generateJsonProfileXml(profile, testFolderId);

    expect(result.predictedKeys).toBeDefined();
    expect(result.predictedKeys!.length).toBeGreaterThan(0);
    // Root is also mappable=true per Companion refs, so we check for our field specifically
    const fieldKey = result.predictedKeys!.find((k) => k.fieldName === "id");
    expect(fieldKey).toBeDefined();
    expect(fieldKey!.isMappable).toBe(true);
  });

  it("preserves Japanese text in field names", () => {
    const profile = makeSpecProfile({
      fields: [makeField({ name: "購買伝票番号", dataType: "character", ordinal: 1 })],
    });
    const result = generateJsonProfileXml(profile, testFolderId);

    expect(result.xml).toContain("購買伝票番号");
  });

  it("does not contain credentials or secrets", () => {
    const profile = makeSpecProfile({
      fields: [makeField({ name: "name", dataType: "character", ordinal: 1 })],
    });
    const result = generateJsonProfileXml(profile, testFolderId);

    expect(result.xml).not.toMatch(/apiPassword/i);
    expect(result.xml).not.toMatch(/Bearer\s/i);
    expect(result.xml).not.toMatch(/Authorization/i);
  });
});

// ── Flat File Profile ────────────────────────────────────────────────────

describe("generateFlatFileProfileXml", () => {
  it("generates delimited profile for CSV format", () => {
    const profile = makeSpecProfile({
      type: "Flat File",
      format: "CSV",
      fields: [makeField({ name: "field1", dataType: "character", ordinal: 1 })],
    });
    const result = generateFlatFileProfileXml(profile, testFolderId);

    expect(result.xml).toContain('type="profile.flatfile"');
    expect(result.xml).toContain('fileType="delimited"');
    expect(result.xml).toContain('fileDelimiter="commadelimited"');
  });

  it("uses pipe delimiter for pipe format", () => {
    const profile = makeSpecProfile({
      type: "Flat File",
      format: "pipe|delimited",
      fields: [makeField({ name: "field1", dataType: "character", ordinal: 1 })],
    });
    const result = generateFlatFileProfileXml(profile, testFolderId);

    expect(result.xml).toContain('fileDelimiter="bardelimited"');
  });

  it("includes enforceUnique=false on all fields", () => {
    const profile = makeSpecProfile({
      type: "Flat File",
      format: "CSV",
      fields: [makeField({ name: "field1", dataType: "character", ordinal: 1 })],
    });
    const result = generateFlatFileProfileXml(profile, testFolderId);

    expect(result.xml).toContain('enforceUnique="false"');
  });

  it("sets isMappable=true on leaf fields", () => {
    const profile = makeSpecProfile({
      type: "Flat File",
      format: "CSV",
      fields: [makeField({ name: "field1", dataType: "character", ordinal: 1 })],
    });
    const result = generateFlatFileProfileXml(profile, testFolderId);

    expect(result.xml).toContain('isMappable="true"');
  });
});

// ── XML Profile ──────────────────────────────────────────────────────────

describe("generateXmlProfileXml", () => {
  it("generates valid XML profile structure", () => {
    const profile = makeSpecProfile({
      type: "XML",
      fields: [makeField({ name: "element", dataType: "character", ordinal: 1 })],
    });
    const result = generateXmlProfileXml(profile, testFolderId);

    expect(result.xml).toContain('type="profile.xml"');
    expect(result.xml).toContain("<XMLProfile");
    expect(result.xml).toContain("<DataElements>");
    expect(result.xml).toContain("useNamespace");
    expect(result.xml).toContain('<XMLFlavor><CustomStandardFlavor/></XMLFlavor>');
  });

  it("sets correct namespace references", () => {
    const profile = makeSpecProfile({
      type: "XML",
      fields: [makeField({ name: "element", dataType: "character", ordinal: 1 })],
    });
    const result = generateXmlProfileXml(profile, testFolderId);

    expect(result.xml).toContain('useNamespace="-1"');
  });
});

// ── REST Connection ──────────────────────────────────────────────────────

describe("generateRestConnectionXml", () => {
  it("generates REST connection with correct subType", () => {
    const endpoint = makeEndpoint();
    const conn = makeConnection();
    const result = generateRestConnectionXml(endpoint, testFolderId, conn);

    expect(result).toContain('type="connector-settings"');
    expect(result).toContain('subType="officialboomi-X3979C-rest-prod"');
  });

  it("includes all required fields", () => {
    const endpoint = makeEndpoint();
    const conn = makeConnection();
    const result = generateRestConnectionXml(endpoint, testFolderId, conn);

    expect(result).toContain('id="url"');
    expect(result).toContain('id="auth"');
    expect(result).toContain('id="username"');
    expect(result).toContain('id="password"');
    expect(result).toContain('id="connectTimeout"');
    expect(result).toContain('id="readTimeout"');
    expect(result).toContain('id="cookieScope"');
    expect(result).toContain('id="enableConnectionPooling"');
  });

  it("includes required empty/unused fields", () => {
    const endpoint = makeEndpoint();
    const conn = makeConnection();
    const result = generateRestConnectionXml(endpoint, testFolderId, conn);

    expect(result).toContain('id="domain"');
    expect(result).toContain('id="oauthContext"');
    expect(result).toContain('id="awsAccessKey"');
  });

  it("uses basic auth by default", () => {
    const endpoint = makeEndpoint();
    const conn = makeConnection();
    const result = generateRestConnectionXml(endpoint, testFolderId, conn);

    expect(result).toContain('value="BASIC"');
  });

  it("uses encryptedValues element", () => {
    const endpoint = makeEndpoint();
    const conn = makeConnection();
    const result = generateRestConnectionXml(endpoint, testFolderId, conn);

    expect(result).toContain("<bns:encryptedValues/>");
  });
});

// ── REST Operation ───────────────────────────────────────────────────────

describe("generateRestOperationXml", () => {
  it("generates REST operation with correct subType", () => {
    const endpoint = makeEndpoint();
    const result = generateRestOperationXml(endpoint, "conn-123", testFolderId);

    expect(result).toContain('type="connector-action"');
    expect(result).toContain('subType="officialboomi-X3979C-rest-prod"');
  });

  it("uses correct HTTP method from purpose", () => {
    const getEp = makeEndpoint({ purpose: "GET data" });
    const getResult = generateRestOperationXml(getEp, "conn-123", testFolderId);
    expect(getResult).toContain('customOperationType="GET"');

    const postEp = makeEndpoint({ purpose: "POST create" });
    const postResult = generateRestOperationXml(postEp, "conn-123", testFolderId);
    expect(postResult).toContain('customOperationType="POST"');
  });

  it("does not include requestProfileType or responseProfileType", () => {
    const endpoint = makeEndpoint();
    const result = generateRestOperationXml(endpoint, "conn-123", testFolderId);

    expect(result).not.toContain("requestProfileType");
    expect(result).not.toContain("responseProfileType");
  });

  it("includes required operation structure", () => {
    const endpoint = makeEndpoint();
    const result = generateRestOperationXml(endpoint, "conn-123", testFolderId);

    expect(result).toContain("<Operation");
    expect(result).toContain("<Archiving");
    expect(result).toContain("<Configuration>");
    expect(result).toContain("<GenericOperationConfig");
    expect(result).toContain("operationType=");
    expect(result).toContain("<Tracking>");
    expect(result).toContain("<TrackedFields/>");
    expect(result).toContain("<Caching/>");
  });
});

// ── Transform Map ────────────────────────────────────────────────────────

describe("generateMapXml", () => {
  function makeMapKeys(fields: Array<{ name: string; id: string; isMappable: boolean }>): ProfileKeyMap {
    return fields.map((f, i) => ({
      key: i + 1,
      fieldId: f.id,
      fieldName: f.name,
      path: f.name,
      isMappable: f.isMappable,
    }));
  }

  function makeMappingSet(overrides: Partial<BuildMappingSet> = {}): BuildMappingSet {
    return {
      localMappingSetId: overrides.localMappingSetId ?? "ms-1",
      name: overrides.name ?? "TestMap",
      sourceProfileRef: overrides.sourceProfileRef ?? "SourceProfile",
      destinationProfileRef: overrides.destinationProfileRef ?? "DestProfile",
      direction: overrides.direction ?? "source-to-dest",
      status: overrides.status ?? "Draft",
      rules: overrides.rules ?? [],
      transformNodes: overrides.transformNodes ?? [],
    };
  }

  it("generates minimal map with required elements", () => {
    const map = makeMappingSet();
    const srcKeys = makeMapKeys([{ name: "field1", id: "f-1", isMappable: true }]);
    const dstKeys = makeMapKeys([{ name: "dest1", id: "d-1", isMappable: true }]);
    const result = generateMapXml(map, "src-id", "dst-id", srcKeys, dstKeys, testFolderId);

    expect(result).toContain('type="transform.map"');
    expect(result).toContain('<Map fromProfile="src-id" toProfile="dst-id">');
    expect(result).toContain("<Mappings>");
    expect(result).toContain("<Functions");
    expect(result).toContain("<Defaults>");
    expect(result).toContain("<DocumentCacheJoins/>");
  });

  it("generates field-to-field mappings for direct rules", () => {
    const rules: BuildMappingRule[] = [
      {
        localRuleId: "r-1",
        destinationFieldId: "d-1",
        mappingType: "direct",
        sourceFieldId: "f-1",
        sourceFieldName: "field1",
        reviewed: false,
      },
    ];
    const map = makeMappingSet({ rules });
    const srcKeys = makeMapKeys([{ name: "field1", id: "f-1", isMappable: true }]);
    const dstKeys = makeMapKeys([{ name: "dest1", id: "d-1", isMappable: true }]);
    const result = generateMapXml(map, "src-id", "dst-id", srcKeys, dstKeys, testFolderId);

    expect(result).toContain('fromType="profile"');
    expect(result).toContain('toType="profile"');
  });

  it("generates Default entries for constant mappings", () => {
    const rules: BuildMappingRule[] = [
      {
        localRuleId: "r-1",
        destinationFieldId: "d-1",
        mappingType: "constant",
        defaultValue: "test-value",
        reviewed: false,
      },
    ];
    const map = makeMappingSet({ rules });
    const srcKeys = makeMapKeys([]);
    const dstKeys = makeMapKeys([{ name: "dest1", id: "d-1", isMappable: true }]);
    const result = generateMapXml(map, "src-id", "dst-id", srcKeys, dstKeys, testFolderId);

    expect(result).toContain("<Default toKey=");
    expect(result).toContain('value="test-value"');
  });

  it("does not map non-mappable fields", () => {
    const rules: BuildMappingRule[] = [
      {
        localRuleId: "r-1",
        destinationFieldId: "d-1",
        mappingType: "direct",
        sourceFieldId: "f-1",
        sourceFieldName: "field1",
        reviewed: false,
      },
    ];
    const map = makeMappingSet({ rules });
    const srcKeys = makeMapKeys([{ name: "field1", id: "f-1", isMappable: false }]);
    const dstKeys = makeMapKeys([{ name: "dest1", id: "d-1", isMappable: true }]);
    const result = generateMapXml(map, "src-id", "dst-id", srcKeys, dstKeys, testFolderId);

    // Source field is not mappable, so no Mapping entry should be generated for it
    // Match Mapping elements with attributes (not the Mappings container tag)
    const mappingCount = (result.match(/<Mapping\s+fromKey/g) || []).length;
    expect(mappingCount).toBe(0);
  });
});

// ── Process ──────────────────────────────────────────────────────────────

describe("generateProcessXml", () => {
  const testRefs: ProcessComponentRefs = {
    connectionId: "conn-123",
    operationId: "op-456",
    mapId: "map-789",
    connectorType: "officialboomi-X3979C-rest-prod",
  };

  function makeFlow(name: string, overrides: Partial<BuildProcessFlow> = {}): BuildProcessFlow {
    return {
      localFlowId: "flow-1",
      name,
      nodes: overrides.nodes ?? [],
      edges: overrides.edges ?? [],
      notes: overrides.notes,
    };
  }

  it("generates start + stop process with passthrough", () => {
    const flow = makeFlow("Simple Flow", {
      nodes: [
        { localNodeId: "n1", type: "start-passthrough", label: "", description: "", position: { x: 48, y: 46 } },
        { localNodeId: "n2", type: "stop", label: "", description: "", position: { x: 273, y: 46 } },
      ],
      edges: [
        { localEdgeId: "e1", source: "n1", target: "n2" },
      ],
    });
    const result = generateProcessXml(flow, testRefs, testFolderId);

    expect(result).toContain('type="process"');
    expect(result).toContain("<shapes>");
    expect(result).toContain("<passthroughaction/>");
    expect(result).toContain('continue="true"');
    expect(result).toContain("shape1");
    expect(result).toContain("shape2");
  });

  it("includes dragpoint connections between shapes", () => {
    const flow = makeFlow("Connected", {
      nodes: [
        { localNodeId: "n1", type: "start-passthrough", label: "", description: "", position: { x: 48, y: 46 } },
        { localNodeId: "n2", type: "stop", label: "", description: "", position: { x: 273, y: 46 } },
      ],
      edges: [
        { localEdgeId: "e1", source: "n1", target: "n2" },
      ],
    });
    const result = generateProcessXml(flow, testRefs, testFolderId);

    expect(result).toContain("<dragpoint");
    expect(result).toContain("toShape=");
  });

  it("renders connectoraction shape with correct attributes", () => {
    const flow = makeFlow("API Flow", {
      nodes: [
        { localNodeId: "n1", type: "start-passthrough", label: "", description: "", position: { x: 48, y: 46 } },
        { localNodeId: "n2", type: "connector", label: "Call API", description: "", position: { x: 273, y: 46 } },
        { localNodeId: "n3", type: "stop", label: "", description: "", position: { x: 498, y: 46 } },
      ],
      edges: [
        { localEdgeId: "e1", source: "n1", target: "n2" },
        { localEdgeId: "e2", source: "n2", target: "n3" },
      ],
    });
    const result = generateProcessXml(flow, testRefs, testFolderId);

    expect(result).toContain("connectoraction");
    expect(result).toContain(`connectionId="${testRefs.connectionId}"`);
    expect(result).toContain(`operationId="${testRefs.operationId}"`);
    expect(result).toContain('actionType="GET"');
    expect(result).toContain("shape2");
    expect(result).toContain("shape3");
  });

  it("renders map shape", () => {
    const flow = makeFlow("Map Flow", {
      nodes: [
        { localNodeId: "n1", type: "start-passthrough", label: "", description: "", position: { x: 48, y: 46 } },
        { localNodeId: "n2", type: "map", label: "Transform", description: "", position: { x: 273, y: 46 } },
        { localNodeId: "n3", type: "stop", label: "", description: "", position: { x: 498, y: 46 } },
      ],
      edges: [
        { localEdgeId: "e1", source: "n1", target: "n2" },
        { localEdgeId: "e2", source: "n2", target: "n3" },
      ],
    });
    const result = generateProcessXml(flow, testRefs, testFolderId);

    expect(result).toContain("map_icon");
    expect(result).toContain("shapetype=\"map\"");
    expect(result).toContain(`mapId="${testRefs.mapId}"`);
  });

  it("renders branch shape with numBranches", () => {
    const flow = makeFlow("Branch Flow", {
      nodes: [
        { localNodeId: "n1", type: "start-passthrough", label: "", description: "", position: { x: 48, y: 46 } },
        { localNodeId: "n2", type: "branch", label: "", description: "", position: { x: 273, y: 46 } },
        { localNodeId: "n3", type: "stop", label: "", description: "", position: { x: 498, y: 46 } },
      ],
      edges: [
        { localEdgeId: "e1", source: "n1", target: "n2" },
        { localEdgeId: "e2", source: "n2", target: "n3" },
      ],
    });
    const result = generateProcessXml(flow, testRefs, testFolderId);

    expect(result).toContain("branch_icon");
    expect(result).toContain('shapetype="branch"');
    expect(result).toContain('numBranches="2"');
  });

  it("renders setproperties shape", () => {
    const flow = makeFlow("Props Flow", {
      nodes: [
        { localNodeId: "n1", type: "start-passthrough", label: "", description: "", position: { x: 48, y: 46 } },
        { localNodeId: "n2", type: "setproperties", label: "", description: "", position: { x: 273, y: 46 } },
        { localNodeId: "n3", type: "stop", label: "", description: "", position: { x: 498, y: 46 } },
      ],
      edges: [
        { localEdgeId: "e1", source: "n1", target: "n2" },
        { localEdgeId: "e2", source: "n2", target: "n3" },
      ],
    });
    const result = generateProcessXml(flow, testRefs, testFolderId);

    expect(result).toContain("documentproperties_icon");
    expect(result).toContain('shapetype="documentproperties"');
  });

  it("renders stop with continue=true", () => {
    const flow = makeFlow("Stop Flow", {
      nodes: [
        { localNodeId: "n1", type: "start-passthrough", label: "", description: "", position: { x: 48, y: 46 } },
        { localNodeId: "n2", type: "stop", label: "", description: "", position: { x: 273, y: 46 } },
      ],
      edges: [
        { localEdgeId: "e1", source: "n1", target: "n2" },
      ],
    });
    const result = generateProcessXml(flow, testRefs, testFolderId);

    expect(result).toContain('continue="true"');
  });

  it("renders notify shape", () => {
    const flow = makeFlow("Notify Flow", {
      nodes: [
        { localNodeId: "n1", type: "start-passthrough", label: "", description: "", position: { x: 48, y: 46 } },
        { localNodeId: "n2", type: "notify", label: "Debug", description: "", position: { x: 273, y: 46 } },
        { localNodeId: "n3", type: "stop", label: "", description: "", position: { x: 498, y: 46 } },
      ],
      edges: [
        { localEdgeId: "e1", source: "n1", target: "n2" },
        { localEdgeId: "e2", source: "n2", target: "n3" },
      ],
    });
    const result = generateProcessXml(flow, testRefs, testFolderId);

    expect(result).toContain("notify_icon");
    expect(result).toContain('shapetype="notify"');
  });

  it("renders dataprocess shape with groovy2 language", () => {
    const flow = makeFlow("Script Flow", {
      nodes: [
        { localNodeId: "n1", type: "start-passthrough", label: "", description: "", position: { x: 48, y: 46 } },
        { localNodeId: "n2", type: "dataprocess", label: "Script", description: "", position: { x: 273, y: 46 } },
        { localNodeId: "n3", type: "stop", label: "", description: "", position: { x: 498, y: 46 } },
      ],
      edges: [
        { localEdgeId: "e1", source: "n1", target: "n2" },
        { localEdgeId: "e2", source: "n2", target: "n3" },
      ],
    });
    const result = generateProcessXml(flow, testRefs, testFolderId);

    expect(result).toContain("dataprocess_icon");
    expect(result).toContain('language="groovy2"');
    expect(result).toContain('useCache="true"');
  });

  it("renders exception shape", () => {
    const flow = makeFlow("Error Flow", {
      nodes: [
        { localNodeId: "n1", type: "start-passthrough", label: "", description: "", position: { x: 48, y: 46 } },
        { localNodeId: "n2", type: "exception", label: "", description: "", position: { x: 273, y: 46 } },
      ],
      edges: [
        { localEdgeId: "e1", source: "n1", target: "n2" },
      ],
    });
    const result = generateProcessXml(flow, testRefs, testFolderId);

    expect(result).toContain("exception_icon");
  });

  it("renders message shape", () => {
    const flow = makeFlow("Msg Flow", {
      nodes: [
        { localNodeId: "n1", type: "start-passthrough", label: "", description: "", position: { x: 48, y: 46 } },
        { localNodeId: "n2", type: "message", label: "Build body", description: "", position: { x: 273, y: 46 } },
        { localNodeId: "n3", type: "stop", label: "", description: "", position: { x: 498, y: 46 } },
      ],
      edges: [
        { localEdgeId: "e1", source: "n1", target: "n2" },
        { localEdgeId: "e2", source: "n2", target: "n3" },
      ],
    });
    const result = generateProcessXml(flow, testRefs, testFolderId);

    expect(result).toContain("message_icon");
    expect(result).toContain('shapetype="message"');
    expect(result).toContain("<msgTxt/>");
  });

  it("renders trycatch shape", () => {
    const flow = makeFlow("TryCatch Flow", {
      nodes: [
        { localNodeId: "n1", type: "start-passthrough", label: "", description: "", position: { x: 48, y: 46 } },
        { localNodeId: "n2", type: "trycatch", label: "", description: "", position: { x: 273, y: 46 } },
        { localNodeId: "n3", type: "stop", label: "", description: "", position: { x: 498, y: 46 } },
      ],
      edges: [
        { localEdgeId: "e1", source: "n1", target: "n2" },
        { localEdgeId: "e2", source: "n2", target: "n3" },
      ],
    });
    const result = generateProcessXml(flow, testRefs, testFolderId);

    expect(result).toContain('shapetype="catcherrors"');
    expect(result).toContain('catchAll="true"');
  });

  it("renders decision shape", () => {
    const flow = makeFlow("Decision Flow", {
      nodes: [
        { localNodeId: "n1", type: "start-passthrough", label: "", description: "", position: { x: 48, y: 46 } },
        { localNodeId: "n2", type: "decision", label: "Check", description: "", position: { x: 273, y: 46 } },
        { localNodeId: "n3", type: "stop", label: "", description: "", position: { x: 498, y: 46 } },
      ],
      edges: [
        { localEdgeId: "e1", source: "n1", target: "n2" },
        { localEdgeId: "e2", source: "n2", target: "n3" },
      ],
    });
    const result = generateProcessXml(flow, testRefs, testFolderId);

    expect(result).toContain('shapetype="decision"');
    expect(result).toContain('comparison="equals"');
    expect(result).toContain("<decisionvalue");
  });

  it("generates xml without credentials", () => {
    const flow = makeFlow("Secure", {
      nodes: [
        { localNodeId: "n1", type: "start-passthrough", label: "", description: "", position: { x: 48, y: 46 } },
        { localNodeId: "n2", type: "stop", label: "", description: "", position: { x: 273, y: 46 } },
      ],
      edges: [
        { localEdgeId: "e1", source: "n1", target: "n2" },
      ],
    });
    const result = generateProcessXml(flow, testRefs, testFolderId);

    expect(result).not.toMatch(/apiPassword/i);
    expect(result).not.toMatch(/Bearer\s/i);
  });
});

// ── Connection Dispatcher ────────────────────────────────────────────────

describe("generateConnectionXml dispatcher", () => {
  it("routes REST endpoint to REST connection", () => {
    const endpoint = makeEndpoint({ connectorType: "REST" });
    const conn = makeConnection();
    const result = generateConnectionXml(endpoint, testFolderId, conn);
    expect(result).toContain('subType="officialboomi-X3979C-rest-prod"');
  });

  it("routes database endpoint to DB connection", () => {
    const endpoint = makeEndpoint({ connectorType: "Database V2" });
    const conn = makeConnection();
    const result = generateConnectionXml(endpoint, testFolderId, conn);
    expect(result).toContain('subType="officialboomi-X3979C-dbv2da-prod"');
  });

  it("routes disk endpoint to Disk V2 connection", () => {
    const endpoint = makeEndpoint({ connectorType: "Disk V2" });
    const conn = makeConnection();
    const result = generateConnectionXml(endpoint, testFolderId, conn);
    expect(result).toContain('subType="disk-sdk"');
  });
});
