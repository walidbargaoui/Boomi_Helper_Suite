import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFmdWorkbook, normalizeFmdWorkbook } from "@/lib/fmd";
import { sampleProject } from "@/lib/sample-data";

const sampleFiles = [
  "/Users/walidbargaoui/Documents/Downloads for Chrome/Boomi設計書_SRSN001_セーレン商事_受注_in.xlsx",
  "/Users/walidbargaoui/Documents/Downloads for Chrome/FMD_To_SFs_Phone_v1.7.xlsx",
  "/Users/walidbargaoui/Documents/Downloads for Chrome/【販売管理】FMD_IFID043_SMSO_TO_TOPS_EBK_FILE_DAILY(通告管理)_v1.00.xlsx",
  "/Users/walidbargaoui/Documents/Downloads for Chrome/G06 - Employee Expense FMD V1.3.xlsx",
  "/Users/walidbargaoui/Documents/Downloads for Chrome/FMD_sheet_FOX_算定結果ステータス・業務日付更新.xlsx",
];

describe("FMD workbook normalization", () => {
  it.each(sampleFiles)("classifies workbook structure for %s", async (filePath) => {
    const summary = await normalizeFmdWorkbook(readFileSync(filePath), filePath);

    expect(summary.sheets.length).toBeGreaterThan(0);
    expect(summary.designSections + summary.mappingSheets).toBeGreaterThan(0);
    expect(summary.sheets.some((sheet) => sheet.role === "fieldMapping")).toBe(true);
  });

  it("exports and re-imports the generated FMD workbook", async () => {
    const exported = await createFmdWorkbook(sampleProject);
    const summary = await normalizeFmdWorkbook(exported, "generated.xlsx");

    expect(summary.sheets.map((sheet) => sheet.name)).toContain("Document Log");
    expect(summary.sheets.some((sheet) => sheet.name.includes("Seiren TSV"))).toBe(true);
  });
});
