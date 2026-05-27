import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boomiTemplateImportSchema,
  buildMapPreviewXml,
  buildProfilePreviewXml,
  extractProfileElementKeys,
  findProfileTemplateDraft,
  importBoomiTemplate,
  lookupBoomiComponents,
  normalizeBoomiBaseUrl,
  publishActionForDraft,
  publishBoomiComponent,
  publishTargetComponentId,
  profileComponentType,
  testBoomiConnection,
  validateComponentXml,
  validatePublishSafety,
  type BoomiConnectionInput,
} from "@/lib/boomi-sandbox";
import type { TransformMapOptions } from "@/lib/boomi-xml";
import type { FmdImportDraft } from "@/lib/fmd-import";
import type { BoomiComponentDraft, MappingSet, Profile } from "@/lib/domain";
import { extractProcessDependencies } from "@/lib/boomi-xml";

const sandboxConnection: BoomiConnectionInput = {
  accountId: "acct-1",
  environmentName: "Sandbox",
  baseUrl: "https://api.boomi.com/api/rest/v2",
  authMode: "Basic API Token",
  apiUsername: "BOOMI_TOKEN.user",
  apiPassword: "secret",
  mode: "sandbox",
};

const boomiSampleDir = "/Users/walidbargaoui/Documents/Boomi_Helper_Suite/samples/boomi";

function firstBoomiSample(prefix: string, requiredText?: string) {
  const file = readdirSync(boomiSampleDir).find((candidate) => {
    if (!candidate.startsWith(prefix) || !candidate.endsWith(".xml")) return false;
    if (!requiredText) return true;
    return readFileSync(join(boomiSampleDir, candidate), "utf8").includes(requiredText);
  });
  if (!file) throw new Error(`No Boomi sample found for ${prefix}`);
  return join(boomiSampleDir, file);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("boomi sandbox API helpers", () => {
  it("normalizes saved base URLs that already include a REST API path", () => {
    expect(normalizeBoomiBaseUrl("https://api.boomi.com/api/rest/v2")).toBe("https://api.boomi.com");
    expect(normalizeBoomiBaseUrl("https://api.boomi.com/api/rest/v1/")).toBe("https://api.boomi.com");
    expect(normalizeBoomiBaseUrl("https://api.boomi.com/")).toBe("https://api.boomi.com");
  });

  // After the M8 publish-gate lockdown, connector-action / connector-settings /
  // process / processproperty are import-only — they can carry imported template
  // XML to support reads (SqlLookup connection UUID resolution, etc.) but the
  // publish gate refuses them with a "read/import-only" message.
  it("blocks connector-action publish even with a valid template (import-only type)", () => {
    const result = validatePublishSafety(
      {
        componentType: "connector-action",
        validationStatus: "Dry-run valid",
        templateXml: "<Component/>",
        diff: "",
      },
      { connectionMode: "sandbox" },
    );

    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => /read\/import-only/.test(b))).toBe(true);
  });

  it("blocks connector-action publish when template XML is missing", () => {
    const result = validatePublishSafety(
      {
        componentType: "connector-action",
        validationStatus: "Dry-run valid",
        templateXml: "",
        diff: "",
      },
      { connectionMode: "sandbox" },
    );

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("No template XML attached. Import a sandbox template first.");
  });

  it("blocks process and processproperty publishes (import-only types)", () => {
    for (const componentType of ["process", "processproperty", "connector-settings"]) {
      const result = validatePublishSafety(
        {
          componentType,
          validationStatus: "Dry-run valid",
          templateXml: "<Component/>",
          diff: "",
        },
        { connectionMode: "sandbox" },
      );
      expect(result.ok, `expected ${componentType} to be blocked`).toBe(false);
      expect(result.blockers.some((b) => /read\/import-only/.test(b))).toBe(true);
    }
  });

  it("blocks a wholly unknown component type with a generic message", () => {
    const result = validatePublishSafety(
      {
        componentType: "operation.atomsphere.unknown",
        validationStatus: "Dry-run valid",
        templateXml: "<Component/>",
        diff: "",
      },
      { connectionMode: "sandbox" },
    );
    expect(result.ok).toBe(false);
    expect(result.blockers.some((b) => /not allowed for sandbox publish/.test(b))).toBe(true);
  });

  it("allows each profile type (flatfile, json, xml, db) under valid conditions", () => {
    for (const componentType of [
      "profile.flatfile",
      "profile.json",
      "profile.xml",
      "profile.db",
    ]) {
      const result = validatePublishSafety(
        {
          componentType,
          validationStatus: "Dry-run valid",
          templateXml: "<Component/>",
          diff: "",
        },
        { connectionMode: "sandbox" },
      );
      expect(result.ok, `expected ${componentType} to pass: ${result.blockers.join("; ")}`).toBe(true);
      expect(result.blockers).toEqual([]);
    }
  });

  it("allows map publish when profile templates and keys are present", () => {
    const mappingSet: MappingSet = {
      id: "ms1",
      name: "Sample Map",
      sourceProfileId: "src1",
      destinationProfileId: "dst1",
      direction: "source-to-destination",
      status: "Ready for Boomi",
      transformNodes: [],
      rules: [
        {
          id: "r1",
          mappingType: "direct",
          sourceFieldId: "sf1",
          destinationFieldId: "df1",
          qualityStatus: "ok",
          reviewed: true,
        },
      ],
    };

    const result = validatePublishSafety(
      {
        componentType: "transform.map",
        validationStatus: "Dry-run valid",
        templateXml: "<Component/>",
        diff: "",
      },
      {
        connectionMode: "sandbox",
        mappingSet,
        sourceProfileTemplateXml: "<Component/>",
        destinationProfileTemplateXml: "<Component/>",
      },
    );

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("explains map publish blockers before publish is enabled", () => {
    const mappingSet: MappingSet = {
      id: "ms1",
      name: "Sample Map",
      sourceProfileId: "src1",
      destinationProfileId: "dst1",
      direction: "source-to-destination",
      status: "Draft",
      transformNodes: [],
      rules: [
        {
          id: "r1",
          mappingType: "direct",
          destinationFieldId: "df1",
          qualityStatus: "error",
        },
        {
          id: "r2",
          mappingType: "constant",
          destinationFieldId: "df1",
          qualityStatus: "unchecked",
        },
      ],
    };

    const result = validatePublishSafety(
      {
        componentType: "transform.map",
        validationStatus: "Dry-run valid",
        templateXml: "<Component/>",
        diff: "",
      },
      {
        connectionMode: "mock",
        mappingSet,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("Connection is in mock mode. Switch to a sandbox connection before publish.");
    expect(result.blockers).toContain('Mapping set status is "Draft". Must be "Ready for Boomi".');
    expect(result.blockers).toContain("Source profile template XML is missing. Import the source profile template first.");
    expect(result.blockers).toContain("Destination profile template XML is missing. Import the destination profile template first.");
    expect(result.blockers).toContain("Mapping rule r1 has a mapping-quality error.");
    expect(result.blockers).toContain("Mapping rule r1 has no source field or expression.");
    expect(result.blockers).toContain("Mapping rule r2 is a constant without a value.");
    expect(result.blockers).toContain("Destination field df1 is mapped by multiple rules: r1, r2.");
    expect(result.warnings).toContain("Mapping rule r2 has not been checked by mapping quality.");
  });

  it("matches imported profile templates by overlapping Boomi element names", () => {
    const localProfile: Profile = {
      id: "local-service-now",
      name: "ServiceNow",
      role: "source",
      type: "API",
      format: "JSON",
      fields: [
        { id: "f1", name: "employee_number", dataType: "String", required: false, keyField: false, ordinal: 1 },
        { id: "f2", name: "mobile_phone", dataType: "String", required: false, keyField: false, ordinal: 2 },
      ],
    };
    const templateProfile: Profile = {
      ...localProfile,
      id: "boomi-profile",
      name: "AMS_To_SFs_Phone_input",
      type: "JSON",
    };
    const { xml } = buildProfilePreviewXml(templateProfile);
    const templateDraft: BoomiComponentDraft = {
      id: "draft-imported-json",
      componentId: "d5c8c8ca-f1ef-4a25-89af-61f0776cabb0",
      componentName: "AMS_To_SFs_Phone_input",
      componentType: "profile.json",
      templateXml: xml,
      proposedXml: xml,
      diff: "",
      validationStatus: "Dry-run valid",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
    };

    expect(findProfileTemplateDraft([templateDraft], localProfile)?.componentId).toBe(templateDraft.componentId);
  });

  it("treats template-patched local drafts as updates to the XML component id", () => {
    const proposedXml = '<bns:Component componentId="448dbb0a-ebdc-4408-97e7-c15ea42b2d7f" type="transform.map"><bns:object/></bns:Component>';
    const draft = { componentId: "draft-map-local", proposedXml };

    expect(publishTargetComponentId(draft)).toBe("448dbb0a-ebdc-4408-97e7-c15ea42b2d7f");
    expect(publishActionForDraft(draft)).toBe("update");
  });

  it("tests a sandbox connection with a Boomi-supported ComponentMetadata filter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ numberOfResults: 7 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await testBoomiConnection(sandboxConnection);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.boomi.com/api/rest/v1/acct-1/ComponentMetadata/query");
    const body = JSON.parse(String(init.body));
    expect(body.QueryFilter.expression).toMatchObject({
      operator: "EQUALS",
      property: "currentVersion",
      argument: ["true"],
    });
  });

  it("looks up a UUID with a simple componentId equals query and parses string booleans", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          numberOfResults: 2,
          result: [
            {
              componentId: "6d268f1f-1538-46a2-8076-e6b0ec1b699d",
              version: "3",
              currentVersion: "true",
              name: "Map delta_440",
              type: "transform.map",
              deleted: "false",
            },
            {
              componentId: "6d268f1f-1538-46a2-8076-e6b0ec1b699d",
              version: "2",
              currentVersion: "false",
              name: "Map delta_440",
              type: "transform.map",
              deleted: "false",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupBoomiComponents(sandboxConnection, {
      componentName: "6d268f1f-1538-46a2-8076-e6b0ec1b699d",
    });

    expect(result.components).toHaveLength(2);
    expect(result.components[0]).toMatchObject({ version: 3, currentVersion: true, status: "active" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.QueryFilter.expression).toMatchObject({
      operator: "EQUALS",
      property: "componentId",
      argument: ["6d268f1f-1538-46a2-8076-e6b0ec1b699d"],
    });
  });

  it("looks up names with a LIKE query and filters deleted/type mismatches client-side", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          numberOfResults: 3,
          result: [
            {
              componentId: "map-1",
              version: 3,
              currentVersion: true,
              name: " Map delta_440",
              type: "transform.map",
              deleted: false,
            },
            {
              componentId: "profile-1",
              version: 1,
              currentVersion: true,
              name: " Map delta_440 helper",
              type: "profile.json",
              deleted: false,
            },
            {
              componentId: "deleted-1",
              version: 1,
              currentVersion: true,
              name: " Map delta_440 old",
              type: "transform.map",
              deleted: true,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupBoomiComponents(sandboxConnection, {
      componentName: "Map delta_440",
      componentType: "transform.map",
    });

    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({ componentId: "map-1", type: "transform.map" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.QueryFilter.expression).toMatchObject({
      operator: "LIKE",
      property: "name",
      argument: ["%Map delta_440%"],
    });
  });

  it("allows sandbox template import requests without caller-supplied XML", async () => {
    const parsed = boomiTemplateImportSchema.safeParse({
      componentId: "cmp-1",
      componentName: "Imported map",
      componentType: "transform.map",
      version: 3,
    });

    expect(parsed.success).toBe(true);
  });

  it("fetches a component template by component ID and version", async () => {
    const xml = '<bns:Component type="transform.map" name="Imported map"><bns:object /></bns:Component>';
    const fetchMock = vi.fn().mockResolvedValue(new Response(xml, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await importBoomiTemplate(sandboxConnection, {
      componentId: "cmp-1",
      componentName: "Imported map",
      componentType: "transform.map",
      version: 3,
    });

    expect(result.templateXml).toBe(xml);
    expect(result.validationIssues).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.boomi.com/api/rest/v1/acct-1/Component/cmp-1~3");
    expect((init.headers as Record<string, string>).Accept).toBe("application/xml");
  });

  it("publishes a guarded component update with XML payload", async () => {
    const responseXml =
      '<bns:Component xmlns:bns="http://api.platform.boomi.com/" componentId="6d268f1f-1538-46a2-8076-e6b0ec1b699d" version="4" name="Map delta_440" type="transform.map"/>';
    const fetchMock = vi.fn().mockResolvedValue(new Response(responseXml, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await publishBoomiComponent(sandboxConnection, {
      componentId: "6d268f1f-1538-46a2-8076-e6b0ec1b699d",
      componentName: "Map delta_440",
      componentType: "transform.map",
      proposedXml: "<Component/>",
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe("update");
    expect(result.componentId).toBe("6d268f1f-1538-46a2-8076-e6b0ec1b699d");
    expect(result.version).toBe(4);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.boomi.com/api/rest/v1/acct-1/Component/6d268f1f-1538-46a2-8076-e6b0ec1b699d");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/xml" });
    expect(init.body).toBe("<Component/>");
  });

  it("returns publish failure details without throwing for Boomi HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<error>invalid xml</error>", { status: 400 })),
    );

    const result = await publishBoomiComponent(sandboxConnection, {
      componentId: "draft-map-ms1",
      componentName: "New Map",
      componentType: "transform.map",
      proposedXml: "<Component/>",
    });

    expect(result.ok).toBe(false);
    expect(result.action).toBe("create");
    expect(result.errorDetail).toContain("HTTP 400");
    expect(result.responseXml).toContain("invalid xml");
  });

  it("treats Boomi same-configuration responses as no-op success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          '<error><message>The provided XML contains the same configuration values as the previous version.</message></error>',
          { status: 403 },
        ),
      ),
    );

    const result = await publishBoomiComponent(sandboxConnection, {
      componentId: "6d268f1f-1538-46a2-8076-e6b0ec1b699d",
      componentName: "Map delta_440",
      componentType: "transform.map",
      proposedXml: "<Component/>",
    });

    expect(result.ok).toBe(true);
    expect(result.noop).toBe(true);
    expect(result.action).toBe("update");
  });
});

describe("Boomi-shape XML generators", () => {
  function makeProfile(overrides: Partial<Profile> = {}): Profile {
    return {
      id: "p1",
      name: "Sample profile",
      role: "source",
      type: "Flat File",
      format: "TSV",
      rootPath: undefined,
      fields: [
        { id: "f1", name: "id", dataType: "Integer", required: true, keyField: true, ordinal: 1 },
        { id: "f2", name: "amount", dataType: "Decimal", required: false, keyField: false, ordinal: 2 },
      ],
      ...overrides,
    };
  }

  it("maps profile.type → Boomi componentType for every supported type", () => {
    expect(profileComponentType(makeProfile({ type: "Flat File" }))).toBe("profile.flatfile");
    expect(profileComponentType(makeProfile({ type: "JSON" }))).toBe("profile.json");
    expect(profileComponentType(makeProfile({ type: "XML" }))).toBe("profile.xml");
    // Updated: Database profiles now route to profile.db (was routing to profile.flatfile).
    expect(profileComponentType(makeProfile({ type: "Database" }))).toBe("profile.db");
    expect(profileComponentType(makeProfile({ type: "API" }))).toBe("profile.json");
  });

  it("flatfile scaffold matches the real Boomi schema shape", () => {
    const { xml, componentType } = buildProfilePreviewXml(makeProfile({ type: "Flat File", format: "TSV" }));
    expect(componentType).toBe("profile.flatfile");
    expect(xml).toContain('xmlns:bns="http://api.platform.boomi.com/"');
    expect(xml).toContain('type="profile.flatfile"');
    expect(xml).toContain('<FlatFileProfile xmlns="" modelVersion="2" strict="true">');
    expect(xml).toContain('<ProfileProperties>');
    expect(xml).toContain('<GeneralInfo fileType="delimited"');
    expect(xml).toContain('<DelimitedOptions fileDelimiter="tabdelimited"');
    expect(xml).toContain('<DataElements>');
    expect(xml).toContain('<FlatFileRecord detectFormat="numberofcolumns"');
    expect(xml).toContain('<FlatFileElements');
    expect(xml).toContain('dataType="number"'); // Integer field
    expect(xml).toContain('<DataFormat><ProfileNumberFormat/></DataFormat>');
    expect(validateComponentXml(xml).ok).toBe(true);
  });

  it("json scaffold matches the real Boomi schema shape including nesting", () => {
    const profile = makeProfile({
      type: "JSON",
      format: "JSON",
      fields: [
        { id: "f1", name: "id", dataType: "String", required: true, keyField: true, ordinal: 1 },
        { id: "f2", name: "address", dataType: "object", required: false, keyField: false, ordinal: 2 },
        { id: "f3", name: "city", parentPath: "address", dataType: "String", required: false, keyField: false, ordinal: 3 },
      ],
    });
    const { xml, componentType } = buildProfilePreviewXml(profile);
    expect(componentType).toBe("profile.json");
    expect(xml).toContain('type="profile.json"');
    expect(xml).toContain('<JSONProfile xmlns="" strict="false">');
    expect(xml).toContain('<JSONRootValue dataType="character"');
    expect(xml).toContain('<JSONObject isMappable="false"');
    expect(xml).toContain('<JSONObjectEntry');
    expect(xml).toContain('name="address"');
    expect(xml).toContain('name="city"');
    expect(xml).toContain('<Qualifiers><QualifierList/></Qualifiers>');
    expect(xml).toContain('<tagLists/>');
    expect(validateComponentXml(xml).ok).toBe(true);
  });

  it("profile.db scaffold matches DatabaseProfile shape (source → select)", async () => {
    const { buildDbProfileXml } = await import("@/lib/boomi-xml");
    const profile = makeProfile({
      id: "p-src",
      type: "Database",
      role: "source",
      format: "Table",
      rootPath: "TR3AOWN.tffm05",
      fields: [
        { id: "f1", name: "ID", dataType: "Integer", required: true, keyField: true, ordinal: 1 },
        { id: "f2", name: "NAME", dataType: "String", required: false, keyField: false, ordinal: 2 },
        { id: "f3", name: "CREATED", dataType: "Date", required: false, keyField: false, ordinal: 3 },
      ],
    });
    const xml = buildDbProfileXml(profile);
    expect(xml).toContain('type="profile.db"');
    expect(xml).toContain('<DatabaseProfile xmlns="" strict="true" version="2">');
    expect(xml).toContain('<DatabaseGeneralInfo executionType="dbread"/>');
    expect(xml).toContain('statementType="select"');
    expect(xml).toContain('tableName="TR3AOWN.tffm05"');
    expect(xml).toContain('<DBFields isNode="true"');
    expect(xml).toContain('type="result_set"');
    expect(xml).toContain('<DatabaseElement dataType="number"');
    expect(xml).toContain('<DatabaseElement dataType="character"');
    expect(xml).toContain('<DatabaseElement dataType="datetime"');
    expect(xml).toContain('<ProfileDateFormat/>'); // profile.db datetime has no pattern
    expect(xml).toContain('<DBParameters isNode="true"');
    expect(xml).toContain('<sql/>');
    expect(validateComponentXml(xml).ok).toBe(true);
  });

  it("profile.db scaffold for a destination profile emits dynamicinsert", async () => {
    const { buildDbProfileXml } = await import("@/lib/boomi-xml");
    const profile = makeProfile({
      id: "p-dst",
      type: "Database",
      role: "destination",
      format: "Table",
      rootPath: "TR3AOWN.tffm05",
      fields: [
        { id: "f1", name: "ID", dataType: "Integer", required: true, keyField: true, ordinal: 1 },
      ],
    });
    const xml = buildDbProfileXml(profile);
    expect(xml).toContain('<DatabaseGeneralInfo executionType="dbwrite"/>');
    expect(xml).toContain('statementType="dynamicinsert"');
    expect(xml).not.toContain('<DBParameters'); // writes don't emit DBParameters in scaffold
    expect(validateComponentXml(xml).ok).toBe(true);
  });

  it("profile.db scaffold maps Stored Procedure format to storedprocedure", async () => {
    const { buildDbProfileXml } = await import("@/lib/boomi-xml");
    const profile = makeProfile({
      id: "p-sp",
      type: "Database",
      role: "source",
      format: "Stored Procedure",
      rootPath: "sp_lookup_user",
      fields: [
        { id: "f1", name: "USER_ID", dataType: "Integer", required: true, keyField: true, ordinal: 1 },
      ],
    });
    const xml = buildDbProfileXml(profile);
    expect(xml).toContain('statementType="storedprocedure"');
    expect(xml).toContain('storedProcedure="sp_lookup_user"');
    expect(xml).toContain('tableName=""');
    expect(validateComponentXml(xml).ok).toBe(true);
  });

  it("json scaffold emits ProfileDateFormat for datetime fields and dataType=boolean for booleans", () => {
    const profile = makeProfile({
      type: "JSON",
      format: "JSON",
      fields: [
        { id: "f1", name: "id", dataType: "String", required: true, keyField: true, ordinal: 1 },
        { id: "f2", name: "createdAt", dataType: "DateTime", format: "yyyy-MM-dd'T'HH:mm:ss.SSSZZ", required: false, keyField: false, ordinal: 2 },
        { id: "f3", name: "isActive", dataType: "Boolean", required: false, keyField: false, ordinal: 3 },
      ],
    });
    const { xml } = buildProfilePreviewXml(profile);
    expect(xml).toContain('dataType="datetime"');
    expect(xml).toContain('<ProfileDateFormat dateFormat="yyyy-MM-dd&apos;T&apos;HH:mm:ss.SSSZZ"/>');
    expect(xml).toContain('dataType="boolean"');
    // Boolean uses ProfileCharacterFormat per real samples
    expect(xml).toContain('<JSONObjectEntry dataType="boolean"');
    expect(validateComponentXml(xml).ok).toBe(true);
  });

  it("transform.map emits real FunctionStep + dual Mapping for function/lookup/join rules", () => {
    const source = makeProfile({
      id: "src1",
      role: "source",
      name: "Source",
      fields: [
        { id: "sf1", name: "name", dataType: "String", required: true, keyField: false, ordinal: 1 },
      ],
    });
    const dest = makeProfile({
      id: "dst1",
      role: "destination",
      name: "Dest",
      fields: [
        { id: "df1", name: "trimmed", dataType: "String", required: true, keyField: false, ordinal: 1 },
        { id: "df2", name: "lookup_result", dataType: "String", required: false, keyField: false, ordinal: 2 },
      ],
    });
    const mappingSet = {
      id: "ms-funcs",
      name: "With Functions",
      sourceProfileId: "src1",
      destinationProfileId: "dst1",
      direction: "in",
      status: "Draft" as const,
      transformNodes: [],
      rules: [
        { id: "r1", mappingType: "function" as const, sourceFieldId: "sf1", destinationFieldId: "df1", expression: "return input.toUpperCase();", comment: "upper" },
        { id: "r2", mappingType: "lookup" as const, sourceFieldId: "sf1", destinationFieldId: "df2", expression: "SELECT v FROM t WHERE k=?", comment: "sql lookup" },
      ],
    };
    const project = {
      id: "proj1", processId: "TEST", name: "Test", description: "",
      sourceSystem: "", destinationSystem: "", status: "Draft" as const, owner: "",
      endpoints: [], profiles: [source, dest], mappingSets: [mappingSet],
      processFlows: [], fmdSections: [], boomiConnections: [], boomiDrafts: [],
    };
    const xml = buildMapPreviewXml(project, mappingSet, source, dest);
    // FunctionStep shape (real Boomi tag, not legacy <Function>)
    expect(xml).toContain('<FunctionStep cacheEnabled="true" cacheOption="none"');
    expect(xml).toContain('type="Scripting"');
    expect(xml).toContain('type="SqlLookup"');
    expect(xml).toContain('<Inputs><Input key="1" name="input"/></Inputs>');
    expect(xml).toContain('<ScriptToExecute>return input.toUpperCase();</ScriptToExecute>');
    expect(xml).toContain('<SqlLookup connection="" executionType="sql"');
    expect(xml).toContain('<SqlToExecute>SELECT v FROM t WHERE k=?</SqlToExecute>');
    // Dual Mapping: field → function (toType=function) AND function → field (fromType=function)
    expect(xml).toContain('toFunction="1" toKey="1" toType="function"');
    expect(xml).toContain('fromFunction="1" fromKey="2" fromType="function"');
    expect(xml).toContain('toFunction="2"'); // second function step
    expect(xml).toContain('fromFunction="2"');
    // No legacy <Function> stub left behind
    expect(xml).not.toMatch(/<Function key=/);
    expect(validateComponentXml(xml).ok).toBe(true);
  });

  it("patches a real profile.db template, replacing DataElements while keeping envelope metadata", async () => {
    const { patchDbProfile } = await import("@/lib/boomi-xml");
    const template = readFileSync(firstBoomiSample("profile-db__", "statementType=\"select\""), "utf8");
    const folderAttr = template.match(/folderFullPath="[^"]+"/)?.[0];
    const profile: Profile = {
      id: "p-db",
      name: "Patched DB",
      role: "source",
      type: "Database",
      format: "Table",
      rootPath: "test.local_table",
      fields: [
        { id: "f1", name: "PATCHED_COL", dataType: "String", required: true, keyField: false, ordinal: 1 },
      ],
    };
    const patched = patchDbProfile(template, profile);
    if (folderAttr) expect(patched).toContain(folderAttr);
    expect(patched).toContain("<DatabaseProfile");
    expect(patched).toContain('name="PATCHED_COL"');
    // statementType="select" should still appear in the patched output (we replaced DataElements with our own)
    expect(patched).toMatch(/statementType="select"/);
    expect(validateComponentXml(patched).ok).toBe(true);
  });

  it("flatfile scaffold maps Pipe format to bardelimited (not pipedelimited)", () => {
    const { xml } = buildProfilePreviewXml(makeProfile({ type: "Flat File", format: "Pipe" }));
    expect(xml).toContain('fileDelimiter="bardelimited"');
    expect(xml).not.toContain('pipedelimited');
  });

  it("xml scaffold matches the real Boomi schema shape", () => {
    const { xml, componentType } = buildProfilePreviewXml(makeProfile({ type: "XML", format: "XML", rootPath: "Order" }));
    expect(componentType).toBe("profile.xml");
    expect(xml).toContain('type="profile.xml"');
    expect(xml).toContain('<XMLProfile xmlns="" modelVersion="2" strict="true">');
    expect(xml).toContain('<XMLOptions encoding="utf8"');
    expect(xml).toContain('<XMLElement');
    expect(xml).toContain('name="Order"');
    expect(xml).toContain('<Namespaces>');
    expect(validateComponentXml(xml).ok).toBe(true);
  });

  it("transform.map scaffold matches the real Boomi schema shape", () => {
    const source = makeProfile({
      id: "src1",
      role: "source",
      name: "Source profile",
      fields: [
        { id: "sf1", name: "from1", dataType: "String", required: true, keyField: false, ordinal: 1 },
      ],
    });
    const dest = makeProfile({
      id: "dst1",
      role: "destination",
      name: "Destination profile",
      fields: [
        { id: "df1", name: "to1", dataType: "String", required: true, keyField: false, ordinal: 1 },
        { id: "df2", name: "to2", dataType: "String", required: false, keyField: false, ordinal: 2 },
      ],
    });
    const mappingSet = {
      id: "ms1",
      name: "Sample Map",
      sourceProfileId: "src1",
      destinationProfileId: "dst1",
      direction: "in",
      status: "Draft" as const,
      transformNodes: [],
      rules: [
        { id: "r1", mappingType: "direct" as const, sourceFieldId: "sf1", destinationFieldId: "df1" },
        { id: "r2", mappingType: "constant" as const, destinationFieldId: "df2", defaultValue: "STATIC" },
      ],
    };
    const project = {
      id: "proj1",
      processId: "TEST",
      name: "Test",
      description: "",
      sourceSystem: "",
      destinationSystem: "",
      status: "Draft" as const,
      owner: "",
      endpoints: [],
      profiles: [source, dest],
      mappingSets: [mappingSet],
      processFlows: [],
      fmdSections: [],
      boomiConnections: [],
      boomiDrafts: [],
    };
    const xml = buildMapPreviewXml(project, mappingSet, source, dest);
    expect(xml).toContain('type="transform.map"');
    expect(xml).toContain('<Map xmlns="" fromProfile="src1" toProfile="dst1">');
    expect(xml).toContain('<Mappings>');
    expect(xml).toContain('fromKey="3"'); // sequential keys: src field starts at 3
    expect(xml).toContain('toKey="4"');
    expect(xml).toContain('<Defaults>');
    expect(xml).toContain('<Default toKey="5" value="STATIC"/>');
    expect(xml).toContain('<Functions optimizeExecutionOrder="true">');
    expect(xml).toContain('<DocumentCacheJoins/>');
    expect(validateComponentXml(xml).ok).toBe(true);
  });

  it("patches a real flatfile template with local fields (preserves ProfileProperties)", async () => {
    const { patchFlatFileProfile } = await import("@/lib/boomi-xml");
    const template = readFileSync(firstBoomiSample("profile-flatfile__"), "utf8");
    const folderAttr = template.match(/folderFullPath="[^"]+"/)?.[0];
    const delimiterAttr = template.match(/fileDelimiter="[^"]+"/)?.[0];
    const profile: Profile = {
      id: "p1",
      name: "Patched",
      role: "source",
      type: "Flat File",
      format: "CSV",
      fields: [
        { id: "f1", name: "LocalField", dataType: "String", required: true, keyField: false, ordinal: 1, length: "20" },
      ],
    };
    const patched = patchFlatFileProfile(template, profile);
    // Template-only metadata is preserved
    if (folderAttr) expect(patched).toContain(folderAttr);
    expect(patched.match(/<\?xml/g)).toHaveLength(1);
    expect(patched).toContain('<ProfileProperties>');
    if (delimiterAttr) expect(patched).toContain(delimiterAttr);
    // Local fields supplant the template's DataElements children
    expect(patched).toContain('name="LocalField"');
    expect(patched).not.toBe(template);
    expect(validateComponentXml(patched).ok).toBe(true);
  });

  it("uses reconciled element keys from a real flatfile template in transform map output", () => {
    const template = readFileSync(firstBoomiSample("profile-flatfile__"), "utf8");
    const elementKeys = extractProfileElementKeys(template);
    expect(elementKeys.size).toBeGreaterThan(0);

    const fieldNames = [...elementKeys.keys()].slice(0, 3);
    const source = makeProfile({
      id: "src-reconciled",
      role: "source",
      name: "Reconciled Source",
      fields: fieldNames.map((name, i) => ({
        id: `sf${i}`,
        name,
        dataType: "String" as const,
        required: false,
        keyField: false,
        ordinal: i + 1,
      })),
    });
    const dest = makeProfile({
      id: "dst-reconciled",
      role: "destination",
      name: "Reconciled Dest",
      fields: [
        { id: "df1", name: "output", dataType: "String" as const, required: true, keyField: false, ordinal: 1 },
      ],
    });
    const mappingSet = {
      id: "ms-reconciled",
      name: "Reconciled Map",
      sourceProfileId: "src-reconciled",
      destinationProfileId: "dst-reconciled",
      direction: "in" as const,
      status: "Draft" as const,
      transformNodes: [],
      rules: fieldNames.map((_, i) => ({
        id: `r${i}`,
        mappingType: "direct" as const,
        sourceFieldId: `sf${i}`,
        destinationFieldId: "df1",
      })),
    };
    const project = {
      id: "proj-reconciled",
      processId: "RECON",
      name: "Reconciled",
      description: "",
      sourceSystem: "",
      destinationSystem: "",
      status: "Draft" as const,
      owner: "",
      endpoints: [],
      profiles: [source, dest],
      mappingSets: [mappingSet],
      processFlows: [],
      fmdSections: [],
      boomiConnections: [],
      boomiDrafts: [],
    };

    const opts: TransformMapOptions = { sourceElementKeys: elementKeys };
    const xml = buildMapPreviewXml(project, mappingSet, source, dest, opts);

    for (const name of fieldNames) {
      const entry = elementKeys.get(name);
      expect(entry).toBeDefined();
      expect(xml).toContain(`fromKey="${entry!.key}"`);
    }
  });

  it("patchTransformMap reconciliation: real flatfile template keys flow into a patched real transform.map template (golden-file)", async () => {
    const { patchTransformMap, extractBoomiComponentId } = await import("@/lib/boomi-xml");

    // Real source profile template (provides real Boomi element keys + componentId).
    const sourceTemplate = readFileSync(firstBoomiSample("profile-flatfile__"), "utf8");
    const sourceElementKeys = extractProfileElementKeys(sourceTemplate);
    expect(sourceElementKeys.size).toBeGreaterThan(0);
    const sourceBoomiId = extractBoomiComponentId(sourceTemplate);
    expect(sourceBoomiId).toBeTruthy();

    // Real destination profile template — element keys reused for the destination side.
    const destTemplate = readFileSync(firstBoomiSample("profile-flatfile__"), "utf8");
    const destElementKeys = extractProfileElementKeys(destTemplate);
    const destBoomiId = extractBoomiComponentId(destTemplate);

    // Real transform.map template that we will patch.
    const mapTemplate = readFileSync(firstBoomiSample("transform-map__"), "utf8");
    const mapTemplateComponentId = extractBoomiComponentId(mapTemplate);
    expect(mapTemplateComponentId).toBeTruthy();

    // Build a local mapping referencing the first reconciled source field name.
    const sourceFieldNames = [...sourceElementKeys.keys()].slice(0, 2);
    const destFieldNames = [...destElementKeys.keys()].slice(0, 1);

    const source = makeProfile({
      id: "src-recon",
      role: "source",
      name: "Recon Source",
      fields: sourceFieldNames.map((name, i) => ({
        id: `sf${i}`,
        name,
        dataType: "String" as const,
        required: false,
        keyField: false,
        ordinal: i + 1,
      })),
    });
    const dest = makeProfile({
      id: "dst-recon",
      role: "destination",
      name: "Recon Dest",
      fields: destFieldNames.map((name, i) => ({
        id: `df${i}`,
        name,
        dataType: "String" as const,
        required: true,
        keyField: false,
        ordinal: i + 1,
      })),
    });
    const mappingSet = {
      id: "ms-recon",
      name: "Recon Map",
      sourceProfileId: "src-recon",
      destinationProfileId: "dst-recon",
      direction: "in" as const,
      status: "Draft" as const,
      transformNodes: [],
      rules: sourceFieldNames.map((_name, i) => ({
        id: `r${i}`,
        mappingType: "direct" as const,
        sourceFieldId: `sf${i}`,
        destinationFieldId: "df0",
      })),
    };
    const project = {
      id: "proj-recon",
      processId: "RECON",
      name: "Recon",
      description: "",
      sourceSystem: "",
      destinationSystem: "",
      status: "Draft" as const,
      owner: "",
      endpoints: [],
      profiles: [source, dest],
      mappingSets: [mappingSet],
      processFlows: [],
      fmdSections: [],
      boomiConnections: [],
      boomiDrafts: [],
    };

    const opts: TransformMapOptions = {
      sourceElementKeys,
      destinationElementKeys: destElementKeys,
      sourceBoomiId: sourceBoomiId ?? undefined,
      destinationBoomiId: destBoomiId ?? undefined,
    };

    const patched = patchTransformMap(mapTemplate, project, mappingSet, source, dest, opts);

    // 1. Envelope metadata from the real map template is preserved.
    expect(patched).toContain(`componentId="${mapTemplateComponentId}"`);
    expect(patched).toContain(`type="transform.map"`);

    // 2. Real reconciled source element keys land in the patched <Mappings>.
    for (const name of sourceFieldNames) {
      const entry = sourceElementKeys.get(name);
      expect(entry).toBeDefined();
      expect(patched, `expected fromKey="${entry!.key}" for ${name}`).toContain(`fromKey="${entry!.key}"`);
    }

    // 3. The patched <Mappings> section is freshly generated content, not just
    // the template's original mappings. The template ships with destination
    // ordinals from real fields; our generated mappings use the destination keys
    // we passed via destinationElementKeys.
    const destEntry = destElementKeys.get(destFieldNames[0]);
    if (destEntry) {
      expect(patched).toContain(`toKey="${destEntry.key}"`);
    }
  });

  it("patches a real JSON template with local fields", async () => {
    const { patchJsonProfile } = await import("@/lib/boomi-xml");
    const template = readFileSync(firstBoomiSample("profile-json__"), "utf8");
    const originalEntryName = template.match(/JSONObjectEntry[^>]+name="([^"]+)"/)?.[1];
    const profile: Profile = {
      id: "p1",
      name: "Patched JSON",
      role: "destination",
      type: "JSON",
      format: "JSON",
      fields: [
        { id: "f1", name: "patchedField", dataType: "String", required: false, keyField: false, ordinal: 1 },
      ],
    };
    const patched = patchJsonProfile(template, profile);
    expect(patched).toContain('<JSONProfile');
    expect(patched).toContain('name="patchedField"');
    if (originalEntryName) expect(patched).not.toContain(`name="${originalEntryName}"`);
    expect(validateComponentXml(patched).ok).toBe(true);
  });

  it("matches the inner structure of a real flatfile sample (golden file)", () => {
    const sample = readFileSync(firstBoomiSample("profile-flatfile__", "<ProfileCharacterFormat"), "utf8");
    expect(sample).toContain('<FlatFileProfile xmlns="" modelVersion="2" strict="true">');
    expect(sample).toContain('<FlatFileElement ');
    expect(sample).toContain('<ProfileCharacterFormat/>');

    const { xml } = buildProfilePreviewXml({
      id: "p1",
      name: "Generated Flat File",
      role: "source",
      type: "Flat File",
      format: "CSV",
      fields: [
        { id: "f1", name: "VisitDate", dataType: "Integer", required: true, keyField: false, ordinal: 1, length: "8" },
        { id: "f2", name: "FSDeliveryPlaceCd", dataType: "String", required: true, keyField: false, ordinal: 2, length: "9" },
      ],
    });
    expect(xml).toContain('<ProfileNumberFormat/>');
    expect(xml).toContain('<ProfileCharacterFormat/>');
    expect(xml).toContain('name="VisitDate"');
    expect(xml).toContain('mandatory="true"');
    expect(xml).toContain('maxLength="9"');
  });
});

describe("extractProcessDependencies", () => {
  it("extracts map, connector, and subprocess references from process XML", () => {
    const processXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<bns:Component xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bns="http://api.platform.boomi.com/" componentId="process-uuid" version="1" name="Test Process" type="process">
<bns:object>
<process xmlns="" allowSimultaneous="false">
<shapes>
<shape image="map_icon" name="shape1" shapetype="map" userlabel="Map Shape" x="100" y="100">
<configuration><map componentId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001"/></configuration>
</shape>
<shape image="connector_icon" name="shape2" shapetype="connector" userlabel="Connector" x="200" y="100">
<configuration><connector connection="aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0002" operation="" name="My Connector"/></configuration>
</shape>
<shape image="subprocess_icon" name="shape3" shapetype="subprocess" userlabel="Subprocess" x="300" y="100">
<configuration><subprocess componentId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0003"/></configuration>
</shape>
</shapes>
</process>
</bns:object>
</bns:Component>`;

    const deps = extractProcessDependencies(processXml);
    expect(deps).toHaveLength(3);
    expect(deps).toContainEqual({ componentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001", componentType: "transform.map" });
    expect(deps).toContainEqual({ componentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0002", componentType: "connector-settings" });
    expect(deps).toContainEqual({ componentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0003", componentType: "process" });
  });

  it("returns empty array for empty or whitespace-only input", () => {
    expect(extractProcessDependencies("")).toEqual([]);
    expect(extractProcessDependencies("   ")).toEqual([]);
  });

  it("deduplicates repeated component IDs", () => {
    const processXml = `
<shape><configuration><map componentId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001"/></configuration></shape>
<shape><configuration><map componentId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001"/></configuration></shape>`;
    expect(extractProcessDependencies(processXml)).toHaveLength(1);
  });
});

describe("FMD apply → dry-run → publish integration", () => {
  it("rejects unsafe publish and detects conflicts between a draft and an existing project", async () => {
    const { detectFmdConflicts } = await import("@/lib/fmd-apply");

    const currentProject: Parameters<typeof detectFmdConflicts>[1] = {
      id: "proj-existing",
      processId: "EXISTING",
      name: "Existing Project",
      description: "",
      sourceSystem: "SrcA",
      destinationSystem: "DstA",
      status: "Draft",
      owner: "user",
      endpoints: [
        { id: "ep1", name: "HTTP Source", role: "source", connectorType: "HTTP Client", profileType: "JSON", format: "JSON", purpose: "", connectionInfo: "" },
      ],
      profiles: [
        {
          id: "p1",
          name: "Existing Profile",
          role: "source",
          type: "Flat File",
          format: "CSV",
          fields: [
            { id: "f1", name: "col_a", dataType: "String", required: false, keyField: false, ordinal: 1 },
          ],
        },
      ],
      mappingSets: [],
      processFlows: [],
      fmdSections: [],
      boomiConnections: [],
      boomiDrafts: [],
    };

    const draft: FmdImportDraft = {
      project: {
        processId: "DRAFT001",
        name: "Draft Project",
        description: "From FMD",
        sourceSystem: "SrcB",
        destinationSystem: "DstB",
        owner: "user",
        status: "Draft",
        confidence: 0.9,
        evidenceRefs: [],
      },
      endpoints: [
        { name: "HTTP Source", role: "source", connectorType: "HTTP Client", profileType: "JSON", format: "JSON", purpose: "", connectionInfo: "", confidence: 0.8, evidenceRefs: [] },
      ],
      profiles: [
        {
          id: "dp1",
          name: "Existing Profile",
          role: "source",
          type: "Flat File",
          format: "CSV",
          fields: [
            { name: "col_a", dataType: "Integer", required: true, confidence: 0.7, evidenceRefs: [] },
          ],
          confidence: 0.9,
          evidenceRefs: [],
        },
      ],
      mappingSets: [],
      fmdSections: [],
      warnings: [],
      unresolvedEvidenceRefs: [],
    };

    const conflicts = detectFmdConflicts(
      {
        mode: "merge",
        projectId: currentProject.id,
        draft,
        selection: {},
      },
      currentProject,
    );

    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.some((c) => c.type === "profile-duplicate")).toBe(true);
    expect(conflicts.some((c) => c.type === "endpoint-duplicate")).toBe(true);
    expect(conflicts.some((c) => c.type === "field-type")).toBe(true);
    expect(conflicts.some((c) => c.type === "field-required")).toBe(true);

    const publishMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ numberOfResults: 0, result: [] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", publishMock);

    const safetyResult = validatePublishSafety(
      {
        componentType: "connector-action",
        validationStatus: "Draft",
        templateXml: "",
        diff: "",
      },
      { connectionMode: "mock" },
    );

    expect(safetyResult.ok).toBe(false);
    expect(safetyResult.blockers).toContain("No template XML attached. Import a sandbox template first.");
    expect(safetyResult.blockers).toContain('Validation status is "Draft". Must be "Dry-run valid".');
    expect(safetyResult.blockers).toContain("Connection is in mock mode. Switch to a sandbox connection before publish.");
  });
});
