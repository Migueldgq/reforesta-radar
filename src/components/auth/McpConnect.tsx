"use client";

import { Check, ChevronDown, Copy, Loader2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, errorText } from "@/lib/api";
import { fmtDayLong, fmtWhenShort, type AssistantsInfo, type ConnectedAssistant, type PersonalToken, type TokenCreated, type TokensInfo } from "@/lib/team";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AssistantKindChip } from "./assistant-kind";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const DAYS = [30, 90, 365];

const claudeCommand = (url: string, secret?: string) =>
  `claude mcp add --transport http reforesta-radar ${url}${secret ? ` --header "Authorization: Bearer ${secret}"` : ""}`;

const jsonConfig = (url: string, secret: string) =>
  JSON.stringify({ mcpServers: { "reforesta-radar": { type: "http", url, headers: { Authorization: `Bearer ${secret}` } } } }, null, 2);

/** A code snippet with a copy button; the status text next to it is the live region (copied / failed). */
function Snippet({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<"" | "ok" | "fail">("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setState("ok");
    } catch {
      setState("fail"); // no clipboard permission: the text stays selectable
    }
    timer.current = setTimeout(() => setState(""), 2500);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="flex items-center gap-2">
          <span role="status" className="text-xs text-muted-foreground">
            {state === "ok" ? "Copiado" : state === "fail" ? "No se pudo copiar: selecciónalo a mano" : ""}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void copy()} aria-label={`Copiar: ${label}`}>
            {state === "ok" ? <Check aria-hidden /> : <Copy aria-hidden />}
            Copiar
          </Button>
        </span>
      </div>
      <pre className="overflow-x-auto rounded-md border bg-muted/50 p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">{text}</pre>
    </div>
  );
}

/**
 * "Conectar un asistente" in Mi cuenta. Leads with the simple path (paste the team address in the assistant, sign in,
 * Permitir; ADR 0035) and the assistants connected that way; personal tokens and the public address are the
 * technical option underneath.
 */
export function McpConnect() {
  const [info, setInfo] = useState<AssistantsInfo | null>(null);
  const [tokens, setTokens] = useState<TokensInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<TokenCreated | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, t] = await Promise.all([api<AssistantsInfo>("/api/me/assistants"), api<TokensInfo>("/api/me/tokens")]);
      setInfo(a);
      setTokens(t);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const published = info?.teamUrl.startsWith("https://") ?? false;

  return (
    <section className="space-y-4" aria-labelledby="mcp-title">
      <div className="space-y-1.5">
        <h3 id="mcp-title" className="text-sm font-semibold">
          Conectar un asistente
        </h3>
        <p className="text-sm text-muted-foreground">
          Tu asistente de IA (Claude) puede consultar el radar por ti: buscar convocatorias y ver el tablero del equipo. Solo lee; nunca cambia nada.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {info && tokens && (
        <>
          {info.signIn ? (
            <ol className="space-y-3 text-sm">
              <Step n={1}>
                {published ? (
                  <>
                    En Claude (web o escritorio): <span className="font-medium">Ajustes → Conectores → Añadir conector personalizado</span>.
                  </>
                ) : (
                  <>En Claude Code, en este ordenador (este radar no está publicado en internet, así que claude.ai y Claude Desktop no pueden llegar a él).</>
                )}
              </Step>
              <Step n={2}>
                {published ? "Pega esta dirección y pulsa Añadir:" : "Ejecuta esto en una terminal:"}
                <div className="mt-2">
                  <Snippet label={published ? "Dirección del radar" : "Claude Code"} text={published ? info.teamUrl : claudeCommand(info.teamUrl)} />
                </div>
              </Step>
              <Step n={3}>
                {published ? "Pulsa Conectar." : "En Claude Code escribe /mcp, elige reforesta-radar y Autenticar."} Se abrirá el radar: entra con tu cuenta y pulsa <span className="font-medium">Permitir</span>.
              </Step>
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">
              En este radar no se puede iniciar sesión desde el asistente (falta publicarlo con https). Usa un token personal, en «Para uso técnico».
            </p>
          )}

          <ConnectedList assistants={info.assistants} onChange={() => void load()} />
          <p className="text-xs text-muted-foreground">Lo que lea tu asistente lo verá también la empresa que lo ofrece.</p>

          <Collapsible className="rounded-lg border">
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              Para uso técnico: dirección pública y tokens personales
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 border-t p-3">
              {tokens.publicTools && (
                <>
                  <p className="text-sm text-muted-foreground">Sin iniciar sesión, solo datos públicos (lo mismo que la portada):</p>
                  <Snippet label="Claude Code, solo datos públicos" text={claudeCommand(tokens.mcpUrl)} />
                </>
              )}
              <p className="text-sm text-muted-foreground">
                Un token personal sirve para clientes que no pueden iniciar sesión: se pega como cabecera y da la misma vista de equipo.
              </p>
              {created ? (
                <CreatedToken created={created} url={tokens.mcpUrl} onDone={() => setCreated(null)} />
              ) : (
                <CreateForm
                  onCreated={(c) => {
                    setCreated(c);
                    void load();
                  }}
                />
              )}
              <TokenList tokens={tokens.tokens} onChange={() => void load()} />
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
    </section>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium tabular-nums text-muted-foreground" aria-hidden>
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">{children}</div>
    </li>
  );
}

function ConnectedList({ assistants, onChange }: { assistants: ConnectedAssistant[]; onChange: () => void }) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Asistentes conectados</h4>
      {assistants.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no has conectado ninguno.</p>
      ) : (
        <ul className="divide-y rounded-lg border" aria-label="Asistentes conectados">
          {assistants.map((a) => (
            <AssistantRow key={a.id} assistant={a} onChange={onChange} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AssistantRow({ assistant: a, onChange }: { assistant: ConnectedAssistant; onChange: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    setPending(true);
    try {
      await api(`/api/me/assistants/${a.id}`, { method: "DELETE" });
      onChange();
    } catch (e) {
      setError(errorText(e));
      setPending(false);
    }
  }

  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{a.name}</span>
            <AssistantKindChip kind={a.kind} />
          </p>
          <p className="text-xs text-muted-foreground">
            Conectado {fmtWhenShort(a.createdAt)} · {a.lastUsedAt ? `usado ${fmtWhenShort(a.lastUsedAt)}` : "sin usar"} · <span className="font-mono">{a.redirectHost}</span>
          </p>
        </div>
        {!confirming && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label={`Desconectar ${a.name}`}>
            Desconectar
          </Button>
        )}
      </div>
      {confirming && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Dejará de leer el radar al momento.</span>
          <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={() => void disconnect()}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Desconectar
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>
            Cancelar
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </li>
  );
}

function CreateForm({ onCreated }: { onCreated: (c: TokenCreated) => void }) {
  const id = useId();
  const [name, setName] = useState("");
  const [days, setDays] = useState("90");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Ponle un nombre, por ejemplo «Claude en mi portátil».");
    setError(null);
    setPending(true);
    try {
      onCreated(await api<TokenCreated>("/api/me/tokens", { json: { name: name.trim(), expiresInDays: Number(days) } }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2" noValidate>
      <label htmlFor={id} className="text-sm font-medium">
        Nuevo token personal
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id={id} placeholder="Nombre (p. ej. Claude en mi portátil)" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-full sm:w-36" aria-label="Caducidad">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DAYS.map((d) => (
              <SelectItem key={d} value={String(d)}>
                {d === 365 ? "1 año" : `${d} días`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline" disabled={pending} className="shrink-0">
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Crear token
        </Button>
      </div>
      <div role="alert">{error && <p className="text-xs text-destructive">{error}</p>}</div>
    </form>
  );
}

function CreatedToken({ created, url, onDone }: { created: TokenCreated; url: string; onDone: () => void }) {
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-sm">
        <span className="font-medium">Token «{created.token.name}» creado.</span> Cópialo ahora: no volverás a verlo. Caduca el {fmtDayLong(created.token.expiresAt)}.
      </p>
      <Snippet label="Token" text={created.secret} />
      <Snippet label="Claude Code, con token" text={claudeCommand(url, created.secret)} />
      <Snippet label="Otros clientes (configuración JSON)" text={jsonConfig(url, created.secret)} />
      <p className="text-xs text-muted-foreground">Trátalo como una contraseña: no lo compartas ni lo subas a un repositorio. Si se filtra, revócalo.</p>
      <Button type="button" variant="outline" size="sm" onClick={onDone}>
        Hecho
      </Button>
    </div>
  );
}

function TokenList({ tokens, onChange }: { tokens: PersonalToken[]; onChange: () => void }) {
  if (tokens.length === 0) return <p className="text-sm text-muted-foreground">No tienes tokens activos.</p>;
  return (
    <ul className="divide-y rounded-lg border" aria-label="Tus tokens activos">
      {tokens.map((t) => (
        <TokenRow key={t.id} token={t} onChange={onChange} />
      ))}
    </ul>
  );
}

function TokenRow({ token, onChange }: { token: PersonalToken; onChange: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setPending(true);
    try {
      await api(`/api/me/tokens/${token.id}`, { method: "DELETE" });
      onChange();
    } catch (e) {
      setError(errorText(e));
      setPending(false);
    }
  }

  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{token.name}</p>
          <p className="text-xs text-muted-foreground">
            Creado {fmtWhenShort(token.createdAt)} · {token.lastUsedAt ? `usado ${fmtWhenShort(token.lastUsedAt)}` : "sin usar"} · caduca {fmtDayLong(token.expiresAt)}
          </p>
        </div>
        {!confirming && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label={`Revocar el token ${token.name}`}>
            Revocar
          </Button>
        )}
      </div>
      {confirming && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">El asistente que lo use dejará de ver el tablero.</span>
          <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={() => void revoke()}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Revocar
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>
            Cancelar
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </li>
  );
}
