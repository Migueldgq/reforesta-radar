<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Architecture decisions (ADRs)

Decisions live in `docs/adr/` (Spanish, one file per decision; rules and template in `docs/adr/README.md`). Read the
relevant ADRs before changing architecture, data sources, scoring behaviour, the security model, dependencies or
hosting, and do not undo a decision recorded there without a new ADR.

Any change in those areas adds an ADR in the same PR: next free number, template from `docs/adr/README.md`, a row in
its index. Never rewrite an accepted ADR: write a new one and set the old one's status to "Sustituida por NNNN". Do
not invent rationale: if the reason is not known, write "motivo no registrado".
