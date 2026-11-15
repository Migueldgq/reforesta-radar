import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate for the app pages: without the session cookie there is certainly no session, so go
 * straight to the login page instead of painting the app first. The cookie's validity is checked by the
 * app shell (`GET /api/auth/session`) and by the API on every call; this file never trusts the cookie.
 * Signed-in users on /login are sent on by the login page itself, after that real check, so a stale
 * cookie can never cause a redirect loop.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has("radar_session")) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" && !search ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Everything except the API rewrite, Next's assets, files with an extension and the public pages.
    "/((?!api/|_next/|landing|login|invitacion/|restablecer/|recuperar|favicon\\.ico|.*\\.[\\w]+$).*)",
  ],
};
