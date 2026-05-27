import { describe, expect, it } from "vitest";
import { createFmdWorkbookWithTemplate } from "@/lib/fmd-export";
import { sampleProject } from "@/lib/sample-data";

describe("fmd export templates", () => {
  it("creates a standard English workbook", async () => {
    const buffer = await createFmdWorkbookWithTemplate(sampleProject, { template: "standard" });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("creates a Japanese style workbook", async () => {
    const buffer = await createFmdWorkbookWithTemplate(sampleProject, { template: "japanese" });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("creates a Boomi process design workbook", async () => {
    const buffer = await createFmdWorkbookWithTemplate(sampleProject, { template: "boomi-design" });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("standard template includes sample data when requested", async () => {
    const buffer = await createFmdWorkbookWithTemplate(sampleProject, {
      template: "standard",
      includeSampleData: true,
    });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("standard template includes quality report when requested", async () => {
    const buffer = await createFmdWorkbookWithTemplate(sampleProject, {
      template: "standard",
      includeQualityReport: true,
    });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("standard template includes checklist when requested", async () => {
    const buffer = await createFmdWorkbookWithTemplate(sampleProject, {
      template: "standard",
      includeChecklist: true,
    });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("standard template includes XML preview when requested", async () => {
    const buffer = await createFmdWorkbookWithTemplate(sampleProject, {
      template: "standard",
      includeXmlPreview: true,
    });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("Japanese template includes all options", async () => {
    const buffer = await createFmdWorkbookWithTemplate(sampleProject, {
      template: "japanese",
      includeSampleData: true,
      includeXmlPreview: true,
      includeQualityReport: true,
      includeChecklist: true,
    });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("Boomi design template includes all options", async () => {
    const buffer = await createFmdWorkbookWithTemplate(sampleProject, {
      template: "boomi-design",
      includeSampleData: true,
      includeXmlPreview: true,
      includeQualityReport: true,
      includeChecklist: true,
    });
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("uses default template when options are empty", async () => {
    const buffer = await createFmdWorkbookWithTemplate(sampleProject, {});
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("standard template workbook has expected sheet names", async () => {
    const buffer = await createFmdWorkbookWithTemplate(sampleProject, { template: "standard" });
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheetNames = workbook.worksheets.map((ws) => ws.name);
    expect(sheetNames).toContain("Cover");
    expect(sheetNames).toContain("Document Log");
    expect(sheetNames).toContain("Integration Overview");
    expect(sheetNames).toContain("Job and Error Handling");
  });

  it("Japanese template workbook has expected sheet names", async () => {
    const buffer = await createFmdWorkbookWithTemplate(sampleProject, { template: "japanese" });
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheetNames = workbook.worksheets.map((ws) => ws.name);
    expect(sheetNames).toContain("表紙");
    expect(sheetNames).toContain("修正履歴");
    expect(sheetNames).toContain("連携概要");
    expect(sheetNames).toContain("ジョブ・エラー処理");
  });

  it("Boomi design template workbook has expected sheet names", async () => {
    const buffer = await createFmdWorkbookWithTemplate(sampleProject, { template: "boomi-design" });
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheetNames = workbook.worksheets.map((ws) => ws.name);
    expect(sheetNames).toContain("Cover");
    expect(sheetNames).toContain("Document Log");
    expect(sheetNames).toContain("Environment Information");
    expect(sheetNames).toContain("Profile Catalog");
    expect(sheetNames).toContain("Job & Error Handling");
  });

  it("quality report sheet has data when includeQualityReport is true", async () => {
    const buffer = await createFmdWorkbookWithTemplate(sampleProject, {
      template: "standard",
      includeQualityReport: true,
    });
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const qualitySheet = workbook.getWorksheet("Quality Report");
    expect(qualitySheet).toBeDefined();
    expect(qualitySheet!.rowCount).toBeGreaterThan(1);
  });

  it("checklist sheet has data when includeChecklist is true", async () => {
    const buffer = await createFmdWorkbookWithTemplate(sampleProject, {
      template: "standard",
      includeChecklist: true,
    });
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const checklistSheet = workbook.getWorksheet("Deployment Checklist");
    expect(checklistSheet).toBeDefined();
    expect(checklistSheet!.rowCount).toBeGreaterThan(1);
  });
});
