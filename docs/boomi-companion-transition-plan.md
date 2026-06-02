# Boomi Companion Transition Plan

## Summary

Replace the current XML-generation-and-publish feature with a **Hybrid Boomi Companion workflow**.

The app will stop presenting locally generated XML as publishable truth. Instead, it will collect all project intent from profiles, mappings, endpoints, connections, process flow, FMD sections, quality checks, and imported Boomi context into a structured **Boomi Build Spec**. The app will package that spec into a **Companion-ready workspace** containing markdown runbooks, JSON facts, acceptance criteria, and an agent prompt. A Boomi Companion-enabled agent will then perform the actual Boomi component creation, update, push, deploy, and testing using the official Companion skill and CLI scripts.

Chosen defaults:

- Integration mode: **Hybrid first**
- Credential model: **Companion `.env` only**
- Plan document path: `docs/boomi-companion-transition-plan.md`
- Do not vendor `OfficialBoomi/bc-integration` into this app in v1.
- Do not run Boomi Companion scripts from the Next.js app in v1.
- Remove direct publish as a primary app workflow.
- Keep historical publish records read-only for audit.

External references:

- [OfficialBoomi/bc-integration](https://github.com/OfficialBoomi/bc-integration)
- [Boomi Companion overview](https://developer.boomi.com/docs/BoomiCompanion/Boomi_companion_overview)
- [boomi-integration skill](https://github.com/OfficialBoomi/bc-integration/tree/main/skills/boomi-integration)

## Shared Contracts

All workstreams below can proceed in parallel against these contracts.

### `BoomiBuildSpec`

Create a new TypeScript domain type and matching validation schema.

Required top-level fields:

```ts
type BoomiBuildSpec = {
  schemaVersion: "1.0";
  generatedAt: string;
  sourceApp: "Boomi Helper Suite";
  project: BuildProjectSummary;
  target: BuildTargetIntent;
  endpoints: BuildEndpoint[];
  profiles: BuildProfile[];
  mappingSets: BuildMappingSet[];
  processFlows: BuildProcessFlow[];
  fmdSections: BuildFmdSectionSummary[];
  importedBoomiContext: BuildImportedBoomiContext;
  readiness: BuildReadinessReport;
  acceptanceCriteria: string[];
  openQuestions: string[];
};
```

Rules:

- The spec must contain **no publishable XML**.
- The spec must not include decrypted credentials.
- Preserve Japanese text, technical field names, field paths, comments, mapping expressions, and user-entered process notes exactly.
- Every local entity must include its stable app ID so results can later be reconciled back.
- Every Boomi component reference must distinguish local draft IDs from real Boomi component IDs.

### `BoomiBuildPackage`

A generated build package is a folder or zip with this structure:

```text
boomi-companion-package/
  README_RUNBOOK.md
  COMPANION_AGENT_PROMPT.md
  BOOMI_BUILD_SPEC.json
  PROJECT_INTENT.md
  PROFILES.md
  MAPPINGS.md
  ENDPOINTS_AND_CONNECTIONS.md
  PROCESS_FLOW.md
  READINESS_AND_ACCEPTANCE.md
  OPEN_QUESTIONS.md
  COMPANION_RESULT_TEMPLATE.json
  .env.example
  active-development/
    README.md
```

Rules:

- `active-development/` starts empty except for guidance files.
- `.env.example` lists Boomi Companion variables only; no secrets are generated.
- `COMPANION_AGENT_PROMPT.md` must explicitly tell the agent not to use app-generated XML.
- The package must instruct the Companion agent to create/pull/update components using Companion references and scripts.

### New API Surface

Add these app routes:

```text
POST /api/boomi/companion/packages
GET  /api/boomi/companion/packages/[packageId]
GET  /api/boomi/companion/packages/[packageId]/download
POST /api/boomi/companion/packages/[packageId]/result
```

Route behavior:

- `POST /packages` generates a build spec and package metadata.
- `GET /packages/[id]` returns metadata, readiness, warnings, and file manifest.
- `GET /download` returns a zip archive.
- `POST /result` records a manually supplied Companion result JSON after the external agent run.

No route in v1 directly invokes Boomi Companion scripts, LLMs, `curl`, or Boomi deploy commands.

## Parallel Workstream 1: Data Model And Migration

Difficulty: **Senior**

Goal: add persistent tracking for Companion build packages while preserving old publish history.

Tasks:

- Add a new `BoomiBuildPackage` Prisma model.
- Add a new `BoomiCompanionRunEvent` Prisma model.
- Keep existing `BoomiComponentDraft` and `BoomiPublishEvent` tables for backward compatibility.
- Mark old XML drafts as legacy in application logic, not necessarily by destructive migration.
- Add domain types for package status:
  - `draft`
  - `ready`
  - `downloaded`
  - `result_recorded`
  - `failed`
- Add run event status:
  - `handoff_created`
  - `agent_started`
  - `agent_completed`
  - `agent_failed`
  - `manual_result_recorded`
- Store `specJson`, `manifestJson`, `readinessJson`, and `resultJson`.
- Store generated package files either:
  - as regenerated-on-demand from DB JSON, recommended for v1, or
  - as local ignored artifacts under `.boomi-helper/packages/`, optional.
- Do not store zip binaries in SQLite.
- Add indexes on `projectId`, `createdAt`, and `status`.

Acceptance criteria:

- Existing projects load without migration data loss.
- Existing publish history remains visible.
- New package records can be created without requiring Boomi credentials.
- Sanitized project responses do not leak large generated package bodies unless explicitly requested.

## Parallel Workstream 2: Build Spec Extractor

Difficulty: **Senior**

Goal: convert the current project model into a complete, XML-free Boomi build instruction dataset.

Tasks:

- Create a pure function `buildBoomiBuildSpec(project): BoomiBuildSpec`.
- Include project metadata:
  - process ID
  - name
  - description
  - source system
  - destination system
  - owner
  - schedule
  - status
  - folder
- Include endpoints:
  - role
  - connector type
  - profile type
  - format
  - purpose
  - connection info
- Include profiles:
  - role
  - type
  - format
  - root path
  - all fields
  - parent path
  - name
  - label
  - description
  - data type
  - length
  - required flag
  - key field flag
  - format
  - sample
  - ordinal
- Include mapping sets:
  - name
  - source profile reference
  - destination profile reference
  - direction
  - status
  - every rule
  - source field reference
  - destination field reference
  - mapping type
  - expression
  - default value
  - comment
  - quality status
  - reviewed flag
  - transform nodes
- Include process flows:
  - nodes
  - edges
  - node labels
  - descriptions
  - node types
  - layout positions
  - notes
- Include FMD section summaries:
  - section type
  - title
  - structured content summary
  - evidence useful to Boomi build decisions
- Include imported Boomi context:
  - imported component names
  - component types
  - real component IDs when known
  - versions if known
  - whether template XML exists
  - dependency scan summaries
- Include readiness report:
  - missing source/destination profile
  - unmapped required fields
  - unreviewed mappings
  - mapping quality errors
  - missing endpoint details
  - missing process flow
  - missing target folder hint
  - missing acceptance criteria
- Include open questions:
  - generated from incomplete data
  - never invent answers
  - phrase questions for the Boomi Companion agent or human reviewer

Acceptance criteria:

- Unit tests prove all current project facts are represented.
- No XML string from `templateXml` or `proposedXml` appears in the build spec.
- No decrypted credential or API token appears in the build spec.
- Snapshot tests cover Japanese FMD/project data.

## Parallel Workstream 3: Companion Package Renderer

Difficulty: **Medium**

Goal: render the build spec into a human- and agent-readable workspace package.

Tasks:

- Create a package builder module that takes `BoomiBuildSpec` and returns a file manifest.
- Generate `README_RUNBOOK.md` with:
  - package purpose
  - required Boomi Companion setup
  - required `.env` variables
  - safe execution order
  - push/deploy approval reminders
- Generate `COMPANION_AGENT_PROMPT.md` with strict instructions:
  - use OfficialBoomi Boomi Companion
  - read Companion `BOOMI_THINKING.md` first
  - use relevant component and step references before creating XML
  - prefer existing components and connection discovery
  - create/push incrementally
  - never use Boomi Helper generated XML as source of truth
  - write component IDs and results into `COMPANION_RESULT_TEMPLATE.json`
- Generate `BOOMI_BUILD_SPEC.json` as canonical machine input.
- Generate markdown views:
  - `PROJECT_INTENT.md`
  - `PROFILES.md`
  - `MAPPINGS.md`
  - `ENDPOINTS_AND_CONNECTIONS.md`
  - `PROCESS_FLOW.md`
  - `READINESS_AND_ACCEPTANCE.md`
  - `OPEN_QUESTIONS.md`
- Generate `.env.example` with:
  - `BOOMI_API_URL`
  - `BOOMI_USERNAME`
  - `BOOMI_API_TOKEN`
  - `BOOMI_ACCOUNT_ID`
  - `BOOMI_ENVIRONMENT_ID`
  - `BOOMI_TEST_ATOM_ID`
  - `BOOMI_TARGET_FOLDER`
  - `BOOMI_VERIFY_SSL`
- Generate `COMPANION_RESULT_TEMPLATE.json` with empty result fields:
  - components created
  - components updated
  - deployments
  - tests run
  - warnings
  - errors
  - open follow-ups
- Build zip download support.
- Ensure filenames are stable and safe for local filesystems.

Acceptance criteria:

- Downloaded package unzips into the exact target structure.
- Markdown files are readable without the app.
- JSON validates against schema.
- Package can be handed to a separate Companion-enabled agent without additional app context.

## Parallel Workstream 4: Boomi UI Replacement

Difficulty: **Medium**

Goal: replace the XML preview/publish experience with a Companion Build Center.

Tasks:

- Rename the current “Boomi API” tab to “Boomi Companion” or “Boomi Build”.
- Replace “Component XML Preview” with “Companion Build Package”.
- Primary actions:
  - `Generate Build Package`
  - `Download Package`
  - `Copy Agent Prompt`
  - `Record Companion Result`
- Remove primary `Run dry-run` and `Publish to sandbox` buttons from the main workflow.
- Keep old XML draft cards hidden behind a “Legacy XML Drafts” disclosure only if needed.
- Replace “Publish Safety Check” with “Build Readiness Check”.
- Show readiness categories:
  - Project intent
  - Profiles
  - Mappings
  - Process flow
  - Endpoints/connections
  - Boomi context
  - Open questions
- Show package manifest after generation.
- Show clear copy explaining that Boomi work is performed by Companion outside the app.
- Add a result-recording UI:
  - paste JSON
  - upload JSON file
  - validate result shape
  - record component IDs and run summary
- Keep publish history visible as “Legacy Publish History”.
- Add new “Companion Run History”.

Acceptance criteria:

- A user can generate and download a package without Boomi credentials in the app.
- UI no longer implies that app-generated XML is publishable.
- Legacy publish actions are not reachable from the main happy path.
- Result recording updates run history without requiring Boomi API access.

## Parallel Workstream 5: API Route Refactor

Difficulty: **Medium**

Goal: add Companion package APIs and deprecate direct publish APIs safely.

Tasks:

- Add `POST /api/boomi/companion/packages`.
- Add package metadata retrieval.
- Add package zip download.
- Add result recording.
- Keep `/api/boomi/publish` temporarily but mark as deprecated.
- Return HTTP `410 Gone` or feature-flag disable direct publish once UI migration is complete.
- Keep `/api/boomi/dry-run` available only for legacy tests until removed.
- Add feature flag:
  - `BOOMI_HELPER_ENABLE_LEGACY_XML_PUBLISH=false` by default.
- If flag is false:
  - `/api/boomi/publish` refuses with a message pointing to Companion workflow.
  - rollback route refuses direct rollback.
- Preserve component lookup/template import only as legacy context import if still useful.
- Do not require Boomi credentials for package generation.

Acceptance criteria:

- Package APIs work with no Boomi connection configured.
- Legacy publish route cannot mutate Boomi unless explicitly enabled.
- Error responses are actionable and do not expose secrets.
- Existing tests are updated rather than deleted blindly.

## Parallel Workstream 6: Companion Agent Guidance

Difficulty: **Senior**

Goal: make the exported prompt strong enough that the Boomi Companion agent is genuinely guided by app data.

Tasks:

- Write a reusable prompt template for `COMPANION_AGENT_PROMPT.md`.
- The prompt must define the agent role:
  - “You are implementing this Boomi integration using OfficialBoomi Boomi Companion.”
- The prompt must define hard constraints:
  - do not use app-generated XML
  - do not invent missing credentials
  - do not deploy without explicit human approval
  - preserve all field names and Japanese text
  - prefer existing components when provided
  - document every component ID created or reused
- The prompt must define the build workflow:
  - inspect `BOOMI_BUILD_SPEC.json`
  - read markdown summaries
  - run Companion env check
  - create target folder if needed
  - create or reuse profiles
  - create or reuse connections
  - create operations
  - create maps
  - create process
  - push incrementally
  - deploy only after approval
  - test if environment details are available
  - write result JSON
- The prompt must define escalation rules:
  - ask when required Boomi details are missing
  - ask before broad component reuse choices
  - stop on connector types not covered by Companion references
  - stop on validation errors after documented troubleshooting attempts
- Add an acceptance checklist for the agent:
  - all mapped destination fields accounted for
  - all required destination fields handled
  - all process flow nodes represented or explicitly deferred
  - component IDs recorded
  - deployment status recorded
  - test evidence recorded

Acceptance criteria:

- Prompt is deterministic enough to hand to another agent.
- Prompt references the package files by exact filename.
- Prompt does not rely on hidden app state.
- Prompt makes approval gates explicit.

## Parallel Workstream 7: Security And Credential Boundary

Difficulty: **Senior**

Goal: ensure the new workflow does not leak or duplicate secrets.

Tasks:

- Remove credentials from generated package.
- Generate only `.env.example`.
- Add UI copy stating credentials must be configured in the Companion workspace.
- Do not export app-stored encrypted connection values.
- Do not decrypt credentials during package generation.
- Add tests that scan generated package contents for:
  - API token-like values
  - encrypted credential fields
  - masked credential strings
  - Basic auth headers
- Update README safety model.
- Decide whether existing app connection management remains:
  - v1 default: keep it only for legacy lookup/import if still visible
  - no new workflow depends on it
- Add a warning if a user records Companion result containing obvious secrets.

Acceptance criteria:

- Package generation is safe on projects with saved Boomi connections.
- No generated file contains `apiPassword`, decrypted token, or authorization header.
- Security tests fail if credentials appear in package output.

## Parallel Workstream 8: Legacy XML Removal

Difficulty: **Senior**

Goal: remove the app’s dependency on self-authored publish XML without breaking unrelated features.

Tasks:

- Stop using `buildProposedXml` in the primary Boomi workflow.
- Stop showing `proposedXml` and `diff` in primary UI.
- Move XML generator modules to legacy status.
- Keep XML generation tests temporarily if other exports still depend on them.
- Remove “publish allowed types” from the new workflow.
- Replace “template required before publish” with “Companion package readiness”.
- Leave imported template XML usable only as context metadata, not as direct patch input.
- Decide later whether `src/lib/boomi-xml.ts` is deleted after all references are gone.
- Update README:
  - remove “dry-run XML generation” as a core feature
  - add “Companion-ready build package”
  - clarify direct publish is legacy/disabled

Acceptance criteria:

- New happy path has zero dependency on local XML generation.
- No visible UI claims the app can safely publish generated XML.
- Legacy XML code is isolated and feature-flagged or clearly marked.

## Parallel Workstream 9: Result Reconciliation

Difficulty: **Medium**

Goal: bring Companion run output back into the app without direct Boomi API control.

Tasks:

- Define `CompanionResult` schema.
- Required result fields:
  - package ID
  - run timestamp
  - agent/tool used
  - Boomi account ID if provided
  - target environment ID if provided
  - created components
  - updated components
  - reused components
  - deployments
  - tests
  - warnings
  - errors
  - open follow-ups
- Component result fields:
  - local app entity ID if known
  - component ID
  - component name
  - component type
  - action
  - version if known
  - file path if known
- Add paste/upload result UI.
- Validate result JSON before saving.
- Store result as a `BoomiCompanionRunEvent`.
- Optionally update local imported Boomi context from result component IDs.
- Never treat recorded result as proof of deployment unless deployment evidence exists in result.

Acceptance criteria:

- Invalid JSON is rejected with field-level errors.
- Valid result appears in Companion Run History.
- Result can link back to profiles, maps, and process flow where local IDs are present.

## Parallel Workstream 10: Testing

Difficulty: **Mixed**

Junior tasks:

- Add markdown renderer snapshot tests.
- Add `.env.example` content tests.
- Add UI text presence tests for new labels.
- Add fixture tests for empty project and minimal project.

Medium tasks:

- Add build spec unit tests.
- Add API route tests for package generation.
- Add zip manifest tests.
- Add result recording validation tests.
- Add legacy publish feature-flag tests.

Senior tasks:

- Add security leak tests scanning full package output.
- Add migration/backward compatibility tests.
- Add end-to-end test:
  - seed project
  - generate package
  - download zip
  - inspect files
  - record fake Companion result
  - verify run history
- Add regression test proving no `proposedXml` appears in the new build package.

Acceptance criteria:

- `npm run lint` passes.
- `npm run test` passes.
- `npm run build` passes.
- New tests cover both happy path and blocked readiness cases.

## Parallel Workstream 11: Documentation And Rollout

Difficulty: **Junior to Medium**

Goal: make the new workflow understandable and safe.

Tasks:

- Add `docs/boomi-companion-transition-plan.md`.
- Add user-facing docs:
  - how to install Boomi Companion
  - how to generate a package
  - how to fill `.env`
  - how to run a Companion agent
  - how to record result JSON
- Update README feature list.
- Update README safety model.
- Add migration notes:
  - direct publish is legacy
  - old publish history remains read-only
  - credentials are now expected in Companion `.env`
- Add troubleshooting:
  - Companion not installed
  - missing `.env`
  - missing `jq`
  - missing `curl`
  - Boomi API auth failure
  - package has open questions
  - result JSON invalid
- Add a short architecture note explaining why local XML generation was retired.

Acceptance criteria:

- A new developer can understand the workflow without reading the old XML generator code.
- A Boomi architect can run the exported package with Companion from docs alone.
- Documentation does not imply Boomi supports this app directly.

## Suggested Implementation Order

These are parallelizable, but this order reduces integration friction:

1. Build Spec Extractor
2. Package Renderer
3. Data Model And Migration
4. API Route Refactor
5. UI Replacement
6. Agent Guidance
7. Security Boundary
8. Result Reconciliation
9. Legacy XML Removal
10. Tests
11. Documentation

For parallel execution:

- Team A: Build Spec + Package Renderer
- Team B: Data Model + API Routes
- Team C: UI Replacement + Result Recording
- Team D: Agent Prompt + Documentation
- Team E: Security + Tests + Legacy Publish Lockdown

## Final Acceptance Criteria

The transition is complete when:

- Users no longer publish app-generated Boomi XML from the primary UI.
- Users can generate and download a Companion-ready build package.
- The package contains all project intent needed for a Companion-enabled agent.
- The package contains no secrets and no publishable generated XML.
- The app can record Companion run results.
- Legacy publish history remains readable.
- Direct publish routes are disabled by default.
- Tests prove the new workflow works without Boomi credentials stored in the app.
