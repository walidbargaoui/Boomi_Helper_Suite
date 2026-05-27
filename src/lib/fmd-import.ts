import ExcelJS from "exceljs";
import { z } from "zod";
import crypto from "crypto";
import type { Endpoint, FmdSection, MappingRule, Profile, Project } from "@/lib/domain";
import type { NormalizedFmdWorkbook } from "@/lib/fmd";
import { lookupCache, storeCache } from "./fmd-resolver-cache";

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

const confidenceSchema = z.coerce.number().min(0).max(1).default(0.5);
const evidenceRefsSchema = z.array(z.string().min(1).max(100)).default([]);

export const fmdDraftFieldSchema = z.object({
  name: z.string().min(1).max(220),
  parentPath: z.string().max(500).optional(),
  label: z.string().max(220).optional(),
  description: z.string().max(1200).optional(),
  dataType: z.string().min(1).max(120).default("String"),
  length: z.string().max(120).optional(),
  required: z.boolean().default(false),
  keyField: z.boolean().default(false),
  format: z.string().max(160).optional(),
  sample: z.string().max(600).optional(),
  ordinal: z.number().int().min(0).default(0),
  confidence: confidenceSchema,
  evidenceRefs: evidenceRefsSchema,
});

export const fmdDraftProfileSchema = z.object({
  name: z.string().min(1).max(240),
  role: z.enum(["source", "destination"]),
  type: z.enum(["Flat File", "JSON", "XML", "Database", "API"]).default("Flat File"),
  format: z.string().min(1).max(160).default("Unknown"),
  rootPath: z.string().max(500).optional(),
  fields: z.array(fmdDraftFieldSchema).default([]),
  confidence: confidenceSchema,
  evidenceRefs: evidenceRefsSchema,
});

export const fmdDraftMappingRuleSchema = z.object({
  sourceProfileName: z.string().max(240).optional(),
  destinationProfileName: z.string().max(240).optional(),
  sourceFieldName: z.string().max(220).optional(),
  sourceParentPath: z.string().max(500).optional(),
  destinationFieldName: z.string().min(1).max(220),
  destinationParentPath: z.string().max(500).optional(),
  mappingType: z.enum(["direct", "constant", "lookup", "function", "join"]).default("direct"),
  expression: z.string().max(2000).optional(),
  defaultValue: z.string().max(1000).optional(),
  comment: z.string().max(2000).optional(),
  confidence: confidenceSchema,
  evidenceRefs: evidenceRefsSchema,
});

export const fmdParserStrategySchema = z.enum(["grouped", "generated"]);
export type FmdParserStrategy = z.infer<typeof fmdParserStrategySchema>;

export const fmdDraftMappingSetSchema = z.object({
  name: z.string().min(1).max(240),
  sourceProfileName: z.string().min(1).max(240),
  destinationProfileName: z.string().min(1).max(240),
  direction: z.string().max(240).default("source-to-destination"),
  status: z.enum(["Draft", "Validated", "Ready for Boomi"]).default("Draft"),
  rules: z.array(fmdDraftMappingRuleSchema).default([]),
  confidence: confidenceSchema,
  evidenceRefs: evidenceRefsSchema,
  warnings: z.array(z.string().max(500)).default([]),
  strategy: fmdParserStrategySchema.optional(),
});

export const fmdDraftEndpointSchema = z.object({
  name: z.string().min(1).max(220),
  role: z.enum(["source", "destination", "notification", "reference"]).default("reference"),
  connectorType: z.string().max(220).default("Unknown"),
  profileType: z.string().max(160).default("Unknown"),
  format: z.string().max(160).default("Unknown"),
  purpose: z.string().max(1200).default(""),
  connectionInfo: z.string().max(2200).default(""),
  confidence: confidenceSchema,
  evidenceRefs: evidenceRefsSchema,
});

export const fmdDraftSectionSchema = z.object({
  title: z.string().min(1).max(240),
  sectionType: z.enum([
    "documentLog",
    "explanation",
    "overview",
    "fieldMapping",
    "environment",
    "jobHandling",
    "sample",
    "reference",
  ]),
  sortOrder: z.number().int().min(0).default(0),
  content: z.record(z.string(), z.unknown()).default({}),
  confidence: confidenceSchema,
  evidenceRefs: evidenceRefsSchema,
});

export const fmdImportDraftSchema = z.object({
  project: z.object({
    processId: z.string().min(1).max(120),
    name: z.string().min(1).max(240),
    description: z.string().max(3000).default(""),
    sourceSystem: z.string().max(180).default("Unknown source"),
    destinationSystem: z.string().max(180).default("Unknown destination"),
    owner: z.string().max(160).default("Unassigned"),
    schedule: z.string().max(240).optional(),
    status: z.enum(["Draft", "Mapping Review", "Ready for Sandbox", "Published"]).default("Draft"),
    confidence: confidenceSchema,
    evidenceRefs: evidenceRefsSchema,
  }),
  endpoints: z.array(fmdDraftEndpointSchema).default([]),
  profiles: z.array(fmdDraftProfileSchema).default([]),
  mappingSets: z.array(fmdDraftMappingSetSchema).default([]),
  fmdSections: z.array(fmdDraftSectionSchema).default([]),
  warnings: z.array(z.string().max(700)).default([]),
  unresolvedEvidenceRefs: evidenceRefsSchema,
});

export type FmdImportDraft = z.infer<typeof fmdImportDraftSchema>;
export type FmdDraftProfile = z.infer<typeof fmdDraftProfileSchema>;
export type FmdDraftField = z.infer<typeof fmdDraftFieldSchema>;
export type FmdDraftMappingSet = z.infer<typeof fmdDraftMappingSetSchema>;
export type FmdDraftMappingRule = z.infer<typeof fmdDraftMappingRuleSchema>;

const fmdAiResolutionSchema = z.object({
  project: fmdImportDraftSchema.shape.project.partial().optional(),
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
  warnings: z.array(z.string().max(700)).default([]),
  unresolvedEvidenceRefs: evidenceRefsSchema,
});

type FmdAiResolution = z.infer<typeof fmdAiResolutionSchema>;

export type FmdResolverStatus = {
  provider: "deterministic" | "ollama";
  model: string;
  baseUrl?: string;
  ok: boolean;
  message: string;
  durationMs: number;
};

export type FmdResolveResponse = {
  summary: NormalizedFmdWorkbook;
  draft: FmdImportDraft;
  resolver: FmdResolverStatus;
  debug?: {
    promptText?: string;
    rawLlmResponse?: string;
  };
};

type ExtractOptions = {
  maxRowsPerSheet?: number;
  maxColumnsPerSheet?: number;
  maxCellLength?: number;
};

type OllamaResolveOptions = {
  useLlm?: boolean;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
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

export { clearResolverCache } from "./fmd-resolver-cache";

function getWorkbookHash(buffer: Buffer | ArrayBuffer, options: OllamaResolveOptions = {}): string {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const relevantOptions = JSON.stringify({
    model: options.model ?? process.env.BOOMI_HELPER_OLLAMA_MODEL ?? defaultOllamaModel,
    baseUrl: options.baseUrl ?? process.env.BOOMI_HELPER_OLLAMA_URL ?? defaultOllamaBaseUrl,
  });
  return crypto.createHash("sha256").update(buf).update(relevantOptions).digest("hex");
}

const ollamaResolutionFormat = {
  type: "object",
  properties: {
    project: {
      type: "object",
      properties: {
        processId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        sourceSystem: { type: "string" },
        destinationSystem: { type: "string" },
        owner: { type: "string" },
        schedule: { type: "string" },
        status: { type: "string", enum: ["Draft", "Mapping Review", "Ready for Sandbox", "Published"] },
        confidence: { type: "number" },
        evidenceRefs: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
    profileRenames: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["source", "destination"] },
          currentName: { type: "string" },
          proposedName: { type: "string" },
          confidence: { type: "number" },
          evidenceRefs: { type: "array", items: { type: "string" } },
        },
        required: ["role", "currentName", "proposedName", "confidence", "evidenceRefs"],
        additionalProperties: false,
      },
    },
    mappingSetNotes: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        properties: {
          mappingSetName: { type: "string" },
          note: { type: "string" },
          confidence: { type: "number" },
          evidenceRefs: { type: "array", items: { type: "string" } },
        },
        required: ["mappingSetName", "note", "confidence", "evidenceRefs"],
        additionalProperties: false,
      },
    },
    warnings: { type: "array", maxItems: 2, items: { type: "string" } },
    unresolvedEvidenceRefs: { type: "array", maxItems: 4, items: { type: "string" } },
  },
  required: ["profileRenames", "mappingSetNotes", "warnings", "unresolvedEvidenceRefs"],
  additionalProperties: false,
} as const;

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
  options: OllamaResolveOptions = {},
): Promise<FmdResolveResponse> {
  const workbookHash = getWorkbookHash(buffer, options);
  const cached = options.useLlm !== false ? lookupCache(workbookHash) as FmdResolveResponse | null : null;
  if (cached) return cached;

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
      },
    };
  } else {
    result = await resolveWithOllama(evidence, deterministicDraft, options)
      .then((ollamaResult) => ({ summary, draft: ollamaResult.draft, resolver: ollamaResult.resolver, debug: ollamaResult.debug }))
      .catch((error): FmdResolveResponse => ({
        summary,
        draft: {
          ...deterministicDraft,
          warnings: [
            ...deterministicDraft.warnings,
            `Qwen3-8B resolver unavailable; deterministic fallback used. ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          ],
        },
        resolver: {
          provider: "deterministic" as const,
          model: options.model ?? process.env.BOOMI_HELPER_OLLAMA_MODEL ?? defaultOllamaModel,
          baseUrl: options.baseUrl ?? process.env.BOOMI_HELPER_OLLAMA_URL ?? defaultOllamaBaseUrl,
          ok: false,
          message: error instanceof Error ? error.message : "Qwen3-8B resolver failed.",
          durationMs: 0,
        },
      }));
  }

  if (result.resolver.provider === "ollama") storeCache(workbookHash, result);
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

async function pingOllama(baseUrl: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
  } catch (error) {
    throw new Error(
      `Ollama unreachable at ${baseUrl}. ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
  if (!response.ok) {
    throw new Error(`Ollama health check returned HTTP ${response.status} at ${baseUrl}.`);
  }
}

async function resolveWithOllama(
  evidence: FmdWorkbookEvidence,
  deterministicDraft: FmdImportDraft,
  options: OllamaResolveOptions,
): Promise<{ draft: FmdImportDraft; resolver: FmdResolverStatus; debug?: FmdResolveResponse["debug"] }> {
  const started = Date.now();
  const model = options.model ?? process.env.BOOMI_HELPER_OLLAMA_MODEL ?? defaultOllamaModel;
  const baseUrl = (options.baseUrl ?? process.env.BOOMI_HELPER_OLLAMA_URL ?? defaultOllamaBaseUrl).replace(/\/$/, "");

  await pingOllama(baseUrl);

  const promptWarnings: string[] = [];
  const relevantSheets = evidence.sheets.filter((sheet) =>
    ["fieldMapping", "overview", "environment", "jobHandling", "explanation", "documentLog"].includes(sheet.role),
  );
  if (relevantSheets.length > 8) {
    promptWarnings.push(
      `Qwen prompt context contained only the first 8 of ${relevantSheets.length} mapping/design sheets; deterministic parser still saw all sheets.`,
    );
  }

  const prompt = buildOllamaPrompt(evidence, deterministicDraft);
  const body = {
    model,
    stream: false,
    format: ollamaResolutionFormat,
    think: false,
    options: {
      temperature: 0,
      top_p: 0.2,
      num_ctx: 4096,
      num_predict: 3000,
    },
    messages: [
      {
        role: "system",
        content:
          "You are the local FMD resolver for Boomi Helper Suite. Return only valid JSON matching the requested schema. Preserve Japanese and technical field names exactly. Never invent data without evidence.",
      },
      { role: "user", content: prompt },
    ],
  };

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });

  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}. Is ${model} pulled and running?`);
  }

  const payload = (await response.json()) as { message?: { content?: string }; response?: string };
  const content = payload.message?.content ?? payload.response ?? "";
  if (!content.trim()) {
    throw new Error("Ollama returned an empty resolver response.");
  }

  const parsedJson = parseJsonObject(content);
  // The Ollama JSON schema constrains the LLM to a correction-patch shape
  // (profileRenames, mappingSetNotes, warnings, unresolvedEvidenceRefs).
  // Try the patch path first — `fmdImportDraftSchema` would otherwise validate
  // an empty patch as a "full draft with 0 of everything" because its array
  // fields default to [], wiping the deterministic results.
  const parsedResolution = fmdAiResolutionSchema.safeParse(parsedJson);
  let baseDraft: FmdImportDraft;
  if (parsedResolution.success) {
    baseDraft = applyAiResolution(deterministicDraft, parsedResolution.data, evidence);
  } else {
    const parsedDraft = fmdImportDraftSchema.safeParse(parsedJson);
    if (!parsedDraft.success) {
      throw new Error(
        `Ollama returned JSON that matched neither resolver patch nor full draft schema: ${parsedResolution.error.message}`,
      );
    }
    if (
      parsedDraft.data.profiles.length === 0 &&
      parsedDraft.data.mappingSets.length === 0 &&
      parsedDraft.data.endpoints.length === 0 &&
      deterministicDraft.profiles.length + deterministicDraft.mappingSets.length + deterministicDraft.endpoints.length > 0
    ) {
      // Defensive guard: the LLM returned a "full draft" shape but it's empty,
      // while the deterministic parser had real data. Keep the deterministic draft
      // and merge any warnings the LLM emitted.
      baseDraft = fmdImportDraftSchema.parse({
        ...deterministicDraft,
        warnings: [
          ...deterministicDraft.warnings,
          ...parsedDraft.data.warnings.filter((warning) => !deterministicDraft.warnings.includes(warning)),
        ],
      });
    } else {
      baseDraft = fmdImportDraftSchema.parse({
        ...parsedDraft.data,
        warnings: [
          ...deterministicDraft.warnings,
          ...parsedDraft.data.warnings.filter((warning) => !deterministicDraft.warnings.includes(warning)),
        ],
      });
    }
  }
  const draft = promptWarnings.length
    ? fmdImportDraftSchema.parse({
        ...baseDraft,
        warnings: [...baseDraft.warnings, ...promptWarnings.filter((warning) => !baseDraft.warnings.includes(warning))],
      })
    : baseDraft;

  return {
    draft,
    resolver: {
      provider: "ollama",
      model,
      baseUrl,
      ok: true,
      message: "Resolved with local Qwen3-8B through Ollama.",
      durationMs: Date.now() - started,
    },
    debug: {
      promptText: prompt,
      rawLlmResponse: content,
    },
  };
}

function buildOllamaPrompt(evidence: FmdWorkbookEvidence, deterministicDraft: FmdImportDraft) {
  const compactSheets = evidence.sheets
    .filter((sheet) => ["fieldMapping", "overview", "environment", "jobHandling", "explanation", "documentLog"].includes(sheet.role))
    .slice(0, 8)
    .map((sheet) => ({
      name: sheet.name,
      role: sheet.role,
      rows: sheet.rows.slice(0, sheet.role === "fieldMapping" ? 10 : 6).map((row) => ({
        ref: row.evidenceRef,
        cells: row.cells.slice(0, 12),
      })),
    }));

  return JSON.stringify(
    {
      task:
        "Review workbook evidence and deterministic parser summary. Return only a compact correction patch. Do not restate profiles, fields, mapping rules, endpoints, or sections. Empty arrays are valid and preferred when the deterministic parser is already reasonable. Warnings are only for ambiguity or unresolved data; do not describe mappings that were parsed correctly. Return at most 2 profileRenames, 2 mappingSetNotes, 2 warnings, and 4 unresolvedEvidenceRefs. Keep only data supported by evidenceRefs. Use confidence 0.0-1.0. Preserve Japanese and technical names exactly.",
      schemaNotes: {
        requiredTopLevel: ["project", "profileRenames", "mappingSetNotes", "warnings", "unresolvedEvidenceRefs"],
        projectFields:
          "Optional object. Include only corrected project fields you are confident about: processId, name, description, sourceSystem, destinationSystem, owner, schedule, status, confidence, evidenceRefs.",
        profileRenames:
          "Optional array. Rename generic or wrong profile names using currentName, proposedName, role, confidence, evidenceRefs.",
        mappingSetNotes:
          "Optional array. Add notes when mapping direction, constants, scattered logic, or ambiguity is visible.",
        evidenceRefs: "Use sheet row refs like Field Mapping!R14.",
      },
      evidenceWarnings: evidence.warnings,
      redactionCount: evidence.redactionCount,
      workbook: {
        filename: evidence.filename,
        sheets: compactSheets,
      },
      deterministicSummary: {
        project: deterministicDraft.project,
        profiles: deterministicDraft.profiles.slice(0, 8).map((profile) => ({
          name: profile.name,
          role: profile.role,
          type: profile.type,
          format: profile.format,
          fieldCount: profile.fields.length,
          sampleFields: profile.fields.slice(0, 4).map((field) => ({
            parentPath: field.parentPath,
            name: field.name,
            dataType: field.dataType,
            required: field.required,
          })),
        })),
        mappingSets: deterministicDraft.mappingSets.slice(0, 5).map((mappingSet) => ({
          name: mappingSet.name,
          sourceProfileName: mappingSet.sourceProfileName,
          destinationProfileName: mappingSet.destinationProfileName,
          ruleCount: mappingSet.rules.length,
          sampleRules: mappingSet.rules.slice(0, 4).map((rule) => ({
            sourceFieldName: rule.sourceFieldName,
            destinationFieldName: rule.destinationFieldName,
            mappingType: rule.mappingType,
            expression: rule.expression?.slice(0, 180),
            evidenceRefs: rule.evidenceRefs,
          })),
        })),
        endpoints: deterministicDraft.endpoints.slice(0, 4).map((endpoint) => ({
          name: endpoint.name,
          role: endpoint.role,
          connectorType: endpoint.connectorType,
          format: endpoint.format,
          evidenceRefs: endpoint.evidenceRefs,
        })),
      },
    },
    null,
    2,
  );
}

function applyAiResolution(
  draft: FmdImportDraft,
  resolution: FmdAiResolution,
  evidence?: FmdWorkbookEvidence,
): FmdImportDraft {
  const renameByKey = new Map(
    resolution.profileRenames.map((rename) => [
      `${rename.role}::${rename.currentName}`.toLowerCase(),
      rename.proposedName,
    ]),
  );
  const renameProfile = (role: Profile["role"], name: string) =>
    renameByKey.get(`${role}::${name}`.toLowerCase()) ?? name;
  const mappingNotes = new Map(resolution.mappingSetNotes.map((note) => [note.mappingSetName, note.note]));
  const reconciliationWarnings: string[] = [];

  return fmdImportDraftSchema.parse({
    ...draft,
    project: {
      ...draft.project,
      ...filterDefinedResolutionProject(resolution.project),
      confidence: Math.max(draft.project.confidence, resolution.project?.confidence ?? 0),
      evidenceRefs: [
        ...new Set([
          ...draft.project.evidenceRefs,
          ...(resolution.project?.evidenceRefs ?? []),
        ]),
      ],
    },
    profiles: draft.profiles.map((profile) => {
      const newName = renameProfile(profile.role, profile.name);
      const renamed = newName !== profile.name;
      let nextType = profile.type;
      let nextFormat = profile.format;
      // POST-LLM TYPE RECONCILIATION (M8 "Fix First" #4): when the LLM renames
      // a profile (e.g. "Account Management System" → "ServiceNow"), the original
      // deterministic inference was based on the OLD name's evidence rows. Re-run
      // inferProfileTypeFromEvidence under the NEW name so a system whose endpoints
      // are clearly an API doesn't stay flagged as Flat File / TSV.
      if (renamed && evidence) {
        const reinferred = inferProfileTypeFromEvidence(newName, newName, evidence);
        const fieldsTriedAlready = profile.fields.length > 0;
        const reinferredSpecific = reinferred.format !== "Unknown" && reinferred.format !== "";
        // Only override when re-inference produces a more specific answer. Keep the
        // existing answer when the new name has no evidence (or the LLM rename
        // doesn't change anything substantive).
        if (reinferredSpecific && (reinferred.type !== profile.type || reinferred.format !== profile.format)) {
          nextType = reinferred.type;
          nextFormat = reinferred.format;
          reconciliationWarnings.push(
            `Profile "${profile.name}" → "${newName}" type/format reconciled to ${reinferred.type} / ${reinferred.format} after LLM rename${fieldsTriedAlready ? " (overriding deterministic guess)" : ""}.`,
          );
        }
      }
      return {
        ...profile,
        name: newName,
        type: nextType,
        format: nextFormat,
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
    mappingSets: draft.mappingSets.map((mappingSet) => {
      const note = mappingNotes.get(mappingSet.name);
      return {
        ...mappingSet,
        sourceProfileName: renameProfile("source", mappingSet.sourceProfileName),
        destinationProfileName: renameProfile("destination", mappingSet.destinationProfileName),
        rules: mappingSet.rules.map((rule) => ({
          ...rule,
          sourceProfileName: rule.sourceProfileName
            ? renameProfile("source", rule.sourceProfileName)
            : rule.sourceProfileName,
          destinationProfileName: rule.destinationProfileName
            ? renameProfile("destination", rule.destinationProfileName)
            : rule.destinationProfileName,
        })),
        warnings: note ? [...mappingSet.warnings, note] : mappingSet.warnings,
        confidence: Math.max(
          mappingSet.confidence,
          resolution.mappingSetNotes.find((item) => item.mappingSetName === mappingSet.name)?.confidence ?? 0,
        ),
      };
    }),
    warnings: [
      ...draft.warnings,
      ...resolution.warnings.filter((warning) => !draft.warnings.includes(warning)),
      ...reconciliationWarnings,
    ],
    unresolvedEvidenceRefs: [
      ...new Set([...draft.unresolvedEvidenceRefs, ...resolution.unresolvedEvidenceRefs]),
    ],
  });
}

function filterDefinedResolutionProject(project?: FmdAiResolution["project"]) {
  if (!project) return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(project)) {
    if (value !== undefined && value !== "" && key !== "confidence" && key !== "evidenceRefs") {
      output[key] = value;
    }
  }
  return output;
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
    owner,
    schedule,
    status: "Draft",
    confidence: processId && name ? 0.72 : 0.45,
    evidenceRefs: collectKeyEvidenceRefs(evidence, [/プロセスID|process id/i, /プロセス名|process name/i]).slice(0, 8),
  };
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
    fmdSections: draft.fmdSections.map((section, index): FmdSection => ({
      id: `draft-section-${index + 1}`,
      title: section.title,
      sectionType: section.sectionType,
      content: section.content,
      sortOrder: section.sortOrder,
    })),
  };
}
