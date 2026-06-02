import { describe, it, expect } from "vitest";
import { buildBoomiBuildSpec } from "@/lib/boomi-companion-build-spec";
import {
  buildPackageFiles,
  buildPackageManifest,
  buildPackageZip,
} from "@/lib/boomi-companion-package";
import { sampleProject } from "@/lib/sample-data";
import AdmZip from "adm-zip";

describe("boomi-companion-package", () => {
  const spec = buildBoomiBuildSpec(sampleProject);
  const packageId = "pkg-test-001";
  const files = buildPackageFiles(spec, packageId);

  it("generates the correct number of package files", () => {
    expect(files.length).toBe(13);
  });

  it("generates all required files by filename", () => {
    const filenames = files.map((f) => f.filename);
    expect(filenames).toContain("README_RUNBOOK.md");
    expect(filenames).toContain("COMPANION_AGENT_PROMPT.md");
    expect(filenames).toContain("BOOMI_BUILD_SPEC.json");
    expect(filenames).toContain("PROJECT_INTENT.md");
    expect(filenames).toContain("PROFILES.md");
    expect(filenames).toContain("MAPPINGS.md");
    expect(filenames).toContain("ENDPOINTS_AND_CONNECTIONS.md");
    expect(filenames).toContain("PROCESS_FLOW.md");
    expect(filenames).toContain("READINESS_AND_ACCEPTANCE.md");
    expect(filenames).toContain("OPEN_QUESTIONS.md");
    expect(filenames).toContain("COMPANION_RESULT_TEMPLATE.json");
    expect(filenames).toContain(".env.example");
    expect(filenames).toContain("active-development/README.md");
  });

  it("README_RUNBOOK.md contains key sections", () => {
    const f = files.find((x) => x.filename === "README_RUNBOOK.md")!;
    expect(f.content).toContain("# Boomi Companion Build Package");
    expect(f.content).toContain("SRSN001");
    expect(f.content).toContain("Boomi Companion");
    expect(f.content).toContain("## Required Setup");
    expect(f.content).toContain("## Safe Execution Order");
    expect(f.content).toContain("## Troubleshooting");
  });

  it("COMPANION_AGENT_PROMPT.md contains strict constraints", () => {
    const f = files.find((x) => x.filename === "COMPANION_AGENT_PROMPT.md")!;
    expect(f.content).toContain("NEVER VIOLATE");
    expect(f.content).toContain("Do not use app-generated XML as source of truth");
    expect(f.content).toContain("Do not invent or assume missing credentials");
    expect(f.content).toContain("## Build Workflow");
    expect(f.content).toContain("## Acceptance Checklist");
  });

  it("BOOMI_BUILD_SPEC.json is valid JSON", () => {
    const f = files.find((x) => x.filename === "BOOMI_BUILD_SPEC.json")!;
    const parsed = JSON.parse(f.content);
    expect(parsed.schemaVersion).toBe("1.0");
    expect(parsed.project.processId).toBe("SRSN001");
  });

  it("PROFILES.md contains Japanese field names", () => {
    const f = files.find((x) => x.filename === "PROFILES.md")!;
    expect(f.content).toContain("PO_SEIREN TSV");
    expect(f.content).toContain("購買伝票番号");
    expect(f.content).toContain("会社コード");
  });

  it("MAPPINGS.md contains rule details", () => {
    const f = files.find((x) => x.filename === "MAPPINGS.md")!;
    expect(f.content).toContain("Seiren TSV to ServiceNow staging");
    expect(f.content).toContain("direct");
    expect(f.content).toContain("function");
    expect(f.content).toContain("lookup");
    expect(f.content).toContain("constant");
    expect(f.content).toContain("Transform Nodes");
  });

  it("ENDPOINTS_AND_CONNECTIONS.md contains endpoints", () => {
    const f = files.find((x) => x.filename === "ENDPOINTS_AND_CONNECTIONS.md")!;
    expect(f.content).toContain("SharePoint PO folder");
    expect(f.content).toContain("ServiceNow order staging");
    expect(f.content).toContain("Operational notification");
  });

  it("PROCESS_FLOW.md contains flow structure", () => {
    const f = files.find((x) => x.filename === "PROCESS_FLOW.md")!;
    expect(f.content).toContain("Inbound order process");
    expect(f.content).toContain("### Nodes");
    expect(f.content).toContain("### Edges");
  });

  it("READINESS_AND_ACCEPTANCE.md contains status", () => {
    const f = files.find((x) => x.filename === "READINESS_AND_ACCEPTANCE.md")!;
    expect(f.content).toContain("# Build Readiness Report");
    expect(f.content).toContain("## Acceptance Criteria");
  });

  it("OPEN_QUESTIONS.md contains questions", () => {
    const f = files.find((x) => x.filename === "OPEN_QUESTIONS.md")!;
    expect(f.content).toContain("# Open Questions");
  });

  it(".env.example has required variables but no values", () => {
    const f = files.find((x) => x.filename === ".env.example")!;
    expect(f.content).toContain("BOOMI_API_URL=https://api.boomi.com");
    expect(f.content).toContain("BOOMI_USERNAME=");
    expect(f.content).toContain("BOOMI_API_TOKEN=");
    expect(f.content).toContain("BOOMI_ACCOUNT_ID=");
    expect(f.content).toContain("BOOMI_ENVIRONMENT_ID=");
    expect(f.content).toContain("BOOMI_TARGET_FOLDER=");
  });

  it(".env.example contains no secrets or passwords", () => {
    const f = files.find((x) => x.filename === ".env.example")!;
    expect(f.content).not.toContain("mock-password");
    expect(f.content).not.toContain("mock-username");
    expect(f.content).not.toContain("apiPassword");
  });

  it("COMPANION_RESULT_TEMPLATE.json is valid JSON with expected structure", () => {
    const f = files.find((x) => x.filename === "COMPANION_RESULT_TEMPLATE.json")!;
    const parsed = JSON.parse(f.content);
    expect(parsed.schemaVersion).toBe("1.0");
    expect(parsed.packageId).toBe(packageId);
    expect(parsed.runTimestamp).toBe("");
    expect(parsed.components.created).toEqual([]);
    expect(parsed.components.updated).toEqual([]);
    expect(parsed.components.reused).toEqual([]);
    expect(parsed.deployments).toEqual([]);
    expect(parsed.tests).toEqual([]);
  });

  it("buildPackageManifest returns correct metadata", () => {
    const manifest = buildPackageManifest(spec, packageId, files);
    expect(manifest.packageId).toBe(packageId);
    expect(manifest.projectName).toBe("Seiren Trading Order Intake");
    expect(manifest.projectProcessId).toBe("SRSN001");
    expect(manifest.fileCount).toBe(13);
    expect(manifest.files.every((f) => f.size > 0)).toBe(true);
  });

  it("buildPackageZip creates a zip buffer with folder prefix", async () => {
    const zipBuffer = await buildPackageZip(files);
    expect(Buffer.isBuffer(zipBuffer)).toBe(true);
    expect(zipBuffer.length).toBeGreaterThan(0);

    const header = zipBuffer.slice(0, 2);
    expect(header[0]).toBe(0x50);
    expect(header[1]).toBe(0x4b);

    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries().map((e) => e.entryName);
    expect(entries.length).toBe(files.length);
    for (const entry of entries) {
      expect(entry).toMatch(/^boomi-companion-package\//);
    }
  });

  it("no package file contains proposedXml, templateXml, or credentials", () => {
    for (const f of files) {
      expect(f.content).not.toContain("proposedXml");
      expect(f.content).not.toContain("templateXml");
      expect(f.content).not.toContain("mock-password");
      expect(f.content).not.toContain("mock-username");
      expect(f.content).not.toContain("<bns:Component");
    }
  });
});
