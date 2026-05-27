import ExcelJS from "exceljs";
import type { FmdSection, MappingSet, Profile, Project } from "@/lib/domain";

type RowValue = string | number | boolean | null | undefined;
type RowValues = RowValue[];

export type NormalizedFmdWorkbook = {
  filename: string;
  sheets: Array<{
    name: string;
    rowCount: number;
    columnCount: number;
    role:
      | "documentLog"
      | "explanation"
      | "overview"
      | "fieldMapping"
      | "environment"
      | "jobHandling"
      | "sample"
      | "reference";
    headers: string[];
  }>;
  mappingSheets: number;
  designSections: number;
};

const roleMatchers: Array<[NormalizedFmdWorkbook["sheets"][number]["role"], RegExp]> = [
  ["documentLog", /document log|修正履歴/i],
  ["fieldMapping", /field mapping|マッピング/i],
  ["explanation", /explanation|説明/i],
  ["overview", /overview|連携概要|連携IF設計|process/i],
  ["environment", /environment|環境|endpoint|エンドポイント|api仕様/i],
  ["jobHandling", /job|ジョブ|error|エラー/i],
  ["sample", /sample|テストファイル|json|csv/i],
  ["reference", /reference|参考|補足/i],
];

function detectRole(name: string) {
  return roleMatchers.find(([, pattern]) => pattern.test(name))?.[0] ?? "reference";
}

function extractHeaders(rows: RowValues[]) {
  const candidate = rows
    .slice(0, 15)
    .find((row) => row.filter((cell) => String(cell ?? "").trim()).length >= 3);
  return (candidate ?? [])
    .map((cell) => String(cell ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 12);
}

export async function normalizeFmdWorkbook(
  buffer: Buffer | ArrayBuffer,
  filename = "uploaded.xlsx",
) {
  const workbook = new ExcelJS.Workbook();
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  await workbook.xlsx.load(input as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const sheets = workbook.worksheets.map((worksheet) => {
    const rows: RowValues[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values: RowValues = [];
      for (let column = 1; column <= worksheet.actualColumnCount; column += 1) {
        values.push(normalizeCellValue(row.getCell(column).value));
      }
      if (values.some((cell) => String(cell ?? "").trim())) {
        rows.push(trimTrailingEmptyCells(values));
      }
    });

    const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
    return {
      name: worksheet.name,
      rowCount: rows.length,
      columnCount,
      role: detectRole(worksheet.name),
      headers: extractHeaders(rows),
    };
  });

  return {
    filename,
    sheets,
    mappingSheets: sheets.filter((sheet) => sheet.role === "fieldMapping").length,
    designSections: sheets.filter((sheet) =>
      ["explanation", "overview", "environment", "jobHandling"].includes(sheet.role),
    ).length,
  } satisfies NormalizedFmdWorkbook;
}

export async function createFmdWorkbook(project: Project) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Boomi Helper Suite";
  workbook.created = new Date();
  workbook.subject = "Boomi functional mapping document";
  workbook.title = `${project.processId} ${project.name} FMD`;

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
  ]);
  setColumns(cover, [24, 90]);

  const logRows = [
    ["Date", "Name", "Version", "Revision", "Nature of Change"],
    ...documentLogRows(project.fmdSections),
  ];
  const logSheet = workbook.addWorksheet("Document Log");
  writeRows(logSheet, logRows);

  const overviewRows = [
    ["Section", "Detail"],
    ["Overview", project.description],
    ["Source", project.sourceSystem],
    ["Destination", project.destinationSystem],
    ["Schedule", project.schedule ?? ""],
    [],
    ["Endpoint", "Role", "Connector Type", "Profile Type", "Format", "Purpose", "Connection Info"],
    ...project.endpoints.map((endpoint) => [
      endpoint.name,
      endpoint.role,
      endpoint.connectorType,
      endpoint.profileType,
      endpoint.format,
      endpoint.purpose,
      endpoint.connectionInfo,
    ]),
  ];
  const overview = workbook.addWorksheet("Integration Overview");
  writeRows(overview, overviewRows);

  for (const mappingSet of project.mappingSets) {
    const sourceProfile = project.profiles.find((profile) => profile.id === mappingSet.sourceProfileId);
    const destinationProfile = project.profiles.find(
      (profile) => profile.id === mappingSet.destinationProfileId,
    );
    if (!sourceProfile || !destinationProfile) continue;
    const sheet = workbook.addWorksheet(safeSheetName(mappingSet.name));
    writeRows(sheet, mappingRows(mappingSet, sourceProfile, destinationProfile));
  }

  const flow = project.processFlows[0];
  if (flow) {
    const flowRows = [
      ["Step", "Type", "Title", "Description"],
      ...flow.nodes.map((node, index) => [index + 1, node.type, node.label, node.description]),
      [],
      ["Edge", "Source", "Target", "Condition"],
      ...flow.edges.map((edge) => [edge.id, edge.source, edge.target, edge.label ?? ""]),
    ];
    const flowSheet = workbook.addWorksheet("Process Flow");
    writeRows(flowSheet, flowRows);
  }

  const jobRows = [
    ["Item", "Value"],
    ["Schedule", project.schedule ?? ""],
    ["Boomi API mode", project.boomiConnections[0]?.mode ?? "mock"],
    ["Deployment rule", "Dry-run only until a valid exported Boomi XML template is provided."],
    ["Retry policy", readSection(project.fmdSections, "jobHandling", "retryPolicy")],
    ["Notifications", readSection(project.fmdSections, "jobHandling", "notifications")],
  ];
  const job = workbook.addWorksheet("Job and Error Handling");
  writeRows(job, jobRows);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function mappingRows(mappingSet: MappingSet, sourceProfile: Profile, destinationProfile: Profile) {
  const sourceById = new Map(sourceProfile.fields.map((field) => [field.id, field]));
  const rows: RowValues[] = [
    ["Source System", sourceProfile.name, "", "", "", "Destination System", destinationProfile.name],
    ["Source Type", sourceProfile.type, sourceProfile.format, "", "", "Destination Type", destinationProfile.type],
    [],
    [
      "Source Parent",
      "Source Field",
      "Source Description",
      "Source Type",
      "Mapping",
      "Destination Parent",
      "Destination Field",
      "Destination Description",
      "Destination Type",
      "Required",
      "Comment",
    ],
  ];

  for (const rule of mappingSet.rules) {
    const source = rule.sourceFieldId ? sourceById.get(rule.sourceFieldId) : undefined;
    const destination = destinationProfile.fields.find((field) => field.id === rule.destinationFieldId);
    rows.push([
      source?.parentPath ?? "",
      source?.name ?? "",
      source?.description ?? source?.label ?? "",
      source?.dataType ?? "",
      rule.expression ?? rule.defaultValue ?? rule.mappingType,
      destination?.parentPath ?? "",
      destination?.name ?? "",
      destination?.description ?? destination?.label ?? "",
      destination?.dataType ?? "",
      destination?.required ? "Mandatory" : "Optional",
      rule.comment ?? "",
    ]);
  }

  return rows;
}

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
  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFD9DED8" } },
        left: { style: "thin", color: { argb: "FFD9DED8" } },
        bottom: { style: "thin", color: { argb: "FFD9DED8" } },
        right: { style: "thin", color: { argb: "FFD9DED8" } },
      };
      if (rowNumber === 1 || String(cell.value ?? "").match(/^(Source|Endpoint|Step|Item|Date)$/)) {
        cell.font = { bold: true, color: { argb: "FF1B1F23" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFEFF3EF" },
        };
      }
    });
  });
}

function setColumns(worksheet: ExcelJS.Worksheet, widths: number[]) {
  worksheet.columns = widths.map((width) => ({ width }));
}

function documentLogRows(sections: FmdSection[]) {
  const log = sections.find((section) => section.sectionType === "documentLog");
  const rows = (log?.content.rows as Array<Record<string, string>> | undefined) ?? [];
  if (rows.length === 0) {
    return [[new Date().toISOString().slice(0, 10), "Boomi Helper Suite", "1.0", "0", "Generated"]];
  }
  return rows.map((row) => [row.date, row.name, row.version, row.revision, row.change]);
}

function readSection(sections: FmdSection[], type: FmdSection["sectionType"], key: string) {
  const value = sections.find((section) => section.sectionType === type)?.content[key];
  return typeof value === "string" ? value : "";
}

function safeSheetName(name: string) {
  return name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
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

function trimTrailingEmptyCells(values: RowValues) {
  const copy = [...values];
  while (copy.length > 0 && !String(copy[copy.length - 1] ?? "").trim()) {
    copy.pop();
  }
  return copy;
}

export function appendImportSummary(project: Project, summary: NormalizedFmdWorkbook): Project {
  return {
    ...project,
    fmdSections: [
      ...project.fmdSections.filter((section) => section.id !== "fmd-last-import"),
      {
        id: "fmd-last-import",
        title: "Last FMD Import",
        sectionType: "reference",
        sortOrder: 99,
        content: summary as unknown as Record<string, unknown>,
      },
    ],
  };
}
