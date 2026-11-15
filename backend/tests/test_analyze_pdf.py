"""POST /api/analyze-pdf and GET /api/perfil against the TS route's recorded output (tests/golden/)."""

import json
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api import analyze_pdf as route
from app.auth.deps import CurrentUser, current_user
from app.main import app
from app.pdf import download
from app.pdf.download import MAX_PDF_BYTES, BlockedUrl, download_pdf, resolve_public

GOLDEN = Path(__file__).parent / "golden"
client = TestClient(app, headers={"X-Radar-CSRF": "1"})


@pytest.fixture(autouse=True)
def signed_in() -> Iterator[None]:
    """These routes need a session (tested in test_auth.py); here a fake member is enough."""
    app.dependency_overrides[current_user] = lambda: CurrentUser(1, "ana@example.org", "Ana", "member", 1)
    yield
    app.dependency_overrides.pop(current_user, None)


# Text extraction differs from pdf.js in one spot of the MITECO sample: pypdf joins "ES - ESPAÑA" and the next
# line without a break, so the text is one character shorter. Nothing else in the result changes.
EXTRACTION_DIFFS = {"madrid": set(), "miteco": {"charCount", "excerpt"}}


def _sample(name: str) -> dict:
    res = client.post("/api/analyze-pdf", json={"sample": name})
    assert res.status_code == 200, res.text
    return res.json()


@pytest.mark.parametrize(("name", "score", "tier"), [("madrid", 84, "alto"), ("miteco", 25, "bajo")])
def test_samples_match_ts(name: str, score: int, tier: str) -> None:
    got = _sample(name)
    ts = json.loads((GOLDEN / f"analyze_pdf_{name}.json").read_text())
    assert got["fit"]["score"] == score
    assert got["fit"]["tier"] == tier
    assert set(got) == set(ts)
    for key in set(ts) - EXTRACTION_DIFFS[name]:
        assert got[key] == ts[key], key


def test_upload_pdf_and_415_on_non_pdf() -> None:
    pdf = (route.SAMPLES_DIR / "comunidad-madrid-orden-1689-2026.pdf").read_bytes()
    res = client.post("/api/analyze-pdf", files={"file": ("orden.pdf", pdf, "application/pdf")})
    assert res.status_code == 200
    assert res.json()["fileName"] == "orden.pdf"
    assert res.json()["fit"]["score"] == 84

    res = client.post("/api/analyze-pdf", files={"file": ("bases.docx", b"PK\x03\x04 not a pdf", "application/pdf")})
    assert res.status_code == 415
    assert res.json() == {"error": route.NOT_PDF_ERROR}


def test_bad_requests() -> None:
    assert client.post("/api/analyze-pdf", json={}).status_code == 400
    assert client.post("/api/analyze-pdf", json={"sample": "nope"}).json() == {
        "error": "Parámetros inválidos para analizar PDF."
    }
    res = client.post("/api/analyze-pdf", data={"other": "x"}, files={"x": ("a.txt", b"x")})
    assert res.status_code == 400
    assert res.json() == {"error": "No se recibió ningún archivo PDF."}
    res = client.post("/api/analyze-pdf", content=b"not json", headers={"content-type": "application/json"})
    assert res.status_code == 500
    assert res.json() == {"error": route.PROCESSING_ERROR}


def test_upload_size_cap() -> None:
    big = b"%PDF-1.4\n" + b"0" * MAX_PDF_BYTES
    res = client.post("/api/analyze-pdf", files={"file": ("big.pdf", big, "application/pdf")})
    assert res.status_code == 413
    assert res.json() == {"error": "El PDF supera 15 MB; ábrelo en la web oficial."}


# --- remote download: size cap, SSRF ---------------------------------------------------------------------------


@pytest.fixture
def public_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every hostname resolves to a public address (no real DNS in tests)."""

    async def fake_getaddrinfo(host: str, port: int) -> list:
        ip = {"internal.example": "10.0.0.5"}.get(host, "93.184.216.34")
        return [(0, 0, 0, "", (ip, port))]

    monkeypatch.setattr(download, "_getaddrinfo", fake_getaddrinfo)


def _transport(handler) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


async def test_download_streams_with_cap(public_dns: None) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/small.pdf":
            return httpx.Response(200, content=b"%PDF-1.7 tiny")
        if request.url.path == "/declared.pdf":
            return httpx.Response(200, headers={"content-length": str(MAX_PDF_BYTES + 1)}, content=b"%PDF")

        # no content-length: the cap must trip while streaming
        async def body():  # 16 MB in 1 MB chunks
            for _ in range(16):
                yield b"0" * (1024 * 1024)

        return httpx.Response(200, content=body())

    t = _transport(handler)
    assert await download_pdf("https://www.boe.es/small.pdf", transport=t) == b"%PDF-1.7 tiny"
    # requested against the resolved IP, hostname kept in Host and TLS SNI
    assert seen[0].url.host == "93.184.216.34"
    assert seen[0].headers["host"] == "www.boe.es"
    assert seen[0].extensions["sni_hostname"] == "www.boe.es"
    assert await download_pdf("https://www.boe.es/declared.pdf", transport=t) == "too-large"
    assert await download_pdf("https://www.boe.es/stream.pdf", transport=t) == "too-large"


@pytest.mark.parametrize(
    "host",
    [
        "127.0.0.1",
        "10.1.2.3",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "224.0.0.1",
        "::1",
        "fe80::1",
        "fc00::1",
        "::ffff:127.0.0.1",
    ],
)
async def test_non_public_addresses_blocked(host: str) -> None:
    with pytest.raises(BlockedUrl):
        await resolve_public(host, 443)


async def test_hostname_resolving_to_private_blocked(public_dns: None) -> None:
    with pytest.raises(BlockedUrl):
        await resolve_public("internal.example", 443)
    assert await resolve_public("www.boe.es", 443) == "93.184.216.34"


@pytest.mark.parametrize(
    "url", ["ftp://www.boe.es/a.pdf", "file:///etc/passwd", "https://www.boe.es:8443/a.pdf", "http://127.0.0.1/a.pdf"]
)
async def test_bad_urls_blocked(url: str) -> None:
    with pytest.raises(BlockedUrl):
        await download_pdf(url, transport=_transport(lambda r: httpx.Response(200, content=b"%PDF")))


async def test_redirect_to_internal_blocked(public_dns: None) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://internal.example/latest/meta-data"})

    with pytest.raises(BlockedUrl):
        await download_pdf("https://www.boe.es/a.pdf", transport=_transport(handler))


def test_pdf_url_host_allow_list() -> None:
    for url in ["https://evil.example/a.pdf", "http://169.254.169.254/x", "javascript:alert(1)", "not a url"]:
        res = client.post("/api/analyze-pdf", json={"pdfUrl": url})
        assert res.status_code == 400, url
        assert res.json() == {"error": "Host de PDF no permitido."}


def test_remote_redirect_to_internal_is_400_and_cached_hits(monkeypatch: pytest.MonkeyPatch) -> None:
    async def blocked(url: str) -> bytes:
        raise BlockedUrl("redirect to 10.0.0.5")

    monkeypatch.setattr(route, "download_pdf", blocked)
    res = client.post("/api/analyze-pdf", json={"pdfUrl": "https://www.boe.es/a.pdf"})
    assert res.status_code == 400

    pdf = (route.SAMPLES_DIR / "miteco-convocatoria-923290.pdf").read_bytes()
    calls: list[str] = []

    async def ok(url: str) -> bytes:
        calls.append(url)
        return pdf

    monkeypatch.setattr(route, "download_pdf", ok)
    route._cache.clear()
    for _ in range(2):
        res = client.post("/api/analyze-pdf", json={"docId": 1519060})
        assert res.status_code == 200
        assert res.json()["fileName"] == "BDNS-doc-1519060.pdf"
    assert calls == [
        "https://www.infosubvenciones.es/bdnstrans/api/convocatorias/documentos?vpd=GE&idDocumento=1519060"
    ]


# --- /api/perfil -------------------------------------------------------------------------------------------------


def test_perfil_identical_to_ts() -> None:
    res = client.get("/api/perfil")
    assert res.status_code == 200
    assert res.json() == json.loads((GOLDEN / "perfil.json").read_text())
    assert res.content == (GOLDEN / "perfil.json").read_bytes()  # byte-identical, key order included
