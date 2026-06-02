import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFmdWorkbook } from "@/lib/fmd";
import {
  clearResolverCache,
  resolveFmdWorkbook,
  type FmdDraftMappingSet,
  type FmdDraftProfile,
  type FmdImportDraft,
} from "@/lib/fmd-import";
import { setResolverCacheFilePath } from "@/lib/fmd-resolver-cache";
import { sampleProject } from "@/lib/sample-data";

beforeEach(() => {
  setResolverCacheFilePath(join(tmpdir(), `fmd-resolver-cache-fixtures-${randomUUID()}.json`));
});

const sampleFiles = [
  "/Users/walidbargaoui/Documents/Downloads for Chrome/Boomi設計書_SRSN001_セーレン商事_受注_in.xlsx",
  "/Users/walidbargaoui/Documents/Downloads for Chrome/FMD_To_SFs_Phone_v1.7.xlsx",
  "/Users/walidbargaoui/Documents/Downloads for Chrome/【販売管理】FMD_IFID043_SMSO_TO_TOPS_EBK_FILE_DAILY(通告管理)_v1.00.xlsx",
  "/Users/walidbargaoui/Documents/Downloads for Chrome/G06 - Employee Expense FMD V1.3.xlsx",
  "/Users/walidbargaoui/Documents/Downloads for Chrome/FMD_sheet_FOX_算定結果ステータス・業務日付更新.xlsx",
];

afterEach(() => {
  vi.unstubAllGlobals();
  clearResolverCache();
});

function summarizeDraft(draft: FmdImportDraft) {
  return {
    project: {
      processId: draft.project.processId,
      name: draft.project.name,
      sourceSystem: draft.project.sourceSystem,
      destinationSystem: draft.project.destinationSystem,
      status: draft.project.status,
    },
    profileCount: draft.profiles.length,
    profileNames: draft.profiles.map((profile: FmdDraftProfile) => profile.name).sort(),
    profileShapes: draft.profiles
      .map((profile) => `${profile.role}/${profile.type}/${profile.format}`)
      .sort(),
    fieldCountsByProfile: Object.fromEntries(
      draft.profiles
        .map((profile) => [profile.name, profile.fields.length] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
    mappingSetCount: draft.mappingSets.length,
    mappingSets: draft.mappingSets
      .map((mappingSet: FmdDraftMappingSet) => ({
        name: mappingSet.name,
        strategy: mappingSet.strategy,
        source: mappingSet.sourceProfileName,
        destination: mappingSet.destinationProfileName,
        ruleCount: mappingSet.rules.length,
        ruleTypeBreakdown: mappingSet.rules.reduce<Record<string, number>>((counts, rule) => {
          counts[rule.mappingType] = (counts[rule.mappingType] ?? 0) + 1;
          return counts;
        }, {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    endpointCount: draft.endpoints.length,
    sectionCount: draft.fmdSections.length,
    sectionTypes: draft.fmdSections.map((section) => section.sectionType).sort(),
    warningCount: draft.warnings.length,
    unresolvedRefCount: draft.unresolvedEvidenceRefs.length,
  };
}

describe("deterministic resolver regression fixtures", () => {
  for (const filePath of sampleFiles) {
    const label = basename(filePath);
    it(`matches snapshot for ${label}`, async () => {
      const buffer = readFileSync(filePath);
      const result = await resolveFmdWorkbook(buffer, filePath, { useLlm: false });
      expect(summarizeDraft(result.draft)).toMatchSnapshot();
    });
  }
});

describe("applyAiResolution merge snapshot", () => {
  it("merges a canned Qwen correction patch into the deterministic draft", async () => {
    const workbookBuffer = readFileSync(sampleFiles[1]); // FMD_To_SFs_Phone_v1.7
    const deterministic = await resolveFmdWorkbook(workbookBuffer, sampleFiles[1], { useLlm: false });
    const mappingSetName = deterministic.draft.mappingSets[0]?.name ?? "Unknown";
    const destinationProfileName =
      deterministic.draft.profiles.find((profile) => profile.role === "destination")?.name ?? "Unknown";

    const correctionPatch = {
      project: {
        owner: "Qwen reviewer",
        confidence: 0.92,
        evidenceRefs: ["Field Mapping!R3"],
      },
      profileRenames: [
        {
          role: "destination" as const,
          currentName: destinationProfileName,
          proposedName: "Polished Destination Profile",
          confidence: 0.88,
          evidenceRefs: ["Field Mapping!R6"],
        },
      ],
      mappingSetNotes: [
        {
          mappingSetName,
          note: "Resolver: review currency conversion edge case at R12.",
          confidence: 0.86,
          evidenceRefs: ["Field Mapping!R12"],
        },
      ],
      warnings: ["Snapshot: a stable Qwen warning."],
      unresolvedEvidenceRefs: ["Field Mapping!R99"],
    };

    let chatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/tags")) {
          return new Response(JSON.stringify({ models: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        chatCalls += 1;
        const content = chatCalls === 1
          ? correctionPatch
          : { profileRenames: [], profileTypeFixes: [], keyFieldSuggestions: [], mappingSetNotes: [], mappingTypeCorrections: [], warnings: [], unresolvedEvidenceRefs: [] };
        return new Response(
          JSON.stringify({ message: { content: JSON.stringify(content) } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const merged = await resolveFmdWorkbook(workbookBuffer, sampleFiles[1], { model: "qwen3:8b" });

    expect({
      provider: merged.resolver.provider,
      ok: merged.resolver.ok,
      projectOwner: merged.draft.project.owner,
      projectConfidence: merged.draft.project.confidence,
      resolverConfidence: merged.resolver.confidence,
      acceptedSuggestions: merged.resolver.acceptedSuggestions?.length,
      needsReview: merged.resolver.needsReview?.length,
      destinationProfileName: merged.draft.profiles.find((profile) => profile.role === "destination")?.name,
      mappingSetWarnings: merged.draft.mappingSets[0]?.warnings,
      lastWarning: merged.draft.warnings[merged.draft.warnings.length - 1],
      unresolved: merged.draft.unresolvedEvidenceRefs,
    }).toMatchSnapshot();
  });

  it("snapshot for generated FMD workbook deterministic output", async () => {
    const workbook = await createFmdWorkbook(sampleProject);
    const result = await resolveFmdWorkbook(workbook, "generated.xlsx", { useLlm: false });
    expect(summarizeDraft(result.draft)).toMatchSnapshot();
  });
});
