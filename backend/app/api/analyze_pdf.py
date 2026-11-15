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
from sqlalchemy import text
from starlette.datastructures import UploadFile

from app.api.state import iso, read_histories
from app.models import Opportunity
from app.pdf.analyzer import PdfAnalysisResult, analyze_text, bdns_number, read_pdf
from app.pdf.download import MAX_PDF_BYTES, BlockedUrl, LruCache, download_pdf
from app.scoring.rank import adjusted_fit

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

# Extracted text by URL (not the result: the radar's score of the call changes with each ingest)
_cache: LruCache[tuple[int, str]] = LruCache()


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


CALL_BY_DOC_SQL = text(
    "select data, first_seen_at from opportunities where data->'documents' @> cast(:doc as jsonb) "
    "order by gone_at is not null, last_seen_at desc limit 1"
)
CALL_BY_ID_SQL = text("select data, first_seen_at from opportunities where id = :id")


async def radar_call(request: Request, doc_id: int | None, bdns: str | None) -> Opportunity | None:
    """The stored call a PDF belongs to (by its BDNS document id, else by the BDNS number printed in it), with the
    fit the list shows for it (geographic, kind and history steps included). None when unknown or on any error:
    the PDF is then scored on its own text."""
    engine = getattr(request.app.state, "engine", None)
    if engine is None or (doc_id is None and bdns is None):
        return None
    try:
        async with engine.connect() as conn:
            row = None
            if doc_id is not None:
                row = (await conn.execute(CALL_BY_DOC_SQL, {"doc": json.dumps([{"docId": doc_id}])})).first()
            if row is None and bdns is not None:
                row = (await conn.execute(CALL_BY_ID_SQL, {"id": f"bdns:{bdns}"})).first()
            if row is None:
                return None
            o = Opportunity.model_validate({**row.data, "firstSeenAt": iso(row.first_seen_at)})
            history = (await read_histories(conn, [o.id])).get(o.id)
    except Exception:  # noqa: BLE001 - the analysis still works without the radar's score
        log.exception("radar call lookup failed")
        return None
    o = o.model_copy(update={"history": history})
    return o.model_copy(update={"fit": adjusted_fit(o)})


async def _score(
    request: Request, read: tuple[int, str], file_name: str, doc_id: int | None = None
) -> PdfAnalysisResult:
    call = await radar_call(request, doc_id, bdns_number(read[1]))
    return await run_in_threadpool(analyze_text, *read, file_name, call)


async def _analyze(request: Request, data: bytes, file_name: str) -> PdfAnalysisResult:
    return await _score(request, await run_in_threadpool(read_pdf, data), file_name)


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
            result = await _analyze(request, data, file.filename or "")
            return JSONResponse(result.to_json())

        body = json.loads(await request.body())
        if not isinstance(body, dict):
            return _error("Parámetros inválidos para analizar PDF.", 400)

        sample = SAMPLE_FILES.get(body["sample"]) if isinstance(body.get("sample"), str) else None
        if sample:
            data = await run_in_threadpool((SAMPLES_DIR / sample[0]).read_bytes)
            result = await _analyze(request, data, sample[1])
            return JSONResponse(result.to_json())

        if body.get("docId"):
            doc_id = _js_string(body["docId"])
            url = "https://www.infosubvenciones.es/bdnstrans/api/convocatorias/documentos?vpd=GE&idDocumento=" + quote(
                doc_id, safe="!'()*"
            )
            name = body.get("fileName") or f"BDNS-doc-{doc_id}.pdf"
            doc_num = int(doc_id) if doc_id.isdigit() else None
            return await _analyze_remote(request, url, str(name), "No se pudo descargar el PDF desde la BDNS.", doc_num)

        if body.get("pdfUrl"):
            try:
                parsed = httpx.URL(str(body["pdfUrl"]))
            except (httpx.InvalidURL, ValueError):
                return _error(HOST_ERROR, 400)
            if parsed.scheme not in ("http", "https") or parsed.host not in ALLOWED_HOSTS:
                return _error(HOST_ERROR, 400)
            path = parsed.raw_path.split(b"?", 1)[0].decode("ascii", errors="replace")
            name = body.get("fileName") or path.split("/")[-1] or "documento.pdf"
            return await _analyze_remote(request, str(parsed), str(name), "No se pudo descargar el PDF oficial.")

        return _error("Parámetros inválidos para analizar PDF.", 400)
    except Exception:
        log.exception("PDF analysis error")
        return _error(PROCESSING_ERROR, 500)


async def _analyze_remote(
    request: Request, url: str, file_name: str, fail_msg: str, doc_id: int | None = None
) -> JSONResponse:
    """Download (15 s total, size cap, SSRF checks) + analyze; the text is cached by URL so re-opening is instant."""
    hit = _cache.get(url)
    if hit is not None:
        return JSONResponse((await _score(request, hit, file_name, doc_id)).to_json())
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
    read = await run_in_threadpool(read_pdf, data)
    _cache.set(url, read)
    return JSONResponse((await _score(request, read, file_name, doc_id)).to_json())
