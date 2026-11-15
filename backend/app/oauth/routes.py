"""HTTP side of the authorization server (ADR 0035): discovery documents and the four OAuth endpoints, built from
the MCP SDK's handlers with our provider (app/oauth/provider.py). Hand-rolled here only what the SDK leaves to the
server: the URLs come from settings (never from the Host header), limits that only ever slow down failures, the
error page and browser cookie of /authorize, the resource check at /oauth/token and the hashed client-secret check.

| Path | What |
|---|---|
| `GET /.well-known/oauth-protected-resource/mcp/equipo` (and the root form) | RFC 9728 metadata of the team MCP URL |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata (issuer = RADAR_PUBLIC_URL) |
| `GET /oauth/authorize` | request + cookie `radar_oauth`, 302 to `/autorizar?solicitud=…`; errors: a page here |
| `POST /oauth/token` | code (PKCE) and refresh-token grants, form-encoded |
| `POST /oauth/register` | dynamic client registration (RFC 7591) |
| `POST /oauth/revoke` | RFC 7009: revokes the whole grant of the token |

These paths are outside /api/, so the cookie CSRF rule does not apply to them (they read no cookie, except
/authorize, which only sets one); the body-size middleware caps them at 16 KiB (app/body_limit.py).
"""

import json
import logging
from urllib.parse import parse_qs, urlsplit

from mcp.server.auth.handlers.authorize import AuthorizationHandler
from mcp.server.auth.handlers.register import RegistrationHandler
from mcp.server.auth.handlers.token import TokenHandler
from mcp.server.auth.middleware.client_auth import AuthenticationError
from mcp.server.auth.routes import build_resource_metadata_url
from mcp.server.auth.settings import ClientRegistrationOptions
from mcp.shared.auth import OAuthMetadata, ProtectedResourceMetadata
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, Response
from starlette.routing import Route

from app.auth import throttle
from app.config import settings
from app.oauth.clients import is_loopback
from app.oauth.provider import (
    SCOPE,
    HashedSecretAuthenticator,
    RadarOAuthProvider,
    current_engine,
    pending_browser_nonce,
    same_resource,
)

log = logging.getLogger("auth")

BROWSER_COOKIE = "radar_oauth"
COOKIE_PATH = "/api/oauth/"
provider = RadarOAuthProvider()
_authenticator = HashedSecretAuthenticator(provider)
_authorize = AuthorizationHandler(provider)
_token = TokenHandler(provider, _authenticator)
_register = RegistrationHandler(provider, ClientRegistrationOptions(enabled=True, valid_scopes=[SCOPE],
                                                                    default_scopes=[SCOPE]))  # fmt: skip
NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}


def oauth_available() -> bool:
    """Issuer usable: https, or http on a loopback host (local use). With RADAR_COOKIE_SECURE only https."""
    u = urlsplit(settings.public_url)
    if not settings.mcp_oauth or u.query or u.fragment:
        return False
    if u.scheme == "https":
        return True
    return not settings.cookie_secure and u.scheme == "http" and u.hostname in ("localhost", "127.0.0.1", "::1")


def issuer() -> str:
    return settings.public_url


def resource_metadata_url() -> str:
    return str(build_resource_metadata_url(settings.mcp_team_url))  # type: ignore[arg-type]


def authorization_server_metadata() -> OAuthMetadata:
    base = issuer()
    return OAuthMetadata(
        issuer=base,  # type: ignore[arg-type]
        authorization_endpoint=f"{base}/oauth/authorize",  # type: ignore[arg-type]
        token_endpoint=f"{base}/oauth/token",  # type: ignore[arg-type]
        registration_endpoint=f"{base}/oauth/register",  # type: ignore[arg-type]
        revocation_endpoint=f"{base}/oauth/revoke",  # type: ignore[arg-type]
        scopes_supported=[SCOPE],
        response_types_supported=["code"],
        grant_types_supported=["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported=["none", "client_secret_post", "client_secret_basic"],
        revocation_endpoint_auth_methods_supported=["none", "client_secret_post", "client_secret_basic"],
        code_challenge_methods_supported=["S256"],
        authorization_response_iss_parameter_supported=True,
        service_documentation=None,
    )


def protected_resource_metadata() -> ProtectedResourceMetadata:
    return ProtectedResourceMetadata(
        resource=settings.mcp_team_url,  # type: ignore[arg-type]
        authorization_servers=[issuer()],  # type: ignore[list-item]
        scopes_supported=[SCOPE],
        bearer_methods_supported=["header"],
        resource_name="Reforesta Radar (equipo)",
    )


def challenge(error: str | None = None) -> str:
    """`WWW-Authenticate` of /mcp/equipo (RFC 9728 §5.1, RFC 6750 §3)."""
    parts = [f'resource_metadata="{resource_metadata_url()}"', f'scope="{SCOPE}"']
    if error:
        parts.insert(0, f'error="{error}"')
    return "Bearer " + ", ".join(parts)


def _json(model: OAuthMetadata | ProtectedResourceMetadata) -> Response:
    body = model.model_dump(mode="json", exclude_none=True)
    return JSONResponse(body, headers={"Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*"})


def _not_found() -> Response:
    return JSONResponse({"detail": "No existe."}, status_code=404)


def _too_many(wait: int) -> Response:
    return JSONResponse({"error": "temporarily_unavailable", "error_description": "too many requests"},
                        status_code=429, headers={"Retry-After": str(wait), **NO_STORE})  # fmt: skip


def _ip(request: Request) -> str:
    """Client IP: the TCP peer, or the proxy's X-Forwarded-For when uvicorn trusts it (FORWARDED_ALLOW_IPS). Behind
    the Next.js rewrite without such a proxy every caller shares one IP, so no limit here may refuse a request that
    would succeed (ADR 0035)."""
    return request.client.host if request.client else "unknown"


async def protected_resource(request: Request) -> Response:
    if not oauth_available():
        return _not_found()
    rest = request.path_params.get("rest", "")
    expected = urlsplit(resource_metadata_url()).path.removeprefix("/.well-known/oauth-protected-resource")
    if rest not in ("", expected):  # path form for the team URL, plus the root fallback some clients try
        return _not_found()
    return _json(protected_resource_metadata())


async def authorization_server(request: Request) -> Response:
    if not oauth_available():
        return _not_found()
    if request.path_params.get("rest", "") != urlsplit(issuer()).path.rstrip("/"):
        return _not_found()
    return _json(authorization_server_metadata())


async def _run(request: Request, handler) -> Response:  # noqa: ANN001
    """An SDK (or our) handler with the app's engine available to the provider."""
    token = current_engine.set(request.app.state.engine)
    try:
        return await handler(request)
    finally:
        current_engine.reset(token)


def _count_failure(request: Request, limiter: throttle.Throttle) -> int | None:
    """Records a failed request from the client's IP; seconds to wait when that IP was already over its limit."""
    ip = _ip(request)
    wait = limiter.retry_after(ip)
    limiter.hit(ip)
    return wait


# ---- /oauth/authorize ----

ERROR_PAGE = """<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>No se puede conectar · Reforesta Radar</title>
<style>body{{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f7f7f7;color:#1a1a1a}}
main{{max-width:28rem;margin:12vh auto;padding:1.5rem;background:#fff;border:1px solid #e3e3e3;border-radius:.75rem}}
h1{{font-size:1.125rem;margin:0 0 .5rem}}p{{margin:.5rem 0;color:#555}}code{{font-size:.8rem;color:#777}}</style>
</head><body><main><h1>No se puede conectar</h1><p>{message}</p>
<p>Vuelve a tu asistente y pulsa «Conectar» otra vez. Si no lo has pedido tú, cierra esta página.</p>
<p><code>{code}</code></p></main></body></html>"""
ERROR_MESSAGES = {
    "invalid_target": "El asistente ha pedido una dirección del radar que no existe.",
    "unsupported_response_type": "El asistente ha hecho una petición que el radar no admite.",
    "temporarily_unavailable": "Hay demasiadas peticiones ahora mismo. Espera unos minutos.",
}
ERROR_HEADERS = {
    **NO_STORE,
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
}


def _error_page(code: str, status: int = 400, headers: dict[str, str] | None = None) -> Response:
    safe = code if code.replace("_", "").isalpha() else "invalid_request"
    message = ERROR_MESSAGES.get(safe, "La solicitud de conexión no es válida o el asistente no está registrado.")
    return HTMLResponse(ERROR_PAGE.format(message=message, code=safe), status_code=status,
                        headers={**ERROR_HEADERS, **(headers or {})})  # fmt: skip


def _error_of(response: Response) -> str:
    """The OAuth error code of an SDK authorize error, whether it came as a redirect or as JSON."""
    location = response.headers.get("location")
    if location:
        return parse_qs(urlsplit(location).query).get("error", ["invalid_request"])[0]
    try:
        return str(json.loads(bytes(response.body)).get("error", "invalid_request"))
    except (ValueError, AttributeError):
        return "invalid_request"


async def authorize(request: Request) -> Response:
    """Success (a request recorded for the consent page) is never throttled. Any error found before the person has
    decided is shown here, on the radar, and never sent to the client's redirect URI (RFC 9700 §4.11.2: the URI was
    chosen by whoever registered the client, so redirecting would make this an open redirector), except to a loopback
    URI (a program on the person's own computer). Only failures count towards the per-IP limit."""
    if not oauth_available():
        return _not_found()
    pending_browser_nonce.set(None)
    response = await _run(request, _authorize.handle)
    nonce = pending_browser_nonce.get()
    if nonce is not None and response.status_code == 302:
        response.set_cookie(BROWSER_COOKIE, nonce, max_age=600, path=COOKIE_PATH, httponly=True, samesite="lax",
                            secure=settings.cookie_secure)  # fmt: skip
        response.headers["Referrer-Policy"] = "no-referrer"
        return response
    wait = _count_failure(request, throttle.oauth_authorize_failures)
    location = response.headers.get("location")
    if response.status_code == 302 and location and is_loopback(location) and not wait:
        response.headers["Referrer-Policy"] = "no-referrer"
        return response
    if wait:
        return _error_page("temporarily_unavailable", 429, {"Retry-After": str(wait)})
    return _error_page(_error_of(response))


# ---- /oauth/token and /oauth/revoke ----


async def _token_with_resource_check(request: Request) -> Response:
    # RFC 8707 §2.2: a token request may name the resource; it must be the one the grant is for. Read the body the
    # way the SDK handler does (urlencoded or multipart), so no encoding skips this check.
    resources = (await request.form()).getlist("resource")
    if len(resources) > 1 or any(not isinstance(r, str) or not same_resource(r, settings.mcp_team_url)
                                 for r in resources):  # fmt: skip
        return JSONResponse({"error": "invalid_target", "error_description": "unknown resource"}, status_code=400,
                            headers=NO_STORE)  # fmt: skip
    return await _token.handle(request)


def _error_code(response: Response) -> str | None:
    try:
        return json.loads(bytes(response.body)).get("error")
    except (ValueError, AttributeError):
        return None


async def _failures_only(request: Request, handler) -> Response:  # noqa: ANN001
    """Processes first: a correct request always goes through, whatever others from the same IP did. Only failures
    count; once the IP is over its limit, further failures answer 429, except `invalid_grant` (a dead code or refresh
    token), which the client needs to see to start a new sign-in."""
    if not oauth_available():
        return _not_found()
    response = await _run(request, handler)
    if response.status_code < 400:
        return response
    wait = _count_failure(request, throttle.oauth_token_failures)
    if wait and _error_code(response) != "invalid_grant":
        return _too_many(wait)
    return response


async def token(request: Request) -> Response:
    return await _failures_only(request, _token_with_resource_check)


# ---- /oauth/register ----


async def register(request: Request) -> Response:
    """Unauthenticated by nature (RFC 7591). A global budget per 10 minutes bounds how fast the client table fills
    (with the cap and the purge in the provider); per IP only when a trusted proxy gives real client IPs (otherwise
    every caller shares one IP and the per-IP limit would be the global one)."""
    if not oauth_available():
        return _not_found()
    limiters = [throttle.oauth_register_global]
    if settings.trusted_proxy:
        limiters.append(throttle.oauth_register_ip)
    keys = ["*", _ip(request)]
    for limiter, key in zip(limiters, keys, strict=False):
        if wait := limiter.retry_after(key):
            log.warning("oauth: registration refused, %s over its limit", "budget" if key == "*" else "ip")
            return _too_many(wait)
    for limiter, key in zip(limiters, keys, strict=False):
        limiter.hit(key)
    response = await _run(request, _register.handle)
    response.headers.update(NO_STORE)
    return response


async def _revoke(request: Request) -> Response:
    """RFC 7009. Hand-rolled: the SDK's handler requires a `client_secret` field even from public clients. Revokes the
    whole grant of an access or refresh token of the authenticated client; anything else is 200 too (§2.2)."""
    try:
        client = await _authenticator.authenticate_request(request)
    except AuthenticationError as e:
        return JSONResponse({"error": "invalid_client", "error_description": e.message}, status_code=401,
                            headers=NO_STORE)  # fmt: skip
    value = (await request.form()).get("token")
    if not isinstance(value, str) or not value:
        return JSONResponse({"error": "invalid_request", "error_description": "token is required"}, status_code=400,
                            headers=NO_STORE)  # fmt: skip
    token = await provider.load_access_token(value) or await provider.load_refresh_token(client, value)
    if token is not None and token.client_id == client.client_id:
        await provider.revoke_token(token)
    return Response(status_code=200, headers=NO_STORE)


async def revoke(request: Request) -> Response:
    return await _failures_only(request, _revoke)


routes = [
    Route("/.well-known/oauth-protected-resource{rest:path}", protected_resource, methods=["GET"]),
    Route("/.well-known/oauth-authorization-server{rest:path}", authorization_server, methods=["GET"]),
    Route("/oauth/authorize", authorize, methods=["GET"]),
    Route("/oauth/token", token, methods=["POST"]),
    Route("/oauth/register", register, methods=["POST"]),
    Route("/oauth/revoke", revoke, methods=["POST"]),
]

__all__ = ["routes", "challenge", "oauth_available", "resource_metadata_url", "BROWSER_COOKIE", "COOKIE_PATH"]
