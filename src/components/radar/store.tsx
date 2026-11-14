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

async function request(force: boolean): Promise<{ data?: Payload; error?: string }> {
  try {
    const res = await fetch(`/api/oportunidades${force ? "?refresh=1" : ""}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
    return { data: (await res.json()) as Payload };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error desconocido" };
  }
}

/* ---------- Context ---------- */

interface RadarState {
  data: Payload | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: (force?: boolean) => void;
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
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchRef = useRef<((force: boolean) => Promise<void>) | null>(null);

  // Fetch, store the payload for instant paint next time, and re-poll while the server says it is refreshing.
  const fetchData = useCallback((force: boolean): Promise<void> => {
    return request(force).then((r) => {
      if (r.data) {
        setData(r.data);
        writePayload(r.data);
      }
      setError(r.error ?? null);
      setLoading(false);
      const again = r.data?.refreshing === true;
      setRefreshing(again);
      if (pollRef.current) clearTimeout(pollRef.current);
      if (again) pollRef.current = setTimeout(() => void fetchRef.current?.(false), 6000);
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
      const init = filtersFromUrl();
      if (init) setFilters(init);
    });
    void fetchData(false);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [fetchData]);

  const reload = useCallback(
    (force = false) => {
      if (data) setRefreshing(true);
      else setLoading(true);
      setError(null);
      void fetchData(force);
    },
    [data, fetchData],
  );

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
    [data, loading, refreshing, error, reload, byId, triage, triageOf, setTriage, filters, selectedId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
