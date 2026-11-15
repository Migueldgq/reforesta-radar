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
curl localhost:8010/api/oportunidades             # OpportunitiesResponse, same shape as the TS route
```

- API: http://localhost:8010 · OpenAPI docs: http://localhost:8010/docs · Postgres: `localhost:5440` (user,
  password and database `radar`; local development only).
- Host ports, password and ingest interval are overridable in a root `.env` (see `../.env.example`).
  `backend/.env.example` is only for running the API or the ingest on the host with `uv run --env-file .env`.
- Schedule: `ingest-scheduler` is part of the default `docker compose up`; it ingests on start and then every
  `RADAR_INGEST_EVERY_S` seconds (default 8 h). For anything sturdier use the host's cron with
  `docker compose run --rm ingest --trigger schedule`.
- Migrations by hand: `docker compose run --rm --entrypoint alembic ingest upgrade head`.

### Without Docker (development)

```bash
cd backend
uv sync                                    # Python 3.13 + dev tools
uv run ruff check && uv run ruff format --check
uv run pytest                              # the store test uses the compose Postgres on :5440 (skipped if down)
uv run --env-file .env python -m app.ingest --dry-run --source boe
uv run --env-file .env uvicorn app.main:app --reload --port 8011
```

## Layout

```
backend/
  app/
    main.py            FastAPI app: /health, /api/oportunidades, /api/fuentes (CORS for localhost:3000)
    config.py          settings from environment variables
    models.py          Pydantic contract (camelCase JSON, mirrors src/lib/opportunity.ts + types.ts)
    http.py            shared async HTTP client: timeout, bounded concurrency, retry, generic User-Agent
    scoring/           port of scoring.ts, reforesta-profile.ts, regions.ts
      text.py            normalize_text, has_term, has_word, js_round
      profile.py         keyword / dealbreaker / NGO / geo / kind tables (value-for-value with the TS)
      score.py           ScoreInput, score_convocatoria, score_rsc, tier_for, FitAdjust
      rank.py            geographic_fit, kind_fit, rank, clean_items (read time)
      regions.py         infer_comunidad_autonoma
    sources/           connectors
      base.py            Source, RawOpportunity, FetchResult, SourceContext, score_raw
      __init__.py        registry (SOURCES) and SOURCE_ORDER
      memo.py            fetch_cache-backed TTL memo (same keys/values as the TS)
      notices.py         decode_html, is_call_notice, is_open_tender, extract_notice_details,
                         parse_deadline, deadline_from_days, es_date_to_iso (BOE, BOCM, DOG, BDNS)
      boe.py, rsc.py     ported connectors
      eu.py, fb.py, bocm.py, dog.py  ports of src/lib/sources/multi-source.ts
      bdns.py            BDNS connector (68 searches + a memoised detail for every candidate; retries 429 x3)
    ingest/
      __main__.py        CLI (python -m app.ingest), per-source run, summary table
      store.py           one-transaction write: upsert, change log, gone, run records, fetch_cache
      hashing.py         content_hash / dedupe_key (byte-identical to store-pg.ts)
    api/state.py       read path: live items, source health, last ingest
    db/                tables (SQLAlchemy Core) and async engine
  alembic/             migrations (0001 = supabase/migrations/0001_init.sql)
  tests/               parity, connectors on recorded fixtures, store semantics
```

## Scoring parity with the TypeScript

Correctness over elegance: same numbers, same Spanish strings, same order of reasons and warnings.

- `tests/test_parity_functions.py`: identical inputs → identical outputs, against data dumped from the TS
  functions themselves (former `tools/dump_ts_golden.ts`, frozen clock): 2 168 `scoreConvocatoria` cases, 3 630
  `geographicFit`+`kindFit` cases, `scoreRsc`, `inferComunidadAutonoma`, `normalizeText`, `contentHash`,
  `dedupeKey`, and every profile table value by value.
- `tests/test_parity_golden.py`: the live TS `GET /api/oportunidades` (542 items) rebuilt from raw fields and
  scored end to end (base + connector adjustment + geo + kind): score, tier, reasons and the whole `fit` must match.
  The API output lacks some scoring inputs (BDNS `descripcionLeng`/`objetivos`/`abierto`, the EU description past
  400 chars); they were captured once into `tests/golden/` (`bdns_inputs.json.gz`, `eu_inputs.json.gz`).

The goldens and the `expected.json` fixtures are **frozen**: they were dumped from the TypeScript backend before it
was deleted (the dump tools `tools/dump_ts_*.ts` and `tools/capture_*_inputs.py` went with it; see git history
before the Python cutover). They pin the scoring as it was at parity. When you change the scoring on purpose,
update the affected expectations in the tests and bump `SCORING_VERSION` (`app/scoring/__init__.py`, now 11; it is
stored in `ingest_runs.scoring_version`).

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
  (50) for remote PDFs. Text extraction uses `pypdf` (BSD) with unpdf's page-merge normalisation; on both samples
  every field matches the TS except `charCount`/`excerpt` of the MITECO sample (pypdf drops one line break).
  `pdfUrl` keeps the TS host allow-list and adds SSRF guards (see `app/pdf/download.py`). The sample PDFs are read
  from the repo's `data/samples` (`RADAR_SAMPLES_DIR` overrides); compose mounts them at `/data/samples` read-only.
- `GET /api/perfil` (`app/api/perfil.py`): byte-identical to the TS route (`tests/golden/perfil.json`).
- The goldens (`tests/golden/perfil.json`, `analyze_pdf_*.json`) were taken from the former TS routes and are frozen.
