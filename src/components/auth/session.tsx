"use client";

import { Sprout } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, errorText, loginUrl } from "@/lib/api";
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
    fetchSession()
      .then((s) => {
        if (!alive) return;
        if (!s.user) window.location.replace(loginUrl(window.location.pathname + window.location.search));
        else setInfo(s);
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
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
