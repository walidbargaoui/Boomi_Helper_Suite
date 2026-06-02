import { describe, expect, it, afterAll, afterEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { POST as createProject } from "@/app/api/projects/route";
import { POST as createEndpoint } from "@/app/api/projects/[projectId]/endpoints/route";
import { POST as createProfile } from "@/app/api/projects/[projectId]/profiles/route";
import { POST as createField } from "@/app/api/profiles/[profileId]/fields/route";
import { POST as createMappingSet } from "@/app/api/projects/[projectId]/mapping-sets/route";
import { POST as createRule } from "@/app/api/mapping-sets/[mappingSetId]/rules/route";
import { POST as applyFmd } from "@/app/api/fmd/apply/route";
import { POST as createConnection } from "@/app/api/boomi/connections/route";
import { POST as importTemplate } from "@/app/api/boomi/templates/import/route";
import { POST as dryRun } from "@/app/api/boomi/dry-run/route";
import { POST as publish } from "@/app/api/boomi/publish/route";
import { validateComponentXml } from "@/lib/boomi-sandbox";

function jsonRequest(method: string, body: unknown) {
  return new Request("http://localhost/test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function params(values: Record<string, string>) {
  return Promise.resolve(values);
}

function makeTemplateXml(componentId: string, componentType: string, componentName: string) {
  if (componentType === "transform.map") {
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<bns:Component xmlns:bns="http://api.platform.boomi.com/" componentId="${componentId}" version="1" name="${componentName}" type="transform.map">` +
      `<bns:object>` +
      `<Map xmlns="" fromProfile="src" toProfile="dst">` +
      `<Mappings/>` +
      `<Functions optimizeExecutionOrder="true"/>` +
      `<Defaults/>` +
      `<DocumentCacheJoins/>` +
      `</Map>` +
      `</bns:object>` +
      `</bns:Component>`
    );
  }
  if (componentType === "profile.flatfile") {
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<bns:Component xmlns:bns="http://api.platform.boomi.com/" componentId="${componentId}" version="1" name="${componentName}" type="profile.flatfile">` +
      `<bns:object>` +
      `<FlatFileProfile xmlns="" modelVersion="2" strict="true">` +
      `<ProfileProperties>` +
      `<GeneralInfo fileType="delimited" useColumnHeaders="false"/>` +
      `<Options><DataOptions/><DelimitedOptions fileDelimiter="commadelimited" removeEscape="false" textQualifier="na"/></Options>` +
      `</ProfileProperties>` +
      `<DataElements>` +
      `<FlatFileRecord detectFormat="numberofcolumns" isNode="true" key="1" name="Record">` +
      `<FlatFileElements isNode="true" key="2" name="Elements"></FlatFileElements>` +
      `</FlatFileRecord>` +
      `</DataElements>` +
      `</FlatFileProfile>` +
      `</bns:object>` +
      `</bns:Component>`
    );
  }
  if (componentType === "profile.json") {
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<bns:Component xmlns:bns="http://api.platform.boomi.com/" componentId="${componentId}" version="1" name="${componentName}" type="profile.json">` +
      `<bns:object>` +
      `<JSONProfile xmlns="" strict="false">` +
      `<DataElements>` +
      `<JSONRootValue dataType="character" isMappable="true" isNode="true" key="1" name="Root">` +
      `<DataFormat><ProfileCharacterFormat/></DataFormat>` +
      `<JSONObject isMappable="false" isNode="true" key="2" name="Object"></JSONObject>` +
      `</JSONRootValue>` +
      `</DataElements>` +
      `<tagLists/>` +
      `</JSONProfile>` +
      `</bns:object>` +
      `</bns:Component>`
    );
  }
  return `<bns:Component componentId="${componentId}" type="${componentType}" name="${componentName}"><bns:object /></bns:Component>`;
}

describe("e2e pipeline", () => {
  let projectId = "";
  let sourceProfileId = "";
  let destProfileId = "";
  let sourceFieldId = "";
  let destFieldId = "";
  let mappingSetId = "";
  let connectionId = "";
  let mapDraftId = "";

  const processId = `e2e-pipeline-${Date.now()}`;

  afterAll(async () => {
    if (connectionId) {
      try {
        await prisma.boomiConnection.delete({ where: { id: connectionId } });
      } catch {
        // ignore cleanup errors
      }
    }
    if (projectId) {
      try {
        await prisma.project.delete({ where: { id: projectId } });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("walks the full pipeline from project creation to publish", async () => {
    // 1. Create project via API
    const projectResponse = await createProject(
      jsonRequest("POST", {
        processId,
        name: "E2E Pipeline Test",
        description: "End-to-end pipeline verification",
        sourceSystem: "SourceSystem",
        destinationSystem: "DestSystem",
        owner: "e2e",
      }),
    );
    expect(projectResponse.status).toBe(201);
    const projectBody = (await projectResponse.json()) as { project: { id: string } };
    projectId = projectBody.project.id;
    expect(projectId).toBeTruthy();

    // 2a. Add endpoint
    const endpointResponse = await createEndpoint(
      jsonRequest("POST", {
        name: "HTTP Endpoint",
        role: "source",
        connectorType: "HTTP",
        profileType: "JSON",
        format: "JSON",
        purpose: "",
        connectionInfo: "",
      }),
      { params: params({ projectId }) },
    );
    expect(endpointResponse.status).toBe(201);

    // 2b. Add source profile
    const sourceProfileResponse = await createProfile(
      jsonRequest("POST", {
        name: "Source Flat File",
        role: "source",
        type: "Flat File",
        format: "CSV",
      }),
      { params: params({ projectId }) },
    );
    expect(sourceProfileResponse.status).toBe(201);
    const sourceProfileBody = (await sourceProfileResponse.json()) as { profile: { id: string } };
    sourceProfileId = sourceProfileBody.profile.id;

    // 2c. Add destination profile
    const destProfileResponse = await createProfile(
      jsonRequest("POST", {
        name: "Dest JSON",
        role: "destination",
        type: "JSON",
        format: "JSON",
      }),
      { params: params({ projectId }) },
    );
    expect(destProfileResponse.status).toBe(201);
    const destProfileBody = (await destProfileResponse.json()) as { profile: { id: string } };
    destProfileId = destProfileBody.profile.id;

    // 2d. Add fields to source profile
    const sourceFieldResponse = await createField(
      jsonRequest("POST", {
        name: "order_id",
        dataType: "String",
        required: true,
      }),
      { params: params({ profileId: sourceProfileId }) },
    );
    expect(sourceFieldResponse.status).toBe(201);
    const sourceFieldBody = (await sourceFieldResponse.json()) as { field: { id: string } };
    sourceFieldId = sourceFieldBody.field.id;

    // 2e. Add fields to destination profile
    const destFieldResponse = await createField(
      jsonRequest("POST", {
        name: "u_order_id",
        dataType: "String",
        required: true,
      }),
      { params: params({ profileId: destProfileId }) },
    );
    expect(destFieldResponse.status).toBe(201);
    const destFieldBody = (await destFieldResponse.json()) as { field: { id: string } };
    destFieldId = destFieldBody.field.id;

    // 3a. Create mapping set
    const mappingSetResponse = await createMappingSet(
      jsonRequest("POST", {
        name: "Source to Dest",
        sourceProfileId: sourceProfileId,
        destinationProfileId: destProfileId,
        direction: "source-to-destination",
      }),
      { params: params({ projectId }) },
    );
    expect(mappingSetResponse.status).toBe(201);
    const mappingSetBody = (await mappingSetResponse.json()) as { mappingSet: { id: string } };
    mappingSetId = mappingSetBody.mappingSet.id;

    // 3b. Add mapping rule
    const ruleResponse = await createRule(
      jsonRequest("POST", {
        destinationFieldId: destFieldId,
        sourceFieldId: sourceFieldId,
        mappingType: "direct",
      }),
      { params: params({ mappingSetId }) },
    );
    expect(ruleResponse.status).toBe(201);

    // 4. Run FMD apply with a draft (sections mode)
    const applyResponse = await applyFmd(
      jsonRequest("POST", {
        mode: "sections",
        projectId,
        draft: {
          project: {
            processId,
            name: "E2E Pipeline Test",
            description: "",
            sourceSystem: "SourceSystem",
            destinationSystem: "DestSystem",
            owner: "e2e",
            status: "Draft",
            confidence: 0.8,
            evidenceRefs: [],
          },
          endpoints: [],
          profiles: [],
          mappingSets: [],
          fmdSections: [
            {
              title: "Overview",
              sectionType: "overview",
              sortOrder: 1,
              content: { note: "Applied via e2e pipeline" },
              confidence: 0.8,
              evidenceRefs: [],
            },
          ],
          warnings: [],
          unresolvedEvidenceRefs: [],
        },
      }),
    );
    expect(applyResponse.status).toBe(200);
    const applyBody = (await applyResponse.json()) as { result: { createdSections: number } };
    expect(applyBody.result.createdSections).toBe(1);

    // 5a. Add global Boomi sandbox connection
    const connectionResponse = await createConnection(
      jsonRequest("POST", {
        accountId: "test-acct",
        environmentName: "Sandbox",
        baseUrl: "https://api.boomi.com",
        authMode: "Basic API Token",
        apiUsername: "user",
        apiPassword: "pass",
        mode: "sandbox",
      }),
    );
    expect(connectionResponse.status).toBe(200);
    const connectionBody = (await connectionResponse.json()) as { connection: { id: string } };
    connectionId = connectionBody.connection.id;

    // 5b. Mock Boomi HTTP server for template fetch
    const templateFetchMock = vi.fn().mockImplementation((url: string) => {
      const urlPath = new URL(url).pathname;
      let xml = "";
      if (urlPath.includes(`/Component/draft-map-${mappingSetId}`)) {
        xml = makeTemplateXml(`draft-map-${mappingSetId}`, "transform.map", "Source to Dest");
      } else if (urlPath.includes(`/Component/draft-profile-${sourceProfileId}`)) {
        xml = makeTemplateXml(`draft-profile-${sourceProfileId}`, "profile.flatfile", "Source Flat File");
      } else if (urlPath.includes(`/Component/draft-profile-${destProfileId}`)) {
        xml = makeTemplateXml(`draft-profile-${destProfileId}`, "profile.json", "Dest JSON");
      } else {
        return Promise.resolve(new Response("<error>not found</error>", { status: 404 }));
      }
      return Promise.resolve(new Response(xml, { status: 200 }));
    });
    vi.stubGlobal("fetch", templateFetchMock);

    // 5c. Import templates
    const mapImportResponse = await importTemplate(
      jsonRequest("POST", {
        projectId,
        connectionId,
        componentId: `draft-map-${mappingSetId}`,
        componentType: "transform.map",
        componentName: "Source to Dest",
      }),
    );
    expect(mapImportResponse.status).toBe(200);

    const srcProfileImportResponse = await importTemplate(
      jsonRequest("POST", {
        projectId,
        connectionId,
        componentId: `draft-profile-${sourceProfileId}`,
        componentType: "profile.flatfile",
        componentName: "Source Flat File",
      }),
    );
    expect(srcProfileImportResponse.status).toBe(200);

    const dstProfileImportResponse = await importTemplate(
      jsonRequest("POST", {
        projectId,
        connectionId,
        componentId: `draft-profile-${destProfileId}`,
        componentType: "profile.json",
        componentName: "Dest JSON",
      }),
    );
    expect(dstProfileImportResponse.status).toBe(200);

    // 6. Run Boomi dry-run
    const dryRunResponse = await dryRun(jsonRequest("POST", { projectId }));
    expect(dryRunResponse.status).toBe(200);
    const dryRunBody = (await dryRunResponse.json()) as {
      mode: string;
      drafts: Array<{ id: string; componentId: string; componentType: string; proposedXml: string; validationStatus: string; diff: string }>;
      warnings: string[];
    };
    expect(dryRunBody.mode).toBe("sandbox");
    expect(dryRunBody.drafts.length).toBeGreaterThan(0);

    // Verify valid draft XML at each stage
    for (const draft of dryRunBody.drafts) {
      expect(draft.proposedXml).toBeTruthy();
      expect(draft.proposedXml.length).toBeGreaterThan(0);
      const validation = validateComponentXml(draft.proposedXml);
      expect(validation.ok, `Draft ${draft.componentId} XML invalid: ${validation.issues.join(", ")}`).toBe(true);
      expect(draft.validationStatus).toBe("Dry-run valid");
    }

    const mapDraft = dryRunBody.drafts.find((d) => d.componentId === `draft-map-${mappingSetId}`);
    expect(mapDraft).toBeDefined();
    mapDraftId = mapDraft!.id;

    const srcProfileDraft = dryRunBody.drafts.find((d) => d.componentId === `draft-profile-${sourceProfileId}`);
    expect(srcProfileDraft).toBeDefined();

    const dstProfileDraft = dryRunBody.drafts.find((d) => d.componentId === `draft-profile-${destProfileId}`);
    expect(dstProfileDraft).toBeDefined();

    process.env.BOOMI_HELPER_ENABLE_LEGACY_XML_PUBLISH = "true";

    // Verify publish safety gates block publish when requirements are not met
    const blockedPublishResponse = await publish(
      jsonRequest("POST", {
        projectId,
        connectionId,
        draftId: mapDraftId,
      }),
    );
    expect(blockedPublishResponse.status).toBe(422);
    const blockedBody = (await blockedPublishResponse.json()) as { blockers: string[] };
    expect(blockedBody.blockers.some((b: string) => b.includes('Mapping set status is "Draft"'))).toBe(true);
    expect(blockedBody.blockers.some((b: string) => b.includes("No mapping rules are marked Reviewed"))).toBe(true);

    // Fix safety gate issues
    await prisma.mappingSet.update({
      where: { id: mappingSetId },
      data: { status: "Ready for Boomi" },
    });
    await prisma.mappingRule.updateMany({
      where: { mappingSetId },
      data: { reviewed: true },
    });

    // 7. Mock the Boomi HTTP server for component publish
    const publishResponseXml =
      `<bns:Component xmlns:bns="http://api.platform.boomi.com/" componentId="published-map-id" version="2" name="Source to Dest" type="transform.map"/>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(publishResponseXml, { status: 200 })),
    );

    // Attempt publish with the mocked server
    const publishResponse = await publish(
      jsonRequest("POST", {
        projectId,
        connectionId,
        draftId: mapDraftId,
      }),
    );
    expect(publishResponse.status).toBe(200);
    const publishBody = (await publishResponse.json()) as { ok: boolean; result: { action: string; componentId: string } };
    expect(publishBody.ok).toBe(true);
    expect(publishBody.result.action).toBe("create");
    expect(publishBody.result.componentId).toBe("published-map-id");
  });

  // Cleanup is handled by afterAll above.
});
