"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { CircleAlert, CircleCheck, Clock, Link2Off, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError, errorText, hardNavigate, safeNext } from "@/lib/api";
import { PASSWORD_MAX, PASSWORD_MIN, type SessionInfo } from "@/lib/team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { BrandMark, fetchSession } from "./session";

/* ---------- Layout and fields ---------- */

function AuthPage({ title, sub, children, footer }: { title: string; sub?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <main className="w-full max-w-sm">
        <Link href="/landing" className="mx-auto mb-8 flex w-fit rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label="Reforesta Radar, sobre el proyecto">
          <BrandMark />
        </Link>
        <div className="rounded-xl border bg-background p-6 shadow-xs sm:p-7">
          <div className="mb-6 space-y-1.5">
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            {sub && <div className="text-sm text-muted-foreground">{sub}</div>}
          </div>
          {children}
        </div>
        {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
      </main>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint && hintId, error && errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, ...(error ? { "aria-invalid": true as const } : {}) })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  // Always mounted so screen readers announce the text when it appears.
  return (
    <div role="alert" aria-live="assertive" className={cn(!message && "sr-only")}>
      {message && (
        <p className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{message}</span>
        </p>
      )}
    </div>
  );
}

function Submit({ pending, children, pendingLabel, waitSeconds = 0 }: { pending: boolean; children: ReactNode; pendingLabel: string; waitSeconds?: number }) {
  const off = pending || waitSeconds > 0;
  return (
    <Button type="submit" className="w-full" disabled={off} aria-disabled={off}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {pending ? pendingLabel : waitSeconds > 0 ? `Espera ${waitSeconds > 90 ? `${Math.ceil(waitSeconds / 60)} min` : `${waitSeconds} s`}` : children}
    </Button>
  );
}

function Loading() {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> Comprobando el enlace…
    </p>
  );
}

/** Password twice, with the contract's limits checked before sending. */
function usePasswordPair() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [shown, setShown] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);
  const pw2Ref = useRef<HTMLInputElement>(null);
  const pwError = !shown ? null : pw.length < PASSWORD_MIN ? `Tiene que tener al menos ${PASSWORD_MIN} caracteres.` : pw.length > PASSWORD_MAX ? `Como mucho ${PASSWORD_MAX} caracteres.` : null;
  const pw2Error = !shown || pwError ? null : pw !== pw2 ? "Las dos contraseñas no coinciden." : null;
  /** Shows the errors and focuses the first wrong field; true when both are fine. */
  const validate = () => {
    setShown(true);
    if (pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX) {
      pwRef.current?.focus();
      return false;
    }
    if (pw !== pw2) {
      pw2Ref.current?.focus();
      return false;
    }
    return true;
  };
  const fields = (
    <>
      <Field label="Contraseña nueva" hint={`Al menos ${PASSWORD_MIN} caracteres. Una frase que recuerdes sirve.`} error={pwError}>
        {(p) => <Input {...p} ref={pwRef} type="password" name="new-password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} />}
      </Field>
      <Field label="Repite la contraseña" error={pw2Error}>
        {(p) => <Input {...p} ref={pw2Ref} type="password" name="new-password-repeat" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />}
      </Field>
    </>
  );
  return { pw, fields, validate };
}

/* ---------- Login ---------- */

export function LoginView() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  // Set by the API client when a session ran out mid-use (`cambio`: the request was a change, so it was lost).
  const expired = params.get("caducada") === "1" ? (params.get("cambio") === "1" ? "Tu sesión ha caducado. Vuelve a entrar; el último cambio no se guardó." : "Tu sesión ha caducado. Vuelve a entrar.") : null;
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After a 429 the button stays off for the seconds the API asks (Retry-After).
  const [waitLeft, setWaitLeft] = useState(0);
  const waiting = waitLeft > 0;
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setWaitLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, [waiting]);

  useEffect(() => {
    let alive = true;
    fetchSession()
      .then((s) => {
        if (!alive) return;
        if (s.user) window.location.replace(next);
        else setSession(s);
      })
      .catch(() => alive && setSession({ user: null, forgotPassword: false }));
    return () => {
      alive = false;
    };
  }, [next]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending || waitLeft > 0) return;
    if (!email.trim() || !password) {
      setError("Escribe tu correo y tu contraseña.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api<SessionInfo>("/api/auth/login", { json: { email: email.trim(), password }, noAuthRedirect: true });
      hardNavigate(next);
    } catch (err) {
      setError(errorText(err));
      if (err instanceof ApiError && err.status === 429 && err.retryAfter > 0) setWaitLeft(err.retryAfter);
      setPassword("");
      setPending(false);
      pwRef.current?.focus();
    }
  }

  return (
    <AuthPage
      title="Entrar"
      sub="Con el correo y la contraseña de tu cuenta del equipo."
      footer={
        <Link href="/landing" className="hover:text-foreground hover:underline">
          ¿Qué es Reforesta Radar?
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {expired && !error && (
          <p role="status" className="flex gap-2 rounded-md border bg-muted/50 px-3 py-2.5 text-sm">
            <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>{expired}</span>
          </p>
        )}
        <Field label="Correo electrónico">
          {(p) => (
            <Input
              {...p}
              type="email"
              name="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Contraseña">
          {(p) => <Input {...p} ref={pwRef} type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <FormError message={error} />
        <Submit pending={pending} pendingLabel="Entrando…" waitSeconds={waitLeft}>
          Entrar
        </Submit>
        {session &&
          (session.forgotPassword ? (
            <p className="text-center text-sm">
              <Link href="/recuperar" className="text-muted-foreground hover:text-foreground hover:underline">
                ¿Olvidaste tu contraseña?
              </Link>
            </p>
          ) : (
            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              Si no recuerdas tu contraseña, pídele a un administrador un enlace para restablecerla.
            </p>
          ))}
      </form>
    </AuthPage>
  );
}

/* ---------- Links with a token (invitation, reset) ---------- */

function useToken(): string {
  const p = useParams<{ token: string }>();
  return typeof p.token === "string" ? decodeURIComponent(p.token) : "";
}

type Lookup<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "invalid"; message: string } | { state: "error"; message: string };

function useLookup<T>(path: string, token: string): [Lookup<T>, () => void] {
  const [res, setRes] = useState<Lookup<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    api<T>(path, { json: { token }, noAuthRedirect: true })
      .then((data) => alive && setRes({ state: "ok", data }))
      .catch((e) => {
        if (!alive) return;
        const invalid = e instanceof ApiError && (e.status === 404 || e.status === 422);
        setRes({ state: invalid ? "invalid" : "error", message: errorText(e) });
      });
    return () => {
      alive = false;
    };
  }, [path, token, attempt]);
  return [
    res,
    () => {
      setRes({ state: "loading" });
      setAttempt((n) => n + 1);
    },
  ];
}

function InvalidLink({ message, kind }: { message: string; kind: "invitation" | "reset" }) {
  return (
    <AuthPage title="Este enlace ya no sirve">
      <div className="space-y-4">
        <p className="flex gap-2.5 text-sm">
          <Link2Off className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{message}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          {kind === "invitation"
            ? "Las invitaciones sirven una sola vez y caducan a los 7 días. Si ya creaste tu cuenta, entra con tu correo."
            : "Los enlaces para restablecer sirven una sola vez y caducan a las 24 horas."}
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Ir a entrar</Link>
        </Button>
      </div>
    </AuthPage>
  );
}

function LookupError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <AuthPage title="No hemos podido comprobar el enlace">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground" role="alert">
          {message}
        </p>
        <Button variant="outline" className="w-full" onClick={retry}>
          Reintentar
        </Button>
      </div>
    </AuthPage>
  );
}

export function InvitationView() {
  const token = useToken();
  const [lookup, retry] = useLookup<{ email: string; name: string; role: string; expiresAt: string }>("/api/auth/invitation", token);
  if (lookup.state === "loading")
    return (
      <AuthPage title="Crear tu cuenta">
        <Loading />
      </AuthPage>
    );
  if (lookup.state === "invalid") return <InvalidLink message={lookup.message} kind="invitation" />;
  if (lookup.state === "error") return <LookupError message={lookup.message} retry={retry} />;
  return <InvitationForm token={token} email={lookup.data.email} initialName={lookup.data.name} />;
}

function InvitationForm({ token, email, initialName }: { token: string; email: string; initialName: string }) {
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const pair = usePasswordPair();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    const n = name.trim();
    if (!n) {
      setNameError("Escribe cómo quieres que te vea el equipo.");
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    if (!pair.validate()) return;
    setPending(true);
    try {
      await api<SessionInfo>("/api/auth/invitation/accept", { json: { token, name: n.slice(0, 100), password: pair.pw }, noAuthRedirect: true });
      hardNavigate("/");
    } catch (err) {
      setError(errorText(err));
      setPending(false);
    }
  }

  return (
    <AuthPage title="Crear tu cuenta" sub="Te han invitado al radar del equipo. Elige tu nombre y una contraseña.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Correo electrónico" hint="Es el de la invitación; no se puede cambiar.">
          {(p) => <Input {...p} type="email" name="email" autoComplete="username" value={email} readOnly className="bg-muted/60 text-muted-foreground" />}
        </Field>
        <Field label="Tu nombre" hint="Así te verá el resto del equipo." error={nameError}>
          {(p) => <Input {...p} ref={nameRef} name="name" autoComplete="name" maxLength={100} autoFocus value={name} onChange={(e) => setName(e.target.value)} required />}
        </Field>
        {pair.fields}
        <FormError message={error} />
        <Submit pending={pending} pendingLabel="Creando la cuenta…">
          Crear cuenta y entrar
        </Submit>
      </form>
    </AuthPage>
  );
}

export function ResetView() {
  const token = useToken();
  const [lookup, retry] = useLookup<{ email: string; expiresAt: string }>("/api/auth/reset", token);
  if (lookup.state === "loading")
    return (
      <AuthPage title="Nueva contraseña">
        <Loading />
      </AuthPage>
    );
  if (lookup.state === "invalid") return <InvalidLink message={lookup.message} kind="reset" />;
  if (lookup.state === "error") return <LookupError message={lookup.message} retry={retry} />;
  return <ResetForm token={token} email={lookup.data.email} />;
}

function ResetForm({ token, email }: { token: string; email: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pair = usePasswordPair();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    if (!pair.validate()) return;
    setPending(true);
    try {
      await api<SessionInfo>("/api/auth/reset/accept", { json: { token, password: pair.pw }, noAuthRedirect: true });
      hardNavigate("/");
    } catch (err) {
      setError(errorText(err));
      setPending(false);
    }
  }

  return (
    <AuthPage title="Nueva contraseña" sub="Al guardarla se cierran las sesiones abiertas en otros dispositivos.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {/* Lets password managers attach the new password to the right account. */}
        <Field label="Cuenta">
          {(p) => <Input {...p} type="email" name="email" autoComplete="username" value={email} readOnly className="bg-muted/60 text-muted-foreground" />}
        </Field>
        {pair.fields}
        <FormError message={error} />
        <Submit pending={pending} pendingLabel="Guardando…">
          Guardar y entrar
        </Submit>
      </form>
    </AuthPage>
  );
}

/* ---------- Forgot password (only when the API can send e-mail) ---------- */

export function ForgotView() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSession()
      .then((s) => alive && setSession(s))
      .catch(() => alive && setSession({ user: null, forgotPassword: false }));
    return () => {
      alive = false;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await api("/api/auth/forgot", { json: { email: email.trim() }, noAuthRedirect: true });
      setSent(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  const back = (
    <Link href="/login" className="hover:text-foreground hover:underline">
      Volver a entrar
    </Link>
  );

  if (!session)
    return (
      <AuthPage title="Recuperar la contraseña" footer={back}>
        <p className="text-sm text-muted-foreground" role="status">
          Cargando…
        </p>
      </AuthPage>
    );
  if (!session.forgotPassword)
    return (
      <AuthPage title="Recuperar la contraseña" footer={back}>
        <p className="text-sm text-muted-foreground">Si no recuerdas tu contraseña, pídele a un administrador un enlace para restablecerla.</p>
      </AuthPage>
    );
  if (sent)
    return (
      <AuthPage title="Revisa tu correo" footer={back}>
        <p className="flex gap-2.5 text-sm" role="status">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>Si hay una cuenta con ese correo, te llegará un enlace en unos minutos. Sirve una vez y caduca a las 24 horas.</span>
        </p>
      </AuthPage>
    );
  return (
    <AuthPage title="Recuperar la contraseña" sub="Te enviaremos un enlace para elegir una nueva." footer={back}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Correo electrónico">
          {(p) => <Input {...p} type="email" name="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <FormError message={error} />
        <Submit pending={pending} pendingLabel="Enviando…">
          Enviar el enlace
        </Submit>
      </form>
    </AuthPage>
  );
}
