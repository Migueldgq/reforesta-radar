"""POST /api/analyze-pdf (port of src/app/api/analyze-pdf/route.ts). Same request shapes, JSON and Spanish errors.

JSON body: {"sample": "madrid"|"miteco"} | {"docId": n, "fileName"?} | {"pdfUrl": url, "fileName"?};
or multipart/form-data with a `file` field. Errors are {"error": "..."} like the TS route.
"""

import json
import logging
import os
from pathlib import Path
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile

from app.pdf.analyzer import PdfAnalysisResult, analyze_pdf_bytes
from app.pdf.download import MAX_PDF_BYTES, BlockedUrl, LruCache, download_pdf

log = logging.getLogger(__name__)
router = APIRouter()

# Repo `data/samples` (backend/../data/samples locally; mounted at /data/samples in the compose API container).
SAMPLES_DIR = Path(os.getenv("RADAR_SAMPLES_DIR") or Path(__file__).resolve().parents[3] / "data" / "samples")

SAMPLE_FILES: dict[str, tuple[str, str]] = {
    "madrid": ("comunidad-madrid-orden-1689-2026.pdf", "Comunidad de Madrid · Orden 1689/2026.pdf"),
    "miteco": ("miteco-convocatoria-923290.pdf", "MITECO · BDNS 923290.pdf"),
}

ALLOWED_HOSTS = frozenset(
    {
        "www.boe.es",
        "boe.es",
        "www.infosubvenciones.es",
        "www.bocm.es",
        "bocm.es",
        "www.xunta.gal",
        "xunta.gal",
        "fundacion-biodiversidad.es",
        "www.fundacion-biodiversidad.es",
        "ec.europa.eu",
        "api.tech.ec.europa.eu",
        "contrataciondelestado.es",
        "www.contrataciondelestado.es",
    }
)

NOT_PDF_ERROR = (
    "El documento oficial no es un PDF con texto (puede ser un Word, una imagen o un enlace). "
    "Ábrelo desde la web oficial."
)
TOO_LARGE_ERROR = f"El PDF supera {MAX_PDF_BYTES // 1024 // 1024} MB; ábrelo en la web oficial."
PROCESSING_ERROR = "Error procesando el PDF. Comprueba que sea un PDF válido con texto."
HOST_ERROR = "Host de PDF no permitido."

_cache: LruCache[PdfAnalysisResult] = LruCache()


def _error(message: str, status: int) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


def is_pdf(data: bytes) -> bool:
    # "%PDF" may be preceded by a few junk bytes
    return b"%PDF" in data[:1024]


def _js_string(v: object) -> str:
    """String(v) for the JSON values a client may send as docId."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


async def _analyze(data: bytes, file_name: str) -> PdfAnalysisResult:
    return await run_in_threadpool(analyze_pdf_bytes, data, file_name)


async def _read_upload(file: UploadFile) -> bytes | None:
    """The upload's bytes, or None past MAX_PDF_BYTES (read in chunks, never more than the cap + 1 chunk)."""
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(1024 * 1024):
        total += len(chunk)
        if total > MAX_PDF_BYTES:
            return None
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/api/analyze-pdf", response_model=PdfAnalysisResult)
async def analyze_pdf(request: Request) -> JSONResponse:
    try:
        if "multipart/form-data" in request.headers.get("content-type", ""):
            # Reject obviously oversized bodies before Starlette spools them (multipart overhead allowance: 64 KB).
            if int(request.headers.get("content-length") or 0) > MAX_PDF_BYTES + 64 * 1024:
                return _error(TOO_LARGE_ERROR, 413)
            form = await request.form()
            file = form.get("file")
            if not isinstance(file, UploadFile):
                return _error("No se recibió ningún archivo PDF.", 400)
            data = await _read_upload(file)
            if data is None:
                return _error(TOO_LARGE_ERROR, 413)
            if not is_pdf(data):
                return _error(NOT_PDF_ERROR, 415)
            result = await _analyze(data, file.filename or "")
            return JSONResponse(result.to_json())

        body = json.loads(await request.body())
        if not isinstance(body, dict):
            return _error("Parámetros inválidos para analizar PDF.", 400)

        sample = SAMPLE_FILES.get(body["sample"]) if isinstance(body.get("sample"), str) else None
        if sample:
            data = await run_in_threadpool((SAMPLES_DIR / sample[0]).read_bytes)
            result = await _analyze(data, sample[1])
            return JSONResponse(result.to_json())

        if body.get("docId"):
            doc_id = _js_string(body["docId"])
            url = "https://www.infosubvenciones.es/bdnstrans/api/convocatorias/documentos?vpd=GE&idDocumento=" + quote(
                doc_id, safe="!'()*"
            )
            name = body.get("fileName") or f"BDNS-doc-{doc_id}.pdf"
            return await _analyze_remote(url, str(name), "No se pudo descargar el PDF desde la BDNS.")

        if body.get("pdfUrl"):
            try:
                parsed = httpx.URL(str(body["pdfUrl"]))
            except (httpx.InvalidURL, ValueError):
                return _error(HOST_ERROR, 400)
            if parsed.scheme not in ("http", "https") or parsed.host not in ALLOWED_HOSTS:
                return _error(HOST_ERROR, 400)
            path = parsed.raw_path.split(b"?", 1)[0].decode("ascii", errors="replace")
            name = body.get("fileName") or path.split("/")[-1] or "documento.pdf"
            return await _analyze_remote(str(parsed), str(name), "No se pudo descargar el PDF oficial.")

        return _error("Parámetros inválidos para analizar PDF.", 400)
    except Exception:
        log.exception("PDF analysis error")
        return _error(PROCESSING_ERROR, 500)


async def _analyze_remote(url: str, file_name: str, fail_msg: str) -> JSONResponse:
    """Download (15 s total, size cap, SSRF checks) + analyze; results cached by URL so re-opening is instant."""
    key = f"{url}|{file_name}"
    hit = _cache.get(key)
    if hit is not None:
        return JSONResponse(hit.to_json())
    try:
        data = await download_pdf(url)
    except BlockedUrl as e:
        log.warning("blocked PDF URL %s: %s", url, e)
        return _error(HOST_ERROR, 400)
    if data == "too-large":
        return _error(TOO_LARGE_ERROR, 413)
    if not data:
        return _error(fail_msg, 502)
    if not is_pdf(data):
        return _error(NOT_PDF_ERROR, 415)
    result = await _analyze(data, file_name)
    _cache.set(key, result)
    return JSONResponse(result.to_json())
