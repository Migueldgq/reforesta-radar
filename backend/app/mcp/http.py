"""/mcp: the read-only MCP server over Streamable HTTP, inside the API (same process, same database).

Order of checks on every request (all before any MCP parsing):
1. body size: `BodyLimitMiddleware` (1 MiB, app/body_limit.py) and the SDK's own limit;
2. Host and Origin (DNS-rebinding protection, the SDK's `TransportSecurityMiddleware`): 421 / 403;
3. credentials. Only `Authorization: Bearer rr_pat_…` (app/auth/pats.py) is read: the session cookie and query
   strings are ignored, so there is no CSRF surface.
   - no Authorization header: public tools (when RADAR_MCP_PUBLIC), at most RADAR_MCP_PUBLIC_RATE requests per
     minute per client IP (429 + Retry-After beyond); with RADAR_MCP_PUBLIC=false, 401;
   - a header that is not a valid, active token: always 401 with `WWW-Authenticate: Bearer … error="invalid_token"`
     (never a silent downgrade to public); 30 of those per IP in 15 min, then 429 for that IP;
   - a valid token: team view (the tools read the person from the scope state).
The SDK runs stateless with plain JSON responses: no MCP sessions to keep, nothing to resume.
"""

import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecurityMiddleware, TransportSecuritySettings
from starlette.requests import Request
from starlette.types import Receive, Scope, Send

from app.auth import pats, throttle
from app.body_limit import DEFAULT_LIMIT
from app.config import settings
from app.mcp.server import USER_STATE_KEY, mcp

log = logging.getLogger("mcp")
REALM = 'Bearer realm="reforesta-radar"'


def security_settings() -> TransportSecuritySettings:
    hosts = ["localhost", "127.0.0.1", "[::1]", "localhost:*", "127.0.0.1:*", "[::1]:*", "api", "api:*"]
    origins = ["http://localhost", "http://127.0.0.1", "http://localhost:*", "http://127.0.0.1:*", "http://[::1]:*"]
    for url in (settings.public_url, settings.mcp_public_url):
        u = urlsplit(url)
        if u.netloc:
            hosts.append(u.netloc)
            origins.append(f"{u.scheme}://{u.netloc}")
    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=sorted({*hosts, *settings.mcp_allowed_hosts}),
        allowed_origins=sorted({*origins, *settings.mcp_allowed_origins}),
    )


async def _reply(send: Send, status: int, detail: str, headers: dict[str, str] | None = None) -> None:
    body = json.dumps({"detail": detail}, ensure_ascii=False).encode()
    raw = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
    raw += [(k.lower().encode(), v.encode("latin-1")) for k, v in (headers or {}).items()]
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


class McpEndpoint:
    """ASGI app mounted at /mcp. `run()` must be active (the API lifespan enters it)."""

    def __init__(self) -> None:
        self._manager: StreamableHTTPSessionManager | None = None
        self._security = security_settings()

    @asynccontextmanager
    async def run(self) -> AsyncIterator[None]:
        """A fresh SDK session manager per run (one can only run once)."""
        self._security = security_settings()
        mcp.streamable_http_app(stateless_http=True, json_response=True, transport_security=self._security,
                                max_request_body_size=DEFAULT_LIMIT)  # fmt: skip
        manager = mcp.session_manager
        async with manager.run():
            self._manager = manager
            try:
                yield
            finally:
                self._manager = None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if self._manager is None or scope["type"] != "http":
            await _reply(send, 503, "El servidor MCP no está en marcha.")
            return
        request = Request(scope)
        if (refused := await TransportSecurityMiddleware(self._security).validate_request(request)) is not None:
            await refused(scope, receive, send)
            return
        ip = request.client.host if request.client else "unknown"
        auth = request.headers.get("authorization")
        user: pats.TokenUser | None = None
        if auth is None:
            if not settings.mcp_public:
                await _reply(
                    send, 401, "Hace falta un token personal (Authorization: Bearer).", {"WWW-Authenticate": REALM}
                )
                return
            if wait := throttle.mcp_public.retry_after(ip):
                await _reply(send, 429, "Demasiadas peticiones sin token. Espera un poco.", {"Retry-After": str(wait)})
                return
            throttle.mcp_public.hit(ip)
        else:
            if wait := throttle.mcp_bad_token.retry_after(ip):
                await _reply(
                    send, 429, "Demasiados tokens no válidos. Espera unos minutos.", {"Retry-After": str(wait)}
                )
                return
            scheme, _, token = auth.partition(" ")
            if scheme.lower() == "bearer" and pats.looks_like_token(token.strip()):
                async with scope["app"].state.engine.begin() as conn:
                    user = await pats.token_user(conn, token.strip())
            if user is None:
                throttle.mcp_bad_token.hit(ip)
                log.info("mcp: invalid token ip=%s", ip)
                challenge = f'{REALM}, error="invalid_token", error_description="unknown, expired or revoked token"'
                await _reply(
                    send, 401, "El token no es válido, ha caducado o se ha revocado.", {"WWW-Authenticate": challenge}
                )
                return
        scope.setdefault("state", {})[USER_STATE_KEY] = user
        await self._manager.handle_request(scope, receive, send)


endpoint = McpEndpoint()
