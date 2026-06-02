# Boomi Companion Workflow Guide

This document explains how to use the Boomi Companion Build Center in Boomi Helper Suite.

## Overview

The Companion workflow replaces direct XML generation and publishing. Instead of the app generating Boomi XML and publishing it, you:

1. **Design your integration** in Boomi Helper Suite (profiles, mappings, process flow, FMD)
2. **Generate a build package** — a zip with markdown runbooks, JSON specs, and an agent prompt
3. **Run Companion v3** — the app creates a local agent workspace, runs preflight, searches for reusable components, and shows a component build plan
4. **Approve create/update** — only after approval does your configured local Companion-enabled agent CLI create, reuse, or update Boomi components
5. **Record the result** back into Boomi Helper Suite for audit and traceability

## Prerequisites

- Boomi Helper Suite running locally (`npm run dev`)
- [Boomi Companion](https://github.com/OfficialBoomi/bc-integration) installed in your local environment
- A Boomi account with API access
- A Companion-enabled agent (Claude Code, Cursor with terminal access, etc.)
- `BOOMI_HELPER_COMPANION_AGENT_COMMAND` configured in the app environment for v3 approval runs

## Step 1: Design Your Integration

In Boomi Helper Suite, set up your project with:

- **Endpoints**: Source and destination systems
- **Profiles**: Source and destination field definitions
- **Mappings**: Field-to-field mapping rules with expressions, lookups, functions
- **Process Flow**: Node-and-edge flow diagram
- **FMD Sections**: Documentation (overview, environment, job handling)

The Build Readiness Check in the Companion tab shows what's complete and what needs attention before generating a package.

## Step 2: Generate a Build Package

1. Open your project
2. Click the **Boomi Companion** tab
3. Click **Generate Build Package**

The package contains:

| File | Purpose |
|------|---------|
| `README_RUNBOOK.md` | Setup instructions, execution order, troubleshooting |
| `COMPANION_AGENT_PROMPT.md` | Instructions for the Companion-enabled agent |
| `BOOMI_BUILD_SPEC.json` | Machine-readable build instructions (all profiles, mappings, flows) |
| `PROJECT_INTENT.md` | Integration overview and goals |
| `PROFILES.md` | Source and destination field definitions |
| `MAPPINGS.md` | Field-to-field mapping rules |
| `ENDPOINTS_AND_CONNECTIONS.md` | Connection and endpoint details |
| `PROCESS_FLOW.md` | Process flow node and edge descriptions |
| `READINESS_AND_ACCEPTANCE.md` | Readiness status and acceptance criteria |
| `OPEN_QUESTIONS.md` | Questions requiring clarification |
| `.env.example` | Required environment variables (no secrets) |
| `COMPANION_RESULT_TEMPLATE.json` | Empty result template |
| `active-development/` | Working directory for the agent |

## Step 3: Run v3 Preflight

1. Select a real sandbox Boomi connection
2. Click **Run with Companion**
3. Review the preflight progress and proposed component plan

The app creates `.boomi-helper/companion-runs/<runId>/` with:

- `BOOMI_BUILD_SPEC.json`
- markdown assets and `COMPANION_AGENT_PROMPT.md`
- `COMPANION_AGENT_RUN_PLAN.json`
- `COMPANION_RESULT_TEMPLATE.json`
- `active-development/README.md`
- a temporary `.env` built from the selected app connection

The temporary `.env` is not sent to the browser, is redacted from logs, and is deleted unless the workspace is explicitly kept.

## Step 4: Approve Create/Update

The plan classifies each target as:

- `create`: no safe match was found
- `reuse`: one exact Boomi name/type/folder match was found
- `update`: imported Boomi context already has a component ID
- `blocked`: ambiguous matches or missing agent command

Click **Approve Create/Update** only after reviewing the plan. v3 Run does not deploy or execute runtime tests.

## Direct Build Pipeline (v4)

The Direct Build Pipeline generates correct Boomi component XML from the app's design data and pushes components directly to your Boomi platform using Companion scripts — no external agent required.

1. Ensure Companion scripts are installed: `npm run companion:setup`
2. Generate a build package (Step 2 above)
3. Select a sandbox Boomi connection in the Connection panel
4. Click **Build & Deploy to Boomi**
5. Watch the real-time pipeline progress: Preflight → Profiles → Connections → Operations → Maps → Process
6. Components appear in your Boomi platform under the configured folder

The pipeline:
- Checks your Boomi environment and creates the target folder
- Searches for existing components to avoid duplicates
- Creates profiles, connections, and operations in dependency order  
- Pulls pushed profiles back to extract exact platform-assigned keys
- Creates transform maps with correct field key references
- Creates process flows with proper Boomi shapes and connections
- Streams progress in real-time via SSE

Credentials are handled via the app's encrypted Boomi connection. No secrets appear in generated XML or progress events. The temporary workspace `.env` is deleted on completion.

## Manual Package Handoff

You can still download the package and hand it to an external Companion-enabled agent. In that mode, copy `.env.example` to `.env` in your external workspace and fill in credentials manually.

Provide `COMPANION_AGENT_PROMPT.md` to your Companion-enabled agent. The agent should:

1. Inspect the build spec
2. Check the Companion environment
3. Create, reuse, or update Boomi components (profiles, connections, maps, process)
4. Push incrementally
5. Fill in `COMPANION_RESULT_TEMPLATE.json`

**Important**: The agent must use OfficialBoomi Boomi Companion references and scripts. App-generated XML from legacy workflows is not to be used as source material.

## Step 5: Record the Result

After the Companion agent completes:

1. Copy the filled `COMPANION_RESULT_TEMPLATE.json`
2. In Boomi Helper Suite, go to the Companion tab
3. Paste the JSON into the **Record Companion Result** textarea (or upload the file)
4. Click **Record Result**

This brings component IDs, warnings, open follow-ups, and build history back into Boomi Helper Suite for traceability.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Boomi Companion not installed | Clone [bc-integration](https://github.com/OfficialBoomi/bc-integration) and follow setup |
| Missing local agent command | Set `BOOMI_HELPER_COMPANION_AGENT_COMMAND` and rerun preflight |
| Missing `.env` in manual handoff | Copy `.env.example` and fill in Boomi credentials |
| Boomi API auth failure | Verify `BOOMI_API_TOKEN` and `BOOMI_USERNAME` |
| Plan is blocked | Resolve ambiguous matches or configure the local agent command |
| Package has open questions | Review `OPEN_QUESTIONS.md` — answer before or during agent run |
| Result JSON invalid | Validate against `COMPANION_RESULT_TEMPLATE.json` structure |
| `jq` not installed | `brew install jq` (macOS) or `apt install jq` (Linux) |
| Credentials leaked in package | The package generator strips all credentials — open an issue if found |

## Legacy Workflow

The previous XML generation and direct-publish workflow is disabled by default. To re-enable it for backward compatibility, set:

```bash
BOOMI_HELPER_ENABLE_LEGACY_XML_PUBLISH=true
```

Legacy publish history remains readable in the Companion tab under **Legacy Publish History**.
