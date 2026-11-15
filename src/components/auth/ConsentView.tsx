"use client";

import { CircleAlert, CircleCheck, Info, Link2Off, Loader2, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, errorText } from "@/lib/api";
import type { ConsentInfo } from "@/lib/team";
import { Button } from "@/components/ui/button";
import { AssistantKindChip } from "./assistant-kind";
import { BrandMark, useSession } from "./session";

/**
 * /autorizar?solicitud=…: an assistant asks to read the radar with this person's account (ADR 0035). The request was
 * recorded by /oauth/authorize in this browser; Permitir / No permitir send the browser back to the assistant.
 * Whatever the kind of client, the page warns that a link someone sent you is a reason to say no: the request
 * can be started by anyone, only the person's decision here makes it count.
 */
export function ConsentView() {
  const { me } = useSession();
  const request = useSearchParams().get("solicitud") ?? "";
  const [info, setInfo] = useState<ConsentInfo | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [done, setDone] = useState<"allow" | "deny" | null>(null);

  useEffect(() => {
    let alive = true;
    if (!request) {
      void Promise.resolve().then(() => setGone("Falta la solicitud. Vuelve a conectar desde tu asistente."));
      return;
    }
    api<ConsentInfo>("/api/oauth/consent", { json: { request } })
      .then((i) => alive && setInfo(i))
      .catch((e) => alive && (e instanceof ApiError && e.status === 404 ? setGone(e.message) : setError(errorText(e))));
    return () => {
      alive = false;
    };
  }, [request]);

  async function decide(allow: boolean) {
    setPending(allow ? "allow" : "deny");
    setError(null);
    try {
      const { redirectTo } = await api<{ redirectTo: string | null }>("/api/oauth/consent/decision", { json: { request, allow } });
      setDone(allow ? "allow" : "deny");
      // null: refused a client we do not recognise; stay here rather than visit its site
      if (redirectTo) window.location.assign(redirectTo);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setGone(e.message);
      else setError(errorText(e));
      setPending(null);
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <main className="w-full max-w-md">
        <div className="mx-auto mb-8 flex w-fit">
          <BrandMark />
        </div>
        <div className="rounded-xl border bg-background p-6 shadow-xs sm:p-7">
          {gone ? (
            <Gone message={gone} />
          ) : done ? (
            <Done allowed={done === "allow"} />
          ) : !info ? (
            error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando la solicitud…
              </p>
            )
          ) : (
            <div className="space-y-5">
              <div className="space-y-2">
                <h1 className="text-lg font-semibold tracking-tight text-balance">
                  <span className="line-clamp-2 overflow-hidden break-words">{info.assistant}</span> quiere leer el radar de
                  Reforesta con tu cuenta
                </h1>
                <p className="text-sm text-muted-foreground">
                  Convocatorias, tablero del equipo, notas y votos. Solo lectura; no puede cambiar nada.
                </p>
              </div>

              <dl className="divide-y rounded-lg border text-sm">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5">
                  <dt className="text-muted-foreground">Asistente</dt>
                  <dd className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{info.assistant}</span>
                    <AssistantKindChip kind={info.kind} />
                  </dd>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5">
                  <dt className="text-muted-foreground">El permiso se envía a</dt>
                  <dd className="min-w-0 font-mono text-xs break-words">{info.redirectHost}</dd>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5">
                  <dt className="text-muted-foreground">Tu cuenta</dt>
                  <dd className="truncate">{me.email}</dd>
                </div>
              </dl>

              <KindNote kind={info.kind} host={info.redirectHost} />
              {info.kind !== "desconocido" && (
                <div className="flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <SelfCheck />
                </div>
              )}

              <ul className="space-y-1.5 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  Lo que lea, lo verá también la empresa del asistente.
                </li>
                <li className="flex gap-2">
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  Puedes desconectarlo cuando quieras en Mi cuenta → Conectar un asistente.
                </li>
              </ul>

              <div role="alert" aria-live="assertive">
                {error && (
                  <p className="flex gap-2 text-sm text-destructive">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {error}
                  </p>
                )}
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" disabled={pending !== null} onClick={() => void decide(false)}>
                  {pending === "deny" && <Loader2 className="animate-spin" aria-hidden />}
                  No permitir
                </Button>
                <Button type="button" disabled={pending !== null} onClick={() => void decide(true)}>
                  {pending === "allow" && <Loader2 className="animate-spin" aria-hidden />}
                  Permitir
                </Button>
              </div>
            </div>
          )}
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          ¿No lo has pedido tú? Pulsa «No permitir» y{" "}
          <Link href="/" className="underline-offset-4 hover:text-foreground hover:underline">
            vuelve al radar
          </Link>
          .
        </p>
      </main>
    </div>
  );
}

function KindNote({ kind, host }: { kind: ConsentInfo["kind"]; host: string }) {
  if (kind === "conocido") {
    return (
      <p className="text-sm text-muted-foreground">
        El permiso se envía a Claude ({host}), pero eso no dice de quién es la cuenta de Claude que lo recibe.
      </p>
    );
  }
  if (kind === "local") {
    return (
      <p className="text-sm text-muted-foreground">
        El permiso vuelve a un programa de este ordenador, por ejemplo Claude Code.
      </p>
    );
  }
  return (
    <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
      <p className="flex items-center gap-1.5 font-medium">
        <CircleAlert className="size-4 shrink-0" aria-hidden /> No reconocemos este asistente
      </p>
      <p>
        Su nombre lo ha escrito él mismo. Comprueba que reconoces la dirección <span className="font-mono text-xs break-words">{host}</span>.
      </p>
      <SelfCheck />
    </div>
  );
}

/** The one rule that holds for every client: only your own, just-made request. */
function SelfCheck() {
  return (
    <p>
      Continúa solo si tú mismo acabas de pulsar «Conectar» en tu propio asistente. Si alguien te ha enviado este enlace,
      pulsa «No permitir».
    </p>
  );
}

function Gone({ message }: { message: string }) {
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 font-medium">
        <Link2Off className="size-4 text-muted-foreground" aria-hidden /> No se puede continuar
      </p>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function Done({ allowed }: { allowed: boolean }) {
  return (
    <p className="flex items-center gap-2 text-sm" role="status">
      {allowed ? <CircleCheck className="size-4 text-primary" aria-hidden /> : <X className="size-4 text-muted-foreground" aria-hidden />}
      {allowed ? "Listo. Vuelve a tu asistente: ya puede leer el radar." : "No permitido. Ese asistente no tendrá acceso."}
    </p>
  );
}
