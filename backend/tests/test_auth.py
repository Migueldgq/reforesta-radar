"""Accounts and access control against a real Postgres (see conftest.py)."""

import asyncio
import re
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncEngine

from app.auth import passwords, throttle
from app.auth.accounts import bootstrap_admin
from app.auth.deps import COOKIE
from app.auth.passwords import hash_password, password_problem, verify_password
from app.auth.tokens import hash_token
from app.config import settings
from app.db.tables import invitations, password_resets, sessions, users
from app.main import app
from tests.conftest import PASSWORD, add_user, login, make_client

BAD_LOGIN = {"detail": "Correo o contraseña incorrectos."}
OPEN_PREFIXES = ("/api/auth/", "/api/public/")


# ---------- passwords ----------


def test_password_hashing() -> None:
    h = hash_password("una contraseña larga")
    assert h.startswith("$argon2id$")
    assert verify_password(h, "una contraseña larga")
    assert not verify_password(h, "una contraseña larg")
    assert not verify_password(None, "una contraseña larga")  # unknown account: dummy verify, always False
    assert not verify_password("not-a-hash", "x")
    assert hash_password("una contraseña larga") != h  # salted
    assert password_problem("123456789") and not password_problem("1234567890")
    assert password_problem("x" * 257)


# ---------- login ----------


async def test_login_sets_hardened_cookie_and_stores_only_a_hash(
    engine: AsyncEngine, client: httpx.AsyncClient
) -> None:
    await add_user(engine, "Ana@Example.org", "admin", name="Ana")
    res = await client.post("/api/auth/login", json={"email": "  ANA@example.ORG ", "password": PASSWORD})
    assert res.status_code == 200
    assert res.json() == {
        "user": {"id": 1, "email": "ana@example.org", "name": "Ana", "role": "admin"},
        "forgotPassword": False,
    }
    cookie = res.headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE}=") and "HttpOnly" in cookie and "SameSite=lax" in cookie
    assert "Secure" not in cookie and "Max-Age=2592000" in cookie and "Path=/" in cookie
    token = client.cookies[COOKIE]
    assert len(token) >= 43  # 32 random bytes, url-safe base64
    async with engine.connect() as conn:
        (stored,) = (await conn.execute(select(sessions.c.token_hash))).one()
        last_login = (await conn.execute(select(users.c.last_login_at))).scalar()
    assert stored == hash_token(token) and stored != token and last_login is not None
    me = await client.get("/api/auth/session")
    assert me.json()["user"]["email"] == "ana@example.org"


async def test_cookie_secure_by_config(engine: AsyncEngine, client: httpx.AsyncClient, patch_settings) -> None:  # noqa: ANN001
    patch_settings(cookie_secure=True)
    await add_user(engine, "ana@example.org")
    res = await client.post("/api/auth/login", json={"email": "ana@example.org", "password": PASSWORD})
    assert "Secure" in res.headers["set-cookie"]


async def test_login_failures_are_generic(engine: AsyncEngine, client: httpx.AsyncClient) -> None:
    await add_user(engine, "ana@example.org")
    uid = await add_user(engine, "eva@example.org")
    async with engine.begin() as conn:
        await conn.execute(update(users).where(users.c.id == uid).values(active=False))
    for email, pw in [("ana@example.org", "wrong password"), ("nadie@example.org", PASSWORD),
                      ("eva@example.org", PASSWORD)]:  # fmt: skip
        res = await client.post("/api/auth/login", json={"email": email, "password": pw})
        assert (res.status_code, res.json()) == (401, BAD_LOGIN)
        assert "set-cookie" not in res.headers
    assert (await client.get("/api/auth/session")).json()["user"] is None


async def test_failures_from_one_client_never_lock_out_a_right_password(engine: AsyncEngine) -> None:
    await add_user(engine, "ana@example.org")
    wrong = {"email": "ana@example.org", "password": "nope nope nope"}
    right = {"email": "ana@example.org", "password": PASSWORD}
    async with make_client(engine, ip="203.0.113.9") as attacker, make_client(engine, ip="198.51.100.7") as ana:
        for _ in range(throttle.account_ip.limit):
            assert (await attacker.post("/api/auth/login", json=wrong)).status_code == 401
        res = await attacker.post("/api/auth/login", json=wrong)
        assert res.status_code == 429 and int(res.headers["retry-after"]) > 0  # that client is now told to wait
        assert (await ana.post("/api/auth/login", json=right)).status_code == 200  # another client: unaffected
        # same client too (e.g. everyone behind the proxy's one IP): the right password still works
        assert (await attacker.post("/api/auth/login", json=right)).status_code == 200
        assert (await ana.get("/api/board")).status_code == 200


async def test_account_ceiling_is_the_hard_backstop(engine: AsyncEngine) -> None:
    await add_user(engine, "ana@example.org")
    for i in range(throttle.account_ceiling.limit):  # spread over many IPs
        async with make_client(engine, ip=f"10.0.{i // 250}.{i % 250 + 1}") as c:
            await c.post("/api/auth/login", json={"email": "ana@example.org", "password": "nope nope nope"})
    async with make_client(engine, ip="198.51.100.7") as ana:
        res = await ana.post("/api/auth/login", json={"email": "ana@example.org", "password": PASSWORD})
        assert res.status_code == 429  # refused without checking the password
    # an unknown address is throttled the same way (no hint that it does not exist)
    async with make_client(engine) as c:
        for _ in range(throttle.account_ip.limit):
            await c.post("/api/auth/login", json={"email": "x@example.org", "password": "nope nope nope"})
        assert (await c.post("/api/auth/login", json={"email": "x@example.org", "password": "n"})).status_code == 429


async def test_concurrent_guesses_are_counted_before_checking(engine: AsyncEngine, client: httpx.AsyncClient) -> None:
    await add_user(engine, "ana@example.org")
    wrong = {"email": "ana@example.org", "password": "nope nope nope"}
    responses = await asyncio.gather(*(client.post("/api/auth/login", json=wrong) for _ in range(20)))
    codes = [r.status_code for r in responses]
    assert codes.count(401) == throttle.account_ip.limit and codes.count(429) == 20 - throttle.account_ip.limit


async def test_argon2_runs_at_most_n_at_a_time(
    engine: AsyncEngine, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    running = peak = 0
    lock = threading.Lock()
    real = passwords.verify_password

    def slow_verify(stored: str | None, password: str) -> bool:
        nonlocal running, peak
        with lock:
            running += 1
            peak = max(peak, running)
        try:
            time.sleep(0.02)
            return real(stored, password)
        finally:
            with lock:
                running -= 1

    monkeypatch.setattr(passwords, "verify_password", slow_verify)
    await asyncio.gather(*(
        client.post("/api/auth/login", json={"email": f"u{i}@example.org", "password": "nope nope nope"})
        for i in range(12)
    ))  # fmt: skip
    assert peak == settings.argon2_concurrency == 2


def test_forwarded_headers_not_trusted_from_everyone() -> None:
    compose = (Path(__file__).resolve().parents[2] / "docker-compose.yml").read_text()
    m = re.search(r"FORWARDED_ALLOW_IPS: \$\{FORWARDED_ALLOW_IPS:-([^}]*)\}", compose)
    assert m and m.group(1) == "127.0.0.1"  # trust only what an operator configures (docs/backend.md)


# ---------- sessions ----------


async def test_session_expiry_and_sliding(engine: AsyncEngine, admin: httpx.AsyncClient) -> None:
    assert (await admin.get("/api/board")).status_code == 200
    old = datetime.now(UTC) - timedelta(hours=2)
    async with engine.begin() as conn:
        await conn.execute(update(sessions).values(last_seen_at=old, expires_at=datetime.now(UTC) + timedelta(days=1)))
    res = await admin.get("/api/board")
    assert res.status_code == 200 and f"{COOKIE}=" in res.headers["set-cookie"]  # cookie re-issued
    async with engine.connect() as conn:
        expires = (await conn.execute(select(sessions.c.expires_at))).scalar_one()
    assert expires > datetime.now(UTC) + timedelta(days=29)
    async with engine.begin() as conn:
        await conn.execute(update(sessions).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    assert (await admin.get("/api/board")).status_code == 401
    assert (await admin.get("/api/auth/session")).json()["user"] is None


async def test_logout_revokes_server_side(engine: AsyncEngine, admin: httpx.AsyncClient) -> None:
    token = admin.cookies[COOKIE]
    res = await admin.post("/api/auth/logout")
    assert res.status_code == 204 and f'{COOKIE}=""' in res.headers["set-cookie"]
    async with make_client(engine) as stolen:  # the old token no longer works anywhere
        stolen.cookies.set(COOKIE, token)
        assert (await stolen.get("/api/board")).status_code == 401


async def test_password_change_revokes_other_sessions(engine: AsyncEngine, member: httpx.AsyncClient) -> None:
    async with make_client(engine) as other:
        await login(other, "luis@example.org")
        bad = await member.post("/api/me/password", json={"currentPassword": "wrong one!", "newPassword": "x" * 12})
        assert bad.status_code == 400
        short = await member.post("/api/me/password", json={"currentPassword": PASSWORD, "newPassword": "short"})
        assert short.status_code == 400
        body = {"currentPassword": PASSWORD, "newPassword": "nueva clave 2026"}
        ok = await member.post("/api/me/password", json=body)
        assert ok.status_code == 204
        assert (await member.get("/api/board")).status_code == 200  # this browser got a fresh session
        assert (await other.get("/api/board")).status_code == 401
    async with make_client(engine) as c:
        await login(c, "luis@example.org", "nueva clave 2026")


async def test_role_change_and_deactivation_revoke_sessions(
    engine: AsyncEngine, admin: httpx.AsyncClient, member: httpx.AsyncClient
) -> None:
    assert (await member.get("/api/board")).status_code == 200
    res = await admin.patch("/api/team/users/2", json={"role": "admin"})
    assert res.status_code == 200 and res.json()["role"] == "admin"
    assert (await member.get("/api/board")).status_code == 401
    await login(member, "luis@example.org")
    assert (await member.get("/api/team")).status_code == 200  # now an admin
    assert (await admin.patch("/api/team/users/2", json={"active": False})).json()["active"] is False
    assert (await member.get("/api/board")).status_code == 401
    res = await member.post("/api/auth/login", json={"email": "luis@example.org", "password": PASSWORD})
    assert (res.status_code, res.json()) == (401, BAD_LOGIN)
    assert (await admin.patch("/api/team/users/2", json={"active": True})).status_code == 200
    await login(member, "luis@example.org")


# ---------- every route is protected ----------


def _api_routes() -> list[tuple[str, str]]:
    """Every /api/ operation the app serves, from its OpenAPI schema (the public view of the router, includes
    routes of included routers): a new route is covered by the tests below without listing it."""
    return [(m.upper(), path) for path, ops in app.openapi()["paths"].items() if path.startswith("/api/") for m in ops]


def _url(path: str) -> str:
    return re.sub(r"\{opportunity_id\}", "rsc:nope", re.sub(r"\{\w+_id\}", "999999", path))


ADMIN_ROUTES = {
    ("GET", "/api/team"),
    ("POST", "/api/team/invitations"),
    ("DELETE", "/api/team/invitations/{invitation_id}"),
    ("PATCH", "/api/team/users/{user_id}"),
    ("POST", "/api/team/users/{user_id}/reset-link"),
    ("DELETE", "/api/team/resets/{reset_id}"),
    ("GET", "/api/votes/disagreements"),
    ("POST", "/api/ingest"),
}


def test_route_inventory() -> None:
    """A new route must be added here on purpose: open routes are only /api/auth/* and /api/public/*."""
    routes = _api_routes()
    assert set(routes) >= ADMIN_ROUTES
    assert {p for _, p in routes if p.startswith(OPEN_PREFIXES)} == {
        "/api/auth/session", "/api/auth/login", "/api/auth/logout", "/api/auth/invitation",
        "/api/auth/invitation/accept", "/api/auth/reset", "/api/auth/reset/accept", "/api/auth/forgot",
        "/api/public/oportunidades",
    }  # fmt: skip


async def test_every_protected_route_needs_a_session(client: httpx.AsyncClient) -> None:
    checked = 0
    for method, path in _api_routes():
        if path.startswith(OPEN_PREFIXES):
            continue
        res = await client.request(method, _url(path), json={})
        assert res.status_code == 401, (method, path, res.status_code)
        checked += 1
    assert checked >= 20


async def test_members_get_403_on_admin_routes_only(member: httpx.AsyncClient) -> None:
    for method, path in _api_routes():
        if path.startswith(OPEN_PREFIXES) or path == "/api/analyze-pdf":
            continue
        res = await member.request(method, _url(path), json={})
        if (method, path) in ADMIN_ROUTES:
            assert res.status_code == 403, (method, path, res.status_code)
        else:
            assert res.status_code not in (401, 403), (method, path, res.status_code)


async def test_open_routes(client: httpx.AsyncClient) -> None:
    assert (await client.get("/api/auth/session")).json() == {"user": None, "forgotPassword": False}
    assert (await client.get("/api/public/oportunidades")).status_code == 200


# ---------- CSRF ----------


async def test_csrf_rule(engine: AsyncEngine) -> None:
    await add_user(engine, "ana@example.org", "admin")
    body = {"email": "ana@example.org", "password": PASSWORD}
    async with make_client(engine) as c:
        del c.headers["X-Radar-CSRF"]
        res = await c.post("/api/auth/login", json=body)  # login CSRF too
        assert res.status_code == 403 and "X-Radar-CSRF" in res.json()["detail"]
        assert (await c.post("/api/auth/login", json=body, headers={"X-Radar-CSRF": "0"})).status_code == 403
        for site in ("cross-site", "same-site"):
            res = await c.post("/api/auth/login", json=body, headers={"X-Radar-CSRF": "1", "Sec-Fetch-Site": site})
            assert res.status_code == 403
        res = await c.post("/api/auth/login", json=body, headers={"X-Radar-CSRF": "1", "Sec-Fetch-Site": "same-origin"})
        assert res.status_code == 200
        assert (await c.get("/api/board")).status_code == 200  # safe methods need no header
        assert (await c.patch("/api/me", json={"name": "Ana"})).status_code == 403
        assert (await c.patch("/api/me", json={"name": "Ana"}, headers={"X-Radar-CSRF": "1"})).status_code == 200


# ---------- invitations ----------


async def test_invitation_lifecycle(engine: AsyncEngine, admin: httpx.AsyncClient, client: httpx.AsyncClient) -> None:
    res = await admin.post("/api/team/invitations", json={"email": "Marta@Example.org", "name": "Marta"})
    assert res.status_code == 201
    out = res.json()
    assert out["invitation"]["email"] == "marta@example.org" and out["invitation"]["role"] == "member"
    assert out["emailed"] is False
    m = re.fullmatch(r"http://localhost:3010/invitacion/([A-Za-z0-9_-]{43,})", out["link"])
    assert m, out["link"]
    token = m.group(1)
    async with engine.connect() as conn:
        stored = (await conn.execute(select(invitations.c.token_hash))).scalar_one()
    assert stored == hash_token(token)
    team = (await admin.get("/api/team")).json()
    assert [i["email"] for i in team["invitations"]] == ["marta@example.org"]

    info = await client.post("/api/auth/invitation", json={"token": token})
    assert info.status_code == 200 and info.json()["email"] == "marta@example.org"
    # the invitee cannot choose another e-mail: extra fields are ignored
    acc = await client.post(
        "/api/auth/invitation/accept",
        json={"token": token, "name": "Marta G.", "password": "una clave muy larga", "email": "evil@example.org"},
    )
    assert acc.status_code == 201
    assert acc.json()["user"] == {"id": 2, "email": "marta@example.org", "name": "Marta G.", "role": "member"}
    assert (await client.get("/api/board")).status_code == 200  # logged in
    again = await client.post("/api/auth/invitation/accept", json={"token": token, "password": "una clave muy larga"})
    assert again.status_code == 404
    assert (await client.post("/api/auth/invitation", json={"token": token})).status_code == 404
    assert (await admin.get("/api/team")).json()["invitations"] == []
    dup = await admin.post("/api/team/invitations", json={"email": "MARTA@example.org"})
    assert dup.status_code == 409


async def test_invitation_expired_revoked_replaced(engine: AsyncEngine, admin: httpx.AsyncClient) -> None:
    async def invite(email: str) -> tuple[int, str]:
        out = (await admin.post("/api/team/invitations", json={"email": email, "role": "admin"})).json()
        return out["invitation"]["id"], out["link"].rsplit("/", 1)[1]

    body = {"password": "una clave muy larga"}
    async with make_client(engine) as c:
        inv_id, token = await invite("pablo@example.org")
        assert (await admin.delete(f"/api/team/invitations/{inv_id}")).status_code == 204
        assert (await admin.delete(f"/api/team/invitations/{inv_id}")).status_code == 404
        assert (await c.post("/api/auth/invitation/accept", json={"token": token, **body})).status_code == 404

        _, token = await invite("pablo@example.org")
        async with engine.begin() as conn:
            await conn.execute(update(invitations).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
        assert (await c.post("/api/auth/invitation", json={"token": token})).status_code == 404
        assert (await c.post("/api/auth/invitation/accept", json={"token": token, **body})).status_code == 404

        _, first = await invite("pablo@example.org")
        _, second = await invite("pablo@example.org")  # replaces the pending one
        assert (await c.post("/api/auth/invitation", json={"token": first})).status_code == 404
        short = await c.post("/api/auth/invitation/accept", json={"token": second, "password": "corta"})
        assert short.status_code == 400 and "10 caracteres" in short.json()["detail"]
        res = await c.post("/api/auth/invitation/accept", json={"token": second, **body})
        assert res.status_code == 201 and res.json()["user"]["role"] == "admin"
        assert (await c.post("/api/auth/invitation", json={"token": "made-up"})).status_code == 404


# ---------- password reset ----------


async def test_reset_lifecycle(engine: AsyncEngine, admin: httpx.AsyncClient, member: httpx.AsyncClient) -> None:
    first = (await admin.post("/api/team/users/2/reset-link")).json()
    out = (await admin.post("/api/team/users/2/reset-link")).json()  # the first one stops working
    assert out["link"].startswith("http://localhost:3010/restablecer/") and out["emailed"] is False
    token = out["link"].rsplit("/", 1)[1]
    async with make_client(engine) as c:
        assert (await c.post("/api/auth/reset", json={"token": first["link"].rsplit("/", 1)[1]})).status_code == 404
        info = await c.post("/api/auth/reset", json={"token": token})
        assert info.json()["email"] == "luis@example.org"
        assert (await c.post("/api/auth/reset/accept", json={"token": token, "password": "corta"})).status_code == 400
        res = await c.post("/api/auth/reset/accept", json={"token": token, "password": "otra clave larga"})
        assert res.status_code == 200 and res.json()["user"]["email"] == "luis@example.org"
        assert (await c.get("/api/board")).status_code == 200
        assert (await member.get("/api/board")).status_code == 401  # older sessions ended
        again = await c.post("/api/auth/reset/accept", json={"token": token, "password": "otra clave larga"})
        assert again.status_code == 404
    async with make_client(engine) as c:
        await login(c, "luis@example.org", "otra clave larga")

    out = (await admin.post("/api/team/users/2/reset-link")).json()
    async with engine.begin() as conn:
        await conn.execute(update(password_resets).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    async with make_client(engine) as c:
        token = out["link"].rsplit("/", 1)[1]
        res = await c.post("/api/auth/reset/accept", json={"token": token, "password": "x" * 12})
        assert res.status_code == 404
    assert (await admin.post("/api/team/users/99/reset-link")).status_code == 404


async def test_forgot_password_only_with_email(
    engine: AsyncEngine,
    client: httpx.AsyncClient,
    patch_settings,
    monkeypatch: pytest.MonkeyPatch,  # noqa: ANN001
) -> None:
    assert (await client.post("/api/auth/forgot", json={"email": "ana@example.org"})).status_code == 404
    sent: list[tuple[str, str]] = []

    class FakeSMTP:
        def __init__(self, host: str, port: int, timeout: float) -> None:
            assert (host, port) == ("smtp.example.org", 587)

        def __enter__(self) -> "FakeSMTP":
            return self

        def __exit__(self, *a: object) -> None:
            pass

        def starttls(self) -> None:
            pass

        def login(self, user: str, password: str) -> None:
            pass

        def send_message(self, msg) -> None:  # noqa: ANN001
            sent.append((msg["To"], msg.get_content()))

    monkeypatch.setattr("app.auth.mail.smtplib.SMTP", FakeSMTP)
    patch_settings(smtp_host="smtp.example.org", smtp_from="radar@example.org")
    await add_user(engine, "ana@example.org")
    assert (await client.get("/api/auth/session")).json()["forgotPassword"] is True
    for email in ("nadie@example.org", "ana@example.org"):
        res = await client.post("/api/auth/forgot", json={"email": email})
        assert (res.status_code, res.json()) == (202, {"ok": True})  # same answer either way
    assert len(sent) == 1 and sent[0][0] == "ana@example.org"
    token = re.search(r"/restablecer/([A-Za-z0-9_-]+)", sent[0][1]).group(1)  # type: ignore[union-attr]
    assert (await client.post("/api/auth/reset", json={"token": token})).status_code == 200


# ---------- last admin ----------


async def test_last_active_admin_is_protected(engine: AsyncEngine, admin: httpx.AsyncClient) -> None:
    for body in ({"role": "member"}, {"active": False}):
        res = await admin.patch("/api/team/users/1", json=body)
        assert res.status_code == 409 and "al menos un administrador" in res.json()["detail"]
    await add_user(engine, "pablo@example.org", "admin")
    assert (await admin.patch("/api/team/users/2", json={"active": False})).status_code == 200
    assert (await admin.patch("/api/team/users/1", json={"role": "member"})).status_code == 409  # 2 is inactive
    assert (await admin.patch("/api/team/users/2", json={"active": True})).status_code == 200
    assert (await admin.patch("/api/team/users/1", json={"role": "member"})).status_code == 200
    assert (await admin.get("/api/team")).status_code == 401  # own role changed: session ended


# ---------- bootstrap ----------


async def test_bootstrap_admin_only_on_empty_table(engine: AsyncEngine, patch_settings) -> None:  # noqa: ANN001
    patch_settings(bootstrap_admin_email="Root@Example.org", bootstrap_admin_password="corta")
    await bootstrap_admin(engine)
    async with engine.connect() as conn:
        assert (await conn.execute(text("select count(*) from users"))).scalar() == 0  # too short: refused
    patch_settings(bootstrap_admin_password="bootstrap clave larga")
    await bootstrap_admin(engine)
    await bootstrap_admin(engine)
    async with engine.connect() as conn:
        rows = (await conn.execute(select(users.c.email, users.c.role))).all()
    assert [tuple(r) for r in rows] == [("root@example.org", "admin")]
    patch_settings(bootstrap_admin_email="otro@example.org")
    await bootstrap_admin(engine)
    async with engine.connect() as conn:
        assert (await conn.execute(text("select count(*) from users"))).scalar() == 1


async def test_wrong_current_password_never_blocks_login(engine: AsyncEngine, member: httpx.AsyncClient) -> None:
    for _ in range(throttle.password_change.limit):
        bad = await member.post("/api/me/password", json={"currentPassword": "wrong one!", "newPassword": "x" * 12})
        assert bad.status_code == 400
    body = {"currentPassword": PASSWORD, "newPassword": "x" * 12}
    assert (await member.post("/api/me/password", json=body)).status_code == 429
    async with make_client(engine) as c:
        await login(c, "luis@example.org")


# ---------- links of a person who loses admin ----------


async def test_demoted_or_deactivated_admin_links_stop_working(engine: AsyncEngine, admin: httpx.AsyncClient) -> None:
    await add_user(engine, "pablo@example.org", "admin")  # user 2
    await add_user(engine, "luis@example.org")  # user 3
    async with make_client(engine) as pablo:
        await login(pablo, "pablo@example.org")
        reset = (await pablo.post("/api/team/users/1/reset-link")).json()  # for ana
        inv = (await pablo.post("/api/team/invitations", json={"email": "marta@example.org", "role": "admin"})).json()
    own = (await admin.post("/api/team/users/3/reset-link")).json()  # ana's link for luis: unaffected
    team = (await admin.get("/api/team")).json()
    assert {(r["userId"], r["createdBy"]) for r in team["resets"]} == {(1, 2), (3, 1)}
    assert team["resets"][0]["userName"] and team["invitations"][0]["createdBy"] == 2

    assert (await admin.patch("/api/team/users/2", json={"active": False})).status_code == 200
    async with make_client(engine) as c:
        token = reset["link"].rsplit("/", 1)[1]
        assert (await c.post("/api/auth/reset", json={"token": token})).status_code == 404
        assert (await c.post("/api/auth/invitation", json={"token": inv["link"].rsplit("/", 1)[1]})).status_code == 404
        assert (await c.post("/api/auth/reset", json={"token": own["link"].rsplit("/", 1)[1]})).status_code == 200
    team = (await admin.get("/api/team")).json()
    assert [r["userId"] for r in team["resets"]] == [3] and team["invitations"] == []

    # demotion (not deactivation) cancels them too; and an admin can revoke any pending reset link
    await admin.patch("/api/team/users/2", json={"active": True})
    async with make_client(engine) as pablo:
        await login(pablo, "pablo@example.org")
        reset = (await pablo.post("/api/team/users/3/reset-link")).json()
    await admin.patch("/api/team/users/2", json={"role": "member"})
    async with make_client(engine) as c:
        assert (await c.post("/api/auth/reset", json={"token": reset["link"].rsplit("/", 1)[1]})).status_code == 404
    own = (await admin.post("/api/team/users/3/reset-link")).json()
    (pending,) = (await admin.get("/api/team")).json()["resets"]
    assert (await admin.delete(f"/api/team/resets/{pending['id']}")).status_code == 204
    assert (await admin.delete(f"/api/team/resets/{pending['id']}")).status_code == 404
    async with make_client(engine) as c:
        assert (await c.post("/api/auth/reset", json={"token": own["link"].rsplit("/", 1)[1]})).status_code == 404


# ---------- body size ----------


async def test_oversized_bodies_rejected_before_routing(client: httpx.AsyncClient) -> None:
    big = b"x" * (1024 * 1024 + 1)
    res = await client.post("/api/import", content=big, headers={"Content-Type": "application/json"})
    assert res.status_code == 413 and res.json() == {"detail": "La petición es demasiado grande."}  # not 401

    async def chunks():  # noqa: ANN202 - streamed without Content-Length
        for _ in range(20):
            yield b"x" * 100_000

    res = await client.post("/api/import", content=chunks(), headers={"Content-Type": "application/json"})
    assert res.status_code == 413
    # the PDF route allows up to 16 MiB: a 2 MB body reaches the session check
    res = await client.post("/api/analyze-pdf", content=b"x" * 2_000_000, headers={"Content-Type": "application/pdf"})
    assert res.status_code == 401
    assert (await client.post("/api/import", json={})).status_code == 401  # small bodies pass through
