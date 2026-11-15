"""Rebuild each connector's scoring input from an item of the TS API output (tests/golden/oportunidades.json).

The API returns the opportunity, not what the connector passed to scoreConvocatoria, so some inputs are
recovered or inferred here. Every inference is listed in GAPS and reported by the parity test.
"""

import gzip
import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from app.config import settings
from app.scoring.score import FitAdjust, ScoreInput
from app.sources.base import RawOpportunity
from app.sources.eu import EN_TOPIC
from app.sources.rsc import RSC_PROGRAMMES, to_raw

GOLDEN = Path(__file__).parent / "golden"
# Raw BDNS fields captured once from the TS memo + BDNS API (frozen) (descripcionLeng, objetivos, bases, abierto...).
_BDNS_PATH = GOLDEN / "bdns_inputs.json.gz"
BDNS_INPUTS: dict[str, dict[str, Any]] = (
    json.loads(gzip.decompress(_BDNS_PATH.read_bytes())) if _BDNS_PATH.exists() else {}
)

_EU_PATH = GOLDEN / "eu_inputs.json.gz"  # captured once from SEDIA (frozen): description[:2000] per call
EU_INPUTS: dict[str, dict[str, str]] = json.loads(gzip.decompress(_EU_PATH.read_bytes())) if _EU_PATH.exists() else {}

GAPS = {
    "bdns": "extraText = bases + objetivos + descripcionLeng; the API has only `summary` "
    '("Bases: …  Finalidad: ….", cut at 600 chars): bases are recovered from it, objetivos and descripcionLeng '
    "are missing. `abierto` is not in the API: inferred from deadlineState/warnings.",
    "bdns-captured": "raw BDNS fields captured once, frozen (exact input unless BDNS changed "
    "the call since the golden was taken).",
    "bdns-lite-captured": "descripcionLeng captured from the BDNS detail API (the TS read it from the search row).",
    "bdns-lite": "extraText = descripcionLeng (search row), not in the API: assumed empty.",
    "eu": "scoring titulo/extraText are Spanish topic terms derived from the English title + description[:2000]; "
    "the API keeps only description[:400] (`summary`).",
    "eu-captured": "description[:2000] captured once from SEDIA (frozen).",
    "fb": "extraText = the search-page excerpt (= summary) and `abierto` from the page status (= deadlineText).",
    "bocm": 'tipoConvocatoria for non-tenders depends on the notice body ("Concurrencia competitiva" or '
    '"Convocatoria (BOCM)"), not in the API (tipo says "Convocatoria / extracto").',
}


def scoring_day(item: dict[str, Any], fetched_at: str) -> date:
    """The TS scored with `new Date()` at fetch time: recover that day from deadline - daysRemaining."""
    fit = item["fit"]
    if item.get("deadline") and fit["daysRemaining"] is not None:
        return date.fromisoformat(item["deadline"]) - timedelta(days=fit["daysRemaining"])
    return datetime.fromisoformat(fetched_at).astimezone(settings.tz).date()


def _bdns_bases(summary: str | None) -> str:
    if not summary or not summary.startswith("Bases: "):
        return ""
    bases = summary[len("Bases: ") :]
    return bases.split(" Finalidad: ")[0]


def _warning(fit: dict[str, Any], prefix: str) -> str | None:
    return next((w for w in fit["warnings"] if w.startswith(prefix)), None)


def reconstruct(item: dict[str, Any]) -> tuple[RawOpportunity, str]:
    """(raw item with score_input/adjust, gap key) for one golden item."""
    src, fit = item["source"], item["fit"]
    common = {k: v for k, v in item.items() if k != "fit"}
    adjust: FitAdjust | None = None
    gap = src

    if src == "rsc":
        prog = next(p for p in RSC_PROGRAMMES if f"rsc:{p.id}" == item["id"])
        return to_raw(prog), "rsc"

    if src == "bdns":
        lite = _warning(fit, "Ficha BDNS no cargada")
        raw_bdns = BDNS_INPUTS.get(item["id"].removeprefix("bdns:"))
        if lite:
            gap = "bdns-lite" if raw_bdns is None else "bdns-lite-captured"
            leng = (raw_bdns or {}).get("descripcionLeng") or ""
            inp = ScoreInput(
                titulo=item["titulo"],
                organismo=item["organismo"],
                region=item["region"],
                extra_text=leng,
                kind="subvencion",
            )
            adjust = FitAdjust(delta=-5, append_warnings=[lite])
        else:
            conflict = _warning(fit, "BDNS la marca abierta")
            estimated = _warning(fit, "Fecha límite estimada a partir de «")
            no_end = item["deadline"] is None
            abierto = bool(conflict) or (no_end and fit["deadlineState"] == "abierta")
            extra = f"{_bdns_bases(item['summary'])}  "
            if raw_bdns is not None:
                gap = "bdns-captured"
                abierto = bool(raw_bdns["abierto"])
                objetivos = ". ".join(o["descripcion"] for o in raw_bdns.get("objetivos") or [])
                bases = raw_bdns.get("descripcionBasesReguladoras") or ""
                extra = f"{bases} {objetivos} {raw_bdns.get('descripcionLeng') or ''}"
            inp = ScoreInput(
                titulo=item["titulo"],
                organismo=item["organismo"],
                tipo_convocatoria=item["tipo"],
                beneficiarios=item["beneficiarios"],
                region=item["region"],
                presupuesto_total=item["budget"],
                fecha_inicio_solicitud=item["opensAt"],
                fecha_fin_solicitud=item["deadline"],
                abierto=abierto,
                extra_text=extra,
                kind="subvencion",
            )
            if conflict:
                adjust = FitAdjust(deadline_state="sin_fecha", delta=-12, cap=60, append_warnings=[conflict])
            elif estimated:
                adjust = FitAdjust(append_warnings=[estimated])
    elif src in ("boe", "bocm"):
        lic = item["kind"] == "licitacion"
        tipo = (
            "Licitación pública"
            if lic
            else ("Extracto de convocatoria (BOE)" if src == "boe" else "Convocatoria (BOCM)")
        )
        inp = ScoreInput(
            titulo=item["titulo"],
            organismo=item["organismo"],
            tipo_convocatoria=tipo,
            region="Comunidad de Madrid" if src == "bocm" else None,
            extra_text=item["summary"] or "",
            fecha_inicio_solicitud=item["publishedAt"],
            fecha_fin_solicitud=item["deadline"],
            kind=item["kind"],
        )
        est = _warning(fit, "Fecha límite estimada a partir del plazo en días")
        adjust = FitAdjust(append_warnings=[est]) if est else None
    elif src == "eu":
        title = item["titulo"].lower()
        captured = EU_INPUTS.get(item["id"].removeprefix("eu:"))
        gap = "eu" if captured is None else "eu-captured"
        description = captured["description"] if captured else item["summary"] or ""
        en_text = f"{item['titulo']} {description}".lower()
        es_terms = [es for r, es in EN_TOPIC if r.search(title)]
        es_desc = [es for r, es in EN_TOPIC if r.search(en_text)]
        inp = ScoreInput(
            titulo=" ".join(es_terms) or item["titulo"],
            organismo=item["organismo"].split(" (")[0],
            tipo_convocatoria="Concurrencia competitiva (UE)",
            fecha_inicio_solicitud=item["opensAt"],
            fecha_fin_solicitud=item["deadline"],
            extra_text=" ".join(es_desc),
            kind="europa",
        )
        warnings: list[str] = []
        prepend: list[str] = []
        delta, cap = 0, None
        if "Horizon Europe" in item["organismo"]:
            delta, cap = -12, 58
            warnings.append(
                "Horizon Europe: proyecto de investigación en consorcio internacional; Reforesta encajaría como "
                "socio de demostración, no como líder."
            )
        elif item["sourceLabel"] == "UE · LIFE":
            prepend.append("Programa LIFE: el instrumento europeo de referencia para naturaleza y biodiversidad.")
        if re.search(r"municipalit|local authorit|cities\b", title):
            warnings.append("Dirigida principalmente a municipios / autoridades locales.")
        adjust = FitAdjust(delta=delta, cap=cap, prepend_reasons=prepend, append_warnings=warnings)
    elif src == "fb":
        status = (item["deadlineText"] or "").removeprefix("Convocatoria ") or None
        inp = ScoreInput(
            titulo=item["titulo"],
            organismo=item["organismo"],
            tipo_convocatoria=item["tipo"],
            extra_text=item["summary"] or "",
            fecha_inicio_solicitud=item["opensAt"],
            fecha_fin_solicitud=item["deadline"],
            abierto=True if status == "abierta" else (False if status else None),
            kind="subvencion",
        )
        if not item["deadline"] and status and status not in ("abierta", "próxima", "proxima"):
            adjust = FitAdjust(deadline_state="cerrada", cap=50)
    # ted / bocyl / boja / montemadrid: removed from the product; still in the golden as scoring-parity cases.
    elif src == "ted":
        cpv = m.group(1) if (m := re.search(r"CPV: (.*)\.$", item["summary"] or "")) else ""
        inp = ScoreInput(
            titulo=item["titulo"],
            organismo=item["organismo"],
            tipo_convocatoria="Licitación pública",
            presupuesto_total=item["budget"],
            fecha_fin_solicitud=item["deadline"],
            abierto=True,
            extra_text=cpv,
        )
    elif src in ("bocyl", "boja"):
        inp = ScoreInput(
            titulo=item["titulo"], organismo=item["organismo"], tipo_convocatoria=item["tipo"], extra_text=item["tipo"]
        )
    elif src == "montemadrid":
        inp = ScoreInput(
            titulo=item["titulo"],
            organismo="Fundación Montemadrid",
            tipo_convocatoria="Convocatoria fundación privada",
            abierto=fit["deadlineState"] == "abierta",
        )
    else:
        raise ValueError(f"no reconstruction for source {src}")

    return RawOpportunity(**common, score_input=inp, adjust=adjust), gap
