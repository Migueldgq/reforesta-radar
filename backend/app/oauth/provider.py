"""The radar as its own OAuth 2.1 authorization server for assistants (ADR 0035, docs/mcp.md), behind the MCP SDK's
`OAuthAuthorizationServerProvider` interface: the SDK's handlers parse and check the requests (PKCE S256, redirect
URI, grant types), this module stores and decides.

- Every secret is opaque random (32 bytes) and stored only as its sha256 (app/auth/tokens.py), like sessions and
  personal tokens: a database leak yields nothing usable. Prefixes: `rr_at_` access, `rr_rt_` refresh.
- /oauth/authorize never signs anyone in: it records the request (10 minutes, bound to the browser by a cookie nonce)
  and sends the browser to the web's consent page, `/autorizar?solicitud=…`, behind the normal login.
- Code: single use, 60 s, bound to client, redirect URI, PKCE challenge, person and resource. Presenting a used code
  again revokes the grant it produced (RFC 6749 §4.1.2).
- Access token: 1 hour, audience = the grant's resource (the team MCP URL), checked on every /mcp/equipo call.
- Refresh token: rotated on every use. Presenting a rotated one again revokes the whole grant (reuse detection).
  The grant (and so the refresh token) dies after REFRESH_DAYS without use.
- A grant stops working when the person is deactivated and is revoked by `revoke_sessions` (password change or
  reset, role change, deactivation), by "Desconectar" in Mi cuenta and by /oauth/revoke.
"""

import contextvars
import hmac
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from mcp.server.auth.middleware.client_auth import AuthenticationError, ClientAuthenticator
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    RefreshToken,
    RegistrationError,
    TokenError,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine
from starlette.requests import Request

from app.auth.tokens import hash_token, new_token
from app.config import settings
from app.db.tables import oauth_clients, oauth_codes, oauth_grants, oauth_requests, oauth_tokens, users
from app.oauth.clients import RadarClient, clean_name, registration_problem

log = logging.getLogger("auth")

SCOPE = "radar:leer"
ACCESS_PREFIX = "rr_at_"
REFRESH_PREFIX = "rr_rt_"
TOKEN_LENGTH = 6 + 43
ACCESS_TTL = timedelta(hours=1)
REFRESH_DAYS = 30
CODE_TTL = timedelta(seconds=60)
REQUEST_TTL = timedelta(minutes=10)
UNUSED_CLIENT_TTL = timedelta(hours=24)  # a registration nobody authorised is deleted after this
UNUSED_CLIENT_TTL_NEAR_CAP = timedelta(minutes=10)  # ...or after this once the table is 80 % full (= REQUEST_TTL)
NEAR_CAP = 0.8
REUSE_GRACE = timedelta(seconds=10)  # a used code or rotated refresh token again within this: refused, not revoked
IDLE_CLIENT_TTL = timedelta(days=90)  # a client with no live grant and no use for this long, too
MAX_CLIENTS = 500
USED_EVERY = timedelta(minutes=5)  # grants' last_used_at is written at most this often
AUTH_METHODS = ("none", "client_secret_post", "client_secret_basic")
GRANT_TYPES = frozenset({"authorization_code", "refresh_token"})
PKCE_CHALLENGE = re.compile(r"^[A-Za-z0-9_-]{43}$")  # base64url(sha256) without padding
MAX_STATE = 512

# The engine of the app serving the request (set by app/oauth/routes.py around every SDK handler call).
current_engine: contextvars.ContextVar[AsyncEngine] = contextvars.ContextVar("radar_oauth_engine")
# The browser nonce of the request /oauth/authorize just recorded; the route puts it in a cookie.
pending_browser_nonce: contextvars.ContextVar[str | None] = contextvars.ContextVar("radar_oauth_nonce", default=None)


def _now() -> datetime:
    return datetime.now(UTC)


def same_resource(a: str | None, b: str) -> bool:
    return a is not None and a.rstrip("/").lower() == b.rstrip("/").lower()


@dataclass(frozen=True)
class GrantUser:
    """Who an access token speaks for (what app/mcp/server.py reads: `.name`)."""

    user_id: int
    name: str
    grant_id: int
    client_id: str
    resource: str


def _engine() -> AsyncEngine:
    return current_engine.get()


async def _client_row(conn: AsyncConnection, client_id: str):  # noqa: ANN202 - a Row
    if not client_id or len(client_id) > 100:
        return None
    return (await conn.execute(select(oauth_clients).where(oauth_clients.c.client_id == client_id))).first()


def _client(row) -> RadarClient:  # noqa: ANN001
    return RadarClient(
        client_id=row.client_id,
        client_name=row.name,
        display_name=row.name,
        redirect_uris=row.redirect_uris,
        token_endpoint_auth_method=row.auth_method,
        grant_types=sorted(GRANT_TYPES),
        response_types=["code"],
        scope=SCOPE,
        secret_hash=row.secret_hash,
    )


async def revoke_grant(conn: AsyncConnection, grant_id: int) -> None:
    await conn.execute(
        update(oauth_grants)
        .where(oauth_grants.c.id == grant_id, oauth_grants.c.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


async def revoke_all(conn: AsyncConnection, user_id: int) -> None:
    """Every grant of the person (called by `revoke_sessions`)."""
    await conn.execute(
        update(oauth_grants)
        .where(oauth_grants.c.user_id == user_id, oauth_grants.c.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


def _live_grant(t: datetime):  # noqa: ANN202 - SQL expression
    return oauth_grants.c.revoked_at.is_(None) & (oauth_grants.c.expires_at > t) & users.c.active


async def _issue(conn: AsyncConnection, grant_id: int) -> OAuthToken:
    t = _now()
    access, refresh = ACCESS_PREFIX + new_token()[0], REFRESH_PREFIX + new_token()[0]
    await conn.execute(
        insert(oauth_tokens),
        [
            dict(
                token_hash=hash_token(access), grant_id=grant_id, kind="access", created_at=t, expires_at=t + ACCESS_TTL
            ),
            dict(
                token_hash=hash_token(refresh),
                grant_id=grant_id,
                kind="refresh",
                created_at=t,
                expires_at=t + timedelta(days=REFRESH_DAYS),
            ),
        ],  # fmt: skip
    )
    await conn.execute(
        update(oauth_grants)
        .where(oauth_grants.c.id == grant_id)
        .values(last_used_at=t, expires_at=t + timedelta(days=REFRESH_DAYS))
    )
    # housekeeping: tokens that expired more than a day ago
    await conn.execute(delete(oauth_tokens).where(oauth_tokens.c.expires_at < t - timedelta(days=1)))
    return OAuthToken(
        access_token=access,
        token_type="Bearer",
        expires_in=int(ACCESS_TTL.total_seconds()),
        refresh_token=refresh,
        scope=SCOPE,
    )


class RadarOAuthProvider:
    """`OAuthAuthorizationServerProvider` for the SDK handlers (structural typing: the SDK's Protocol)."""

    # ---- registration ----

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        async with _engine().connect() as conn:
            row = await _client_row(conn, client_id)
        return _client(row) if row else None

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        if problem := registration_problem(client_info):  # type: ignore[arg-type]
            raise RegistrationError("invalid_redirect_uri", problem)
        method = client_info.token_endpoint_auth_method or "client_secret_post"
        if method not in AUTH_METHODS:
            raise RegistrationError(
                "invalid_client_metadata", f"token_endpoint_auth_method must be one of {AUTH_METHODS}"
            )
        if not set(client_info.grant_types) <= GRANT_TYPES:
            raise RegistrationError("invalid_client_metadata", "grant_types: authorization_code and refresh_token only")
        t = _now()
        async with _engine().begin() as conn:
            await purge_clients(conn, t)
            count = (await conn.execute(select(func.count()).select_from(oauth_clients))).scalar_one()
            if count >= MAX_CLIENTS * NEAR_CAP:  # under pressure, unused registrations go after 10 minutes
                await purge_clients(conn, t, unused_ttl=UNUSED_CLIENT_TTL_NEAR_CAP)
                count = (await conn.execute(select(func.count()).select_from(oauth_clients))).scalar_one()
            full = count >= MAX_CLIENTS
            if not full:
                await conn.execute(
                    insert(oauth_clients).values(
                        client_id=client_info.client_id,
                        secret_hash=hash_token(client_info.client_secret) if client_info.client_secret else None,
                        auth_method=method,
                        name=clean_name(client_info.client_name),
                        redirect_uris=[str(u) for u in client_info.redirect_uris or []],
                        created_at=t,
                    )
                )
        # The SDK's errors are frozen dataclasses: raised outside `async with`, which would set their traceback.
        if full:
            log.warning("oauth: registration refused, %d clients stored", MAX_CLIENTS)
            raise RegistrationError("invalid_client_metadata", "too many registered clients; try again later")
        log.info("oauth: client registered (%s, %s)", client_info.client_id, method)

    # ---- authorization ----

    async def authorize(self, client: OAuthClientInformationFull, params: AuthorizationParams) -> str:
        resource = params.resource or settings.mcp_team_url
        if not same_resource(resource, settings.mcp_team_url):
            raise AuthorizeError("invalid_target", "unknown resource; use the team MCP URL")
        if not PKCE_CHALLENGE.match(params.code_challenge):
            raise AuthorizeError("invalid_request", "code_challenge must be an S256 challenge")
        if params.state is not None and len(params.state) > MAX_STATE:
            raise AuthorizeError("invalid_request", "state too long")
        request_id, request_hash = new_token()
        nonce, nonce_hash = new_token()
        t = _now()
        async with _engine().begin() as conn:
            await conn.execute(delete(oauth_requests).where(oauth_requests.c.expires_at < t))
            await conn.execute(
                insert(oauth_requests).values(
                    id_hash=request_hash,
                    browser_hash=nonce_hash,
                    client_id=client.client_id,
                    redirect_uri=str(params.redirect_uri),
                    redirect_explicit=params.redirect_uri_provided_explicitly,
                    state=params.state,
                    code_challenge=params.code_challenge,
                    scopes=SCOPE,
                    resource=settings.mcp_team_url,
                    created_at=t,
                    expires_at=t + REQUEST_TTL,
                )
            )
        pending_browser_nonce.set(nonce)
        return f"{settings.public_url}/autorizar?solicitud={request_id}"

    async def load_authorization_code(self, client: OAuthClientInformationFull, authorization_code: str):  # noqa: ANN201
        if len(authorization_code) > 100:
            return None
        async with _engine().begin() as conn:
            row = (
                await conn.execute(
                    select(
                        oauth_codes,
                        oauth_grants.c.client_id,
                        oauth_grants.c.user_id,
                        oauth_grants.c.resource,
                        oauth_grants.c.revoked_at,
                        users.c.active,
                    )  # fmt: skip
                    .join(oauth_grants, oauth_grants.c.id == oauth_codes.c.grant_id)
                    .join(users, users.c.id == oauth_grants.c.user_id)
                    .where(oauth_codes.c.code_hash == hash_token(authorization_code))
                )
            ).first()
            if row is None or row.client_id != client.client_id:
                return None
            if row.used_at is not None:
                log.warning("oauth: authorization code reused, grant %d revoked", row.grant_id)
                await revoke_grant(conn, row.grant_id)
                return None
            if row.revoked_at is not None or not row.active:
                return None
        return AuthorizationCode(
            code=authorization_code,
            scopes=[SCOPE],
            expires_at=row.expires_at.timestamp(),
            client_id=row.client_id,
            code_challenge=row.code_challenge,
            redirect_uri=row.redirect_uri,
            redirect_uri_provided_explicitly=row.redirect_explicit,
            resource=row.resource,
            subject=str(row.user_id),
        )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        async with _engine().begin() as conn:
            grant_id = (
                await conn.execute(
                    update(oauth_codes)
                    .where(
                        oauth_codes.c.code_hash == hash_token(authorization_code.code),
                        oauth_codes.c.used_at.is_(None),
                        oauth_codes.c.expires_at > _now(),
                    )  # fmt: skip
                    .values(used_at=_now())
                    .returning(oauth_codes.c.grant_id)
                )
            ).scalar()
            if grant_id is not None:
                await self._replace_older_grants(conn, authorization_code, client, grant_id)
                tokens = await _issue(conn, grant_id)
        if grant_id is None:  # lost a race with another exchange of the same code
            raise TokenError("invalid_grant", "authorization code already used")
        log.info("oauth: code exchanged for grant %d", grant_id)
        return tokens

    @staticmethod
    async def _replace_older_grants(conn: AsyncConnection, code: AuthorizationCode, client: OAuthClientInformationFull,
                                    grant_id: int) -> None:  # fmt: skip
        # Signing in again replaces this person's earlier grant to the same assistant (one row in Mi cuenta).
        await conn.execute(
            update(oauth_grants)
            .where(
                oauth_grants.c.user_id == int(code.subject or 0),
                oauth_grants.c.client_id == client.client_id,
                oauth_grants.c.id != grant_id,
                oauth_grants.c.revoked_at.is_(None),
            )  # fmt: skip
            .values(revoked_at=_now())
        )

    # ---- refresh ----

    async def load_refresh_token(self, client: OAuthClientInformationFull, refresh_token: str):  # noqa: ANN201
        if len(refresh_token) != TOKEN_LENGTH or not refresh_token.startswith(REFRESH_PREFIX):
            return None
        t = _now()
        async with _engine().begin() as conn:
            row = (
                await conn.execute(
                    select(
                        oauth_tokens,
                        oauth_grants.c.client_id,
                        oauth_grants.c.user_id,
                        oauth_grants.c.resource,
                        oauth_grants.c.revoked_at,
                        oauth_grants.c.expires_at.label("grant_expires_at"),
                        users.c.active,
                    )  # fmt: skip
                    .join(oauth_grants, oauth_grants.c.id == oauth_tokens.c.grant_id)
                    .join(users, users.c.id == oauth_grants.c.user_id)
                    .where(oauth_tokens.c.token_hash == hash_token(refresh_token), oauth_tokens.c.kind == "refresh")
                )
            ).first()
            if row is None or row.client_id != client.client_id:
                return None
            if row.used_at is not None:
                log.warning("oauth: rotated refresh token presented again, grant %d revoked", row.grant_id)
                await revoke_grant(conn, row.grant_id)
                return None
            if row.revoked_at is not None or not row.active or row.expires_at <= t or row.grant_expires_at <= t:
                return None
        return RefreshToken(
            token=refresh_token,
            client_id=row.client_id,
            scopes=[SCOPE],
            expires_at=int(row.expires_at.timestamp()),
            resource=row.resource,
            subject=str(row.user_id),
        )

    async def exchange_refresh_token(self, client: OAuthClientInformationFull, refresh_token: RefreshToken,
                                     scopes: list[str]) -> OAuthToken:  # fmt: skip
        async with _engine().begin() as conn:
            row = (
                await conn.execute(
                    update(oauth_tokens)
                    .where(
                        oauth_tokens.c.token_hash == hash_token(refresh_token.token),
                        oauth_tokens.c.kind == "refresh",
                        oauth_tokens.c.used_at.is_(None),
                    )  # fmt: skip
                    .values(used_at=_now())
                    .returning(oauth_tokens.c.grant_id)
                )
            ).first()
            tokens = await _issue(conn, row.grant_id) if row is not None else None
        if tokens is None:  # a parallel request rotated it first
            raise TokenError("invalid_grant", "refresh token already used")
        return tokens

    # ---- access tokens and revocation ----

    async def load_access_token(self, token: str) -> AccessToken | None:
        user = await access_token_user(_engine(), token)
        if user is None:
            return None
        return AccessToken(token=token, client_id=user.client_id, scopes=[SCOPE], resource=user.resource,
                           subject=str(user.user_id))  # fmt: skip

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        async with _engine().begin() as conn:
            grant_id = (
                await conn.execute(
                    select(oauth_tokens.c.grant_id).where(oauth_tokens.c.token_hash == hash_token(token.token))
                )
            ).scalar()
            if grant_id is not None:
                await revoke_grant(conn, grant_id)
                log.info("oauth: grant %d revoked by its client", grant_id)


async def access_token_user(engine: AsyncEngine, token: str) -> GrantUser | None:
    """The live grant behind an access token, or None (malformed, unknown, expired, revoked, deactivated person).
    The caller checks the audience (`resource`). Records the use on the grant (at most every USED_EVERY)."""
    if len(token) != TOKEN_LENGTH or not token.startswith(ACCESS_PREFIX):
        return None
    t = _now()
    async with engine.begin() as conn:
        row = (
            await conn.execute(
                select(
                    oauth_grants.c.id,
                    oauth_grants.c.client_id,
                    oauth_grants.c.resource,
                    oauth_grants.c.last_used_at,
                    users.c.id.label("user_id"),
                    users.c.name,
                )  # fmt: skip
                .join(oauth_tokens, oauth_tokens.c.grant_id == oauth_grants.c.id)
                .join(users, users.c.id == oauth_grants.c.user_id)
                .where(
                    oauth_tokens.c.token_hash == hash_token(token),
                    oauth_tokens.c.kind == "access",
                    oauth_tokens.c.expires_at > t,
                    _live_grant(t),
                )  # fmt: skip
            )
        ).first()
        if row is None:
            return None
        if row.last_used_at is None or t - row.last_used_at > USED_EVERY:
            await conn.execute(update(oauth_grants).where(oauth_grants.c.id == row.id).values(last_used_at=t))
    return GrantUser(user_id=row.user_id, name=row.name, grant_id=row.id, client_id=row.client_id,
                     resource=row.resource)  # fmt: skip


async def purge_clients(conn: AsyncConnection, t: datetime, unused_ttl: timedelta = UNUSED_CLIENT_TTL) -> None:
    """Registrations nobody authorised within `unused_ttl`, and clients without a live grant idle for
    IDLE_CLIENT_TTL (their dead grants go with them)."""
    live = select(oauth_grants.c.id).where(
        oauth_grants.c.client_id == oauth_clients.c.client_id,
        oauth_grants.c.revoked_at.is_(None),
        oauth_grants.c.expires_at > t,
    )
    await conn.execute(
        delete(oauth_clients).where(
            ~live.exists(),
            ((oauth_clients.c.last_used_at.is_(None)) & (oauth_clients.c.created_at < t - unused_ttl))
            | (oauth_clients.c.last_used_at < t - IDLE_CLIENT_TTL),
        )
    )


class HashedSecretAuthenticator(ClientAuthenticator):
    """The SDK's client authentication, against the stored sha256 of the client secret instead of the secret."""

    async def authenticate_request(self, request: Request) -> OAuthClientInformationFull:
        form = await request.form()
        client_id = form.get("client_id")
        if not isinstance(client_id, str) or not client_id:
            raise AuthenticationError("Missing client_id")
        client = await self.provider.get_client(client_id)
        if not isinstance(client, RadarClient):
            raise AuthenticationError("Invalid client_id")
        secret: str | None = None
        if client.token_endpoint_auth_method == "client_secret_basic":
            import base64
            from urllib.parse import unquote

            header = request.headers.get("authorization", "")
            if not header.startswith("Basic "):
                raise AuthenticationError("Missing or invalid Basic authentication in Authorization header")
            try:
                basic_id, _, secret = base64.b64decode(header[6:]).decode().partition(":")
            except (ValueError, UnicodeDecodeError) as e:
                raise AuthenticationError("Invalid Basic authentication header") from e
            if unquote(basic_id) != client_id:
                raise AuthenticationError("Client ID mismatch in Basic auth")
            secret = unquote(secret)
        elif client.token_endpoint_auth_method == "client_secret_post":
            value = form.get("client_secret")
            secret = value if isinstance(value, str) else None
        if client.token_endpoint_auth_method == "none":
            if client.secret_hash is not None:
                raise AuthenticationError("Client secret is required")
            return client
        if not client.secret_hash or not secret:
            raise AuthenticationError("Client secret is required")
        if not hmac.compare_digest(client.secret_hash, hash_token(secret)):
            raise AuthenticationError("Invalid client_secret")
        return client


# ---- consent (called by app/api/oauth.py with the signed-in person) ----


@dataclass(frozen=True)
class PendingRequest:
    client_id: str
    client_name: str
    redirect_uri: str
    state: str | None


async def pending_request(
    conn: AsyncConnection, request_id: str, nonce: str | None, lock: bool = False
) -> PendingRequest | None:
    if not request_id or len(request_id) > 100 or not nonce or len(nonce) > 100:
        return None
    q = (
        select(oauth_requests, oauth_clients.c.name)
        .join(oauth_clients, oauth_clients.c.client_id == oauth_requests.c.client_id)
        .where(oauth_requests.c.id_hash == hash_token(request_id), oauth_requests.c.expires_at > _now())
    )
    row = (await conn.execute(q.with_for_update(of=oauth_requests) if lock else q)).first()
    if row is None or not hmac.compare_digest(row.browser_hash, hash_token(nonce)):
        return None
    return PendingRequest(client_id=row.client_id, client_name=row.name, redirect_uri=row.redirect_uri,
                          state=row.state)  # fmt: skip


async def decide(
    conn: AsyncConnection, request_id: str, nonce: str, user_id: int, allow: bool
) -> tuple[str, dict[str, Any]] | None:
    """Consumes the pending request. Returns (redirect URI, query parameters to add) or None (unknown, expired,
    already decided, other browser)."""
    pending = await pending_request(conn, request_id, nonce, lock=True)
    if pending is None:
        return None
    row = (await conn.execute(delete(oauth_requests).where(oauth_requests.c.id_hash == hash_token(request_id))
                              .returning(oauth_requests))).first()  # fmt: skip
    params: dict[str, Any] = {"state": row.state, "iss": settings.public_url}
    if not allow:
        log.info("oauth: user %d refused client %s", user_id, row.client_id)
        return row.redirect_uri, {"error": "access_denied", **params}
    t = _now()
    # The grant lives only as long as its code until the code is exchanged (`_issue` extends it).
    grant_id = (
        await conn.execute(
            insert(oauth_grants)
            .values(
                user_id=user_id,
                client_id=row.client_id,
                scopes=row.scopes,
                resource=row.resource,
                created_at=t,
                expires_at=t + CODE_TTL,
            )  # fmt: skip
            .returning(oauth_grants.c.id)
        )
    ).scalar_one()
    code, code_hash = new_token()
    await conn.execute(delete(oauth_codes).where(oauth_codes.c.expires_at < t - timedelta(days=1)))
    await conn.execute(
        insert(oauth_codes).values(
            code_hash=code_hash,
            grant_id=grant_id,
            redirect_uri=row.redirect_uri,
            redirect_explicit=row.redirect_explicit,
            code_challenge=row.code_challenge,
            expires_at=t + CODE_TTL,
        )  # fmt: skip
    )
    await conn.execute(update(oauth_clients).where(oauth_clients.c.client_id == row.client_id).values(last_used_at=t))
    log.info("oauth: user %d authorised client %s (grant %d)", user_id, row.client_id, grant_id)
    return row.redirect_uri, {"code": code, **params}
