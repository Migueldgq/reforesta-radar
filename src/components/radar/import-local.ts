/**
 * First login in a browser that used the radar before accounts: hand what it kept in localStorage
 * (tracking, Perfil, organisms) to the team once, then forget it. The API's merge rule keeps whatever
 * the team already saved, so running this again, or from several browsers, changes nothing.
 */
import { api } from "@/lib/api";
import { joinEs } from "./model";
import { isNeutral, parseProfile, PROFILE_KEY } from "./profile";

const TRACKING_KEY = "reforesta-radar:seguimiento:v1";
const ORGS_KEY = "reforesta-radar:organismos:v1";
const MAX_TRACKING = 2000;
const KEYS = [TRACKING_KEY, PROFILE_KEY, ORGS_KEY];

type ImportResult = {
  trackingImported: number;
  trackingKept: number;
  /** Calls the radar never saw: not imported. */
  trackingSkipped?: number;
  profile: "imported" | "kept" | "none";
  organisms: "imported" | "kept" | "none";
};

function read(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function forget() {
  try {
    for (const k of KEYS) window.localStorage.removeItem(k);
  } catch {
    /* storage unavailable: nothing to forget */
  }
}

function message(r: ImportResult): string | null {
  const parts: string[] = [];
  if (r.trackingImported > 0) parts.push(r.trackingImported === 1 ? "1 convocatoria en seguimiento" : `${r.trackingImported} convocatorias en seguimiento`);
  if (r.profile === "imported") parts.push("el perfil");
  if (r.organisms === "imported") parts.push("los organismos elegidos");
  const skipped = r.trackingSkipped ?? 0;
  const tail =
    skipped > 0 ? ` ${skipped === 1 ? "1 convocatoria ya no estaba en el radar y no se ha pasado" : `${skipped} convocatorias ya no estaban en el radar y no se han pasado`}.` : "";
  if (parts.length) return `Hemos pasado a la cuenta del equipo lo que tenías guardado en este navegador: ${joinEs(parts)}.${tail}`;
  if (r.trackingKept > 0 || r.profile === "kept" || r.organisms === "kept")
    return `Lo que tenías guardado en este navegador ya estaba en la cuenta del equipo, así que no hemos cambiado nada.${tail}`;
  if (tail) return `No hemos pasado nada a la cuenta del equipo:${tail}`;
  return null;
}

async function run(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const tracking = read(TRACKING_KEY);
  const profile = read(PROFILE_KEY);
  const organisms = read(ORGS_KEY);
  if (tracking === undefined && profile === undefined && organisms === undefined) return null;

  const body: Record<string, unknown> = {};
  if (tracking && typeof tracking === "object" && !Array.isArray(tracking)) {
    // The API takes at most 2000 entries; "nueva" entries are never imported anyway.
    const entries = Object.entries(tracking as Record<string, { status?: unknown }>)
      .filter(([, e]) => e && typeof e === "object" && e.status !== "nueva")
      .slice(0, MAX_TRACKING);
    if (entries.length) body.tracking = Object.fromEntries(entries);
  }
  if (profile !== undefined) {
    const p = parseProfile(profile);
    if (!isNeutral(p)) body.profile = p;
  }
  if (Array.isArray(organisms)) {
    const orgs = organisms.filter((x): x is string => typeof x === "string" && !!x.trim());
    if (orgs.length) body.organisms = orgs;
  }
  if (Object.keys(body).length === 0) {
    forget();
    return null;
  }
  // On failure the keys stay, so the next visit tries again.
  const r = await api<ImportResult>("/api/import", { json: body });
  forget();
  return message(r);
}

let once: Promise<string | null> | null = null;

/** Runs at most once per page load (Strict Mode mounts twice); resolves to the line to show, or null. */
export function importLocalState(): Promise<string | null> {
  once ??= run().catch(() => null);
  return once;
}
