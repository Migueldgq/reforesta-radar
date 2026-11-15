"use client";

import { ChevronsUpDown, CircleCheck, Loader2, LogOut, UserRound } from "lucide-react";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, errorText, hardNavigate } from "@/lib/api";
import { initials, PASSWORD_MAX, PASSWORD_MIN, type Me } from "@/lib/team";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { McpConnect } from "./McpConnect";
import { forgetSession, useSession } from "./session";

/** The signed-in person in the sidebar footer, with "Mi cuenta" and "Cerrar sesión". Works in the collapsed rail too. */
export function AccountMenu() {
  const { me } = useSession();
  const { isMobile, state } = useSidebar();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function logout() {
    setLeaving(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* the cookie may already be gone; go to the login page anyway */
    }
    forgetSession();
    hardNavigate("/login");
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg" tooltip={me.name || me.email} className="data-[state=open]:bg-sidebar-accent" aria-label={`Tu cuenta: ${me.name || me.email}`}>
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-foreground/80 ring-1 ring-border" aria-hidden>
                  {initials(me.name || me.email)}
                </span>
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate font-medium">{me.name || "Sin nombre"}</span>
                  <span className="truncate text-xs text-muted-foreground">{me.role === "admin" ? "Administración" : "Equipo"}</span>
                </span>
                <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" aria-hidden />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side={isMobile ? "top" : state === "collapsed" ? "right" : "top"} align="end" sideOffset={6} className="w-60">
              <DropdownMenuLabel className="font-normal">
                <span className="block truncate font-medium">{me.name || "Sin nombre"}</span>
                <span className="block truncate text-xs text-muted-foreground">{me.email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setOpen(true)}>
                <UserRound aria-hidden /> Mi cuenta
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void logout()} disabled={leaving}>
                {leaving ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />} Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <AccountDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function AccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { me } = useSession();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mi cuenta</DialogTitle>
          <DialogDescription>
            Entras como <span className="font-medium text-foreground">{me.email}</span>. Para cambiar el correo, pídeselo a un administrador.
          </DialogDescription>
        </DialogHeader>
        {/* Remount the forms each time the dialog opens, so old messages do not linger. */}
        {open && (
          <div className="space-y-6">
            <NameForm />
            <Separator />
            <PasswordForm />
            <Separator />
            <McpConnect />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children, hint, error }: { label: string; children: (id: string, describedBy?: string) => ReactNode; hint?: string; error?: string | null }) {
  const id = useId();
  const d = error ? `${id}-e` : hint ? `${id}-h` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children(id, d)}
      {error ? (
        <p id={`${id}-e`} className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-h`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

function Result({ ok, error }: { ok: string | null; error: string | null }) {
  return (
    <div role={error ? "alert" : "status"} aria-live="polite">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {ok && !error && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CircleCheck className="size-4 text-primary" aria-hidden /> {ok}
        </p>
      )}
    </div>
  );
}

function NameForm() {
  const { me, setMe } = useSession();
  const [name, setName] = useState(me.name);
  const [pending, setPending] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    setOk(null);
    if (!n) return setError("El nombre no puede quedar vacío.");
    setError(null);
    setPending(true);
    try {
      setMe(await api<Me>("/api/me", { method: "PATCH", json: { name: n } }));
      setOk("Nombre guardado.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <h3 className="text-sm font-semibold">Nombre</h3>
      <Row label="Cómo te ve el equipo">
        {(id, d) => <Input id={id} aria-describedby={d} name="name" autoComplete="name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />}
      </Row>
      <Result ok={ok} error={error} />
      <Button type="submit" variant="outline" size="sm" disabled={pending || name.trim() === me.name}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Guardar nombre
      </Button>
    </form>
  );
}

function PasswordForm() {
  const { me } = useSession();
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pending, setPending] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<{ pw?: string; pw2?: string }>({});
  const refs = { cur: useRef<HTMLInputElement>(null), pw: useRef<HTMLInputElement>(null), pw2: useRef<HTMLInputElement>(null) };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setOk(null);
    setError(null);
    if (!current) {
      setError("Escribe tu contraseña actual.");
      refs.cur.current?.focus();
      return;
    }
    if (pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX) {
      setFieldErr({ pw: pw.length < PASSWORD_MIN ? `Tiene que tener al menos ${PASSWORD_MIN} caracteres.` : `Como mucho ${PASSWORD_MAX} caracteres.` });
      refs.pw.current?.focus();
      return;
    }
    if (pw !== pw2) {
      setFieldErr({ pw2: "Las dos contraseñas no coinciden." });
      refs.pw2.current?.focus();
      return;
    }
    setFieldErr({});
    setPending(true);
    try {
      await api("/api/me/password", { json: { currentPassword: current, newPassword: pw } });
      setCurrent("");
      setPw("");
      setPw2("");
      setOk("Contraseña cambiada. Hemos cerrado tus sesiones en otros dispositivos.");
    } catch (err) {
      setError(errorText(err));
      refs.cur.current?.focus();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <h3 className="text-sm font-semibold">Contraseña</h3>
      {/* Hidden username so password managers update the right entry. */}
      <input type="email" name="email" autoComplete="username" value={me.email} readOnly hidden />
      <Row label="Contraseña actual">
        {(id) => <Input id={id} ref={refs.cur} type="password" name="current-password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
      </Row>
      <Row label="Contraseña nueva" hint={`Al menos ${PASSWORD_MIN} caracteres.`} error={fieldErr.pw}>
        {(id, d) => (
          <Input id={id} ref={refs.pw} aria-describedby={d} aria-invalid={!!fieldErr.pw || undefined} type="password" name="new-password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        )}
      </Row>
      <Row label="Repite la contraseña nueva" error={fieldErr.pw2}>
        {(id, d) => (
          <Input id={id} ref={refs.pw2} aria-describedby={d} aria-invalid={!!fieldErr.pw2 || undefined} type="password" name="new-password-repeat" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        )}
      </Row>
      <Result ok={ok} error={error} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Cambiar contraseña
      </Button>
    </form>
  );
}
