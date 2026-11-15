"""Sign-in from the assistant (OAuth 2.1, ADR 0035) against a real Postgres (conftest.py): discovery documents, the
team address /mcp/equipo, registration, authorize + consent, code and refresh grants, revocation, and every failure
the design promises to refuse. The web's consent page is played by the `member` client (session cookie + the
`radar_oauth` cookie /oauth/authorize sets)."""

import asyncio
import base64
import hashlib
import logging
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import httpx2
import pytest
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.auth import OAuthMetadata, ProtectedResourceMetadata
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncEngine
from starlette.routing import Route

from app.auth import throttle
from app.config import settings
from app.db.tables import oauth_clients, oauth_codes, oauth_grants, oauth_requests, oauth_tokens, users
from app.main import app
from app.oauth import provider
from app.oauth.clients import clean_name
from tests.conftest import login, make_client
from tests.test_mcp import SECRET_NOTE, _seed, _team_state, _token, running  # noqa: F401 - fixture

LOCAL = "http://127.0.0.1:33418/callback"
CLAUDE = "https://claude.ai/api/mcp/auth_callback"


def team_url() -> str:
    return settings.mcp_team_url


def pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return verifier, challenge


def bare(engine: AsyncEngine, ip: str = "127.0.0.1") -> httpx.AsyncClient:
    """A non-browser client: no CSRF header, no cookies (what an assistant's HTTP library sends)."""
    c = make_client(engine, ip)
    del c.headers["X-Radar-CSRF"]
    return c


async def register(c: httpx.AsyncClient, **meta: Any) -> httpx.Response:
    body = {"client_name": "Claude Code", "redirect_uris": [LOCAL], "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"], **meta}  # fmt: skip
    return await c.post("/oauth/register", json=body)


async def new_client(engine: AsyncEngine, **meta: Any) -> dict[str, Any]:
    async with bare(engine) as c:
        res = await register(c, **meta)
    assert res.status_code == 201, res.text
    return res.json()


async def authorize(browser: httpx.AsyncClient, client_id: str, challenge: str, redirect: str = LOCAL,
                    **extra: str) -> httpx.Response:  # fmt: skip
    params = {"response_type": "code", "client_id": client_id, "redirect_uri": redirect, "code_challenge": challenge,
              "code_challenge_method": "S256", "state": "st-123", "resource": team_url(), "scope": "radar:leer",
              **extra}  # fmt: skip
    return await browser.get("/oauth/authorize", params={k: v for k, v in params.items() if v is not None})


def request_id(res: httpx.Response) -> str:
    assert res.status_code == 302, res.text
    loc = urlsplit(res.headers["location"])
    assert f"{loc.scheme}://{loc.netloc}" == settings.public_url and loc.path == "/autorizar"
    return parse_qs(loc.query)["solicitud"][0]


async def consent(browser: httpx.AsyncClient, rid: str, allow: bool = True) -> dict[str, list[str]]:
    res = await browser.post("/api/oauth/consent/decision", json={"request": rid, "allow": allow})
    assert res.status_code == 200, res.text
    return parse_qs(urlsplit(res.json()["redirectTo"]).query)


async def exchange(engine: AsyncEngine, client_id: str, code: str, verifier: str, redirect: str = LOCAL,
                   **extra: str) -> httpx.Response:  # fmt: skip
    form = {"grant_type": "authorization_code", "code": code, "client_id": client_id, "code_verifier": verifier,
            "redirect_uri": redirect, "resource": team_url(), **extra}  # fmt: skip
    async with bare(engine) as c:
        return await c.post("/oauth/token", data={k: v for k, v in form.items() if v is not None})


async def refresh(engine: AsyncEngine, client_id: str, token: str, **extra: str) -> httpx.Response:
    async with bare(engine) as c:
        return await c.post("/oauth/token", data={"grant_type": "refresh_token", "refresh_token": token,
                                                  "client_id": client_id, **extra})  # fmt: skip


async def sign_in(engine: AsyncEngine, browser: httpx.AsyncClient, client: dict[str, Any] | None = None,
                  redirect: str = LOCAL) -> tuple[dict[str, Any], dict[str, Any]]:  # fmt: skip
    """The whole flow: register (unless given), authorize, approve, exchange. Returns (client, token response)."""
    client = client or await new_client(engine, redirect_uris=[redirect])
    verifier, challenge = pkce()
    query = await consent(browser, request_id(await authorize(browser, client["client_id"], challenge, redirect)))
    res = await exchange(engine, client["client_id"], query["code"][0], verifier, redirect)
    assert res.status_code == 200, res.text
    return client, res.json()


def _http(engine: AsyncEngine, token: str | None) -> httpx2.AsyncClient:
    app.state.engine = engine
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app, client=("127.0.0.1", 123)),
                              base_url="http://localhost", headers=headers)  # fmt: skip


async def team_status(engine: AsyncEngine, token: str | None, path: str = "/mcp/equipo") -> httpx2.Response:
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
    hdrs = {"Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25"}
    async with _http(engine, token) as c:
        return await c.post(path, json=body, headers=hdrs)


@asynccontextmanager
async def team_client(engine: AsyncEngine, token: str) -> AsyncIterator[Client]:
    async with _http(engine, token) as http, Client(streamable_http_client("http://localhost/mcp/equipo",
                                                                           http_client=http)) as c:  # fmt: skip
        yield c


# ---------- discovery ----------


async def test_metadata_documents(engine: AsyncEngine) -> None:
    async with bare(engine) as c:
        prm = await c.get("/.well-known/oauth-protected-resource/mcp/equipo")
        assert prm.status_code == 200
        assert (await c.get("/.well-known/oauth-protected-resource")).json() == prm.json()  # root fallback
        assert (await c.get("/.well-known/oauth-protected-resource/mcp")).status_code == 404  # public URL: none
        asm = await c.get("/.well-known/oauth-authorization-server")
        assert (await c.get("/.well-known/oauth-authorization-server/x")).status_code == 404
        assert (await c.get("/.well-known/openid-configuration")).status_code == 404
        # built from settings, never from the Host header
        evil = await c.get("/.well-known/oauth-authorization-server", headers={"Host": "evil.example"})
        assert evil.json() == asm.json()
    p = ProtectedResourceMetadata.model_validate(prm.json())
    assert prm.json()["resource"] == team_url() and prm.json()["authorization_servers"] == [settings.public_url]
    assert p.scopes_supported == ["radar:leer"] and p.bearer_methods_supported == ["header"]
    m = OAuthMetadata.model_validate(asm.json())
    body = asm.json()
    assert body["issuer"] == settings.public_url  # exactly: clients compare it as a string
    assert body["authorization_endpoint"] == f"{settings.public_url}/oauth/authorize"
    assert body["token_endpoint"] == f"{settings.public_url}/oauth/token"
    assert m.code_challenge_methods_supported == ["S256"] and m.response_types_supported == ["code"]
    assert m.authorization_response_iss_parameter_supported is True
    assert "offline_access" not in body["scopes_supported"]
    assert "client_id_metadata_document_supported" not in body  # CIMD not offered: clients fall back to DCR


async def test_team_address_always_asks_to_sign_in(engine: AsyncEngine, running: None) -> None:  # noqa: F811
    res = await team_status(engine, None)
    assert res.status_code == 401
    rm = f'resource_metadata="{settings.public_url}/.well-known/oauth-protected-resource/mcp/equipo"'
    assert res.headers["www-authenticate"] == f'Bearer {rm}, scope="radar:leer"'
    res = await team_status(engine, "rr_at_" + "x" * 43)
    assert res.status_code == 401 and res.headers["www-authenticate"].startswith('Bearer error="invalid_token", ')
    assert (await team_status(engine, None, "/mcp")).status_code == 200  # the public address is unchanged


async def test_personal_token_still_opens_both_addresses(engine: AsyncEngine, running: None,  # noqa: F811
                                                         member: httpx.AsyncClient) -> None:  # fmt: skip
    secret = (await _token(member))["secret"]
    assert (await team_status(engine, secret)).status_code == 200
    assert (await team_status(engine, secret, "/mcp")).status_code == 200


# ---------- the happy path ----------


async def test_full_flow(engine: AsyncEngine, running: None, member: httpx.AsyncClient,  # noqa: F811
                         caplog: pytest.LogCaptureFixture) -> None:  # fmt: skip
    caplog.set_level(logging.DEBUG)
    await _seed(engine)
    await _team_state(engine, member)
    client = await new_client(engine)
    assert "client_secret" not in client  # public client (PKCE only)
    verifier, challenge = pkce()
    res = await authorize(member, client["client_id"], challenge)
    assert res.headers["cache-control"] == "no-store"
    cookie = res.headers["set-cookie"]
    assert (
        "radar_oauth=" in cookie and "HttpOnly" in cookie and "Path=/api/oauth/" in cookie and "SameSite=lax" in cookie
    )
    rid = request_id(res)
    info = await member.post("/api/oauth/consent", json={"request": rid})
    assert info.json() == {"assistant": "Claude Code", "kind": "local", "redirectHost": "127.0.0.1:33418"}
    query = await consent(member, rid)
    assert (
        query["state"] == ["st-123"]
        and query["iss"] == [settings.public_url]
        and set(query) == {"code", "state", "iss"}
    )
    code = query["code"][0]
    res = await exchange(engine, client["client_id"], code, verifier)
    assert res.status_code == 200 and res.headers["cache-control"] == "no-store"
    tokens = res.json()
    assert tokens["token_type"] == "Bearer" and tokens["expires_in"] == 3600 and tokens["scope"] == "radar:leer"
    assert tokens["access_token"].startswith("rr_at_") and tokens["refresh_token"].startswith("rr_rt_")

    async with team_client(engine, tokens["access_token"]) as c:
        res = await c.call_tool("tablero_equipo", {})
        assert not res.is_error and res.structured_content["porEstado"] == {"estudio": 1}
        assert res.structured_content["convocatorias"][0]["ultimaNota"]["texto"] == SECRET_NOTE
    listed = (await member.get("/api/me/assistants")).json()
    assert (
        listed["teamUrl"] == team_url() and listed["signIn"] is True and listed["publicUrl"] == settings.mcp_public_url
    )
    [row] = listed["assistants"]
    assert (row["name"], row["kind"], row["redirectHost"]) == ("Claude Code", "local", "127.0.0.1:33418")
    assert row["lastUsedAt"] is not None

    # refresh: rotated; the new pair works
    res = await refresh(engine, client["client_id"], tokens["refresh_token"])
    assert res.status_code == 200, res.text
    fresh = res.json()
    assert fresh["refresh_token"] != tokens["refresh_token"]
    assert (await team_status(engine, fresh["access_token"])).status_code == 200

    # nothing secret in the logs
    logged = "\n".join(r.getMessage() for r in caplog.records)
    for secret in (code, verifier, rid, tokens["access_token"], tokens["refresh_token"], fresh["access_token"],
                   fresh["refresh_token"]):  # fmt: skip
        assert secret not in logged
    # only hashes in the database
    async with engine.connect() as conn:
        dump = str((await conn.execute(text("select * from oauth_tokens, oauth_codes, oauth_requests"))).all())
        dump += str((await conn.execute(text("select * from oauth_tokens"))).all())
    for secret in (code, tokens["access_token"], tokens["refresh_token"], fresh["refresh_token"]):
        assert secret not in dump


async def test_claude_redirect_is_recognised_and_secret_clients_work(engine: AsyncEngine,
                                                                    member: httpx.AsyncClient) -> None:  # fmt: skip
    client = await new_client(engine, client_name="Claude", redirect_uris=[CLAUDE],
                              token_endpoint_auth_method="client_secret_post")  # fmt: skip
    secret = client["client_secret"]
    async with engine.connect() as conn:
        stored = (await conn.execute(select(oauth_clients.c.secret_hash))).scalar()
    assert stored == hashlib.sha256(secret.encode()).hexdigest()  # only the hash
    verifier, challenge = pkce()
    rid = request_id(await authorize(member, client["client_id"], challenge, CLAUDE))
    info = (await member.post("/api/oauth/consent", json={"request": rid})).json()
    assert (info["kind"], info["redirectHost"]) == ("conocido", "claude.ai")
    code = (await consent(member, rid))["code"][0]
    bad = await exchange(engine, client["client_id"], code, verifier, CLAUDE, client_secret="wrong")
    assert bad.status_code == 401 and bad.json()["error"] == "invalid_client"
    res = await exchange(engine, client["client_id"], code, verifier, CLAUDE, client_secret=secret)
    assert res.status_code == 200, res.text
    # client_secret_basic
    client = await new_client(engine, redirect_uris=[CLAUDE], token_endpoint_auth_method="client_secret_basic")
    verifier, challenge = pkce()
    code = (await consent(member, request_id(await authorize(member, client["client_id"], challenge, CLAUDE))))["code"][
        0
    ]
    basic = base64.b64encode(f"{client['client_id']}:{client['client_secret']}".encode()).decode()
    async with bare(engine) as c:
        res = await c.post("/oauth/token", headers={"Authorization": f"Basic {basic}"},
                           data={"grant_type": "authorization_code", "code": code, "client_id": client["client_id"],
                                 "code_verifier": verifier, "redirect_uri": CLAUDE})  # fmt: skip
    assert res.status_code == 200, res.text


async def test_loopback_port_may_change(engine: AsyncEngine, member: httpx.AsyncClient) -> None:
    client = await new_client(engine, redirect_uris=["http://localhost:1111/callback"])
    _, tokens = await sign_in(engine, member, client, "http://localhost:2222/callback")  # RFC 8252 §7.3
    assert tokens["access_token"]
    _, challenge = pkce()
    for other in ("http://localhost:2222/other", "http://127.0.0.1:1111/callback", "https://localhost:1111/callback"):
        res = await authorize(member, client["client_id"], challenge, other)
        assert res.status_code == 400 and "location" not in res.headers, other  # never redirected to an unknown URI


async def test_refusing_redirects_with_access_denied(engine: AsyncEngine, member: httpx.AsyncClient) -> None:
    client = await new_client(engine)
    _, challenge = pkce()
    query = await consent(member, request_id(await authorize(member, client["client_id"], challenge)), allow=False)
    assert query == {"error": ["access_denied"], "state": ["st-123"], "iss": [settings.public_url]}
    assert (await member.get("/api/me/assistants")).json()["assistants"] == []


# ---------- what must be refused ----------


async def test_authorize_refusals(engine: AsyncEngine, member: httpx.AsyncClient) -> None:
    client = await new_client(engine)
    cid = client["client_id"]
    _, challenge = pkce()
    # unknown client or unregistered redirect: an error page, never a redirect
    res = await authorize(member, "nope", challenge)
    assert res.status_code == 400 and "location" not in res.headers
    res = await authorize(member, cid, challenge, "https://evil.example/cb")
    assert res.status_code == 400 and "location" not in res.headers

    def error(res: httpx.Response) -> str:
        assert res.status_code == 302 and res.headers["location"].startswith(LOCAL), res.text
        q = parse_qs(urlsplit(res.headers["location"]).query)
        assert len(q["state"]) == 1  # passed back even on errors
        return q["error"][0]

    assert error(await authorize(member, cid, None)) == "invalid_request"  # type: ignore[arg-type]  # no PKCE
    assert error(await authorize(member, cid, challenge, code_challenge_method="plain")) == "invalid_request"
    assert error(await authorize(member, cid, "short")) == "invalid_request"
    assert error(await authorize(member, cid, challenge, response_type="token")) == "unsupported_response_type"
    assert error(await authorize(member, cid, challenge, resource="https://other.example/mcp")) == "invalid_target"
    assert error(await authorize(member, cid, challenge, resource=settings.mcp_public_url)) == "invalid_target"
    assert error(await authorize(member, cid, challenge, state="s" * 600)) == "invalid_request"


async def test_authorize_errors_never_redirect_to_web_clients(engine: AsyncEngine, member: httpx.AsyncClient) -> None:
    """RFC 9700 §4.11.2: before the person has decided, errors for a client with a web redirect URI are shown on the
    radar (else /oauth/authorize would redirect anywhere a registrant likes)."""
    client = await new_client(engine, redirect_uris=["https://agent.example/cb"])
    cid = client["client_id"]
    _, challenge = pkce()
    for extra in ({"code_challenge": None}, {"response_type": "token"}, {"resource": "https://other.example/mcp"},
                  {"code_challenge_method": "plain"}):  # fmt: skip
        res = await authorize(member, cid, challenge, "https://agent.example/cb", **extra)  # type: ignore[arg-type]
        assert res.status_code == 400 and "location" not in res.headers, extra
        assert res.headers["content-type"].startswith("text/html")
        assert "No se puede conectar" in res.text and "frame-ancestors 'none'" in res.headers["content-security-policy"]


async def test_refusing_an_unrecognised_client_stays_on_the_radar(engine: AsyncEngine,
                                                                  member: httpx.AsyncClient) -> None:  # fmt: skip
    """«No permitir» on a client we do not recognise: no redirect to its (anyone's) site. Claude's callback and
    loopback clients still get `error=access_denied`, so they can tell the person."""
    _, challenge = pkce()
    web = await new_client(engine, redirect_uris=["https://agent.example/cb"])
    rid = request_id(await authorize(member, web["client_id"], challenge, "https://agent.example/cb"))
    res = await member.post("/api/oauth/consent/decision", json={"request": rid, "allow": False})
    assert res.status_code == 200 and res.json() == {"redirectTo": None}
    assert (await member.post("/api/oauth/consent/decision", json={"request": rid, "allow": False})).status_code == 404
    for uri in (CLAUDE, LOCAL):
        client = await new_client(engine, redirect_uris=[uri])
        query = await consent(member, request_id(await authorize(member, client["client_id"], challenge, uri)),
                              allow=False)  # fmt: skip
        assert query["error"] == ["access_denied"], uri


async def test_token_refusals(engine: AsyncEngine, running: None, member: httpx.AsyncClient) -> None:  # noqa: F811
    client = await new_client(engine)
    other = await new_client(engine)
    cid = client["client_id"]

    async def code_for(c: dict[str, Any] = client) -> tuple[str, str]:
        verifier, challenge = pkce()
        q = await consent(member, request_id(await authorize(member, c["client_id"], challenge)))
        return q["code"][0], verifier

    code, verifier = await code_for()
    assert (await exchange(engine, cid, code, "x" * 50)).json()["error"] == "invalid_grant"  # wrong verifier
    res = await exchange(engine, cid, code, None)  # type: ignore[arg-type]  # missing verifier
    assert res.status_code == 400 and res.json()["error"] == "invalid_request"
    assert (await exchange(engine, other["client_id"], code, verifier)).json()[
        "error"
    ] == "invalid_grant"  # wrong client
    res = await exchange(engine, cid, code, verifier, "http://127.0.0.1:9/callback")  # other redirect URI
    assert res.json()["error"] == "invalid_request"
    res = await exchange(engine, cid, code, verifier, resource="https://other.example/mcp")
    assert res.json()["error"] == "invalid_target"
    res = await exchange(engine, cid, code, verifier)  # still valid after the failures above
    assert res.status_code == 200, res.text
    first = res.json()

    # code reuse: within REUSE_GRACE (a retry) refused but nothing revoked; later, the grant it produced is revoked
    assert (await exchange(engine, cid, code, verifier)).json()["error"] == "invalid_grant"
    assert (await team_status(engine, first["access_token"])).status_code == 200
    async with engine.begin() as conn:
        await conn.execute(update(oauth_codes).values(used_at=oauth_codes.c.used_at - timedelta(seconds=11)))
    assert (await exchange(engine, cid, code, verifier)).json()["error"] == "invalid_grant"
    assert (await team_status(engine, first["access_token"])).status_code == 401
    assert (await refresh(engine, cid, first["refresh_token"])).json()["error"] == "invalid_grant"

    # expired code (60 s)
    code, verifier = await code_for()
    async with engine.begin() as conn:
        assert (await conn.execute(select(func.max(oauth_codes.c.expires_at) - func.now()))).scalar() <= timedelta(
            seconds=61  # 60 s, give or take the clocks of Python and the database container
        )
        await conn.execute(update(oauth_codes).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    assert (await exchange(engine, cid, code, verifier)).json()["error"] == "invalid_grant"

    # refresh reuse: the whole family is revoked
    _, tokens = await sign_in(engine, member, client)
    rotated = (await refresh(engine, cid, tokens["refresh_token"])).json()
    assert (await refresh(engine, other["client_id"], rotated["refresh_token"])).json()["error"] == "invalid_grant"
    assert (await refresh(engine, cid, tokens["refresh_token"])).json()["error"] == "invalid_grant"  # a retry
    assert (await team_status(engine, rotated["access_token"])).status_code == 200  # ...within the grace: kept
    async with engine.begin() as conn:
        await conn.execute(update(oauth_tokens).where(oauth_tokens.c.used_at.is_not(None))
                           .values(used_at=oauth_tokens.c.used_at - timedelta(seconds=11)))  # fmt: skip
    assert (await refresh(engine, cid, tokens["refresh_token"])).json()["error"] == "invalid_grant"  # reuse
    assert (await team_status(engine, rotated["access_token"])).status_code == 401
    assert (await refresh(engine, cid, rotated["refresh_token"])).json()["error"] == "invalid_grant"
    assert (await member.get("/api/me/assistants")).json()["assistants"] == []

    # audience: a token whose grant is for another resource never opens /mcp/equipo; OAuth tokens never open /mcp
    _, tokens = await sign_in(engine, member, client)
    assert (await team_status(engine, tokens["access_token"], "/mcp")).status_code == 401
    async with engine.begin() as conn:
        await conn.execute(update(oauth_grants).values(resource="https://other.example/mcp"))
    assert (await team_status(engine, tokens["access_token"])).status_code == 401

    # expired access token
    _, tokens = await sign_in(engine, member, client)
    async with engine.begin() as conn:
        await conn.execute(text("update oauth_tokens set expires_at = now() - interval '1 second' where kind='access'"))
    assert (await team_status(engine, tokens["access_token"])).status_code == 401
    assert (await refresh(engine, cid, tokens["refresh_token"])).status_code == 200  # the refresh token still works


async def test_parallel_exchanges_give_one_token_and_keep_it(engine: AsyncEngine, running: None,  # noqa: F811
                                                              member: httpx.AsyncClient) -> None:  # fmt: skip
    """A client retrying (or racing itself) right after the first use gets `invalid_grant` for the duplicates, and the
    tokens the winner received keep working: the duplicates do not count as a stolen code or refresh token."""
    client = await new_client(engine)
    cid = client["client_id"]
    verifier, challenge = pkce()
    code = (await consent(member, request_id(await authorize(member, cid, challenge))))["code"][0]
    results = await asyncio.gather(*(exchange(engine, cid, code, verifier) for _ in range(12)))
    assert sorted(r.status_code for r in results) == [200] + [400] * 11
    assert all(r.json()["error"] == "invalid_grant" for r in results if r.status_code == 400)
    [won] = [r.json() for r in results if r.status_code == 200]
    assert (await team_status(engine, won["access_token"])).status_code == 200

    results = await asyncio.gather(*(refresh(engine, cid, won["refresh_token"]) for _ in range(12)))
    assert sorted(r.status_code for r in results) == [200] + [400] * 11  # never two valid pairs
    [new] = [r.json() for r in results if r.status_code == 200]
    assert (await team_status(engine, new["access_token"])).status_code == 200
    assert (await refresh(engine, cid, new["refresh_token"])).status_code == 200


async def test_revocation_paths(engine: AsyncEngine, running: None, member: httpx.AsyncClient,  # noqa: F811
                                admin: httpx.AsyncClient) -> None:  # fmt: skip
    client = await new_client(engine)
    cid = client["client_id"]
    # "Desconectar" in Mi cuenta
    _, tokens = await sign_in(engine, member, client)
    [row] = (await member.get("/api/me/assistants")).json()["assistants"]
    assert (await admin.delete(f"/api/me/assistants/{row['id']}")).status_code == 404  # not hers
    assert (await member.delete(f"/api/me/assistants/{row['id']}")).status_code == 204
    assert (await team_status(engine, tokens["access_token"])).status_code == 401
    assert (await refresh(engine, cid, tokens["refresh_token"])).json()["error"] == "invalid_grant"
    # /oauth/revoke (RFC 7009) with the refresh token revokes the access token too
    _, tokens = await sign_in(engine, member, client)
    async with bare(engine) as c:
        res = await c.post("/oauth/revoke", data={"token": tokens["refresh_token"], "client_id": cid})
    assert res.status_code == 200
    assert (await team_status(engine, tokens["access_token"])).status_code == 401
    # signing in again replaces the old grant of the same assistant
    _, old = await sign_in(engine, member, client)
    _, new = await sign_in(engine, member, client)
    assert (await team_status(engine, old["access_token"])).status_code == 401
    assert (await team_status(engine, new["access_token"])).status_code == 200
    assert len((await member.get("/api/me/assistants")).json()["assistants"]) == 1
    # deactivation stops it at once; reactivation does not bring it back (revoke_sessions)
    luis = next(u["id"] for u in (await admin.get("/api/users")).json()["users"] if u["name"] == "Luis")
    assert (await admin.patch(f"/api/team/users/{luis}", json={"active": False})).status_code == 200
    assert (await team_status(engine, new["access_token"])).status_code == 401
    assert (await admin.patch(f"/api/team/users/{luis}", json={"active": True})).status_code == 200
    assert (await team_status(engine, new["access_token"])).status_code == 401
    # password change revokes every grant
    await login(member, "luis@example.org")
    _, tokens = await sign_in(engine, member, client)
    res = await member.post("/api/me/password", json={"currentPassword": "correct horse battery",
                                                      "newPassword": "another long password"})  # fmt: skip
    assert res.status_code == 204
    assert (await team_status(engine, tokens["access_token"])).status_code == 401
    # a deactivated person's refresh token is refused too
    _, tokens = await sign_in(engine, member, client)
    async with engine.begin() as conn:
        await conn.execute(update(users).where(users.c.email == "luis@example.org").values(active=False))
    assert (await refresh(engine, cid, tokens["refresh_token"])).json()["error"] == "invalid_grant"


async def test_consent_is_bound_to_session_browser_and_csrf(engine: AsyncEngine, member: httpx.AsyncClient,
                                                           admin: httpx.AsyncClient) -> None:  # fmt: skip
    client = await new_client(engine)
    _, challenge = pkce()
    rid = request_id(await authorize(member, client["client_id"], challenge))
    body = {"request": rid, "allow": True}
    # another signed-in person (another browser, without the radar_oauth cookie) cannot see or approve it
    assert (await admin.post("/api/oauth/consent", json={"request": rid})).status_code == 404
    assert (await admin.post("/api/oauth/consent/decision", json=body)).status_code == 404
    async with make_client(engine) as c:  # same cookies, no session: 401
        c.cookies.update({k: v for k, v in member.cookies.items() if k != "radar_session"})
        assert (await c.post("/api/oauth/consent/decision", json=body)).status_code == 401
    async with make_client(engine) as c:  # CSRF rule
        del c.headers["X-Radar-CSRF"]
        c.cookies.update(member.cookies)
        assert (await c.post("/api/oauth/consent/decision", json=body)).status_code == 403
        cross = {"X-Radar-CSRF": "1", "Sec-Fetch-Site": "cross-site"}
        res = await c.post("/api/oauth/consent/decision", json=body, headers=cross)
        assert res.status_code == 403
    assert (await member.post("/api/oauth/consent", json={"request": "x" * 43})).status_code == 404
    # single use
    await consent(member, rid)
    assert (await member.post("/api/oauth/consent/decision", json=body)).status_code == 404
    # expired (10 minutes)
    rid = request_id(await authorize(member, client["client_id"], challenge))
    async with engine.begin() as conn:
        await conn.execute(text("update oauth_requests set expires_at = now() - interval '1 second'"))
    assert (await member.post("/api/oauth/consent", json={"request": rid})).status_code == 404


async def test_registration_limits(engine: AsyncEngine, monkeypatch: pytest.MonkeyPatch) -> None:
    async with bare(engine) as c:
        for uris in (["http://evil.example/cb"], ["cursor://callback"], ["https://x.example/cb#frag"],
                     ["https://user:pw@x.example/cb"], [f"https://x.example/{'a' * 600}"],
                     [f"https://x{n}.example/cb" for n in range(6)], []):  # fmt: skip
            res = await register(c, redirect_uris=uris)
            assert res.status_code == 400, uris
        res = await register(c, token_endpoint_auth_method="private_key_jwt")
        assert res.status_code == 400
        res = await register(c, grant_types=["authorization_code", "client_credentials"])
        assert res.status_code == 400
        res = await register(c, client_name="Claude‮​  de\n confianza" + "x" * 200, redirect_uris=[CLAUDE])
        assert res.status_code == 201
        res = await c.post("/oauth/register", content=b"{" + b" " * 20_000 + b"}",
                           headers={"Content-Type": "application/json"})  # fmt: skip
        assert res.status_code == 413
    async with engine.connect() as conn:
        name = (await conn.execute(select(oauth_clients.c.name))).scalar()
    assert name.startswith("Claude de confianza") and len(name) <= 60 and "‮" not in name

    # unused registrations expire after a day
    async with engine.begin() as conn:
        await conn.execute(update(oauth_clients).values(created_at=datetime.now(UTC) - timedelta(days=2)))
    async with bare(engine) as c:
        assert (await register(c)).status_code == 201
    async with engine.connect() as conn:
        assert (await conn.execute(select(func.count()).select_from(oauth_clients))).scalar() == 1
    # stored clients are capped: when full, the oldest unused one makes room; refused only if all are in use
    monkeypatch.setattr(provider, "MAX_CLIENTS", 2)
    async with bare(engine) as c:
        second = (await register(c)).json()["client_id"]
        third = (await register(c)).json()["client_id"]
        async with engine.connect() as conn:
            ids = set((await conn.execute(select(oauth_clients.c.client_id))).scalars())
        assert ids == {second, third}
        async with engine.begin() as conn:
            await conn.execute(update(oauth_clients).values(last_used_at=datetime.now(UTC)))  # both approved once
        assert (await register(c)).status_code == 400


async def test_registration_flood_does_not_lock_the_team_out(engine: AsyncEngine, member: httpx.AsyncClient,
                                                             monkeypatch: pytest.MonkeyPatch,
                                                             patch_settings) -> None:  # noqa: ANN001  # fmt: skip
    """Attack: a sustained flood of registrations, each with junk authorisation requests to keep it "in use", over
    several 10-minute windows (the clock is moved, not slept). There is no global budget to spend; the table stays
    under MAX_CLIENTS because the oldest unused registration makes room, and anonymous pending requests are capped,
    so a new legitimate registration and a whole sign-in still succeed, even when the person takes longer than the
    purge of unused clients."""
    monkeypatch.setattr(provider, "MAX_CLIENTS", 30)
    monkeypatch.setattr(provider, "MAX_PENDING", 8)
    offset = timedelta()
    monkeypatch.setattr(provider, "_now", lambda: datetime.now(UTC) + offset)
    _, challenge = pkce()
    known = await new_client(engine)
    _, tokens = await sign_in(engine, member, known)  # an assistant connected before the flood
    async with bare(engine) as attacker:
        for _ in range(4):  # four windows
            offset += timedelta(minutes=11)
            for _ in range(40):
                res = await register(attacker)
                assert res.status_code == 201
                await authorize(attacker, res.json()["client_id"], challenge)  # accepted or refused, either way
    async with engine.connect() as conn:
        assert (await conn.execute(select(func.count()).select_from(oauth_clients))).scalar() <= 30

    # a new assistant registers and its person signs in, with the flood going on in between
    async with bare(engine) as c:
        res = await register(c)
    assert res.status_code == 201
    new = res.json()
    async with bare(engine) as anon:  # anonymous requests are full of junk: the page asks to sign in first
        res = await authorize(anon, new["client_id"], challenge)
        assert res.status_code == 429 and "location" not in res.headers and "Entra en el radar" in res.text
    verifier, challenge = pkce()
    rid = request_id(await authorize(member, new["client_id"], challenge))  # signed in: never crowded out
    offset += timedelta(hours=25)  # the person is slow: the client is past the purge of unused registrations...
    async with engine.begin() as conn:  # ...and its request is still live (the clock moved; the request did not)
        await conn.execute(update(oauth_requests).values(expires_at=datetime.now(UTC) + offset + timedelta(minutes=5)))
    async with bare(engine) as attacker:
        for _ in range(40):
            assert (await register(attacker)).status_code == 201
    query = await consent(member, rid)
    res = await exchange(engine, new["client_id"], query["code"][0], verifier)
    assert res.status_code == 200, res.text
    offset = timedelta()
    assert (await refresh(engine, known["client_id"], tokens["refresh_token"])).status_code == 200

    # with a trusted proxy (real client IPs) there is also a per-IP limit of 10 per 10 minutes
    patch_settings(forwarded_allow_ips="10.0.0.1")
    monkeypatch.setattr(provider, "MAX_CLIENTS", 5000)
    async with bare(engine, "10.0.0.9") as c:
        codes = [(await register(c)).status_code for _ in range(11)]
    assert codes[:10] == [201] * 10 and codes[10] == 429
    async with bare(engine, "10.0.0.10") as c:
        assert (await register(c)).status_code == 201


async def test_token_endpoint_is_not_blocked_by_browser_rules(engine: AsyncEngine, member: httpx.AsyncClient) -> None:
    """Form-encoded POSTs from a non-browser client, no X-Radar-CSRF and any Sec-Fetch-Site: CSRF is /api/ only."""
    client = await new_client(engine)
    verifier, challenge = pkce()
    code = (await consent(member, request_id(await authorize(member, client["client_id"], challenge))))["code"][0]
    async with bare(engine) as c:
        res = await c.post("/oauth/token", headers={"Sec-Fetch-Site": "cross-site"},
                           data={"grant_type": "authorization_code", "code": code, "client_id": client["client_id"],
                                 "code_verifier": verifier, "redirect_uri": LOCAL})  # fmt: skip
        assert res.status_code == 200, res.text
        big = await c.post("/oauth/token", content=b"a=" + b"b" * 20_000,
                           headers={"Content-Type": "application/x-www-form-urlencoded"})  # fmt: skip
        assert big.status_code == 413


async def test_bad_token_requests_never_block_good_ones(engine: AsyncEngine, member: httpx.AsyncClient) -> None:
    """Attack: junk to /oauth/token and /oauth/revoke from the shared IP until it is over the limit. Only failures
    count and are slowed down; a correct exchange, refresh or revocation still goes through, and a dead refresh token
    still gets `invalid_grant` (the client needs it to start a new sign-in), never 429."""
    client = await new_client(engine)
    cid = client["client_id"]
    _, tokens = await sign_in(engine, member, client)
    junk = {"grant_type": "refresh_token", "refresh_token": "rr_rt_x", "client_id": "nope"}
    async with bare(engine) as c:
        codes = [(await c.post("/oauth/token", data=junk)).status_code
                 for _ in range(throttle.oauth_token_failures.limit + 1)]  # fmt: skip
        assert codes[-1] == 429 and set(codes[:-1]) == {401}  # unknown client
        assert (await c.post("/oauth/revoke", data={"token": "x", "client_id": "nope"})).status_code == 429
        dead = await c.post("/oauth/token", data={**junk, "client_id": cid})
        assert dead.status_code == 400 and dead.json()["error"] == "invalid_grant"
    res = await refresh(engine, cid, tokens["refresh_token"])
    assert res.status_code == 200, res.text
    _, other = await sign_in(engine, member, client)  # code exchange
    async with bare(engine) as c:
        res = await c.post("/oauth/revoke", data={"token": other["refresh_token"], "client_id": cid})
    assert res.status_code == 200


async def test_authorize_junk_never_blocks_a_real_request(engine: AsyncEngine, member: httpx.AsyncClient) -> None:
    """Attack: anonymous junk to /oauth/authorize from the shared IP. Junk gets an error page (then 429); a valid
    request from the same IP is never refused."""
    client = await new_client(engine)
    _, challenge = pkce()
    async with bare(engine) as anon:
        codes = [(await authorize(anon, "nope", challenge)).status_code
                 for _ in range(throttle.oauth_authorize_failures.limit + 1)]  # fmt: skip
    assert set(codes[:-1]) == {400} and codes[-1] == 429
    rid = request_id(await authorize(member, client["client_id"], challenge))
    assert "code" in await consent(member, rid)


async def test_team_address_never_answers_429(engine: AsyncEngine, running: None,  # noqa: F811
                                              member: httpx.AsyncClient) -> None:  # fmt: skip
    """Attack: junk bearer tokens to /mcp/equipo from the shared IP. An expired access token must still get 401 with
    the challenge (so the client refreshes), and a valid token must still work."""
    _, tokens = await sign_in(engine, member)
    for _ in range(throttle.mcp_bad_token.limit + 5):
        res = await team_status(engine, "rr_at_" + secrets.token_urlsafe(32))
        assert res.status_code == 401 and "resource_metadata" in res.headers["www-authenticate"]
    assert (await team_status(engine, tokens["access_token"])).status_code == 200
    async with engine.begin() as conn:
        await conn.execute(text("update oauth_tokens set expires_at = now() - interval '1 second' where kind='access'"))
    res = await team_status(engine, tokens["access_token"])
    assert res.status_code == 401 and 'error="invalid_token"' in res.headers["www-authenticate"]


async def test_token_resource_check_reads_multipart_too(engine: AsyncEngine, member: httpx.AsyncClient) -> None:
    client = await new_client(engine)
    verifier, challenge = pkce()
    code = (await consent(member, request_id(await authorize(member, client["client_id"], challenge))))["code"][0]
    form = {"grant_type": "authorization_code", "code": code, "client_id": client["client_id"],
            "code_verifier": verifier, "redirect_uri": LOCAL, "resource": "https://other.example/mcp"}  # fmt: skip
    async with bare(engine) as c:
        res = await c.post("/oauth/token", files={k: (None, v) for k, v in form.items()})
        assert res.status_code == 400 and res.json()["error"] == "invalid_target"
        res = await c.post("/oauth/token", files={k: (None, v) for k, v in {**form, "resource": team_url()}.items()})
    assert res.status_code == 200, res.text


async def test_oauth_off_without_https(engine: AsyncEngine, running: None, patch_settings) -> None:  # noqa: ANN001, F811
    patch_settings(cookie_secure=True)  # served over https, but RADAR_PUBLIC_URL still says http
    async with bare(engine) as c:
        assert (await c.get("/.well-known/oauth-authorization-server")).status_code == 404
        assert (await register(c)).status_code == 404
    res = await team_status(engine, None)
    assert res.status_code == 401 and "resource_metadata" not in res.headers["www-authenticate"]
    patch_settings(cookie_secure=True, public_url="https://radar.example.org", mcp_url="")
    async with bare(engine) as c:
        body = (await c.get("/.well-known/oauth-authorization-server")).json()
    assert body["issuer"] == "https://radar.example.org"
    assert body["token_endpoint"] == "https://radar.example.org/oauth/token"
    async with bare(engine) as c:
        res = await register(c, redirect_uris=["http://radar.example.org/cb"])  # https only (loopback aside)
        assert res.status_code == 400
    patch_settings(mcp_oauth=False, public_url="http://localhost:3010", cookie_secure=False)
    async with bare(engine) as c:
        assert (await c.get("/.well-known/oauth-protected-resource/mcp/equipo")).status_code == 404


# ---------- route inventory ----------

OPEN_NON_API = {
    ("GET", "/health"),
    ("POST", "/mcp"),
    ("POST", "/mcp/equipo"),
    ("GET", "/.well-known/oauth-protected-resource{rest:path}"),
    ("GET", "/.well-known/oauth-authorization-server{rest:path}"),
    ("GET", "/oauth/authorize"),
    ("POST", "/oauth/token"),
    ("POST", "/oauth/register"),
    ("POST", "/oauth/revoke"),
}
FASTAPI_DOCS = {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}


def test_no_route_outside_api_by_accident() -> None:
    """Everything outside /api/ skips the session check and the CSRF rule: it must be on this list on purpose. Every
    state-changing one of them reads no cookie (/mcp*, /oauth/token|register|revoke)."""
    found = set()
    for r in app.routes:
        path = getattr(r, "path", None)
        if path is None or path.startswith("/api/") or path in FASTAPI_DOCS:
            continue
        methods = getattr(r, "methods", None) or {"POST", "GET", "PUT", "PATCH", "DELETE"}  # raw ASGI endpoints
        if isinstance(r, Route) and r.methods is None:
            methods = {"POST"}  # /mcp*: the endpoint itself answers 405 to anything but POST
        found |= {(m, path) for m in methods if m != "HEAD"}
    assert found == OPEN_NON_API
    # routes of included routers (not in app.routes as such): all under /api/, where the session and CSRF rules apply
    assert {p for p in app.openapi()["paths"] if not p.startswith("/api/")} == {"/health"}


async def test_mcp_endpoints_refuse_other_methods(engine: AsyncEngine, running: None) -> None:  # noqa: F811
    async with _http(engine, None) as c:
        for path in ("/mcp", "/mcp/equipo"):
            assert (await c.get(path)).status_code == 405
    async with bare(engine) as c:
        assert (await c.post("/oauth/authorize")).status_code == 405
        assert (await c.get("/oauth/token")).status_code == 405


def test_clean_name() -> None:
    assert clean_name("Cafe\u0301 IA") == "Café IA"  # NFC: the accent joins its letter
    zalgo = "Bot" + "\u0300\u0301\u0302\u0303" * 50
    assert clean_name(zalgo) == "Bot\u0300"  # at most one combining mark per character
    assert clean_name("\u0301\u0301 Agente") == "Agente"  # no mark without a base character
    assert clean_name("Cla\u202eude\u200b\n\tCode") == "Claude Code"  # bidi override, zero-width, whitespace
    assert clean_name("x" * 100) == "x" * 60
    assert clean_name("\u200b") == "Asistente sin nombre"
    assert clean_name("\u2800\u3164 Claude \u2800") == "Claude"  # blank-looking letters count as spaces


async def test_pending_requests_are_bounded_without_evicting(engine: AsyncEngine, member: httpx.AsyncClient,
                                                             monkeypatch: pytest.MonkeyPatch) -> None:  # fmt: skip
    """Valid /oauth/authorize calls are not rate-limited, so the table of pending requests is bounded instead:
    anonymous requests per client and in total, refusing the newest (a real request already waiting is never pushed
    out); a signed-in person's requests have their own cap. Expired rows are deleted by index, at most once a minute."""
    monkeypatch.setattr(provider, "PENDING_PER_CLIENT", 3)
    monkeypatch.setattr(provider, "MAX_PENDING", 5)
    monkeypatch.setattr(provider, "PENDING_PER_USER", 4)
    a, b = await new_client(engine), await new_client(engine)
    _, challenge = pkce()
    async with make_client(engine) as browser:  # a real person, not signed in yet
        first = request_id(await authorize(browser, a["client_id"], challenge))
        async with bare(engine) as junk:
            codes = [(await authorize(junk, a["client_id"], challenge)).status_code for _ in range(4)]
            assert codes == [302, 302, 429, 429]  # per client: 3 anonymous
            codes = [(await authorize(junk, b["client_id"], challenge)).status_code for _ in range(3)]
            assert codes == [302, 302, 429]  # in total: 5 anonymous
        # the first request was not evicted: the person signs in and approves it; the consent page claims it
        await login(browser, "luis@example.org")
        assert (await browser.post("/api/oauth/consent", json={"request": first})).status_code == 200
        async with engine.connect() as conn:
            claimed = (await conn.execute(select(func.count()).select_from(oauth_requests)
                                          .where(oauth_requests.c.user_id.is_not(None)))).scalar()  # fmt: skip
        assert claimed == 1
        assert "code" in await consent(browser, first)
    # signed-in requests do not count with anonymous ones, and have their own cap
    codes = [(await authorize(member, b["client_id"], challenge)).status_code for _ in range(5)]
    assert codes == [302] * 4 + [429]

    # expired rows: not counted, deleted at most once per PURGE_EVERY
    async with engine.begin() as conn:
        await conn.execute(update(oauth_requests).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    monkeypatch.setattr(provider, "_requests_purged_at", None)
    async with bare(engine) as anon:
        assert (await authorize(anon, a["client_id"], challenge)).status_code == 302  # purges, then records
        async with engine.begin() as conn:
            await conn.execute(update(oauth_requests).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
        assert (await authorize(anon, a["client_id"], challenge)).status_code == 302  # no purge within the minute
    async with engine.connect() as conn:
        assert (await conn.execute(select(func.count()).select_from(oauth_requests))).scalar() == 2
        indexes = set((await conn.execute(text("select indexname from pg_indexes where tablename='oauth_requests'")))
                      .scalars())  # fmt: skip
    assert {"ix_oauth_requests_expires_at", "ix_oauth_requests_client_id"} <= indexes
