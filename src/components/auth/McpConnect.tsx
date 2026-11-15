"use client";

import { Check, Copy, Loader2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api, errorText } from "@/lib/api";
import { fmtDayLong, fmtWhenShort, type PersonalToken, type TokenCreated, type TokensInfo } from "@/lib/team";
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

/** "Conectar un asistente (MCP)" in Mi cuenta: the no-token command, and optional personal tokens for the team's board. */
export function McpConnect() {
  const [info, setInfo] = useState<TokensInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<TokenCreated | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await api<TokensInfo>("/api/me/tokens"));
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  return (
    <section className="space-y-3" aria-labelledby="mcp-title">
      <h3 id="mcp-title" className="text-sm font-semibold">
        Conectar un asistente (MCP)
      </h3>
      <p className="text-sm text-muted-foreground">
        Tu asistente de IA (Claude u otro compatible con MCP) puede consultar el radar por ti: buscar convocatorias, ver fichas e historial. Solo lee, nunca cambia nada.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {info && (
        <>
          {info.publicTools && <Snippet label="Claude Code, sin token" text={claudeCommand(info.mcpUrl)} />}
          <p className="text-sm text-muted-foreground">
            {info.publicTools
              ? "Opcional: con un token personal tu asistente ve también el tablero del equipo (estado, notas, votos) y las notas con vuestro perfil."
              : "En este radar el asistente necesita un token personal."}{" "}
            Lo que devuelva el radar lo verá el proveedor de tu asistente.
          </p>
          {created ? (
            <CreatedToken created={created} url={info.mcpUrl} onDone={() => setCreated(null)} />
          ) : (
            <CreateForm
              onCreated={(c) => {
                setCreated(c);
                void load();
              }}
            />
          )}
          <TokenList tokens={info.tokens} onChange={() => void load()} />
        </>
      )}
    </section>
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
          <SelectTrigger className="sm:w-36" aria-label="Caducidad">
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
