# Reforesta Radar · Python backend

FastAPI + Postgres + Alembic, managed with [uv](https://docs.astral.sh/uv/), everything in Docker. This is the
only backend of the radar. It started as a port of the former TypeScript backend (connectors, explainable scoring,
ingest, API), which was deleted once this one reached parity; it keeps the same JSON contract
(`src/lib/opportunity.ts`, used by the frontend). The Next.js app proxies `/api/*` here.

```
sources ──► ingest (python -m app.ingest) ──► Postgres ◄── API (FastAPI) ◄── /api/* ── Next.js
             scores BASE fit, one transaction          read-time geo + kind fit, ranking
```

## Run it

```bash
docker compose up -d --build                      # from the repo root: postgres, api, ingest-scheduler, web (:3010)
docker compose up -d postgres api                 # backend only; migrations run when the API starts
curl localhost:8010/health                        # {"status":"ok","database":"ok"}
docker compose run --rm ingest                    # ingest every ported source
docker compose run --rm ingest --source boe,rsc   # a subset;  --dry-run fetches and diffs without writing
curl localhost:8010/api/public/oportunidades      # OpportunitiesResponse (the landing's copy; /api/oportunidades needs a session)
docker compose run --rm api python -m app.users create-admin ana@example.org   # first admin (accounts: ../docs/api-auth.md)
```

- API: http://localhost:8010 · OpenAPI docs: http://localhost:8010/docs · Postgres: `localhost:5440` (user,
  password and database `radar`; local development only).
- Host ports, password and daily ingest time are overridable in a root `.env` (see `../.env.example`).
  `backend/.env.example` is only for running the API or the ingest on the host with `uv run --env-file .env`.
- Schedule: `ingest-scheduler` (part of the default `docker compose up`) runs `python -m app.ingest.scheduler`: one
  ingest a day at `RADAR_INGEST_AT` (default `09:00`, `RADAR_TZ`). It checks every 30 s (also for an admin's "update
  now" request in `ingest_requests`, run with `--trigger request`) and runs when no ingest
  (any trigger) has succeeded since the latest 09:00, so a laptop asleep at 09:00 catches up on waking; it runs
  right away when the database was never ingested; a failed run is retried an hour later.
- Migrations by hand: `docker compose run --rm --entrypoint alembic ingest upgrade head`.

### Without Docker (development)

```bash
cd backend
uv sync                                    # Python 3.13 + dev tools
uv run ruff check && uv run ruff format --check
uv run pytest                              # store/auth/board tests use the compose Postgres on :5440 (skipped if down)
uv run --env-file .env python -m app.ingest --dry-run --source boe
uv run --env-file .env uvicorn app.main:app --reload --port 8011
```

## Layout

```
backend/
  app/
    main.py            FastAPI app: /health, /api/oportunidades, /api/public/oportunidades, /api/fuentes; wires
                       the routers, the session requirement and the CSRF middleware (CORS for localhost:3000)
    users.py           CLI: python -m app.users create-admin <email>
    auth/              accounts (contract: ../docs/api-auth.md)
      passwords.py       Argon2id hashing, dummy verify for unknown accounts, length rule
      tokens.py          random tokens; only their sha256 is stored
      deps.py            sessions, cookie, `current_user` / `require_admin` dependencies, per-request transaction
      csrf.py            X-Radar-CSRF + Sec-Fetch-Site check on unsafe /api/ requests
      throttle.py        in-process throttling (logins per account and IP; /mcp per IP)
      pats.py            personal access tokens for /mcp (rr_pat_…, sha256 only, expiry, revocation)
      accounts.py        users, invitations, reset links, bootstrap admin
      mail.py            optional SMTP for links (off without SMTP_HOST)
    config.py          settings from environment variables
    models.py          Pydantic contract (camelCase JSON, mirrors src/lib/opportunity.ts + types.ts)
    http.py            shared async HTTP client: timeout, bounded concurrency, retry, generic User-Agent
    scoring/           port of scoring.ts, reforesta-profile.ts, regions.ts
      text.py            normalize_text, has_term, has_word, js_round
      profile.py         keyword / dealbreaker / NGO / geo / kind tables (value-for-value with the TS)
      score.py           ScoreInput, score_convocatoria, score_rsc, tier_for, FitAdjust
      rank.py            geographic_fit, kind_fit, rank, clean_items (read time)
      history.py         FitAdjust from the past winners of a BDNS call (read time, after geo + kind)
      team_profile.py    the team's Perfil on top of the server score (port of applyProfileAll in the web)
      regions.py         infer_comunidad_autonoma
    sources/           connectors
      base.py            Source, RawOpportunity, FetchResult, SourceContext, score_raw
      __init__.py        registry (SOURCES) and SOURCE_ORDER
      memo.py            fetch_cache-backed TTL memo (same keys/values as the TS)
      notices.py         decode_html, is_call_notice, is_open_tender, extract_notice_details,
                         parse_deadline, deadline_from_days, es_date_to_iso, excerpt (BOE, BOCM, DOG, BDNS)
      names.py           organism display names: Spanish title case, accents, aliases (ADR 0030)
      boe.py             ported connectors
      rsc.py             hand-checked private programmes (the only copy; the web reads them from the API)
      eu.py, fb.py, bocm.py, dog.py  ports of src/lib/sources/multi-source.ts
      bdns.py            BDNS connector (68 searches + a memoised detail for every candidate; retries 429 x3)
      bdns_history.py    previous editions of a BDNS call (organ resolution, title matching) and who won them
    ingest/
      __main__.py        CLI (python -m app.ingest), per-source run, summary table
      scheduler.py       daily run at RADAR_INGEST_AT (python -m app.ingest.scheduler), is_due()
      history.py         BDNS history step, after the main write (own budget and transaction; never fails the run)
      store.py           one-transaction write: upsert, change log, gone, run records, fetch_cache
      hashing.py         content_hash / dedupe_key (byte-identical to store-pg.ts)
    api/state.py       read path: live items, source health, last ingest
    api/auth.py        /api/auth/*: login, logout, session, invitation and reset links
    api/team.py        /api/team/* (admin), /api/users, /api/me
    api/board.py       /api/board, /api/settings, /api/votes, /api/import
    api/ingest_requests.py  /api/ingest: "update now" requests for ingest-scheduler
    api/tokens.py      /api/me/tokens: personal access tokens (session only)
    mcp/               read-only MCP server (../docs/mcp.md): server.py tools, http.py /mcp endpoint and its
                       auth, __main__.py stdio (python -m app.mcp)
    db/                tables (SQLAlchemy Core) and async engine
  alembic/             migrations (0001 = supabase/migrations/0001_init.sql, 0002-0003 = bdns_editions,
                       0004 = accounts and team state, 0005 = personal tokens, 0006 = per-field saved-by/at
                       in org_settings, 0007 = organism display names on stored rows)
  tests/               parity, connectors on recorded fixtures, store semantics
```

## Scoring parity with the TypeScript

Correctness over elegance: same numbers, same Spanish strings, same order of reasons and warnings.

- `tests/test_parity_functions.py`: identical inputs → identical outputs, against data dumped from the TS
  functions themselves (former `tools/dump_ts_golden.ts`, frozen clock): 2 168 `scoreConvocatoria` cases, 3 630
  `geographicFit`+`kindFit` cases, `inferComunidadAutonoma`, `normalizeText`, `contentHash`,
  `dedupeKey`, and every profile table value by value.
- RSC items are outside both parity tests: the TS list was replaced on 2026-11-15 by programmes checked on the
  funders' sites (`app/sources/rsc.py`, tested in `tests/test_sources.py`).
- `tests/test_parity_golden.py`: the live TS `GET /api/oportunidades` (542 items) rebuilt from raw fields and
  scored end to end (base + connector adjustment + geo + kind): score, tier, reasons and the whole `fit` must match.
  The API output lacks some scoring inputs (BDNS `descripcionLeng`/`objetivos`/`abierto`, the EU description past
  400 chars); they were captured once into `tests/golden/` (`bdns_inputs.json.gz`, `eu_inputs.json.gz`).

The goldens and the `expected.json` fixtures are **frozen**: they were dumped from the TypeScript backend before it
was deleted (the dump tools `tools/dump_ts_*.ts` and `tools/capture_*_inputs.py` went with it; see git history
before the Python cutover). They pin the scoring as it was at parity. When you change the scoring on purpose,
update the affected expectations in the tests and bump `SCORING_VERSION` (`app/scoring/__init__.py`, now 15: the
BDNS history signal, then the estimated end of undated BDNS calls, ADR 0028; it is stored in
`ingest_runs.scoring_version`).

Details that matter when porting more code:

- JS `Math.round` rounds halves up; Python `round` does not. Use `js_round`.
- "Today" is local midnight in `RADAR_TZ` (Europe/Madrid), like the TS on a Madrid machine. Every scoring function
  takes an optional `today` so tests are reproducible.
- JS regex `\d`, `\b` are ASCII-only: write `[0-9]` or use `re.ASCII` where it matters.
- Known TS quirks kept for parity (fixing one changes the frozen expectations; bump `SCORING_VERSION`):
  `deadline_from_days(..., "1 mes")` returns one day early in Madrid (the TS prints local midnight with
  `toISOString()`).
- Deliberate deviations from the TS connectors (fetching only; the scoring functions are unchanged and still match
  the goldens):
  - BDNS reads the detail ("ficha") of **every** candidate that survives the pre-score (~1 000 of ~1 600 unique
    calls today), not only the best 230. The TS cap existed because it fetched live inside a 35 s web request; the
    ingest is a background batch (8 min per source) and details are memoised in `fetch_cache`. `MAX_ENRICH` (2 000)
    is now only a safety bound. Cold run ≈ 2 min (BDNS answers about half the first attempts with 429; retries
    absorb all but a handful), warm run ≈ 10 s. "Lite" items (search row only: no deadline, type or beneficiaries;
    −5 and the "Ficha BDNS no cargada" warning) now appear only when a detail fails or past the bound. With details,
    `keep()` sees the real call type and beneficiaries: non-competitive calls are dropped.
  - BDNS `keep()` requires a work line (a topic match) for every call. The TS also kept calls from priority
    searches (IRPF, tercer sector, interés general) open to NGOs without one; that let in ~260 social calls and no
    environmental one, so the exception is gone (priority searches still get their details read first).
  - BDNS retries 429/5xx/network errors up to 3 times (the TS retried once) and reads details 4 at a time
    (`DETAIL_CONCURRENCY`), half the TS fan-out, to be gentle with the public API.
  - `tests/test_parity_golden.py` still rebuilds the golden's 286 lite items as lite (the golden is the TS output),
    so it keeps covering the lite adjustment; a live ingest no longer produces them in bulk.
- The golden still holds items from sources dropped from the product (`ted`, `bocyl`); they are kept as extra
  scoring-parity cases only (`tests/golden_reconstruct.py` rebuilds their inputs), not as sources to port.

## History of BDNS calls (previous editions, past winners)

After the main write, `app/ingest/history.py` reads the history of the BDNS calls worth a look (competitive grants
with a displayed score >= 40, or closed recurring ones; ~250 today) and stores it in `bdns_editions` (one row per
current call and edition, the current edition included). The API attaches it at read time as `history` on each BDNS
item (`editions`, `typicalOpening`, `typicalWindow`, `awards`; absent when no previous edition was found). Past
editions are never opportunities.

- **Matching** (`app/sources/bdns_history.py`): BDNS has no series id. The detail's organ names are resolved to ids
  with `/organos?idAdmon=C|A|L`; every call of that organ since 2018 is listed (`organos=<ids>&pageSize=2000`) and
  titles are compared locally: published before the current one, not an amendment (modification, credit increase,
  correction, term extension; es/ca/gl), Jaccard >= 0.5 on title tokens (no numbers, stopwords, boilerplate or the
  organ's own name), at most one per calendar year (the best; the current edition takes its own year). Opening:
  with one previous edition only "La edición anterior abrió en mayo de 2025"; "irregular" only with >= 3 editions
  and a gap of >= 2 years. The newest 4 previous editions are read in detail and, from mid-2021, their awards.
- **Privacy**: award rows name natural persons. Only counts by NIF class (G non-profit, A/B companies, P local bodies,
  Q public bodies, masked/DNI/NIE persons...), amounts, dates and hits of a curated NGO list (by NIF) are kept; the
  memo stores that reduced summary, never the raw response.
- **Scoring** (`app/scoring/history.py`, applied in `rank.adjusted_fit`): Reforesta (G80428204) won a past edition
  +8; curated peer NGOs won +3; >= 70 % of >= 5 past awards to non-profits +6; < 20 % −10 and a warning; none at all:
  also capped at 45. These two penalties need a trustworthy basis (every counted edition matched with Jaccard
  >= 0.6, or >= 2 counted editions that each agree); otherwise the counts are shown in `history.awards` only. The delta goes on the base fit (territorial and kind caps still bound it), the cap last (a
  ceiling geographic bonuses cannot lift), the reasons first. The web Perfil adds its deltas on top of this fit.
- **Cost and failure**: 3 requests in flight, memoised in `fetch_cache` (organ trees and lists 7 d, edition details
  90 d, awards 7/30/90 d by age). Cold start on 2026-11-15: 255 calls, 1 146 requests (108 answered 429 and were
  retried), 2 min, 177 calls with history; a warm run made 0 requests (2 s): a daily run reads only what expired. Budget
  `HISTORY_TIMEOUT_S` (30 min); on a timeout the calls read are saved. A failure is logged and never fails the run;
  calls not read keep their earlier rows.

## How to add a source (step by step)

These steps were written while porting from the TypeScript backend, which is now deleted (see git history before
the Python cutover). For a new source, read "the TS connector" below as "the upstream API or page and the closest
existing connector" (e.g. `app/sources/boe.py`), and "the TS output" as the expected items you write by hand.

1. **Read the TS connector** (list below) end to end: what it fetches, how it maps each field, every
   `scoreConvocatoria({...})` argument, every post-scoring tweak (`fit.score = ...`, `fit.warnings.push`, ...),
   every filter on `fit`, and the exact `health` it returns.
2. **Create `app/sources/<id>.py`** with a `Source` subclass (`id`, `name`, `async fetch(ctx) -> FetchResult`).
   Use `ctx.http.text/json(url, timeout=...)` (never a raw client) and `map_limit` for fan-out; use `ctx.memo.get`
   with the **same key and value shape as the TS** `memo()` call (camelCase), so `fetch_cache` stays shared.
3. **Map each item to `RawOpportunity`**: the contract fields exactly as the TS sets them, plus
   `score_input=ScoreInput(...)` with exactly the TS arguments (omit the ones the TS omits: a missing `kind` is not
   the same as `kind="subvencion"`). Do not compute the stored fit in the connector. Post-scoring tweaks become a
   `FitAdjust` (`delta`, `cap`, `deadline_state`, `prepend_reasons`, `append_warnings`; applied in that order).
   Pre-scoring to choose what to fetch is fine (BOE, BDNS do it); that pre-score is never stored.
4. **Filters on the scored item** go in `keep(self, o)` (e.g. BOE keeps `fit.score >= 30`). If the health note
   includes the number of kept items, write `{count}` in the note: the ingest fills it in.
5. **Health**: return the TS `SourceHealth` (id, name, category, url, status rules, Spanish note). Errors: return
   status `"error"` with the note, or raise; the ingest turns exceptions and timeouts into an error run and never
   touches that source's rows.
6. **Register** the instance in `app/sources/__init__.py` (`SOURCES`). `SOURCE_ORDER` already lists the 7 product
   sources (bdns, boe, eu, bocm, dog, fb, rsc).
7. **Shared helpers**: put text helpers used by more than one connector in `sources/notices.py` (or a new module
   next to it); port them from the TS literally.
8. **Test with a recorded fixture**: save the real responses under `tests/fixtures/<id>/` (trim to what the test
   needs), serve them with `httpx.MockTransport`, freeze the clock (`monkeypatch.setattr(module, "local_now", ...)`),
   and assert the items equal the TS output in `tests/golden/oportunidades.json` (fields and `adjusted_fit`). See
   `test_boe_fetch_maps_and_scores_like_ts` in `tests/test_sources.py`.
9. **Golden reconstruction**: `tests/golden_reconstruct.py` already rebuilds every TS source's input; when you
   port a source, import its constants from your module instead of the copies there (EU: `EN_TOPIC`).
10. **Verify**: `uv run ruff check && uv run pytest`, then `docker compose build api` and
    `docker compose run --rm ingest --source <id>`; compare `curl localhost:8010/api/oportunidades` items of that
    source with the TS route's.

### Port history (TS → Python, all done)

| id | TS | notes |
|---|---|---|
| `bdns` | `src/lib/bdns.ts` (`getBdnsOpportunities`, `detailToOpportunity`, `rawToOpportunity`, `preScore`, `searchPaged`, `RADAR_QUERIES`, `PRE_DROP_TERMS`) | 68 paged searches + up to `MAX_ENRICH` details (TS: 230; Python: every candidate, see deviations above); memo `bdns:detail:N` (TTL 24 h with end date, 3 h without); needs `infer_comunidad_autonoma`, `parse_deadline`, `deadline_from_days`; adjustments: conflict (`sin_fecha`, −12, cap 60), estimated-deadline warning, lite (−5 + warning); `keep()` uses isCompetitive / score ≥ 25 / workLines / priority. The TS `fetchJsonShared` dedupes identical concurrent GETs: add that to `Http` if needed. **Ported** (`app/sources/bdns.py`, `tests/test_bdns.py`): 481/481 ids and fields identical to the live TS route; no in-flight dedupe needed (every BDNS URL is unique per run). |
| `eu` | `src/lib/sources/multi-source.ts` (`scrapeEu`, `sediaSearch`, `EN_TOPIC`, `EU_OFFTOPIC`, `nextFutureDeadline`) | SEDIA search is a multipart POST; scoring titulo/extraText are Spanish terms; Horizon (−12, cap 58, warning), LIFE (prepend reason), municipalities warning. **Ported** (`app/sources/eu.py`, `EN_TOPIC` now lives there). |
| `bocm` | `multi-source.ts` (`scrapeBocm`, `bocmXmlUrl`, `parseBocmXml`) | XML summaries; notice details via `extract_notice_details`; tipo depends on body text. **Ported** (`app/sources/bocm.py`). |
| `dog` | `multi-source.ts` (`scrapeDog`) | Pre-score then details like BOE. **Ported** (`app/sources/dog.py`). |
| `fb` | `multi-source.ts` (`scrapeFundacionBiodiversidad`, `parseAmount`) | HTML list + detail; closed-status adjustment (`deadline_state="cerrada"`, cap 50); drops becas. **Ported** (`app/sources/fb.py`). |

Final source set: bdns, boe, eu, bocm, dog, fb, rsc. `ted`, `bocyl`, `boja` and `montemadrid` were removed from
the product and are not to be ported.

### PDF analyzer and `/api/perfil` (ported)

- `POST /api/analyze-pdf` (`app/api/analyze_pdf.py`, `app/pdf/`): same request shapes (`sample`, `docId`, `pdfUrl`,
  multipart `file`), JSON and Spanish errors as the TS route; 15 MB cap (uploads too), 415 on non-PDF, LRU cache
  (50, extracted text) for remote PDFs. Text extraction uses `pypdf` (BSD) with unpdf's page-merge normalisation.
  Summary, beneficiaries, budget and requirements still match the TS on both samples; title, organism, deadlines and
  fit changed on purpose: a PDF of a call in the radar carries the list's fit, a PDF with under 3,000 characters is
  not scored (ADR 0033).
  `pdfUrl` keeps the TS host allow-list and adds SSRF guards (see `app/pdf/download.py`). The sample PDFs are read
  from the repo's `data/samples` (`RADAR_SAMPLES_DIR` overrides); compose mounts them at `/data/samples` read-only.
- `GET /api/perfil` (`app/api/perfil.py`): byte-identical to the TS route (`tests/golden/perfil.json`).
- The goldens (`tests/golden/perfil.json`, `analyze_pdf_*.json`) were taken from the former TS routes and are frozen.
