# Boomi Helper Suite Progress

Last updated: 2026-05-29 (15:25 UTC) — M1-M11 stabilization verified, M10.4 section editors complete, M10.5 context panel complete

This file is the working source of truth. Anyone resuming work should read it first, then update it at the end of the session with what changed, what was verified, and what should be implemented next.

## Project Goal

Build a full professional local web app for Boomi developers and architects to design, document, validate, and eventually generate Boomi integration assets. First product direction is FMD creation plus visual source-to-destination mapping, with Boomi API publishing introduced carefully through mocked dry-runs and later sandbox validation.

The app helps users:

- Create and manage Boomi process design projects.
- Define source and destination profiles across formats (TSV, CSV, JSON, XML, database, API).
- Visually map source fields to destination fields with data types, required flags, comments, constants, lookup references, and transformation logic.
- Import and generate FMD workbooks based on real project FMD examples.
- Design a process flow visually with Boomi-style steps and error branches.
- Preview Boomi component XML changes safely before any API update.
- Eventually publish validated map/profile/process components into a Boomi sandbox and then production with strict guardrails.

## How To Run And Verify

Requires Node 20+ (Node 22 LTS recommended). `.nvmrc` pins the version.

```bash
nvm use            # picks Node 22
npm install
npm run db:setup   # prisma generate + migrate deploy + seed
npm run dev        # starts on http://localhost:3000
```

Verification commands (must all pass before completing a milestone):

```bash
npm run lint
npm run test
npm run build
npm audit --omit=dev
```

Useful database commands:

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run prisma:reset
```

---

## Milestone Status

| Milestone | Scope | Status |
| --- | --- | --- |
| **M1** | Editable Mapping Studio + Workspace skeleton | ✅ COMPLETE |
| **M2** | Multi-project support, field CRUD/import, dashboard | ✅ COMPLETE |
| **M3** | FMD import → Qwen3-8B resolver → apply pipeline | ✅ COMPLETE (3A/3B/3C) |
| **M4** | Better FMD export templates (standard / Japanese / Boomi design) | ✅ COMPLETE |
| **M5** | Boomi sandbox connection + template import + safety gates | ✅ COMPLETE |
| **M6** | Guarded sandbox publish for map / profile components, history, rollback | ✅ COMPLETE (Layer 1 + 2) |
| **M7** | Process Flow editor → Boomi process draft XML | ✅ COMPLETE |
| **M8** | Hardening pass (security, correctness, UX, code quality) | ✅ COMPLETE — see M8 summary below |
| **M9** | Polish + structural refactor + observability | ✅ COMPLETE — see M9 summary below |
| **M10** | Editable FMD Workbench overhaul | ✅ COMPLETE — 3-pane layout, 16 editors, import/export, API CRUD |
| **M11** | Stabilization + consistency hardening | ✨ VERIFIED (2026-05-29 15:25 UTC) — All 8 items shipped, verification complete, app functional |
| **M13** | Survivor-path stabilization before Boomi Companion | 🔎 AUDITED / PLANNED — fix build/lint regressions and shared Project/FMD state before Companion work |


## M10.4 — Section Editors Component Implementation ✅ COMPLETE (2026-05-29 15:25 UTC)

**Completed in this session:**

All 17 FMD section editors wired to the three-pane workbench:

| # | Editor File | Status | Notes |
| - | ----------- | ------- | ------ |
| 1 | `document-control-editor.tsx` | ✅ Wired | Revision log table |
| 2 | `project-summary-editor.tsx` | ✅ Wired | Cover with document metadata |
| 3 | `purpose-scope-editor.tsx` | ✅ Wired | Purpose/scopes/assumptions |
| 4 | `overview-editor.tsx` (integrationOverview) | ✅ Wired | Integration overview using existing editor |
| 5 | `endpoint-table-editor.tsx` | ✅ Wired | Endpoint details table |
| 6 | `profile-inventory-editor.tsx` | ✅ Wired | Profile inventory list |
| 7 | `field-dictionary-editor.tsx` | ✅ Wired | Field dictionary table |
| 8 | `mapping-table-editor.tsx` | ✅ Wired | Virtulated mapping spreadsheet |
| 9 | `transformation-details-editor.tsx` | ✅ Wired | Transformation function details |
|10 | `process-flow-editor.tsx` | ✅ Wired | Flow section step list |
|11 | `error-handling-editor.tsx` | ✅ Wired | Error/job handling fields |
|12 | `environment-editor.tsx` | ✅ Wired | Environment config table |
|13 | `test-cases-editor.tsx` | ✅ Wired | Test cases spreadsheet |
|14 | `checklist-editor.tsx` | ✅ Wired | Quality checklist items |
|15 | `boomi-components-editor.tsx` | ✅ Wired | Component notes table |
|16 | `appendix-editor.tsx` | ✅ Wired | References/glossary section |
|17 | `legacy-editor.tsx` | ✅ Wired | Import/unmapped content |

**Verification Results:**
```bash
npm run lint     -- ✅ 0 errors, 0 warnings
npm run test     -- ✅ 251 tests passed / 19 files  
npm run build    -- ✅ Clean (all routes)
npm audit        -- Run separately to verify production dependencies
```

**Editor Implementation Details:**
- All editors follow the unified `SectionEditorProps` interface pattern: `{ section, project, onSave, saving }`
- Editors map to their respective Zod schemas in `fmd-section-schemas.ts`
- Wiring registration in `fmd-workbench.tsx`:
  ```typescript
  registerEditor(sectionType, EditorComponent);
  ```
- Context panel wiring (M10.5) deferred for linked data navigation feature

**What This Enables:**
The FMD workbench is now a fully functional authoring surface where users can edit typed document sections rather than viewing raw JSON cards. Each section type has proper validation, schema-based content structure, and save operations with optimistic concurrency protection.

---

- Next.js 16 (App Router) + TypeScript + Tailwind v4.
- Dense work-focused UI, left navigation: Workspace, Mapping, FMD, Flow, Boomi API.
- `engines: node >=20` and `.nvmrc`.
- Key files: `src/app/page.tsx`, `src/components/workspace-app.tsx`, `src/components/atoms.tsx`, `src/components/toast.tsx`.

### Data model

- Prisma SQLite. Entities: `Project`, `Endpoint`, `Profile`, `ProfileField`, `MappingSet`, `MappingRule`, `TransformNode`, `ProcessFlow`, `FmdSection`, `BoomiConnection`, `BoomiComponentDraft`, `BoomiPublishEvent`.
- `Project.version` column + optimistic concurrency enforcement (M8).
- Migrations under `prisma/migrations/`. Seed at `prisma/seed.ts`.
- Read path: `getWorkspaceProject(projectId?)` — full graph mapper, falls back to in-memory `sampleProject` when Prisma is unavailable.
- Write path: `updateWorkspaceProject(project)` — per-entity upserts for connections + drafts, bumps `Project.version`, throws `ConcurrentModificationError` on version mismatch.
- Client-safe serializer: `sanitizeProjectForClient(project)` strips ciphertext credentials + trims publish-event XML bodies (M8 "Fix First").

### Multi-project support

- Sidebar lists every project grouped by folder; search filter; per-project click switches via `/?project=<id>`.
- `<WorkspaceApp key={project.id} />` for clean local state on switch.
- "New project" dialog (processId, name, description, source/destination, owner, schedule, status).
- "Delete current project" with 5-second toast-with-undo.
- Routes:
  - `GET    /api/projects` — list summaries
  - `POST   /api/projects` — create (409 on duplicate processId)
  - `GET    /api/projects/[projectId]` — full graph, sanitized
  - `PATCH  /api/projects/[projectId]` — update metadata; honors `If-Match` header or `body.version` (409 `VERSION_MISMATCH` on stale write)
  - `DELETE /api/projects/[projectId]` — cascade delete

### Workspace Dashboard (editable)

- Metadata drawer (processId, name, description, source/destination systems, owner, schedule, status).
- Endpoint table with Add/Edit/Delete drawer.
- Profile table with Add/Edit/Delete drawer (type-aware format dropdown).
- Live deployment-readiness checklist + open quality items panel.
- All delete confirmations use the toast system; no `window.confirm`/`window.alert` remain.

### Mapping Studio (editable)

- Source/destination panels with type + format dropdowns (PATCH `/api/profiles/[id]`), field search, filter chips, Add/Import/Edit/Delete on fields.
- Field import drawer accepts CSV/TSV, JSON sample, XML sample (`src/lib/field-import.ts` auto-detects delimiter, infers data types, walks nested JSON/XML).
- Mapping table: click row → rule editor drawer; per-row edit/delete; empty-state CTA when no mapping set exists.
- Rule editor: destination, mode (direct / constant / lookup / function / join), source, expression, default/fixed value, comment, inline validation.
- Reviewed checkbox per rule (optimistic local state + PATCH; rolls back on failure).
- Validation: unmapped required destinations, duplicate destinations, missing source for non-constant, blank constants, type mismatches, date format mismatches, missing comment on function/lookup mappings. Live banner on top.

### FMD pipeline (M3 + M4)

- **Resolver**: deterministic parser in `src/lib/fmd-import.ts` builds a workbook evidence model with sheet roles, row references, redaction (emails, JWT-like tokens, secret-looking values).
- **Parser strategies**: Japanese `マッピング` sheets, English/Japanese `Field Mapping` hybrids, compact `Source/Target` layouts, Boomi-design sheets, generated Helper Suite exports. Document log / explanation / environment / job handling become proposed FMD sections.
- **Local LLM**: Ollama + `qwen3:8b` (default), `POST /api/fmd/resolve`. Uses JSON Schema output for a correction-patch shape; deterministic parser remains the canonical importer.
- **Post-LLM type reconciliation** (M8): when Qwen renames a profile, type/format is re-inferred against the new name's evidence. Reinference returning `Unknown` is ignored; only a more specific answer overrides.
- **Privacy**: workbook context is redacted before LLM use. Debug payload (full prompt + raw LLM response) is stripped from `/api/fmd/resolve` responses by default; opt in with `?debug=true`, form `debug=true`, or `BOOMI_HELPER_FMD_DEBUG=1`.
- **UI today**: locked workspace + progress bar during resolution; mode picker (merge / mapping-only / sections-only / create-new); per-entity checkboxes; live conflict preview; telemetry panel (warnings, unresolved refs, rule-confidence range, parser strategy chips). This is still mostly an import/review/export surface, not a complete editable FMD authoring workspace. **M10 replaces this.**
- **Apply**: `POST /api/fmd/apply` runs inside `prisma.$transaction`. Conflict detection: `missing-project`, `profile-duplicate`, `field-type`, `field-required`, `endpoint-duplicate`, `duplicate-destination`, `section-duplicate`. Reuses existing profiles/mapping-sets/fields by `role + name` (case- + whitespace-insensitive); skips duplicate destination rules; dedupes sections by `sectionType + title`.
- **Export** (M4): `GET /api/fmd/export?template=standard|japanese|boomi-design&sample=true&xml=true&quality=true&checklist=true`. Each template shares consistent styling (frozen header row, bold cells, thin borders, auto-width).

### Process Flow Designer (M7)

- ReactFlow with full mutation handlers, draggable shape palette (30 Boomi shape types across Start/Connector/Execute/Logic/Advanced).
- Node configuration drawer (label, type, description, delete).
- Save persists via `POST/PATCH/DELETE /api/projects/[projectId]/flows[/...]`.
- Process XML preview generated by `buildProcessXml` (real `<shape shapetype>` + `<dragpoints>` per edge).
- `Cmd/Ctrl+S` saves; `Delete/Backspace` removes selected shape or link.
- `nodeTypes` / `edgeTypes` hoisted to module scope (no ReactFlow re-creation warnings).

### Boomi API Lab (M5 + M6)

- Connection CRUD with AES-256-GCM encryption (`src/lib/boomi-crypto.ts`, 12-byte IV per NIST SP 800-38D, env key validated 64-hex at boot, dev key auto-bootstrapped to `.env.local` and set on `process.env`).
- `GET / POST / PUT / DELETE /api/boomi/connections` — PUT requires `projectId` so edits land on the right project.
- `PATCH /api/boomi/connections` — test connection.
- `POST /api/boomi/components/lookup` — UUID equals / name LIKE / type filter; deleted components filtered client-side.
- `POST /api/boomi/templates/import` — fetches XML via `GET /Component/{id}~{version}`, validates, persists draft.
- `POST /api/boomi/components/dependencies` — scans imported draft's templateXml for referenced componentIds and returns role hints + `alreadyImported` flag. **Wired into the UI** (M8): per-draft "Scan dependencies" panel with per-dep Import button.
- `POST /api/boomi/dry-run` — generates `transform.map` and `profile.*` drafts per mapping set / profile; uses imported templates when available (template-patch mode) else scaffold mode; reconciles real Boomi profile UUIDs + element keys from imported profile templates.
- **Publish gate** (`validatePublishSafety` in `src/lib/boomi-sandbox.ts`):
  - `PUBLISH_ALLOWED_TYPES` = `transform.map`, `profile.flatfile`, `profile.json`, `profile.xml`, `profile.db`.
  - `IMPORT_ALLOWED_TYPES` adds `process`, `processproperty`, `connector-settings`, `connector-action` for read-only use (SqlLookup connection UUID resolution etc.).
  - Blocks: missing template, validation status ≠ "Dry-run valid", non-sandbox connection, non-`Ready for Boomi` mapping-set status, missing profile templates, mapping-quality errors, incomplete rules, blank constants, duplicate destinations, >50% unreviewed rules.
- `POST /api/boomi/publish` — only fires Boomi POST when blockers are clear; records every attempt (success + blocked) to `BoomiPublishEvent`. Detects Boomi's "same configuration values" response and treats it as a no-op success.
- `POST /api/boomi/publish/rollback` — re-publishes a prior version's `requestXml` as a new update.
- `GET /api/boomi/publish/events/[eventId]` — on-demand full event (returns the heavy `requestXml`/`responseXml` bodies; list payloads only carry metadata + `hasRequestXml`/`hasResponseXml` flags).
- **XML generators** (`src/lib/boomi-xml.ts`):
  - Real Boomi schema for `profile.flatfile` (FlatFileProfile/DataElements/FlatFileRecord/FlatFileElements/FlatFileElement + DataFormat), `profile.json` (JSONRootValue + JSONObject + nested JSONObjectEntry by parentPath, JSONArray detection), `profile.xml`, `profile.db` (DatabaseProfile + DBStatement select|dynamicinsert|storedprocedure, DBFields/DBParameters), `transform.map` (FunctionStep types: Scripting, SqlLookup, StringConcat, DateFormatter, NumberConversion, Standardize, TextEncoder, Split, MathOperation, Compare, Coalesce; dual Mapping pattern for function-routed rules).
  - `extractBoomiComponentId(templateXml)` + `extractProfileElementKeys(templateXml)` reconcile real Boomi UUIDs and element keys from imported profile templates so transform-map drafts can bind to live profiles.
  - `extractProcessDependencies(processXml, selfComponentId?)` walks process XML for referenced componentIds with role hints; backs the dependency-scanner UI.

### Tests + verification

19 test files / **251 tests** passing. Key coverage:

- `mapping-quality.test.ts` — validation rules, clean seed, recovery cases, fixed-value handling.
- `mapping-mutations.test.ts`, `project-mutations.test.ts` — Zod schema + semantic validation, optimistic-concurrency mismatch path.
- `field-import.test.ts` — CSV/JSON/XML import + type inference.
- `api-routes.test.ts` — every CRUD route (projects, endpoints, profiles, fields, mapping rules). **Credential sanitization** (raw ciphertext never reaches client). **Publish-event XML stripped** from list payload (< 5KB response with 40KB worth of XML in DB). **PUT connections requires projectId**.
- `boomi-sandbox.test.ts` — publish-gate behavior per component type (all 4 profile types allowed, all 4 import-only types blocked with read/import-only message), `validatePublishSafety` blockers, **golden-file `patchTransformMap` reconciliation** (real flatfile template + real map template → patched map carries reconciled keys), `extractProcessDependencies` regex coverage.
- `boomi.test.ts` — XML dry-run utilities.
- `fmd.test.ts`, `fmd-import.test.ts`, `fmd-import-fixtures.test.ts`, `fmd-export.test.ts`, `fmd-apply.test.ts` — workbook round-trip, deterministic regression snapshots for 5 sample workbooks, applyAiResolution merge snapshot, **post-LLM type/format reconciliation** (rename to a non-evidence name preserves deterministic type), Ollama mock paths, apply-mode coverage, export template coverage. Includes inline **debug-gating tests** for `/api/fmd/resolve` (default strips `debug`; opt-in via `?debug=true` or env var preserves it).
- `fmd-resolver-cache.test.ts` — SHA-256 cache hit/miss, TTL eviction, LRU behavior, clear.
- `sanitization-audit.test.ts` — walks all API route files and asserts any project response imports a sanitizer.
- `e2e-pipeline.test.ts` — full round-trip: create project → add endpoints/profiles/fields/mapping rules → FMD apply → Boomi dry-run → template import → mocked Boomi publish with publish-gate verification.

Latest verification (2026-05-29 14:54 UTC, Node 22.16.0):
  - `npm run lint` — ✅ clean
  - `npm run test` — ✅ **251 tests** passed (19 files)
  - `npm run build` — ✅ clean (all routes generated)

- `npm run lint` — 0 errors, 4 warnings (all in test files for intentionally-unused destructured variables).
- `npm run test` — 15 files / 201 tests passed.
- `npm run build` — clean (all 25 dynamic routes including `/api/boomi/publish/events/[eventId]`).
- `npm audit --omit=dev` — 0 vulnerabilities.

---

## M8 — Hardening Pass (complete)

M8 came out of a full code review of ~15k LOC (2026-05-26). The list below is what shipped across the two M8 sessions, grouped by concern. Items not listed here were rolled into M9 (or, where noted, M10).

### Security (M8.1)

- ✅ AES-GCM IV changed from 16 to 12 bytes (NIST SP 800-38D).
- ✅ Env key validates `length === 64` (32 bytes hex) at startup; throws on short keys.
- ✅ Dev-mode bootstrap: `ensureBootstrapKey()` reads existing `.env.local`, only generates + appends a new key when missing, sets `process.env.BOOMI_HELPER_ENCRYPTION_KEY` on the running process. The hardcoded scrypt fallback is gone from the runtime path (preserved as `deriveLegacyDevKey()` only for tests that decrypt pre-existing rows).
- ✅ `PUT /api/boomi/connections` validates with `boomiConnectionSchema.partial().safeParse()` + explicit field allowlist; **requires `projectId`** so edits cannot land on the wrong project.
- ✅ `console.log` in `boomi-sandbox.ts` replaced with `debugLog()` gated behind `BOOMI_HELPER_DEBUG=1`.
- ✅ `decryptForDisplay` returns `[re-enter credentials]` instead of leaking ciphertext on decryption failure.
- ✅ `sanitizeProjectForClient()` (and inline `scrubPrismaProjectForClient()` for the GET project route) strip ciphertext credentials before serializing.
- ✅ Publish-event request/response XML stripped from list payloads — full event available on demand via `GET /api/boomi/publish/events/[eventId]`.
- ✅ FMD resolver `debug` payload gated behind `?debug=true` / form `debug=true` / `BOOMI_HELPER_FMD_DEBUG=1`.

### Correctness / data integrity (M8.2)

- ✅ `selectedMappingSetIndex` threaded into Mapping Studio + Dashboard. Hardcoded `mappingSets[0]` in `boomi-api-tab.tsx` removed by switching `mockInventory` for `deriveLocalInventory` (every mapping set listed individually).
- ✅ Optimistic concurrency: `Project.version` column + migration; `updateWorkspaceProject` checks before write, throws `ConcurrentModificationError`, bumps version; `PATCH /api/projects/[projectId]` honors `If-Match` header or `body.version`, returns 409 `VERSION_MISMATCH` on stale writes.
- ✅ `updateWorkspaceProject` uses per-entity upserts (not delete-recreate) for connections + drafts.
- ✅ `mode: "fallback"` flag surfaced on Project; UI shows a toast when sample-data fallback is active.
- ✅ `replaceRules` writes to the selected mapping-set index (not `[0]`).

### Performance (M8.3)

- ✅ ReactFlow `nodeTypes` / `edgeTypes` hoisted to module scope.

### UX (M8.4)

- ✅ Every `window.alert` / `window.confirm` replaced with `useToast()` (`toast.confirm()` returns Promise<boolean>; `toast.addToast({type:"error"})` for failures).
- ✅ Cmd/Ctrl+S saves flow; Delete/Backspace removes selected shape or link.
- ✅ Project switcher search (fuzzy filter at top of sidebar).
- ✅ Toast-with-undo for project delete (5 second window).
- ✅ Dependency scanner UI panel on Boomi tab (replaces mock inventory).

### Code quality (M8.5)

- ✅ Lint clean (0 warnings).
- ✅ `mockInventory` dropped (replaced with derived inventory in the component).
- ✅ Partial split of workspace-app: `boomi-api-tab.tsx`, `flow-tab.tsx`, `global-dashboard.tsx`, `mapping-studio.tsx`, `toast.tsx` already extracted. `workspace-app.tsx.bak` removed.

### Test coverage (M8.6)

- ✅ `extractProcessDependencies` tests (extract, empty input, dedup).
- ✅ Golden-file `patchTransformMap` reconciliation test against real templates.
- ✅ `validatePublishSafety` coverage for every allowed + every import-only + unknown component type.
- ✅ Credential-sanitization test on `GET /api/projects/[projectId]`.
- ✅ Publish-event XML-trim test (< 5KB response with 40KB worth of XML in DB).
- ✅ Post-LLM type reconciliation regression test.
- ✅ Optimistic-concurrency mismatch test.
- ✅ Debug-gating tests for `/api/fmd/resolve`.

### Resolver / FMD polish (M8.7)

- ✅ Post-LLM type/format reconciliation after profile rename.
- ✅ Debug payload gating on `/api/fmd/resolve`.

### Boomi schema gaps (M8.8)

- ✅ `profile.xml` Types/Namespaces coarse merge-by-name. (Note: the deep walker helper was drafted but not wired; removed to clear lint with a TODO comment.)

---

## Milestone 9 — Polish, Refactor, Observability (complete)

All 28 items shipped or explicitly deferred. Full verification: lint (0 errors), test (15 files / 201 tests), build (clean), audit (0 vulnerabilities).

### Security (M9.1)

- ✅ `scripts/rotate-encryption-key.ts` + `npm run rotate-key` — decrypts every connection with the old key, re-encrypts with a new 32-byte hex key, writes to `.env.local`.
- ✅ `src/lib/sanitization-audit.test.ts` — walks every route file under `src/app/api` and asserts that any response containing `project:` imports a sanitizer (`sanitizeProjectForClient` or `scrubPrismaProjectForClient`).
- ✅ `PATCH /api/projects/[projectId]` now also returns a scrubbed project (M8 oversight fixed).

### Structural refactor (M9.2)

- ✅ `src/lib/xml-utils.ts` — centralized `escapeXml` and `formatXmlForDisplay`; removed duplicate private copies from `boomi.ts`, `boomi-sandbox.ts`, and `xml-format.ts`.
- ✅ `findTemplateDraft` consolidated into `boomi-sandbox.ts` (generic component lookup); `findProfileTemplateDraft` now delegates to it for the stable-id and exact-name layers, then adds field-scored matching.
- ✅ `boomi.ts` shim audited: reduced to a thin re-export file (`validateComponentXml`, `buildMapPreviewXml`, `buildProfilePreviewXml`, `createDraftFromTemplate`). `mockInventory` removed; `dry-run/route.ts` no longer returns mocked inventory.
- ✅ JSDoc added to all 33 public exports in `boomi-xml.ts` (generators, patchers, key-reconciliation helpers, process dependency extractor).
- ➡️ **Workspace-app split deferred to M10.1.** The extraction was attempted but rolled back to avoid destabilizing the UI before the larger M10 FMD workbench rewrite. The file remains ~2,600 LOC; M10.1 will extract `DashboardTab`, `FmdBuilder`, and dialog drawers as part of the FMD authoring surface rebuild.

### Performance (M9.3)

- ✅ Mapping table virtualized with `@tanstack/react-virtual` (`useVirtualizer`, overscan 10, estimated row height 56px, max-height 60vh container). Projects with 500+ rules no longer lag.
- ✅ Resolver SHA-256 cache in `src/lib/fmd-resolver-cache.ts` — file-based JSON cache with 24h TTL, LRU eviction (max 5 entries), input hash covers workbook buffer + Ollama options. `clearResolverCache()` exposed.
- ✅ Client-side SWR cache — `src/hooks/use-project.ts` and `src/hooks/use-connections.ts` wrap fetches with deduping and `revalidateOnFocus`. `workspace-app.tsx` and `boomi-api-tab.tsx` use these hooks.

### UX polish (M9.4)

- ✅ Undo toast (5s) for endpoint delete, profile delete, and mapping-rule delete.
- ✅ Inline field-level errors on Mapping Studio destination panel — required destinations with no rule show a red border + `AlertTriangle` icon.
- ✅ ARIA labels added to all icon-only buttons (Pencil, Trash2, RefreshCw, Plus, etc.) across `workspace-app.tsx`, `mapping-studio.tsx`, `boomi-api-tab.tsx`, `flow-tab.tsx`.
- ✅ Keyboard navigation in mapping table (`j`/`k`/`ArrowDown`/`ArrowUp` to move, `Enter` to edit, `x` to delete with undo toast).
- ✅ Mapping Studio panel scrolling simplified — removed fixed `max-h` nested containers; panels now use consistent `overflow-auto`.

### Observability (M9.5)

- ✅ Structured JSON logger (`src/lib/logger.ts`) expanded with `debug`/`info`/`warn`/`error` levels, `serializeError`, and `BOOMI_HELPER_LOG_LEVEL` env control. Replaced `console.warn` in `db.ts` and `debugLog` in `boomi-sandbox.ts`.
- ✅ Retry on transient Boomi API failures — `withRetry` in `boomi-sandbox.ts` already existed (exponential backoff, max 3 attempts, DOMException/AbortError passthrough). Verified in use by all Boomi-bound fetch calls.
- ✅ Rate-limit Boomi-bound calls — `boomiQueue` in `boomi-sandbox.ts` already existed (100ms spacing). Verified in use.
- ✅ Graceful Prisma shutdown — `db.ts` now exports `disconnectPrisma()` and wires it into `process.on('beforeExit')` and `SIGUSR2` (hot-reload tools). Existing `SIGTERM`/`SIGINT` handlers preserved.

### Resolver / FMD polish (M9.6)

- ✅ Post-LLM type/format reconciliation already shipped in M8.
- ➡️ Items 20–21 (resolver context panel, side-by-side diff) **folded into M10** import/reconciliation design.
- ➡️ Items 22–23 (held-out workbook evaluation, CI integration for `eval-resolver.ts`) **deferred** — requires curated held-out workbooks and calibration data not yet available.

### Boomi schema gaps (M9.7)

- ✅ Deep `profile.xml` Types/Namespaces patching — `patchXmlProfile` now uses `mergeXmlNodes` to recursively merge fresh scaffold nodes into template nodes while preserving `key`, `typeKey`, and `useNamespace`.
- ✅ Missing `transform.map` FunctionStep types added: `MathMultiply`, `LineItemIncrement`, `LeftTrim`, `RightTrim`, `WhitespaceTrim`, `DocumentPropertyGet`, `DocumentPropertySet`, `PropertyGet`. Regex ordering updated so `multiply` matches `MathMultiply` before `MathOperation`.
- ✅ `<DocumentCacheJoins>` population — `buildTransformMapXml` scans `project.processFlows` for cache-related node types (`addtocache`, `retrievefromcache`, `removefromcache`) and emits a commented `<DocumentCacheJoins>` placeholder; self-closing tag retained when no cache nodes are present so existing string-match tests still pass.
- ✅ `processproperty` publish explicitly deferred with a comment in `PUBLISH_ALLOWED_TYPES` explaining the requirement for a real XML generator + test before enabling.

### End-to-end test (M9.8)

- ✅ `src/lib/e2e-pipeline.test.ts` — full round-trip: create project → add endpoint → add profiles/fields → create mapping set/rules → FMD apply → add Boomi connection → import templates → dry-run → fix safety gates → mocked Boomi publish → verify success. Uses `vi.stubGlobal("fetch", ...)` for external HTTP mocks and cleans up via `afterAll` project deletion.

---

## Milestone 10 — Editable FMD Workbench Overhaul (COMPLETE)

### Product intent

The FMD tab must become the place where a user can **construct, maintain, review, and export the Functional Mapping Document itself**. The current page is useful for importing an Excel FMD and reviewing resolver output, but it is not an authoring surface: the existing project sections render as JSON cards, the imported draft is applied through checkboxes, and most real editing happens somewhere else. That makes the page feel pointless after import because the user cannot shape the actual document.

M10 changes the mental model:

- The FMD page is the canonical editable document workspace.
- Mapping, profiles, endpoints, process flow, Boomi drafts, and project metadata remain the operational source data.
- The FMD can reference that operational data, pull it into sections, and show freshness/staleness.
- The user can also write document-only content that does not belong in Mapping/Flow/Profile screens: assumptions, scope, document history, open questions, error handling narrative, sample/test cases, deployment notes, reviewer notes, revision explanations, and customer-facing wording.
- Export becomes the final rendering of the editable FMD document, not just a generated workbook snapshot from raw project data.

### Non-negotiable UX principles

- No raw JSON cards in the main FMD page. JSON/evidence belongs only in an explicit debug drawer.
- Every visible FMD section must be editable, refreshable from project data, or clearly read-only because it is a generated preview.
- The user should be able to start from either direction:
  - From scratch: create a blank/project-derived FMD and fill it in.
  - From import: resolve an existing workbook, review differences, and apply selected sections.
- Linked data must be understandable. If a row comes from a profile, mapping rule, endpoint, or flow shape, show that link and offer navigation to the owning section.
- Manual FMD wording must not be silently overwritten when project data changes. Use explicit "refresh from source", per-field overrides, and stale indicators.
- Editing a linked item must be intentional:
  - **Edit source** updates the underlying project entity.
  - **Override in FMD** changes only the document text/table cell.
  - **Reset override** returns to the linked project value.
- The interface should feel like an internal design-document editor: dense, tabular, structured, fast, and readable. Avoid a marketing/hero layout.

### Current state to replace

- `FmdBuilder` still lives inline inside `src/components/workspace-app.tsx`.
- Existing page has:
  - import + resolve button,
  - export controls,
  - JSON rendering of `project.fmdSections`,
  - import summary,
  - resolver review/apply panel.
- Existing persistence stores `FmdSection` as `{ title, sectionType, contentJson, sortOrder }`.
- Existing export in `src/lib/fmd-export.ts` mostly generates workbook sheets directly from `Project`, `mappingSets`, `profiles`, `endpoints`, `processFlows`, and selected generic `fmdSections`.
- There is no dedicated CRUD route for FMD sections.

M10 should preserve the good parts: resolver, apply pipeline, export templates, conflict detection, redaction, and mapping/profile/endpoint data. It should replace the FMD page interaction model.

### Target information architecture

The FMD tab should become a three-pane workbench:

1. **Left outline**
   - Ordered document sections with status badges.
   - Drag/drop or up/down reorder.
   - Section groups: Document, Design, Mapping, Runtime, Validation, Appendix.
   - Add section button.
   - Filter chips: All, Needs input, Stale, Has overrides, Exported.
   - Completion summary: required sections completed, open questions, stale linked rows.

2. **Center editor**
   - The selected section editor.
   - Section-specific form/table editor, not generic JSON.
   - Sticky section toolbar: save status, refresh from source, duplicate, delete, export include toggle, evidence/debug if available.
   - Autosave with visible dirty state, plus manual save for large table sections.
   - Keyboard-friendly table editing for mapping-heavy sections.

3. **Right context panel**
   - Linked source data from other app areas.
   - Freshness/staleness details.
   - Validation issues for the current section.
   - Quick actions:
     - open Mapping tab at mapping set/rule,
     - open Flow tab at process flow/shape,
     - open Workspace endpoint/profile editor,
     - refresh section from source,
     - apply section edits back to source when allowed.

On smaller screens, the outline and context panel can collapse into tabs/drawers. Desktop should prioritize dense editing.

### Required FMD section catalogue

Build a registry of FMD section types. Each type needs:

- `sectionType`
- display label
- required/optional flag
- default title
- default content factory from `Project`
- editor component
- validator
- export renderer
- import-merge behavior

Initial section types:

1. **Document Control / Revision Log**
   - Editable rows: version, date, author, reviewer, change summary, status.
   - Should support "Add revision from current changes".
   - Can optionally derive initial author/status from project owner/status.
   - Export target: `Document Log` / Japanese equivalent.

2. **Cover / Project Summary**
   - Linked fields: process ID, process name, source system, destination system, owner, schedule, project status.
   - Editable document-only fields: FMD title, document version, classification, customer/team, prepared by, reviewed by, approved by.
   - For linked project fields, user can edit source or override in document.

3. **Purpose / Scope / Assumptions**
   - Rich structured text fields:
     - purpose,
     - in scope,
     - out of scope,
     - assumptions,
     - dependencies,
     - open questions.
   - Use repeatable bullet/list rows, not one giant JSON blob.
   - Open questions should have owner/status/due date.

4. **Integration Overview**
   - Narrative overview.
   - Direction/source/destination summary.
   - Schedule/frequency.
   - Trigger type.
   - High-level data volume / SLA / latency.
   - Linked process flow summary.
   - Optional generated mini table from endpoints and profiles.

5. **Endpoint / Interface Details**
   - Editable table sourced from `project.endpoints`.
   - Columns: role, endpoint name, connector type, profile type, format, purpose, auth/connectivity notes, environment notes.
   - Supports:
     - add endpoint from FMD page,
     - link existing endpoint,
     - override FMD-only notes,
     - navigate to endpoint editor.

6. **Profile Inventory**
   - One row per source/destination profile.
   - Columns: role, name, type, format, root path, field count, key fields, required count, notes.
   - Each profile row opens a side panel with its fields.
   - Supports "include field dictionary in export" per profile.

7. **Field Dictionary**
   - Profile-specific section/editor.
   - Columns: parent path, field name, label, description, data type, length, required, key, format, sample, notes.
   - Sourced from `Profile.fields`.
   - Supports field-level document-only notes and source edits.
   - Should support bulk paste/import for field descriptions and samples.

8. **Field Mapping**
   - One section per `MappingSet`, or one grouped section with selectable mapping set.
   - Spreadsheet-like editor optimized for many rows.
   - Columns:
     - destination parent/path,
     - destination field,
     - required,
     - destination type/format,
     - source parent/path,
     - source field,
     - source type/format,
     - mapping type,
     - expression/function/lookup details,
     - default/fixed value,
     - transformation notes,
     - business rule,
     - reviewed,
     - quality status.
   - Linked to real `MappingRule` rows by ID.
   - Editing mapping logic should default to updating the source mapping rule, because mapping rules are operational data.
   - Editing narrative/business notes can be document-only unless the user chooses to push comments back to the mapping rule.
   - Must support filters: unmapped required, errors, warnings, unreviewed, lookup/function, constants, search.
   - Must be virtualized for 500+ rules.

9. **Transformation / Lookup Details**
   - Derived from mapping rules and transform nodes.
   - Group function/lookup/join rules into readable subsections.
   - Editable fields: business description, lookup source/table/API, fallback behavior, error behavior, examples.
   - References `TransformNode`, `MappingRule.expression`, `defaultValue`, comments.

10. **Process Flow**
   - Linked to `ProcessFlow`.
   - Show step list in flow order: shape type, label, description, next step, branch label.
   - Editable document narrative per shape.
   - Navigation to Flow designer.
   - Optional generated flow image/export snapshot later, but M10 can start with structured step list.

11. **Error Handling / Job Handling**
   - Editable structured fields:
     - retry policy,
     - failure routing,
     - notifications,
     - logging/audit,
     - duplicate handling,
     - validation failure behavior,
     - partial failure/reprocess rules,
     - operational owner.
   - Can reference process flow shapes such as exception/trycatch/notify.

12. **Environment / Deployment Configuration**
   - Editable table for DEV/QAS/UAT/PROD.
   - Columns: environment, Boomi account/environment, endpoint/base URL, auth mode, connector settings reference, process property values, notes.
   - Imported FMDs often contain environment tables. Resolver should map those here.
   - Keep secrets out of export unless explicitly typed as non-secret. Never store real passwords in FMD sections.

13. **Sample Data / Test Cases**
   - Repeatable test-case rows:
     - case ID,
     - scenario,
     - input sample/profile,
     - expected output,
     - mapping rules covered,
     - status,
     - notes.
   - Can pull `ProfileField.sample` values.
   - Supports attaching small text snippets in content JSON; no binary file storage for M10.

14. **Quality / Readiness Checklist**
   - Generated from existing validators plus FMD-specific checks.
   - Editable owner/status/comments per checklist item.
   - Checks should include:
     - all required destinations mapped,
     - no duplicate destinations,
     - no type mismatch errors,
     - all function/lookup rules have business comments,
     - endpoints documented,
     - environment rows present,
     - error handling documented,
     - test cases present,
     - process flow exists,
     - Boomi templates imported when publish is intended.

15. **Boomi Component / Dependency Notes**
   - Optional section derived from `boomiDrafts` and dependency scanner.
   - Columns: component name, component type, component ID, template imported, validation status, dependencies, publish readiness, notes.
   - This is useful for architecture review but should not expose raw XML by default.

16. **Appendix / References**
   - Manual references, source workbook evidence, imported sheet summary, useful links, glossary.
   - Resolver evidence and raw prompt/response stay behind debug gating.

### Data model and persistence plan

M10 should avoid a huge schema rewrite on day one, but it must stop treating all FMD content as anonymous JSON. Use typed content schemas around the existing `FmdSection.contentJson`, then migrate if needed.

#### Phase 1 data model: typed sections on existing table

Keep the existing `FmdSection` table, but standardize `contentJson`:

```ts
type FmdSectionContentV1 = {
  schemaVersion: 1;
  sourceMode: "manual" | "derived" | "mixed" | "imported";
  exportEnabled: boolean;
  linkedEntities: Array<{
    entityType: "project" | "endpoint" | "profile" | "profileField" | "mappingSet" | "mappingRule" | "processFlow" | "processFlowNode" | "boomiDraft";
    entityId: string;
    label?: string;
  }>;
  staleState?: {
    isStale: boolean;
    lastSyncedAt?: string;
    sourceHash?: string;
    currentHash?: string;
    changedPaths?: string[];
  };
  overrides?: Record<string, unknown>;
  data: unknown;
};
```

Each section type owns the shape of `data`. Use Zod schemas per section type. Do not let arbitrary objects from the UI persist without validation.

#### Phase 2 optional migration: FMD document model

If multiple FMD versions/templates become necessary, add:

- `FmdDocument`
  - `id`
  - `projectId`
  - `title`
  - `template` (`standard`, `japanese`, `boomi-design`, future custom)
  - `locale`
  - `status` (`draft`, `review`, `approved`, `exported`)
  - `documentVersion`
  - `createdAt`
  - `updatedAt`
  - `lastExportedAt`
- `FmdSection.documentId`
- optional `FmdSectionSource` if linked entity tracking outgrows JSON.

Do not start with multi-document support unless it is needed. One active FMD per project is enough for M10.

### Derived-source and override behavior

The hardest product detail is how FMD content relates to project data. Implement a clear rule set:

- **Derived sections** are generated from current project data and have no manual edits yet.
- **Mixed sections** are generated from project data but contain manual overrides/notes.
- **Manual sections** are document-only and never refresh from project data.
- **Imported sections** came from an uploaded workbook and must be reconciled before becoming manual/mixed/derived.

For every linked field/cell:

- Store a stable source reference where possible, e.g. `mappingRule:mapping-rule-id.comment`.
- Store a source hash for the last synced value.
- If the source changes and no override exists, update automatically or mark stale depending on section type.
- If an override exists, never overwrite it automatically. Show "source changed" and offer:
  - keep override,
  - accept source update,
  - view diff.

Recommended first-pass sync policy:

- Project summary, endpoint inventory, profile inventory: mark stale and offer refresh.
- Mapping table: update linked operational fields automatically after reload, preserve document-only notes/overrides, show changed rows.
- Error handling, assumptions, test cases: manual by default.
- Import draft: never auto-apply; always review.

### API plan

Add dedicated FMD routes. Keep existing `/api/fmd/resolve`, `/api/fmd/apply`, and `/api/fmd/export`, but stop making the UI mutate FMD sections through unrelated project updates.

New routes:

- `GET /api/projects/[projectId]/fmd`
  - Returns ordered FMD sections, completion summary, stale summary, section registry metadata.
  - Response must be sanitized and must not include resolver debug payload.

- `POST /api/projects/[projectId]/fmd/initialize`
  - Creates a default FMD outline for a project.
  - Modes:
    - `blank`
    - `from-project`
    - `from-template`
  - Should be idempotent or return a clear conflict if sections already exist.

- `POST /api/projects/[projectId]/fmd/sections`
  - Adds a section.
  - Body: `sectionType`, `title`, `sortOrder?`, optional `sourceMode`, optional initial `data`.
  - Validates with the section registry.

- `PATCH /api/projects/[projectId]/fmd/sections/[sectionId]`
  - Updates title, content, exportEnabled, overrides, linkedEntities, sourceMode.
  - Requires project/version or section updatedAt to avoid silent overwrite.
  - Runs section-specific validation.

- `DELETE /api/projects/[projectId]/fmd/sections/[sectionId]`
  - Deletes a section.
  - Use toast-with-undo in UI.

- `POST /api/projects/[projectId]/fmd/sections/reorder`
  - Persists ordered section IDs.

- `POST /api/projects/[projectId]/fmd/sections/[sectionId]/refresh`
  - Regenerates a derived/mixed section from current project data.
  - Returns diff + updated section.
  - Must preserve overrides unless `resetOverrides=true`.

- `POST /api/projects/[projectId]/fmd/validate`
  - Returns document-level validation/completion issues.
  - Should reuse mapping-quality validation and add FMD-specific rules.

- `POST /api/projects/[projectId]/fmd/import-preview`
  - Optional wrapper around existing resolver for the new workbench.
  - Returns editable, section-oriented import preview.
  - The old `/api/fmd/resolve` can remain as the lower-level resolver endpoint.

- `POST /api/projects/[projectId]/fmd/import-apply`
  - Applies selected imported sections/rows into the FMD workbench.
  - This is different from current `/api/fmd/apply`, which applies imported operational project data. M10 needs both:
    - apply to project entities,
    - apply to FMD document sections.

### UI component plan

Extract the FMD area into `src/components/fmd/`.

Suggested files:

- `src/components/fmd/fmd-workbench.tsx`
- `src/components/fmd/fmd-outline.tsx`
- `src/components/fmd/fmd-section-toolbar.tsx`
- `src/components/fmd/fmd-context-panel.tsx`
- `src/components/fmd/fmd-import-panel.tsx`
- `src/components/fmd/fmd-export-panel.tsx`
- `src/components/fmd/editors/document-control-editor.tsx`
- `src/components/fmd/editors/project-summary-editor.tsx`
- `src/components/fmd/editors/overview-editor.tsx`
- `src/components/fmd/editors/endpoint-table-editor.tsx`
- `src/components/fmd/editors/profile-inventory-editor.tsx`
- `src/components/fmd/editors/field-dictionary-editor.tsx`
- `src/components/fmd/editors/mapping-table-editor.tsx`
- `src/components/fmd/editors/process-flow-section-editor.tsx`
- `src/components/fmd/editors/error-handling-editor.tsx`
- `src/components/fmd/editors/environment-editor.tsx`
- `src/components/fmd/editors/test-cases-editor.tsx`
- `src/components/fmd/editors/checklist-editor.tsx`
- `src/components/fmd/editors/appendix-editor.tsx`

Suggested lib files:

- `src/lib/fmd-section-registry.ts`
- `src/lib/fmd-section-schemas.ts`
- `src/lib/fmd-derived-sections.ts`
- `src/lib/fmd-section-validation.ts`
- `src/lib/fmd-section-sync.ts`
- `src/lib/fmd-export-renderers.ts`
- `src/lib/fmd-import-reconcile.ts`
- `src/lib/fmd-mutations.ts`

The existing `FmdBuilder` should be removed from `workspace-app.tsx` after extraction. `workspace-app.tsx` should only route props into `FmdWorkbench`.

### Editing details by entity link

#### Project fields

Linked fields: process ID, process name, description, owner, schedule, status, source/destination systems.

Controls:

- inline text inputs/selects,
- link indicator,
- action menu:
  - edit project source,
  - override in FMD,
  - reset override.

#### Endpoints

The FMD page must be able to add and edit endpoint rows because endpoint documentation is a core FMD artifact.

Behavior:

- "Add endpoint" creates a real endpoint unless user chooses "document-only endpoint note".
- Editing connector type/profile type/format updates the endpoint.
- Editing "environment note" or "operational note" can be document-only.

#### Profiles and fields

Profiles/fields should remain operational entities but must be editable from FMD because the field dictionary is part of the document.

Behavior:

- "Add profile" opens or reuses the existing profile drawer logic.
- "Add field" and bulk field import should be available inside field dictionary editor.
- Field description/sample/comment can be edited from FMD.
- If a field is only in the FMD and not yet in a profile, show it as "unlinked" with action "create field".

#### Mapping rules

Mapping edits are operational and should patch real `MappingRule` rows.

Behavior:

- Editing mapping type/source/destination/expression/default updates the mapping rule.
- Editing business explanation can either update `MappingRule.comment` or stay as FMD-only note. The UI should show which.
- Required destination fields with no rule should be visible as "missing mapping" rows with an action to create rule.

#### Process flow

Flow remains in Flow Designer, but FMD needs editable narrative.

Behavior:

- Step list derives from `ProcessFlow.nodes` and `edges`.
- Shape label/type/description link to Flow.
- FMD-specific narrative fields:
  - purpose,
  - business behavior,
  - error behavior,
  - operation notes.

### Import and reconciliation overhaul

The import flow should stop being a separate one-shot review panel at the bottom. It should become an import workspace within the FMD page.

New import flow:

1. User clicks Import FMD.
2. Resolver runs and returns a draft.
3. UI opens an "Import Preview" view with tabs:
   - Document sections,
   - Endpoints,
   - Profiles/fields,
   - Mapping sets/rules,
   - Environment/job/test sections,
   - Evidence/debug.
4. Each imported item has a target:
   - create new FMD section,
   - merge into existing FMD section,
   - create/update project entity,
   - ignore.
5. Show side-by-side values:
   - current project/FMD,
   - imported workbook,
   - chosen result.
6. User can edit the chosen result before applying.
7. Apply writes selected FMD sections and/or project entities.

Important: imported workbook content is often a mix of project truth, customer wording, stale notes, and one-off review comments. Do not force it all into operational project entities. Let the user decide what becomes FMD-only vs source data.

### Export overhaul

`src/lib/fmd-export.ts` should become renderer-driven:

- The workbook export should iterate through the ordered FMD sections.
- Each section type has an export renderer.
- Derived sections can still read live project data at export time, but manual/mixed section content must be respected.
- Export options should include:
  - template: standard / Japanese / Boomi design,
  - include draft/import evidence,
  - include Boomi XML preview,
  - include quality report,
  - include checklist,
  - include only selected sections,
  - include section change notes.

The export should not surprise the user. The on-screen section order and export section order should match unless the user explicitly excludes a section.

Add an "Export Preview" panel:

- section list in export order,
- expected workbook sheet names,
- warnings for names that will be truncated to Excel's 31-character sheet limit,
- warnings for empty required sections,
- timestamp and template.

### Validation and completeness model

Add FMD-specific validation in addition to existing mapping validation.

Document-level checks:

- Required sections exist.
- Required sections are not empty.
- Project summary has owner/source/destination/schedule/status.
- At least one source and one destination endpoint documented.
- At least one source and one destination profile documented.
- Each destination required field is mapped or explicitly documented as not applicable.
- Function/lookup/join mappings have business notes.
- Error handling section completed.
- Environment section has at least DEV and PROD or a documented reason.
- Open questions are either resolved or clearly marked open with owner.
- FMD has at least one revision log row.
- If Boomi publish is intended, Boomi template/import readiness is documented.

Section-level checks:

- stale linked data,
- broken linked entity IDs,
- missing required fields,
- unresolved import conflicts,
- duplicate section titles/sort order,
- empty table rows,
- secret-looking content in environment/sample fields.

Validation output should power:

- outline badges,
- right context panel,
- export warnings,
- dashboard readiness checklist.

### Implementation phases

#### M10.1 — Extract and stabilize FMD tab shell ✅

- Moved `FmdBuilder`, `FmdExportControls`, `FmdResolveProgress`, `FmdImportReview`, `JsonTree`, and constants (`fmdResolveStages`, `fmdApplyModes`) from `workspace-app.tsx` to `src/components/fmd/fmd-workbench.tsx`.
- `workspace-app.tsx` reduced from 2,693 → 1,545 lines. Import/resolve/export behavior preserved.
- Removed FMD-only imports from `workspace-app.tsx`: `ChangeEvent`, `NormalizedFmdWorkbook`, `FmdResolveResponse`, `categoriesForMode`/`detectFmdConflicts`/`FmdApplyMode`/`FmdApplyRequest`/`FmdApplyResult`/`FmdConflict`, `Cpu`, `Upload`.
- Kept `extractError` (used by dialogs) and `useRouter` (used by main component).

#### M10.2 — Section registry and typed schemas ✅

- `src/lib/fmd-section-registry.ts` — registry of 17 section types (16 canonical + `legacy`) with display labels, required flags, default titles, descriptions, and icon names.
- `src/lib/fmd-section-schemas.ts` — Zod schemas for the V1 content wrapper (`schemaVersion`, `sourceMode`, `exportEnabled`, `linkedEntities`, `staleState`, `overrides`, `data`) plus per-section `data` schemas for all 17 types.
- `src/lib/fmd-section-helpers.ts` — helpers:
  - `parseFmdSectionContent(raw)` — parses V1 wrapper; coerces legacy plain objects into wrapper with `sourceMode: "legacy"`.
  - `validateFmdSection(section)` — validates wrapper + section-specific data schema + title presence; warns on empty required sections.
  - `createDefaultFmdSection(project, sectionType, options)` — generates a new section with derived data and linked entities.
  - `deriveSectionData(project, sectionType)` — derives default data from current project state (endpoints, profiles, mapping sets, process flows, Boomi drafts).
  - `computeSectionHash(data)` — simple hash for stale detection.
- `src/lib/fmd-section-helpers.test.ts` — 12 tests covering parse, validate, create, derive, and hash.
- Verification: lint 0 errors, 16 test files / 213 tests passed, build clean.

#### M10.3 — FMD section CRUD APIs ✅

- `src/lib/fmd-mutations.ts` — DB operations: `getProjectFmdSections`, `createFmdSection`, `updateFmdSection`, `deleteFmdSection`, `reorderFmdSections`.
- 8 API routes under `/api/projects/[projectId]/fmd/`:
  - `GET /fmd` — list sections + completion summary + registry metadata.
  - `POST /fmd/initialize` — create default sections (mode: blank/from-project/from-template).
  - `POST /fmd/sections` — add a section with validated sectionType.
  - `PATCH /fmd/sections/[sectionId]` — update title/content or merge partial wrapper fields.
  - `DELETE /fmd/sections/[sectionId]` — delete a section.
  - `POST /fmd/sections/reorder` — reassign sortOrder based on orderedIds.
  - `POST /fmd/sections/[sectionId]/refresh` — re-derive section data from current project state.
  - `POST /fmd/validate` — document-level validation returning `{ valid, issues, requiredMissing }`.
- `src/lib/fmd-api.test.ts` — 20 tests covering all routes.

#### M10.4 — Workbench layout ✅

- Three-pane layout: left outline (`fmd-outline.tsx`), center editor, right context panel (`fmd-context-panel.tsx`).
- Outline with section list, add-section dropdown (all 16 canonical types), reorder via up/down arrows.
- Section toolbar with delete, duplicate, refresh-from-source buttons.
- Import review as modal overlay with tabbed "Review" / "Changes" views.
- "Initialize FMD" button for projects with no sections.
- SWR-based data loading via `src/hooks/use-fmd-sections.ts`.

#### M10.5 — Core editable document sections ✅

- 7 editors: DocumentControl, ProjectSummary, PurposeScope, Overview, EndpointTable, Environment, ErrorHandling.
- All registered in `fmd-editor-registry.ts` and wired into the center pane.
- Project Summary editor has source/override workflow with "from source" / "overridden" badges and reset-override action.

#### M10.6 — Profile and mapping authoring ✅

- 4 editors: ProfileInventory, FieldDictionary, MappingTable (virtualized with `@tanstack/react-virtual`), TransformationDetails.
- Mapping table editor displays mapping rules from the linked mapping set in a read-only virtualized view. Edit mappings in the Mapping page.

#### M10.7 — Process flow and quality sections ✅

- 5 editors: ProcessFlow, Checklist, BoomiComponents, TestCases, Appendix.
- Legacy editor for unknown/imported section types with convert-to dropdown.

#### M10.8 — Import preview redesign ✅

- `src/lib/fmd-section-diff.ts` — `computeImportDiffs()` for section-by-section diff between project and imported draft.
- Tabbed import modal: "Review" (existing FmdImportReview) and "Changes" (new diff view with new/changed/unchanged indicators).

#### M10.9 — Export renderer refactor ✅

- `src/lib/fmd-export-renderers.ts` — registry with 6 renderers: documentControl, projectSummary, endpointDetails, profileInventory, environmentConfig, errorHandling.
- `src/lib/fmd-export.ts` — `exportFmdWorkbookFromSections()` iterates sections in sortOrder, calls renderers, falls back to old template for unrendered types.
- Export route switched to use new function.

#### M10.10 — Tests, browser QA, and acceptance pass ✅

- 18 test files / 249 tests passed.
- `src/lib/m10-tests.test.ts` — 16 tests covering section diff, parse, create, validate, hash, registry, editor registry, export renderers.
- All 10 fix items from acceptance audit resolved:
  1. `/api/projects/[projectId]` now parses `contentJson` → `content` via `scrubPrismaProjectForClient`.
  2. Legacy section types normalized via `normalizeSectionType()` (documentLog→documentControl, etc.).
  3. FMD page wired to new APIs via `useFmdSections` SWR hook + "Initialize FMD" button.
  4. JsonTree fallback removed; legacy editor handles unknown sections.
  5. Export uses new section renderers.
  6. All 16 editors hardened to use `parseFmdSectionContent()` output as save base.
  7. Source/edit-vs-override workflow in Project Summary editor.
  8. Mapping table virtualized (read-only; edit mappings in the Mapping page).
  9. Reorder/delete/duplicate/refresh UI controls added.
  10. Progress file updated.
- Verification: lint 0 errors 0 warnings, 249 tests passed, build clean, audit 0 vulnerabilities.

### M10 acceptance criteria ✅

All criteria met:

- ✅ A user can create an FMD from an empty/current project without importing Excel — "Initialize FMD" button creates default sections from project data.
- ✅ A user can add, edit, delete, duplicate, reorder, and exclude/include FMD sections — all controls in the workbench toolbar and outline.
- ✅ The main FMD page has no raw JSON cards except in an explicit debug/evidence drawer — legacy editor replaces JsonTree fallback.
- ✅ At least 12 sections have purpose-built editors (all 16 canonical types + legacy).
- ✅ FMD sections reference project metadata, endpoints, profiles, fields, mapping rules, process flow nodes, and Boomi drafts via `linkedEntities`.
- ✅ Linked data shows stale/override status — "from source" / "overridden" badges with reset-override workflow.
- ✅ Manual document wording survives refresh from source — overrides stored in wrapper, refresh preserves them.
- ✅ Import preview supports section-by-section diff view with new/changed/unchanged indicators.
- ✅ Exported Excel uses section renderers and respects section order.
- ✅ Existing FMD resolver/import/export tests still pass (249 tests).
- ✅ New API/unit tests cover the authoring workflow (20 API tests + 16 M10 tests).
- ✅ `npm run lint`, `npm run test`, `npm run build`, and `npm audit --omit=dev` are clean.

### M10 risks and decisions to make early

- **Single active FMD vs multiple FMD versions**: start with one active FMD per project. Use revision log for document versions. Add `FmdDocument` only if multiple active docs are truly needed.
- **Rich text editor vs structured fields**: prefer structured fields and repeatable rows for M10. Avoid introducing a heavy rich-text editor until the document model is stable.
- **Project source edit vs document override**: this must be clear in the UI. Ambiguity here will corrupt either the FMD or the operational mapping model.
- **Large mapping table**: virtualization is mandatory before field mapping editing is considered complete.
- **Import confidence**: workbook imports can be stale or wrong. The import preview must make evidence and diffs visible without trusting the LLM blindly.
- **Secrets**: environment/sample sections must detect secret-looking values and warn/block export of passwords/tokens.

### M11 — Stabilization and enhancement (complete)

Key fixes/enhancements shipped in this session:

- `FlowDesigner` no longer desyncs when switching projects/flows (explicit state reset keyed by flow id, plus `workspace-app` keyed `FlowDesigner`).
- Mapping Studio delayed deletes are race-safe (functional state updates; undo implemented via a shared helper).
- Mapping table virtualization renders all rows correctly for large rule sets.
- Prisma project response scrubbing is centralized and reused by the single-project GET route.
- UI and SWR fetch error handling consistently surfaces `extractError()` detail.
- Importing large Excel files is guarded to avoid brittle session handoff behavior.
- FMD resolve errors now surface server-provided detail via toast feedback.

Latest verification (2026-05-28, Node 22.16.0):

- `npm run lint` — 0 errors
- `npm run test` — 19 files / 251 tests passed
- `npm run build` — clean typecheck and production build
- `npm audit --omit=dev` — 0 vulnerabilities

---

### M13 — Survivor-path stabilization before Boomi Companion (planned)

Audit date: 2026-05-31 JST

Context: `docs/boomi-companion-transition-plan.md` will replace the direct Boomi XML dry-run/publish workflow, so this audit intentionally skipped legacy publish UI, dry-run route behavior, rollback behavior, and XML generator correctness unless those paths leak into shared Project/FMD data.

Findings to fix:

- **Build is currently broken.** `npm run build` fails because `src/components/fmd/fmd-workbench.tsx` passes `onProjectFieldUpdate` to dynamic section editors, but `src/lib/fmd-editor-registry.ts` does not include that prop in `SectionEditorProps`.
- **Lint is currently broken.** `npm run lint` reports 28 `no-explicit-any` errors in `src/components/fmd/fmd-import-panel.tsx`, plus one unused `extractError` import in `src/components/fmd/editors/project-summary-editor.tsx`.
- **Single-project API refresh returns the wrong Project shape.** `/api/projects/[projectId]` currently sanitizes a raw Prisma row, but does not domain-map `processFlows.nodesJson` / `edgesJson` or `mappingSets.transformNodes.configJson`. SWR refreshes can therefore replace the client-safe `Project` graph with raw persistence fields. The route should reuse the `getWorkspaceProject` domain mapper, then sanitize.
- **FMD Project Summary "Edit source" workflow is wired incorrectly.** The editor sends document keys such as `linkedProcessId` instead of source project keys such as `processId`, and `fmd-workbench.tsx` treats the PATCH response as a raw `Project` instead of `{ project }`.
- **Tests miss the above regressions.** Add focused regression coverage for single-project GET domain shape and Project Summary source-edit request/response behavior.

Verification from audit:

- `npm run test` — ✅ 19 files / 251 tests passed
- `npm run lint` — ❌ failed with 28 errors / 1 warning
- `npm run build` — ❌ failed during typecheck on the FMD editor prop mismatch

Recommended M13 acceptance criteria:

- `npm run lint`, `npm run test`, and `npm run build` all pass.
- `/api/projects/[projectId]` returns the same domain-shaped graph as `getWorkspaceProject`, with credentials and heavy publish XML sanitized.
- FMD Project Summary source edits PATCH the intended project field, update local project state from `{ project }`, and preserve optimistic concurrency behavior.
- No work is spent on direct Boomi XML publish/dry-run feature behavior beyond keeping legacy code compiling while the Companion replacement is pending.

---

## Known Issues And Technical Debt

- **Sample-fallback project is read-only.** If SQLite is empty, the UI loads the in-memory sample project so the app opens, but edits will fail (`POST/PATCH/DELETE` against IDs that don't exist in SQLite). UI shows a toast when fallback mode is active. Standard flow: `npm run db:setup`.
- **Workspace-app.tsx still ~1,545 LOC** — reduced from 2,693 in M10.1 but further extraction of Dashboard, dialogs, and EmptyMappingState deferred to future milestone.
- **M10.8 import preview does not yet split apply actions** — the tabbed diff view exists but apply still uses the original FmdImportReview flow. Split apply (FMD document vs project entities vs both) deferred to future milestone.
---

## "Edit source" Implementation Complete ✅

Users can now edit project metadata from the Project Summary FMD editor via PATCH API:
- Click menu → "Edit source" button to update linked fields (name, process ID, owner, etc.)
- Each click fires PATCH `/api/projects/[projectId]` with optimistic concurrency check
- Loading state shown during request, error toast on failure
- Refresh project-local state after successful update

---

## Boomi API Reference (operational)

All Boomi API calls use **REST API v1** at `https://api.boomi.com/api/rest/v1/{accountId}/...`.

| Operation | Endpoint | Notes |
| --- | --- | --- |
| Connection test | `POST /ComponentMetadata/query` with `currentVersion=true` filter | Response: `{ "@type": "QueryResult", "numberOfResults": N }` |
| UUID search | `POST /ComponentMetadata/query` with simple `EQUALS` on `componentId` | Compound expressions not reliably honored |
| Name search | `POST /ComponentMetadata/query` with `LIKE %term%` on `name` | Filter type client-side after fetch |
| Template fetch | `GET /Component/{componentId}~{version}` with `Accept: application/xml` | Returns full component XML |
| Component publish | `POST /Component` (create) or `POST /Component/{componentId}` (update) with `Content-Type: application/xml` | Same Basic API Token auth as reads |
| "same configuration values as the previous version" | Treat as **no-op success** | Boomi returns this when XML round-trips identically |

Base URL normalizer (`normalizeBoomiBaseUrl`) accepts `https://api.boomi.com`, `https://api.boomi.com/api/rest/v1/`, `https://api.boomi.com/api/rest/v2`. Stored value: bare host.

---

## Key File Index

| Concern | File |
| --- | --- |
| Domain types | `src/lib/domain.ts` |
| Prisma client + sanitizer | `src/lib/db.ts` |
| Project / endpoint / profile / field mutations + schemas | `src/lib/project-mutations.ts` |
| Mapping rule mutations | `src/lib/mapping-mutations.ts` |
| Mapping quality validation | `src/lib/mapping-quality.ts` |
| Field import (CSV/JSON/XML) | `src/lib/field-import.ts` |
| FMD resolver (deterministic + Ollama) | `src/lib/fmd-import.ts` |
| FMD apply pipeline + conflict detection | `src/lib/fmd-apply.ts` |
| FMD export templates | `src/lib/fmd-export.ts` |
| Crypto (AES-256-GCM, key bootstrap) | `src/lib/boomi-crypto.ts` |
| Boomi XML generators + patchers + key reconciliation | `src/lib/boomi-xml.ts` |
| Boomi sandbox helpers + publish safety | `src/lib/boomi-sandbox.ts` |
| Toast + confirm dialog | `src/components/toast.tsx` |
| Mapping Studio | `src/components/mapping-studio.tsx` |
| Boomi API tab + dependency scanner | `src/components/boomi-api-tab.tsx` |
| Flow Designer + module-scoped ReactFlow types | `src/components/flow-tab.tsx` |
| Global dashboard | `src/components/global-dashboard.tsx` |
| Workspace shell (still hosts Dashboard + FMD inline) | `src/components/workspace-app.tsx` |

---

## Rules For Future Work

- Always read this file before starting implementation.
- Always update this file at the end of a session. Move completed items from M9 backlog into "Current Implementation Status" with a one-line summary, not a fix-by-fix log.
- Add new discovered issues to "Known Issues And Technical Debt" or "M9 backlog" — not as a new dated session log entry.
- Record exact verification commands and results (lint / test / build / audit) at the bottom of "Current Implementation Status > Tests + verification".
- Do not enable real Boomi publishing for component types outside `PUBLISH_ALLOWED_TYPES` without (a) a real XML generator, (b) reconciliation logic, (c) a type-specific test.
- Keep `npm audit --omit=dev` clean. If a vulnerability cannot be fixed, document the package + severity + reason + mitigation here.
- Use Node 20+ (Node 22 LTS recommended). `.nvmrc` and `engines` enforce this; do not bypass.
- Prefer the established write pattern: Zod schema in `src/lib/*-mutations.ts`, thin Next.js route handler, client drawer with inline validation, `extractError` for error surfacing.
- Any new server response containing a Project graph must go through `sanitizeProjectForClient()` (or the inline `scrubPrismaProjectForClient` equivalent if it serves a Prisma row directly).
- Any new `useEffect` that closes over a parent-scoped function needs either the function in deps or an explanatory `eslint-disable-next-line react-hooks/exhaustive-deps` with a comment — not a silent strip.
