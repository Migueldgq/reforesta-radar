"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  CircleCheck,
  CircleMinus,
  Copy,
  KeyRound,
  Loader2,
  Mail,
  MoreHorizontal,
  RotateCw,
  ShieldCheck,
  ShieldOff,
  ThumbsDown,
  ThumbsUp,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, errorText } from "@/lib/api";
import { fmtDayLong, fmtWhenShort, type Disagreement, type OneTimeLink, type PendingInvitation, type PendingReset, type Role, type TeamUser } from "@/lib/team";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/components/auth/session";
import { cn } from "@/lib/utils";
import { fmtAgo, tidy, TIER_LABELS } from "./model";
import { useRadar } from "./store";
import { ConfirmDialog, PersonAvatar } from "./ui";

function activeCount(users: TeamUser[]): string {
  const n = users.filter((u) => u.active).length;
  return n === 1 ? "1 activa" : `${n} activas`;
}

const ROLE_LABEL: Record<Role, string> = { admin: "Administración", member: "Equipo" };

/* ---------- Page ---------- */

export function EquipoView() {
  const { isAdmin } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const tab = params.get("vista") === "ajuste" ? "ajuste" : "personas";

  if (!isAdmin)
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
        <ShieldOff className="size-6 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">Solo para administración</h1>
        <p className="text-sm text-muted-foreground">Las personas del equipo y sus invitaciones las gestiona un administrador. Si necesitas algo, pídeselo.</p>
        <Button asChild variant="outline" size="sm" className="mt-2">
          <Link href="/">Ir a Inicio</Link>
        </Button>
      </div>
    );

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Equipo</h1>
        <p className="text-sm text-muted-foreground">Quién puede entrar en el radar. Las cuentas solo se crean con una invitación que envías tú.</p>
      </header>
      <Tabs value={tab} onValueChange={(v) => router.replace(v === "ajuste" ? `${path}?vista=ajuste` : path, { scroll: false })}>
        <TabsList aria-label="Secciones de Equipo">
          <TabsTrigger value="personas">Personas</TabsTrigger>
          <TabsTrigger value="ajuste">Ajuste de notas</TabsTrigger>
        </TabsList>
        <TabsContent value="personas" className="pt-4">
          <People />
        </TabsContent>
        <TabsContent value="ajuste" className="pt-4">
          <Disagreements />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------- People and invitations ---------- */

type Team = { users: TeamUser[]; invitations: PendingInvitation[]; resets: PendingReset[] };
type Confirm = { title: string; body: ReactNode; confirm: string; destructive?: boolean; run: () => void };
type Shown = { kind: "invitation" | "reset"; who: string } & OneTimeLink;

function People() {
  const { me } = useSession();
  const { notify } = useRadar();
  const [team, setTeam] = useState<Team | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);

  const load = useCallback(async () => {
    try {
      setTeam(await api<Team>("/api/team"));
      setLoadError(null);
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function patchUser(u: TeamUser, body: { role?: Role; active?: boolean }, done: string) {
    setBusy(u.id);
    try {
      const saved = await api<TeamUser>(`/api/team/users/${u.id}`, { method: "PATCH", json: body });
      setTeam((t) => (t ? { ...t, users: t.users.map((x) => (x.id === saved.id ? saved : x)) } : t));
      notify(done);
      // Losing admin or being deactivated also cancels the links that person created: show what is left.
      void load();
    } catch (e) {
      // e.g. 409 "Tiene que quedar al menos un administrador activo."
      notify(errorText(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function resetLink(u: TeamUser) {
    setBusy(u.id);
    try {
      const r = await api<OneTimeLink>(`/api/team/users/${u.id}/reset-link`, { method: "POST" });
      setShown({ kind: "reset", who: u.name || u.email, ...r });
      void load();
    } catch (e) {
      notify(errorText(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function revokeReset(r: PendingReset) {
    try {
      await api(`/api/team/resets/${r.id}`, { method: "DELETE" });
      setTeam((t) => (t ? { ...t, resets: t.resets.filter((x) => x.id !== r.id) } : t));
      notify(`Enlace para restablecer la contraseña de ${r.userName || "esa persona"} revocado.`);
    } catch (e) {
      notify(errorText(e), "error");
      void load();
    }
  }

  /** "Creado por Ana", "Creado por ti", or the self-service case for reset links. */
  const createdBy = (id: number | null, selfService = false) => {
    if (id == null) return selfService ? "Pedido por la propia persona (correo)" : "Creador desconocido";
    if (id === me.id) return "Creado por ti";
    const u = team?.users.find((x) => x.id === id);
    return `Creado por ${u?.name || u?.email || "otra persona"}`;
  };

  async function revoke(inv: PendingInvitation) {
    try {
      await api(`/api/team/invitations/${inv.id}`, { method: "DELETE" });
      setTeam((t) => (t ? { ...t, invitations: t.invitations.filter((x) => x.id !== inv.id) } : t));
      notify(`Invitación para ${inv.email} revocada. El enlace ya no sirve.`);
    } catch (e) {
      notify(errorText(e), "error");
      void load();
    }
  }

  const askRole = (u: TeamUser) => {
    const toAdmin = u.role !== "admin";
    const self = u.id === me.id;
    setConfirm({
      title: toAdmin ? `¿Dar administración a ${u.name || u.email}?` : `¿Quitar la administración a ${self ? "tu cuenta" : u.name || u.email}?`,
      body: toAdmin ? (
        "Podrá invitar y desactivar personas, generar enlaces para restablecer contraseñas y pedir una actualización de datos. Tendrá que volver a entrar."
      ) : self ? (
        "Dejarás de poder gestionar el equipo y se cerrará tu sesión ahora mismo. Tiene que quedar al menos otro administrador."
      ) : (
        "Seguirá usando el radar con normalidad, pero sin gestionar el equipo. Tendrá que volver a entrar."
      ),
      confirm: toAdmin ? "Dar administración" : "Quitar administración",
      destructive: !toAdmin,
      run: () => void patchUser(u, { role: toAdmin ? "admin" : "member" }, toAdmin ? `${u.name || u.email} ahora es administrador.` : `${u.name || u.email} ya no es administrador.`),
    });
  };

  const askActive = (u: TeamUser) => {
    if (!u.active) return void patchUser(u, { active: true }, `${u.name || u.email} puede volver a entrar.`);
    setConfirm({
      title: `¿Desactivar a ${u.name || u.email}?`,
      body: "Se cerrará su sesión al momento y no podrá volver a entrar. Sus notas y votos se quedan. Puedes reactivarla cuando quieras.",
      confirm: "Desactivar",
      destructive: true,
      run: () => void patchUser(u, { active: false }, `${u.name || u.email} ya no puede entrar.`),
    });
  };

  if (loadError && !team)
    return (
      <Alert variant="destructive">
        <AlertTitle>No hemos podido cargar el equipo</AlertTitle>
        <AlertDescription className="gap-3">
          <p>{loadError}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RotateCw aria-hidden /> Reintentar
          </Button>
        </AlertDescription>
      </Alert>
    );

  const users = team ? [...team.users].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "es")) : [];
  // The team always needs one active admin: the last one cannot lose the role or be deactivated (the API refuses too).
  const activeAdmins = users.filter((u) => u.active && u.role === "admin").length;

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="people-h" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="people-h" className="text-base font-semibold">
              Personas{team && <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{activeCount(team.users)}</span>}
            </h2>
            <p className="text-sm text-muted-foreground">Todas pueden editar el tablero. Administración además gestiona el equipo.</p>
          </div>
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus aria-hidden /> Invitar
          </Button>
        </div>

        {!team ? (
          <div className="space-y-2" aria-busy>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {users.map((u) => {
              const lastAdmin = u.active && u.role === "admin" && activeAdmins === 1;
              return (
                <li key={u.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3", !u.active && "bg-muted/40")}>
                  <div className="order-1 flex min-w-0 flex-1 basis-56 items-center gap-3">
                    <PersonAvatar name={u.name || u.email} className={cn("size-8 text-xs", !u.active && "opacity-60")} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {u.name || "Sin nombre"}
                        {u.id === me.id && <span className="font-normal text-muted-foreground"> (tú)</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                    </div>
                  </div>
                  <div className="order-3 flex flex-wrap items-center gap-2">
                    <Badge variant={u.role === "admin" ? "secondary" : "outline"} className="gap-1 font-normal">
                      {u.role === "admin" && <ShieldCheck aria-hidden />}
                      {ROLE_LABEL[u.role]}
                    </Badge>
                    {u.active ? (
                      <Badge variant="outline" className="gap-1 font-normal">
                        <CircleCheck className="text-primary" aria-hidden /> Activa
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                        <CircleMinus aria-hidden /> Desactivada
                      </Badge>
                    )}
                  </div>
                  <p className="order-4 w-36 text-xs text-muted-foreground" title={u.lastLoginAt ? fmtDayLong(u.lastLoginAt) : undefined}>
                    {u.lastLoginAt ? `Entró ${fmtAgo(u.lastLoginAt)}` : "Nunca ha entrado"}
                  </p>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" className="order-2 sm:order-5" aria-label={`Acciones para ${u.name || u.email}`} disabled={busy === u.id}>
                        {busy === u.id ? <Loader2 className="animate-spin" aria-hidden /> : <MoreHorizontal aria-hidden />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72">
                      {u.active && (
                        <DropdownMenuItem onSelect={() => void resetLink(u)}>
                          <KeyRound aria-hidden /> Generar enlace para restablecer contraseña
                        </DropdownMenuItem>
                      )}
                      {u.active && (
                        <DropdownMenuItem onSelect={() => askRole(u)} disabled={lastAdmin}>
                          {u.role === "admin" ? <ShieldOff aria-hidden /> : <ShieldCheck aria-hidden />}
                          {u.role === "admin" ? "Quitar administración" : "Dar administración"}
                        </DropdownMenuItem>
                      )}
                      {u.active && <DropdownMenuSeparator />}
                      <DropdownMenuItem onSelect={() => askActive(u)} variant={u.active ? "destructive" : "default"} disabled={lastAdmin}>
                        {u.active ? <UserRoundX aria-hidden /> : <UserRoundCheck aria-hidden />}
                        {u.active ? "Desactivar" : "Reactivar"}
                      </DropdownMenuItem>
                      {lastAdmin && (
                        <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
                          {u.id === me.id ? "Eres" : "Es"} la única persona con administración. Para quitarla o desactivar{" "}
                          {u.id === me.id ? "tu cuenta" : "esta cuenta"}, da antes administración a otra persona.
                        </p>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="inv-h" className="space-y-3">
        <div>
          <h2 id="inv-h" className="text-base font-semibold">
            Enlaces pendientes
          </h2>
          <p className="text-sm text-muted-foreground">
            Invitaciones y enlaces para restablecer contraseña que nadie ha usado todavía. Si uno se ha enviado a quien no era, revócalo.
          </p>
        </div>
        {team && team.invitations.length + team.resets.length === 0 && <p className="text-sm text-muted-foreground">No hay ninguno pendiente.</p>}
        {team && team.invitations.length + team.resets.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {team.invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate font-medium">{inv.name || inv.email}</p>
                  {inv.name && <p className="truncate text-xs text-muted-foreground">{inv.email}</p>}
                </div>
                <Badge variant="outline" className="font-normal">
                  <Mail aria-hidden /> Invitación · {ROLE_LABEL[inv.role]}
                </Badge>
                <p className="text-xs text-muted-foreground">
                  {createdBy(inv.createdBy)} · caduca el {fmtDayLong(inv.expiresAt)}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setConfirm({
                      title: "¿Revocar la invitación?",
                      body: `El enlace enviado a ${inv.email} dejará de funcionar. Puedes invitar de nuevo cuando quieras.`,
                      confirm: "Revocar invitación",
                      destructive: true,
                      run: () => void revoke(inv),
                    })
                  }
                >
                  Revocar
                </Button>
              </li>
            ))}
            {team.resets.map((r) => (
              <li key={`r${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate font-medium">{r.userName || "Sin nombre"}</p>
                  <p className="truncate text-xs text-muted-foreground">Nueva contraseña</p>
                </div>
                <Badge variant="outline" className="font-normal">
                  <KeyRound aria-hidden /> Restablecer
                </Badge>
                <p className="text-xs text-muted-foreground">
                  {createdBy(r.createdBy, true)} · caduca el {fmtWhenShort(r.expiresAt)}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setConfirm({
                      title: "¿Revocar el enlace?",
                      body: `El enlace para que ${r.userName || "esa persona"} elija una contraseña nueva dejará de funcionar. Su contraseña actual no cambia.`,
                      confirm: "Revocar enlace",
                      destructive: true,
                      run: () => void revokeReset(r),
                    })
                  }
                >
                  Revocar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm?.title ?? ""}
        body={confirm?.body ?? ""}
        confirm={confirm?.confirm ?? ""}
        destructive={confirm?.destructive}
        onConfirm={() => confirm?.run()}
      />
      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onCreated={(inv, link) => {
          setInviteOpen(false);
          setTeam((t) => (t ? { ...t, invitations: [inv, ...t.invitations.filter((x) => x.email !== inv.email)] } : t));
          setShown({ kind: "invitation", who: inv.name || inv.email, ...link });
        }}
      />
      <LinkDialog shown={shown} onClose={() => setShown(null)} />
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (inv: PendingInvitation, link: OneTimeLink) => void;
}) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setEmail("");
    setName("");
    setRole("member");
    setError(null);
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const em = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError("Escribe un correo válido, por ejemplo nombre@reforesta.es.");
      emailRef.current?.focus();
      return;
    }
    setPending(true);
    setError(null);
    try {
      const r = await api<{ invitation: PendingInvitation } & OneTimeLink>("/api/team/invitations", { json: { email: em, name: name.trim(), role } });
      onCreated(r.invitation, { link: r.link, expiresAt: r.expiresAt, emailed: r.emailed });
      reset();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invitar a alguien</DialogTitle>
          <DialogDescription>Te daremos un enlace para que se lo envíes tú. Con él crea su cuenta y elige su contraseña.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-email`} className="text-sm font-medium">
              Correo electrónico
            </label>
            <Input
              id={`${id}-email`}
              ref={emailRef}
              type="email"
              autoComplete="off"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!error || undefined}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-name`} className="text-sm font-medium">
              Nombre <span className="font-normal text-muted-foreground">(opcional; podrá cambiarlo)</span>
            </label>
            <Input id={`${id}-name`} autoComplete="off" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label id={`${id}-role`} className="text-sm font-medium">
              Rol
            </label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger className="w-full" aria-labelledby={`${id}-role`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Equipo: usa y edita el radar</SelectItem>
                <SelectItem value="admin">Administración: además gestiona el equipo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div role="alert">{error && <p className="text-sm text-destructive">{error}</p>}</div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Crear invitación
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The one-time link, shown once with a copy button (only its hash is stored). */
function LinkDialog({ shown, onClose }: { shown: Shown | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const invitation = shown?.kind === "invitation";

  async function copy() {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown.link);
      setCopied(true);
    } catch {
      // No clipboard permission: select the text so Ctrl+C / Cmd+C works.
      inputRef.current?.select();
    }
  }

  return (
    <Dialog
      open={!!shown}
      onOpenChange={(v) => {
        if (!v) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{invitation ? "Invitación lista" : "Enlace para restablecer la contraseña"}</DialogTitle>
          <DialogDescription>
            Envíale este enlace a {shown?.who} por un canal privado (un mensaje directo o tu
            correo). {invitation ? "Con él crea su cuenta." : "Con él elige una contraseña nueva."}
          </DialogDescription>
        </DialogHeader>
        {shown && (
          <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <label htmlFor="one-time-link" className="sr-only">
                Enlace
              </label>
              <Input id="one-time-link" ref={inputRef} readOnly value={shown.link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button onClick={() => void copy()} className="shrink-0">
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? "Copiado" : "Copiar enlace"}
              </Button>
            </div>
            <span className="sr-only" role="status">
              {copied ? "Enlace copiado" : ""}
            </span>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li>· Solo se muestra ahora: si cierras esta ventana sin copiarlo, tendrás que generar otro.</li>
              <li>· Sirve una sola vez y caduca {invitation ? "en 7 días" : "en 24 horas"} ({fmtDayLong(shown.expiresAt)}).</li>
              {!invitation && <li>· Si ya había un enlace anterior para esta persona, ha dejado de funcionar.</li>}
              {shown.emailed && <li>· También se lo hemos enviado por correo.</li>}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setCopied(false);
              onClose();
            }}
          >
            Hecho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Ajuste de notas: where the team's votes and the score disagree ---------- */

const KIND_TEXT: Record<Disagreement["kind"], string> = {
  sirve_bajo: "Os sirve, pero tiene nota baja",
  no_sirve_alto: "No os sirve, pero tiene nota alta",
  ambos: "Votos en los dos sentidos",
};

function Disagreements() {
  const { byId, openDetail } = useRadar();
  const [items, setItems] = useState<Disagreement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Disagreement[] }>("/api/votes/disagreements")).items);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  return (
    <section aria-labelledby="dis-h" className="space-y-4">
      <div className="space-y-1">
        <h2 id="dis-h" className="text-base font-semibold">
          Donde el equipo y la nota no coinciden
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Convocatorias que alguien votó «nos sirve» con una nota por debajo de 40, o «no nos sirve» con 60 o más. Son las pistas para ajustar las
          reglas del radar. La nota es la del radar, sin los ajustes del Perfil.
        </p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>No hemos podido cargar la lista</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!items && !error && <Skeleton className="h-24 w-full" />}
      {items && items.length === 0 && (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Ningún desacuerdo por ahora. Cuando el equipo vote en el detalle de una convocatoria, aparecerán aquí las que no cuadren con su nota.
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {items.map((d) => {
            const live = byId.has(d.opportunityId);
            return (
              <li key={d.opportunityId} className="space-y-2.5 px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <span
                    title={`${TIER_LABELS[d.tier]}: ${d.score} de 100`}
                    className="inline-grid size-8 shrink-0 place-items-center rounded-md border text-[13px] font-semibold tabular-nums"
                  >
                    {d.score}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    {live ? (
                      <button type="button" onClick={() => openDetail(d.opportunityId)} className="text-left font-medium leading-snug hover:underline focus-visible:underline focus-visible:outline-none">
                        {tidy(d.titulo)}
                      </button>
                    ) : (
                      <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 font-medium leading-snug hover:underline">
                        {tidy(d.titulo)} <ArrowUpRight className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      </a>
                    )}
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <Badge variant="outline" className="font-normal">
                        {d.kind === "no_sirve_alto" ? <ThumbsDown aria-hidden /> : <ThumbsUp aria-hidden />}
                        {KIND_TEXT[d.kind]}
                      </Badge>
                      <span className="uppercase">{d.source}</span>
                    </p>
                  </div>
                </div>
                <ul className="space-y-1 pl-11">
                  {d.votes.map((v) => (
                    <li key={v.user.id} className="flex items-start gap-2 text-sm">
                      {v.vote === "sirve" ? <ThumbsUp className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden /> : <ThumbsDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                      <span className="min-w-0">
                        <span className="font-medium">{v.user.name || "Alguien"}</span>
                        <span className="text-muted-foreground">: {v.vote === "sirve" ? "nos sirve" : "no nos sirve"}</span>
                        {v.reason && <span className="break-words text-muted-foreground"> · «{v.reason}»</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
