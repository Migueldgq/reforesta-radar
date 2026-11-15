import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate for the app pages: without the session cookie there is certainly no session, so go
 * straight to the login page instead of painting the app first. The bare domain (`/`, no query) goes to the
 * public landing instead: a visitor without a session sees what the radar is. The cookie's validity is
 * checked by the app shell (`GET /api/auth/session`, which sends a stale cookie to /login) and by the API on
 * every call; this file never trusts the cookie. Signed-in users on /login are sent on by the login page
 * itself, after that real check, so a stale cookie can never cause a redirect loop.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has("radar_session")) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  const url = request.nextUrl.clone();
  if (pathname === "/" && !search) {
    url.pathname = "/landing";
    return NextResponse.redirect(url);
  }
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Everything except the API, MCP and OAuth rewrites, Next's assets, files with an extension, the public pages
    // and the health check Traefik polls (/healthz).
    "/((?!api/|mcp$|mcp/equipo$|oauth/|\\.well-known/|_next/|landing|login|invitacion/|restablecer/|recuperar|healthz$|favicon\\.ico|.*\\.[\\w]+$).*)",
  ],
};
