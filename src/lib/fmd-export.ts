import ExcelJS from "exceljs";
import type { FmdSection, MappingSet, Profile, Project } from "@/lib/domain";
import { qualityScore, validateMappingSet } from "@/lib/mapping-quality";
import { getExportRenderer, type ExportSheetData } from "@/lib/fmd-export-renderers";

export type FmdExportTemplate = "standard" | "japanese" | "boomi-design";

export type FmdExportOptions = {
  template: FmdExportTemplate;
  includeSampleData: boolean;
  includeXmlPreview: boolean;
  includeQualityReport: boolean;
  includeChecklist: boolean;
};

const defaultOptions: FmdExportOptions = {
  template: "standard",
  includeSampleData: false,
  includeXmlPreview: false,
  includeQualityReport: false,
  includeChecklist: false,
};

type RowValue = string | number | boolean | null | undefined;
type RowValues = RowValue[];

export async function createFmdWorkbookWithTemplate(
  project: Project,
  options: Partial<FmdExportOptions> = {},
): Promise<Buffer> {
  const opts = { ...defaultOptions, ...options };
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Boomi Helper Suite";
  workbook.created = new Date();
  workbook.subject = "Boomi functional mapping document";
  workbook.title = `${project.processId} ${project.name} FMD`;

  switch (opts.template) {
    case "japanese":
      buildJapaneseTemplate(workbook, project, opts);
      break;
    case "boomi-design":
      buildBoomiDesignTemplate(workbook, project, opts);
      break;
    default:
      buildStandardTemplate(workbook, project, opts);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function exportFmdWorkbookFromSections(
  project: Project,
  options: Partial<FmdExportOptions> = {},
): Promise<Buffer> {
  const opts = { ...defaultOptions, ...options };
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Boomi Helper Suite";
  workbook.created = new Date();
  workbook.subject = "Boomi functional mapping document";
  workbook.title = `${project.processId} ${project.name} FMD`;

  const sections = [...project.fmdSections]
    .filter((s) => {
      const c = s.content as Record<string, unknown>;
      return (c.exportEnabled as boolean) ?? true;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  for (const section of sections) {
    const renderer = getExportRenderer(section.sectionType);
    if (renderer) {
      const sheetData = renderer(section, project);
      if (sheetData) {
        addSheetFromData(workbook, sheetData);
      }
    }

    // fieldMapping sections also create individual mapping-set sheets
    if (section.sectionType === "fieldMapping") {
      for (const mappingSet of project.mappingSets) {
        const sourceProfile = project.profiles.find((p) => p.id === mappingSet.sourceProfileId);
        const destinationProfile = project.profiles.find((p) => p.id === mappingSet.destinationProfileId);
        if (!sourceProfile || !destinationProfile) continue;
        const sheet = workbook.addWorksheet(safeSheetName(mappingSet.name));
        writeRows(sheet, standardMappingRows(mappingSet, sourceProfile, destinationProfile));
      }
    }
  }

  if (opts.includeSampleData) buildStandardSampleData(workbook, project);
  if (opts.includeXmlPreview) buildStandardXmlPreview(workbook, project);
  if (opts.includeQualityReport) buildStandardQualityReport(workbook, project);
  if (opts.includeChecklist) buildStandardChecklist(workbook, project);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function addSheetFromData(workbook: ExcelJS.Workbook, data: ExportSheetData): void {
  const sheet = workbook.addWorksheet(safeSheetName(data.sheetName));
  const rows: RowValues[] = [data.headers, ...data.rows];
  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

// ─── Standard English Template ───────────────────────────────────────────────

function buildStandardTemplate(
  workbook: ExcelJS.Workbook,
  project: Project,
  opts: FmdExportOptions,
) {
  buildStandardCover(workbook, project);
  buildStandardDocumentLog(workbook, project);
  buildStandardIntegrationOverview(workbook, project);

  for (const mappingSet of project.mappingSets) {
    const sourceProfile = project.profiles.find((p) => p.id === mappingSet.sourceProfileId);
    const destinationProfile = project.profiles.find((p) => p.id === mappingSet.destinationProfileId);
    if (!sourceProfile || !destinationProfile) continue;
    const sheet = workbook.addWorksheet(safeSheetName(mappingSet.name));
    writeRows(sheet, standardMappingRows(mappingSet, sourceProfile, destinationProfile));
  }

  if (opts.includeSampleData) buildStandardSampleData(workbook, project);
  if (opts.includeXmlPreview) buildStandardXmlPreview(workbook, project);
  if (opts.includeQualityReport) buildStandardQualityReport(workbook, project);
  if (opts.includeChecklist) buildStandardChecklist(workbook, project);

  buildStandardJobAndErrorHandling(workbook, project);
  buildStandardProcessFlow(workbook, project);
}

function buildStandardCover(workbook: ExcelJS.Workbook, project: Project) {
  const cover = workbook.addWorksheet("Cover");
  writeRows(cover, [
    ["Functional Mapping Document"],
    [],
    ["Process ID", project.processId],
    ["Process Name", project.name],
    ["Status", project.status],
    ["Owner", project.owner],
    ["Source System", project.sourceSystem],
    ["Destination System", project.destinationSystem],
    ["Schedule", project.schedule ?? ""],
    ["Description", project.description],
    [],
    ["Generated", new Date().toISOString().slice(0, 16)],
    ["Tool", "Boomi Helper Suite"],
  ]);
  setColumns(cover, [24, 90]);
  styleHeaderRow(cover, 1);
}

function buildStandardDocumentLog(workbook: ExcelJS.Workbook, project: Project) {
  const logSheet = workbook.addWorksheet("Document Log");
  const logRows = [
    ["Date", "Name", "Version", "Revision", "Nature of Change"],
    ...standardDocumentLogRows(project.fmdSections),
  ];
  writeRows(logSheet, logRows);
  styleHeaderRow(logSheet, 1);
}

function buildStandardIntegrationOverview(workbook: ExcelJS.Workbook, project: Project) {
  const overviewRows = [
    ["Section", "Detail"],
    ["Overview", project.description],
    ["Source", project.sourceSystem],
    ["Destination", project.destinationSystem],
    ["Schedule", project.schedule ?? ""],
    ["Owner", project.owner],
    ["Status", project.status],
    [],
    ["Endpoint", "Role", "Connector Type", "Profile Type", "Format", "Purpose", "Connection Info"],
    ...project.endpoints.map((ep) => [
      ep.name, ep.role, ep.connectorType, ep.profileType, ep.format, ep.purpose, ep.connectionInfo,
    ]),
  ];
  const overview = workbook.addWorksheet("Integration Overview");
  writeRows(overview, overviewRows);
  styleHeaderRow(overview, 1);
  styleHeaderRow(overview, 9);
}

function standardMappingRows(mappingSet: MappingSet, source: Profile, destination: Profile): RowValues[] {
  const sourceById = new Map(source.fields.map((f) => [f.id, f]));
  const rows: RowValues[] = [
    ["Source System", source.name, "", "", "", "Destination System", destination.name],
    ["Source Type", source.type, source.format, "", "", "Destination Type", destination.type],
    [],
    [
      "Source Parent", "Source Field", "Source Description", "Source Type", "Mapping",
      "Destination Parent", "Destination Field", "Destination Description", "Destination Type",
      "Required", "Comment",
    ],
  ];

  for (const rule of mappingSet.rules) {
    const src = rule.sourceFieldId ? sourceById.get(rule.sourceFieldId) : undefined;
    const dst = destination.fields.find((f) => f.id === rule.destinationFieldId);
    rows.push([
      src?.parentPath ?? "",
      src?.name ?? "",
      src?.description ?? src?.label ?? "",
      src?.dataType ?? "",
      rule.expression ?? rule.defaultValue ?? rule.mappingType,
      dst?.parentPath ?? "",
      dst?.name ?? "",
      dst?.description ?? dst?.label ?? "",
      dst?.dataType ?? "",
      dst?.required ? "Mandatory" : "Optional",
      rule.comment ?? "",
    ]);
  }

  return rows;
}

function buildStandardSampleData(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Sample Data");
  const rows: RowValues[] = [["Profile", "Role", "Field", "Sample Value"]];

  for (const profile of project.profiles) {
    for (const field of profile.fields.filter((f) => f.sample).slice(0, 20)) {
      rows.push([profile.name, profile.role, field.name, field.sample]);
    }
  }

  if (rows.length === 1) {
    rows.push(["—", "—", "No sample data available", "—"]);
  }

  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

function buildStandardXmlPreview(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Boomi XML Preview");
  const rows: RowValues[] = [
    ["Component", "Component ID", "Template XML", "Proposed XML", "Validation Status"],
    ...project.boomiDrafts.map((d) => [
      d.componentName,
      d.componentId ?? "—",
      d.templateXml ? d.templateXml.slice(0, 2000) : "—",
      d.proposedXml.slice(0, 2000),
      d.validationStatus,
    ]),
  ];

  if (rows.length === 1) {
    rows.push(["—", "—", "No Boomi drafts available", "—", "—"]);
  }

  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

function buildStandardQualityReport(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Quality Report");
  const rows: RowValues[] = [["Mapping Set", "Score", "Errors", "Warnings", "Detail"]];

  for (const mappingSet of project.mappingSets) {
    const sourceProfile = project.profiles.find((p) => p.id === mappingSet.sourceProfileId);
    const destinationProfile = project.profiles.find((p) => p.id === mappingSet.destinationProfileId);
    if (!sourceProfile || !destinationProfile) continue;

    const issues = validateMappingSet(mappingSet, sourceProfile, destinationProfile);
    const score = qualityScore(issues);
    const errors = issues.filter((i) => i.severity === "error").length;
    const warnings = issues.filter((i) => i.severity === "warning").length;

    rows.push([
      mappingSet.name,
      `${score}%`,
      errors,
      warnings,
      issues.filter((i) => i.severity !== "info").slice(0, 5).map((i) => `[${i.severity}] ${i.title}: ${i.detail}`).join("\n"),
    ]);
  }

  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

function buildStandardChecklist(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Deployment Checklist");
  const mappingSet = project.mappingSets[0];
  const sourceProfile = mappingSet ? project.profiles.find((p) => p.id === mappingSet.sourceProfileId) : undefined;
  const destinationProfile = mappingSet ? project.profiles.find((p) => p.id === mappingSet.destinationProfileId) : undefined;
  const issues = mappingSet && sourceProfile && destinationProfile ? validateMappingSet(mappingSet, sourceProfile, destinationProfile) : [];

  const items: Array<[string, boolean, string]> = [
    ["FMD sections normalized", project.fmdSections.length > 0, `${project.fmdSections.length} sections`],
    ["Source profile defined", Boolean(sourceProfile), sourceProfile?.name ?? "Missing"],
    ["Destination profile defined", Boolean(destinationProfile), destinationProfile?.name ?? "Missing"],
    ["Mapping rules exist", (mappingSet?.rules.length ?? 0) > 0, `${mappingSet?.rules.length ?? 0} rules`],
    ["Required destinations mapped", !issues.some((i) => i.id.startsWith("unmapped")), `${issues.filter((i) => i.id.startsWith("unmapped")).length} unmapped`],
    ["No duplicate destinations", !issues.some((i) => i.id.startsWith("duplicate")), `${issues.filter((i) => i.id.startsWith("duplicate")).length} duplicates`],
    ["No type mismatches", !issues.some((i) => i.id.startsWith("type-mismatch")), `${issues.filter((i) => i.id.startsWith("type-mismatch")).length} mismatches`],
    ["Boomi XML template attached", project.boomiDrafts.some((d) => d.templateXml), `${project.boomiDrafts.filter((d) => d.templateXml).length} templates`],
    ["Process flow defined", project.processFlows.length > 0, `${project.processFlows.length} flows`],
    ["Endpoints configured", project.endpoints.length > 0, `${project.endpoints.length} endpoints`],
  ];

  const rows: RowValues[] = [["Item", "Status", "Detail"], ...items.map(([item, ok, detail]) => [item, ok ? "✓" : "✗", detail])];
  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

function buildStandardJobAndErrorHandling(workbook: ExcelJS.Workbook, project: Project) {
  const job = workbook.addWorksheet("Job and Error Handling");
  const jobRows = [
    ["Item", "Value"],
    ["Schedule", project.schedule ?? ""],
    ["Boomi API mode", project.boomiConnections[0]?.mode ?? "mock"],
    ["Deployment rule", "Dry-run only until a valid exported Boomi XML template is provided."],
    ["Retry policy", readSection(project.fmdSections, "jobHandling", "retryPolicy")],
    ["Notifications", readSection(project.fmdSections, "jobHandling", "notifications")],
  ];
  writeRows(job, jobRows);
  styleHeaderRow(job, 1);
}

function buildStandardProcessFlow(workbook: ExcelJS.Workbook, project: Project) {
  const flow = project.processFlows[0];
  if (!flow) return;
  const flowSheet = workbook.addWorksheet("Process Flow");
  const flowRows = [
    ["Step", "Type", "Title", "Description"],
    ...flow.nodes.map((node, index) => [index + 1, node.type, node.label, node.description]),
    [],
    ["Edge", "Source", "Target", "Condition"],
    ...flow.edges.map((edge) => [edge.id, edge.source, edge.target, edge.label ?? ""]),
  ];
  writeRows(flowSheet, flowRows);
  styleHeaderRow(flowSheet, 1);
  styleHeaderRow(flowSheet, 4 + flow.nodes.length);
}

// ─── Japanese Style Template ─────────────────────────────────────────────────

function buildJapaneseTemplate(
  workbook: ExcelJS.Workbook,
  project: Project,
  opts: FmdExportOptions,
) {
  buildJapaneseCover(workbook, project);
  buildJapaneseDocumentLog(workbook, project);
  buildJapaneseIntegrationOverview(workbook, project);

  for (const mappingSet of project.mappingSets) {
    const sourceProfile = project.profiles.find((p) => p.id === mappingSet.sourceProfileId);
    const destinationProfile = project.profiles.find((p) => p.id === mappingSet.destinationProfileId);
    if (!sourceProfile || !destinationProfile) continue;
    const sheet = workbook.addWorksheet(safeSheetName(`マッピング_${mappingSet.name}`));
    writeRows(sheet, japaneseMappingRows(mappingSet, sourceProfile, destinationProfile));
  }

  if (opts.includeSampleData) buildJapaneseSampleData(workbook, project);
  if (opts.includeXmlPreview) buildJapaneseXmlPreview(workbook, project);
  if (opts.includeQualityReport) buildJapaneseQualityReport(workbook, project);
  if (opts.includeChecklist) buildJapaneseChecklist(workbook, project);

  buildJapaneseJobAndErrorHandling(workbook, project);
  buildJapaneseProcessFlow(workbook, project);
}

function buildJapaneseCover(workbook: ExcelJS.Workbook, project: Project) {
  const cover = workbook.addWorksheet("表紙");
  writeRows(cover, [
    ["機能設計書（FMD）"],
    [],
    ["プロセスID", project.processId],
    ["プロセス名", project.name],
    ["ステータス", project.status],
    ["担当者", project.owner],
    ["連携元システム", project.sourceSystem],
    ["連携先システム", project.destinationSystem],
    ["スケジュール", project.schedule ?? ""],
    ["概要", project.description],
    [],
    ["出力日時", new Date().toISOString().slice(0, 16)],
    ["出力ツール", "Boomi Helper Suite"],
  ]);
  setColumns(cover, [24, 90]);
  styleHeaderRow(cover, 1);
}

function buildJapaneseDocumentLog(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("修正履歴");
  const rows: RowValues[] = [
    ["日付", "名前", "バージョン", "改訂", "変更内容"],
    ...japaneseDocumentLogRows(project.fmdSections),
  ];
  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

function buildJapaneseIntegrationOverview(workbook: ExcelJS.Workbook, project: Project) {
  const rows: RowValues[] = [
    ["項目", "内容"],
    ["概要", project.description],
    ["連携元", project.sourceSystem],
    ["連携先", project.destinationSystem],
    ["スケジュール", project.schedule ?? ""],
    ["担当者", project.owner],
    ["ステータス", project.status],
    [],
    ["エンドポイント名", "役割", "コネクター種別", "プロファイル種別", "形式", "用途", "接続情報"],
    ...project.endpoints.map((ep) => [
      ep.name, ep.role, ep.connectorType, ep.profileType, ep.format, ep.purpose, ep.connectionInfo,
    ]),
  ];
  const sheet = workbook.addWorksheet("連携概要");
  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
  styleHeaderRow(sheet, 9);
}

function japaneseMappingRows(mappingSet: MappingSet, source: Profile, destination: Profile): RowValues[] {
  const sourceById = new Map(source.fields.map((f) => [f.id, f]));
  const rows: RowValues[] = [
    ["送信元システム", source.name, "", "", "", "送信先システム", destination.name],
    ["送信元種別", source.type, source.format, "", "", "送信先種別", destination.type],
    [],
    [
      "送信元親要素", "送信元項目", "送信元説明", "送信元型", "変換仕様",
      "送信先親要素", "送信先項目", "送信先説明", "送信先型",
      "必須", "コメント",
    ],
  ];

  for (const rule of mappingSet.rules) {
    const src = rule.sourceFieldId ? sourceById.get(rule.sourceFieldId) : undefined;
    const dst = destination.fields.find((f) => f.id === rule.destinationFieldId);
    rows.push([
      src?.parentPath ?? "",
      src?.name ?? "",
      src?.description ?? src?.label ?? "",
      src?.dataType ?? "",
      rule.expression ?? rule.defaultValue ?? rule.mappingType,
      dst?.parentPath ?? "",
      dst?.name ?? "",
      dst?.description ?? dst?.label ?? "",
      dst?.dataType ?? "",
      dst?.required ? "必須" : "任意",
      rule.comment ?? "",
    ]);
  }

  return rows;
}

function buildJapaneseSampleData(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("サンプルデータ");
  const rows: RowValues[] = [["プロファイル", "役割", "項目", "サンプル値"]];

  for (const profile of project.profiles) {
    for (const field of profile.fields.filter((f) => f.sample).slice(0, 20)) {
      rows.push([profile.name, profile.role, field.name, field.sample]);
    }
  }

  if (rows.length === 1) {
    rows.push(["—", "—", "サンプルデータなし", "—"]);
  }

  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

function buildJapaneseXmlPreview(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Boomi XMLプレビュー");
  const rows: RowValues[] = [
    ["コンポーネント", "コンポーネントID", "テンプレートXML", "提案XML", "検証ステータス"],
    ...project.boomiDrafts.map((d) => [
      d.componentName,
      d.componentId ?? "—",
      d.templateXml ? d.templateXml.slice(0, 2000) : "—",
      d.proposedXml.slice(0, 2000),
      d.validationStatus,
    ]),
  ];

  if (rows.length === 1) {
    rows.push(["—", "—", "Boomiドラフトなし", "—", "—"]);
  }

  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

function buildJapaneseQualityReport(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("品質レポート");
  const rows: RowValues[] = [["マッピングセット", "スコア", "エラー", "警告", "詳細"]];

  for (const mappingSet of project.mappingSets) {
    const sourceProfile = project.profiles.find((p) => p.id === mappingSet.sourceProfileId);
    const destinationProfile = project.profiles.find((p) => p.id === mappingSet.destinationProfileId);
    if (!sourceProfile || !destinationProfile) continue;

    const issues = validateMappingSet(mappingSet, sourceProfile, destinationProfile);
    const score = qualityScore(issues);
    const errors = issues.filter((i) => i.severity === "error").length;
    const warnings = issues.filter((i) => i.severity === "warning").length;

    rows.push([
      mappingSet.name,
      `${score}%`,
      errors,
      warnings,
      issues.filter((i) => i.severity !== "info").slice(0, 5).map((i) => `[${i.severity}] ${i.title}: ${i.detail}`).join("\n"),
    ]);
  }

  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

function buildJapaneseChecklist(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("デプロイチェックリスト");
  const mappingSet = project.mappingSets[0];
  const sourceProfile = mappingSet ? project.profiles.find((p) => p.id === mappingSet.sourceProfileId) : undefined;
  const destinationProfile = mappingSet ? project.profiles.find((p) => p.id === mappingSet.destinationProfileId) : undefined;
  const issues = mappingSet && sourceProfile && destinationProfile ? validateMappingSet(mappingSet, sourceProfile, destinationProfile) : [];

  const items: Array<[string, boolean, string]> = [
    ["FMDセクション正規化済み", project.fmdSections.length > 0, `${project.fmdSections.length} セクション`],
    ["送信元プロファイル定義済み", Boolean(sourceProfile), sourceProfile?.name ?? "未定義"],
    ["送信先プロファイル定義済み", Boolean(destinationProfile), destinationProfile?.name ?? "未定義"],
    ["マッピングルール存在", (mappingSet?.rules.length ?? 0) > 0, `${mappingSet?.rules.length ?? 0} ルール`],
    ["必須送信先マッピング済み", !issues.some((i) => i.id.startsWith("unmapped")), `${issues.filter((i) => i.id.startsWith("unmapped")).length} 未マッピング`],
    ["重複送信先なし", !issues.some((i) => i.id.startsWith("duplicate")), `${issues.filter((i) => i.id.startsWith("duplicate")).length} 重複`],
    ["型不一致なし", !issues.some((i) => i.id.startsWith("type-mismatch")), `${issues.filter((i) => i.id.startsWith("type-mismatch")).length} 不一致`],
    ["Boomi XMLテンプレート添付", project.boomiDrafts.some((d) => d.templateXml), `${project.boomiDrafts.filter((d) => d.templateXml).length} テンプレート`],
    ["プロセスフロー定義済み", project.processFlows.length > 0, `${project.processFlows.length} フロー`],
    ["エンドポイント設定済み", project.endpoints.length > 0, `${project.endpoints.length} エンドポイント`],
  ];

  const rows: RowValues[] = [["項目", "状態", "詳細"], ...items.map(([item, ok, detail]) => [item, ok ? "✓" : "✗", detail])];
  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

function buildJapaneseJobAndErrorHandling(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("ジョブ・エラー処理");
  const rows: RowValues[] = [
    ["項目", "値"],
    ["スケジュール", project.schedule ?? ""],
    ["Boomi APIモード", project.boomiConnections[0]?.mode ?? "mock"],
    ["デプロイルール", "エクスポート済みの有効なBoomi XMLテンプレートが提供されるまでドライランのみ"],
    ["リトライポリシー", readSection(project.fmdSections, "jobHandling", "retryPolicy")],
    ["通知", readSection(project.fmdSections, "jobHandling", "notifications")],
  ];
  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

function buildJapaneseProcessFlow(workbook: ExcelJS.Workbook, project: Project) {
  const flow = project.processFlows[0];
  if (!flow) return;
  const sheet = workbook.addWorksheet("プロセスフロー");
  const rows: RowValues[] = [
    ["ステップ", "種別", "タイトル", "説明"],
    ...flow.nodes.map((node, index) => [index + 1, node.type, node.label, node.description]),
    [],
    ["エッジ", "ソース", "ターゲット", "条件"],
    ...flow.edges.map((edge) => [edge.id, edge.source, edge.target, edge.label ?? ""]),
  ];
  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
  styleHeaderRow(sheet, 4 + flow.nodes.length);
}

// ─── Boomi Process Design Template ───────────────────────────────────────────

function buildBoomiDesignTemplate(
  workbook: ExcelJS.Workbook,
  project: Project,
  opts: FmdExportOptions,
) {
  buildBoomiDesignCover(workbook, project);
  buildBoomiDesignDocumentLog(workbook, project);
  buildBoomiDesignEnvironment(workbook, project);
  buildBoomiDesignProfileCatalog(workbook, project);

  for (const mappingSet of project.mappingSets) {
    const sourceProfile = project.profiles.find((p) => p.id === mappingSet.sourceProfileId);
    const destinationProfile = project.profiles.find((p) => p.id === mappingSet.destinationProfileId);
    if (!sourceProfile || !destinationProfile) continue;
    const sheet = workbook.addWorksheet(safeSheetName(mappingSet.name));
    writeRows(sheet, boomiDesignMappingRows(mappingSet, sourceProfile, destinationProfile));
  }

  if (opts.includeSampleData) buildBoomiDesignSampleData(workbook, project);
  if (opts.includeXmlPreview) buildBoomiDesignXmlPreview(workbook, project);
  if (opts.includeQualityReport) buildBoomiDesignQualityReport(workbook, project);
  if (opts.includeChecklist) buildBoomiDesignChecklist(workbook, project);

  buildBoomiDesignJobAndErrorHandling(workbook, project);
  buildBoomiDesignProcessFlow(workbook, project);
}

function buildBoomiDesignCover(workbook: ExcelJS.Workbook, project: Project) {
  const cover = workbook.addWorksheet("Cover");
  writeRows(cover, [
    ["Boomi Process Design Document"],
    [],
    ["Process ID", project.processId],
    ["Process Name", project.name],
    ["Status", project.status],
    ["Owner", project.owner],
    ["Source System", project.sourceSystem],
    ["Destination System", project.destinationSystem],
    ["Schedule", project.schedule ?? ""],
    ["Description", project.description],
    [],
    ["Generated", new Date().toISOString().slice(0, 16)],
    ["Tool", "Boomi Helper Suite"],
    ["Version", "1.0"],
  ]);
  setColumns(cover, [28, 86]);
  styleHeaderRow(cover, 1);
}

function buildBoomiDesignDocumentLog(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Document Log");
  const rows: RowValues[] = [
    ["Date", "Author", "Version", "Revision", "Change Description"],
    ...standardDocumentLogRows(project.fmdSections),
  ];
  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

function buildBoomiDesignEnvironment(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Environment Information");
  const rows: RowValues[] = [
    ["Category", "Detail"],
    ["Process ID", project.processId],
    ["Process Name", project.name],
    ["Source System", project.sourceSystem],
    ["Destination System", project.destinationSystem],
    ["Schedule", project.schedule ?? ""],
    ["Boomi Environment", project.boomiConnections[0]?.environmentName ?? "Not configured"],
    ["Auth Mode", project.boomiConnections[0]?.authMode ?? "mock"],
    [],
    ["Endpoint Name", "Role", "Connector", "Profile Type", "Format", "Purpose", "Connection Info"],
    ...project.endpoints.map((ep) => [
      ep.name, ep.role, ep.connectorType, ep.profileType, ep.format, ep.purpose, ep.connectionInfo,
    ]),
  ];
  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
  styleHeaderRow(sheet, 10);
}

function buildBoomiDesignProfileCatalog(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Profile Catalog");
  const rows: RowValues[] = [
    ["Profile Name", "Role", "Type", "Format", "Root Path", "Field Count", "Fields"],
    ...project.profiles.map((profile) => [
      profile.name,
      profile.role,
      profile.type,
      profile.format,
      profile.rootPath ?? "",
      profile.fields.length,
      profile.fields.map((f) => `${f.name} (${f.dataType}${f.required ? ", req" : ""})`).join(", "),
    ]),
  ];
  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

function boomiDesignMappingRows(mappingSet: MappingSet, source: Profile, destination: Profile): RowValues[] {
  const sourceById = new Map(source.fields.map((f) => [f.id, f]));
  const rows: RowValues[] = [
    ["Source Profile", source.name, "", "", "", "Destination Profile", destination.name],
    ["Source Format", source.format, "", "", "", "Destination Format", destination.format],
    [],
    [
      "Source Parent Path",
      "Source Field Name",
      "Source Data Type",
      "Source Length",
      "Source Format",
      "Transformation / Mapping Logic",
      "Default Value",
      "Destination Parent Path",
      "Destination Field Name",
      "Destination Data Type",
      "Destination Length",
      "Required",
      "Comment",
    ],
  ];

  for (const rule of mappingSet.rules) {
    const src = rule.sourceFieldId ? sourceById.get(rule.sourceFieldId) : undefined;
    const dst = destination.fields.find((f) => f.id === rule.destinationFieldId);
    rows.push([
      src?.parentPath ?? "",
      src?.name ?? "",
      src?.dataType ?? "",
      src?.length ?? "",
      src?.format ?? "",
      rule.expression ?? rule.mappingType,
      rule.defaultValue ?? "",
      dst?.parentPath ?? "",
      dst?.name ?? "",
      dst?.dataType ?? "",
      dst?.length ?? "",
      dst?.required ? "Yes" : "No",
      rule.comment ?? "",
    ]);
  }

  return rows;
}

function buildBoomiDesignSampleData(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Sample Data");
  const rows: RowValues[] = [["Profile", "Role", "Field", "Data Type", "Sample Value"]];

  for (const profile of project.profiles) {
    for (const field of profile.fields.filter((f) => f.sample).slice(0, 20)) {
      rows.push([profile.name, profile.role, field.name, field.dataType, field.sample]);
    }
  }

  if (rows.length === 1) {
    rows.push(["—", "—", "No sample data available", "—", "—"]);
  }

  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

function buildBoomiDesignXmlPreview(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Boomi XML Preview");
  const rows: RowValues[] = [
    ["Component Type", "Component Name", "Boomi ID", "Template XML", "Proposed XML", "Validation Status"],
    ...project.boomiDrafts.map((d) => [
      d.componentType,
      d.componentName,
      d.componentId ?? "—",
      d.templateXml ? d.templateXml.slice(0, 2000) : "—",
      d.proposedXml.slice(0, 2000),
      d.validationStatus,
    ]),
  ];

  if (rows.length === 1) {
    rows.push(["—", "—", "—", "No Boomi drafts available", "—", "—"]);
  }

  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

function buildBoomiDesignQualityReport(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Quality Report");
  const rows: RowValues[] = [["Mapping Set", "Quality Score", "Errors", "Warnings", "Details"]];

  for (const mappingSet of project.mappingSets) {
    const sourceProfile = project.profiles.find((p) => p.id === mappingSet.sourceProfileId);
    const destinationProfile = project.profiles.find((p) => p.id === mappingSet.destinationProfileId);
    if (!sourceProfile || !destinationProfile) continue;

    const issues = validateMappingSet(mappingSet, sourceProfile, destinationProfile);
    const score = qualityScore(issues);
    const errors = issues.filter((i) => i.severity === "error").length;
    const warnings = issues.filter((i) => i.severity === "warning").length;

    rows.push([
      mappingSet.name,
      `${score}%`,
      errors,
      warnings,
      issues.filter((i) => i.severity !== "info").slice(0, 5).map((i) => `[${i.severity.toUpperCase()}] ${i.title}: ${i.detail}`).join("\n"),
    ]);
  }

  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

function buildBoomiDesignChecklist(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Deployment Checklist");
  const mappingSet = project.mappingSets[0];
  const sourceProfile = mappingSet ? project.profiles.find((p) => p.id === mappingSet.sourceProfileId) : undefined;
  const destinationProfile = mappingSet ? project.profiles.find((p) => p.id === mappingSet.destinationProfileId) : undefined;
  const issues = mappingSet && sourceProfile && destinationProfile ? validateMappingSet(mappingSet, sourceProfile, destinationProfile) : [];

  const items: Array<[string, boolean, string]> = [
    ["FMD sections present", project.fmdSections.length > 0, `${project.fmdSections.length} sections`],
    ["Source profile defined", Boolean(sourceProfile), sourceProfile?.name ?? "Missing"],
    ["Destination profile defined", Boolean(destinationProfile), destinationProfile?.name ?? "Missing"],
    ["Mapping rules defined", (mappingSet?.rules.length ?? 0) > 0, `${mappingSet?.rules.length ?? 0} rules`],
    ["Required fields mapped", !issues.some((i) => i.id.startsWith("unmapped")), `${issues.filter((i) => i.id.startsWith("unmapped")).length} unmapped`],
    ["No duplicate destinations", !issues.some((i) => i.id.startsWith("duplicate")), `${issues.filter((i) => i.id.startsWith("duplicate")).length} duplicates`],
    ["No type mismatches", !issues.some((i) => i.id.startsWith("type-mismatch")), `${issues.filter((i) => i.id.startsWith("type-mismatch")).length} mismatches`],
    ["Boomi XML template available", project.boomiDrafts.some((d) => d.templateXml), `${project.boomiDrafts.filter((d) => d.templateXml).length} templates`],
    ["Process flow defined", project.processFlows.length > 0, `${project.processFlows.length} flows`],
    ["Endpoints configured", project.endpoints.length > 0, `${project.endpoints.length} endpoints`],
    ["Boomi connection configured", project.boomiConnections.length > 0, project.boomiConnections[0]?.environmentName ?? "Not configured"],
  ];

  const rows: RowValues[] = [["Checklist Item", "Pass", "Detail"], ...items.map(([item, ok, detail]) => [item, ok ? "PASS" : "FAIL", detail])];
  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

function buildBoomiDesignJobAndErrorHandling(workbook: ExcelJS.Workbook, project: Project) {
  const sheet = workbook.addWorksheet("Job & Error Handling");
  const rows: RowValues[] = [
    ["Configuration", "Value"],
    ["Schedule", project.schedule ?? ""],
    ["Boomi Environment", project.boomiConnections[0]?.environmentName ?? "Not configured"],
    ["Auth Mode", project.boomiConnections[0]?.authMode ?? "mock"],
    ["Deployment Rule", "Dry-run only until a valid exported Boomi XML template is provided."],
    ["Retry Policy", readSection(project.fmdSections, "jobHandling", "retryPolicy")],
    ["Error Notifications", readSection(project.fmdSections, "jobHandling", "notifications")],
  ];
  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
}

function buildBoomiDesignProcessFlow(workbook: ExcelJS.Workbook, project: Project) {
  const flow = project.processFlows[0];
  if (!flow) return;
  const sheet = workbook.addWorksheet("Process Flow");
  const rows: RowValues[] = [
    ["Step #", "Node Type", "Label", "Description"],
    ...flow.nodes.map((node, index) => [index + 1, node.type, node.label, node.description]),
    [],
    ["Edge ID", "Source Node", "Target Node", "Condition / Label"],
    ...flow.edges.map((edge) => [edge.id, edge.source, edge.target, edge.label ?? ""]),
  ];
  writeRows(sheet, rows);
  styleHeaderRow(sheet, 1);
  styleHeaderRow(sheet, 4 + flow.nodes.length);
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

function writeRows(worksheet: ExcelJS.Worksheet, rows: RowValues[]) {
  rows.forEach((row) => worksheet.addRow(row));
  styleWorksheet(worksheet, rows);
}

function styleWorksheet(worksheet: ExcelJS.Worksheet, rows: RowValues[]) {
  const widths = rows[0]?.map((_, columnIndex) => {
    const max = rows.reduce((current, row) => {
      const value = String(row[columnIndex] ?? "");
      return Math.max(current, Math.min(value.length, 52));
    }, 12);
    return Math.max(12, max + 2);
  });

  setColumns(worksheet, widths ?? []);
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFD9DED8" } },
        left: { style: "thin", color: { argb: "FFD9DED8" } },
        bottom: { style: "thin", color: { argb: "FFD9DED8" } },
        right: { style: "thin", color: { argb: "FFD9DED8" } },
      };
    });
  });
}

function styleHeaderRow(worksheet: ExcelJS.Worksheet, rowNumber: number) {
  const row = worksheet.getRow(rowNumber);
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FF1B1F23" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEFF3EF" },
    };
  });
}

function setColumns(worksheet: ExcelJS.Worksheet, widths: number[]) {
  worksheet.columns = widths.map((width) => ({ width }));
}

function safeSheetName(name: string) {
  return name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
}

function standardDocumentLogRows(sections: FmdSection[]) {
  const log = sections.find((section) => section.sectionType === "documentLog");
  const rows = (log?.content.rows as Array<Record<string, string>> | undefined) ?? [];
  if (rows.length === 0) {
    return [[new Date().toISOString().slice(0, 10), "Boomi Helper Suite", "1.0", "0", "Generated"]];
  }
  return rows.map((row) => [row.date, row.name, row.version, row.revision, row.change]);
}

function japaneseDocumentLogRows(sections: FmdSection[]) {
  const rows = standardDocumentLogRows(sections);
  return rows.map((row) => [
    row[0], row[1], row[2], row[3], row[4],
  ]);
}

function readSection(sections: FmdSection[], type: FmdSection["sectionType"], key: string) {
  const value = sections.find((section) => section.sectionType === type)?.content[key];
  return typeof value === "string" ? value : "";
}
