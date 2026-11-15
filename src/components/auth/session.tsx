"use client";

import { Sprout } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, errorText, isUnreachable, loginUrl } from "@/lib/api";
import type { Me, SessionInfo } from "@/lib/team";
import { Button } from "@/components/ui/button";

interface SessionState {
  me: Me;
  isAdmin: boolean;
  forgotPassword: boolean;
  /** After "Mi cuenta" changes the name. */
  setMe: (me: Me) => void;
}

const Ctx = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession fuera de SessionGate");
  return v;
}

export function fetchSession(): Promise<SessionInfo> {
  return api<SessionInfo>("/api/auth/session");
}

/* The last good session, so the app can still open (read-only, with the saved list) while the server is down. */
const SESSION_KEY = "reforesta-radar:session:v1";

function readSession(): SessionInfo | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionInfo) : null;
  } catch {
    return null;
  }
}

function writeSession(s: SessionInfo) {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* storage disabled: the offline fallback just will not be there */
  }
}

/** On sign-out: the next person on this browser must not open the app as this one while the server is down. */
export function forgetSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** The logo + name block shared by the auth pages and the loading splash. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
        <Sprout className="size-4" aria-hidden />
      </span>
      <span className="font-semibold">Reforesta Radar</span>
    </span>
  );
}

/**
 * The real session check for the app (the proxy only looks at whether the cookie exists).
 * Renders the app once `GET /api/auth/session` says who is signed in; otherwise goes to the login page.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    fetchSession()
      .then((s) => {
        if (!alive) return;
        if (!s.user) {
          forgetSession();
          window.location.replace(loginUrl(window.location.pathname + window.location.search));
        } else {
          writeSession(s);
          setInfo(s);
        }
      })
      .catch((e) => {
        if (!alive) return;
        // Server unreachable: open with the last session (the app then shows the saved list, read-only, and keeps
        // retrying). Without one, say so and try again on our own, a little later each time.
        const cached = isUnreachable(e) ? readSession() : null;
        if (cached?.user) setInfo(cached);
        else {
          setError(errorText(e));
          timer = setTimeout(() => setAttempt((n) => n + 1), Math.min(30_000, 3000 * 2 ** Math.min(attempt, 4)));
        }
      });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [attempt]);

  const value = useMemo<SessionState | null>(
    () =>
      info?.user
        ? {
            me: info.user,
            isAdmin: info.user.role === "admin",
            forgotPassword: info.forgotPassword,
            setMe: (me) => setInfo((s) => (s ? { ...s, user: me } : s)),
          }
        : null,
    [info],
  );

  if (!value)
    return (
      <div className="grid min-h-svh place-items-center px-4">
        <div className="flex flex-col items-center gap-4 text-center" aria-busy={!error}>
          <BrandMark />
          {error ? (
            <div role="alert" className="space-y-3">
              <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
              <p className="max-w-sm text-xs text-muted-foreground">Lo volvemos a intentar solos en unos segundos.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setError(null);
                  setAttempt((n) => n + 1);
                }}
              >
                Reintentar
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" role="status">
              Cargando…
            </p>
          )}
        </div>
      </div>
    );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
