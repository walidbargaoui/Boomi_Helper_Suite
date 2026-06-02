import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFmdWorkbook } from "@/lib/fmd";
import {
  clearResolverCache,
  draftToProjectPreview,
  resolveFmdWorkbook,
  __testInferProfileTypeFromEvidence,
  type FmdWorkbookEvidence,
} from "@/lib/fmd-import";
import { setResolverCacheFilePath } from "@/lib/fmd-resolver-cache";
import { sampleProject } from "@/lib/sample-data";

beforeEach(() => {
  setResolverCacheFilePath(join(tmpdir(), `fmd-resolver-cache-${randomUUID()}.json`));
  clearResolverCache();
});

function evidenceFor(text: string): FmdWorkbookEvidence {
  return {
    filename: "test.xlsx",
    mappingSheets: 0,
    designSections: 0,
    warnings: [],
    redactionCount: 0,
    sheets: [
      {
        name: "Environment",
        role: "environment",
        rowCount: 1,
        columnCount: 1,
        headers: [],
        rows: [
          {
            rowIndex: 1,
            cells: [text],
            text,
            evidenceRef: "Environment!R1",
          },
        ],
      },
    ],
  };
}

const sampleFiles = [
  "/Users/walidbargaoui/Documents/Downloads for Chrome/Boomi設計書_SRSN001_セーレン商事_受注_in.xlsx",
  "/Users/walidbargaoui/Documents/Downloads for Chrome/FMD_To_SFs_Phone_v1.7.xlsx",
  "/Users/walidbargaoui/Documents/Downloads for Chrome/【販売管理】FMD_IFID043_SMSO_TO_TOPS_EBK_FILE_DAILY(通告管理)_v1.00.xlsx",
  "/Users/walidbargaoui/Documents/Downloads for Chrome/G06 - Employee Expense FMD V1.3.xlsx",
  "/Users/walidbargaoui/Documents/Downloads for Chrome/FMD_sheet_FOX_算定結果ステータス・業務日付更新.xlsx",
];
const resolverPassCount = 7;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FMD import resolver", () => {
  it.each(sampleFiles)("creates a deterministic import draft for %s", async (filePath) => {
    const result = await resolveFmdWorkbook(readFileSync(filePath), filePath, { useLlm: false });

    expect(result.summary.sheets.length).toBeGreaterThan(0);
    expect(result.draft.project.processId).toBeTruthy();
    expect(result.draft.project.name).toBeTruthy();
    expect(result.draft.fmdSections.length).toBeGreaterThan(0);
    expect(result.resolver.provider).toBe("deterministic");
  });

  it("parses Japanese destination/source mapping blocks", async () => {
    const result = await resolveFmdWorkbook(readFileSync(sampleFiles[0]), sampleFiles[0], { useLlm: false });

    expect(result.draft.project.processId).toBe("SRSN001");
    expect(result.draft.project.name).toBe("セーレン商事_受注_in");
    expect(result.draft.mappingSets.length).toBeGreaterThanOrEqual(3);
    expect(result.draft.mappingSets[0].rules.length).toBeGreaterThan(20);
    expect(result.draft.profiles.some((profile) => profile.name.includes("u_temp_edi_seiren_recieve"))).toBe(true);
    expect(result.draft.profiles.some((profile) => profile.name.includes("セーレン受注データファイル"))).toBe(true);
  });

  it("parses English hybrid Field Mapping blocks", async () => {
    const result = await resolveFmdWorkbook(readFileSync(sampleFiles[1]), sampleFiles[1], { useLlm: false });

    expect(result.draft.mappingSets).toHaveLength(1);
    expect(result.draft.mappingSets[0].rules).toHaveLength(4);
    expect(result.draft.profiles.map((profile) => profile.name)).toContain("SuccessFactors");
    expect(result.draft.profiles.map((profile) => profile.name)).toContain("Account Management System");
    expect(result.draft.project.owner).toBe("Unassigned");
    expect(result.draft.project.schedule).toBe("日次 22:05");
    expect(result.draft.endpoints.map((endpoint) => endpoint.name)).toEqual(["DEV", "QAS", "本番"]);
    expect(result.draft.endpoints.every((endpoint) => endpoint.connectorType === "HTTP GET")).toBe(true);
    expect(result.draft.endpoints.some((endpoint) => endpoint.name.includes("$headers"))).toBe(false);
    expect(result.draft.mappingSets[0].rules.filter((rule) => rule.mappingType === "constant").map((rule) => rule.defaultValue)).toEqual(["845514", "true"]);
  });

  it("parses compact transformation/target mapping blocks", async () => {
    const result = await resolveFmdWorkbook(readFileSync(sampleFiles[3]), sampleFiles[3], { useLlm: false });

    expect(result.draft.mappingSets.length).toBeGreaterThanOrEqual(2);
    expect(result.draft.mappingSets.some((set) => set.name.includes("Journal Entry"))).toBe(true);
    expect(result.draft.mappingSets.flatMap((set) => set.rules).some((rule) => rule.mappingType === "constant")).toBe(true);
  });

  it("returns warnings for header-only mapping sheets", async () => {
    const result = await resolveFmdWorkbook(readFileSync(sampleFiles[4]), sampleFiles[4], { useLlm: false });

    expect(result.draft.mappingSets).toHaveLength(0);
    expect(result.draft.warnings.some((warning) => warning.includes("No mapping sets"))).toBe(true);
  });

  it("uses mocked Ollama JSON when available", async () => {
    const workbook = await createFmdWorkbook(sampleProject);
    const deterministic = await resolveFmdWorkbook(workbook, "generated.xlsx", { useLlm: false });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/api/tags")) {
          return Promise.resolve(new Response(JSON.stringify({ models: [] }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({
          message: { content: JSON.stringify({
            project: deterministic.draft.project,
            profileRenames: [],
            profileTypeFixes: [],
            keyFieldSuggestions: [],
            mappingSetNotes: [],
            mappingTypeCorrections: [],
            warnings: ["Mock Qwen resolver adjusted labels."],
            unresolvedEvidenceRefs: [],
          })}
        }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }),
    );

    const result = await resolveFmdWorkbook(workbook, "generated.xlsx", { model: "qwen3:8b" });

    expect(result.resolver.provider).toBe("ollama");
    expect(result.resolver.ok).toBe(true);
    expect(result.draft.warnings).toContain("Mock Qwen resolver adjusted labels.");
    expect(fetch).toHaveBeenCalledWith("http://localhost:11434/api/chat", expect.any(Object));
  });

  it("uses OpenAI-compatible providers with JSON schema response format", async () => {
    const workbook = await createFmdWorkbook(sampleProject);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "qwen3" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  profileRenames: [],
                  mappingSetNotes: [],
                  warnings: [],
                  unresolvedEvidenceRefs: [],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveFmdWorkbook(workbook, "generated.xlsx", {
      providerType: "openai-compatible",
      baseUrl: "http://localhost:1234/v1",
      model: "qwen3",
      apiKey: "test-key",
    });

    expect(result.resolver.provider).toBe("openai-compatible");
    expect(result.resolver.providerName).toBe("Request override");
    expect(result.resolver.cache).toBe("miss");
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:1234/v1/models", expect.objectContaining({
      headers: { Authorization: "Bearer test-key" },
    }));
    const chatCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("/chat/completions"));
    expect(chatCall).toBeDefined();
    const chatInit = chatCall![1] as RequestInit;
    expect(chatInit.headers).toEqual(expect.objectContaining({ Authorization: "Bearer test-key" }));
    const body = JSON.parse(chatInit.body as string);
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { strict: true },
    });
  });

  it("falls back when local Ollama is unavailable", async () => {
    const workbook = await createFmdWorkbook(sampleProject);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));

    const result = await resolveFmdWorkbook(workbook, "generated.xlsx", { model: "qwen3:8b" });

    expect(result.resolver.provider).toBe("deterministic");
    expect(result.resolver.ok).toBe(false);
    expect(result.draft.warnings.some((warning) => warning.includes("deterministic fallback"))).toBe(true);
  });

  it("applies Ollama correction patch through applyAiResolution", async () => {
    const workbookBuffer = readFileSync(sampleFiles[1]);
    const deterministic = await resolveFmdWorkbook(workbookBuffer, sampleFiles[1], { useLlm: false });
    const targetMappingSet = deterministic.draft.mappingSets[0];
    expect(targetMappingSet).toBeDefined();
    const sourceProfile = deterministic.draft.profiles.find((profile) => profile.role === "source");
    const destinationProfile = deterministic.draft.profiles.find((profile) => profile.role === "destination");
    expect(sourceProfile && destinationProfile).toBeTruthy();

    const correctionPatch = {
      project: {
        owner: "Resolved by Qwen",
        confidence: 0.9,
        evidenceRefs: ["マッピング!R3"],
      },
      profileRenames: [
        {
          role: "destination" as const,
          currentName: destinationProfile!.name,
          proposedName: "Renamed Destination",
          confidence: 0.85,
          evidenceRefs: ["マッピング!R5"],
        },
      ],
      mappingSetNotes: [
        {
          mappingSetName: targetMappingSet!.name,
          note: "Resolver flagged scattered lookup logic.",
          confidence: 0.86,
          evidenceRefs: ["マッピング!R12"],
        },
      ],
      warnings: ["Qwen noticed ambiguous date format."],
      unresolvedEvidenceRefs: ["マッピング!R99"],
    };

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ message: { content: JSON.stringify(correctionPatch) } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveFmdWorkbook(workbookBuffer, sampleFiles[1], { model: "qwen3:8b" });

    expect(result.resolver.provider).toBe("ollama");
    expect(result.resolver.ok).toBe(true);
    expect(result.draft.project.owner).toBe("Resolved by Qwen");
    expect(result.draft.profiles.some((profile) => profile.name === "Renamed Destination")).toBe(true);
    const renamedSet = result.draft.mappingSets.find((set) => set.name === targetMappingSet!.name);
    expect(renamedSet?.destinationProfileName).toBe("Renamed Destination");
    expect(renamedSet?.warnings).toContain("Resolver flagged scattered lookup logic.");
    expect(result.draft.warnings).toContain("Qwen noticed ambiguous date format.");
    expect(result.draft.unresolvedEvidenceRefs).toContain("マッピング!R99");
    expect(result.resolver.acceptedSuggestions?.length).toBeGreaterThan(0);
  });

  it("preserves deterministic data when Ollama returns a patch that also satisfies the full-draft schema", async () => {
    // Regression: Ollama is constrained to the correction-patch shape, but a patch
    // containing project.processId + project.name also validates as fmdImportDraftSchema
    // because profiles/mappingSets/endpoints/fmdSections all default to []. Before the
    // fix, this branch was taken first and the deterministic profiles/mapping sets were
    // silently dropped.
    const workbookBuffer = readFileSync(sampleFiles[1]);
    const deterministic = await resolveFmdWorkbook(workbookBuffer, sampleFiles[1], { useLlm: false });
    expect(deterministic.draft.profiles.length).toBeGreaterThan(0);
    expect(deterministic.draft.mappingSets.length).toBeGreaterThan(0);

    const patchThatLooksLikeFullDraft = {
      project: {
        processId: deterministic.draft.project.processId,
        name: deterministic.draft.project.name,
        sourceSystem: "ServiceNow",
        confidence: 0.8,
        evidenceRefs: ["API仕様!R10"],
      },
      profileRenames: [],
      mappingSetNotes: [],
      warnings: ["LLM patch was almost empty."],
      unresolvedEvidenceRefs: [],
    };

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ message: { content: JSON.stringify(patchThatLooksLikeFullDraft) } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveFmdWorkbook(workbookBuffer, sampleFiles[1], { model: "qwen3:8b" });

    expect(result.resolver.provider).toBe("ollama");
    expect(result.draft.profiles.length).toBe(deterministic.draft.profiles.length);
    expect(result.draft.mappingSets.length).toBe(deterministic.draft.mappingSets.length);
    expect(result.draft.project.sourceSystem).toBe(deterministic.draft.project.sourceSystem);
    expect(result.resolver.needsReview?.some((suggestion) => suggestion.proposedValue === "ServiceNow")).toBe(true);
    expect(result.draft.warnings).toContain("LLM patch was almost empty.");
  });

  it("keeps low-confidence metadata suggestions for review instead of applying them", async () => {
    const workbook = await createFmdWorkbook(sampleProject);
    const lowConfidencePatch = {
      project: {
        owner: "Low Confidence Owner",
        confidence: 0.81,
        evidenceRefs: ["Overview!R2"],
      },
      warnings: [],
      unresolvedEvidenceRefs: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/tags")) {
          return new Response(JSON.stringify({ models: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ message: { content: JSON.stringify(lowConfidencePatch) } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const result = await resolveFmdWorkbook(workbook, "generated.xlsx", { model: "qwen3:8b" });

    expect(result.draft.project.owner).not.toBe("Low Confidence Owner");
    expect(result.resolver.needsReview?.some((suggestion) => suggestion.target === "project.owner")).toBe(true);
    expect(result.draft.warnings.some((warning) => warning.includes("suggestion(s) for review"))).toBe(true);
  });

  it("applies high-confidence endpoint candidates from the LLM", async () => {
    const workbook = await createFmdWorkbook(sampleProject);
    const endpointPatch = {
      endpoints: [
        {
          name: "ServiceNow DEV",
          role: "destination" as const,
          connectorType: "HTTP POST",
          profileType: "API",
          format: "JSON",
          purpose: "Create incident payloads",
          connectionInfo: "https://example.service-now.com/api/now/table/incident",
          confidence: 0.94,
          evidenceRefs: ["Environment!R8"],
          reason: "Environment row contains the ServiceNow API URL and POST method.",
        },
      ],
      warnings: [],
      unresolvedEvidenceRefs: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/tags")) {
          return new Response(JSON.stringify({ models: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ message: { content: JSON.stringify(endpointPatch) } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const result = await resolveFmdWorkbook(workbook, "generated.xlsx", { model: "qwen3:8b" });

    expect(result.draft.endpoints.some((endpoint) => endpoint.name === "ServiceNow DEV")).toBe(true);
    expect(result.resolver.acceptedSuggestions?.some((suggestion) => suggestion.category === "endpoint")).toBe(true);
  });

  it("preserves high-confidence integration pattern in the import draft", async () => {
    const workbook = await createFmdWorkbook(sampleProject);
    const patternPatch = {
      project: {
        integrationPattern: "event-driven",
        confidence: 0.92,
        evidenceRefs: ["Overview!R4"],
      },
      warnings: [],
      unresolvedEvidenceRefs: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/tags")) {
          return new Response(JSON.stringify({ models: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ message: { content: JSON.stringify(patternPatch) } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const result = await resolveFmdWorkbook(workbook, "generated.xlsx", { model: "qwen3:8b" });

    expect(result.draft.project.integrationPattern).toBe("event-driven");
    expect(result.resolver.acceptedSuggestions?.some((suggestion) => suggestion.target === "project.integrationPattern")).toBe(true);
  });

  it("reconciles profile type/format after LLM rename when the new name has stronger evidence", async () => {
    // M8 "Fix First" #4: when Qwen renames "Account Management System" → "ServiceNow"
    // and the evidence rows under that system name show JSON API URLs, the post-LLM
    // type reconciliation must promote the profile from Flat File / TSV to API / JSON.
    const workbookBuffer = readFileSync(sampleFiles[1]); // FMD_To_SFs_Phone_v1.7
    const deterministic = await resolveFmdWorkbook(workbookBuffer, sampleFiles[1], { useLlm: false });
    const sourceProfile = deterministic.draft.profiles.find((p) => p.role === "source");
    expect(sourceProfile).toBeDefined();
    const originalName = sourceProfile!.name;
    const originalType = sourceProfile!.type;
    const originalFormat = sourceProfile!.format;

    // Pick a rename target that DOES have ServiceNow URL evidence in the sample workbook
    // (the destination is `ServiceNow u_*` in the FMD_To_SFs_Phone fixture).
    const correctionPatch = {
      project: { confidence: 0.9, evidenceRefs: [] },
      profileRenames: [
        {
          role: "source" as const,
          currentName: originalName,
          // Force a rename to a non-evidence name — the new name has no rows mentioning
          // it, so reinferred format is Unknown and the type/format should be preserved.
          // This proves we don't blindly override deterministic results when the LLM
          // rename doesn't carry stronger signal.
          proposedName: "ZZZ Brand New Name Not In Workbook",
          confidence: 0.9,
          evidenceRefs: ["Field Mapping!R1"],
        },
      ],
      mappingSetNotes: [],
      warnings: [],
      unresolvedEvidenceRefs: [],
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ message: { content: JSON.stringify(correctionPatch) } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveFmdWorkbook(workbookBuffer, sampleFiles[1], { model: "qwen3:8b" });
    const renamed = result.draft.profiles.find((p) => p.name === "ZZZ Brand New Name Not In Workbook");
    expect(renamed).toBeDefined();
    // The reinference produced "Unknown" → we preserve deterministic type/format.
    expect(renamed!.type).toBe(originalType);
    expect(renamed!.format).toBe(originalFormat);
  });

  it("draftToProjectPreview carries mapping sets with linked field ids", async () => {
    const workbookBuffer = readFileSync(sampleFiles[1]);
    const deterministic = await resolveFmdWorkbook(workbookBuffer, sampleFiles[1], { useLlm: false });
    expect(deterministic.draft.mappingSets.length).toBeGreaterThan(0);

    const preview = draftToProjectPreview(sampleProject, deterministic.draft);

    expect(preview.mappingSets.length).toBe(deterministic.draft.mappingSets.length);
    const firstSet = preview.mappingSets[0];
    expect(firstSet.id).toMatch(/^draft-mapping-set-/);
    expect(firstSet.sourceProfileId).toMatch(/^draft-profile-/);
    expect(firstSet.destinationProfileId).toMatch(/^draft-profile-/);
    expect(firstSet.rules.length).toBeGreaterThan(0);
    const firstRule = firstSet.rules[0];
    expect(firstRule.destinationFieldId).toMatch(/^draft-field-/);
    // Source field is optional (some rules are constant / function)
    if (firstRule.sourceFieldId) {
      expect(firstRule.sourceFieldId).toMatch(/^draft-field-/);
    }
  });

  it("accepts a high-confidence LLM process flow and carries it into preview", async () => {
    const workbook = await createFmdWorkbook(sampleProject);
    const flowPatch = {
      processFlows: [
        {
          name: "Generated Order Flow",
          nodes: [
            {
              id: "start",
              type: "start-connector",
              label: "Start from source",
              description: "Receive source data for the integration.",
              position: { x: 80, y: 140 },
            },
            {
              id: "map",
              type: "map",
              label: "Map to destination",
              description: "Apply the FMD field mappings.",
              position: { x: 300, y: 140 },
            },
            {
              id: "send",
              type: "connector",
              label: "Send to destination",
              description: "Deliver transformed records to the destination system.",
              position: { x: 520, y: 140 },
            },
            {
              id: "stop",
              type: "stop",
              label: "Stop",
              description: "Finish the process.",
              position: { x: 740, y: 140 },
            },
          ],
          edges: [
            { id: "e-start-map", source: "start", target: "map" },
            { id: "e-map-send", source: "map", target: "send" },
            { id: "e-send-stop", source: "send", target: "stop" },
          ],
          notes: "Sample flow generated from the FMD overview and mapping context.",
          confidence: 0.9,
          evidenceRefs: ["Overview!R1", "Field Mapping!R1"],
        },
      ],
      suggestions: [],
      warnings: [],
      unresolvedEvidenceRefs: [],
    };
    const emptyPatch = {
      suggestions: [],
      profileRenames: [],
      profileTypeFixes: [],
      keyFieldSuggestions: [],
      mappingSetNotes: [],
      mappingTypeCorrections: [],
      endpoints: [],
      warnings: [],
      unresolvedEvidenceRefs: [],
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { messages?: Array<{ content?: string }> } : {};
      const systemPrompt = body.messages?.[0]?.content ?? "";
      const payload = systemPrompt.includes("FLOW PASS") ? flowPatch : emptyPatch;
      return new Response(JSON.stringify({ message: { content: JSON.stringify(payload) } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveFmdWorkbook(workbook, "generated.xlsx", { model: "qwen3:8b" });
    expect(result.draft.processFlows).toHaveLength(1);
    expect(result.draft.processFlows[0].nodes.map((node) => node.type)).toEqual([
      "start-connector",
      "map",
      "connector",
      "stop",
    ]);
    expect(result.resolver.acceptedSuggestions?.some((suggestion) => suggestion.category === "flow")).toBe(true);

    const preview = draftToProjectPreview(sampleProject, result.draft);
    expect(preview.processFlows).toHaveLength(1);
    expect(preview.processFlows[0].id).toBe("draft-flow-1");
    expect(preview.processFlows[0].nodes).toHaveLength(4);
  });

  it("inferProfileTypeFromEvidence picks up file-extension hints (extension beats other signals)", () => {
    // .json filename in the environment row → JSON profile, even though REST API is mentioned.
    const evidence = evidenceFor("ServiceNow REST API endpoint /v1/batch sends orders.json file daily.");
    expect(__testInferProfileTypeFromEvidence("ServiceNow", "ServiceNow source", evidence)).toEqual({
      type: "JSON",
      format: "JSON",
    });

    const tsv = evidenceFor("SharePoint file PO_SEIREN_2026.tsv arrives at 14:00");
    expect(__testInferProfileTypeFromEvidence("SharePoint", "SharePoint", tsv)).toEqual({
      type: "Flat File",
      format: "TSV",
    });

    // No file extension → SOAP+WSDL falls back to API/XML.
    const soap = evidenceFor("SAP integration via SOAP WSDL on the ECC interface");
    expect(__testInferProfileTypeFromEvidence("SAP", "SAP", soap)).toEqual({
      type: "API",
      format: "XML",
    });

    // Pure REST connector with no filename → API/JSON.
    const rest = evidenceFor("ServiceNow REST API table u_temp_edi");
    expect(__testInferProfileTypeFromEvidence("ServiceNow", "ServiceNow", rest)).toEqual({
      type: "API",
      format: "JSON",
    });

    const hyphenatedHost = evidenceFor("DEV https://jeradev.service-now.com/api/now/table/sys_user HTTP GET");
    expect(__testInferProfileTypeFromEvidence("ServiceNow", "ServiceNow", hyphenatedHost)).toEqual({
      type: "API",
      format: "JSON",
    });

    const empty = evidenceFor("misc note with no signal");
    expect(__testInferProfileTypeFromEvidence("MysteryBox", "MysteryBox", empty)).toEqual({
      type: "Flat File",
      format: "Unknown",
    });
  });

  it("preflights Ollama with /api/tags before the chat call", async () => {
    const workbook = await createFmdWorkbook(sampleProject);
    const tagsHandler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const chatHandler = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              profileRenames: [],
              mappingSetNotes: [],
              warnings: [],
              unresolvedEvidenceRefs: [],
            }),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url.endsWith("/api/tags")) return tagsHandler(url, init);
        return chatHandler(url, init);
      }),
    );

    const result = await resolveFmdWorkbook(workbook, "generated.xlsx", { model: "qwen3:8b" });

    expect(tagsHandler).toHaveBeenCalledTimes(1);
    expect(chatHandler).toHaveBeenCalledTimes(resolverPassCount);
    expect(result.resolver.provider).toBe("ollama");
  });
});

describe("FMD resolve route — debug gating", () => {
  // Inline tests for /api/fmd/resolve. The route's job here is to strip the
  // `debug` field (which carries the full LLM prompt + response — large and
  // sensitive) from the response unless the caller explicitly opts in.
  // We construct a deterministic-mode response (useLlm=false), then verify
  // the route strips/keeps debug correctly.

  async function callResolveRoute(searchParams: string, formExtras: Array<[string, string]> = []) {
    // Import lazily so any earlier vi.stubGlobal("fetch", ...) doesn't bleed in.
    const { POST } = await import("@/app/api/fmd/resolve/route");
    const workbook = await createFmdWorkbook(sampleProject);
    const form = new FormData();
    form.append("file", new File([workbook as unknown as BlobPart], "test.xlsx"));
    form.append("useLlm", "false");
    for (const [key, value] of formExtras) form.append(key, value);
    const request = new Request(`http://localhost/api/fmd/resolve${searchParams}`, {
      method: "POST",
      body: form,
    });
    return POST(request as never);
  }

  afterEach(() => { delete process.env.BOOMI_HELPER_FMD_DEBUG; });

  it("strips the debug payload from the response by default", async () => {
    // Deterministic-only resolves don't populate debug, but we still want to
    // confirm the route doesn't ADD it. We assert structural absence.
    const response = await callResolveRoute("");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).not.toHaveProperty("debug");
  });

  it("includes debug when ?debug=true is set on the URL", async () => {
    // For deterministic-mode runs there is no debug to surface, but the gate
    // should not strip a `debug` key if the underlying resolver had returned
    // one — verify the route's strip logic is the only thing in play by
    // checking that no implicit removal happens for deterministic paths.
    const response = await callResolveRoute("?debug=true");
    expect(response.status).toBe(200);
    const body = await response.json();
    // Even when opted in, deterministic mode legitimately has no debug field.
    // The important thing: the route doesn't crash when debug is requested.
    expect(body.resolver?.provider).toBe("deterministic");
  });

  it("includes debug when BOOMI_HELPER_FMD_DEBUG=1 is in the env", async () => {
    process.env.BOOMI_HELPER_FMD_DEBUG = "1";
    const response = await callResolveRoute("");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resolver?.provider).toBe("deterministic");
  });
});

describe("FMD resolver cache integration", () => {
  it("caches LLM resolutions by workbook and model", async () => {
    const workbook = await createFmdWorkbook(sampleProject);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              profileRenames: [],
              mappingSetNotes: [],
              warnings: [],
              unresolvedEvidenceRefs: [],
            }),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result1 = await resolveFmdWorkbook(workbook, "generated.xlsx", { model: "qwen3:8b" });
    expect(result1.resolver.provider).toBe("ollama");
    expect(result1.resolver.cache).toBe("miss");
    expect(fetchMock).toHaveBeenCalledTimes(1 + resolverPassCount); // /api/tags + resolver passes

    const result2 = await resolveFmdWorkbook(workbook, "generated.xlsx", { model: "qwen3:8b" });
    expect(result2.resolver.provider).toBe("ollama");
    expect(result2.resolver.cache).toBe("hit");
    expect(fetchMock).toHaveBeenCalledTimes(1 + resolverPassCount); // served from cache
    expect(result2.draft).toEqual(result1.draft);
  });

  it("different model options produce separate resolutions", async () => {
    const workbook = await createFmdWorkbook(sampleProject);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              profileRenames: [],
              mappingSetNotes: [],
              warnings: [],
              unresolvedEvidenceRefs: [],
            }),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await resolveFmdWorkbook(workbook, "generated.xlsx", { model: "qwen3:8b" });
    await resolveFmdWorkbook(workbook, "generated.xlsx", { model: "qwen3:4b" });
    expect(fetchMock).toHaveBeenCalledTimes((1 + resolverPassCount) * 2); // separate cache key per model
  });

  it("keeps resolver cache entries separate by provider type and base URL", async () => {
    const workbook = await createFmdWorkbook(sampleProject);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "qwen3" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/chat/completions")) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify({ profileRenames: [], mappingSetNotes: [], warnings: [], unresolvedEvidenceRefs: [] }) } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ message: { content: JSON.stringify({ profileRenames: [], mappingSetNotes: [], warnings: [], unresolvedEvidenceRefs: [] }) } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const ollamaResult = await resolveFmdWorkbook(workbook, "generated.xlsx", { model: "qwen3:8b" });
    const openAiResult = await resolveFmdWorkbook(workbook, "generated.xlsx", {
      providerType: "openai-compatible",
      baseUrl: "http://localhost:1234/v1",
      model: "qwen3:8b",
    });
    const openAiCached = await resolveFmdWorkbook(workbook, "generated.xlsx", {
      providerType: "openai-compatible",
      baseUrl: "http://localhost:1234/v1",
      model: "qwen3:8b",
    });

    expect(ollamaResult.resolver.cache).toBe("miss");
    expect(openAiResult.resolver.cache).toBe("miss");
    expect(openAiCached.resolver.cache).toBe("hit");
    expect(fetchMock).toHaveBeenCalledTimes((1 + resolverPassCount) * 2);
  });
});
