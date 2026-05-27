# Boomi Helper Suite

A local single-user web app for Boomi architects and developers to design FMDs, field mappings, process flows, and Boomi API dry-runs before publishing anything to a real account.

## Implemented MVP

- Project dashboard with endpoints, process metadata, deployment readiness, and mapping quality status.
- Visual mapping studio for source/destination profiles, data types, constants, lookup/function rules, comments, and quality checks.
- FMD builder with Excel import normalization and polished `.xlsx` export.
- Process flow designer backed by React Flow.
- Boomi API lab with mocked inventory sync, component XML preview, diffing, and dry-run validation.
- SQLite/Prisma schema for the planned local data model.

## Run Locally

Requires Node 20+ (Node 22 LTS recommended). An `.nvmrc` is provided.

```bash
nvm use            # or: nvm use 22
npm install
npm run db:setup   # generate client + apply migrations + seed
npm run dev
```

Open http://localhost:3000.

The UI also falls back to seeded in-memory project data if the SQLite database is not present, but edits require the database.

## Verification

```bash
npm run lint
npm run test
npm run build
```

The FMD tests read the sample workbooks from `/Users/walidbargaoui/Documents/Downloads for Chrome/`.

## Boomi API Notes

The MVP does not publish directly to Boomi. It generates dry-run XML previews and diffs only. Real sandbox publishing should be enabled after importing a valid exported Boomi component template from the target account, because Boomi component updates are full XML updates and component XML should not be hand-generated blindly.
