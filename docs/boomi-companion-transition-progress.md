# Boomi Companion Transition Progress

Tracking implementation against `docs/boomi-companion-transition-plan.md`.

---

## Workstream 1: Data Model And Migration

| # | Task | Status |
|---|------|--------|
| 1 | Add `BoomiBuildPackage` Prisma model | done |
| 2 | Add `BoomiCompanionRunEvent` Prisma model | done |
| 3 | Keep existing tables for backward compatibility | done |
| 4 | Mark old XML drafts as legacy in application logic | done |
| 5 | Add domain types for package status | done |
| 6 | Add domain types for run event status | done |
| 7 | Store `specJson`, `manifestJson`, `readinessJson`, `resultJson` | done |
| 8 | Store generated package files (regenerated-on-demand from DB JSON) | done |
| 9 | Add indexes on `projectId`, `createdAt`, `status` | done |

## Workstream 2: Build Spec Extractor

| # | Task | Status |
|---|------|--------|
| 1 | Create `BoomiBuildSpec` TypeScript domain type | done |
| 2 | Create Zod validation schema for `BoomiBuildSpec` | done |
| 3 | Create `buildBoomiBuildSpec(project): BoomiBuildSpec` | done |
| 4 | Include project metadata | done |
| 5 | Include endpoints | done |
| 6 | Include profiles | done |
| 7 | Include mapping sets | done |
| 8 | Include process flows | done |
| 9 | Include FMD section summaries | done |
| 10 | Include imported Boomi context | done |
| 11 | Include readiness report | done |
| 12 | Include open questions | done |

## Workstream 3: Companion Package Renderer

| # | Task | Status |
|---|------|--------|
| 1 | Create package builder module | done |
| 2 | Generate `README_RUNBOOK.md` | done |
| 3 | Generate `COMPANION_AGENT_PROMPT.md` | done |
| 4 | Generate `BOOMI_BUILD_SPEC.json` | done |
| 5 | Generate markdown views | done |
| 6 | Generate `.env.example` | done |
| 7 | Generate `COMPANION_RESULT_TEMPLATE.json` | done |
| 8 | Build zip download support | done |

## Workstream 4: Boomi UI Replacement

| # | Task | Status |
|---|------|--------|
| 1 | Rename "Boomi API" tab to "Boomi Companion" | done |
| 2 | Replace "Component XML Preview" with "Companion Build Package" | done |
| 3 | Primary actions: Generate, Download, Copy Prompt, Record Result | done |
| 4 | Remove direct dry-run and publish buttons from happy path | done |
| 5 | Add "Build Readiness Check" replacing "Publish Safety Check" | done |
| 6 | Show readiness categories | done |
| 7 | Show package manifest after generation | done |
| 8 | Add result-recording UI (paste/upload/validate) | done |
| 9 | Keep legacy publish history read-only | done |
| 10 | Add "Companion Run History" | done |

## Workstream 5: API Route Refactor

| # | Task | Status |
|---|------|--------|
| 1 | Add `POST /api/boomi/companion/packages` | done |
| 2 | Add `GET /api/boomi/companion/packages/[packageId]` | done |
| 3 | Add `GET /api/boomi/companion/packages/[packageId]/download` | done |
| 4 | Add `POST /api/boomi/companion/packages/[packageId]/result` | done |
| 5 | Deprecate `/api/boomi/publish` | done |
| 6 | Add feature flag `BOOMI_HELPER_ENABLE_LEGACY_XML_PUBLISH` | done |

## Workstream 6: Companion Agent Guidance

| # | Task | Status |
|---|------|--------|
| 1 | Write reusable prompt template for `COMPANION_AGENT_PROMPT.md` | done |
| 2 | Define agent role | done |
| 3 | Define hard constraints | done |
| 4 | Define build workflow | done |
| 5 | Define escalation rules | done |
| 6 | Add acceptance checklist for agent | done |

## Workstream 7: Security And Credential Boundary

| # | Task | Status |
|---|------|--------|
| 1 | Remove credentials from generated package | done |
| 2 | Generate only `.env.example` | done |
| 3 | Add UI copy stating credentials must be in Companion workspace | done |
| 4 | Do not export app-stored encrypted connection values | done |
| 5 | Add security leak tests scanning package contents | done |

## Workstream 8: Legacy XML Removal

| # | Task | Status |
|---|------|--------|
| 1 | Stop using `buildProposedXml` in primary workflow | done |
| 2 | Stop showing `proposedXml` and `diff` in primary UI | done |
| 3 | Move XML generator modules to legacy status | done |
| 4 | Remove "publish allowed types" from new workflow | done |
| 5 | Update README | done |

## Workstream 9: Result Reconciliation

| # | Task | Status |
|---|------|--------|
| 1 | Define `CompanionResult` schema | done |
| 2 | Validate result JSON before saving | done |
| 3 | Store result as `BoomiCompanionRunEvent` | done |
| 4 | Add paste/upload result UI | done |
| 5 | Optionally update local imported Boomi context from result | done |

## Workstream 10: Testing

| # | Task | Status |
|---|------|--------|
| 1 | Markdown renderer snapshot tests | done |
| 2 | `.env.example` content tests | done |
| 3 | UI text presence tests | done |
| 4 | Fixture tests (empty/minimal project) | done |
| 5 | Build spec unit tests | done |
| 6 | API route tests for package generation | done |
| 7 | Zip manifest tests | done |
| 8 | Result recording validation tests | done |
| 9 | Legacy publish feature-flag tests | done |
| 10 | Security leak tests | done |
| 11 | Migration/backward compatibility tests | done |
| 12 | End-to-end test | done |

## Workstream 11: Documentation And Rollout

| # | Task | Status |
|---|------|--------|
| 1 | User-facing docs: install Companion, generate package, fill `.env`, run agent, record result | done |
| 2 | Update README feature list | done |
| 3 | Update README safety model | done |
| 4 | Add migration notes | done |
| 5 | Add troubleshooting guide | done |
| 6 | Add architecture note | done |

---

## Artifacts Created

| File | Description | Date |
|------|-------------|------|
| `src/lib/domain.ts` | Added `BoomiBuildSpec` + 15 sub-types | 2026-05-31 |
| `src/lib/boomi-companion-schemas.ts` | Zod validation schemas for all Build Spec types | 2026-05-31 |
| `src/lib/boomi-companion-build-spec.ts` | `buildBoomiBuildSpec` pure function + all sub-extractors | 2026-05-31 |
| `src/lib/boomi-companion-build-spec.test.ts` | 7 unit tests: valid spec, no XML, no creds, Japanese, empty, blocked, ready | 2026-05-31 |
| `src/lib/boomi-companion-package.ts` | Package builder: all markdown/JSON generators, manifest, zip support | 2026-05-31 |
| `src/lib/boomi-companion-package.test.ts` | 17 tests: filename coverage, content verification, zip, security scan | 2026-05-31 |
| `prisma/schema.prisma` | Added `BoomiBuildPackage` and `BoomiCompanionRunEvent` models | 2026-05-31 |
| `prisma/migrations/20260531033758_add_boomi_companion_package_tables/` | Migration for new tables | 2026-05-31 |
| `src/lib/domain.ts` | Added `BuildPackageStatus`, `CompanionRunEventStatus`, `BoomiBuildPackage`, `BoomiCompanionRunEvent` types | 2026-05-31 |
| `src/lib/boomi-companion-mutations.ts` | Prisma CRUD for packages, result validation, feature flag helper | 2026-05-31 |
| `src/app/api/boomi/companion/packages/route.ts` | POST — generate package | 2026-05-31 |
| `src/app/api/boomi/companion/packages/[packageId]/route.ts` | GET — package metadata | 2026-05-31 |
| `src/app/api/boomi/companion/packages/[packageId]/download/route.ts` | GET — zip download | 2026-05-31 |
| `src/app/api/boomi/companion/packages/[packageId]/result/route.ts` | POST — record result | 2026-05-31 |
| `src/app/api/boomi/publish/route.ts` | Added feature-flag gate (410 when disabled) | 2026-05-31 |
| `src/lib/e2e-pipeline.test.ts` | Updated to enable legacy publish flag for e2e test | 2026-05-31 |
| `src/components/boomi-companion-tab.tsx` | New Companion Build Center UI replacing old BoomiApiLab | 2026-05-31 |
| `src/components/workspace-app.tsx` | Renamed tab to "Boomi Companion", wired new component, updated icon | 2026-05-31 |
| `src/app/api/boomi/companion/packages/[packageId]/prompt/route.ts` | GET — extract agent prompt text from package | 2026-05-31 |
| `src/lib/domain.ts` | Added `CompanionResult`, `CompanionResultComponent`, `CompanionResultDeployment`, `CompanionResultTest` types | 2026-05-31 |
| `src/lib/boomi-companion-schemas.ts` | Added `companionResultSchema` Zod schema | 2026-05-31 |
| `src/lib/boomi-companion-mutations.ts` | Upgraded result validation to use Zod companionResultSchema | 2026-05-31 |
| `src/lib/boomi-xml.ts` | Added `@legacy` marker | 2026-05-31 |
| `src/lib/boomi-sandbox.ts` | Added `@legacy` marker | 2026-05-31 |
| `README.md` | Updated for Companion workflow, retired XML generation, legacy flag docs | 2026-05-31 |
| `src/lib/boomi-companion-integration.test.ts` | 18 tests: API routes, result validation, legacy flag, migration, backward compat | 2026-05-31 |
| `docs/boomi-companion-user-guide.md` | User-facing Companion workflow guide | 2026-05-31 |
| `docs/boomi-companion-bridge-plan.md` | v2 Bridge plan — 10 workstreams, 92 tasks for direct Companion execution | 2026-05-31 |

## Current Phase

The Boomi Companion **v3 Agent Run** is being implemented. It replaces the v2 direct XML bridge as the primary Run button behavior. The app now prepares structured assets and an approved component plan, then invokes a configurable local Companion-enabled agent CLI. The app does not synthesize component XML for the primary run path.

| Phase | Document | Status |
|-------|----------|--------|
| Transition (v1) | `boomi-companion-transition-plan.md` | Complete |
| Bridge (v2) | `boomi-companion-bridge-plan.md` | Legacy |
| Agent Orchestration (v3) | User-provided implementation plan | Implemented |

## Agent Orchestration (v3) Implementation

| Workstream | Description | Status |
|------------|-------------|--------|
| v3-WS1 | Domain/schema types for v3 run status and agent plan | done |
| v3-WS2 | Workspace builder under `.boomi-helper/companion-runs/<runId>/` with build assets and temporary `.env` | done |
| v3-WS3 | No app-generated XML in v3 run workspaces | done |
| v3-WS4 | Safe component match planner with create/update/reuse/blocked actions | done |
| v3-WS5 | Configurable local agent command via `BOOMI_HELPER_COMPANION_AGENT_COMMAND` | done |
| v3-WS6 | SSE event stream for preflight, plan, logs, result, complete/error | done |
| v3-WS7 | Two-phase API: preflight then approve | done |
| v3-WS8 | UI Run button starts preflight, shows plan, requires approval before agent execution | done |
| v3-WS9 | Temporary credential redaction and `.env` cleanup | done |
| v3-WS10 | Focused v3 unit coverage | done |

### Key v3 Artifacts

| File | Description |
|------|-------------|
| `src/lib/boomi-companion-v3.ts` | v3 workspace, preflight, planner, agent orchestration, redaction, in-memory run state |
| `src/app/api/boomi/companion/packages/[packageId]/run/v3/preflight/route.ts` | Starts v3 preflight and returns the approval plan |
| `src/app/api/boomi/companion/packages/[packageId]/run/v3/approve/route.ts` | Starts the local agent only after stored preflight approval |
| `src/app/api/boomi/companion/packages/[packageId]/run/v3/events/route.ts` | SSE stream for v3 run progress |
| `src/lib/boomi-companion-v3.test.ts` | Unit coverage for workspace XML-free guarantee, planner, command builder, redaction, and agent cleanup |

## Bridge (v2) Implementation

All 10 Bridge workstreams are implemented:

| Workstream | Description | Status |
|------------|-------------|--------|
| Bridge-WS1 | Vendored Scripts (`scripts/companion-setup.ts`, `boomi-companion-scripts/`) | done |
| Bridge-WS2 | Script Runner (`src/lib/boomi-bridge-runner.ts`) | done |
| Bridge-WS3 | Workspace Builder (`src/lib/boomi-bridge-workspace.ts`) | done |
| Bridge-WS4 | Build Pipeline Engine (`src/lib/boomi-bridge-pipeline.ts`) | done |
| Bridge-WS5 | SSE Progress Streaming (`.../events/route.ts`) | done |
| Bridge-WS6 | Updated `/run` Route (real Companion execution) | done |
| Bridge-WS7 | UI: Pipeline Progress (stepper in `boomi-companion-tab.tsx`) | done |
| Bridge-WS8 | UI: Connection Reuse (mode badges, disabled states) | done |
| Bridge-WS9 | Testing (15 bridge-specific tests) | done |
| Bridge-WS10 | Documentation | done |

### Key Bridge Artifacts

| File | Description |
|------|-------------|
| `scripts/companion-setup.ts` | Downloads vendored Companion scripts from GitHub |
| `src/lib/boomi-bridge-runner.ts` | Safe `execFile` script execution with credential filtering |
| `src/lib/boomi-bridge-workspace.ts` | Temp workspace builder (`.env` + `active-development/` structure) |
| `src/lib/boomi-bridge-pipeline.ts` | Sequential build pipeline with progress events |
| `src/app/api/boomi/companion/packages/[packageId]/run/events/route.ts` | SSE endpoint for real-time progress streaming |
| `src/lib/boomi-bridge-runner.test.ts` | 11 unit tests (whitelist, exec, credential filter, parsing) |
| `src/lib/boomi-bridge-pipeline.test.ts` | 4 integration tests (workspace, pipeline, failure abort) |
