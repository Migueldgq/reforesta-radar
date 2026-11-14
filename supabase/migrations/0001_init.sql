-- Reforesta Radar · 0001_init
-- Base schema for the ingest (scripts/ingest.ts) and the read path (src/lib/store-pg.ts).
--
-- Rows hold the BASE opportunity (connector output + base fit). Geographic and kind fit are applied
-- at read time by rank() in src/lib/aggregate.ts, so a scoring tweak never needs a re-ingest.
--
-- Security: RLS is enabled on every table with NO policies, so the anon/authenticated roles that
-- Supabase exposes through its REST API see nothing. The app and the ingest connect server-side with
-- the database URL (postgres role, which bypasses RLS).
--
-- Next migration (0002, not in this tranche): Supabase Auth (magic link) users, team profile,
-- shared tracking board (opportunity_id FK + status/owner/notes), "nuevo desde tu última visita"
-- (per-user last_visit_at) and alerts. Those tables will get explicit RLS policies.
--
-- Idempotent: safe to run more than once.

-- ------------------------------------------------------------------ ingest runs

create table if not exists ingest_runs (
  id              bigint generated always as identity primary key,
  started_at      timestamptz not null,
  finished_at     timestamptz,
  status          text not null check (status in ('running', 'ok', 'partial', 'error')),
  trigger         text not null default 'manual',        -- schedule | workflow_dispatch | manual | ...
  scoring_version int not null,
  totals          jsonb not null default '{}'::jsonb      -- new / changed / unchanged / gone / per source
);
create index if not exists ingest_runs_ok_finished_idx
  on ingest_runs (finished_at desc) where status in ('ok', 'partial');

create table if not exists source_runs (
  run_id      bigint not null references ingest_runs (id) on delete cascade,
  source_id   text not null,
  name        text not null,
  category    text not null default 'Otros',
  status      text not null check (status in ('ok', 'partial', 'error')),
  count       int not null default 0,
  note        text not null default '',
  url         text not null default '',
  started_at  timestamptz,
  finished_at timestamptz,
  error       text,
  primary key (run_id, source_id)
);
create index if not exists source_runs_source_idx on source_runs (source_id, run_id desc);

-- ------------------------------------------------------------------ opportunities

create table if not exists opportunities (
  id              text primary key,                       -- `${source}:${nativeId}`
  source          text not null,
  kind            text not null,
  titulo          text not null,
  organismo       text not null default '',
  region          text,
  nivel_admin     text,
  deadline        date,
  opens_at        date,
  budget          numeric,
  url             text not null,
  data            jsonb not null,                         -- full BASE Opportunity
  content_hash    text not null,                          -- sha256 of stable JSON (excludes fit)
  dedupe_key      text,                                   -- BDNS number or normalised title|org|deadline
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),
  gone_at         timestamptz,                            -- set when a healthy run of its source no longer returns it
  tsv tsvector generated always as (
    setweight(to_tsvector('spanish', coalesce(titulo, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(organismo, '')), 'B') ||
    setweight(to_tsvector('spanish', coalesce(data ->> 'summary', '')), 'C')
  ) stored
);
create index if not exists opportunities_tsv_idx on opportunities using gin (tsv);
create index if not exists opportunities_source_idx on opportunities (source);
create index if not exists opportunities_live_idx on opportunities (source) where gone_at is null;
create index if not exists opportunities_deadline_idx on opportunities (deadline);
create index if not exists opportunities_first_seen_idx on opportunities (first_seen_at desc);
create index if not exists opportunities_dedupe_idx on opportunities (dedupe_key);

create table if not exists opportunity_changes (
  id             bigint generated always as identity primary key,
  opportunity_id text not null references opportunities (id) on delete cascade,
  run_id         bigint references ingest_runs (id) on delete set null,
  changed_at     timestamptz not null default now(),
  previous_hash  text,
  new_hash       text not null,
  diff           jsonb not null default '{}'::jsonb      -- { field: { from, to } } for changed top-level fields
);
create index if not exists opportunity_changes_opp_idx on opportunity_changes (opportunity_id, changed_at desc);
create index if not exists opportunity_changes_run_idx on opportunity_changes (run_id);

-- ------------------------------------------------------------------ fetch cache (persisted memo)
-- Raw upstream data that rarely changes (BDNS details, past BOE days/notices) so repeated runs stay
-- cheap and polite. An expired value is still used as a fallback if the refetch fails.

create table if not exists fetch_cache (
  key        text primary key,
  value      jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists fetch_cache_expires_idx on fetch_cache (expires_at);

-- ------------------------------------------------------------------ RLS: deny by default

alter table ingest_runs         enable row level security;
alter table source_runs         enable row level security;
alter table opportunities       enable row level security;
alter table opportunity_changes enable row level security;
alter table fetch_cache         enable row level security;
