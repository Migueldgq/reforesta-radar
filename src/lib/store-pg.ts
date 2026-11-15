// All SQL for the Postgres store lives here (schema: supabase/migrations/0001_init.sql).
//  - readState(): the web read path (base items + latest source health + last successful ingest)
//  - writeIngest(): one transaction per ingest run (upsert + change log + gone + run records + fetch cache)
import { createHash } from "crypto";
import type { PersistedMemo } from "./cache";
import { sql } from "./db";
import type { Opportunity } from "./opportunity";
import { normalizeText } from "./scoring";
import type { SourceHealth } from "./types";

// ---------------------------------------------------------------- hashing + dedupe

/** JSON with sorted keys, so the hash does not depend on property order. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * Hash of what the SOURCE says. `fit` is excluded: it holds volatile values (daysRemaining, "quedan N días")
 * and changes with every scoring tweak, neither of which is a change to the opportunity itself.
 */
export function contentHash(o: Opportunity): string {
  const { fit: _fit, firstSeenAt: _seen, ...content } = o; // eslint-disable-line @typescript-eslint/no-unused-vars
  return createHash("sha256").update(stableJson(content)).digest("hex");
}

/** BDNS number when the text cites one, else normalised title|organism|deadline. */
export function dedupeKey(o: Opportunity): string {
  if (o.source === "bdns") return `bdns:${o.id.slice(5)}`;
  const text = `${o.titulo} ${o.summary ?? ""} ${o.url}`;
  const m = text.match(/\bBDNS\b[^0-9]{0,25}(\d{5,7})\b/i) ?? o.url.match(/convocatorias\/(\d{5,7})\b/);
  if (m) return `bdns:${m[1]}`;
  return `t:${normalizeText(o.titulo).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 120)}|${normalizeText(o.organismo).slice(0, 60)}|${o.deadline ?? ""}`;
}

// ---------------------------------------------------------------- read path

export interface PgState {
  items: Opportunity[];
  sources: SourceHealth[];
  lastIngestAt: string | null;
}

export async function readState(): Promise<PgState> {
  const db = sql();
  const [rows, health, last] = await Promise.all([
    db<{ data: Opportunity; first_seen_at: Date }[]>`
      select data, first_seen_at from opportunities where gone_at is null`,
    db<(SourceHealth & { error: string | null; finished_at: Date | null; last_ok_at: Date | null; live: number })[]>`
      select distinct on (s.source_id)
        s.source_id as id, s.name, s.status, s.count, s.note, s.error, s.finished_at,
        -- a failed run has no category/url of its own: take them from the last run that worked
        coalesce((select s3.category from source_runs s3 where s3.source_id = s.source_id and s3.status <> 'error'
                  order by s3.run_id desc limit 1), s.category) as category,
        coalesce((select s3.url from source_runs s3 where s3.source_id = s.source_id and s3.status <> 'error'
                  order by s3.run_id desc limit 1), s.url) as url,
        (select max(s2.finished_at) from source_runs s2 where s2.source_id = s.source_id and s2.status <> 'error') as last_ok_at,
        (select count(*)::int from opportunities o where o.source = s.source_id and o.gone_at is null) as live
      from source_runs s
      order by s.source_id, s.run_id desc`,
    db<{ at: Date | null }[]>`
      select max(finished_at) as at from ingest_runs where status in ('ok', 'partial')`,
  ]);

  const items = rows.map((r) => ({ ...r.data, firstSeenAt: r.first_seen_at.toISOString() }));
  const sources: SourceHealth[] = health.map((h) => {
    const base: SourceHealth = { id: h.id, name: h.name, category: h.category, status: h.status, count: h.count, url: h.url, note: h.note };
    if (h.status !== "error" || h.live === 0) return base;
    // Failed in the last run but earlier rows are still served: say so, like the cache path does.
    const when = h.last_ok_at ? ` del ${h.last_ok_at.toISOString().slice(0, 16).replace("T", " ")} UTC` : "";
    return { ...base, status: "partial", count: h.live, note: `Mostrando datos de la última ingesta correcta${when}; la última falló (${h.error ?? h.note}).` };
  });
  return { items, sources, lastIngestAt: last[0]?.at ? last[0].at.toISOString() : null };
}

// ---------------------------------------------------------------- write path

export async function loadFetchCache(): Promise<PersistedMemo[]> {
  const rows = await sql()<{ key: string; value: unknown; expires_at: Date }[]>`
    select key, value, expires_at from fetch_cache`;
  return rows.map((r) => ({ key: r.key, value: r.value, expiresAt: r.expires_at.getTime() }));
}

export interface SourceRunInput {
  health: SourceHealth;
  items: Opportunity[];
  startedAt: Date;
  finishedAt: Date;
  error: string | null;
}

export interface SourceDiff { new: number; changed: number; unchanged: number; gone: number }

export interface IngestInput {
  startedAt: Date;
  trigger: string;
  scoringVersion: number;
  sources: SourceRunInput[];
  memo: PersistedMemo[];
  dryRun: boolean;
  /** Every source id the app still has; live rows of any other source are marked gone. */
  registered: string[];
}

export interface IngestResult {
  runId: string | null;
  status: "ok" | "partial" | "error";
  perSource: Record<string, SourceDiff>;
  changedFields: Record<string, number>;
  duplicateGroups: { key: string; ids: string[] }[];
  /** Rows marked gone because their source is no longer registered, per source. */
  retired: Record<string, number>;
}

/** A malformed date from a scraper must not abort the whole transaction: keep it in `data`, null the column. */
function isoDate(s: string | null | undefined): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().startsWith(s) ? s : null;
}

const CHUNK = 400;
function chunks<T>(a: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

function topLevelDiff(prev: Opportunity, next: Opportunity) {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    if (k === "fit" || k === "firstSeenAt") continue;
    const a = (prev as unknown as Record<string, unknown>)[k];
    const b = (next as unknown as Record<string, unknown>)[k];
    if (stableJson(a) !== stableJson(b)) diff[k] = { from: a ?? null, to: b ?? null };
  }
  return diff;
}

export function runStatus(sources: SourceRunInput[]): IngestResult["status"] {
  const ok = sources.filter((s) => s.health.status !== "error").length;
  if (ok === 0) return "error";
  return sources.every((s) => s.health.status === "ok") ? "ok" : "partial";
}

/**
 * One transaction: upsert every item of every source that did not fail, log content changes, mark as gone
 * what a fully healthy ("ok") source no longer returns, record the run. A failed source's rows are untouched.
 * With dryRun the same diff is computed and nothing is written.
 */
export async function writeIngest(input: IngestInput): Promise<IngestResult> {
  const now = new Date();
  const status = runStatus(input.sources);
  const perSource: Record<string, SourceDiff> = {};
  const changedFields: Record<string, number> = {};

  const live = input.sources.filter((s) => s.health.status !== "error");
  const okIds = input.sources.filter((s) => s.health.status === "ok").map((s) => s.health.id);
  const all = live.flatMap((s) => s.items);
  const ids = all.map((o) => o.id);

  const result = await sql().begin(async (tx) => {
    const prevRows: { id: string; content_hash: string; data: Opportunity; gone_at: Date | null }[] = [];
    for (const part of chunks(ids, 2000)) {
      prevRows.push(...(await tx<typeof prevRows>`
        select id, content_hash, data, gone_at from opportunities where id = any(${part})`));
    }
    const prev = new Map(prevRows.map((r) => [r.id, r]));

    // Classify
    const rows: Record<string, unknown>[] = [];
    const changes: { opportunity_id: string; previous_hash: string; new_hash: string; diff: Record<string, unknown> }[] = [];
    for (const s of live) {
      const d: SourceDiff = (perSource[s.health.id] = { new: 0, changed: 0, unchanged: 0, gone: 0 });
      for (const o of s.items) {
        const hash = contentHash(o);
        const p = prev.get(o.id);
        if (!p) d.new++;
        else if (p.content_hash !== hash) {
          d.changed++;
          const diff = topLevelDiff(p.data, o);
          for (const k of Object.keys(diff)) changedFields[k] = (changedFields[k] ?? 0) + 1;
          changes.push({ opportunity_id: o.id, previous_hash: p.content_hash, new_hash: hash, diff });
        } else d.unchanged++;
        rows.push({
          id: o.id,
          source: o.source,
          kind: o.kind,
          titulo: o.titulo,
          organismo: o.organismo ?? "",
          region: o.region ?? null,
          nivel_admin: o.nivelAdmin ?? null,
          deadline: isoDate(o.deadline),
          opens_at: isoDate(o.opensAt),
          budget: typeof o.budget === "number" && Number.isFinite(o.budget) ? o.budget : null,
          url: o.url,
          data: o,
          content_hash: hash,
          dedupe_key: dedupeKey(o),
          first_seen_at: now,
          last_seen_at: now,
          last_changed_at: now,
        });
      }
    }
    for (const s of input.sources) perSource[s.health.id] ??= { new: 0, changed: 0, unchanged: 0, gone: 0 };

    // Gone: only for sources whose run was fully "ok" (never on error or partial).
    const seen = new Set(ids);
    const goneRows = okIds.length
      ? (await tx<{ id: string; source: string }[]>`
          select id, source from opportunities where gone_at is null and source = any(${okIds})`).filter((r) => !seen.has(r.id))
      : [];
    for (const r of goneRows) perSource[r.source].gone++;

    // Sources removed from the app: their rows would otherwise stay live forever.
    const retiredRows = await tx<{ id: string; source: string }[]>`
      select id, source from opportunities where gone_at is null and source <> all(${input.registered})`;
    const retired: Record<string, number> = {};
    for (const r of retiredRows) retired[r.source] = (retired[r.source] ?? 0) + 1;

    // Candidate duplicates among the items seen in this run (reported only, never merged in this tranche).
    const keyed = new Map<string, string[]>();
    for (const r of rows) {
      const k = r.dedupe_key as string;
      keyed.set(k, [...(keyed.get(k) ?? []), r.id as string]);
    }
    const duplicateGroups = Array.from(keyed, ([key, group]) => ({ key, ids: group })).filter((g) => g.ids.length > 1);

    if (input.dryRun) return { runId: null, duplicateGroups, retired };

    const [run] = await tx<{ id: string }[]>`
      insert into ingest_runs (started_at, finished_at, status, trigger, scoring_version, totals)
      values (${input.startedAt}, ${now}, ${status}, ${input.trigger}, ${input.scoringVersion},
              ${tx.json({ perSource, changedFields, items: rows.length, duplicateGroups: duplicateGroups.length, retired } as never)})
      returning id`;

    for (const part of chunks(rows)) {
      await tx`
        insert into opportunities ${tx(part as never, "id", "source", "kind", "titulo", "organismo", "region", "nivel_admin", "deadline", "opens_at", "budget", "url", "data", "content_hash", "dedupe_key", "first_seen_at", "last_seen_at", "last_changed_at")}
        on conflict (id) do update set
          source = excluded.source, kind = excluded.kind, titulo = excluded.titulo, organismo = excluded.organismo,
          region = excluded.region, nivel_admin = excluded.nivel_admin, deadline = excluded.deadline,
          opens_at = excluded.opens_at, budget = excluded.budget, url = excluded.url, data = excluded.data,
          dedupe_key = excluded.dedupe_key, last_seen_at = excluded.last_seen_at, gone_at = null,
          last_changed_at = case when opportunities.content_hash is distinct from excluded.content_hash
                                 then excluded.last_changed_at else opportunities.last_changed_at end,
          content_hash = excluded.content_hash`;
    }
    for (const part of chunks(changes)) {
      await tx`insert into opportunity_changes ${tx(part.map((c) => ({ ...c, run_id: run.id, changed_at: now })) as never, "opportunity_id", "run_id", "changed_at", "previous_hash", "new_hash", "diff")}`;
    }
    for (const part of chunks([...goneRows, ...retiredRows].map((r) => r.id), 2000)) {
      await tx`update opportunities set gone_at = ${now} where id = any(${part})`;
    }
    await tx`insert into source_runs ${tx(
      input.sources.map((s) => ({
        run_id: run.id,
        source_id: s.health.id,
        name: s.health.name,
        category: s.health.category,
        status: s.health.status,
        count: s.items.length,
        note: s.health.note,
        url: s.health.url,
        started_at: s.startedAt,
        finished_at: s.finishedAt,
        error: s.error,
      })) as never,
      "run_id", "source_id", "name", "category", "status", "count", "note", "url", "started_at", "finished_at", "error"
    )}`;
    for (const part of chunks(input.memo)) {
      await tx`
        insert into fetch_cache ${tx(part.map((m) => ({ key: m.key, value: m.value, expires_at: new Date(m.expiresAt), updated_at: now })) as never, "key", "value", "expires_at", "updated_at")}
        on conflict (key) do update set value = excluded.value, expires_at = excluded.expires_at, updated_at = excluded.updated_at`;
    }
    // Keep the memo table bounded: drop entries expired for more than 30 days.
    await tx`delete from fetch_cache where expires_at < now() - interval '30 days'`;
    return { runId: run.id, duplicateGroups, retired };
  });

  return { runId: result.runId, status, perSource, changedFields, duplicateGroups: result.duplicateGroups, retired: result.retired };
}

/** Best-effort record of a run whose main transaction failed, so the app's health view shows it. */
export async function recordFailedRun(startedAt: Date, trigger: string, scoringVersion: number, error: string) {
  await sql()`
    insert into ingest_runs (started_at, finished_at, status, trigger, scoring_version, totals)
    values (${startedAt}, ${new Date()}, 'error', ${trigger}, ${scoringVersion}, ${sql().json({ error } as never)})`;
}
