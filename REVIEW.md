# Review notes

Facts about this repository that a reviewer cannot infer from a diff. Decisions behind them are in `docs/adr/`
(Spanish); do not suggest undoing one without a new ADR.

## Deploys and the database

- Deploys have no downtime (ADR 0044): for a few seconds the old and the new API run against the same database, which
  the new API has already migrated, and a rollback does not undo a migration. So every Alembic migration
  (`backend/alembic/versions/`) must work with the previous release: adding tables, nullable or defaulted columns and
  indexes is fine; dropping or renaming something the running release uses, or adding `NOT NULL` without a default,
  is a bug. It takes two deploys: first the code that stops using it, then the migration that removes it
  (`docs/despliegue.md`, "Regla para las migraciones").
- Deploys run only from a green CI run of a push to `main` (`.github/workflows/deploy.yml`, ADR 0039). Never from a
  pull request or a fork.

## Scoring

- The score is rule-based and explained point by point (ADR 0005). No LLM sets or changes it.
- Any change to scoring behaviour (`backend/app/scoring/`, profile tables, connector mappers, read-time signals such
  as `history.py`) must bump `SCORING_VERSION` in `backend/app/scoring/__init__.py` (currently 19). The scheduler
  re-ingests when the stored version differs.
- Some TypeScript quirks are kept on purpose for frozen parity (ADR 0020, `backend/README.md`); fixing one changes the
  expected values and needs a `SCORING_VERSION` bump.

## AI review of calls (ADR 0041)

- The Gemini review only judges whether a call's topic fits; it never raises or changes the score.
- A `no` verdict hides a call from the default list but never deletes it, and never hides a call the team follows
  (any board row: status, owner or notes) or that someone voted "Nos sirve".
- It fails open: any error means "no verdict" and the call stays listed. Ingest never fails because of it.
- Only public call text is sent (title, issuing organisation, type, purpose or summary), never team data.

## Secrets and test data

- Secrets live only in the deployment environment (Dokploy) and GitHub secrets, never in git: not in code, fixtures,
  docs or examples (`docs/despliegue.md`).
- Test and example accounts use `@example.org` addresses (`backend/tests/`, `e2e/`, docs).

## Web

- This Next.js version has breaking changes from older ones (`AGENTS.md`): check `node_modules/next/dist/docs/` before
  calling an API wrong from memory.
- The web is a frontend only (ADR 0004). `next.config.ts` proxies `/api/*`, `/mcp`, `/mcp/equipo`, `/oauth/*` and
  the OAuth `/.well-known/*` documents to the Python API; the browser only calls the same origin.
