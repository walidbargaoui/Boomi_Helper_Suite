# Boomi Companion Bridge Plan (v2)

> Extends the Companion workflow to invoke Boomi Companion scripts directly from the app — no external agent required.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Script sourcing | Vendored at build time — scripts are copied into `boomi-companion-scripts/` automatically |
| User setup | **None** — the app fetches `OfficialBoomi/bc-integration` scripts into a vendored directory on `npm run companion:setup` |
| Credential model | **Override .env** — read the app's own Boomi connection, decrypt credentials, write them to the vendored workspace `.env` |
| Deploy gating | **Human approval required** — deploy step blocked until user confirms in UI |
| Shell safety | `child_process.execFile` only, whitelisted script list, no shell interpolation |

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Boomi Helper Suite (Next.js)                            │
│                                                          │
│  boomi-companion-scripts/          ← vendored at build   │
│    ├── boomi-common.sh              time from GitHub     │
│    ├── boomi-env-check.sh                                │
│    ├── boomi-folder-create.sh                            │
│    ├── boomi-component-create.sh                         │
│    ├── boomi-component-push.sh                           │
│    ├── boomi-deploy.sh                                   │
│    ├── boomi-test-execute.sh                             │
│    ├── boomi-undeploy.sh                                 │
│    └── boomi-component-pull.sh                           │
│                                                          │
│  POST /api/boomi/companion/packages/:id/run              │
│    │                                                     │
│    ├─► src/lib/boomi-bridge-runner.ts                    │
│    │     └── execFile(script, args, { cwd, env })        │
│    │                                                     │
│    ├─► src/lib/boomi-bridge-workspace.ts                 │
│    │     └── create active-development/ structure        │
│    │         write .env from decrypted Boomi connection  │
│    │                                                     │
│    └─► src/lib/boomi-bridge-pipeline.ts                  │
│          └── sequential steps with progress callbacks    │
│                                                          │
│  GET /api/boomi/companion/packages/:id/run/events        │
│    └── SSE endpoint for build progress streaming         │
└──────────────────────────────────────────────────────────┘
```

---

## Workstreams

### Bridge-WS1 — Vendored Scripts

**Goal:** The app includes Companion scripts at build time. No user clone, no SKILL_PATH env var.

| # | Task | Status |
|---|------|--------|
| 1 | Create `scripts/companion-setup.ts` — fetches `bc-integration/skills/boomi-integration/scripts/*.sh` + `boomi-common.sh` from GitHub and writes them into `boomi-companion-scripts/` | pending |
| 2 | Add `npm run companion:setup` script to `package.json` | pending |
| 3 | Add `boomi-companion-scripts/` to `.gitignore` (regenerated on setup) | pending |
| 4 | Add `predev`/`prebuild` hook that checks if vendored scripts exist; if not, runs `companion:setup` automatically | pending |
| 5 | Write `scripts/companion-setup.ts` — download logic using Node `https` module (zero external deps) | pending |
| 6 | Verify all 19 scripts + `boomi-common.sh` + `boomi-profile-inspect.py` are vendored | pending |
| 7 | Make all vendored scripts executable (`chmod +x`) | pending |

**Files to vendored directory:**

| Script | Purpose |
|--------|---------|
| `boomi-common.sh` | Shared utilities (load_env, boomi_api, etc.) — sourced by all others |
| `boomi-env-check.sh` | Check which .env vars are set (no value leak) |
| `boomi-folder-create.sh` | Create Boomi platform folders |
| `boomi-component-create.sh` | Create new component from XML file |
| `boomi-component-push.sh` | Update existing component |
| `boomi-component-pull.sh` | Download component from platform |
| `boomi-deploy.sh` | Deploy process to runtime |
| `boomi-undeploy.sh` | Remove deployment |
| `boomi-test-execute.sh` | Execute process and return execution ID |
| `boomi-execution-query.sh` | Query execution results and download logs |
| `boomi-wss-test.sh` | Test WSS listener endpoints |
| `boomi-version-history.sh` | List component version history |
| `boomi-component-diff.sh` | Compare component versions |
| `boomi-component-search.sh` | Query components by name/type/folder |
| `boomi-extensions.sh` | Get/set environment extensions |
| `boomi-branch.sh` | Branch and merge operations |
| `boomi-shared-server-info.sh` | Fetch shared server info |
| `boomi-profile-inspect.py` | Extract field metadata from large profiles |
| `event-streams-setup.sh` | Configure Event Streams |

**Acceptance criteria:**
- `npm run companion:setup` succeeds without errors
- `boomi-companion-scripts/` contains all 20 files
- All `.sh` files are executable
- Running `npm run dev` or `npm run build` automatically triggers setup if scripts are missing

---

### Bridge-WS2 — Script Runner

**Goal:** Safely execute vendored Companion scripts from Node.js.

**New file:** `src/lib/boomi-bridge-runner.ts`

| # | Task | Status |
|---|------|--------|
| 1 | Define `WHITELISTED_SCRIPTS` set — only these script names can be executed | pending |
| 2 | Define `ScriptResult` type: `{ ok, stdout, stderr, componentId?, exitCode, durationMs }` | pending |
| 3 | Implement `runCompanionScript(scriptName, args, cwd, env)` using `child_process.execFile` (NOT `exec`) | pending |
| 4 | Implement timeout per script type (5s for create, 15s for push, 30s for deploy) | pending |
| 5 | Filter stderr for credential-like patterns before returning to caller | pending |
| 6 | Resolve vendored script path: `path.join(projectRoot, "boomi-companion-scripts", scriptName)` | pending |
| 7 | Parse `boomi-env-check` output into structured `{ var: string, status: "SET" | "UNSET" }[]` | pending |
| 8 | Parse `boomi-component-create` output to extract `componentId` from stdout | pending |
| 9 | Write unit tests with mocked `child_process.execFile` | pending |

**Security constraints:**
- `execFile` only — the script name is the first arg, args are a flat string array. No shell metacharacter interpretation.
- Unknown script names → rejected with 400
- Working directory always set to a temp workspace (not project root)
- `.env` written fresh each time with only the vars needed by Companion

**Acceptance criteria:**
- `runCompanionScript("boomi-env-check.sh", [], cwd, env)` returns structured status
- `runCompanionScript("nonexistent.sh", ...)` throws "Script not whitelisted"
- Credential values never appear in returned stdout/stderr (only "SET"/"UNSET")
- Tests pass with mocked execFile without requiring actual Companion installation

---

### Bridge-WS3 — Workspace Builder

**Goal:** Build the Companion workspace directory from a stored `BoomiBuildSpec` and the app's Boomi connection.

**New file:** `src/lib/boomi-bridge-workspace.ts`

| # | Task | Status |
|---|------|--------|
| 1 | Create temp workspace dir: `os.tmpdir()/boomi-companion-workspace-<packageId>/` | pending |
| 2 | Write `.env` from decrypted Boomi connection (same connection used for legacy publish) | pending |
| 3 | Write `.env` vars: `BOOMI_API_URL`, `BOOMI_USERNAME`, `BOOMI_API_TOKEN`, `BOOMI_ACCOUNT_ID`, `BOOMI_ENVIRONMENT_ID`, `BOOMI_TEST_ATOM_ID`, `BOOMI_TARGET_FOLDER`, `BOOMI_VERIFY_SSL` | pending |
| 4 | Create `active-development/` directory structure per Companion convention | pending |
| 5 | Generate Component XML for each profile (source + destination) from the build spec and write to the appropriate `active-development/<component-type>/` subdirectory | pending |
| 6 | Generate Component XML for connections per endpoint and write to `active-development/connector-settings/` | pending |
| 7 | Generate Component XML for connector operations and write to `active-development/connector-action/` | pending |
| 8 | Generate Component XML for transform maps and write to `active-development/transform.map/` | pending |
| 9 | Generate process skeleton XML (placeholders for each flow node) and write to `active-development/process/` | pending |
| 10 | Reuse existing `buildProposedXml` from `boomi-xml.ts` for profile XML generation (scaffold mode) | pending |
| 11 | Clean up temp workspace on completion (unless `?keepWorkspace=true`) | pending |
| 12 | Write unit tests verifying directory structure and .env contents | pending |

**Directory structure built:**

```
/tmp/boomi-companion-workspace-<packageId>/
├── .env                              # from decrypted Boomi connection
└── active-development/
    ├── profile.flatfile/             # source profiles (Flat File, CSV, TSV)
    │   └── <profile-name>.xml
    ├── profile.json/                 # destination profiles (JSON)
    │   └── <profile-name>.xml
    ├── profile.xml/                  # XML profiles
    ├── profile.db/                   # database profiles
    ├── connector-settings/           # connection components
    │   └── <connection-name>.xml
    ├── connector-action/             # operation components
    │   └── <operation-name>.xml
    ├── transform.map/                # map components
    │   └── <map-name>.xml
    └── process/                      # process components
        └── <process-name>.xml
```

**Acceptance criteria:**
- Workspace directory matches Companion convention (naming, structure)
- `.env` contains all required vars with actual values (not placeholders)
- All profile fields from the build spec appear in generated XML
- Temp workspace is cleaned up after pipeline completion
- Tests verify directory structure without requiring Boomi credentials

---

### Bridge-WS4 — Build Pipeline Engine

**Goal:** Orchestrate the sequential Companion build steps, emitting progress events.

**New file:** `src/lib/boomi-bridge-pipeline.ts`

| # | Task | Status |
|---|------|--------|
| 1 | Define `PipelineStep` type: `{ step, stepName, status, output?, error?, componentId?, durationMs? }` | pending |
| 2 | Implement `runBuildPipeline(spec, workspaceDir, conn, onProgress)` | pending |
| 3 | Step 1: `env-check` — verify `.env` has required vars | pending |
| 4 | Step 2: `folder-create` — create/verify target Boomi folder | pending |
| 5 | Step 3: `profile-source` — create source profile component | pending |
| 6 | Step 4: `profile-dest` — create destination profile component | pending |
| 7 | Step 5: `connection-source` — create source connection component | pending |
| 8 | Step 6: `connection-dest` — create destination connection component | pending |
| 9 | Step 7: `operation-create` — create connector operation components | pending |
| 10 | Step 8: `map-create` — create transform map component | pending |
| 11 | Step 9: `process-create` — create process skeleton component | pending |
| 12 | Step 10: `update-steps` — push updates to wire connector/map steps into process | pending |
| 13 | Step 11: `deploy` — deploy to runtime **(gated on `?approveDeploy=true`)** | pending |
| 14 | Step 12: `test` — execute process and capture results | pending |
| 15 | Aggregate component IDs into `CompanionResult` JSON at pipeline end | pending |
| 16 | Auto-write result via `recordCompanionResult` | pending |
| 17 | Write integration test with mocked execFile for the full pipeline | pending |

**Pipeline step details:**

| # | Name | Script | Args | Timeout |
|---|------|--------|------|---------|
| 1 | env-check | `boomi-env-check.sh` | — | 5s |
| 2 | folder-create | `boomi-folder-create.sh` | folder name | 10s |
| 3 | profile-source | `boomi-component-create.sh` | XML file path | 10s |
| 4 | profile-dest | `boomi-component-create.sh` | XML file path | 10s |
| 5 | connection-source | `boomi-component-create.sh` | XML file path | 10s |
| 6 | connection-dest | `boomi-component-create.sh` | XML file path | 10s |
| 7 | operation-create | `boomi-component-create.sh` | XML file path | 10s |
| 8 | map-create | `boomi-component-create.sh` | XML file path | 10s |
| 9 | process-create | `boomi-component-create.sh` | XML file path | 10s |
| 10 | update-steps | `boomi-component-push.sh` | XML file path | 15s |
| 11 | deploy | `boomi-deploy.sh` | XML file path | 30s |
| 12 | test | `boomi-test-execute.sh` | --process-id | 15s |

**Acceptance criteria:**
- Pipeline runs all steps in dependency order
- Each step emits a progress event with status and timing
- Failed step aborts pipeline (no cascading failures)
- Deploy step requires `approveDeploy=true` flag
- Component IDs are collected and written to result JSON
- Tests cover: full happy path, env-check failure, create failure, deploy skip

---

### Bridge-WS5 — SSE Progress Streaming

**Goal:** Stream build progress to the UI in real-time.

**New route:** `GET /api/boomi/companion/packages/[packageId]/run/events`

| # | Task | Status |
|---|------|--------|
| 1 | Implement SSE endpoint using `ReadableStream` with `text/event-stream` content type | pending |
| 2 | Use a per-package `EventEmitter` to bridge pipeline progress to SSE | pending |
| 3 | Emit `progress` events with `{ step, stepName, status, output?, error?, componentId? }` | pending |
| 4 | Emit `complete` event with `{ totalSteps, ok, failed, skipped }` | pending |
| 5 | Emit `result` event with full `CompanionResult` JSON | pending |
| 6 | Emit `error` event with summary if pipeline aborts | pending |
| 7 | Handle SSE client disconnect — clean up listener | pending |
| 8 | Write test that connects to SSE, verifies event sequence | pending |

**Event stream format:**

```
event: progress
data: {"step":1,"stepName":"env-check","status":"running"}

event: progress
data: {"step":1,"stepName":"env-check","status":"ok","output":"All required variables set","durationMs":320}

event: progress
data: {"step":2,"stepName":"folder-create","status":"running"}

...

event: complete
data: {"totalSteps":12,"ok":9,"failed":0,"skipped":3}

event: result
data: {"schemaVersion":"1.0","packageId":"...","components":{"created":[...]}}
```

**Acceptance criteria:**
- SSE endpoint streams events as pipeline steps complete
- Client disconnect cleanly removes listener
- No stale events fire after disconnect
- Test verifies event ordering and payload shapes

---

### Bridge-WS6 — Updated `/run` Route

**Goal:** Replace the v1 stub with real Companion execution.

**Modify:** `src/app/api/boomi/companion/packages/[packageId]/run/route.ts`

| # | Task | Status |
|---|------|--------|
| 1 | Load package + spec from DB | pending |
| 2 | Load active Boomi connection for the project | pending |
| 3 | If no connection configured, return actionable error (not 500) | pending |
| 4 | Decrypt connection credentials | pending |
| 5 | Build workspace from spec + connection | pending |
| 6 | Start pipeline with progress emitter | pending |
| 7 | Return immediately with `{ packageId, status: "running", eventsUrl }` — do NOT block the HTTP request | pending |
| 8 | Parse `?approveDeploy=true` query param for deploy step | pending |
| 9 | On pipeline completion, auto-write `CompanionResult` via `recordCompanionResult` | pending |
| 10 | Clean up temp workspace unless `?keepWorkspace=true` | pending |
| 11 | Handle errors: if pipeline panics, write failed run event to DB | pending |

**Response (non-blocking):**

```json
{
  "packageId": "cmpt...",
  "status": "running",
  "eventsUrl": "/api/boomi/companion/packages/cmpt.../run/events",
  "message": "Build pipeline started. Connect to eventsUrl for progress."
}
```

**Acceptance criteria:**
- `/run` returns immediately (non-blocking)
- Pipeline runs in background, events stream via SSE
- Result auto-recorded on completion
- Connection missing → 400 with "No Boomi connection configured"
- Pipeline panic → error event emitted, failed run recorded

---

### Bridge-WS7 — UI: Pipeline Progress

**Goal:** Show real-time build progress in the Companion tab.

**Modify:** `src/components/boomi-companion-tab.tsx`

| # | Task | Status |
|---|------|--------|
| 1 | Add `runStatus` state: `"idle" | "running" | "complete" | "failed"` | pending |
| 2 | Add `pipelineSteps` state: `PipelineStep[]` | pending |
| 3 | Add "Run with Companion" button (shown after package generation) | pending |
| 4 | On click: POST `/run`, then connect to SSE events URL | pending |
| 5 | Render vertical stepper with per-step status icons (✓/⟳/○/✗) | pending |
| 6 | Auto-clear `resultJson` textarea — result is auto-recorded | pending |
| 7 | Show deploy confirmation dialog when pipeline reaches step 11 | pending |
| 8 | On completion: show summary (X created, Y updated, Z skipped) | pending |
| 9 | On failure: show which step failed and the error message | pending |
| 10 | Handle SSE disconnect/reconnect gracefully | pending |

**Stepper UI:**

```
Build Pipeline Progress
─────────────────────────
✓ env-check            (0.3s)
✓ folder-create         (1.2s)
✓ profile-source        (2.1s) → comp-id: cmpt...
✓ profile-dest          (1.8s) → comp-id: cmpt...
✓ connection-source     (2.4s) → comp-id: cmpt...
✓ connection-dest       (2.0s) → comp-id: cmpt...
✓ operation-create      (2.3s) → comp-id: cmpt...
✓ map-create            (3.1s) → comp-id: cmpt...
✓ process-create        (2.8s) → comp-id: cmpt...
✓ update-steps          (4.2s)
○ deploy                (awaiting approval)
  [Approve Deploy] [Skip Deploy]
○ test                  (pending)

Completed: 9/12 steps OK, 0 failed, 3 skipped
```

**Acceptance criteria:**
- Button appears after package generation
- SSE events update the stepper in real-time
- Deploy step shows confirmation dialog
- Result auto-recorded, no manual paste needed
- On completion: run appears in Companion Run History

---

### Bridge-WS8 — UI: Connection Reuse

**Goal:** The app's existing Boomi connection drives the Companion bridge. No separate credential setup.

**Modify:** `src/components/boomi-companion-tab.tsx`

| # | Task | Status |
|---|------|--------|
| 1 | Show connection selector in the Companion tab header (same as legacy tab) | pending |
| 2 | Show connection status: "Using: Sandbox (abc-123)" or "No connection" | pending |
| 3 | If no connection, "Run with Companion" button is disabled with message: "Configure a Boomi connection first" | pending |
| 4 | Connection mode indicator: sandbox = green badge, mock = yellow warning "Mock mode — Companion will not push to real Boomi" | pending |
| 5 | Extract and pass `connectionId` to `/run` endpoint | pending |

**Acceptance criteria:**
- Existing Boomi connections appear in Companion tab
- Mock mode shows warning
- No connection → button disabled with helpful message

---

### Bridge-WS9 — Testing

| # | Task | Status |
|---|------|--------|
| 1 | Unit tests for `boomi-bridge-runner.ts` with mocked execFile | pending |
| 2 | Unit tests for `boomi-bridge-workspace.ts` verifying dir structure | pending |
| 3 | Unit tests for `boomi-bridge-pipeline.ts` with full happy path | pending |
| 4 | Unit tests for pipeline error handling (env-check fail, create fail) | pending |
| 5 | Integration test for SSE endpoint (connect, receive events, disconnect) | pending |
| 6 | Integration test for `/run` complete flow | pending |
| 7 | Test that credentials never appear in pipeline output or auto-recorded result | pending |
| 8 | Test workspace cleanup after pipeline | pending |
| 9 | Test `companion:setup` script end-to-end | pending |

**Acceptance criteria:**
- `npm run lint` passes
- `npm run test` passes
- All new modules have >80% branch coverage
- No actual Boomi API calls in tests (all mocked)

---

### Bridge-WS10 — Documentation

| # | Task | Status |
|---|------|--------|
| 1 | Update README with Companion Bridge feature description | pending |
| 2 | Update `docs/boomi-companion-user-guide.md` with bridge workflow | pending |
| 3 | Add architecture note: why scripts are vendored, credential flow | pending |
| 4 | Add `docs/boomi-companion-bridge-plan.md` (this file) | pending |

---

## Implementation Order

```
Bridge-WS1  →  Vendored Scripts             (foundation — must be first)
Bridge-WS2  →  Script Runner                (depends on WS1)
Bridge-WS3  →  Workspace Builder            (independent)
Bridge-WS4  →  Build Pipeline Engine        (depends on WS2, WS3)
Bridge-WS5  →  SSE Progress Streaming       (depends on WS4)
Bridge-WS6  →  Updated /run Route           (depends on WS4, WS5)
Bridge-WS7  →  UI: Pipeline Progress        (depends on WS5)
Bridge-WS8  →  UI: Connection Reuse         (independent)
Bridge-WS9  →  Testing                      (after WS4, parallelizable)
Bridge-WS10 →  Documentation                (after all)
```

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Vendored scripts break on GitHub URL change | Medium | Version pin to a release tag; setup script validates checksums |
| Shell injection via XML content in args | Critical | `execFile` with args array; XML written to temp files, not passed as CLI args |
| Credential leak in stdout | High | `boomi-env-check` hides values; pipe stderr through credential filter; never echo decrypted credentials |
| Temp workspace accumulates over runs | Low | Clean in finally; `?keepWorkspace=true` for debug; cron-able cleanup |
| Long deploys block pipeline | Medium | 30s timeout; deploy runs async and returns status URL for polling |
| Concurrent runs on same package | Medium | Check for existing "running" status before starting; reject with 409 |

## Summary

| Workstream | Description | Tasks |
|------------|-------------|-------|
| Bridge-WS1 | Vendored Scripts | 7 |
| Bridge-WS2 | Script Runner | 9 |
| Bridge-WS3 | Workspace Builder | 12 |
| Bridge-WS4 | Build Pipeline Engine | 17 |
| Bridge-WS5 | SSE Progress Streaming | 8 |
| Bridge-WS6 | Updated /run Route | 11 |
| Bridge-WS7 | UI: Pipeline Progress | 10 |
| Bridge-WS8 | UI: Connection Reuse | 5 |
| Bridge-WS9 | Testing | 9 |
| Bridge-WS10 | Documentation | 4 |
| **Total** | | **92 tasks** |
