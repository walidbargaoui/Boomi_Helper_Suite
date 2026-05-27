# Boomi Helper Suite

Boomi Helper Suite is a local-first design workspace for Boomi architects and developers. It helps teams turn integration requirements into structured FMD documentation, source-to-target mappings, process-flow drafts, and guarded Boomi component previews before touching a real Boomi environment.

The app is intended for practical integration design work: import an FMD or start from scratch, model profiles and endpoints, map fields with validation, inspect process flow, generate readable workbook output, and use the Boomi API lab to dry-run or publish only when safety checks pass.

## What The App Does

- Manages multiple Boomi design projects with process metadata, endpoints, profiles, mapping sets, FMD sections, process flows, Boomi connections, component drafts, and publish history.
- Provides an editable FMD Workbench with structured section editors for project summary, purpose and scope, environments, endpoints, profiles, mapping tables, transformations, process flow, Boomi components, error handling, tests, checklists, and appendices.
- Imports FMD workbooks, normalizes mapping/profile/endpoint evidence, reconciles proposed updates, and exports polished Excel FMD workbooks.
- Includes a visual Mapping Studio for source and destination profiles, fields, constants, lookups, functions, comments, review state, and mapping quality checks.
- Includes a React Flow based process designer with Boomi-style shapes and XML draft preview.
- Includes a Boomi API Lab for sandbox connections, component lookup, template import, dependency scanning, dry-run XML generation, guarded publish attempts, publish event history, and rollback from prior request XML.
- Uses a local SQLite database through Prisma, with API response sanitization so encrypted credentials and large XML bodies are not sent to the browser unless explicitly requested.

## Current Status

The app is an active local product prototype with milestones M1-M10 implemented:

- Workspace, project management, endpoint/profile CRUD, field import, and dashboard workflows.
- Editable mapping studio with validation and rule review.
- FMD import, resolver, apply, editable workbench, validation, and export.
- Process flow editor and process XML draft generation.
- Boomi sandbox connection management, template import, dry-run generation, guarded publish support for selected map/profile components, event history, and rollback.
- Unit and integration coverage across FMD, mappings, Boomi safety checks, API routes, sanitization, resolver cache, and end-to-end project flows.

## Safety Model

Boomi Helper Suite is designed to keep risky operations explicit:

- Credentials are stored encrypted.
- Project responses are sanitized before reaching the browser.
- Boomi publishing is guarded by sandbox-only checks, component-type allowlists, template requirements, mapping quality checks, and review thresholds.
- Unsupported component types are import-only until their generators and regression tests are strong enough.
- Dry-run XML previews and imported Boomi templates are the preferred path before publishing.

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
- `BOOMI_HELPER_FMD_DEBUG`: set to `1` only when you intentionally want resolver debug payloads returned by the FMD resolve API.
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

- Keep Boomi publishing conservative. Prefer dry-run, template import, dependency scan, and sandbox validation before widening publish support.
- Keep generated XML behavior covered by fixtures or golden-file tests before allowing a new component type to publish.
- Keep FMD content editable and structured; avoid turning the FMD workbench into a read-only import viewer.
- Keep local-only artifacts ignored, especially environment files, databases, build output, dependency folders, and resolver caches.

## Recommended Next Milestone

The next high-value milestone is a project readiness console: a unified review layer that tells users whether a project is ready for FMD export, dry-run, or sandbox publish, and points them directly to the section, mapping, flow node, profile, endpoint, template, or Boomi draft that needs attention.
