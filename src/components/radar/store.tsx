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
import { api, errorText } from "@/lib/api";
import type { OpportunitiesResponse, Opportunity } from "@/lib/opportunity";
import type { BoardItem, Note, PersonRef, TeamPerson } from "@/lib/team";
import { useSession } from "@/components/auth/session";
import { DEFAULT_FILTERS, filtersFromUrl, noOpenHighFit, urlPinsAhora, withPlazoView, type Filters, type Triage } from "./model";
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
    return { data: await api<Payload>("/api/oportunidades") };
  } catch (e) {
    return { error: errorText(e) };
  }
}

/* ---------- Team board (shared through the API) ---------- */

export type Board = Record<string, BoardItem>;
type Snapshot = Pick<Opportunity, "id" | "titulo" | "organismo" | "deadline"> & Partial<Pick<Opportunity, "source" | "url">>;
/** Fields changed locally and not yet confirmed by the API, laid over every refetch until they are. */
type Pending = { patch: Partial<BoardItem>; count: number };

const TEAM_POLL_MS = 60_000;

function boardPath(id: string, rest = "") {
  return `/api/board/${encodeURIComponent(id)}${rest}`;
}

/** Enough of an Opportunity to draw a card from the board's snapshot when the call is gone from the sources. */
export function stub(e: BoardItem): Opportunity {
  return {
    id: e.opportunityId,
    titulo: e.titulo,
    organismo: e.organismo,
    deadline: e.deadline,
    source: e.source,
    url: e.url,
  } as Opportunity;
}

export type Notice = { id: number; text: string; tone: "info" | "error" };

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

  /** The team's board: one row per call someone triaged, assigned or wrote a note on. */
  board: Board;
  boardLoaded: boolean;
  /** Everyone, for names and the assignee picker (inactive people stay for old notes). */
  people: TeamPerson[];
  triageOf: (id: string) => Triage;
  setTriage: (o: Snapshot, status: Triage) => void;
  setAssignee: (o: Snapshot, person: PersonRef | null) => void;
  addNote: (o: Snapshot, body: string) => Promise<boolean>;
  deleteNote: (id: string, noteId: number) => void;

  notices: Notice[];
  notify: (text: string, tone?: Notice["tone"]) => void;
  dismiss: (id: number) => void;

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
  const { me } = useSession();
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

  // When nothing open fits well, open on "Próximas ediciones". Decided once, on the first data, unless the URL names a tab,
  // so later refreshes or filter changes never move the user to another tab.
  const toNextEditions = useRef<boolean | null>(null);
  const decideNextEditions = useCallback((items: Opportunity[]): boolean => {
    toNextEditions.current ??= noOpenHighFit(applyProfileAll(items, loadProfile()));
    return toNextEditions.current;
  }, []);

  // Fetch, store the payload for instant paint next time, and re-poll while the server says it is refreshing.
  const fetchData = useCallback((): Promise<void> => {
    return request().then((r) => {
      if (r.data) {
        setData(r.data);
        writePayload(r.data);
        if (toNextEditions.current == null && decideNextEditions(r.data.items)) setFilters((f) => withPlazoView(f, "ediciones"));
      }
      setError(r.error ?? null);
      setLoading(false);
      const again = r.data?.refreshing === true;
      setRefreshing(again);
      if (pollRef.current) clearTimeout(pollRef.current);
      if (again) pollRef.current = setTimeout(() => void fetchRef.current?.(), 6000);
    });
  }, [decideNextEditions]);

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
      if (!init.hideClosed || init.dims.plazo.length || urlPinsAhora()) toNextEditions.current = false;
      const start = { ...init, dims: { ...init.dims, organismo } };
      // Idempotent: Strict Mode runs this twice, and the second run must not undo the first decision.
      setFilters(cached && decideNextEditions(cached.items) ? withPlazoView(start, "ediciones") : start);
      orgsLoaded.current = true;
    });
    void fetchData();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [fetchData, decideNextEditions]);

  useEffect(() => {
    if (orgsLoaded.current) writeOrgs(filters.dims.organismo);
  }, [filters.dims.organismo]);

  const reload = useCallback(() => {
    if (data) setRefreshing(true);
    else setLoading(true);
    setError(null);
    void fetchData();
  }, [data, fetchData]);

  /* ----- Notices (small toasts) ----- */

  const [notices, setNotices] = useState<Notice[]>([]);
  const noticeId = useRef(0);
  const dismiss = useCallback((id: number) => setNotices((ns) => ns.filter((n) => n.id !== id)), []);
  const notify = useCallback(
    (text: string, tone: Notice["tone"] = "info") => {
      const id = ++noticeId.current;
      setNotices((ns) => [...ns.filter((n) => n.text !== text), { id, text, tone }].slice(-3));
      setTimeout(() => dismiss(id), tone === "error" ? 9000 : 12000);
    },
    [dismiss],
  );

  /* ----- Team board ----- */

  const [board, setBoard] = useState<Board>({});
  const [boardLoaded, setBoardLoaded] = useState(false);
  const [people, setPeople] = useState<TeamPerson[]>([]);
  const pending = useRef(new Map<string, Pending>());

  const withPending = useCallback((items: BoardItem[]): Board => {
    const next: Board = {};
    for (const it of items) next[it.opportunityId] = it;
    for (const [id, p] of pending.current) if (next[id]) next[id] = { ...next[id], ...p.patch };
    return next;
  }, []);

  const refreshBoard = useCallback(async () => {
    try {
      const r = await api<{ items: BoardItem[] }>("/api/board");
      setBoard((prev) => {
        const next = withPending(r.items);
        // Keep optimistic rows the server does not have yet (first write on a call still in flight).
        for (const id of pending.current.keys()) if (!next[id] && prev[id]) next[id] = prev[id];
        return next;
      });
      setBoardLoaded(true);
    } catch {
      /* keep what we have; the next poll retries (a 401 already went to the login page) */
    }
  }, [withPending]);

  const refreshPeople = useCallback(async () => {
    try {
      setPeople((await api<{ users: TeamPerson[] }>("/api/users")).users);
    } catch {
      /* names fall back to what the board rows carry */
    }
  }, []);

  const refreshTeam = useCallback(() => Promise.all([refreshBoard(), refreshPeople()]).then(() => undefined), [refreshBoard, refreshPeople]);

  // Load once, then every minute and whenever the tab comes back, so colleagues' changes show up.
  useEffect(() => {
    let last = 0;
    const run = () => {
      last = Date.now();
      void refreshTeam();
    };
    run();
    const t = setInterval(() => document.visibilityState === "visible" && run(), TEAM_POLL_MS);
    const onFocus = () => Date.now() - last > 5000 && run();
    const onVis = () => document.visibilityState === "visible" && onFocus();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshTeam]);

  const triageOf = useCallback((id: string): Triage => board[id]?.status ?? "nueva", [board]);

  const boardRef = useRef(board);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  /** A row to draw before the API answers, for a call that is not on the board yet. */
  const placeholder = useCallback(
    (o: Snapshot): BoardItem => ({
      opportunityId: o.id,
      status: "nueva",
      assignee: null,
      notes: [],
      titulo: o.titulo,
      organismo: o.organismo,
      source: o.source ?? "",
      url: o.url ?? "",
      deadline: o.deadline,
      gone: false,
      updatedBy: { id: me.id, name: me.name },
      updatedAt: new Date().toISOString(),
    }),
    [me],
  );

  /** Optimistic PATCH: draw the change now, confirm with the API's row, roll back and say so if it fails. */
  const patchItem = useCallback(
    (o: Snapshot, patch: Partial<BoardItem>, body: Record<string, unknown>, failMsg: string) => {
      const id = o.id;
      const prev = boardRef.current[id];
      const p = pending.current.get(id) ?? { patch: {}, count: 0 };
      pending.current.set(id, { patch: { ...p.patch, ...patch }, count: p.count + 1 });
      setBoard((b) => ({ ...b, [id]: { ...(b[id] ?? placeholder(o)), ...patch, updatedBy: { id: me.id, name: me.name }, updatedAt: new Date().toISOString() } }));

      const settle = () => {
        const cur = pending.current.get(id);
        if (!cur || cur.count <= 1) pending.current.delete(id);
        else pending.current.set(id, { ...cur, count: cur.count - 1 });
        return pending.current.get(id);
      };
      api<BoardItem>(boardPath(id), { method: "PATCH", json: body })
        .then((item) => {
          const still = settle();
          setBoard((b) => ({ ...b, [id]: still ? { ...item, ...still.patch } : item }));
        })
        .catch((e) => {
          settle();
          setBoard((b) => {
            const next = { ...b };
            if (prev) next[id] = prev;
            else delete next[id];
            return next;
          });
          notify(`${failMsg} ${errorText(e)}`, "error");
          void refreshBoard();
        });
    },
    [me, notify, placeholder, refreshBoard],
  );

  const setTriage = useCallback<RadarState["setTriage"]>(
    (o, status) => patchItem(o, { status }, { status }, "No se ha guardado el estado."),
    [patchItem],
  );

  const setAssignee = useCallback<RadarState["setAssignee"]>(
    (o, person) => patchItem(o, { assignee: person }, { assigneeId: person?.id ?? null }, "No se ha guardado el responsable."),
    [patchItem],
  );

  const addNote = useCallback<RadarState["addNote"]>(
    async (o, body) => {
      try {
        const note = await api<Note>(boardPath(o.id, "/notes"), { json: { body } });
        setBoard((b) => {
          const it = b[o.id] ?? placeholder(o);
          return { ...b, [o.id]: { ...it, notes: [...it.notes.filter((n) => n.id !== note.id), note] } };
        });
        void refreshBoard();
        return true;
      } catch (e) {
        notify(`No se ha guardado la nota. ${errorText(e)}`, "error");
        return false;
      }
    },
    [notify, placeholder, refreshBoard],
  );

  const deleteNote = useCallback<RadarState["deleteNote"]>(
    (id, noteId) => {
      const prev = boardRef.current[id];
      if (!prev) return;
      setBoard((b) => ({ ...b, [id]: { ...prev, notes: prev.notes.filter((n) => n.id !== noteId) } }));
      api(boardPath(id, `/notes/${noteId}`), { method: "DELETE" }).catch((e) => {
        setBoard((b) => ({ ...b, [id]: { ...(b[id] ?? prev), notes: prev.notes } }));
        notify(`No se ha borrado la nota. ${errorText(e)}`, "error");
      });
    },
    [notify],
  );

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
      board,
      boardLoaded,
      people,
      triageOf,
      setTriage,
      setAssignee,
      addNote,
      deleteNote,
      notices,
      notify,
      dismiss,
      filters,
      setFilters,
      selectedId,
      openDetail: setSelectedId,
      closeDetail: () => setSelectedId(null),
    }),
    [data, rawData, profile, loading, refreshing, error, reload, byId, board, boardLoaded, people, triageOf, setTriage, setAssignee, addNote, deleteNote, notices, notify, dismiss, filters, selectedId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
