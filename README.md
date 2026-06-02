# Boomi Helper Suite

Boomi Helper Suite is a local-first design workspace for Boomi architects and developers. It helps teams turn integration requirements into structured FMD documentation, source-to-target mappings, process-flow drafts, and **Companion-ready build packages** for Boomi Companion-enabled agents.

The app is intended for practical integration design work: import an FMD or start from scratch, model profiles and endpoints, map fields with validation, inspect process flow, generate readable workbook output, and **export Companion build packages** that a Companion-enabled agent uses to create, reuse, update, and record Boomi components.

## What The App Does

- Manages multiple Boomi design projects with process metadata, endpoints, profiles, mapping sets, FMD sections, process flows, Boomi connections, component drafts, and publish history.
- Provides an editable FMD Workbench with structured section editors for project summary, purpose and scope, environments, endpoints, profiles, mapping tables, transformations, process flow, Boomi components, error handling, tests, checklists, and appendices.
- Imports FMD workbooks, normalizes mapping/profile/endpoint evidence, reconciles proposed updates, and exports polished Excel FMD workbooks.
- Includes a visual Mapping Studio for source and destination profiles, fields, constants, lookups, functions, comments, review state, and mapping quality checks.
- Includes a React Flow based process designer with Boomi-style shapes and XML draft preview.
- **Boomi Companion Build Center**: Generates Companion-ready build packages containing markdown runbooks, machine-readable build specs, agent prompts, and acceptance criteria. Supports package download, agent prompt copy, and Companion result recording.
- **Boomi Companion v3 Agent Run**: Runs a local Companion-enabled agent CLI from a generated workspace. The app writes structured specs, markdown assets, an approved component plan, and a temporary `.env`; the agent uses Companion scripts to search, pull, create, or update valid Boomi components. The app does not generate publishable component XML in this path. Run is two-stage: preflight/build plan first, then explicit approval for create/update. Deploy and runtime tests are separate future workflows.
- **Boomi Direct Build Pipeline (v4)**: Generates Companion-reference-based Boomi component XML directly from the app and pushes components to the live Boomi Platform using Companion scripts. Handles full dependency order: profiles → connections → operations → maps → processes. Runs preflight checks (env, folder), searches for existing components to determine create vs update vs reuse, pushes new components via `boomi-component-create.sh`, and pulls profile XML back to extract exact platform-assigned keys for map generation. Progress is streamed in real-time via SSE. No deployment step — push only.
- **Boomi Companion Bridge** (v2, legacy): Direct Companion script execution from app-generated workspace XML. Kept behind legacy paths only.
- **Legacy Boomi API Lab** (disabled by default): Sandbox connections, component lookup, template import, dependency scanning, XML dry-run generation, and guarded publish attempts remain available behind the `BOOMI_HELPER_ENABLE_LEGACY_XML_PUBLISH` feature flag for backward compatibility.
- Uses a local SQLite database through Prisma, with API response sanitization so encrypted credentials and large XML bodies are not sent to the browser unless explicitly requested.

## Current Status

The app is an active local product prototype with milestones M1-M10 implemented:

- Workspace, project management, endpoint/profile CRUD, field import, and dashboard workflows.
- Editable mapping studio with validation and rule review.
- FMD import, resolver, apply, editable workbench, validation, and export.
- Process flow editor and process XML draft generation.
- **Boomi Companion Build Center**: Build spec extraction, package generation, markdown/JSON rendering, zip download, agent prompt copy, and Companion result recording.
- **Legacy**: Boomi sandbox connection management, template import, dry-run generation, guarded publish support for selected map/profile components, event history, and rollback (disabled by default, requires `BOOMI_HELPER_ENABLE_LEGACY_XML_PUBLISH=true`).
- Unit and integration coverage across FMD, mappings, Boomi safety checks, API routes, sanitization, resolver cache, build spec extraction, package rendering, and end-to-end project flows.

## Safety Model

Boomi Helper Suite is designed to keep risky operations explicit:

- Credentials are stored encrypted.
- Project responses are sanitized before reaching the browser.
- **Direct XML generation and publish have been retired as the primary workflow.** The app no longer presents locally-generated XML as publishable truth.
- **Companion-ready build packages contain no publishable XML, no decrypted credentials, and no API tokens.** v3 local run workspaces contain a temporary `.env` built from the selected app connection; it is redacted from logs and deleted unless the run is explicitly kept for debugging.
- **v3 Run does not deploy or execute runtime tests.** It stops after component create/update/reuse result recording.
- **v4 Direct Build Pipeline pushes components to the Boomi Platform using Companion scripts.** Temporary workspace `.env` is deleted after pipeline completion. No credentials appear in generated XML or SSE progress events.
- Legacy Boomi publishing is disabled by default behind `BOOMI_HELPER_ENABLE_LEGACY_XML_PUBLISH` and is guarded by sandbox-only checks, component-type allowlists, template requirements, mapping quality checks, and review thresholds.
- Unsupported component types are import-only until their generators and regression tests are strong enough.

## Tech Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- Prisma with SQLite
- Vitest
- ExcelJS
- fast-xml-parser
- React Flow

## Requirements

- Node.js 20 or newer
- npm
- SQLite support through Prisma
- Optional: Ollama with a local model for FMD resolver assistance
- Optional: Boomi API credentials for sandbox integration testing

An `.nvmrc` file is included for Node version selection.

## Getting Started

Install dependencies, prepare the local database, and start the app:

```bash
nvm use
npm install
npm run db:setup
npm run dev
```

Open the app at:

```text
http://localhost:3000
```

The app can show seeded fallback data if the database is unavailable, but editing workflows require the Prisma database setup.

## Useful Commands

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run test
npm run db:setup
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run prisma:reset
```

## Environment Configuration

Environment files are intentionally ignored by git. Configure local values in your own environment file when needed.

Common variables:

- `BOOMI_HELPER_ENCRYPTION_KEY`: 64-character hex key for AES-256-GCM credential encryption.
- `BOOMI_HELPER_COMPANION_AGENT_COMMAND`: local agent command used by v3 Run. The command may use `{workspace}`, `{prompt}`, and `{plan}` placeholders; if no placeholder is present, the prompt path is appended.
- `BOOMI_HELPER_COMPANION_AGENT_TIMEOUT_MS`: optional timeout for the v3 local agent command. Defaults to 10 minutes.
- `BOOMI_HELPER_FMD_DEBUG`: set to `1` only when you intentionally want resolver debug payloads returned by the FMD resolve API.
- `BOOMI_HELPER_ENABLE_LEGACY_XML_PUBLISH`: set to `true` to re-enable the legacy direct-publish workflow (disabled by default). When unset, /api/boomi/publish returns 410 Gone.
- `BOOMI_HELPER_ENABLE_DIRECT_BUILD`: set to `true` (default) to enable the Direct Build Pipeline that generates and pushes Boomi XML from the app. Set to `false` to hide the "Build & Deploy" button and return 410 from build routes.
- `BOOMI_ACCOUNT_ID`, `BOOMI_API_USERNAME`, `BOOMI_API_TOKEN`: used by the sample-fetching script when collecting Boomi XML examples.

Never commit real Boomi credentials, API tokens, exported secrets, local databases, or generated build output.

## Verification

Run these before treating a change as ready:

```bash
npm run lint
npm run test
npm run build
```

For dependency audit checks:

```bash
npm audit --omit=dev
```

## Development Notes

- Direct XML generation and publish have been retired as the primary workflow. The Companion Direct Build Pipeline (v4) and v3 Agent Run are the new happy paths.
- The Direct Build Pipeline uses `boomi-xml-engine.ts` (Companion-reference-based XML generators) and `boomi-build-pipeline.ts` (dependency-ordered orchestration with Companion script integration).
- Configure `BOOMI_HELPER_COMPANION_AGENT_COMMAND` before expecting the v3 approval step to start a local agent.
- Legacy publish routes are behind `BOOMI_HELPER_ENABLE_LEGACY_XML_PUBLISH` and return 410 Gone when the flag is false.
- Keep legacy XML code (boomi-xml.ts, boomi-sandbox.ts) for backward compatibility; these are marked `@legacy`.
- Keep FMD content editable and structured; avoid turning the FMD workbench into a read-only import viewer.
- Keep local-only artifacts ignored, especially environment files, databases, build output, dependency folders, and resolver caches.

## Recommended Next Milestone

The next high-value milestone is a project readiness console: a unified review layer that tells users whether a project is ready for FMD export, Companion package generation, or sandbox publish, and points them directly to the section, mapping, flow node, profile, endpoint, template, or Boomi draft that needs attention.
