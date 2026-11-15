"""Rules about the assistants (OAuth clients) themselves: which redirect URIs they may register and use, how a
requested redirect URI is matched, how their self-declared name is shown, and whether we recognise them.

- A redirect URI is `https://…`, or `http://` on a loopback host (127.0.0.1, [::1], localhost) for programs on the
  person's own computer (RFC 8252 §7.3; MCP spec: "localhost or HTTPS"). No fragment, no user:password, ≤ 512 chars.
- Matching is exact against a registered value, except the port of a loopback `http` URI, which may differ (RFC 8252
  §7.3: native apps get a free port at request time).
- The name is what the client wrote: control, format (bidi, zero-width) characters are removed, whitespace collapsed
  and the result cut to 60 characters. The consent screen always shows it next to where the code will go.
"""

import re
import unicodedata
from typing import Literal
from urllib.parse import urlsplit

from mcp.shared.auth import InvalidRedirectUriError, OAuthClientInformationFull, OAuthClientMetadata
from pydantic import AnyUrl

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "[::1]", "::1", "localhost"})
MAX_REDIRECT_URIS = 5
MAX_URI_LENGTH = 512
MAX_NAME = 60
# Redirect URIs whose owner we know: an authorisation sent there can only reach that service.
KNOWN_REDIRECTS = {
    "https://claude.ai/api/mcp/auth_callback": "Claude",
    "https://claude.com/api/mcp/auth_callback": "Claude",
}

Kind = Literal["conocido", "local", "desconocido"]


def is_loopback(uri: str) -> bool:
    u = urlsplit(uri)
    return u.scheme == "http" and (u.hostname or "") in LOOPBACK_HOSTS | {"::1"}


def redirect_problem(uri: str) -> str | None:
    """Why `uri` cannot be a redirect URI, or None."""
    if len(uri) > MAX_URI_LENGTH:
        return "redirect_uri too long"
    try:
        u = urlsplit(uri)
        u.port  # noqa: B018 - raises on a bad port
    except ValueError:
        return "redirect_uri is not a valid URL"
    if u.fragment or "#" in uri:
        return "redirect_uri must not have a fragment"
    if u.username is not None or u.password is not None:
        return "redirect_uri must not carry credentials"
    if not u.hostname:
        return "redirect_uri needs a host"
    if u.scheme == "https":
        return None
    if u.scheme == "http" and is_loopback(uri):
        return None
    return "redirect_uri must be https, or http on a loopback address (127.0.0.1, [::1], localhost)"


def _same_except_loopback_port(registered: str, requested: str) -> bool:
    if not (is_loopback(registered) and is_loopback(requested)):
        return False
    a, b = urlsplit(registered), urlsplit(requested)
    return (a.scheme, a.hostname, a.path or "/", a.query) == (b.scheme, b.hostname, b.path or "/", b.query)


def redirect_matches(registered: list[str], requested: str) -> bool:
    return any(r == requested or _same_except_loopback_port(r, requested) for r in registered)


# Letters and symbols that render as nothing (a name of these would look empty or pad itself out): treated as spaces.
BLANK_LOOKING = frozenset("\u115f\u1160\u17b4\u17b5\u2800\u3164\uffa0")


def clean_name(raw: str | None) -> str:
    """NFC, then: no control or format characters (bidi overrides, zero-width), at most one combining mark per base
    character (no "zalgo" text spilling over the consent screen), whitespace collapsed, MAX_NAME characters."""
    out: list[str] = []
    marks = 0
    for c in unicodedata.normalize("NFC", raw or ""):
        cat = unicodedata.category(c)
        if c.isspace() or c in BLANK_LOOKING:
            out.append(" ")
            marks = 1  # no mark on a space
        elif cat[0] == "C":
            continue
        elif cat[0] == "M":
            if marks == 0 and out:
                out.append(c)
            marks += 1
        else:
            out.append(c)
            marks = 0
    text = re.sub(r"\s+", " ", "".join(out)).strip()
    return text[:MAX_NAME].strip() or "Asistente sin nombre"


def kind_of(redirect_uri: str) -> Kind:
    if redirect_uri in KNOWN_REDIRECTS:
        return "conocido"
    return "local" if is_loopback(redirect_uri) else "desconocido"


def host_of(redirect_uri: str) -> str:
    """Host (and port when not the default) the code is sent to: what the consent screen shows."""
    u = urlsplit(redirect_uri)
    host = u.hostname or ""
    if ":" in host:
        host = f"[{host}]"
    return f"{host}:{u.port}" if u.port else host


class RadarClient(OAuthClientInformationFull):
    """A registered client as the SDK handlers see it. `client_secret` is never filled in (only its hash is kept,
    app/oauth/provider.py authenticates); the loopback port rule replaces the SDK's exact-match check."""

    secret_hash: str | None = None
    display_name: str = ""

    def validate_redirect_uri(self, redirect_uri: AnyUrl | None) -> AnyUrl:
        registered = [str(u) for u in self.redirect_uris or []]
        if redirect_uri is None:
            if len(registered) == 1:
                return AnyUrl(registered[0])
            raise InvalidRedirectUriError("redirect_uri must be specified unless the client has exactly one")
        if not redirect_matches(registered, str(redirect_uri)):
            raise InvalidRedirectUriError("redirect_uri not registered for this client")
        return redirect_uri

    def validate_scope(self, requested_scope: str | None) -> list[str] | None:
        # One read-only permission: whatever was asked for, the grant is exactly that (RFC 6749 §3.3 lets the
        # server issue a different scope; the token response says which).
        from app.oauth.provider import SCOPE

        return [SCOPE]


def registration_problem(meta: OAuthClientMetadata) -> str | None:
    uris = [str(u) for u in meta.redirect_uris or []]
    if not uris or len(uris) > MAX_REDIRECT_URIS:
        return f"between 1 and {MAX_REDIRECT_URIS} redirect_uris"
    for uri in uris:
        if problem := redirect_problem(uri):
            return problem
    return None
