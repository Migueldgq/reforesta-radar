"""HTTP side of the authorization server (ADR 0035): discovery documents and the four OAuth endpoints, built from
the MCP SDK's handlers with our provider (app/oauth/provider.py). Hand-rolled here only what the SDK leaves to the
server: the URLs come from settings (never from the Host header), throttles, the browser cookie of /authorize, the
resource check at /oauth/token and the hashed client-secret check.

| Path | What |
|---|---|
| `GET /.well-known/oauth-protected-resource/mcp/equipo` (and the root form) | RFC 9728 metadata of the team MCP URL |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata (issuer = RADAR_PUBLIC_URL) |
| `GET /oauth/authorize` | records the request, cookie `radar_oauth`, 302 to the web's `/autorizar?solicitud=…` |
| `POST /oauth/token` | code (PKCE) and refresh-token grants, form-encoded |
| `POST /oauth/register` | dynamic client registration (RFC 7591) |
| `POST /oauth/revoke` | RFC 7009: revokes the whole grant of the token |

These paths are outside /api/, so the cookie CSRF rule does not apply to them (they read no cookie, except
/authorize, which only sets one); the body-size middleware caps them at 16 KiB (app/body_limit.py).
"""

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
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from app.auth import throttle
from app.config import settings
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


class _Endpoint:
    """Runs an SDK handler with the app's engine, behind the availability check and an optional per-IP throttle."""

    def __init__(self, handler, limiter: throttle.Throttle | None = None, count: str = "all") -> None:  # noqa: ANN001
        self.handler = handler
        self.limiter = limiter
        self.count = count  # "all": every request counts; "failures": only answers >= 400

    async def run(self, request: Request) -> Response:
        if not oauth_available():
            return _not_found()
        ip = _ip(request)
        if self.limiter and (wait := self.limiter.retry_after(ip)):
            return _too_many(wait)
        if self.limiter and self.count == "all":
            self.limiter.hit(ip)
        token = current_engine.set(request.app.state.engine)
        try:
            response = await self.handler(request)
        finally:
            current_engine.reset(token)
        if self.limiter and self.count == "failures" and response.status_code >= 400:
            self.limiter.hit(ip)
        return response


async def authorize(request: Request) -> Response:
    pending_browser_nonce.set(None)
    response = await _Endpoint(_authorize.handle, throttle.oauth_authorize).run(request)
    nonce = pending_browser_nonce.get()
    if nonce is not None and response.status_code == 302:
        response.set_cookie(BROWSER_COOKIE, nonce, max_age=600, path=COOKIE_PATH, httponly=True, samesite="lax",
                            secure=settings.cookie_secure)  # fmt: skip
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


async def _form(request: Request) -> dict[str, list[str]]:
    body = await request.body()  # cached on the Request: the SDK handler reads it again
    try:
        return parse_qs(body.decode(), keep_blank_values=True)
    except UnicodeDecodeError:
        return {}


async def _token_with_resource_check(request: Request) -> Response:
    # RFC 8707 §2.2: a token request may name the resource; it must be the one the grant is for.
    resources = (await _form(request)).get("resource", [])
    if any(not same_resource(r, settings.mcp_team_url) for r in resources) or len(resources) > 1:
        return JSONResponse({"error": "invalid_target", "error_description": "unknown resource"}, status_code=400,
                            headers=NO_STORE)  # fmt: skip
    return await _token.handle(request)


async def token(request: Request) -> Response:
    return await _Endpoint(_token_with_resource_check, throttle.oauth_token_failures, count="failures").run(request)


async def register(request: Request) -> Response:
    response = await _Endpoint(_register.handle, throttle.oauth_register).run(request)
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
    return await _Endpoint(_revoke, throttle.oauth_token_failures, count="failures").run(request)


routes = [
    Route("/.well-known/oauth-protected-resource{rest:path}", protected_resource, methods=["GET"]),
    Route("/.well-known/oauth-authorization-server{rest:path}", authorization_server, methods=["GET"]),
    Route("/oauth/authorize", authorize, methods=["GET"]),
    Route("/oauth/token", token, methods=["POST"]),
    Route("/oauth/register", register, methods=["POST"]),
    Route("/oauth/revoke", revoke, methods=["POST"]),
]

__all__ = ["routes", "challenge", "oauth_available", "resource_metadata_url", "BROWSER_COOKIE", "COOKIE_PATH"]
