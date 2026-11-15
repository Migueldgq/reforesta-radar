"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { OpportunitiesResponse, Opportunity } from "@/lib/opportunity";
import { DEFAULT_FILTERS, filtersFromUrl, type Filters, type Triage } from "./model";
import { applyProfileAll, DEFAULT_USER_PROFILE, isNeutral, loadProfile, saveProfile, subscribeProfile, type UserProfile } from "./profile";

/* ---------- Last payload cached for instant paint ---------- */

type Payload = OpportunitiesResponse & { stale?: boolean; refreshing?: boolean };
const PAYLOAD_KEY = "reforesta-radar:payload:v1";

function readPayload(): Payload | null {
  try {
    const raw = window.localStorage.getItem(PAYLOAD_KEY);
    return raw ? (JSON.parse(raw) as Payload) : null;
  } catch {
    return null;
  }
}

function writePayload(p: Payload) {
  try {
    window.localStorage.setItem(PAYLOAD_KEY, JSON.stringify(p));
  } catch {
    /* quota or disabled storage: ignore */
  }
}

/* ---------- Triage persisted in localStorage ---------- */

export interface TriageEntry {
  status: Triage;
  at: string;
  titulo: string;
  organismo: string;
  deadline: string | null;
}
type TriageMap = Record<string, TriageEntry>;

const KEY = "reforesta-radar:seguimiento:v1";
const EMPTY: TriageMap = {};
let cache: TriageMap | null = null;
const listeners = new Set<() => void>();

function readTriage(): TriageMap {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as TriageMap) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function writeTriage(next: TriageMap) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: keep in memory */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      l();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

/* ---------- Chosen convening bodies (Organismo filter) persisted in localStorage ---------- */

const ORGS_KEY = "reforesta-radar:organismos:v1";

function readOrgs(): string[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(ORGS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeOrgs(orgs: string[]) {
  try {
    if (orgs.length) window.localStorage.setItem(ORGS_KEY, JSON.stringify(orgs));
    else window.localStorage.removeItem(ORGS_KEY);
  } catch {
    /* storage unavailable: ignore */
  }
}

async function request(): Promise<{ data?: Payload; error?: string }> {
  try {
    const res = await fetch("/api/oportunidades", { cache: "no-store" });
    if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
    return { data: (await res.json()) as Payload };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error desconocido" };
  }
}

/* ---------- Context ---------- */

interface RadarState {
  /** Server payload with the team's Perfil adjustments applied (what every view should use). */
  data: Payload | null;
  /** Untouched server payload. */
  rawData: Payload | null;
  profile: UserProfile;
  setProfile: (p: UserProfile) => void;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** Re-reads the API. Sources are only fetched by the scheduled ingest. */
  reload: () => void;
  byId: Map<string, Opportunity>;

  triage: TriageMap;
  triageOf: (id: string) => Triage;
  setTriage: (o: Pick<Opportunity, "id" | "titulo" | "organismo" | "deadline">, status: Triage) => void;

  filters: Filters;
  setFilters: (f: Filters | ((prev: Filters) => Filters)) => void;

  selectedId: string | null;
  openDetail: (id: string) => void;
  closeDetail: () => void;
}

const Ctx = createContext<RadarState | null>(null);

export function useRadar(): RadarState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRadar fuera de RadarProvider");
  return v;
}

export function RadarProvider({ children }: { children: ReactNode }) {
  const [rawData, setData] = useState<Payload | null>(null);
  const profile = useSyncExternalStore(subscribeProfile, loadProfile, () => DEFAULT_USER_PROFILE);
  // Always derived from the raw server items, so changing the profile re-ranks without refetching.
  const data = useMemo<Payload | null>(
    () => (rawData && !isNeutral(profile) ? { ...rawData, items: applyProfileAll(rawData.items, profile) } : rawData),
    [rawData, profile],
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchRef = useRef<(() => Promise<void>) | null>(null);
  const orgsLoaded = useRef(false);

  // Fetch, store the payload for instant paint next time, and re-poll while the server says it is refreshing.
  const fetchData = useCallback((): Promise<void> => {
    return request().then((r) => {
      if (r.data) {
        setData(r.data);
        writePayload(r.data);
      }
      setError(r.error ?? null);
      setLoading(false);
      const again = r.data?.refreshing === true;
      setRefreshing(again);
      if (pollRef.current) clearTimeout(pollRef.current);
      if (again) pollRef.current = setTimeout(() => void fetchRef.current?.(), 6000);
    });
  }, []);

  useEffect(() => {
    fetchRef.current = fetchData;
  }, [fetchData]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      const cached = readPayload();
      if (cached) {
        setData(cached);
        setLoading(false);
        setRefreshing(true);
      }
      // Organisms in the URL win; otherwise restore the ones chosen last time.
      const init = filtersFromUrl() ?? DEFAULT_FILTERS;
      const organismo = init.dims.organismo.length ? init.dims.organismo : readOrgs();
      setFilters({ ...init, dims: { ...init.dims, organismo } });
      orgsLoaded.current = true;
    });
    void fetchData();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [fetchData]);

  useEffect(() => {
    if (orgsLoaded.current) writeOrgs(filters.dims.organismo);
  }, [filters.dims.organismo]);

  const reload = useCallback(() => {
    if (data) setRefreshing(true);
    else setLoading(true);
    setError(null);
    void fetchData();
  }, [data, fetchData]);

  const triage = useSyncExternalStore(subscribe, readTriage, () => EMPTY);

  const triageOf = useCallback((id: string): Triage => triage[id]?.status ?? "nueva", [triage]);

  const setTriage = useCallback<RadarState["setTriage"]>((o, status) => {
    const next = { ...readTriage() };
    if (status === "nueva") delete next[o.id];
    else
      next[o.id] = {
        status,
        at: new Date().toISOString(),
        titulo: o.titulo,
        organismo: o.organismo,
        deadline: o.deadline,
      };
    writeTriage(next);
  }, []);

  const byId = useMemo(() => new Map((data?.items ?? []).map((o) => [o.id, o])), [data]);

  const value = useMemo<RadarState>(
    () => ({
      data,
      rawData,
      profile,
      setProfile: saveProfile,
      loading,
      refreshing,
      error,
      reload,
      byId,
      triage,
      triageOf,
      setTriage,
      filters,
      setFilters,
      selectedId,
      openDetail: setSelectedId,
      closeDetail: () => setSelectedId(null),
    }),
    [data, rawData, profile, loading, refreshing, error, reload, byId, triage, triageOf, setTriage, filters, selectedId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
