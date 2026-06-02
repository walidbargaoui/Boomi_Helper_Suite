/**
 * Boomi domain knowledge base for the FMD resolver LLM.
 *
 * Provides schema-aware system prompts and contextual knowledge about Boomi
 * integration patterns, naming conventions, and Japanese FMD conventions so the
 * configured LLM provider can make informed decisions about profiles, types,
 * mapping patterns, and project metadata.
 */

// ── Boomi Connector Knowledge ──────────────────────────────────────────

export const BOOMI_CONNECTOR_KNOWLEDGE = [
  "Disk/FTP/SFTP/FileShare connectors produce Flat File profiles (CSV, TSV, fixed-width, Excel, JSON).",
  "HTTP/SOAP/REST/GraphQL connectors produce JSON or XML profiles (REST typically JSON, SOAP is XML).",
  "Database/JDBC connectors produce Database profiles (Table) with SQL-typed columns.",
  "SAP/SuccessFactors/Workday/NetSuite connectors typically produce XML/JSON profiles with nested structures.",
  "Mail/Notification connectors are reference/notification endpoints, not data profiles.",
  "A profile with no parent paths and flat field names is almost always \"Flat File\" type.",
  "A profile with XPath-style parent paths (/root/item/field) is XML type.",
  "A profile with dot-notation parent paths (root.items.field) is JSON type.",
  "A profile with column names like VARCHAR, NUMBER, DATE is usually Database type.",
  "API profiles always have REST/SOAP/HTTP endpoints associated.",
].join("\n");

// ── Boomi Naming Conventions ───────────────────────────────────────────

export const BOOMI_NAMING_CONVENTIONS = [
  "Process IDs often follow IFID### or IF#### patterns. Extract these from filenames or metadata.",
  "Profile names should be descriptive and system-specific, not generic like \"Source\" or \"Destination\".",
  "Mapping set names often reflect the sheet name or the integration direction (SRC→DST).",
  "Boomi uses PascalCase for component names but underscores/hyphens are also common in Japanese orgs.",
  "Profile type \"API\" should only be used when there are REST/SOAP endpoint URLs in evidence.",
  "Profile type \"Flat File\" is the default for file-based integrations (SFTP, Disk, FileShare).",
  "\"TSV\" format is the most common tabular format in Japanese FMDs. \"CSV\" is rarer.",
  "A profile named after a system (e.g. \"SAP\", \"Salesforce\") is better than \"Source System\".",
  "Do NOT rename profiles to systems not mentioned in the workbook evidence.",
].join("\n");

// ── Japanese FMD Conventions ───────────────────────────────────────────

export const JAPANESE_FMD_CONVENTIONS = [
  "Japanese FMD column labels: 送信元 = source, 送信先 = destination/target.",
  "マッピング = mapping/transformation. 変換 = transformation/conversion.",
  "項目名 or 明細項目 = field/item name. データ型 or 型 = data type.",
  "桁 or 項目長 = field length. 必須 or 連携要否 = required flag.",
  "コメント = comment. 固定値 = fixed/constant value. キー = key.",
  "Japanese FMD overview sheets: 連携概要 or 連携IF設計 or データフロー.",
  "Japanese environment sheets: 環境 or エンドポイント or エンドポイント一覧.",
  "Japanese job/error sheets: ジョブ or エラー.",
  "Japanese headers often have parenthetical clarifications like 送信先(Destination).",
  "Common Japanese system patterns: 販売管理 = sales management, 受注 = order entry, 出荷 = shipping, 請求 = billing, 在庫 = inventory, 会計 = accounting, 人事 = HR, 給与 = payroll.",
  "Japanese company names in parentheses after system names are common, e.g. \"SAP（セーレン商事）\" → system is SAP.",
  "System names in Japanese FMDs often appear in the top rows of mapping sheets, before the header group row.",
  "Extract system names from: (1) worksheet headers, (2) column group labels, (3) filename patterns, (4) overview sheet text.",
  "The filename often encodes: [業務名]FMD_IFID###_SOURCE_DESTINATION_PURPOSE[_FREQUENCY].xlsx",
].join("\n");

// ── Integration Pattern Recognition ────────────────────────────────────

export const INTEGRATION_PATTERN_KNOWLEDGE = [
  "Batch File Transfer: source produces files, destination consumes files via SFTP/Disk. Look for file extensions (.csv, .tsv, .json, .xml) and schedule info.",
  "Real-time API: HTTP/REST/SOAP endpoints with request/response patterns. Look for URLs, HTTP methods, API names.",
  "Database Sync: source and destination are both databases or a database and a flat file. Look for SQL/table/column references.",
  "Event-driven: message queues, JMS, webhooks. Look for queue/topic names or event triggers.",
  "ETL Pipeline: multiple sources transformed into a data warehouse destination. Look for transformation logic.",
  "Master Data Sync: reference/master data synchronised between systems. Look for lookup patterns and key field flags.",
].join("\n");

// ── Japanese Header Synonyms ───────────────────────────────────────────

export const JAPANESE_HEADER_SYNONYMS: Record<string, string[]> = {
  sourceSystem: ["連携元システム", "source system", "source/source system", "送信元システム"],
  destinationSystem: ["連携先システム", "destination system", "送信先システム"],
  processId: ["プロセスID", "process id", "IFID", "インターフェースID"],
  processName: ["プロセス名", "process name", "インターフェース名"],
  owner: ["最終更新者", "新規作成者", "owner", "作成者"],
  schedule: ["ジョブスケジュール", "連携スケジュール", "schedule", "実行頻度"],
  overview: ["概要", "overview", "要件", "処理概要"],
  fileName: ["ファイル名", "file name", "入出力ファイル"],
};

// ── System Prompt Generators ───────────────────────────────────────────

type ResolverPass = "inventory" | "project" | "endpoints" | "profiles" | "mappings" | "flow" | "verifier";

function baseSystemPrompt(): string {
  return [
    "You are the Boomi FMD resolver for Boomi Helper Suite, a professional integration design tool.",
    "Your job is to analyze workbook evidence extracted from a Boomi Functional Mapping Document (FMD) Excel file.",
    "",
    "RULES:",
    "1. Return ONLY valid JSON matching the requested schema.",
    "2. Preserve Japanese text, technical field names, and data values EXACTLY as they appear.",
    "3. Never invent data without evidence. Use evidenceRefs to cite specific cells.",
    "4. Use confidence 0.0-1.0: 0.9+ for strong evidence, 0.6-0.8 for inference from patterns, <0.5 for guesses.",
    "5. Prefer leaving arrays empty rather than providing low-confidence suggestions.",
    "6. Japanese technical terms (送信元, 送信先, マッピング etc.) are part of the data, not noise.",
    "7. Write project.description, project.schedule, process flow labels, and process flow notes in clear English. Keep literal system names, IDs, URLs, file names, field names, and endpoint values unchanged.",
    "8. You may synthesize English descriptions and schedules from multiple evidence rows when the cited evidence supports the inference.",
    "",
    "BOOMI DOMAIN KNOWLEDGE:",
    BOOMI_CONNECTOR_KNOWLEDGE,
    "",
    "BOOMI NAMING CONVENTIONS:",
    BOOMI_NAMING_CONVENTIONS,
    "",
    "JAPANESE FMD CONVENTIONS:",
    JAPANESE_FMD_CONVENTIONS,
    "",
    "INTEGRATION PATTERNS:",
    INTEGRATION_PATTERN_KNOWLEDGE,
  ].join("\n");
}

export function buildSystemPrompt(pass: ResolverPass): string {
  const base = baseSystemPrompt();
  const extras: Record<ResolverPass, string> = {
    inventory: [
      "",
      "EVIDENCE INVENTORY PASS: Identify the strongest workbook rows for later passes.",
      "- Return structured suggestions only when a row clearly supports a metadata, endpoint, profile, mapping, or section decision.",
      "- Prefer exact row evidence over broad workbook inference.",
      "- Do not rewrite the draft in this pass; surface candidate facts with confidence and evidenceRefs.",
    ].join("\n"),
    project: [
      "",
      "PROJECT PASS: Extract project metadata from workbook evidence.",
      "- Identify the integration PURPOSE from overview/explanation sheets.",
      "- Extract sourceSystem and destinationSystem from metadata, overview, and mapping sheet group labels.",
      "- Prefer specific system names (\"SAP ERP\", \"Salesforce\") over generic (\"Source System\").",
      "- Extract processId from filename patterns or metadata fields.",
      "- If a system name is in Japanese, provide both the Japanese name and a sensible English label.",
      "- Use the filename to infer a meaningful project name: strip extensions, decode abbreviations.",
      "- Identify the integration pattern (batch file, API, DB sync, etc.).",
      "- Generate project.description in English as 1-3 concise sentences explaining trigger/schedule, source, destination, purpose, and high-level transformation.",
      "- Normalize project.schedule in English when schedule, frequency, trigger, batch window, cron-like, daily/monthly, or job handling evidence exists. Examples: \"Daily batch\", \"Daily at 22:05 JST\", \"API-triggered on demand\".",
      "- If schedule is not supported by evidence, omit schedule instead of writing \"unknown\" or \"not specified\".",
      "- Treat filename-derived DAILY/MONTHLY/API/event words as evidence only when they match workbook context.",
      "- Return project fields plus matching suggestions for each changed field.",
    ].join("\n"),
    endpoints: [
      "",
      "ENDPOINT PASS: Extract Boomi endpoint/environment information.",
      "- Look for URLs, API methods, hostnames, SFTP paths, connector names, environment names, and file names.",
      "- Classify endpoint roles as source, destination, notification, or reference.",
      "- Prefer creating a candidate endpoint from clear evidence instead of leaving environment data unused.",
      "- Return endpoint candidates only when each has evidenceRefs.",
    ].join("\n"),
    profiles: [
      "",
      "PROFILE PASS: Enhance profile definitions from mapping sheet evidence.",
      "- Rename generic profile names like \"Source\", \"Destination\", \"送信元\", \"送信先\" to specific system names.",
      "- For renamed profiles, extract the system name from column group labels, sheet name patterns, or adjacent cells.",
      "- Fix profile type/format when deterministic parser is wrong:",
      "  * API profiles MUST have endpoint URLs in evidence.",
      "  * JSON profiles have dot-notation parent paths or nested object fields.",
      "  * XML profiles have slash/XPath-style parent paths.",
      "  * Flat File (TSV/CSV) profiles have flat field lists with no parent paths.",
      "  * Database profiles reference tables/columns/SQL.",
      "- Identify likely key/primary key fields from field names like \"id\", \"code\", \"キー\", or fields marked as required+unique.",
      "- Do NOT change types without clear evidence in the workbook data.",
    ].join("\n"),
    mappings: [
      "",
      "MAPPING PASS: Enhance mapping rules and detect patterns.",
      "- Identify mapping types that the regex parser may have missed:",
      "  * constant: a fixed value with no source field reference.",
      "  * lookup: references to master data, mapping tables, or cross-reference.",
      "  * function: expressions with Boomi functions (DateFormatter, StringConcat, etc.).",
      "  * join: combining multiple source fields into one destination.",
      "- Add notes for mapping sets that have scattered logic, unusual patterns, or ambiguity.",
      "- Flag incomplete or inconsistent mappings.",
      "- Surface rules where the expression or comment contains useful context not captured by the parser.",
    ].join("\n"),
    flow: [
      "",
      "FLOW PASS: Propose one sample Boomi process flow from the resolved FMD draft.",
      "- Return at most one process flow that the Boomi Helper flow designer can render.",
      "- Use only these node types unless the evidence explicitly requires another schema-supported type: start-connector, connector, setproperties, dataprocess, map, route, decision, trycatch, exception, notify, stop, return.",
      "- A normal batch/API integration should usually be: start-connector -> connector/source receive -> optional setproperties/dataprocess -> map -> connector/destination send -> stop.",
      "- Add trycatch/exception/notify only when error handling or notification evidence exists.",
      "- Use English node labels/descriptions that explain the business step; keep system names, file names, endpoints, and map/profile names literal.",
      "- Cite evidenceRefs from overview, environment, mapping, and job/error rows. Do not return a flow without evidenceRefs.",
      "- Keep the graph simple, connected, left-to-right, and compatible with the existing shape engine.",
    ].join("\n"),
    verifier: [
      "",
      "VERIFIER PASS: Review the resolved draft for contradictions and missed high-value fixes.",
      "- Do not invent new workbook facts.",
      "- Surface unresolved conflicts, suspicious low-confidence parser choices, or clear final corrections.",
      "- Prefer warnings and needs-review suggestions over destructive changes.",
    ].join("\n"),
  };
  return `${base}\n${extras[pass]}`;
}

// ── Prompt Context Builders ────────────────────────────────────────────

import type { FmdWorkbookEvidence, FmdImportDraft } from "./fmd-import";

function packRows(rows: FmdWorkbookEvidence["sheets"][number]["rows"], rowLimit: number, cellLimit = 14) {
  return rows.slice(0, rowLimit).map((r) => ({
    ref: r.evidenceRef,
    cells: r.cells.slice(0, cellLimit),
    text: r.text.slice(0, 900),
  }));
}

function packSheets(
  evidence: FmdWorkbookEvidence,
  roles: Array<FmdWorkbookEvidence["sheets"][number]["role"]>,
  sheetLimit: number,
  rowLimit: number,
) {
  return evidence.sheets
    .filter((sheet) => roles.includes(sheet.role))
    .slice(0, sheetLimit)
    .map((sheet) => ({
      name: sheet.name,
      role: sheet.role,
      headers: sheet.headers,
      rows: packRows(sheet.rows, rowLimit),
    }));
}

function filenameCandidates(filename: string) {
  const clean = filename.replace(/\.[^.]+$/, "").split(/[\\/]/).pop() ?? filename;
  const processId = clean.match(/[A-Z]{2,}[A-Z0-9_-]*\d{2,}/i)?.[0];
  const parts = clean.split(/[_\-\s]+/).filter(Boolean).slice(0, 12);
  return { clean, processId, parts };
}

export function buildEvidenceInventoryPassPrompt(
  evidence: FmdWorkbookEvidence,
  deterministicDraft: FmdImportDraft,
): string {
  return JSON.stringify({
    instruction: "Inventory the strongest evidence rows for metadata, endpoint, profile, and mapping decisions. Return suggestions only; do not rewrite the draft.",
    workbook: {
      filename: evidence.filename,
      filenameCandidates: filenameCandidates(evidence.filename),
      overviewAndEnvironment: packSheets(evidence, ["overview", "environment", "explanation", "documentLog"], 10, 24),
      mappingHeaders: packSheets(evidence, ["fieldMapping"], 12, 18),
    },
    deterministicSnapshot: {
      project: deterministicDraft.project,
      endpointCount: deterministicDraft.endpoints.length,
      profileNames: deterministicDraft.profiles.map((profile) => `${profile.role}:${profile.name}`),
      mappingSets: deterministicDraft.mappingSets.map((mappingSet) => ({
        name: mappingSet.name,
        source: mappingSet.sourceProfileName,
        destination: mappingSet.destinationProfileName,
        rules: mappingSet.rules.length,
      })),
    },
    schemaNotes: {
      suggestions: "Array of {category,target,field,proposedValue,currentValue,reason,confidence,evidenceRefs,conflictNotes}. Use this pass to surface candidate facts for later passes.",
    },
  }, null, 2);
}

export function buildProjectPassPrompt(
  evidence: FmdWorkbookEvidence,
  deterministicDraft: FmdImportDraft,
): string {
  return JSON.stringify({
    instruction: "Extract accurate project metadata from workbook evidence. Focus on integration purpose, source/destination systems, owner, schedule, and integration pattern. Return suggestions for every changed field.",
    workbook: {
      filename: evidence.filename,
      filenameCandidates: filenameCandidates(evidence.filename),
      metadataSheets: packSheets(evidence, ["overview", "environment", "explanation", "documentLog"], 10, 36),
      mappingContext: packSheets(evidence, ["fieldMapping"], 12, 20),
      endpointContext: packSheets(evidence, ["environment"], 8, 36),
    },
    deterministicProject: deterministicDraft.project,
    deterministicProfiles: deterministicDraft.profiles.slice(0, 12).map((profile) => ({
      role: profile.role,
      name: profile.name,
      type: profile.type,
      format: profile.format,
      evidenceRefs: profile.evidenceRefs,
    })),
    deterministicMappingSets: deterministicDraft.mappingSets.slice(0, 10).map((mappingSet) => ({
      name: mappingSet.name,
      sourceProfileName: mappingSet.sourceProfileName,
      destinationProfileName: mappingSet.destinationProfileName,
      evidenceRefs: mappingSet.evidenceRefs,
    })),
    evidenceWarnings: evidence.warnings,
    schemaNotes: {
      required: ["project", "suggestions", "warnings", "unresolvedEvidenceRefs"],
      project: "Full project object with: processId, name, description, sourceSystem, destinationSystem, integrationPattern, owner, schedule, status, confidence, evidenceRefs.",
      suggestions: "Mirror each changed project field as a project suggestion with evidenceRefs and confidence.",
    },
  }, null, 2);
}

export function buildEndpointPassPrompt(
  evidence: FmdWorkbookEvidence,
  deterministicDraft: FmdImportDraft,
): string {
  return JSON.stringify({
    instruction: "Extract endpoint and environment candidates that deterministic parsing missed or under-specified. Return only evidence-backed endpoint candidates.",
    workbook: {
      filename: evidence.filename,
      environmentSheets: packSheets(evidence, ["environment", "overview", "explanation"], 12, 44),
      mappingContext: packSheets(evidence, ["fieldMapping"], 8, 16),
    },
    deterministicEndpoints: deterministicDraft.endpoints.map((endpoint) => ({
      name: endpoint.name,
      role: endpoint.role,
      connectorType: endpoint.connectorType,
      profileType: endpoint.profileType,
      format: endpoint.format,
      purpose: endpoint.purpose,
      connectionInfo: endpoint.connectionInfo,
      confidence: endpoint.confidence,
      evidenceRefs: endpoint.evidenceRefs,
    })),
    deterministicProject: deterministicDraft.project,
    schemaNotes: {
      endpoints: "Array of full endpoint candidates: name, role, connectorType, profileType, format, purpose, connectionInfo, confidence, evidenceRefs, reason, conflictNotes.",
      suggestions: "Optional endpoint review notes that are not full endpoints.",
    },
  }, null, 2);
}

export function buildProfilePassPrompt(
  evidence: FmdWorkbookEvidence,
  deterministicDraft: FmdImportDraft,
): string {
  return JSON.stringify({
    instruction: "Review profile definitions from mapping sheets. Rename generic profiles, fix type/format errors, identify key fields. Use environment context for API detection.",
    workbook: {
      filename: evidence.filename,
      mappingSheets: packSheets(evidence, ["fieldMapping"], 12, 38),
      environmentContext: packSheets(evidence, ["environment", "overview"], 8, 34),
    },
    deterministicProfiles: deterministicDraft.profiles.slice(0, 16).map((p) => ({
      name: p.name,
      role: p.role,
      type: p.type,
      format: p.format,
      fieldCount: p.fields.length,
      sampleFieldNames: p.fields.slice(0, 6).map((f) => f.name),
      sampleParentPaths: [...new Set(p.fields.slice(0, 6).map((f) => f.parentPath).filter(Boolean))],
      confidence: p.confidence,
      evidenceRefs: p.evidenceRefs,
    })),
    evidenceWarnings: evidence.warnings,
    schemaNotes: {
      required: ["profileRenames", "profileTypeFixes", "keyFieldSuggestions", "warnings", "unresolvedEvidenceRefs"],
      profileRenames: "Array of {role, currentName, proposedName, confidence, evidenceRefs}. Up to 10 items.",
      profileTypeFixes: "Array of {role, profileName, newType, newFormat, reason, confidence, evidenceRefs}. Up to 10 items. Only include when type/format is clearly wrong.",
      keyFieldSuggestions: "Array of {role, profileName, fieldName, reason, confidence, evidenceRefs}. Up to 10 items.",
    },
  }, null, 2);
}

export function buildMappingPassPrompt(
  evidence: FmdWorkbookEvidence,
  deterministicDraft: FmdImportDraft,
): string {
  return JSON.stringify({
    instruction: "Review mapping rules for patterns the deterministic parser may have missed. Identify constants, lookups, functions, joins. Add contextual notes.",
    workbook: {
      filename: evidence.filename,
      mappingSheets: packSheets(evidence, ["fieldMapping"], 10, 42),
    },
    deterministicMappingSets: deterministicDraft.mappingSets.slice(0, 10).map((ms) => ({
      name: ms.name,
      sourceProfile: ms.sourceProfileName,
      destinationProfile: ms.destinationProfileName,
      ruleCount: ms.rules.length,
      sampleRules: ms.rules.slice(0, 8).map((r) => ({
        sourceField: r.sourceFieldName,
        destField: r.destinationFieldName,
        type: r.mappingType,
        expression: r.expression?.slice(0, 200),
        evidenceRefs: r.evidenceRefs,
      })),
    })),
    schemaNotes: {
      required: ["mappingSetNotes", "mappingTypeCorrections", "warnings", "unresolvedEvidenceRefs"],
      mappingSetNotes: "Array of {mappingSetName, note, confidence, evidenceRefs}. Up to 10 items.",
      mappingTypeCorrections: "Array of {mappingSetName, destinationFieldName, newMappingType, reason, confidence, evidenceRefs}. Up to 10 items. New type must be one of: direct, constant, lookup, function, join.",
    },
  }, null, 2);
}

export function buildFlowPassPrompt(
  evidence: FmdWorkbookEvidence,
  deterministicDraft: FmdImportDraft,
): string {
  return JSON.stringify({
    instruction: "Generate one evidence-backed sample Boomi process flow using supported shape types. Return an empty processFlows array if there is not enough evidence to create a useful flow.",
    workbook: {
      filename: evidence.filename,
      filenameCandidates: filenameCandidates(evidence.filename),
      overviewAndJobContext: packSheets(evidence, ["overview", "explanation", "jobHandling", "documentLog"], 10, 28),
      endpointContext: packSheets(evidence, ["environment"], 10, 30),
      mappingContext: packSheets(evidence, ["fieldMapping"], 8, 18),
    },
    resolvedDraftSummary: {
      project: deterministicDraft.project,
      endpoints: deterministicDraft.endpoints.map((endpoint) => ({
        name: endpoint.name,
        role: endpoint.role,
        connectorType: endpoint.connectorType,
        format: endpoint.format,
        purpose: endpoint.purpose,
        connectionInfo: endpoint.connectionInfo,
        evidenceRefs: endpoint.evidenceRefs,
      })),
      profiles: deterministicDraft.profiles.map((profile) => ({
        name: profile.name,
        role: profile.role,
        type: profile.type,
        format: profile.format,
        fieldCount: profile.fields.length,
        evidenceRefs: profile.evidenceRefs,
      })),
      mappingSets: deterministicDraft.mappingSets.map((mappingSet) => ({
        name: mappingSet.name,
        sourceProfileName: mappingSet.sourceProfileName,
        destinationProfileName: mappingSet.destinationProfileName,
        ruleCount: mappingSet.rules.length,
        evidenceRefs: mappingSet.evidenceRefs,
        warnings: mappingSet.warnings,
      })),
    },
    layoutRules: {
      nodeIds: "Use stable lowercase IDs like start, receive-source, map-to-destination, send-destination, stop.",
      positions: "Use left-to-right coordinates, e.g. x increments by 220 and y near 140.",
      edges: "Every edge source/target must match a node id. Keep the primary happy path connected.",
      confidence: "Use >=0.82 only when overview/environment/mapping/job evidence together support the flow.",
    },
    schemaNotes: {
      processFlows: "Array with at most one flow: {name,nodes,edges,notes,confidence,evidenceRefs}.",
      suggestions: "Add a flow suggestion summarizing why the flow was proposed.",
    },
  }, null, 2);
}

export function buildVerifierPassPrompt(
  evidence: FmdWorkbookEvidence,
  deterministicDraft: FmdImportDraft,
): string {
  const lowConfidenceRules = deterministicDraft.mappingSets.flatMap((mappingSet) =>
    mappingSet.rules
      .filter((rule) => rule.confidence < 0.6)
      .slice(0, 8)
      .map((rule) => ({
        mappingSetName: mappingSet.name,
        destinationFieldName: rule.destinationFieldName,
        mappingType: rule.mappingType,
        expression: rule.expression,
        comment: rule.comment,
        confidence: rule.confidence,
        evidenceRefs: rule.evidenceRefs,
      })),
  ).slice(0, 24);

  return JSON.stringify({
    instruction: "Verify the current draft. Return only high-value corrections, warnings, unresolved evidence refs, or needs-review suggestions.",
    workbook: {
      filename: evidence.filename,
      criticalRows: [
        ...packSheets(evidence, ["overview", "environment", "explanation"], 8, 18),
        ...packSheets(evidence, ["fieldMapping"], 8, 18),
      ],
    },
    resolvedDraftSummary: {
      project: deterministicDraft.project,
      endpoints: deterministicDraft.endpoints.map((endpoint) => ({
        name: endpoint.name,
        role: endpoint.role,
        connectorType: endpoint.connectorType,
        confidence: endpoint.confidence,
      })),
      profiles: deterministicDraft.profiles.map((profile) => ({
        name: profile.name,
        role: profile.role,
        type: profile.type,
        format: profile.format,
        fieldCount: profile.fields.length,
        confidence: profile.confidence,
      })),
      mappingSets: deterministicDraft.mappingSets.map((mappingSet) => ({
        name: mappingSet.name,
        ruleCount: mappingSet.rules.length,
        warnings: mappingSet.warnings,
        confidence: mappingSet.confidence,
      })),
      lowConfidenceRules,
      warnings: deterministicDraft.warnings,
      unresolvedEvidenceRefs: deterministicDraft.unresolvedEvidenceRefs,
    },
    schemaNotes: {
      suggestions: "Use needs-review suggestions for conflicts instead of forcing changes.",
      warnings: "Warnings should explain concrete risks or missing evidence.",
    },
  }, null, 2);
}

// ── JSON Schema Generators ─────────────────────────────────────────────

function suggestionSchema() {
  return {
    type: "object",
    properties: {
      category: { type: "string", enum: ["project", "endpoint", "profile", "mapping", "flow", "section", "warning"] },
      target: { type: "string" },
      field: { type: "string" },
      proposedValue: { type: "string" },
      currentValue: { type: "string" },
      reason: { type: "string" },
      confidence: { type: "number" },
      evidenceRefs: { type: "array", items: { type: "string" } },
      conflictNotes: { type: "array", items: { type: "string" } },
    },
    required: ["category", "target", "confidence", "evidenceRefs"],
    additionalProperties: false,
  } as const;
}

const processFlowNodeTypes = [
  "start",
  "start-connector",
  "start-trading",
  "start-passthrough",
  "start-nodata",
  "connector",
  "map",
  "setproperties",
  "message",
  "notify",
  "programcmd",
  "subprocess",
  "processroute",
  "dataprocess",
  "agent",
  "branch",
  "route",
  "cleanse",
  "decision",
  "exception",
  "stop",
  "end",
  "return",
  "flowcontrol",
  "trycatch",
  "businessrules",
  "findchanges",
  "addtocache",
  "retrievefromcache",
  "removefromcache",
] as const;

function endpointSchema() {
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      role: { type: "string", enum: ["source", "destination", "notification", "reference"] },
      connectorType: { type: "string" },
      profileType: { type: "string" },
      format: { type: "string" },
      purpose: { type: "string" },
      connectionInfo: { type: "string" },
      confidence: { type: "number" },
      evidenceRefs: { type: "array", items: { type: "string" } },
      reason: { type: "string" },
      conflictNotes: { type: "array", items: { type: "string" } },
    },
    required: ["name", "role", "connectorType", "profileType", "format", "purpose", "connectionInfo", "confidence", "evidenceRefs"],
    additionalProperties: false,
  } as const;
}

function processFlowSchema() {
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      nodes: {
        type: "array",
        minItems: 2,
        maxItems: 30,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: { type: "string", enum: processFlowNodeTypes },
            label: { type: "string" },
            description: { type: "string" },
            position: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
              },
              required: ["x", "y"],
              additionalProperties: false,
            },
          },
          required: ["id", "type", "label", "description", "position"],
          additionalProperties: false,
        },
      },
      edges: {
        type: "array",
        minItems: 1,
        maxItems: 60,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            source: { type: "string" },
            target: { type: "string" },
            label: { type: "string" },
          },
          required: ["id", "source", "target"],
          additionalProperties: false,
        },
      },
      notes: { type: "string" },
      confidence: { type: "number" },
      evidenceRefs: { type: "array", items: { type: "string" } },
    },
    required: ["name", "nodes", "edges", "confidence", "evidenceRefs"],
    additionalProperties: false,
  } as const;
}

export function buildEvidenceInventoryPassSchema() {
  return {
    type: "object",
    properties: {
      suggestions: { type: "array", maxItems: 24, items: suggestionSchema() },
      warnings: { type: "array", maxItems: 10, items: { type: "string" } },
      unresolvedEvidenceRefs: { type: "array", maxItems: 20, items: { type: "string" } },
    },
    required: ["suggestions", "warnings", "unresolvedEvidenceRefs"],
    additionalProperties: false,
  } as const;
}

export function buildProjectPassSchema() {
  return {
    type: "object",
    properties: {
      project: {
        type: "object",
        properties: {
          processId: { type: "string" },
          name: { type: "string", description: "Human-readable project name" },
          description: { type: "string", description: "What this integration does" },
          sourceSystem: { type: "string" },
          destinationSystem: { type: "string" },
          integrationPattern: { type: "string", description: "batch, api, database-sync, event-driven, etl, master-data-sync" },
          owner: { type: "string" },
          schedule: { type: "string" },
          status: { type: "string", enum: ["Draft", "Mapping Review", "Ready for Sandbox", "Published"] },
          confidence: { type: "number" },
          evidenceRefs: { type: "array", items: { type: "string" } },
        },
        required: ["processId", "name", "description", "sourceSystem", "destinationSystem", "confidence", "evidenceRefs"],
        additionalProperties: false,
      },
      suggestions: { type: "array", maxItems: 16, items: suggestionSchema() },
      warnings: { type: "array", maxItems: 10, items: { type: "string" } },
      unresolvedEvidenceRefs: { type: "array", maxItems: 20, items: { type: "string" } },
    },
    required: ["project", "suggestions", "warnings", "unresolvedEvidenceRefs"],
    additionalProperties: false,
  } as const;
}

export function buildEndpointPassSchema() {
  return {
    type: "object",
    properties: {
      endpoints: { type: "array", maxItems: 20, items: endpointSchema() },
      suggestions: { type: "array", maxItems: 16, items: suggestionSchema() },
      warnings: { type: "array", maxItems: 10, items: { type: "string" } },
      unresolvedEvidenceRefs: { type: "array", maxItems: 20, items: { type: "string" } },
    },
    required: ["endpoints", "suggestions", "warnings", "unresolvedEvidenceRefs"],
    additionalProperties: false,
  } as const;
}

export function buildProfilePassSchema() {
  return {
    type: "object",
    properties: {
      profileRenames: {
        type: "array",
        maxItems: 10,
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
      profileTypeFixes: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            role: { type: "string", enum: ["source", "destination"] },
            profileName: { type: "string" },
            newType: { type: "string", enum: ["Flat File", "JSON", "XML", "Database", "API"] },
            newFormat: { type: "string" },
            reason: { type: "string" },
            confidence: { type: "number" },
            evidenceRefs: { type: "array", items: { type: "string" } },
          },
          required: ["role", "profileName", "newType", "newFormat", "reason", "confidence", "evidenceRefs"],
          additionalProperties: false,
        },
      },
      keyFieldSuggestions: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            role: { type: "string", enum: ["source", "destination"] },
            profileName: { type: "string" },
            fieldName: { type: "string" },
            reason: { type: "string" },
            confidence: { type: "number" },
            evidenceRefs: { type: "array", items: { type: "string" } },
          },
          required: ["role", "profileName", "fieldName", "confidence", "evidenceRefs"],
          additionalProperties: false,
        },
      },
      suggestions: { type: "array", maxItems: 16, items: suggestionSchema() },
      warnings: { type: "array", maxItems: 10, items: { type: "string" } },
      unresolvedEvidenceRefs: { type: "array", maxItems: 20, items: { type: "string" } },
    },
    required: ["profileRenames", "profileTypeFixes", "keyFieldSuggestions", "warnings", "unresolvedEvidenceRefs"],
    additionalProperties: false,
  } as const;
}

export function buildMappingPassSchema() {
  return {
    type: "object",
    properties: {
      mappingSetNotes: {
        type: "array",
        maxItems: 10,
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
      mappingTypeCorrections: {
        type: "array",
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            mappingSetName: { type: "string" },
            destinationFieldName: { type: "string" },
            newMappingType: { type: "string", enum: ["direct", "constant", "lookup", "function", "join"] },
            reason: { type: "string" },
            confidence: { type: "number" },
            evidenceRefs: { type: "array", items: { type: "string" } },
          },
          required: ["mappingSetName", "destinationFieldName", "newMappingType", "confidence", "evidenceRefs"],
          additionalProperties: false,
        },
      },
      suggestions: { type: "array", maxItems: 16, items: suggestionSchema() },
      warnings: { type: "array", maxItems: 10, items: { type: "string" } },
      unresolvedEvidenceRefs: { type: "array", maxItems: 20, items: { type: "string" } },
    },
    required: ["mappingSetNotes", "mappingTypeCorrections", "warnings", "unresolvedEvidenceRefs"],
    additionalProperties: false,
  } as const;
}

export function buildFlowPassSchema() {
  return {
    type: "object",
    properties: {
      processFlows: { type: "array", maxItems: 1, items: processFlowSchema() },
      suggestions: { type: "array", maxItems: 10, items: suggestionSchema() },
      warnings: { type: "array", maxItems: 10, items: { type: "string" } },
      unresolvedEvidenceRefs: { type: "array", maxItems: 20, items: { type: "string" } },
    },
    required: ["processFlows", "suggestions", "warnings", "unresolvedEvidenceRefs"],
    additionalProperties: false,
  } as const;
}

export function buildVerifierPassSchema() {
  return {
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
          integrationPattern: { type: "string" },
          owner: { type: "string" },
          schedule: { type: "string" },
          status: { type: "string", enum: ["Draft", "Mapping Review", "Ready for Sandbox", "Published"] },
          confidence: { type: "number" },
          evidenceRefs: { type: "array", items: { type: "string" } },
        },
        required: ["confidence", "evidenceRefs"],
        additionalProperties: false,
      },
      profileRenames: buildProfilePassSchema().properties.profileRenames,
      profileTypeFixes: buildProfilePassSchema().properties.profileTypeFixes,
      keyFieldSuggestions: buildProfilePassSchema().properties.keyFieldSuggestions,
      mappingSetNotes: buildMappingPassSchema().properties.mappingSetNotes,
      mappingTypeCorrections: buildMappingPassSchema().properties.mappingTypeCorrections,
      endpoints: { type: "array", maxItems: 10, items: endpointSchema() },
      suggestions: { type: "array", maxItems: 20, items: suggestionSchema() },
      warnings: { type: "array", maxItems: 12, items: { type: "string" } },
      unresolvedEvidenceRefs: { type: "array", maxItems: 30, items: { type: "string" } },
    },
    required: [
      "profileRenames",
      "profileTypeFixes",
      "keyFieldSuggestions",
      "mappingSetNotes",
      "mappingTypeCorrections",
      "endpoints",
      "suggestions",
      "warnings",
      "unresolvedEvidenceRefs",
    ],
    additionalProperties: false,
  } as const;
}
