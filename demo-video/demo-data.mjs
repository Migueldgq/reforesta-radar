#!/usr/bin/env node
// Demo team state for the video: fictional people (@example.org), a few real calls on the shared board with
// assignees and short notes, and a couple of votes. Everything goes through the app's own API, signed in as the
// demo accounts; only `cleanup` touches the database directly (the API has no "delete user").
//
//   node demo-data.mjs seed      # board + notes + votes (idempotent: resets the on-camera call to «Sin revisar»)
//   node demo-data.mjs cleanup   # deletes the demo accounts and everything they wrote, restores org settings
//
// Accounts: a JSON file outside git, path in DEMO_ACCOUNTS (default demo-video/.demo-accounts.json):
//   { "lucia": { "email": "lucia@example.org", "password": "…" }, "diego": {…}, "marta": {…} }
// Create them first (README → "Demo data"). Env: BASE_URL (default http://localhost:3010).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3010";
const ACCOUNTS = process.env.DEMO_ACCOUNTS ?? path.join(HERE, ".demo-accounts.json");
const SETTINGS_BACKUP = path.join(HERE, "captures", "org-settings-before.json");

/** The call the video marks «En estudio», assigns, annotates and votes on, on camera. */
export const ON_CAMERA = "bdns:926034";

// Who does what. Notes are short, in the team's voice; ids are real calls in the radar.
const BOARD = [
  { id: "bdns:904719", status: "estudio", assignee: "lucia", notes: [["marta", "En 2025 abrió en abril y en 2024 en septiembre: memoria y presupuesto listos antes de primavera."]] },
  { id: "bdns:928403", status: "presentar", assignee: "diego", notes: [["diego", "Encaja con la restauración de riberas. Falta la carta de apoyo del ayuntamiento."]] },
  { id: "bdns:895713", status: "presentar", assignee: "marta", notes: [["lucia", "Revisar el límite de gasto en personal antes de cerrar el presupuesto."]] },
  { id: "bdns:921531", status: "estudio", assignee: "diego", notes: [] },
  { id: "rsc:rsc-unicaja-medioambiente", status: "estudio", assignee: "marta", notes: [["marta", "Solo Andalucía o Ciudad Real: ¿tenemos socio allí?"]] },
  { id: "bdns:930968", status: "descartada", assignee: "lucia", notes: [["lucia", "La ganan propietarios de montes, no ONG. Descartada."]] },
];
const VOTES = [
  ["diego", "bdns:904719", "sirve"],
  ["marta", "bdns:904719", "sirve"],
  ["marta", "bdns:930968", "no_sirve"],
];

export function accounts() {
  if (!existsSync(ACCOUNTS)) throw new Error(`No demo accounts file at ${ACCOUNTS} (set DEMO_ACCOUNTS). See README → "Demo data".`);
  return JSON.parse(readFileSync(ACCOUNTS, "utf8"));
}

async function api(method, p, body, cookie) {
  const r = await fetch(BASE_URL + p, {
    method,
    headers: { "content-type": "application/json", "X-Radar-CSRF": "1", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${text.slice(0, 200)}`);
  return { json, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? null };
}

/** Signs in as a demo person; returns the session cookie ("radar_session=…"). */
export async function login(key) {
  const a = accounts()[key];
  if (!a) throw new Error(`no demo account "${key}"`);
  const { cookie } = await api("POST", "/api/auth/login", { email: a.email, password: a.password });
  return cookie;
}

export async function seed() {
  const who = Object.keys(accounts());
  const ck = Object.fromEntries(await Promise.all(who.map(async (k) => [k, await login(k)])));
  const me = {};
  for (const k of who) me[k] = (await api("GET", "/api/auth/session", null, ck[k])).json.user.id;

  // On-camera call back to «Sin revisar», unassigned, no notes, no vote from Lucía.
  const board = (await api("GET", "/api/board", null, ck.lucia)).json.items;
  const cam = board.find((i) => i.opportunityId === ON_CAMERA);
  if (cam) {
    for (const n of cam.notes) await api("DELETE", `/api/board/${encodeURIComponent(ON_CAMERA)}/notes/${n.id}`, null, ck.lucia);
    await api("PATCH", `/api/board/${encodeURIComponent(ON_CAMERA)}`, { status: "nueva", assigneeId: null }, ck.lucia);
  }
  await api("DELETE", `/api/votes/${encodeURIComponent(ON_CAMERA)}`, null, ck.lucia).catch(() => {});

  for (const b of BOARD) {
    const enc = encodeURIComponent(b.id);
    const by = b.notes[0]?.[0] ?? b.assignee;
    await api("PATCH", `/api/board/${enc}`, { status: b.status, assigneeId: me[b.assignee] }, ck[by]);
    const have = board.find((i) => i.opportunityId === b.id)?.notes.map((n) => n.body) ?? [];
    for (const [author, body] of b.notes) if (!have.includes(body)) await api("POST", `/api/board/${enc}/notes`, { body }, ck[author]);
  }
  for (const [k, id, vote] of VOTES) await api("PUT", `/api/votes/${encodeURIComponent(id)}`, { vote }, ck[k]);
  console.log(`seeded: ${BOARD.length} calls on the board, ${VOTES.length} votes; ${ON_CAMERA} reset to «Sin revisar»`);
}

/* ---------- database (cleanup only) ---------- */
function psql(sql) {
  return execFileSync("docker", ["compose", "exec", "-T", "postgres", "psql", "-U", "radar", "-d", "radar", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql], {
    cwd: path.join(HERE, ".."),
    encoding: "utf8",
  }).trim();
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Saves org_settings once, before the first seed, so cleanup can put it back. */
export function backupSettings() {
  if (existsSync(SETTINGS_BACKUP)) return;
  writeFileSync(SETTINGS_BACKUP, psql("select row_to_json(o) from org_settings o where id = 1") || "null");
}

function cleanup() {
  const emails = Object.values(accounts()).map((a) => a.email.toLowerCase());
  if (!emails.every((e) => e.endsWith("@example.org"))) throw new Error("refusing: demo accounts must be @example.org");
  const ids = `(select id from users where lower(email) in (${emails.map(lit).join(",")}))`;
  // Only the calls this script puts on the board, and only while a demo account last touched them or owns them.
  const calls = [...BOARD.map((b) => b.id), ON_CAMERA].map(lit).join(",");
  // Organisation settings go back to the saved copy only where a demo account made the last change (FKs are
  // ON DELETE SET NULL, so read this before deleting the accounts).
  const touched = psql(`select (profile_updated_by in ${ids})::int || ',' || (organisms_updated_by in ${ids})::int from org_settings where id = 1`)
    .split(",")
    .map((x) => x === "1");
  const out = psql(`begin;
    delete from tracking_notes where author_id in ${ids};
    delete from tracking where opportunity_id in (${calls}) and (updated_by in ${ids} or assignee_id in ${ids});
    delete from invitations where created_by in ${ids} or lower(email) in (${emails.map(lit).join(",")});
    delete from password_resets where created_by in ${ids} or user_id in ${ids};
    delete from users where id in ${ids};
    commit;
    select count(*) from users where lower(email) in (${emails.map(lit).join(",")});`);
  console.log(`demo accounts left: ${out.split("\n").at(-1)} (sessions, tokens, votes and resets go with them)`);
  const before = existsSync(SETTINGS_BACKUP) ? JSON.parse(readFileSync(SETTINGS_BACKUP, "utf8")) : null;
  const j = (v) => (v == null ? "null" : `${lit(JSON.stringify(v))}::jsonb`);
  const v = (x) => (x == null ? "null" : lit(x));
  if (before && touched[0]) {
    psql(`update org_settings set profile = ${j(before.profile)}, profile_updated_by = ${v(before.profile_updated_by)},
      profile_updated_at = ${v(before.profile_updated_at)}, updated_by = ${v(before.updated_by)}, updated_at = ${v(before.updated_at)} where id = 1`);
    console.log("team profile restored from", path.relative(HERE, SETTINGS_BACKUP));
  } else console.log("team profile: not changed by a demo account, left as it is");
  if (before && touched[1]) {
    psql(`update org_settings set organisms = ${j(before.organisms)}, organisms_updated_by = ${v(before.organisms_updated_by)},
      organisms_updated_at = ${v(before.organisms_updated_at)} where id = 1`);
    console.log("organism filter restored from", path.relative(HERE, SETTINGS_BACKUP));
  } else console.log("organism filter: not changed by a demo account, left as it is");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === "seed") {
    backupSettings();
    await seed();
  } else if (cmd === "cleanup") cleanup();
  else console.log("usage: node demo-data.mjs seed | cleanup");
}
