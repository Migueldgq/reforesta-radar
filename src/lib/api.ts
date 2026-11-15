/**
 * The one way the browser talks to the API (same origin, `/api/*`, see docs/api-auth.md).
 * - Mutating calls carry `X-Radar-CSRF: 1` (also multipart uploads).
 * - A 401 on a protected route sends the user to `/login?next=<current page>`.
 * - Failures throw `ApiError` with a Spanish message ready to show.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Parsed JSON body, for routes that send more than `detail` (e.g. 409 on /api/ingest). */
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Pages that work without a session: a 401 there must never bounce to /login again. */
export const PUBLIC_PATHS = ["/landing", "/login", "/invitacion", "/restablecer", "/recuperar"];

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/** A same-site path to come back to after login; anything else (other origins, `//x`, the login page itself) becomes "/". */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  try {
    const u = new URL(next, "http://radar.invalid");
    if (u.origin !== "http://radar.invalid" || isPublicPath(u.pathname)) return "/";
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return "/";
  }
}

export function loginUrl(next?: string): string {
  const n = safeNext(next);
  return n === "/" ? "/login" : `/login?next=${encodeURIComponent(n)}`;
}

/**
 * Full page load, on purpose: after signing in or out the app must start from scratch (fresh session
 * check, no state from the previous user), which a client-side navigation would not give.
 */
export function hardNavigate(path: string) {
  window.location.assign(path);
}

let redirecting = false;

function toLogin() {
  if (redirecting || typeof window === "undefined" || isPublicPath(window.location.pathname)) return;
  redirecting = true;
  window.location.assign(loginUrl(window.location.pathname + window.location.search));
}

const FALLBACK: Record<number, string> = {
  401: "No has iniciado sesión o la sesión ha caducado.",
  403: "No tienes permiso para hacer esto.",
  404: "No hemos encontrado lo que buscabas.",
  413: "El archivo es demasiado grande.",
  422: "Revisa los datos del formulario.",
  429: "Demasiados intentos. Espera unos minutos y vuelve a probar.",
};

function messageOf(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const b = body as { detail?: unknown; error?: unknown };
    if (typeof b.detail === "string" && b.detail) return b.detail;
    if (typeof b.error === "string" && b.error) return b.error;
  }
  if (FALLBACK[status]) return FALLBACK[status];
  return status >= 500 ? "El servidor del radar ha tenido un problema. Vuelve a intentarlo en un momento." : `Algo ha fallado (${status}).`;
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON body (sets Content-Type). */
  json?: unknown;
  /** Raw body (e.g. FormData); the browser sets Content-Type. */
  body?: BodyInit;
  signal?: AbortSignal;
  /** Do not redirect to /login on 401 (auth forms, where 401 means "wrong password"). */
  noAuthRedirect?: boolean;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.json !== undefined || opts.body !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") headers["X-Radar-CSRF"] = "1";
  let body = opts.body;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body, signal: opts.signal, cache: "no-store", credentials: "same-origin" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("No hay conexión con el servidor del radar. Revisa tu conexión y vuelve a probar.", 0);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && !opts.noAuthRedirect && !path.startsWith("/api/auth/")) toLogin();
    throw new ApiError(messageOf(res.status, data), res.status, data);
  }
  return data as T;
}

/** Message to show for any thrown value. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Algo ha fallado. Vuelve a intentarlo.";
}
