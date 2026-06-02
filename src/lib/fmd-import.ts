import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { z } from "zod";
import type { Endpoint, FmdSection, MappingRule, Profile, Project } from "@/lib/domain";
import type { NormalizedFmdWorkbook } from "@/lib/fmd";
import {
  confidenceSchema,
  evidenceRefsSchema,
  fmdDraftEndpointSchema,
  fmdDraftFieldSchema,
  fmdDraftMappingSetSchema,
  fmdDraftProfileSchema,
  fmdDraftProcessFlowSchema,
  fmdDraftSectionSchema,
  fmdImportDraftSchema,
  type FmdDraftField,
  type FmdDraftMappingRule,
  type FmdDraftMappingSet,
  type FmdDraftProfile,
  type FmdDraftProcessFlow,
  type FmdImportDraft,
} from "./fmd-import-schema";

import {
  buildEvidenceInventoryPassPrompt,
  buildEndpointPassPrompt,
  buildProjectPassPrompt,
  buildProfilePassPrompt,
  buildMappingPassPrompt,
  buildFlowPassPrompt,
  buildVerifierPassPrompt,
  buildSystemPrompt,
  buildEvidenceInventoryPassSchema,
  buildEndpointPassSchema,
  buildProjectPassSchema,
  buildProfilePassSchema,
  buildMappingPassSchema,
  buildFlowPassSchema,
  buildVerifierPassSchema,
} from "./fmd-resolver-context";
import { clearResolverCache, lookupCache, storeCache } from "./fmd-resolver-cache";
import type { LlmProviderOverride, LlmProviderRuntimeConfig } from "./llm-providers";
import type { LlmProviderType } from "@/lib/domain";

export {
  fmdDraftEndpointSchema,
  fmdDraftFieldSchema,
  fmdDraftMappingRuleSchema,
  fmdDraftMappingSetSchema,
  fmdDraftProfileSchema,
  fmdDraftProcessFlowSchema,
  fmdDraftSectionSchema,
  fmdImportDraftSchema,
  fmdParserStrategySchema,
} from "./fmd-import-schema";
export type {
  FmdDraftField,
  FmdDraftMappingRule,
  FmdDraftMappingSet,
  FmdDraftProfile,
  FmdDraftProcessFlow,
  FmdImportDraft,
} from "./fmd-import-schema";

type RowValue = string | number | boolean | null | undefined;

export type FmdSheetRole = NormalizedFmdWorkbook["sheets"][number]["role"];

export type FmdEvidenceRow = {
  rowIndex: number;
  cells: string[];
  text: string;
  evidenceRef: string;
};

export type FmdEvidenceSheet = {
  name: string;
  role: FmdSheetRole;
  rowCount: number;
  columnCount: number;
  headers: string[];
  rows: FmdEvidenceRow[];
};

export type FmdWorkbookEvidence = {
  filename: string;
  sheets: FmdEvidenceSheet[];
  mappingSheets: number;
  designSections: number;
  warnings: string[];
  redactionCount: number;
};

const profileTypeFixSchema = z.object({
  role: z.enum(["source", "destination"]),
  profileName: z.string().min(1).max(240),
  newType: z.enum(["Flat File", "JSON", "XML", "Database", "API"]),
  newFormat: z.string().min(1).max(160),
  reason: z.string().max(700).optional(),
  confidence: confidenceSchema,
  evidenceRefs: evidenceRefsSchema,
});

const keyFieldSuggestionSchema = z.object({
  role: z.enum(["source", "destination"]),
  profileName: z.string().min(1).max(240),
  fieldName: z.string().min(1).max(220),
  reason: z.string().max(700).optional(),
  confidence: confidenceSchema,
  evidenceRefs: evidenceRefsSchema,
});

const mappingTypeCorrectionSchema = z.object({
  mappingSetName: z.string().min(1).max(240),
  destinationFieldName: z.string().min(1).max(220),
  newMappingType: z.enum(["direct", "constant", "lookup", "function", "join"]),
  reason: z.string().max(700).optional(),
  confidence: confidenceSchema,
  evidenceRefs: evidenceRefsSchema,
});

const resolverSuggestionInputSchema = z.object({
  category: z.enum(["project", "endpoint", "profile", "mapping", "flow", "section", "warning"]).default("warning"),
  target: z.string().min(1).max(300).default("workbook"),
  field: z.string().max(160).optional(),
  proposedValue: z.string().max(3000).optional(),
  currentValue: z.string().max(3000).optional(),
  reason: z.string().max(1000).optional(),
  confidence: confidenceSchema,
  evidenceRefs: evidenceRefsSchema,
  conflictNotes: z.array(z.string().max(700)).default([]),
});

const endpointCandidateSchema = fmdDraftEndpointSchema.extend({
  reason: z.string().max(1000).optional(),
  conflictNotes: z.array(z.string().max(700)).default([]),
});

const processFlowCandidateSchema = fmdDraftProcessFlowSchema.extend({
  reason: z.string().max(1000).optional(),
  conflictNotes: z.array(z.string().max(700)).default([]),
});

const fmdAiResolutionSchema = z.object({
  project: fmdImportDraftSchema.shape.project.partial().optional(),
  integrationPattern: z.string().max(200).optional(),
  suggestions: z.array(resolverSuggestionInputSchema).default([]),
  endpoints: z.array(endpointCandidateSchema).default([]),
  processFlows: z.array(processFlowCandidateSchema).default([]),
  profileRenames: z
    .array(
      z.object({
        role: z.enum(["source", "destination"]),
        currentName: z.string().min(1).max(240),
        proposedName: z.string().min(1).max(240),
        confidence: confidenceSchema,
        evidenceRefs: evidenceRefsSchema,
      }),
    )
    .default([]),
  profileTypeFixes: z.array(profileTypeFixSchema).default([]),
  keyFieldSuggestions: z.array(keyFieldSuggestionSchema).default([]),
  mappingSetNotes: z
    .array(
      z.object({
        mappingSetName: z.string().min(1).max(240),
        note: z.string().min(1).max(700),
        confidence: confidenceSchema,
        evidenceRefs: evidenceRefsSchema,
      }),
    )
    .default([]),
  mappingTypeCorrections: z.array(mappingTypeCorrectionSchema).default([]),
  warnings: z.array(z.string().max(700)).default([]),
  unresolvedEvidenceRefs: evidenceRefsSchema,
});

type FmdAiResolution = z.infer<typeof fmdAiResolutionSchema>;
type FmdResolverSuggestionInput = z.infer<typeof resolverSuggestionInputSchema>;
type FmdEndpointCandidate = z.infer<typeof endpointCandidateSchema>;
type FmdProcessFlowCandidate = z.infer<typeof processFlowCandidateSchema>;

type ResolverPassName = "inventory" | "project" | "endpoints" | "profiles" | "mappings" | "flow" | "verifier";

export type FmdResolverSuggestion = FmdResolverSuggestionInput & {
  id: string;
  pass: ResolverPassName;
  status: "accepted" | "needs_review" | "rejected";
};

export type FmdResolverPass = {
  pass: string;
  ok: boolean;
  durationMs: number;
  error?: string;
  acceptedSuggestions?: number;
  needsReview?: number;
};

export type FmdResolverStatus = {
  provider: "deterministic" | LlmProviderType;
  providerId?: string;
  providerName?: string;
  providerSource?: "db" | "env" | "explicit";
  model: string;
  baseUrl?: string;
  ok: boolean;
  message: string;
  durationMs: number;
  passes?: FmdResolverPass[];
  suggestions?: FmdResolverSuggestion[];
  acceptedSuggestions?: FmdResolverSuggestion[];
  needsReview?: FmdResolverSuggestion[];
  confidence?: number;
  cache?: "hit" | "miss";
};

export type FmdResolveResponse = {
  summary: NormalizedFmdWorkbook;
  draft: FmdImportDraft;
  resolver: FmdResolverStatus;
  debug?: {
    promptText?: string;
    rawLlmResponse?: string;
    passes?: Array<{
      pass: string;
      promptText?: string;
      rawLlmResponse?: string;
      durationMs?: number;
      error?: string;
    }>;
  };
};

type ExtractOptions = {
  maxRowsPerSheet?: number;
  maxColumnsPerSheet?: number;
  maxCellLength?: number;
};

type LlmResolveOptions = LlmProviderOverride & {
  useLlm?: boolean;
};

type ColumnGroup = {
  type: "source" | "destination" | "mapping" | "comment";
  start: number;
  end: number;
  label: string;
};

type ParsedMappingSheet = {
  mappingSet: FmdDraftMappingSet;
  profiles: FmdDraftProfile[];
};

const defaultOllamaModel = "qwen3:8b";
const defaultOllamaBaseUrl = "http://localhost:11434";
const resolverCacheVersion = "fmd-llm-resolver-v3";
const autoApplyConfidence = 0.82;

export { clearResolverCache };

const roleMatchers: Array<[FmdSheetRole, RegExp]> = [
  ["documentLog", /document log|修正履歴/i],
  ["fieldMapping", /field mapping|マッピング/i],
  ["explanation", /explanation|説明/i],
  ["overview", /overview|連携概要|連携IF設計|process|architecture|データフロー/i],
  ["environment", /environment|環境|endpoint|エンドポイント|api仕様|エンドポイント一覧/i],
  ["jobHandling", /job|ジョブ|error|エラー/i],
  ["sample", /sample|テストファイル|json|csv/i],
  ["reference", /reference|参考|補足|about fmd|fmdについて/i],
];

export async function resolveFmdWorkbook(
  buffer: Buffer | ArrayBuffer,
  filename: string,
  options: LlmResolveOptions = {},
): Promise<FmdResolveResponse> {

  const evidence = await extractFmdEvidence(buffer, filename);
  const deterministicDraft = createDeterministicFmdDraft(evidence);
  const summary = summarizeFmdEvidence(evidence);

  let result: FmdResolveResponse;

  if (options.useLlm === false || process.env.BOOMI_HELPER_LLM_DISABLED === "1") {
    result = {
      summary,
      draft: deterministicDraft,
      resolver: {
        provider: "deterministic",
        model: "none",
        ok: true,
        message: "Local LLM disabled; deterministic resolver used.",
        durationMs: 0,
        passes: [],
        suggestions: [],
        acceptedSuggestions: [],
        needsReview: [],
        confidence: deterministicDraft.project.confidence,
      },
    };
  } else {
    result = await resolveWithConfiguredLlm(evidence, deterministicDraft, options)
      .then((llmResult) => ({ summary, draft: llmResult.draft, resolver: llmResult.resolver, debug: llmResult.debug }))
      .catch((error): FmdResolveResponse => ({
        summary,
        draft: {
          ...deterministicDraft,
          warnings: [
            ...deterministicDraft.warnings,
            `Multi-pass LLM resolver failed; deterministic fallback used. ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          ],
        },
        resolver: {
          provider: "deterministic" as const,
          model: options.model ?? process.env.BOOMI_HELPER_OLLAMA_MODEL ?? defaultOllamaModel,
          baseUrl: options.baseUrl ?? process.env.BOOMI_HELPER_OLLAMA_URL ?? defaultOllamaBaseUrl,
          ok: false,
          message: error instanceof Error ? error.message : "Multi-pass resolver failed.",
          durationMs: 0,
          passes: [{ pass: "all", ok: false, durationMs: 0, error: error instanceof Error ? error.message : "Unknown error" }],
          suggestions: [],
          acceptedSuggestions: [],
          needsReview: [],
          confidence: deterministicDraft.project.confidence,
        },
      }));
  }

  return result;
}

export async function extractFmdEvidence(
  buffer: Buffer | ArrayBuffer,
  filename = "uploaded.xlsx",
  options: ExtractOptions = {},
): Promise<FmdWorkbookEvidence> {
  const workbook = new ExcelJS.Workbook();
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  await workbook.xlsx.load(input as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const maxRowsPerSheet = options.maxRowsPerSheet ?? 140;
  const maxColumnsPerSheet = options.maxColumnsPerSheet ?? 48;
  const maxCellLength = options.maxCellLength ?? 480;
  let redactionCount = 0;
  const warnings: string[] = [];

  const sheets = workbook.worksheets.map((worksheet) => {
    const rows: FmdEvidenceRow[] = [];
    let seenRows = 0;
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      if (seenRows >= maxRowsPerSheet) return;
      const cells: string[] = [];
      for (let column = 1; column <= Math.min(worksheet.actualColumnCount, maxColumnsPerSheet); column += 1) {
        const normalized = normalizeCellValue(row.getCell(column).value);
        const redacted = redactSensitive(String(normalized ?? ""), maxCellLength);
        if (redacted.redacted) redactionCount += 1;
        cells.push(redacted.value);
      }
      const trimmed = trimTrailingEmptyCells(cells);
      if (trimmed.some((cell) => cell.trim())) {
        rows.push({
          rowIndex: row.number,
          cells: trimmed,
          text: trimmed.filter(Boolean).join(" | "),
          evidenceRef: `${worksheet.name}!R${row.number}`,
        });
        seenRows += 1;
      }
    });

    if (worksheet.actualRowCount > maxRowsPerSheet) {
      warnings.push(
        `${worksheet.name}: evidence capped at ${maxRowsPerSheet} non-empty rows out of ${worksheet.actualRowCount}.`,
      );
    }
    if (worksheet.actualColumnCount > maxColumnsPerSheet) {
      warnings.push(
        `${worksheet.name}: evidence capped at ${maxColumnsPerSheet} columns out of ${worksheet.actualColumnCount}.`,
      );
    }

    return {
      name: worksheet.name,
      role: detectRole(worksheet.name),
      rowCount: worksheet.actualRowCount,
      columnCount: worksheet.actualColumnCount,
      headers: extractHeaders(rows.map((row) => row.cells)),
      rows,
    };
  });

  return {
    filename,
    sheets,
    mappingSheets: sheets.filter((sheet) => sheet.role === "fieldMapping").length,
    designSections: sheets.filter((sheet) =>
      ["explanation", "overview", "environment", "jobHandling"].includes(sheet.role),
    ).length,
    warnings,
    redactionCount,
  };
}

export function summarizeFmdEvidence(evidence: FmdWorkbookEvidence): NormalizedFmdWorkbook {
  return {
    filename: evidence.filename,
    sheets: evidence.sheets.map((sheet) => ({
      name: sheet.name,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      role: sheet.role,
      headers: sheet.headers,
    })),
    mappingSheets: evidence.mappingSheets,
    designSections: evidence.designSections,
  };
}

export function createDeterministicFmdDraft(evidence: FmdWorkbookEvidence): FmdImportDraft {
  const metadata = extractProjectMetadata(evidence);
  const warnings = [...evidence.warnings];
  if (evidence.redactionCount > 0) {
    warnings.push(`${evidence.redactionCount} sensitive-looking cell values were redacted before resolver use.`);
  }

  const sections = evidence.sheets
    .filter((sheet) => sheet.role !== "fieldMapping")
    .map((sheet, index) => sheetToSection(sheet, index));

  const endpoints = extractEndpoints(evidence);
  const profileMap = new Map<string, FmdDraftProfile>();
  const mappingSets: FmdDraftMappingSet[] = [];

  for (const sheet of evidence.sheets.filter((candidate) => candidate.role === "fieldMapping")) {
    const parsed = parseMappingSheet(sheet, evidence);
    if (!parsed) {
      warnings.push(`${sheet.name}: no structured mapping rows were detected.`);
      continue;
    }
    for (const profile of parsed.profiles) {
      mergeProfile(profileMap, profile);
    }
    mappingSets.push(parsed.mappingSet);
  }

  if (mappingSets.length === 0) {
    warnings.push("No mapping sets were resolved from this workbook.");
  }

  const refinedProfiles = [...profileMap.values()]
    .map(sortProfileFields)
    .map((profile) => refineProfileFromFields(profile, warnings));

  return fmdImportDraftSchema.parse({
    project: metadata,
    endpoints,
    profiles: refinedProfiles,
    mappingSets,
    fmdSections: sections,
    warnings,
    unresolvedEvidenceRefs: evidence.sheets
      .filter((sheet) => sheet.role === "fieldMapping" && !mappingSets.some((set) => set.evidenceRefs.includes(`${sheet.name}!R1`)))
      .map((sheet) => `${sheet.name}!R1`),
  });
}

function refineProfileFromFields(profile: FmdDraftProfile, warnings: string[]): FmdDraftProfile {
  const format = (profile.format ?? "").trim();
  const needsRefine = !format || format.toLowerCase() === "unknown";
  if (!needsRefine) return profile;
  if (profile.fields.length === 0) {
    warnings.push(`Profile "${profile.name}" has no fields; format defaulted to TSV. Edit the profile to set the right format.`);
    return { ...profile, format: profile.type === "Flat File" ? "TSV" : profile.format || "Unknown" };
  }

  const fieldsWithParent = profile.fields.filter((field) => !!field.parentPath);
  const slashCount = fieldsWithParent.filter((field) => (field.parentPath ?? "").includes("/")).length;
  const dotCount = fieldsWithParent.filter((field) => (field.parentPath ?? "").includes(".")).length;
  const xmlNameHint = profile.fields.some((field) => /^[a-z][a-z0-9_-]*:[a-z]/i.test(field.name));
  const looksJsonByDataType = profile.fields.some((field) => /object|array|json/i.test(field.dataType));

  if (slashCount > dotCount && slashCount > 0) {
    warnings.push(`Profile "${profile.name}" format inferred as XML from XPath-style field paths.`);
    return { ...profile, type: "XML", format: "XML" };
  }
  if (xmlNameHint && profile.type !== "JSON") {
    warnings.push(`Profile "${profile.name}" format inferred as XML from namespaced field names.`);
    return { ...profile, type: "XML", format: "XML" };
  }
  if (dotCount > 0 || looksJsonByDataType) {
    warnings.push(`Profile "${profile.name}" format inferred as JSON from nested field paths.`);
    return { ...profile, type: profile.type === "API" ? "API" : "JSON", format: "JSON" };
  }

  warnings.push(`Profile "${profile.name}" had no format signal; defaulted to TSV. Override it in the profile editor if needed.`);
  return { ...profile, type: profile.type === "Database" ? "Database" : "Flat File", format: profile.type === "Database" ? "Table" : "TSV" };
}

async function resolveWithConfiguredLlm(
  evidence: FmdWorkbookEvidence,
  deterministicDraft: FmdImportDraft,
  options: LlmResolveOptions,
): Promise<{ draft: FmdImportDraft; resolver: FmdResolverStatus; debug?: FmdResolveResponse["debug"] }> {
  const started = Date.now();
  const { createLlmChatProvider, getConfiguredLlmProvider } = await import("./llm-providers");
  const configuredProvider = await getConfiguredLlmProvider(options);
  const providerConfig: LlmProviderRuntimeConfig = {
    ...configuredProvider,
    timeoutMs: options.timeoutMs ?? configuredProvider.timeoutMs,
  };
  const cacheKey = resolverCacheKey(evidence, deterministicDraft, resolverCacheProviderKey(providerConfig));
  const cached = lookupCache(cacheKey);
  if (isCachedLlmResult(cached)) {
    return {
      draft: cached.draft,
      resolver: {
        ...cached.resolver,
        message: `${cached.resolver.message} Cache hit.`,
        durationMs: 0,
        cache: "hit",
        passes: [{ pass: "cache", ok: true, durationMs: 0 }, ...(cached.resolver.passes ?? [])],
      },
    };
  }

  const provider = createLlmChatProvider(providerConfig);
  await provider.listModels();

  const passResults: FmdResolverPass[] = [];
  const debugPasses: NonNullable<FmdResolveResponse["debug"]>["passes"] = [];
  const suggestions: FmdResolverSuggestion[] = [];
  const acceptedSuggestions: FmdResolverSuggestion[] = [];
  const needsReview: FmdResolverSuggestion[] = [];
  let bestDraft = deterministicDraft;

  const passes: Array<{
    name: ResolverPassName;
    buildPrompt: (e: FmdWorkbookEvidence, d: FmdImportDraft) => string;
    schema: object;
  }> = [
    { name: "inventory", buildPrompt: buildEvidenceInventoryPassPrompt, schema: buildEvidenceInventoryPassSchema() },
    { name: "project", buildPrompt: buildProjectPassPrompt, schema: buildProjectPassSchema() },
    { name: "endpoints", buildPrompt: buildEndpointPassPrompt, schema: buildEndpointPassSchema() },
    { name: "profiles", buildPrompt: buildProfilePassPrompt, schema: buildProfilePassSchema() },
    { name: "mappings", buildPrompt: buildMappingPassPrompt, schema: buildMappingPassSchema() },
    { name: "flow", buildPrompt: buildFlowPassPrompt, schema: buildFlowPassSchema() },
    { name: "verifier", buildPrompt: buildVerifierPassPrompt, schema: buildVerifierPassSchema() },
  ];

  for (const pass of passes) {
    const passStarted = Date.now();
    try {
      const prompt = pass.buildPrompt(evidence, bestDraft);
      const beforeAccepted = acceptedSuggestions.length;
      const beforeReview = needsReview.length;
      const content = await provider.chat({
        pass: pass.name,
        systemPrompt: buildSystemPrompt(pass.name),
        prompt,
        schema: pass.schema,
      });

      const parsedJson = parseJsonObject(content);
      const parsedResolution = fmdAiResolutionSchema.safeParse(parsedJson);
      if (parsedResolution.success) {
        const applied = applyAiResolution(bestDraft, parsedResolution.data, evidence, pass.name);
        bestDraft = applied.draft;
        suggestions.push(...applied.suggestions);
        acceptedSuggestions.push(...applied.acceptedSuggestions);
        needsReview.push(...applied.needsReview);
      } else {
        const parsedDraft = fmdImportDraftSchema.safeParse(parsedJson);
        if (parsedDraft.success) {
          if (
            parsedDraft.data.profiles.length === 0 &&
            parsedDraft.data.mappingSets.length === 0 &&
            parsedDraft.data.endpoints.length === 0 &&
            bestDraft.profiles.length + bestDraft.mappingSets.length + bestDraft.endpoints.length > 0
          ) {
            const merged = {
              ...bestDraft,
              warnings: [...bestDraft.warnings, ...parsedDraft.data.warnings.filter((w: string) => !bestDraft.warnings.includes(w))],
            };
            bestDraft = fmdImportDraftSchema.parse(merged);
          } else {
            const merged = {
              ...parsedDraft.data,
              warnings: [...bestDraft.warnings, ...parsedDraft.data.warnings.filter((w: string) => !bestDraft.warnings.includes(w))],
            };
            bestDraft = fmdImportDraftSchema.parse(merged);
          }
        }
      }

      passResults.push({
        pass: pass.name,
        ok: true,
        durationMs: Date.now() - passStarted,
        acceptedSuggestions: acceptedSuggestions.length - beforeAccepted,
        needsReview: needsReview.length - beforeReview,
      });
      debugPasses.push({ pass: pass.name, promptText: prompt, rawLlmResponse: content, durationMs: Date.now() - passStarted });
    } catch (error) {
      passResults.push({
        pass: pass.name,
        ok: false,
        durationMs: Date.now() - passStarted,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      debugPasses.push({
        pass: pass.name,
        promptText: pass.buildPrompt(evidence, bestDraft),
        durationMs: Date.now() - passStarted,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const allOk = passResults.every((p) => p.ok);
  const totalDuration = Date.now() - started;
  if (needsReview.length > 0) {
    bestDraft = fmdImportDraftSchema.parse({
      ...bestDraft,
      warnings: [
        ...bestDraft.warnings,
        `Resolver kept ${needsReview.length} lower-confidence or conflicting suggestion(s) for review.`,
      ],
    });
  }
  const resolverConfidence = computeResolverConfidence(bestDraft, acceptedSuggestions, passResults);

  const result: { draft: FmdImportDraft; resolver: FmdResolverStatus; debug: NonNullable<FmdResolveResponse["debug"]> } = {
    draft: bestDraft,
    resolver: {
      provider: providerConfig.type,
      providerId: providerConfig.id,
      providerName: providerConfig.name,
      providerSource: providerConfig.source,
      model: providerConfig.model,
      baseUrl: providerConfig.baseUrl,
      ok: allOk,
      message: allOk
        ? `Multi-pass resolution complete (${passResults.length} passes).`
        : `Multi-pass resolution completed with ${passResults.filter((p) => !p.ok).length} pass error(s).`,
      durationMs: totalDuration,
      passes: passResults,
      suggestions,
      acceptedSuggestions,
      needsReview,
      confidence: resolverConfidence,
      cache: "miss" as const,
    },
    debug: { passes: debugPasses },
  };

  storeCache(cacheKey, { draft: result.draft, resolver: result.resolver });
  return result;
}

function applyAiResolution(
  draft: FmdImportDraft,
  resolution: FmdAiResolution,
  evidence?: FmdWorkbookEvidence,
  pass: ResolverPassName = "verifier",
): {
  draft: FmdImportDraft;
  suggestions: FmdResolverSuggestion[];
  acceptedSuggestions: FmdResolverSuggestion[];
  needsReview: FmdResolverSuggestion[];
} {
  const suggestions: FmdResolverSuggestion[] = [];
  const acceptedSuggestions: FmdResolverSuggestion[] = [];
  const needsReview: FmdResolverSuggestion[] = [];
  let nextDraft = draft;

  const recordSuggestion = (
    input: FmdResolverSuggestionInput,
    defaultStatus?: FmdResolverSuggestion["status"],
  ): FmdResolverSuggestion => {
    const status = defaultStatus ?? classifySuggestion(input);
    const suggestion: FmdResolverSuggestion = {
      ...input,
      id: `${pass}-${suggestions.length + 1}`,
      pass,
      status,
    };
    suggestions.push(suggestion);
    if (status === "accepted") acceptedSuggestions.push(suggestion);
    if (status === "needs_review") needsReview.push(suggestion);
    return suggestion;
  };

  for (const suggestion of resolution.suggestions) {
    recordSuggestion(suggestion);
  }

  const projectPatch: Partial<FmdImportDraft["project"]> = {};
  const projectEvidenceRefs = new Set(nextDraft.project.evidenceRefs);
  let projectConfidence = nextDraft.project.confidence;
  const projectCandidate = {
    ...(resolution.project ?? {}),
    ...(resolution.integrationPattern ? { integrationPattern: resolution.integrationPattern } : {}),
  } as Partial<FmdImportDraft["project"]>;

  for (const [field, rawValue] of Object.entries(projectCandidate)) {
    if (field === "confidence" || field === "evidenceRefs") continue;
    if (rawValue === undefined || rawValue === "") continue;
    const proposedValue = String(rawValue);
    const currentValue = String(nextDraft.project[field as keyof FmdImportDraft["project"]] ?? "");
    if (normalizeForMatch(currentValue) === normalizeForMatch(proposedValue)) continue;
    const conflictNotes = projectConflictNotes(field, currentValue, proposedValue, projectCandidate.confidence ?? 0);
    const suggestion = recordSuggestion({
      category: "project",
      target: `project.${field}`,
      field,
      currentValue,
      proposedValue,
      confidence: projectCandidate.confidence ?? 0.5,
      evidenceRefs: projectCandidate.evidenceRefs ?? [],
      reason: `LLM proposed ${field} from workbook evidence.`,
      conflictNotes,
    });
    if (suggestion.status === "accepted") {
      projectPatch[field as keyof FmdImportDraft["project"]] = rawValue as never;
      for (const ref of suggestion.evidenceRefs) projectEvidenceRefs.add(ref);
      projectConfidence = Math.max(projectConfidence, suggestion.confidence);
    }
  }

  if (Object.keys(projectPatch).length > 0) {
    nextDraft = fmdImportDraftSchema.parse({
      ...nextDraft,
      project: {
        ...nextDraft.project,
        ...projectPatch,
        confidence: projectConfidence,
        evidenceRefs: [...projectEvidenceRefs],
      },
    });
  }

  const endpointResult = applyEndpointCandidates(nextDraft, resolution.endpoints, recordSuggestion);
  nextDraft = endpointResult.draft;

  const processFlowResult = applyProcessFlowCandidates(nextDraft, resolution.processFlows, recordSuggestion);
  nextDraft = processFlowResult.draft;

  const acceptedRenames = resolution.profileRenames.filter((rename) => {
    const conflictNotes: string[] = [];
    if (!nextDraft.profiles.some((profile) => profile.role === rename.role && namesEqual(profile.name, rename.currentName))) {
      conflictNotes.push("Current profile was not found in the deterministic draft.");
    }
    if (nextDraft.profiles.some((profile) => profile.role === rename.role && namesEqual(profile.name, rename.proposedName))) {
      conflictNotes.push("Another profile already has the proposed name.");
    }
    const suggestion = recordSuggestion({
      category: "profile",
      target: `${rename.role} profile ${rename.currentName}`,
      field: "name",
      currentValue: rename.currentName,
      proposedValue: rename.proposedName,
      confidence: rename.confidence,
      evidenceRefs: rename.evidenceRefs,
      reason: "LLM proposed a less generic profile name.",
      conflictNotes,
    });
    return suggestion.status === "accepted";
  });

  const renameByKey = new Map(
    acceptedRenames.map((rename) => [
      `${rename.role}::${rename.currentName}`.toLowerCase(),
      rename.proposedName,
    ]),
  );
  const renameProfile = (role: Profile["role"], name: string) =>
    renameByKey.get(`${role}::${name}`.toLowerCase()) ?? name;

  const acceptedMappingNotes = resolution.mappingSetNotes.filter((note) => {
    const conflictNotes: string[] = [];
    if (!nextDraft.mappingSets.some((mappingSet) => namesEqual(mappingSet.name, note.mappingSetName))) {
      conflictNotes.push("Mapping set was not found in the deterministic draft.");
    }
    const suggestion = recordSuggestion({
      category: "mapping",
      target: `mapping set ${note.mappingSetName}`,
      field: "note",
      proposedValue: note.note,
      confidence: note.confidence,
      evidenceRefs: note.evidenceRefs,
      reason: note.note,
      conflictNotes,
    });
    return suggestion.status === "accepted";
  });
  const mappingNotes = new Map(acceptedMappingNotes.map((note) => [note.mappingSetName, note.note]));

  const acceptedTypeFixes = resolution.profileTypeFixes.filter((fix) => {
    const profileExists = nextDraft.profiles.some(
      (profile) => profile.role === fix.role && namesEqual(renameProfile(profile.role, profile.name), fix.profileName),
    );
    const suggestion = recordSuggestion({
      category: "profile",
      target: `${fix.role} profile ${fix.profileName}`,
      field: "type/format",
      proposedValue: `${fix.newType} / ${fix.newFormat}`,
      confidence: fix.confidence,
      evidenceRefs: fix.evidenceRefs,
      reason: fix.reason ?? "LLM proposed a profile type/format correction.",
      conflictNotes: profileExists ? [] : ["Profile was not found in the deterministic draft."],
    });
    return suggestion.status === "accepted";
  });
  const typeFixByKey = new Map(
    acceptedTypeFixes.map((fix) => [
      `${fix.role}::${fix.profileName}`.toLowerCase(),
      { type: fix.newType, format: fix.newFormat, reason: fix.reason },
    ]),
  );

  const acceptedKeyFields = resolution.keyFieldSuggestions.filter((item) => {
    const profile = nextDraft.profiles.find(
      (candidate) => candidate.role === item.role && namesEqual(renameProfile(candidate.role, candidate.name), item.profileName),
    );
    const fieldExists = profile?.fields.some((field) => namesEqual(field.name, item.fieldName)) ?? false;
    const suggestion = recordSuggestion({
      category: "profile",
      target: `${item.role} profile ${item.profileName}.${item.fieldName}`,
      field: "keyField",
      proposedValue: "true",
      confidence: item.confidence,
      evidenceRefs: item.evidenceRefs,
      reason: item.reason ?? "LLM marked this as a likely key field.",
      conflictNotes: fieldExists ? [] : ["Field was not found in the deterministic draft."],
    });
    return suggestion.status === "accepted";
  });
  const keyFieldSuggestions = new Map(
    acceptedKeyFields.map((s) => [
      `${s.role}::${s.profileName.toLowerCase()}::${s.fieldName.toLowerCase()}`,
      s,
    ]),
  );

  const acceptedMappingTypeCorrections = resolution.mappingTypeCorrections.filter((correction) => {
    const mappingSet = nextDraft.mappingSets.find((set) => namesEqual(set.name, correction.mappingSetName));
    const rule = mappingSet?.rules.find((item) => namesEqual(item.destinationFieldName, correction.destinationFieldName));
    const suggestion = recordSuggestion({
      category: "mapping",
      target: `${correction.mappingSetName}.${correction.destinationFieldName}`,
      field: "mappingType",
      currentValue: rule?.mappingType,
      proposedValue: correction.newMappingType,
      confidence: correction.confidence,
      evidenceRefs: correction.evidenceRefs,
      reason: correction.reason ?? "LLM proposed a mapping type correction.",
      conflictNotes: rule ? [] : ["Mapping rule was not found in the deterministic draft."],
    });
    return suggestion.status === "accepted";
  });
  const mappingTypeCorrections = new Map(
    acceptedMappingTypeCorrections.map((c) => [
      `${c.mappingSetName.toLowerCase()}::${c.destinationFieldName.toLowerCase()}`,
      c,
    ]),
  );
  const reconciliationWarnings: string[] = [];

  nextDraft = fmdImportDraftSchema.parse({
    ...nextDraft,
    profiles: nextDraft.profiles.map((profile) => {
      const newName = renameProfile(profile.role, profile.name);
      const renamed = newName !== profile.name;
      let nextType = profile.type;
      let nextFormat = profile.format;

      const fixKey = `${profile.role}::${profile.name}`.toLowerCase();
      const renameFixKey = renamed ? `${profile.role}::${newName}`.toLowerCase() : "";
      const typeFix = typeFixByKey.get(fixKey) ?? typeFixByKey.get(renameFixKey);
      if (typeFix && (typeFix.type !== profile.type || typeFix.format !== profile.format)) {
        nextType = typeFix.type;
        nextFormat = typeFix.format;
        reconciliationWarnings.push(
          `Profile "${profile.name}" type/format corrected to ${typeFix.type} / ${typeFix.format} by LLM${typeFix.reason ? `: ${typeFix.reason}` : ""}.`,
        );
      } else if (renamed && evidence) {
        const reinferred = inferProfileTypeFromEvidence(newName, newName, evidence);
        if (reinferred.type !== profile.type || reinferred.format !== profile.format) {
          const reinferredSpecific = reinferred.format !== "Unknown" && reinferred.format !== "";
          if (reinferredSpecific) {
            nextType = reinferred.type;
            nextFormat = reinferred.format;
            reconciliationWarnings.push(
              `Profile "${profile.name}" -> "${newName}" type/format reconciled to ${reinferred.type} / ${reinferred.format} after LLM rename.`,
            );
          }
        }
      }

      const updatedFields = profile.fields.map((field) => {
        const keySuggestion = keyFieldSuggestions.get(
          `${profile.role}::${profile.name.toLowerCase()}::${field.name.toLowerCase()}`,
        ) ?? keyFieldSuggestions.get(
          `${profile.role}::${newName.toLowerCase()}::${field.name.toLowerCase()}`,
        );
        if (keySuggestion && !field.keyField) {
          return { ...field, keyField: true, confidence: Math.max(field.confidence, keySuggestion.confidence) };
        }
        return field;
      });

      return {
        ...profile,
        name: newName,
        type: nextType,
        format: nextFormat,
        fields: updatedFields,
        confidence: Math.max(
          profile.confidence,
          resolution.profileRenames.find(
            (rename) =>
              rename.role === profile.role &&
              rename.currentName.toLowerCase() === profile.name.toLowerCase(),
          )?.confidence ?? 0,
        ),
      };
    }),
    mappingSets: nextDraft.mappingSets.map((mappingSet) => {
      const note = mappingNotes.get(mappingSet.name);
      const updatedRules = mappingSet.rules.map((rule) => {
        const correctionKey = `${mappingSet.name.toLowerCase()}::${rule.destinationFieldName.toLowerCase()}`;
        const correction = mappingTypeCorrections.get(correctionKey);
        if (correction && correction.newMappingType !== rule.mappingType) {
          return {
            ...rule,
            mappingType: correction.newMappingType,
            confidence: Math.max(rule.confidence, correction.confidence),
            comment: rule.comment ?? correction.reason,
          };
        }
        return rule;
      });

      return {
        ...mappingSet,
        sourceProfileName: renameProfile("source", mappingSet.sourceProfileName),
        destinationProfileName: renameProfile("destination", mappingSet.destinationProfileName),
        rules: updatedRules.map((rule) => ({
          ...rule,
          sourceProfileName: rule.sourceProfileName
            ? renameProfile("source", rule.sourceProfileName)
            : rule.sourceProfileName,
          destinationProfileName: rule.destinationProfileName
            ? renameProfile("destination", rule.destinationProfileName)
            : rule.destinationProfileName,
        })),
        warnings: note ? (mappingSet.warnings.includes(note) ? mappingSet.warnings : [...mappingSet.warnings, note]) : mappingSet.warnings,
        confidence: Math.max(
          mappingSet.confidence,
          resolution.mappingSetNotes.find((item) => item.mappingSetName === mappingSet.name)?.confidence ?? 0,
        ),
      };
    }),
    warnings: [
      ...nextDraft.warnings,
      ...resolution.warnings.filter((warning) => !nextDraft.warnings.includes(warning)),
      ...reconciliationWarnings,
    ],
    unresolvedEvidenceRefs: [
      ...new Set([...nextDraft.unresolvedEvidenceRefs, ...resolution.unresolvedEvidenceRefs]),
    ],
  });

  return { draft: nextDraft, suggestions, acceptedSuggestions, needsReview };
}

function classifySuggestion(input: FmdResolverSuggestionInput): FmdResolverSuggestion["status"] {
  if (input.conflictNotes.length > 0) return "needs_review";
  if (input.confidence < autoApplyConfidence) return "needs_review";
  if (input.evidenceRefs.length === 0) return "needs_review";
  return "accepted";
}

function applyEndpointCandidates(
  draft: FmdImportDraft,
  candidates: FmdEndpointCandidate[],
  recordSuggestion: (input: FmdResolverSuggestionInput, defaultStatus?: FmdResolverSuggestion["status"]) => FmdResolverSuggestion,
): { draft: FmdImportDraft } {
  if (candidates.length === 0) return { draft };
  const endpoints = [...draft.endpoints];
  for (const candidate of candidates) {
    const existingIndex = endpoints.findIndex(
      (endpoint) => namesEqual(endpoint.name, candidate.name) && endpoint.role === candidate.role,
    );
    const existing = existingIndex >= 0 ? endpoints[existingIndex] : undefined;
    const mergedPreview = existing ? mergeEndpoint(existing, candidate) : candidate;
    const changed = !existing || JSON.stringify(existing) !== JSON.stringify(mergedPreview);
    const suggestion = recordSuggestion({
      category: "endpoint",
      target: `${candidate.role} endpoint ${candidate.name}`,
      field: existing ? "endpoint enrichment" : "endpoint",
      currentValue: existing ? endpointSummary(existing) : "",
      proposedValue: endpointSummary(candidate),
      confidence: candidate.confidence,
      evidenceRefs: candidate.evidenceRefs,
      reason: candidate.reason ?? "LLM found endpoint/environment evidence.",
      conflictNotes: candidate.conflictNotes,
    }, changed ? undefined : "rejected");
    if (suggestion.status !== "accepted") continue;
    if (existingIndex >= 0) {
      endpoints[existingIndex] = fmdDraftEndpointSchema.parse(mergedPreview);
    } else {
      endpoints.push(fmdDraftEndpointSchema.parse(candidate));
    }
  }
  return {
    draft: fmdImportDraftSchema.parse({
      ...draft,
      endpoints: dedupeBy(endpoints, (endpoint) => `${endpoint.role}::${endpoint.name}`),
    }),
  };
}

function applyProcessFlowCandidates(
  draft: FmdImportDraft,
  candidates: FmdProcessFlowCandidate[],
  recordSuggestion: (input: FmdResolverSuggestionInput, defaultStatus?: FmdResolverSuggestion["status"]) => FmdResolverSuggestion,
): { draft: FmdImportDraft } {
  if (candidates.length === 0) return { draft };
  const processFlows = [...draft.processFlows];
  for (const candidate of candidates.slice(0, 1)) {
    const conflictNotes = [
      ...candidate.conflictNotes,
      ...processFlowGraphConflictNotes(candidate),
    ];
    const duplicate = processFlows.find((flow) => namesEqual(flow.name, candidate.name));
    if (duplicate) {
      conflictNotes.push("A process flow with this name already exists in the draft.");
    }
    const suggestion = recordSuggestion({
      category: "flow",
      target: `process flow ${candidate.name}`,
      field: "processFlow",
      currentValue: duplicate ? processFlowSummary(duplicate) : "",
      proposedValue: processFlowSummary(candidate),
      confidence: candidate.confidence,
      evidenceRefs: candidate.evidenceRefs,
      reason: candidate.reason ?? "LLM proposed a sample Boomi process flow from FMD evidence.",
      conflictNotes,
    });
    if (suggestion.status !== "accepted") continue;
    processFlows.push(fmdDraftProcessFlowSchema.parse({
      id: candidate.id,
      name: candidate.name,
      nodes: candidate.nodes,
      edges: candidate.edges,
      notes: candidate.notes,
      confidence: candidate.confidence,
      evidenceRefs: candidate.evidenceRefs,
    }));
  }
  return {
    draft: fmdImportDraftSchema.parse({
      ...draft,
      processFlows: dedupeBy(processFlows, (flow) => flow.name),
    }),
  };
}

function processFlowGraphConflictNotes(flow: FmdDraftProcessFlow): string[] {
  const notes: string[] = [];
  const nodeIds = new Set<string>();
  for (const node of flow.nodes) {
    const normalized = node.id.trim();
    if (nodeIds.has(normalized)) notes.push(`Duplicate process flow node id "${node.id}".`);
    nodeIds.add(normalized);
  }
  const edgeIds = new Set<string>();
  for (const edge of flow.edges) {
    if (edgeIds.has(edge.id)) notes.push(`Duplicate process flow edge id "${edge.id}".`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source)) notes.push(`Edge "${edge.id}" source "${edge.source}" is not a node id.`);
    if (!nodeIds.has(edge.target)) notes.push(`Edge "${edge.id}" target "${edge.target}" is not a node id.`);
  }
  const startNodes = flow.nodes.filter((node) => node.type === "start" || node.type.startsWith("start-"));
  if (startNodes.length === 0) notes.push("Process flow has no start node.");
  const terminalNodes = flow.nodes.filter((node) => node.type === "stop" || node.type === "end" || node.type === "return");
  if (terminalNodes.length === 0) notes.push("Process flow has no stop/end/return node.");
  if (startNodes.length > 0) {
    const reachable = new Set<string>([startNodes[0].id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of flow.edges) {
        if (!reachable.has(edge.source) || reachable.has(edge.target)) continue;
        reachable.add(edge.target);
        changed = true;
      }
    }
    const unreachable = flow.nodes.filter((node) => !reachable.has(node.id));
    if (unreachable.length > 0) {
      notes.push(`Process flow has unreachable node(s): ${unreachable.map((node) => node.id).slice(0, 5).join(", ")}.`);
    }
  }
  return [...new Set(notes)];
}

function processFlowSummary(flow: Pick<FmdDraftProcessFlow, "name" | "nodes" | "edges" | "notes">) {
  return [
    `${flow.name}: ${flow.nodes.length} nodes, ${flow.edges.length} edges`,
    flow.nodes.map((node) => `${node.id}:${node.type}:${node.label}`).join(" -> "),
    flow.notes,
  ].filter(Boolean).join(" | ").slice(0, 3000);
}

function mergeEndpoint(
  existing: z.infer<typeof fmdDraftEndpointSchema>,
  candidate: FmdEndpointCandidate,
): z.infer<typeof fmdDraftEndpointSchema> {
  const pick = (current: string, next: string) =>
    !current || /^unknown$/i.test(current) ? next : current;
  return {
    ...existing,
    connectorType: pick(existing.connectorType, candidate.connectorType),
    profileType: pick(existing.profileType, candidate.profileType),
    format: pick(existing.format, candidate.format),
    purpose: pick(existing.purpose, candidate.purpose),
    connectionInfo: pick(existing.connectionInfo, candidate.connectionInfo),
    confidence: Math.max(existing.confidence, candidate.confidence),
    evidenceRefs: [...new Set([...existing.evidenceRefs, ...candidate.evidenceRefs])],
  };
}

function endpointSummary(endpoint: Pick<z.infer<typeof fmdDraftEndpointSchema>, "name" | "role" | "connectorType" | "format" | "connectionInfo">) {
  return [endpoint.name, endpoint.role, endpoint.connectorType, endpoint.format, endpoint.connectionInfo]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 3000);
}

function projectConflictNotes(field: string, currentValue: string, proposedValue: string, confidence: number): string[] {
  if (!currentValue || isGenericProjectValue(field, currentValue)) return [];
  if (normalizeForMatch(currentValue) === normalizeForMatch(proposedValue)) return [];
  if ((field === "description" || field === "schedule" || field === "integrationPattern") && confidence >= autoApplyConfidence) {
    return [];
  }
  if (confidence >= 0.9) return [];
  return [`Deterministic value "${currentValue}" differs from proposed "${proposedValue}".`];
}

function isGenericProjectValue(field: string, value: string) {
  const normalized = normalizeForMatch(value);
  if (!normalized) return true;
  if (field === "owner" && normalized === "unassigned") return true;
  if (field === "sourceSystem" && normalized === "unknown source") return true;
  if (field === "destinationSystem" && normalized === "unknown destination") return true;
  if (field === "description" && normalized.length < 12) return true;
  return false;
}

function namesEqual(a: string | undefined, b: string | undefined) {
  return normalizeForMatch(a ?? "") === normalizeForMatch(b ?? "");
}

function computeResolverConfidence(
  draft: FmdImportDraft,
  acceptedSuggestions: FmdResolverSuggestion[],
  passes: FmdResolverPass[],
) {
  const passRatio = passes.length ? passes.filter((pass) => pass.ok).length / passes.length : 1;
  const suggestionConfidence = acceptedSuggestions.length
    ? acceptedSuggestions.reduce((sum, suggestion) => sum + suggestion.confidence, 0) / acceptedSuggestions.length
    : draft.project.confidence;
  return Math.max(0, Math.min(1, suggestionConfidence * (0.75 + passRatio * 0.25)));
}

function resolverCacheKey(
  evidence: FmdWorkbookEvidence,
  deterministicDraft: FmdImportDraft,
  options: Record<string, unknown>,
) {
  return createHash("sha256")
    .update(JSON.stringify({ version: resolverCacheVersion, evidence, deterministicDraft, options }))
    .digest("hex");
}

function resolverCacheProviderKey(provider: LlmProviderRuntimeConfig) {
  return {
    providerId: provider.id ?? null,
    providerType: provider.type,
    providerName: provider.name,
    providerSource: provider.source,
    model: provider.model,
    baseUrl: provider.baseUrl,
    temperature: provider.temperature,
    topP: provider.topP,
    maxTokens: provider.maxTokens,
    timeoutMs: provider.timeoutMs,
    supportsJsonSchema: provider.supportsJsonSchema,
  };
}

function isCachedLlmResult(value: unknown): value is { draft: FmdImportDraft; resolver: FmdResolverStatus } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { draft?: unknown; resolver?: unknown };
  return fmdImportDraftSchema.safeParse(candidate.draft).success && !!candidate.resolver;
}

function parseJsonObject(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    const first = content.indexOf("{");
    const last = content.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) {
      throw new Error("No JSON object found in resolver output.");
    }
    return JSON.parse(content.slice(first, last + 1));
  }
}

function parseMappingSheet(sheet: FmdEvidenceSheet, evidence: FmdWorkbookEvidence): ParsedMappingSheet | null {
  const header = findGroupedHeader(sheet);
  if (!header) return parseGeneratedMappingSheet(sheet, evidence);

  const { groupRowIndex, headerRowIndex, groups } = header;
  const sourceGroup = groups.find((group) => group.type === "source");
  const destinationGroup = groups.find((group) => group.type === "destination");
  const mappingGroup = groups.find((group) => group.type === "mapping");
  const commentGroup = groups.find((group) => group.type === "comment");
  if (!sourceGroup || !destinationGroup) return null;

  const sourceProfile = createProfileShell(sheet, sourceGroup, groupRowIndex, headerRowIndex, "source", evidence);
  const destinationProfile = createProfileShell(sheet, destinationGroup, groupRowIndex, headerRowIndex, "destination", evidence);
  const sourceFields = new Map<string, FmdDraftField>();
  const destinationFields = new Map<string, FmdDraftField>();
  const rules: FmdDraftMappingRule[] = [];

  for (const row of sheet.rows.filter((candidate) => candidate.rowIndex > headerRowIndex)) {
    if (isNoiseRow(row)) continue;
    const sourceField = extractFieldFromRow(row, sheet.rows, headerRowIndex, sourceGroup);
    const destinationField = extractFieldFromRow(row, sheet.rows, headerRowIndex, destinationGroup);
    const mappingText = extractGroupText(row, sheet.rows, headerRowIndex, mappingGroup);
    const commentText = extractGroupText(row, sheet.rows, headerRowIndex, commentGroup);

    if (!destinationField && !sourceField) continue;
    const resolvedDestination = destinationField ?? makeSyntheticDestinationField(row, mappingText);
    if (!resolvedDestination) continue;

    upsertField(destinationFields, resolvedDestination);
    if (sourceField) upsertField(sourceFields, sourceField);

    const mappingType = inferMappingType(sourceField?.name, mappingText, commentText);
    rules.push({
      sourceProfileName: sourceProfile.name,
      destinationProfileName: destinationProfile.name,
      sourceFieldName: sourceField?.name,
      sourceParentPath: sourceField?.parentPath,
      destinationFieldName: resolvedDestination.name,
      destinationParentPath: resolvedDestination.parentPath,
      mappingType,
      expression: mappingText || undefined,
      defaultValue: mappingType === "constant" ? extractConstantValue(mappingText) : undefined,
      comment: joinNonEmpty([mappingText, commentText]) || undefined,
      confidence: sourceField || mappingText ? 0.72 : 0.56,
      evidenceRefs: [row.evidenceRef],
    });
  }

  if (rules.length === 0) return null;

  const parsedSourceProfile = {
    ...sourceProfile,
    name: refineProfileName(sourceProfile.name, [...sourceFields.values()], "source", sheet.name),
    fields: [...sourceFields.values()].map((field, index) => ({ ...field, ordinal: index + 1 })),
  };
  const parsedDestinationProfile = {
    ...destinationProfile,
    name: refineProfileName(destinationProfile.name, [...destinationFields.values()], "destination", sheet.name),
    fields: [...destinationFields.values()].map((field, index) => ({ ...field, ordinal: index + 1 })),
  };

  const mappingSet = fmdDraftMappingSetSchema.parse({
    name: sheet.name,
    sourceProfileName: parsedSourceProfile.name,
    destinationProfileName: parsedDestinationProfile.name,
    direction: "source-to-destination",
    rules: rules.map((rule) => ({
      ...rule,
      sourceProfileName: parsedSourceProfile.name,
      destinationProfileName: parsedDestinationProfile.name,
    })),
    evidenceRefs: [`${sheet.name}!R${groupRowIndex}`, `${sheet.name}!R${headerRowIndex}`],
    confidence: 0.74,
    warnings: [],
    strategy: "grouped" as const,
  });

  return {
    profiles: [
      fmdDraftProfileSchema.parse(parsedSourceProfile),
      fmdDraftProfileSchema.parse(parsedDestinationProfile),
    ],
    mappingSet,
  };
}

function parseGeneratedMappingSheet(
  sheet: FmdEvidenceSheet,
  evidence: FmdWorkbookEvidence,
): ParsedMappingSheet | null {
  const header = sheet.rows.find((row) => {
    const text = normalizeForMatch(row.text);
    return text.includes("source field") && text.includes("destination field");
  });
  if (!header) return null;

  const sourceInfer = inferProfileTypeFromEvidence(`${sheet.name} Source`, `${sheet.name} Source`, evidence);
  const destinationInfer = inferProfileTypeFromEvidence(
    `${sheet.name} Destination`,
    `${sheet.name} Destination`,
    evidence,
  );
  const sourceProfile = fmdDraftProfileSchema.parse({
    name: `${sheet.name} Source`,
    role: "source",
    type: sourceInfer.type,
    format: sourceInfer.format,
    fields: [],
    confidence: 0.55,
    evidenceRefs: [header.evidenceRef],
  });
  const destinationProfile = fmdDraftProfileSchema.parse({
    name: `${sheet.name} Destination`,
    role: "destination",
    type: destinationInfer.type,
    format: destinationInfer.format,
    fields: [],
    confidence: 0.55,
    evidenceRefs: [header.evidenceRef],
  });
  const sourceFields = new Map<string, FmdDraftField>();
  const destinationFields = new Map<string, FmdDraftField>();
  const rules: FmdDraftMappingRule[] = [];

  for (const row of sheet.rows.filter((candidate) => candidate.rowIndex > header.rowIndex)) {
    const sourceName = pickCell(row.cells[1], row.cells[2]);
    const destinationName = pickCell(row.cells[6], row.cells[7]);
    if (!destinationName) continue;
    const sourceField = sourceName
      ? makeField({
          name: sourceName,
          parentPath: row.cells[0],
          description: row.cells[2],
          dataType: row.cells[3],
          evidenceRef: row.evidenceRef,
        })
      : undefined;
    const destinationField = makeField({
      name: destinationName,
      parentPath: row.cells[5],
      description: row.cells[7],
      dataType: row.cells[8],
      required: row.cells[9],
      evidenceRef: row.evidenceRef,
    });
    if (sourceField) upsertField(sourceFields, sourceField);
    upsertField(destinationFields, destinationField);
    rules.push({
      sourceProfileName: sourceProfile.name,
      destinationProfileName: destinationProfile.name,
      sourceFieldName: sourceField?.name,
      sourceParentPath: sourceField?.parentPath,
      destinationFieldName: destinationField.name,
      destinationParentPath: destinationField.parentPath,
      mappingType: sourceField ? "direct" : "function",
      expression: row.cells[4] || undefined,
      comment: row.cells[10] || undefined,
      confidence: 0.65,
      evidenceRefs: [row.evidenceRef],
    });
  }

  if (rules.length === 0) return null;
  sourceProfile.fields = [...sourceFields.values()].map((field, index) => ({ ...field, ordinal: index + 1 }));
  destinationProfile.fields = [...destinationFields.values()].map((field, index) => ({ ...field, ordinal: index + 1 }));

  return {
    profiles: [sourceProfile, destinationProfile],
    mappingSet: fmdDraftMappingSetSchema.parse({
      name: sheet.name,
      sourceProfileName: sourceProfile.name,
      destinationProfileName: destinationProfile.name,
      rules,
      confidence: 0.62,
      evidenceRefs: [header.evidenceRef],
      warnings: [],
      strategy: "generated" as const,
    }),
  };
}

function findGroupedHeader(sheet: FmdEvidenceSheet) {
  for (let index = 0; index < sheet.rows.length - 1; index += 1) {
    const groupRow = sheet.rows[index];
    const headerRow = sheet.rows[index + 1];
    // Require physical adjacency (at most one blank row between) so we don't pair distant rows
    // that happen to be sequential in the filtered evidence list.
    if (headerRow.rowIndex - groupRow.rowIndex > 2) continue;
    const groupText = normalizeForMatch(groupRow.text);
    const headerText = normalizeForMatch(headerRow.text);
    const hasSource = /source|送信元/.test(groupText);
    const hasDestination = /destination|target|送信先/.test(groupText);
    const hasFieldHeader = /item name|field name|項目名|明細項目|field\b/.test(headerText);
    const hasMappingHeader = /mapping|マッピング|transformation|変換/.test(groupText) || /mapping|transformation|変換/.test(headerText);
    if (hasSource && hasDestination && hasFieldHeader && hasMappingHeader) {
      const groups = buildColumnGroups(groupRow);
      if (groups.some((group) => group.type === "source") && groups.some((group) => group.type === "destination")) {
        return { groupRowIndex: groupRow.rowIndex, headerRowIndex: headerRow.rowIndex, groups };
      }
    }
  }
  return null;
}

function buildColumnGroups(groupRow: FmdEvidenceRow): ColumnGroup[] {
  const markers: Array<Omit<ColumnGroup, "end">> = [];
  let previousLabel = "";
  for (let column = 0; column < groupRow.cells.length; column += 1) {
    const raw = groupRow.cells[column]?.trim() ?? "";
    if (!raw || normalizeForMatch(raw) === normalizeForMatch(previousLabel)) continue;
    previousLabel = raw;
    const type = classifyGroupLabel(raw);
    if (!type) continue;
    markers.push({ type, start: column, label: raw });
  }

  return markers.map((marker, index) => ({
    ...marker,
    end: markers[index + 1]?.start ?? groupRow.cells.length,
  }));
}

function classifyGroupLabel(label: string): ColumnGroup["type"] | null {
  const normalized = normalizeForMatch(label);
  if (/comment|コメント/.test(normalized)) return "comment";
  if (/mapping|マッピング|transformation|変換仕様/.test(normalized)) return "mapping";
  if (/source|送信元/.test(normalized)) return "source";
  if (/destination|target|送信先/.test(normalized)) return "destination";
  return null;
}

function createProfileShell(
  sheet: FmdEvidenceSheet,
  group: ColumnGroup,
  groupRowIndex: number,
  headerRowIndex: number,
  role: Profile["role"],
  evidence: FmdWorkbookEvidence,
): FmdDraftProfile {
  const groupLabel = group.label;
  const systemName = findSystemName(sheet, group, groupRowIndex, headerRowIndex) ?? cleanProfileLabel(groupLabel);
  const baseText = `${systemName} ${groupLabel} ${sheet.name}`;
  const inferred = inferProfileTypeFromEvidence(systemName ?? "", baseText, evidence);
  return fmdDraftProfileSchema.parse({
    name: systemName || `${sheet.name} ${role}`,
    role,
    type: inferred.type,
    format: inferred.format,
    fields: [],
    confidence: systemName ? 0.68 : 0.48,
    evidenceRefs: [`${sheet.name}!R${groupRowIndex}`, `${sheet.name}!R${headerRowIndex}`],
  });
}

function findSystemName(
  sheet: FmdEvidenceSheet,
  group: ColumnGroup,
  groupRowIndex: number,
  headerRowIndex: number,
) {
  const labelCandidate = cleanProfileLabel(group.label);
  if (labelCandidate && !isGenericProfileLabel(labelCandidate)) return labelCandidate;

  const priorRows = sheet.rows
    .filter((row) => row.rowIndex < groupRowIndex && row.rowIndex >= Math.max(1, groupRowIndex - 8))
    .reverse();
  for (const row of priorRows) {
    if (/資料区分|プロセスID|プロセス名|最終更新|process id|process name|last update/i.test(row.cells[0] ?? "")) {
      continue;
    }
    for (let column = group.start; column < Math.min(group.end, row.cells.length); column += 1) {
      const value = row.cells[column]?.trim();
      if (!value) continue;
      const normalized = normalizeForMatch(value);
      if (
        /^(source|destination|target|送信元|送信先|content|設定内容|source\/source system|destination system)$/.test(normalized) ||
        value.length < 2
      ) {
        continue;
      }
      return cleanProfileLabel(value);
    }
  }

  const groupRow = sheet.rows.find((row) => row.rowIndex === groupRowIndex);
  const headerRow = sheet.rows.find((row) => row.rowIndex === headerRowIndex);
  const label = cleanProfileLabel(groupRow?.cells[group.start] ?? headerRow?.cells[group.start] ?? "");
  return label && !isGenericProfileLabel(label) ? label : undefined;
}

function extractFieldFromRow(
  row: FmdEvidenceRow,
  rows: FmdEvidenceRow[],
  headerRowIndex: number,
  group: ColumnGroup,
): FmdDraftField | null {
  const header = rows.find((candidate) => candidate.rowIndex === headerRowIndex);
  if (!header) return null;
  const parent = findColumnValue(row, header, group, [
    /parent structure/i,
    /parent node/i,
    /element/i,
    /data source/i,
    /データソース/,
    /レイアウト構造/,
  ]);
  const fieldName = findColumnValue(row, header, group, [
    /item name/i,
    /field name/i,
    /^field$/i,
    /明細項目/,
    /項目名/,
  ]);
  const description = findColumnValue(row, header, group, [/description/i, /説明/, /項目説明/]);
  const dataType = findColumnValue(row, header, group, [/data type/i, /^type/i, /タイプ/, /型/]);
  const length = findColumnValue(row, header, group, [/length/i, /quantity/i, /桁/, /項目長/]);
  const required = findColumnValue(row, header, group, [/required/i, /mandatory/i, /連携要否/, /必須/]);
  const key = findColumnValue(row, header, group, [/key/i, /キー/]);
  const format = findColumnValue(row, header, group, [/format/i, /フォーマット/]);
  const defaultValue = findColumnValue(row, header, group, [/default/i, /fixed/i, /固定値/]);
  const name = pickCell(fieldName, description);
  if (!name || isPlaceholder(name)) return null;

  return makeField({
    name,
    parentPath: parent,
    description,
    dataType,
    length,
    required,
    key,
    format,
    sample: defaultValue,
    evidenceRef: row.evidenceRef,
  });
}

function extractGroupText(
  row: FmdEvidenceRow,
  rows: FmdEvidenceRow[],
  headerRowIndex: number,
  group?: ColumnGroup,
) {
  if (!group) return "";
  const header = rows.find((candidate) => candidate.rowIndex === headerRowIndex);
  const preferred = header
    ? findColumnValue(row, header, group, [/description/i, /mapping/i, /transformation/i, /変換/, /説明/, /comment/i, /コメント/])
    : "";
  if (preferred) return preferred;
  return row.cells.slice(group.start, group.end).filter(Boolean).join(" ").trim();
}

function findColumnValue(
  row: FmdEvidenceRow,
  header: FmdEvidenceRow,
  group: ColumnGroup,
  patterns: RegExp[],
) {
  for (let column = group.start; column < Math.min(group.end, header.cells.length); column += 1) {
    const label = header.cells[column] ?? "";
    if (patterns.some((pattern) => pattern.test(label))) {
      return row.cells[column]?.trim() ?? "";
    }
  }
  return "";
}

function makeField(input: {
  name: string;
  parentPath?: string;
  label?: string;
  description?: string;
  dataType?: string;
  length?: string;
  required?: string;
  key?: string;
  format?: string;
  sample?: string;
  evidenceRef: string;
}): FmdDraftField {
  return fmdDraftFieldSchema.parse({
    name: cleanFieldName(input.name),
    parentPath: emptyToUndefined(input.parentPath),
    label: emptyToUndefined(input.label),
    description: emptyToUndefined(input.description),
    dataType: normalizeDataType(input.dataType),
    length: emptyToUndefined(input.length),
    required: parseRequiredFlag(input.required),
    keyField: parseKeyFlag(input.key),
    format: emptyToUndefined(input.format),
    sample: emptyToUndefined(input.sample),
    confidence: 0.72,
    evidenceRefs: [input.evidenceRef],
  });
}

function makeSyntheticDestinationField(row: FmdEvidenceRow, mappingText: string) {
  if (!mappingText) return null;
  return makeField({
    name: `derived_row_${row.rowIndex}`,
    description: mappingText.slice(0, 180),
    dataType: "String",
    evidenceRef: row.evidenceRef,
  });
}

function upsertField(fields: Map<string, FmdDraftField>, field: FmdDraftField) {
  const key = `${field.parentPath ?? ""}::${field.name}`.toLowerCase();
  const existing = fields.get(key);
  if (!existing) {
    fields.set(key, field);
    return;
  }
  fields.set(key, {
    ...existing,
    description: existing.description ?? field.description,
    dataType: existing.dataType === "String" ? field.dataType : existing.dataType,
    length: existing.length ?? field.length,
    required: existing.required || field.required,
    keyField: existing.keyField || field.keyField,
    confidence: Math.max(existing.confidence, field.confidence),
    evidenceRefs: [...new Set([...existing.evidenceRefs, ...field.evidenceRefs])],
  });
}

function mergeProfile(profiles: Map<string, FmdDraftProfile>, profile: FmdDraftProfile) {
  const key = `${profile.role}::${profile.name}`.toLowerCase();
  const existing = profiles.get(key);
  if (!existing) {
    profiles.set(key, profile);
    return;
  }
  const fields = new Map<string, FmdDraftField>();
  for (const field of existing.fields) upsertField(fields, field);
  for (const field of profile.fields) upsertField(fields, field);
  profiles.set(key, {
    ...existing,
    fields: [...fields.values()],
    confidence: Math.max(existing.confidence, profile.confidence),
    evidenceRefs: [...new Set([...existing.evidenceRefs, ...profile.evidenceRefs])],
  });
}

function sortProfileFields(profile: FmdDraftProfile): FmdDraftProfile {
  return {
    ...profile,
    fields: profile.fields.map((field, index) => ({ ...field, ordinal: index + 1 })),
  };
}

function refineProfileName(name: string, fields: FmdDraftField[], role: Profile["role"], sheetName: string) {
  const generic = isGenericProfileLabel(name) || name.length <= 3;
  if (!generic) return name;
  const parent = fields.find((field) => field.parentPath)?.parentPath;
  if (parent) return parent;
  const directional = profileNameFromSheetName(sheetName, role);
  if (directional) return directional;
  return `${sheetName} ${role}`;
}

function isGenericProfileLabel(value: string) {
  return /source|destination|target|送信元|送信先|unknown|flat file|tsv/i.test(value);
}

function profileNameFromSheetName(sheetName: string, role: Profile["role"]) {
  const arrowMatch = sheetName.match(/（?(.+?)→(.+?)[）)]?$/);
  if (!arrowMatch) return undefined;
  const value = role === "source" ? arrowMatch[1] : arrowMatch[2];
  return value?.trim().replace(/[）)]$/, "").slice(0, 240);
}

function inferMappingType(sourceName: string | undefined, mappingText: string, commentText: string): MappingRule["mappingType"] {
  const combined = normalizeForMatch(`${mappingText} ${commentText}`);
  if (/join|結合/.test(combined)) return "join";
  if (/lookup|master|マスタ|変換表|参照/.test(combined)) return "lookup";
  if (/fixed|constant|固定値|map constant|^['"`].*['"`]$/.test(combined) && !sourceName) return "constant";
  if (!sourceName && combined) return "function";
  if (/format|substring|calculate|算出|変換|logic|current date|unique id/.test(combined)) return "function";
  return "direct";
}

function extractConstantValue(text: string) {
  const quoted = text.match(/[“”"'`「『]([^“”"'`」』]+)[“”"'`」』]/);
  if (quoted?.[1]) return stripWrappingQuotes(quoted[1]);
  const fixed = text.match(/(?:fixed|constant|固定値|map constant)\s*[:：]?\s*(.+)$/i);
  return fixed?.[1] ? stripWrappingQuotes(fixed[1]) : undefined;
}

function stripWrappingQuotes(value: string) {
  return value.trim().replace(/^[\s“”"'`「『]+|[\s“”"'`」』]+$/g, "");
}

function extractProjectMetadata(evidence: FmdWorkbookEvidence): FmdImportDraft["project"] {
  const processId = findWorkbookValue(evidence, [/^process id$/i, /プロセスID/i]) ?? basenameProcessId(evidence.filename);
  const name = findWorkbookValue(evidence, [/^process name$/i, /プロセス名/i]) ?? cleanWorkbookName(evidence.filename);
  const owner =
    findWorkbookValue(evidence, [/最終更新者/i, /新規作成者/i, /^owner$/i]) ?? "Unassigned";
  const description =
    findWorkbookValue(evidence, [/^概要$/i, /overview/i, /select condition/i, /要件/i]) ?? "";
  const schedule = findScheduleValue(evidence) ?? findWorkbookValue(evidence, [/ジョブスケジュール/i, /連携スケジュール/i, /schedule/i]);
  const integrationPattern = inferIntegrationPattern(evidence);
  const sourceSystem =
    findWorkbookValue(evidence, [/連携元システム1/i, /source system/i, /source\/source system/i]) ??
    inferSystemFromMapping(evidence, "source") ??
    "Unknown source";
  const destinationSystem =
    findWorkbookValue(evidence, [/連携先システム1/i, /destination system/i]) ??
    inferSystemFromMapping(evidence, "destination") ??
    "Unknown destination";

  return {
    processId,
    name,
    description,
    sourceSystem,
    destinationSystem,
    integrationPattern,
    owner,
    schedule,
    status: "Draft",
    confidence: processId && name ? 0.72 : 0.45,
    evidenceRefs: collectKeyEvidenceRefs(evidence, [/プロセスID|process id/i, /プロセス名|process name/i]).slice(0, 8),
  };
}

function inferIntegrationPattern(evidence: FmdWorkbookEvidence) {
  const text = normalizeForMatch(
    evidence.sheets
      .filter((sheet) => ["overview", "environment", "explanation", "fieldMapping"].includes(sheet.role))
      .flatMap((sheet) => sheet.rows.slice(0, 40).map((row) => row.text))
      .join(" "),
  );
  if (/webhook|event|queue|topic|jms|kafka/.test(text)) return "event-driven";
  if (/rest|soap|http|api|endpoint|url|エンドポイント/.test(text)) return "api";
  if (/database|jdbc|sql|table|テーブル|db\b/.test(text)) return "database-sync";
  if (/master|マスタ|lookup|参照/.test(text)) return "master-data-sync";
  if (/etl|data warehouse|warehouse|dwh/.test(text)) return "etl";
  if (/sftp|ftp|file|csv|tsv|固定長|ファイル|batch|daily|日次/.test(text)) return "batch-file";
  return undefined;
}

const workbookMetadataHeaderPatterns = [
  /^process id$/i,
  /^process name$/i,
  /^owner$/i,
  /^schedule$/i,
  /^overview$/i,
  /^version$/i,
  /^revision$/i,
  /^date$/i,
  /^name$/i,
  /プロセスID/i,
  /プロセス名/i,
  /新規作成日/i,
  /最終更新日/i,
  /新規作成者/i,
  /最終更新者/i,
  /ジョブスケジュール/i,
  /連携スケジュール/i,
  /連携元システム/i,
  /連携先システム/i,
  /概要/i,
  /変更内容/i,
  /nature of change/i,
  /source system/i,
  /destination system/i,
];

function isLikelyWorkbookHeader(value: string, labels: RegExp[]) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return labels.some((label) => label.test(trimmed)) || workbookMetadataHeaderPatterns.some((label) => label.test(trimmed));
}

function findWorkbookValue(evidence: FmdWorkbookEvidence, labels: RegExp[]) {
  for (const sheet of evidence.sheets) {
    for (const row of sheet.rows) {
      for (let column = 0; column < row.cells.length; column += 1) {
        const cell = row.cells[column]?.trim();
        if (!cell || !labels.some((label) => label.test(cell))) continue;

        // Same-row search: walk every cell to the right, not just the first non-empty.
        // Japanese FMDs frequently sandwich a header row between empty cells and the
        // real value, e.g., [プロセスID, "", "", ABC123].
        for (const candidate of row.cells.slice(column + 1)) {
          const trimmed = candidate.trim();
          if (!trimmed) continue;
          if (!isLikelyWorkbookHeader(trimmed, labels)) return trimmed;
        }

        // Below-row search: walk up to 6 successive rows in the same column, skipping
        // header-looking values. Previously stopped at the FIRST row below, which
        // produced `processId: "プロセス名"` when labels stacked vertically.
        const rowIndexOf = sheet.rows.indexOf(row);
        for (const nextRow of sheet.rows.slice(rowIndexOf + 1, rowIndexOf + 7)) {
          if (nextRow.rowIndex - row.rowIndex > 8) break;
          const below = nextRow.cells[column]?.trim();
          if (!below) continue;
          if (isLikelyWorkbookHeader(below, labels)) continue;
          return below;
        }
      }
    }
  }
  return undefined;
}

function findScheduleValue(evidence: FmdWorkbookEvidence) {
  const labels = [/ジョブスケジュール/i, /連携スケジュール/i, /^schedule$/i];
  for (const sheet of evidence.sheets.filter((candidate) => candidate.role !== "documentLog")) {
    for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex += 1) {
      const row = sheet.rows[rowIndex];
      const labelColumn = row.cells.findIndex((cell) => labels.some((label) => label.test(cell ?? "")));
      if (labelColumn === -1) continue;

      const sameRow = row.cells.slice(labelColumn + 1).find((value) => value.trim());
      if (sameRow && !labels.some((label) => label.test(sameRow))) return sameRow.trim();

      for (const nextRow of sheet.rows.slice(rowIndex + 1, rowIndex + 4)) {
        if (nextRow.rowIndex - row.rowIndex > 4) break;
        const nearby = nextRow.cells
          .slice(labelColumn, Math.min(nextRow.cells.length, labelColumn + 3))
          .find((value) => value.trim() && !labels.some((label) => label.test(value)));
        if (nearby) return nearby.trim();
      }
    }
  }
  return undefined;
}

function collectKeyEvidenceRefs(evidence: FmdWorkbookEvidence, labels: RegExp[]) {
  const refs: string[] = [];
  for (const sheet of evidence.sheets) {
    for (const row of sheet.rows) {
      if (labels.some((label) => label.test(row.text))) refs.push(row.evidenceRef);
    }
  }
  return refs;
}

function inferSystemFromMapping(evidence: FmdWorkbookEvidence, role: Profile["role"]) {
  for (const sheet of evidence.sheets.filter((candidate) => candidate.role === "fieldMapping")) {
    const header = findGroupedHeader(sheet);
    if (!header) continue;
    const group = header.groups.find((candidate) => candidate.type === role);
    if (!group) continue;
    const system = findSystemName(sheet, group, header.groupRowIndex, header.headerRowIndex);
    if (system) return system;
  }
  return undefined;
}

export const __testInferProfileTypeFromEvidence = inferProfileTypeFromEvidence;

function sheetToSection(sheet: FmdEvidenceSheet, index: number): z.infer<typeof fmdDraftSectionSchema> {
  return fmdDraftSectionSchema.parse({
    title: sheet.name,
    sectionType: sheet.role,
    sortOrder: index + 1,
    content: {
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      headers: sheet.headers,
      excerpt: sheet.rows.slice(0, 12).map((row) => ({ ref: row.evidenceRef, text: row.text.slice(0, 900) })),
    },
    confidence: 0.66,
    evidenceRefs: sheet.rows.slice(0, 6).map((row) => row.evidenceRef),
  });
}

function extractEndpoints(evidence: FmdWorkbookEvidence) {
  const endpoints: Array<z.infer<typeof fmdDraftEndpointSchema>> = [];
  for (const sheet of evidence.sheets.filter((candidate) => candidate.role === "environment")) {
    const method = findEnvironmentValue(sheet, [/api\s*タイプ/i, /^method$/i, /メソッド/i]);
    const apiName = findEnvironmentValue(sheet, [/api\s*名前/i, /^api name$/i]);
    const overview = findEnvironmentValue(sheet, [/^概要$/i, /overview/i, /要件/i]);

    for (let index = 0; index < sheet.rows.length; index += 1) {
      const row = sheet.rows[index];
      if (!isEndpointSectionLabel(row)) continue;
      for (const endpointRow of sheet.rows.slice(index + 1)) {
        if (endpointRow.rowIndex - row.rowIndex > 40 || isEndpointSectionTerminator(endpointRow)) break;
        const parsed = endpointFromEnvironmentRow(endpointRow, { method, apiName, overview });
        if (parsed) endpoints.push(parsed);
      }
    }

    const header = sheet.rows.find(looksLikeEndpointTableHeader);
    if (!header) continue;
    for (const row of sheet.rows.filter((candidate) => candidate.rowIndex > header.rowIndex)) {
      if (isNoiseRow(row) || isEndpointSectionTerminator(row)) continue;
      const name = findLooseColumn(row, header, [/endpoint|エンドポイント|接続先/i]) ?? row.cells[1] ?? row.cells[0];
      if (!name || isPlaceholder(name)) continue;
      const purpose = findLooseColumn(row, header, [/purpose|用途|概要/i]) ?? "";
      const connectorType = findLooseColumn(row, header, [/connector type|コネクタータイプ|メソッド/i]) ?? "Unknown";
      const profileType = findLooseColumn(row, header, [/profile type|プロファイルタイプ/i]) ?? "Unknown";
      const connectionInfo = findLooseColumn(row, header, [/connection|接続情報|url|endpoint|値/i]) ?? "";
      const format = findLooseColumn(row, header, [/format|形式/i]) ?? profileType;
      endpoints.push(
        fmdDraftEndpointSchema.parse({
          name: name.slice(0, 220),
          role: inferEndpointRole(name, purpose),
          connectorType: connectorType.slice(0, 220),
          profileType: profileType.slice(0, 160),
          format: (format || "Unknown").slice(0, 160),
          purpose: purpose.slice(0, 1200),
          connectionInfo: connectionInfo.slice(0, 2200),
          confidence: 0.58,
          evidenceRefs: [row.evidenceRef],
        }),
      );
    }
  }
  return dedupeBy(endpoints, (endpoint) => `${endpoint.role}::${endpoint.name}`);
}

function looksLikeEndpointTableHeader(row: FmdEvidenceRow) {
  if (isEndpointSectionLabel(row)) return false;
  const populated = row.cells.filter((cell) => cell.trim());
  if (populated.length < 2) return false;
  const text = normalizeForMatch(row.text);
  return (
    /endpoint|エンドポイント|接続先|connector|コネクター/.test(text) &&
    /connection|接続情報|url|値|purpose|用途|概要|method|メソッド|format|形式|profile/.test(text)
  );
}

function findEnvironmentValue(sheet: FmdEvidenceSheet, labels: RegExp[]) {
  for (const row of sheet.rows) {
    for (let column = 0; column < row.cells.length; column += 1) {
      const cell = row.cells[column] ?? "";
      if (!labels.some((label) => label.test(cell))) continue;
      return row.cells.slice(column + 1).find((value) => value.trim())?.trim();
    }
  }
  return undefined;
}

function isEndpointSectionLabel(row: FmdEvidenceRow) {
  const populated = row.cells.filter((cell) => cell.trim());
  if (populated.length > 2) return false;
  return populated.some((cell) => /^(endpoints?|エンドポイント|接続先)$/i.test(cell.trim()));
}

function isEndpointSectionTerminator(row: FmdEvidenceRow) {
  const text = normalizeForMatch(row.text);
  if (!text) return true;
  if (/sample|サンプルコード|code sample|request headers|query parameters|path parameters|基本情報|api要件/.test(text)) {
    return true;
  }
  return false;
}

function endpointFromEnvironmentRow(
  row: FmdEvidenceRow,
  context: { method?: string; apiName?: string; overview?: string },
) {
  if (isNoiseRow(row)) return null;
  const populated = row.cells.map((cell) => cell.trim()).filter(Boolean);
  if (populated.length < 2) return null;

  const connectionInfo = populated.find((cell) => /^https?:\/\//i.test(cell)) ?? "";
  if (!connectionInfo) return null;

  const name = populated.find((cell) => cell !== connectionInfo) ?? row.cells[0];
  if (!name || isPlaceholder(name)) return null;
  const method = context.method?.trim().toUpperCase();
  const connectorType = method ? `HTTP ${method}` : "HTTP";
  const format = inferEndpointFormat(connectionInfo, context);
  const purpose = joinNonEmpty([context.apiName ?? "", context.overview ?? ""]);

  return fmdDraftEndpointSchema.parse({
    name: name.slice(0, 220),
    role: inferEndpointRole(`${name} ${connectionInfo}`, `${purpose} ${method ?? ""}`),
    connectorType,
    profileType: "API",
    format,
    purpose: purpose.slice(0, 1200),
    connectionInfo: connectionInfo.slice(0, 2200),
    confidence: 0.72,
    evidenceRefs: [row.evidenceRef],
  });
}

function inferEndpointFormat(connectionInfo: string, context: { method?: string; apiName?: string; overview?: string }) {
  const text = normalizeForMatch(`${connectionInfo} ${context.apiName ?? ""} ${context.overview ?? ""}`);
  if (/xml|soap/.test(text)) return "XML";
  return "JSON";
}

function findLooseColumn(row: FmdEvidenceRow, header: FmdEvidenceRow, patterns: RegExp[]) {
  for (let column = 0; column < header.cells.length; column += 1) {
    if (patterns.some((pattern) => pattern.test(header.cells[column] ?? ""))) {
      const value = row.cells[column]?.trim();
      if (value) return value;
    }
  }
  return undefined;
}

function inferEndpointRole(name: string, purpose: string): Endpoint["role"] {
  const value = normalizeForMatch(`${name} ${purpose}`);
  if (/mail|notification|通知/.test(value)) return "notification";
  if (/destination|target|送信先|登録|post|put/.test(value)) return "destination";
  if (/source|送信元|取得|get|read|input/.test(value)) return "source";
  return "reference";
}

function inferProfileTypeAndFormat(text: string): Pick<Profile, "type" | "format"> {
  const value = normalizeForMatch(text);
  if (/json|odata|rest|api/.test(value)) return { type: /api|odata|rest/.test(value) ? "API" : "JSON", format: "JSON" };
  if (/xml|soap/.test(value)) return { type: "XML", format: "XML" };
  if (/tsv|tab/.test(value)) return { type: "Flat File", format: "TSV" };
  if (/csv/.test(value)) return { type: "Flat File", format: "CSV" };
  if (/database|table|テーブル/.test(value)) return { type: "Database", format: "Table" };
  return { type: "Flat File", format: "Unknown" };
}

function inferProfileTypeFromEvidence(
  systemName: string,
  baseText: string,
  evidence: FmdWorkbookEvidence,
): Pick<Profile, "type" | "format"> {
  const lowerName = systemName.toLowerCase().trim();
  const compactName = compactForEvidenceMatch(systemName);
  const contextTexts: string[] = [];
  if (lowerName.length >= 2) {
    for (const sheet of evidence.sheets) {
      if (!["environment", "overview", "fieldMapping", "explanation", "documentLog"].includes(sheet.role)) continue;
      for (const row of sheet.rows) {
        const text = row.text.toLowerCase();
        const compactText = compactForEvidenceMatch(row.text);
        if (text.includes(lowerName) || (compactName.length >= 2 && compactText.includes(compactName))) {
          contextTexts.push(text);
          if (contextTexts.length >= 40) break;
        }
      }
      if (contextTexts.length >= 40) break;
    }
  }
  const blob = `${baseText} ${contextTexts.join(" ")}`.toLowerCase();

  // File-extension hints win first. In multi-system FMDs the environment/overview rows
  // typically describe many systems together; the explicit filename (`.tsv`, `.json`, ...)
  // is the most specific signal that THIS system uses a file-based payload.
  const extensionMatch = blob.match(/\.(tsv|csv|jsonl?|xml|xlsx|xls|parquet)\b/);
  if (extensionMatch) {
    const ext = extensionMatch[1];
    if (ext === "tsv") return { type: "Flat File", format: "TSV" };
    if (ext === "csv") return { type: "Flat File", format: "CSV" };
    if (ext === "json" || ext === "jsonl") return { type: "JSON", format: "JSON" };
    if (ext === "xml") return { type: "XML", format: "XML" };
    if (ext === "xlsx" || ext === "xls") return { type: "Flat File", format: "XLSX" };
    if (ext === "parquet") return { type: "Database", format: "Parquet" };
  }

  if (/rest api|rest\b|odata|graph api|http client/.test(blob) || contextTexts.some((text) => hasSystemApiUrl(text, compactName))) {
    return { type: "API", format: "JSON" };
  }
  if (/soap|wsdl/.test(blob)) return { type: "API", format: "XML" };
  if (/database|jdbc|oracle\b|sql server|postgres|mysql|テーブル/.test(blob)) return { type: "Database", format: "Table" };

  if (/sftp|ftp|file share|sharepoint/.test(blob)) {
    if (/json/.test(blob)) return { type: "Flat File", format: "JSON" };
    if (/xml/.test(blob)) return { type: "Flat File", format: "XML" };
  }

  return inferProfileTypeAndFormat(baseText);
}

function normalizeDataType(value?: string) {
  const text = value?.trim();
  if (!text) return "String";
  if (/date|日時|日付/i.test(text)) return "Date";
  if (/decimal|number|numeric|amount|price|金額|数量/i.test(text)) return "Decimal";
  if (/int|integer/i.test(text)) return "Integer";
  if (/bool|boolean|true|false/i.test(text)) return "Boolean";
  if (/char|string|varchar|text|文字|型/i.test(text)) return "String";
  return text.slice(0, 120);
}

function parseRequiredFlag(value?: string) {
  if (!value) return false;
  return /mandatory|required|yes|true|y|〇|○|必須|連携/i.test(value) && !/not required|optional|任意|不要/i.test(value);
}

function parseKeyFlag(value?: string) {
  if (!value) return false;
  return /mandatory|required|yes|true|y|〇|○|必須|連携|key|キー|^pk$/i.test(value) && !/not required|optional|任意|不要/i.test(value);
}

function isNoiseRow(row: FmdEvidenceRow) {
  const text = normalizeForMatch(row.text);
  if (!text) return true;
  if (/^#?\s*$/.test(text)) return true;
  if (/document log|資料区分|プロセスID|プロセス名|最終更新|source\/source system|destination system/.test(text)) {
    return true;
  }
  return false;
}

function isPlaceholder(value: string) {
  const normalized = normalizeForMatch(value);
  return (
    !normalized ||
    normalized === "-" ||
    /^n\/a$/.test(normalized) ||
    /^(item name|field name|項目名|明細項目|field)$/.test(normalized)
  );
}

function pickCell(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim() && !isPlaceholder(value))?.trim() ?? "";
}

function joinNonEmpty(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean).join(" | ");
}

function emptyToUndefined(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cleanFieldName(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 220);
}

function cleanProfileLabel(value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  const paren = trimmed.match(/[（(]([^（）()]+)[）)]/);
  return (paren?.[1] ?? trimmed)
    .replace(/^★/, "")
    .replace(/^(source|destination|target|送信元|送信先)\s*[:：-]?\s*/i, "")
    .trim()
    .slice(0, 240);
}

function normalizeForMatch(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function compactForEvidenceMatch(value: string) {
  return normalizeForMatch(value).replace(/[^a-z0-9ぁ-んァ-ヶ一-龯々ー]/g, "");
}

function hasSystemApiUrl(text: string, compactSystemName: string) {
  if (compactSystemName.length < 2) return false;
  const urls = text.match(/https?:\/\/\S+/gi) ?? [];
  return urls.some((url) => url.toLowerCase().includes("/api/") && compactForEvidenceMatch(url).includes(compactSystemName));
}

function detectRole(name: string): FmdSheetRole {
  return roleMatchers.find(([, pattern]) => pattern.test(name))?.[0] ?? "reference";
}

function extractHeaders(rows: string[][]) {
  const candidate = rows
    .slice(0, 18)
    .find((row) => row.filter((cell) => String(cell ?? "").trim()).length >= 3);
  return (candidate ?? [])
    .map((cell) => String(cell ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 16);
}

function normalizeCellValue(value: ExcelJS.CellValue): RowValue {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== "object") return value;
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join("");
  }
  if ("formula" in value) {
    const formulaValue = value as ExcelJS.CellFormulaValue;
    return formulaValue.result == null ? `=${formulaValue.formula}` : String(formulaValue.result);
  }
  if ("result" in value) return String(value.result ?? "");
  return String(value);
}

function trimTrailingEmptyCells(values: string[]) {
  const copy = [...values];
  while (copy.length > 0 && !copy[copy.length - 1]?.trim()) {
    copy.pop();
  }
  return copy;
}

function redactSensitive(value: string, maxLength: number) {
  let redacted = false;
  let next = value;
  const simpleReplacements: Array<[RegExp, string]> = [
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]"],
    [/\b(?:api[-_ ]?key|token|password|secret|authorization|bearer)\s*[:=]\s*\S+/gi, "[SECRET]"],
    [/\beyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[JWT]"],
  ];
  for (const [pattern, replacement] of simpleReplacements) {
    next = next.replace(pattern, () => {
      redacted = true;
      return replacement;
    });
  }
  // Long-secret heuristic: 120+ contiguous base64-like chars containing BOTH letters and digits.
  // The composition requirement avoids redacting long alphabetic/numeric-only strings (Japanese
  // romanization, hex dumps, sequential IDs, etc.) while still catching real high-entropy tokens.
  next = next.replace(/\b[A-Za-z0-9+/=_-]{120,}\b/g, (match) => {
    if (/[A-Za-z]/.test(match) && /\d/.test(match)) {
      redacted = true;
      return "[LONG_SECRET]";
    }
    return match;
  });
  if (next.length > maxLength) {
    next = `${next.slice(0, maxLength)}…`;
  }
  return { value: next.replace(/\s+/g, " ").trim(), redacted };
}

function cleanWorkbookName(filename: string) {
  return filename.replace(/\.[^.]+$/, "").split(/[\\/]/).pop() ?? filename;
}

function basenameProcessId(filename: string) {
  const name = cleanWorkbookName(filename);
  const candidate = name.match(/[A-Z]{2,}[A-Z0-9_-]*\d{2,}/i)?.[0];
  return candidate ?? name.slice(0, 64);
}

function dedupeBy<T>(items: T[], keyFn: (item: T) => string) {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = keyFn(item).toLowerCase();
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

export function draftToProjectPreview(currentProject: Project, draft: FmdImportDraft): Project {
  const previewProfiles = draft.profiles.map((profile, profileIndex) => ({
    id: `draft-profile-${profileIndex + 1}`,
    name: profile.name,
    role: profile.role,
    type: profile.type,
    format: profile.format,
    rootPath: profile.rootPath,
    fields: profile.fields.map((field, fieldIndex) => ({
      id: `draft-field-${profileIndex + 1}-${fieldIndex + 1}`,
      parentPath: field.parentPath,
      name: field.name,
      label: field.label,
      description: field.description,
      dataType: field.dataType,
      length: field.length,
      required: field.required,
      keyField: field.keyField,
      format: field.format,
      sample: field.sample,
      ordinal: field.ordinal || fieldIndex + 1,
    })),
  }));

  const profileIdByKey = new Map<string, string>();
  const fieldIdByKey = new Map<string, string>();
  const nameKey = (value: string) => value.toLowerCase().trim();
  for (const profile of previewProfiles) {
    profileIdByKey.set(`${profile.role}::${nameKey(profile.name)}`, profile.id);
    for (const field of profile.fields) {
      fieldIdByKey.set(`${profile.id}::${nameKey(field.name)}`, field.id);
    }
  }

  const previewMappingSets = draft.mappingSets.map((mappingSet, mappingSetIndex) => {
    const sourceProfileId =
      profileIdByKey.get(`source::${nameKey(mappingSet.sourceProfileName)}`) ?? "";
    const destinationProfileId =
      profileIdByKey.get(`destination::${nameKey(mappingSet.destinationProfileName)}`) ?? "";
    return {
      id: `draft-mapping-set-${mappingSetIndex + 1}`,
      name: mappingSet.name,
      sourceProfileId,
      destinationProfileId,
      direction: mappingSet.direction,
      status: mappingSet.status,
      rules: mappingSet.rules.map((rule, ruleIndex) => {
        const sourceFieldId = rule.sourceFieldName
          ? fieldIdByKey.get(`${sourceProfileId}::${nameKey(rule.sourceFieldName)}`)
          : undefined;
        const destinationFieldId =
          fieldIdByKey.get(`${destinationProfileId}::${nameKey(rule.destinationFieldName)}`) ?? "";
        return {
          id: `draft-rule-${mappingSetIndex + 1}-${ruleIndex + 1}`,
          sourceFieldId,
          destinationFieldId,
          mappingType: rule.mappingType,
          expression: rule.expression,
          defaultValue: rule.defaultValue,
          comment: rule.comment,
          qualityStatus: "unchecked" as const,
        };
      }),
      transformNodes: [],
    };
  });

  const previewProcessFlows = draft.processFlows.map((flow, flowIndex) => ({
    id: `draft-flow-${flowIndex + 1}`,
    name: flow.name,
    nodes: flow.nodes,
    edges: flow.edges,
    notes: flow.notes,
  }));

  return {
    ...currentProject,
    processId: draft.project.processId || currentProject.processId,
    name: draft.project.name || currentProject.name,
    description: draft.project.description || currentProject.description,
    sourceSystem: draft.project.sourceSystem || currentProject.sourceSystem,
    destinationSystem: draft.project.destinationSystem || currentProject.destinationSystem,
    owner: draft.project.owner || currentProject.owner,
    schedule: draft.project.schedule ?? currentProject.schedule,
    endpoints: draft.endpoints.map((endpoint, index) => ({
      id: `draft-endpoint-${index + 1}`,
      name: endpoint.name,
      role: endpoint.role,
      connectorType: endpoint.connectorType,
      profileType: endpoint.profileType,
      format: endpoint.format,
      purpose: endpoint.purpose,
      connectionInfo: endpoint.connectionInfo,
    })),
    profiles: previewProfiles,
    mappingSets: previewMappingSets,
    processFlows: previewProcessFlows.length > 0 ? previewProcessFlows : currentProject.processFlows,
    fmdSections: draft.fmdSections.map((section, index): FmdSection => ({
      id: `draft-section-${index + 1}`,
      title: section.title,
      sectionType: section.sectionType,
      content: section.content,
      sortOrder: section.sortOrder,
    })),
  };
}
