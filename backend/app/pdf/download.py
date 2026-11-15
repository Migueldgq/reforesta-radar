"""Size-capped, SSRF-safe PDF download and the bounded result cache (port of src/lib/pdf-cache.ts).

Stricter than the TS, which only checked the first hostname against an allow-list and then let fetch() follow
redirects anywhere. Here every hop (first URL and each redirect):
- must be http or https on the default port for its scheme;
- has its hostname resolved once, and every resolved address must be globally routable (no loopback, private,
  link-local, CGNAT, multicast, reserved or unspecified addresses, including IPv4-mapped IPv6);
- is then requested against that exact IP (Host header and TLS SNI/certificate check keep the hostname), so a
  second DNS answer cannot swap in an internal address (DNS rebinding).
Redirects are followed by hand (at most 5), the body is streamed with a hard byte cap, the whole download has one
total timeout, and proxies from the environment are ignored.
"""

import asyncio
import ipaddress
import logging
import socket
from collections import OrderedDict
from typing import Literal

import httpx

from app.config import settings

log = logging.getLogger(__name__)

MAX_PDF_BYTES = 15 * 1024 * 1024
MAX_ENTRIES = 50
MAX_REDIRECTS = 5
_DEFAULT_PORT = {"http": 80, "https": 443}


class BlockedUrl(Exception):
    """The URL (or a redirect hop) points somewhere we refuse to fetch."""


class LruCache[V]:
    def __init__(self, max_entries: int = MAX_ENTRIES) -> None:
        self._data: OrderedDict[str, V] = OrderedDict()
        self._max = max_entries

    def get(self, key: str) -> V | None:
        if key not in self._data:
            return None
        self._data.move_to_end(key)
        return self._data[key]

    def set(self, key: str, value: V) -> None:
        self._data[key] = value
        self._data.move_to_end(key)
        if len(self._data) > self._max:
            self._data.popitem(last=False)

    def clear(self) -> None:
        self._data.clear()


def _is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


async def _getaddrinfo(host: str, port: int) -> list:
    return await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)


async def resolve_public(host: str, port: int) -> str:
    """Resolve `host` and return one address, or raise BlockedUrl if ANY answer is not public."""
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        addrs = [literal]
    else:
        try:
            infos = await _getaddrinfo(host, port)
        except OSError as e:
            raise BlockedUrl(f"cannot resolve {host}") from e
        addrs = [ipaddress.ip_address(info[4][0].split("%", 1)[0]) for info in infos]
    if not addrs or not all(_is_public(a) for a in addrs):
        raise BlockedUrl(f"{host} resolves to a non-public address")
    return str(addrs[0])


def check_url(url: httpx.URL) -> None:
    """Scheme / port / host checks that need no network."""
    if url.scheme not in _DEFAULT_PORT:
        raise BlockedUrl(f"scheme {url.scheme!r} not allowed")
    if url.port is not None and url.port != _DEFAULT_PORT[url.scheme]:
        raise BlockedUrl(f"port {url.port} not allowed")
    if not url.host:
        raise BlockedUrl("missing host")


async def download_pdf(
    url: str,
    timeout: float = 15.0,
    transport: httpx.AsyncBaseTransport | None = None,
) -> bytes | Literal["too-large"] | None:
    """Bytes, "too-large" past MAX_PDF_BYTES, None on network/HTTP failure. Raises BlockedUrl."""
    try:
        async with (
            asyncio.timeout(timeout),
            httpx.AsyncClient(
                headers={"User-Agent": settings.user_agent},
                follow_redirects=False,
                trust_env=False,
                timeout=None,
                limits=httpx.Limits(max_keepalive_connections=0),  # each hop gets its own TLS check
                transport=transport,
            ) as client,
        ):
            current = httpx.URL(url)
            for _ in range(MAX_REDIRECTS + 1):
                check_url(current)
                ip = await resolve_public(current.host, current.port or _DEFAULT_PORT[current.scheme])
                pinned = current.copy_with(host=ip)
                req = client.build_request(
                    "GET",
                    pinned,
                    headers={"Host": current.netloc.decode("ascii")},
                    extensions={"sni_hostname": current.host},
                )
                res = await client.send(req, stream=True)
                try:
                    if res.is_redirect:
                        location = res.headers.get("location")
                        if not location:
                            return None
                        current = current.join(location)
                        continue
                    if not res.is_success:
                        log.info("HTTP %s: %s", res.status_code, current)
                        return None
                    if int(res.headers.get("content-length") or 0) > MAX_PDF_BYTES:
                        return "too-large"
                    chunks: list[bytes] = []
                    total = 0
                    async for chunk in res.aiter_bytes():
                        total += len(chunk)
                        if total > MAX_PDF_BYTES:
                            return "too-large"
                        chunks.append(chunk)
                    return b"".join(chunks)
                finally:
                    await res.aclose()
            log.info("too many redirects: %s", url)
            return None
    except BlockedUrl:
        raise
    except (TimeoutError, httpx.HTTPError, ValueError) as e:
        log.info("PDF download failed (%s): %s", type(e).__name__, url)
        return None
