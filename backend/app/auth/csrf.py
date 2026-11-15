"""CSRF guard for state-changing requests under /api/.

The browser calls the API same-origin through the Next.js proxy, so a legitimate request can always:
- carry the custom header `X-Radar-CSRF: 1` (a cross-site HTML form cannot set headers; a cross-origin fetch with
  it needs a CORS preflight, which the API does not grant with credentials), and
- come with `Sec-Fetch-Site: same-origin` (modern browsers; the proxy forwards it unchanged). `cross-site` and
  `same-site` (a sibling subdomain, which SameSite=Lax does not stop) are rejected. Absent (old browsers, curl)
  is accepted: the custom header still applies.

Together with the SameSite=Lax session cookie this covers login CSRF as well (login is a POST too).
"""

import logging

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import RequestResponseEndpoint

log = logging.getLogger("auth")

HEADER = "X-Radar-CSRF"
UNSAFE = frozenset({"POST", "PUT", "PATCH", "DELETE"})
ALLOWED_SITES = frozenset({"same-origin", "none"})
FORBIDDEN = "Petición rechazada (falta la cabecera X-Radar-CSRF o viene de otro sitio)."


def csrf_ok(request: Request) -> bool:
    if request.method not in UNSAFE or not request.url.path.startswith("/api/"):
        return True
    site = request.headers.get("sec-fetch-site")
    return (site is None or site in ALLOWED_SITES) and request.headers.get(HEADER) == "1"


async def csrf_middleware(request: Request, call_next: RequestResponseEndpoint) -> Response:
    if not csrf_ok(request):
        log.warning("csrf: rejected %s %s (sec-fetch-site=%s)", request.method, request.url.path,
                    request.headers.get("sec-fetch-site"))  # fmt: skip
        return JSONResponse({"detail": FORBIDDEN}, status_code=403)
    return await call_next(request)
