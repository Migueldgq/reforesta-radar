"""Display names of organisms: one spelling per organism across sources, in Spanish title case.

BDNS (and a few bulletins) write organisms in capitals ("COMUNIDAD DE MADRID · DIPUTACIÓN PROV. DE CASTELLÓN"); the
web used to lower-case them into "Comunidad de madrid". `organism_name` turns each all-caps part into title case
(particles in lower case, acronyms kept, hyphens and slashes handled), restores the accents BDNS sometimes drops on a
few very common administrative words, and maps known aliases of the same organism to one name (`ALIASES`).
Mixed-case names (written by a person or a non-BDNS source) are left as they are, apart from the alias table.

Applied by the ingest to every item (app/ingest/__main__.py) and once to stored rows, board snapshots and the team's
saved organism filter (migration 0007). Scoring matches organisms on normalize_text(), so it is unaffected.
"""

import re

from app.scoring.text import normalize_text

# Lower case inside a name (never as its first word): Spanish, Catalan, Galician and Basque particles.
_PARTICLES = "de del la las los el y e en para por a al con sin sobre i o u les dels des da do das dos na no"
PARTICLES = frozenset(_PARTICLES.split())
# Kept in capitals: acronyms that appear in organism names.
_ACRONYMS = (
    "MITECO OAPN CSIC UE FEDER FEADER FSE LEADER BOE BOP BOCM DOG DOGV BOJA ONG ONGS IRPF AGADER FOGAIBA IAJ IDAE "
    "ICO CDTI SEPE INE INIA IGN CEDEX AEMET ADIF ENAIRE RENFE CHE CHG CHT CHS CHJ CHD CHC CHMS CHN CHU URJC UAM UCM "
    "UPM UNED UPV UPC UAB UB UV UA UMH UJI UIB ULL ULPGC EHU UPNA UVA USAL UNEX UCLM UMU UGR UMA US UPO UCO UJA "
    "UAL UCA UHU UNIOVI UNICAN UNIZAR UDC USC UVIGO URV UDL UDG UNIRIOJA RTVE SA SL SLU SAU SAM FB CENEAM SEO LIFE "
    "II III IV VI VII VIII IX XI XII"
)
ACRONYMS = frozenset(_ACRONYMS.split())
# Accents BDNS sometimes drops ("DIRECCION GENERAL ORDENACION AGROPECUARIA"): restored only on all-caps parts.
_ACCENTED = (
    "dirección direcciones ordenación consejería consejerías diputación diputaciones administración "
    "administraciones transición ecológica ecológico demográfico demográfica público pública públicos públicas "
    "agrícola agrícolas economía económica económico educación función gestión información innovación "
    "investigación promoción conservación población región unión acción organización atención participación "
    "cooperación comunicación alimentación ganadería energía energética tecnología política políticas políticos "
    "autonómica autonómico autónomo autónoma país área áreas ámbito turística turístico básica jurídica "
    "planificación formación protección explotación inspección prevención contratación evaluación "
    "sostenibilidad climático climática hidrográfica hidrológica geográfico científica científico técnica "
    "técnico académica académico jardín jardines aragonés catalán andalucía aragón león castellón ávila "
    "almería málaga cádiz córdoba jaén cáceres mérida"
)
ACCENTS = {
    w.replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u"): w
    for w in _ACCENTED.split()
}
# Known aliases of one organism across sources (normalised name -> display name). Keep it small: only organisms that
# really appear under two spellings. "Fundación Biodiversidad (MITECO)" is how the fb connector names it.
ALIASES: dict[str, str] = {
    "fundacion biodiversidad": "Fundación Biodiversidad (MITECO)",
    "fundacion biodiversidad · ministerio para la transicion ecologica y el reto demografico":
        "Fundación Biodiversidad (MITECO)",
    "fundacion biodiversidad (miteco)": "Fundación Biodiversidad (MITECO)",
}  # fmt: skip

_LETTERS = re.compile(r"[^\W\d_]")
_SUBWORD = re.compile(r"([-/(),]+)")
_SINGLE_PAREN = re.compile(r"\(([^\W\d_]{2,8})\)")  # "(AGADER)": one short word in brackets is an acronym
# Fixes the word rules cannot know: place names whose article is part of the name.
FIXES: tuple[tuple[re.Pattern[str], str], ...] = ((re.compile(r"\bde a Coruña\b"), "de A Coruña"),)


def _mostly_upper(s: str) -> bool:
    letters = _LETTERS.findall(s)
    return len(letters) >= 4 and sum(c.isupper() for c in letters) / len(letters) >= 0.7


def _word(w: str, first: bool, after: str, acronyms: set[str]) -> str:
    """One all-caps word in title case. `after` is the separator before it (" ", "-", "/", "(", ",")."""
    up = w.upper()
    if up.rstrip(".") in ACRONYMS or up in acronyms:
        return up
    low = ACCENTS.get(w.lower(), w.lower())
    # Catalan elision: d'Agricultura, l'Hospitalet
    if len(low) > 2 and low[1] in "'’" and low[0] in "dlns":
        return (low[0].upper() if first else low[0]) + low[1] + low[2:3].upper() + low[3:]
    if low in PARTICLES and not first and after == " ":
        return low
    return low[:1].upper() + low[1:]


def title_case(part: str) -> str:
    """Spanish title case of one all-caps part: "DIPUTACIÓN PROV. DE CASTELLÓN" -> "Diputación Prov. de Castellón".
    A whitespace-separated chunk with a digit is a code ("V5", "LIFE-2025-CET-EUCF") and stays as it is."""
    acronyms = {m.upper() for m in _SINGLE_PAREN.findall(part)}
    out: list[str] = []
    first = True
    for chunk in part.split(" "):
        if any(c.isdigit() for c in chunk):
            out.append(chunk)
            first = False
            continue
        pieces, after = [], "," if out and out[-1].endswith(",") else " "  # "Coruña, A"
        for tok in _SUBWORD.split(chunk):
            if not tok:
                continue
            if _SUBWORD.fullmatch(tok):
                pieces.append(tok)
                after = tok[-1]
                continue
            pieces.append(_word(tok, first, after, acronyms))
            first = False
        out.append("".join(pieces))
    cased = " ".join(out)
    for pattern, repl in FIXES:
        cased = pattern.sub(repl, cased)
    return cased


def organism_name(name: str) -> str:
    """Display name of an organism: alias table first, else each all-caps " · " part in title case."""
    flat = " ".join(name.split())
    if alias := ALIASES.get(normalize_text(flat)):
        return alias
    parts = flat.split(" · ")
    return " · ".join(title_case(p) if _mostly_upper(p) else p for p in parts)
