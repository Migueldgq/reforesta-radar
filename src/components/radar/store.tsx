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
import { usePathname } from "next/navigation";
import { api, errorText, serverStatus } from "@/lib/api";
import type { OpportunitiesResponse, Opportunity } from "@/lib/opportunity";
import type { BoardItem, Note, PersonRef, TeamPerson, Vote, VoteValue } from "@/lib/team";
import { useSession } from "@/components/auth/session";
import { importLocalState } from "./import-local";
import {
  DEFAULT_FILTERS,
  filtersFromUrl,
  filtersToQuery,
  noOpenHighFit,
  pageFromUrl,
  plazoViewOf,
  urlPinsAhora,
  withPlazoView,
  type Filters,
  type Triage,
} from "./model";
import { applyProfileAll, DEFAULT_USER_PROFILE, isNeutral, parseProfile, type UserProfile } from "./profile";

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

/**
 * The team's settings (`/api/settings`): one Perfil and one organism filter for everyone. `updatedBy/At` is the
 * last change to either; the per-part fields are newer and may be missing on an older API.
 */
export type TeamSettings = {
  profile: UserProfile | null;
  organisms: string[] | null;
  updatedBy: PersonRef | null;
  updatedAt: string | null;
  profileUpdatedBy?: PersonRef | null;
  profileUpdatedAt?: string | null;
  organismsUpdatedBy?: PersonRef | null;
  organismsUpdatedAt?: string | null;
};

/**
 * Who saved that part last. An older API only sends the shared fields: the Perfil falls back to them; the organism
 * filter does not (they may describe a Perfil change).
 */
export function savedBy(st: TeamSettings | null, part: "profile" | "organisms"): { by: PersonRef | null; at: string } | null {
  if (!st) return null;
  const by = part === "profile" ? st.profileUpdatedBy : st.organismsUpdatedBy;
  const at = part === "profile" ? st.profileUpdatedAt : st.organismsUpdatedAt;
  if (at) return { by: by ?? null, at };
  if (part === "profile" && at === undefined && st.updatedAt) return { by: st.updatedBy, at: st.updatedAt };
  return null;
}
const SAVE_DELAY_MS = 600;
const orgKey = (xs: string[]) => [...xs].sort().join("\u0000");

export type Notice = { id: number; text: string; tone: "info" | "error" };

/* ---------- Context ---------- */

interface RadarState {
  /** Server payload with the team's Perfil adjustments applied (what every view should use). */
  data: Payload | null;
  /** Untouched server payload. */
  rawData: Payload | null;
  /** The team's Perfil (what the API has, or the change being saved). */
  profile: UserProfile;
  /** Applies at once and saves for the whole team shortly after (several quick changes become one save). */
  setProfile: (p: UserProfile) => void;
  settings: TeamSettings | null;
  profileSave: "saving" | "saved" | null;
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

  /** Everyone's "¿Os sirve?" votes. */
  votes: Vote[];
  setVote: (id: string, vote: VoteValue, reason: string) => void;
  clearVote: (id: string) => void;

  notices: Notice[];
  notify: (text: string, tone?: Notice["tone"]) => void;
  dismiss: (id: number) => void;

  filters: Filters;
  /** A user's filter change: also goes back to the first page of results. */
  setFilters: (f: Filters | ((prev: Filters) => Filters)) => void;
  /** The next URL change adds a history entry (a tab or a tile), instead of replacing the current one. */
  markPush: () => void;
  /** Page of results on Inicio (0-based; `?pagina=` is 1-based). */
  page: number;
  setPage: (n: number) => void;
  /** The team's organism filter, as saved (empty when there is none). */
  teamOrgs: string[];

  /** The server cannot be reached: the views show the saved copy and changes are refused. */
  offline: boolean;

  selectedId: string | null;
  /** Opens the drawer (`?c=<id>` in the URL, Back closes it). `opener` gets the focus back on close. */
  openDetail: (id: string, opener?: HTMLElement | null) => void;
  closeDetail: () => void;
  /** The element that opened the drawer, if it is still on the page. */
  detailOpener: () => HTMLElement | null;
}

const Ctx = createContext<RadarState | null>(null);

export function useRadar(): RadarState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRadar fuera de RadarProvider");
  return v;
}

export function RadarProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const path = usePathname();
  const offline = useSyncExternalStore(serverStatus.subscribe, serverStatus.isDown, () => false);
  const [rawData, setData] = useState<Payload | null>(null);
  const [settings, setSettings] = useState<TeamSettings | null>(null);
  // A Perfil change not yet confirmed by the API; it wins over `settings` so the list never jumps back.
  const [draft, setDraft] = useState<UserProfile | null>(null);
  const profile = useMemo(() => draft ?? (settings?.profile ? parseProfile(settings.profile) : DEFAULT_USER_PROFILE), [draft, settings]);
  // Always derived from the raw server items, so changing the profile re-ranks without refetching.
  const data = useMemo<Payload | null>(
    () => (rawData && !isNeutral(profile) ? { ...rawData, items: applyProfileAll(rawData.items, profile) } : rawData),
    [rawData, profile],
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Internal updates (URL, team settings, Back) use the raw setters; the context's `setFilters` is the user's.
  const [filters, setFiltersRaw] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(0);
  const setFilters = useCallback<RadarState["setFilters"]>((f) => {
    setFiltersRaw(f);
    setPage(0);
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  /** True (and says so) when the server is unreachable: changes are refused instead of failing one by one. */
  const blocked = useCallback(() => {
    if (!serverStatus.isDown()) return false;
    notifyRef.current("Sin conexión con el servidor: el cambio no se ha guardado. Prueba otra vez cuando vuelva la conexión.", "error");
    return true;
  }, []);


  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchRef = useRef<(() => Promise<void>) | null>(null);

  // When nothing open fits well, open on "Próximas ediciones". Decided once, when both the calls and the team's
  // Perfil are known, unless the URL names a tab, so later refreshes or filter changes never move the user to another tab.
  const toNextEditions = useRef<boolean | null>(null);
  const latestItems = useRef<Opportunity[] | null>(null);
  const teamProfile = useRef<UserProfile | null>(null);
  const maybeDecide = useCallback(() => {
    if (toNextEditions.current != null || !latestItems.current || !teamProfile.current) return;
    toNextEditions.current = noOpenHighFit(applyProfileAll(latestItems.current, teamProfile.current));
    if (toNextEditions.current) setFiltersRaw((f) => withPlazoView(f, "ediciones"));
  }, []);

  // Fetch, store the payload for instant paint next time, and re-poll while the server says it is refreshing.
  const fetchData = useCallback((): Promise<void> => {
    return request().then((r) => {
      if (r.data) {
        setData(r.data);
        writePayload(r.data);
        latestItems.current = r.data.items;
        maybeDecide();
      }
      setError(r.error ?? null);
      setLoading(false);
      const again = r.data?.refreshing === true;
      setRefreshing(again);
      if (pollRef.current) clearTimeout(pollRef.current);
      // Also while an ingest runs (first run: the list fills in as soon as it finishes).
      if (again || r.data?.ingest?.running) pollRef.current = setTimeout(() => void fetchRef.current?.(), again ? 6000 : 10_000);
    });
  }, [maybeDecide]);

  useEffect(() => {
    fetchRef.current = fetchData;
  }, [fetchData]);

  // Organism filter: the last value known to be the team's (or the URL's, which wins on load). Changes away from it are saved.
  const orgBaseline = useRef<string | null>(null);
  const settingsRef = useRef<TeamSettings | null>(null);
  // URL writes wait until the URL has been read once (else the first render would wipe a shared link).
  const [urlLoaded, setUrlLoaded] = useState(false);

  /** Filters, page and open call from the current URL: on load and on Back/Forward. */
  const readUrl = useCallback(
    (first: boolean) => {
      setSelectedId(new URLSearchParams(window.location.search).get("c"));
      if (window.location.pathname !== "/") return;
      const fromUrl = filtersFromUrl();
      const init: Filters = fromUrl ?? { ...DEFAULT_FILTERS };
      const pinned = !init.hideClosed || init.dims.plazo.length > 0 || urlPinsAhora();
      if (first) {
        if (init.dims.organismo.length) orgBaseline.current = orgKey(init.dims.organismo);
        if (pinned) toNextEditions.current = false;
      } else {
        // The team's organisms are left out of the URL: a link without `organismo` means "the team's filter".
        if (!init.dims.organismo.length) init.dims = { ...init.dims, organismo: settingsRef.current?.organisms ?? [] };
        orgBaseline.current = orgKey(init.dims.organismo);
        if (!pinned && toNextEditions.current) Object.assign(init, withPlazoView(init, "ediciones"));
      }
      setFiltersRaw(init);
      setPage(pageFromUrl());
    },
    [],
  );

  useEffect(() => {
    void Promise.resolve().then(() => {
      const cached = readPayload();
      if (cached) {
        setData(cached);
        setLoading(false);
        setRefreshing(true);
        latestItems.current = cached.items;
      }
      readUrl(true);
      setUrlLoaded(true);
      maybeDecide();
    });
    void fetchData();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [fetchData, maybeDecide, readUrl]);

  /** Applies a settings answer from the API; on the first one, also the team's organisms (unless the URL chose some). */
  const applySettings = useCallback(
    (st: TeamSettings) => {
      setSettings(st);
      settingsRef.current = st;
      teamProfile.current = st.profile ? parseProfile(st.profile) : DEFAULT_USER_PROFILE;
      if (orgBaseline.current == null) {
        const orgs = st.organisms ?? [];
        orgBaseline.current = orgKey(orgs);
        setFiltersRaw((f) => ({ ...f, dims: { ...f.dims, organismo: orgs } }));
      }
      maybeDecide();
    },
    [maybeDecide],
  );

  const orgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const orgs = filters.dims.organismo;
    if (orgBaseline.current == null || orgKey(orgs) === orgBaseline.current) return;
    orgBaseline.current = orgKey(orgs);
    if (orgTimer.current) clearTimeout(orgTimer.current);
    orgTimer.current = setTimeout(() => {
      if (blocked()) return;
      api<TeamSettings>("/api/settings", { method: "PUT", json: { organisms: orgs.length ? orgs : null } })
        .then((st) => {
          setSettings(st);
          settingsRef.current = st;
        })
        .catch((e) => notifyRef.current(`No se ha guardado el filtro de organismos para el equipo. ${errorText(e)}`, "error"));
    }, SAVE_DELAY_MS);
  }, [blocked, filters.dims.organismo]);

  const reload = useCallback(() => {
    if (data) setRefreshing(true);
    else setLoading(true);
    setError(null);
    void fetchData();
  }, [data, fetchData]);

  /* ----- Team Perfil ----- */

  const [profileSave, setProfileSave] = useState<"saving" | "saved" | null>(null);
  const profileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setProfile = useCallback(
    (p: UserProfile) => {
      if (blocked()) return;
      setDraft(p);
      setProfileSave("saving");
      if (profileTimer.current) clearTimeout(profileTimer.current);
      profileTimer.current = setTimeout(() => {
        api<TeamSettings>("/api/settings", { method: "PUT", json: { profile: isNeutral(p) ? null : parseProfile(p) } })
          .then((st) => {
            setSettings(st);
            settingsRef.current = st;
            teamProfile.current = st.profile ? parseProfile(st.profile) : DEFAULT_USER_PROFILE;
            setDraft((d) => (d === p ? null : d));
            setProfileSave((s) => (s === "saving" ? "saved" : s));
            if (savedTimer.current) clearTimeout(savedTimer.current);
            savedTimer.current = setTimeout(() => setProfileSave((s) => (s === "saved" ? null : s)), 2500);
          })
          .catch((e) => {
            setDraft((d) => (d === p ? null : d));
            setProfileSave(null);
            notify(`No se ha guardado el perfil; se ha quedado como estaba. ${errorText(e)}`, "error");
          });
      }, SAVE_DELAY_MS);
    },
    [blocked, notify],
  );

  const refreshSettings = useCallback(async () => {
    try {
      applySettings(await api<TeamSettings>("/api/settings"));
    } catch {
      // Without the team's Perfil yet, rank with the default one rather than never deciding the opening tab.
      if (!teamProfile.current) {
        teamProfile.current = DEFAULT_USER_PROFILE;
        maybeDecide();
      }
    }
  }, [applySettings, maybeDecide]);

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

  /* ----- Votes ----- */

  const [votes, setVotes] = useState<Vote[]>([]);
  const votesPending = useRef(0);
  const refreshVotes = useCallback(async () => {
    try {
      const r = await api<{ votes: Vote[] }>("/api/votes");
      if (votesPending.current === 0) setVotes(r.votes);
    } catch {
      /* keep what we have */
    }
  }, []);

  const mine = useCallback((v: Vote, id: string) => v.opportunityId === id && v.user.id === me.id, [me.id]);

  const setVote = useCallback<RadarState["setVote"]>(
    (id, vote, reason) => {
      if (blocked()) return;
      let prev: Vote[] = [];
      const optimistic: Vote = { opportunityId: id, user: { id: me.id, name: me.name }, vote, reason, updatedAt: new Date().toISOString() };
      setVotes((vs) => {
        prev = vs;
        return [...vs.filter((v) => !mine(v, id)), optimistic];
      });
      votesPending.current++;
      api<Vote>(`/api/votes/${encodeURIComponent(id)}`, { method: "PUT", json: { vote, reason } })
        .then((saved) => setVotes((vs) => [...vs.filter((v) => !mine(v, id)), saved]))
        .catch((e) => {
          setVotes(prev);
          notify(`No se ha guardado tu voto. ${errorText(e)}`, "error");
        })
        .finally(() => votesPending.current--);
    },
    [blocked, me, mine, notify],
  );

  const clearVote = useCallback<RadarState["clearVote"]>(
    (id) => {
      if (blocked()) return;
      let prev: Vote[] = [];
      setVotes((vs) => {
        prev = vs;
        return vs.filter((v) => !mine(v, id));
      });
      votesPending.current++;
      api(`/api/votes/${encodeURIComponent(id)}`, { method: "DELETE" })
        .catch((e) => {
          setVotes(prev);
          notify(`No se ha quitado tu voto. ${errorText(e)}`, "error");
        })
        .finally(() => votesPending.current--);
    },
    [blocked, mine, notify],
  );

  const refreshTeam = useCallback(
    () => Promise.all([refreshBoard(), refreshPeople(), refreshSettings(), refreshVotes()]).then(() => undefined),
    [refreshBoard, refreshPeople, refreshSettings, refreshVotes],
  );

  // Server unreachable: retry on our own, a little later each time (2 s, 4 s… up to 30 s). Once it answers, reload
  // the list and the team's state, and the offline notice goes away.
  const refreshTeamRef = useRef(refreshTeam);
  useEffect(() => {
    refreshTeamRef.current = refreshTeam;
  }, [refreshTeam]);
  const wasOffline = useRef(false);
  useEffect(() => {
    if (!offline) {
      if (wasOffline.current) {
        wasOffline.current = false;
        void fetchRef.current?.();
        void refreshTeamRef.current();
      }
      return;
    }
    wasOffline.current = true;
    let n = 0;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(() => {
        void fetchRef.current?.().then(() => {
          n++;
          if (serverStatus.isDown()) next();
        });
      }, Math.min(30_000, 2000 * 2 ** n));
    };
    next();
    return () => clearTimeout(t);
  }, [offline]);

  // Load once (after the first-login import), then every minute and whenever the tab comes back, so colleagues' changes show up.
  useEffect(() => {
    let last = 0;
    const run = () => {
      last = Date.now();
      void refreshTeam();
    };
    // Old browser-only state goes to the team first, so the first board read already includes it.
    void importLocalState().then((msg) => {
      if (msg) notifyRef.current(msg);
      run();
    });
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
      if (blocked()) return;
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
    [blocked, me, notify, placeholder, refreshBoard],
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
      if (blocked()) return false;
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
    [blocked, notify, placeholder, refreshBoard],
  );

  const deleteNote = useCallback<RadarState["deleteNote"]>(
    (id, noteId) => {
      const prev = boardRef.current[id];
      if (!prev || blocked()) return;
      setBoard((b) => ({ ...b, [id]: { ...prev, notes: prev.notes.filter((n) => n.id !== noteId) } }));
      api(boardPath(id, `/notes/${noteId}`), { method: "DELETE" }).catch((e) => {
        setBoard((b) => ({ ...b, [id]: { ...(b[id] ?? prev), notes: prev.notes } }));
        notify(`No se ha borrado la nota. ${errorText(e)}`, "error");
      });
    },
    [blocked, notify],
  );

  const byId = useMemo(() => new Map((data?.items ?? []).map((o) => [o.id, o])), [data]);

  /* ----- URL: filters and page on Inicio, `?c=<id>` for the open call everywhere ----- */

  const teamOrgs = useMemo(() => settings?.organisms ?? [], [settings]);
  // Same rule as the opening tab: while it is "Próximas ediciones", choosing "Para pedir ahora" is marked in the URL.
  const quiet = useMemo(() => (data ? noOpenHighFit(data.items) : false), [data]);
  const pushNext = useRef<{ radarDrawer?: boolean } | null>(null);
  const markPush = useCallback(() => {
    pushNext.current = {};
  }, []);

  useEffect(() => {
    if (!urlLoaded) return;
    const sp = new URLSearchParams(path === "/" ? filtersToQuery(filters, quiet && plazoViewOf(filters) === "ahora", teamOrgs) : window.location.search);
    if (path === "/" && page > 0) sp.set("pagina", String(page + 1));
    if (selectedId) sp.set("c", selectedId);
    else sp.delete("c");
    const q = sp.toString();
    const url = `${window.location.pathname}${q ? `?${q}` : ""}`;
    const push = pushNext.current;
    pushNext.current = null;
    if (url === window.location.pathname + window.location.search) return;
    // A fresh object (not Next's own state): the patched history methods then copy the router's state into it.
    if (push) window.history.pushState({ ...push }, "", url);
    else window.history.replaceState({ radarDrawer: window.history.state?.radarDrawer }, "", url);
  }, [urlLoaded, path, filters, page, selectedId, quiet, teamOrgs]);

  useEffect(() => {
    const onPop = () => readUrl(false);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [readUrl]);

  const opener = useRef<HTMLElement | null>(null);
  const selectedRef = useRef(selectedId);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  const openDetail = useCallback((id: string, el?: HTMLElement | null) => {
    const active = document.activeElement;
    opener.current = el ?? (active instanceof HTMLElement && active !== document.body ? active : null);
    if (selectedRef.current === id) return;
    if (!selectedRef.current) pushNext.current = { radarDrawer: true };
    setSelectedId(id);
  }, []);
  const closeDetail = useCallback(() => {
    // Opened here: going back removes the entry we added (and `c` with it). Opened from a link: just drop `c`.
    if (window.history.state?.radarDrawer) window.history.back();
    else setSelectedId(null);
  }, []);
  const detailOpener = useCallback(() => {
    const el = opener.current;
    if (el?.isConnected) return el;
    const id = selectedRef.current;
    return id ? document.querySelector<HTMLElement>(`[data-opener="${CSS.escape(id)}"]`) : null;
  }, []);

  // A link to a call that is neither in the sources nor on the board: say so instead of opening nothing.
  useEffect(() => {
    if (!selectedId || !rawData || loading || refreshing || !boardLoaded || byId.has(selectedId) || board[selectedId]) return;
    notifyRef.current("No encontramos esa convocatoria en el radar: puede que ya no esté en las fuentes.");
    void Promise.resolve().then(() => setSelectedId(null));
  }, [selectedId, rawData, loading, refreshing, boardLoaded, byId, board]);

  const value = useMemo<RadarState>(
    () => ({
      data,
      rawData,
      profile,
      setProfile,
      settings,
      profileSave,
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
      votes,
      setVote,
      clearVote,
      notices,
      notify,
      dismiss,
      filters,
      setFilters,
      markPush,
      page,
      setPage,
      teamOrgs,
      offline,
      selectedId,
      openDetail,
      closeDetail,
      detailOpener,
    }),
    [data, rawData, profile, setProfile, settings, profileSave, loading, refreshing, error, reload, byId, board, boardLoaded, people, triageOf, setTriage, setAssignee, addNote, deleteNote, votes, setVote, clearVote, notices, notify, dismiss, filters, setFilters, markPush, page, teamOrgs, offline, selectedId, openDetail, closeDetail, detailOpener],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
