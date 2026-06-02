import type {
  BoomiBuildSpec,
  ReadinessCheck,
} from "@/lib/domain";

export type PackageFile = {
  filename: string;
  content: string;
};

export type PackageManifest = {
  packageId: string;
  generatedAt: string;
  projectName: string;
  projectProcessId: string;
  readinessStatus: string;
  fileCount: number;
  files: { filename: string; size: number }[];
};

function indent(text: string, level: number): string {
  const prefix = "  ".repeat(level);
  return text
    .split("\n")
    .map((line) => (line ? prefix + line : line))
    .join("\n");
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n\n_No data_`;

  const headerRow = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const dataRows = rows.map((row) => `| ${row.join(" | ")} |`);
  return [headerRow, separator, ...dataRows, ""].join("\n");
}

function generateReadmeRunbook(spec: BoomiBuildSpec): string {
  return `# Boomi Companion Build Package

## Package Purpose

${spec.project.name} (${spec.project.processId})

**Goal:** ${spec.target.goal}

**Integration Pattern:** ${spec.target.integrationPattern}

**Source System:** ${spec.project.sourceSystem}
**Destination System:** ${spec.project.destinationSystem}
**Schedule:** ${spec.project.schedule ?? "Not specified"}
**Generated:** ${spec.generatedAt}

## Required Setup

Before running the Companion agent, ensure:

1. [Boomi Companion](https://github.com/OfficialBoomi/bc-integration) is installed in your local environment
2. A \`.env\` file exists in the Companion workspace with valid Boomi credentials
3. Refer to \`.env.example\` in this package for required variables

## Safe Execution Order

1. **Review this package** — read all markdown files to understand the integration intent
2. **Set up Companion** — configure \`.env\` with your Boomi credentials
3. **Run the agent** — provide \`COMPANION_AGENT_PROMPT.md\` to a Companion-enabled agent
4. **Review builds** — inspect each component created, reused, or updated
5. **Record results** — fill in \`COMPANION_RESULT_TEMPLATE.json\` and return it to Boomi Helper Suite
6. **Deploy/test later** — deployment and execution testing are separate workflows, not part of the v3 Run button

## Push Boundary Reminders

- The Companion agent performs the build — not Boomi Helper Suite
- Companion scripts require \`BOOMI_VERIFY_SSL\`, \`BOOMI_TARGET_FOLDER\`, and target environment IDs
- Every push to the Boomi platform is irreversible within the current version
- Do not deploy or execute runtime tests as part of the v3 build run

## Package Contents

| File | Purpose |
| --- | --- |
| \`BOOMI_BUILD_SPEC.json\` | Canonical machine-readable build instructions |
| \`COMPANION_AGENT_PROMPT.md\` | Instructions for the Companion-enabled agent |
| \`PROJECT_INTENT.md\` | Integration overview and goals |
| \`PROFILES.md\` | Source and destination field definitions |
| \`MAPPINGS.md\` | Field-to-field mapping rules |
| \`ENDPOINTS_AND_CONNECTIONS.md\` | Connection and endpoint details |
| \`PROCESS_FLOW.md\` | Process flow node and edge descriptions |
| \`READINESS_AND_ACCEPTANCE.md\` | Build readiness status and acceptance criteria |
| \`OPEN_QUESTIONS.md\` | Questions requiring human or agent clarification |
| \`.env.example\` | Required environment variables (no secrets) |
| \`COMPANION_RESULT_TEMPLATE.json\` | Empty result template to fill after build |
| \`active-development/README.md\` | Guidance for active development files |

## Troubleshooting

| Problem | Action |
| --- | --- |
| Boomi Companion not installed | Clone [bc-integration](https://github.com/OfficialBoomi/bc-integration) and follow setup |
| Missing \`.env\` | Copy \`.env.example\` and fill in your Boomi credentials |
| Boomi API auth failure | Verify \`BOOMI_API_TOKEN\` and \`BOOMI_USERNAME\` are correct in \`.env\` |
| Package has open questions | Review \`OPEN_QUESTIONS.md\` — answer before or during companion run |
| Result JSON invalid | Validate against \`COMPANION_RESULT_TEMPLATE.json\` schema |
| \`jq\` not installed | Install jq for JSON validation: \`brew install jq\` (macOS) or \`apt install jq\` (Linux) |
`;
}

function generateCompanionAgentPrompt(spec: BoomiBuildSpec): string {
  const profileNames = spec.profiles.map((p) => `- **${p.role}**: ${p.name} (${p.type}, ${p.format})`).join("\n");
  const mappingMsNames = spec.mappingSets.map((ms) => `- ${ms.name} (${ms.rules.length} rules, ${ms.transformNodes.length} transforms)`).join("\n");
  const flowNames = spec.processFlows.map((f) => `- ${f.name} (${f.nodes.length} nodes, ${f.edges.length} edges)`).join("\n");

  return `# Companion Agent Prompt — ${spec.project.name}

## Your Role

You are implementing this Boomi integration using **OfficialBoomi Boomi Companion**. Your objective is to read this package, apply Boomi Companion references and scripts, and create, reuse, or update the necessary Boomi components.

## Pre-flight (DO THIS FIRST)

1. Run a Companion environment check to verify \`.env\` is configured and the Boomi API is accessible
2. Read \`BOOMI_THINKING.md\` from the Boomi Companion skill if available
3. Read \`BOOMI_BUILD_SPEC.json\` for the canonical machine-readable build instructions
4. If \`COMPANION_AGENT_RUN_PLAN.json\` exists, treat it as the approved component target plan

## Hard Constraints (NEVER VIOLATE)

- **Do not use app-generated XML as source of truth.** Boomi Helper Suite XML drafts are legacy and may be stale.
- **Do not invent or assume missing credentials.** If \`.env\` values are missing, stop and ask.
- **Do not deploy or run process execution tests in this v3 build run.** Create/update/reuse components only.
- **Preserve all field names, Japanese text, expressions, and comments exactly as provided.** Use the field names from \`BOOMI_BUILD_SPEC.json\` verbatim.
- **Prefer existing Boomi components when available.** Reuse rather than recreate.
- **Document every component ID** created, reused, or updated. Write all IDs into \`COMPANION_RESULT_TEMPLATE.json\`.

## Build Workflow

Follow this sequence. If any step reveals missing information, stop and ask before proceeding.

### 1. Inspect the Build Spec

Read \`BOOMI_BUILD_SPEC.json\`. Verify you understand:
- The integration goal: ${spec.target.goal}
- Required profiles: ${spec.profiles.length} (${spec.profiles.filter(p => p.role === "source").length} source, ${spec.profiles.filter(p => p.role === "destination").length} destination)
- Mapping sets to create: ${spec.mappingSets.length}
- Process flows to implement: ${spec.processFlows.length}

${profileNames}

${mappingMsNames}

${flowNames}

### 2. Run Companion Environment Check

\`\`\`bash
# Verify environment
echo "Checking Boomi environment..."
# Run Companion's env check script here
\`\`\`

### 3. Create Target Folder If Needed

The target folder is: **${spec.project.folder ?? "NOT SPECIFIED — ask before creating"}**

If no folder is specified, ask the human before creating a new one.

### 4. Create or Reuse Profiles

For each profile in \`BOOMI_BUILD_SPEC.json\`:
- Read \`PROFILES.md\` for field-level details
- Create the profile using the appropriate Companion reference for the profile type
- Map every field exactly as defined
- Record the component ID

### 5. Create or Reuse Connections

For each endpoint in \`BOOMI_BUILD_SPEC.json\`:
- Read \`ENDPOINTS_AND_CONNECTIONS.md\`
- Create or reuse connections using Companion connection references
- Record connection component IDs

### 6. Create Operations

For each connection that needs operations, create the appropriate connector operation using Companion operation references.

### 7. Create Maps

For each mapping set:
- Read \`MAPPINGS.md\` for rule-level details
- Create the transform.map using Companion map references
- Apply all mapping rules: direct, constant, lookup, function, join
- Apply transform nodes (format, lookup, script, combine, split)
- Record the map component ID

### 8. Create the Process

- Read \`PROCESS_FLOW.md\` for node and edge details
- Create the process skeleton using Companion process references
- Wire all shapes, lanes, and connectors
- Set process properties
- Record the process component ID

### 9. Push Incrementally

Push components to Boomi one at a time or in logical groups (profiles first, then connections, then maps, then process).

### 10. Do Not Deploy Or Execute Tests

Stop after components are created, reused, or updated. Deployment and runtime execution testing belong to a later explicit workflow.

### 11. Write Result JSON

Fill all fields in \`COMPANION_RESULT_TEMPLATE.json\`:
- Every component created, updated, or reused
- Empty deployment and test arrays unless a separate explicit workflow ran
- Warnings and errors
- Open follow-ups

## Escalation Rules

- **Missing Boomi details:** Stop and ask. Do not guess.
- **Broad component reuse choices:** Ask before reusing existing components that may have side effects.
- **Unsupported connector types:** If a connector type is not covered by Companion references, stop and report.
- **Validation errors:** After 3 documented troubleshooting attempts, stop and escalate.

## Acceptance Checklist

Before considering the build complete, verify:

- [ ] All mapped destination fields are accounted for
- [ ] All required destination fields are handled
- [ ] All process flow nodes are represented or explicitly deferred
- [ ] All component IDs are recorded in \`COMPANION_RESULT_TEMPLATE.json\`
- [ ] Deployment and test arrays remain empty for v3 build-only runs
- [ ] No Boomi Helper Suite generated XML was used as source material
`;
}

function generateProjectIntent(spec: BoomiBuildSpec): string {
  return `# Project Intent — ${spec.project.name}

## Overview

- **Process ID:** ${spec.project.processId}
- **Name:** ${spec.project.name}
- **Description:** ${spec.project.description}
- **Source System:** ${spec.project.sourceSystem}
- **Destination System:** ${spec.project.destinationSystem}
- **Status:** ${spec.project.status}
- **Owner:** ${spec.project.owner}
- **Schedule:** ${spec.project.schedule ?? "Not specified"}
- **Folder:** ${spec.project.folder ?? "Not specified"}

## Target Intent

**Goal:** ${spec.target.goal}

**Integration Pattern:** ${spec.target.integrationPattern}

${spec.target.notes ? `**Notes:** ${spec.target.notes}` : ""}

## Generated

This package was generated by Boomi Helper Suite on ${spec.generatedAt}.

**WARNING:** This package contains **no publishable Boomi XML**. All Boomi component creation must be performed by a Boomi Companion-enabled agent using this package as instruction only.
`;
}

function generateProfiles(spec: BoomiBuildSpec): string {
  let md = "# Profiles\n\n";

  for (const profile of spec.profiles) {
    md += `## ${profile.name}\n\n`;
    md += `- **Role:** ${profile.role}\n`;
    md += `- **Type:** ${profile.type}\n`;
    md += `- **Format:** ${profile.format}\n`;
    if (profile.rootPath) md += `- **Root Path:** \`${profile.rootPath}\`\n`;
    md += `- **Local ID:** \`${profile.localProfileId}\`\n`;
    md += "\n";

    if (profile.fields.length > 0) {
      const headers = ["#", "Name", "Label", "Type", "Length", "Req", "Key", "Format", "Sample"];
      const rows = profile.fields.map((f, i) => [
        String(i + 1),
        f.name,
        f.label ?? "",
        f.dataType,
        f.length ?? "",
        f.required ? "Yes" : "No",
        f.keyField ? "Yes" : "No",
        f.format ?? "",
        f.sample ?? "",
      ]);
      md += table(headers, rows);
      md += "\n";
    } else {
      md += "_No fields defined_\n\n";
    }
  }

  return md;
}

function generateMappings(spec: BoomiBuildSpec): string {
  let md = "# Mapping Rules\n\n";

  if (spec.mappingSets.length === 0) {
    return md + "_No mapping sets defined_\n";
  }

  for (const ms of spec.mappingSets) {
    md += `## ${ms.name}\n\n`;
    md += `- **Direction:** ${ms.direction}\n`;
    md += `- **Source Profile:** ${ms.sourceProfileRef}\n`;
    md += `- **Destination Profile:** ${ms.destinationProfileRef}\n`;
    md += `- **Status:** ${ms.status}\n`;
    md += `- **Local ID:** \`${ms.localMappingSetId}\`\n`;
    md += "\n";

    if (ms.transformNodes.length > 0) {
      md += "### Transform Nodes\n\n";
      for (const tn of ms.transformNodes) {
        md += `- **${tn.label}** (${tn.nodeType}) at (${tn.position.x}, ${tn.position.y})\n`;
        if (Object.keys(tn.config).length > 0) {
          md += indent("  Config:\n", 1);
          for (const [k, v] of Object.entries(tn.config)) {
            md += indent(`  - ${k}: ${v}\n`, 2);
          }
        }
      }
      md += "\n";
    }

    md += "### Rules\n\n";
    if (ms.rules.length === 0) {
      md += "_No rules defined_\n\n";
    } else {
      const headers = ["Source Field", "Dest Field", "Type", "Expression", "Default", "Quality", "Reviewed"];
      const rows = ms.rules.map((r) => [
        r.sourceFieldName ?? r.sourceFieldId ?? "(none)",
        r.destinationFieldName ?? r.destinationFieldId,
        r.mappingType,
        r.expression ?? "",
        r.defaultValue ?? "",
        r.qualityStatus ?? "unchecked",
        r.reviewed ? "Yes" : "No",
      ]);
      md += table(headers, rows);
      md += "\n";

      for (const r of ms.rules) {
        if (r.comment) {
          md += `**${r.destinationFieldName ?? r.destinationFieldId}:** ${r.comment}\n\n`;
        }
      }
    }
  }

  return md;
}

function generateEndpointsAndConnections(spec: BoomiBuildSpec): string {
  let md = "# Endpoints & Connections\n\n";

  if (spec.endpoints.length === 0) {
    return md + "_No endpoints defined_\n";
  }

  for (const ep of spec.endpoints) {
    md += `## ${ep.name}\n\n`;
    md += `- **Role:** ${ep.role}\n`;
    md += `- **Connector Type:** ${ep.connectorType}\n`;
    md += `- **Profile Type:** ${ep.profileType}\n`;
    md += `- **Format:** ${ep.format}\n`;
    md += `- **Purpose:** ${ep.purpose}\n`;
    md += `- **Connection Info:** ${ep.connectionInfo}\n`;
    md += `- **Local ID:** \`${ep.localEndpointId}\`\n`;
    md += "\n";
  }

  return md;
}

function generateProcessFlow(spec: BoomiBuildSpec): string {
  let md = "# Process Flow\n\n";

  if (spec.processFlows.length === 0) {
    return md + "_No process flows defined_\n";
  }

  for (const flow of spec.processFlows) {
    md += `## ${flow.name}\n\n`;
    if (flow.notes) md += `${flow.notes}\n\n`;
    md += `- **Local ID:** \`${flow.localFlowId}\`\n\n`;

    md += "### Nodes\n\n";
    if (flow.nodes.length === 0) {
      md += "_No nodes defined_\n\n";
    } else {
      const headers = ["ID", "Type", "Label", "Description", "Position"];
      const rows = flow.nodes.map((n) => [
        n.localNodeId,
        n.type,
        n.label,
        n.description,
        `(${n.position.x}, ${n.position.y})`,
      ]);
      md += table(headers, rows);
      md += "\n";
    }

    md += "### Edges\n\n";
    if (flow.edges.length === 0) {
      md += "_No edges defined_\n\n";
    } else {
      const headers = ["ID", "Source", "Target", "Label"];
      const rows = flow.edges.map((e) => [
        e.localEdgeId,
        e.source,
        e.target,
        e.label ?? "",
      ]);
      md += table(headers, rows);
      md += "\n";
    }
  }

  return md;
}

function generateReadinessAndAcceptance(spec: BoomiBuildSpec): string {
  let md = "# Build Readiness Report\n\n";

  md += `**Overall Status:** ${spec.readiness.overallStatus.toUpperCase()}\n\n`;

  md += "## Readiness Checks\n\n";
  const categories = new Map<string, ReadinessCheck[]>();
  for (const check of spec.readiness.checks) {
    const existing = categories.get(check.category) ?? [];
    existing.push(check);
    categories.set(check.category, existing);
  }

  for (const [category, checks] of categories) {
    md += `### ${category}\n\n`;
    for (const check of checks) {
      const icon = check.status === "ok" ? "PASS" : check.status === "warning" ? "WARN" : "FAIL";
      md += `- **[${icon}]** ${check.message}\n`;
      if (check.details) {
        for (const d of check.details) {
          md += `  - ${d}\n`;
        }
      }
    }
    md += "\n";
  }

  md += "## Acceptance Criteria\n\n";
  if (spec.acceptanceCriteria.length === 0) {
    md += "_No acceptance criteria defined_\n";
  } else {
    for (const ac of spec.acceptanceCriteria) {
      md += `- [ ] ${ac}\n`;
    }
  }
  md += "\n";

  return md;
}

function generateOpenQuestions(spec: BoomiBuildSpec): string {
  let md = "# Open Questions\n\n";

  if (spec.openQuestions.length === 0) {
    md += "_No open questions — all required information appears complete._\n\n";
    return md;
  }

  md += "The following questions should be answered before or during the Companion agent build:\n\n";

  for (let i = 0; i < spec.openQuestions.length; i++) {
    md += `${i + 1}. ${spec.openQuestions[i]}\n`;
  }
  md += "\n";

  return md;
}

function generateEnvExample(): string {
  return `# Boomi Companion Environment Variables
# Copy this file to .env and fill in your values.
# Never commit .env to version control.

# Required — Boomi Platform
BOOMI_API_URL=https://api.boomi.com
BOOMI_USERNAME=
BOOMI_API_TOKEN=
BOOMI_ACCOUNT_ID=

# Required — Target Environment
BOOMI_ENVIRONMENT_ID=

# Optional — Testing
BOOMI_TEST_ATOM_ID=

# Required — Component Organization
BOOMI_TARGET_FOLDER=

# Optional — SSL Verification
BOOMI_VERIFY_SSL=true
`;
}

function generateCompanionResultTemplate(packageId: string): string {
  return JSON.stringify(
    {
      schemaVersion: "1.0",
      packageId,
      runTimestamp: "",
      agentTool: "",
      boomiAccountId: "",
      targetEnvironmentId: "",
      components: {
        created: [],
        updated: [],
        reused: [],
      },
      deployments: [],
      tests: [],
      warnings: [],
      errors: [],
      openFollowUps: [],
    },
    null,
    2
  );
}

function generateActiveDevelopmentReadme(): string {
  return `# Active Development

This directory is reserved for the Companion agent to store:

- Downloaded component XML during development
- Generated artifacts from Companion scripts
- Build logs and debug output
- Any temporary working files

The initial state of this directory is empty except for this README.

**Do not** place Boomi Helper Suite generated XML here as source of truth.
`;
}

export function buildPackageFiles(spec: BoomiBuildSpec, packageId: string): PackageFile[] {
  const envExample = generateEnvExample();

  return [
    { filename: "README_RUNBOOK.md", content: generateReadmeRunbook(spec) },
    { filename: "COMPANION_AGENT_PROMPT.md", content: generateCompanionAgentPrompt(spec) },
    { filename: "BOOMI_BUILD_SPEC.json", content: JSON.stringify(spec, null, 2) },
    { filename: "PROJECT_INTENT.md", content: generateProjectIntent(spec) },
    { filename: "PROFILES.md", content: generateProfiles(spec) },
    { filename: "MAPPINGS.md", content: generateMappings(spec) },
    { filename: "ENDPOINTS_AND_CONNECTIONS.md", content: generateEndpointsAndConnections(spec) },
    { filename: "PROCESS_FLOW.md", content: generateProcessFlow(spec) },
    { filename: "READINESS_AND_ACCEPTANCE.md", content: generateReadinessAndAcceptance(spec) },
    { filename: "OPEN_QUESTIONS.md", content: generateOpenQuestions(spec) },
    { filename: "COMPANION_RESULT_TEMPLATE.json", content: generateCompanionResultTemplate(packageId) },
    { filename: ".env.example", content: envExample },
    { filename: "active-development/README.md", content: generateActiveDevelopmentReadme() },
  ];
}

export async function buildPackageZip(files: PackageFile[]): Promise<Buffer> {
  const { default: AdmZip } = await import("adm-zip");

  const zip = new AdmZip();
  for (const file of files) {
    zip.addFile(`boomi-companion-package/${file.filename}`, Buffer.from(file.content, "utf-8"));
  }
  return zip.toBuffer();
}

export function buildPackageManifest(
  spec: BoomiBuildSpec,
  packageId: string,
  files: PackageFile[]
): PackageManifest {
  return {
    packageId,
    generatedAt: spec.generatedAt,
    projectName: spec.project.name,
    projectProcessId: spec.project.processId,
    readinessStatus: spec.readiness.overallStatus,
    fileCount: files.length,
    files: files.map((f) => ({
      filename: f.filename,
      size: Buffer.byteLength(f.content, "utf-8"),
    })),
  };
}
