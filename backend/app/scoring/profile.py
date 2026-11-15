"""Reforesta's profile tables (port of src/lib/reforesta-profile.ts). Keep in sync value by value."""

from typing import NamedTuple

from app.models import WorkLine

WORK_LINE_LABELS: dict[WorkLine, str] = {
    "restauracion": "Restauración de ecosistemas",
    "conservacion": "Conservación de hábitats",
    "educacion": "Educación ambiental",
    "agroambiental": "Agroambiental y custodia",
}


class ManualSource(NamedTuple):
    label: str
    patterns: tuple[str, ...]


# Matched against the ORGANISM (and region for CAM) only, never the full text.
MANUAL_SOURCES: tuple[ManualSource, ...] = (
    ManualSource("Fundación Biodiversidad", ("fundacion biodiversidad",)),
    ManualSource(
        "MITECO",
        ("transicion ecologica", "miteco", "reto demografico", "parques nacionales", "confederacion hidrografica"),
    ),
    ManualSource("Comunidad de Madrid (ambiental)", ("comunidad de madrid",)),
    ManualSource("Agenda 2030", ("agenda 2030",)),
)


class Keyword(NamedTuple):
    term: str
    weight: int
    label: str


class KeywordGroup(NamedTuple):
    line: WorkLine
    keywords: tuple[Keyword, ...]


# Terms are accent-free and lowercase, matched at word starts ("reforest" matches "reforestación").
KEYWORD_RULES: tuple[KeywordGroup, ...] = (
    KeywordGroup(
        "restauracion",
        (
            Keyword("reforest", 22, "Reforestación"),
            Keyword("repoblacion forestal", 20, "Repoblación forestal"),
            Keyword("restauracion ecologica", 20, "Restauración ecológica"),
            Keyword("restauracion de ecosistemas", 20, "Restauración ecológica"),
            Keyword("restauracion ambiental", 18, "Restauración ecológica"),
            Keyword("restauracion de habitats", 18, "Restauración ecológica"),
            Keyword("restauracion forestal", 18, "Restauración ecológica"),
            Keyword("restauracion hidrologic", 14, "Restauración ecológica"),
            Keyword("renaturaliz", 16, "Renaturalización"),
            Keyword("plantacion", 12, "Plantación de especies"),
            Keyword("forestal", 12, "Ámbito forestal"),
            Keyword("forestals", 12, "Ámbito forestal"),
            Keyword("forestais", 12, "Ámbito forestal"),
            Keyword("silvicol", 10, "Ámbito forestal"),
            Keyword("incendios forestales", 10, "Recuperación post-incendio"),
            Keyword("bosque", 12, "Masas forestales"),
            Keyword("bosc", 10, "Masas forestales"),
            Keyword("baso", 8, "Masas forestales"),
            Keyword("ribera", 12, "Restauración de riberas"),
            Keyword("charca", 18, "Charcas y humedales"),
            Keyword("humedal", 15, "Humedales"),
            Keyword("zones humides", 15, "Humedales"),
            Keyword("arbolado", 12, "Arbolado"),
            Keyword("sumidero", 10, "Sumideros de carbono"),
            Keyword("infraestructura verde", 12, "Infraestructura verde"),
            Keyword("soluciones basadas en la naturaleza", 14, "Soluciones basadas en la naturaleza"),
        ),
    ),
    KeywordGroup(
        "conservacion",
        (
            Keyword("biodivers", 18, "Biodiversidad"),
            Keyword("habitat", 14, "Mejora de hábitats"),
            Keyword("conservacion de la naturaleza", 16, "Conservación"),
            Keyword("conservacion del medio", 14, "Conservación"),
            Keyword("patrimonio natural", 16, "Patrimonio natural"),
            Keyword("espacios naturales", 14, "Espacios naturales"),
            Keyword("espacios protegidos", 14, "Espacios naturales"),
            Keyword("parques nacionales", 12, "Parques nacionales"),
            Keyword("red natura", 16, "Red Natura 2000"),
            Keyword("natura 2000", 16, "Red Natura 2000"),
            Keyword("reserva de la biosfera", 12, "Reserva de la Biosfera"),
            Keyword("anfibio", 18, "Anfibios"),
            Keyword("triton", 18, "Tritones / fauna"),
            Keyword("especies invasoras", 18, "Control de invasoras"),
            Keyword("exoticas invasoras", 18, "Control de invasoras"),
            Keyword("ailanto", 20, "Control de ailanto"),
            Keyword("aves", 10, "Hábitat de aves"),
            Keyword("avifauna", 12, "Hábitat de aves"),
            Keyword("fauna silvestre", 12, "Fauna silvestre"),
            Keyword("flora", 8, "Flora"),
            Keyword("ecosistema", 12, "Ecosistemas"),
            Keyword("medio ambiente", 10, "Medio ambiente"),
            Keyword("medioambient", 10, "Medio ambiente"),
            Keyword("ambiental", 8, "Medio ambiente"),
            Keyword("ambientales", 8, "Medio ambiente"),
            Keyword("ambientals", 8, "Medio ambiente"),
            Keyword("medi ambient", 10, "Medio ambiente"),
            Keyword("medio natural", 10, "Medio natural"),
            Keyword("medi natural", 10, "Medio natural"),
            Keyword("ingurumen", 10, "Medio ambiente"),
            Keyword("natura", 4, "Medio natural"),
            Keyword("paisaje", 6, "Paisaje"),
            Keyword("cambio climatico", 8, "Adaptación al cambio climático"),
            Keyword("canvi climatic", 8, "Adaptación al cambio climático"),
            Keyword("polinizador", 12, "Polinizadores"),
        ),
    ),
    KeywordGroup(
        "educacion",
        (
            Keyword("educacion ambiental", 20, "Educación ambiental"),
            Keyword("educacio ambiental", 20, "Educación ambiental"),
            Keyword("educacion para la sostenibilidad", 16, "Educación ambiental"),
            Keyword("sensibilizacion ambiental", 14, "Sensibilización"),
            Keyword("sensibilizacion", 8, "Sensibilización"),
            Keyword("voluntariado ambiental", 18, "Voluntariado ambiental"),
            Keyword("voluntariado", 6, "Voluntariado"),
            Keyword("divulgacion ambiental", 10, "Divulgación"),
        ),
    ),
    KeywordGroup(
        "agroambiental",
        (
            Keyword("custodia del territorio", 22, "Custodia del territorio"),
            Keyword("custodia de territori", 22, "Custodia del territorio"),
            Keyword("agroambiental", 16, "Agroambiental"),
            Keyword("agroforest", 14, "Agroforestal"),
            Keyword("desarrollo rural", 6, "Desarrollo rural"),
            Keyword("montes vecinales", 8, "Montes vecinales"),
        ),
    ),
)

ONG_POSITIVE_TERMS: tuple[str, ...] = (
    "sin animo de lucro",
    "sin fines de lucro",
    "sense anim de lucre",
    "sen animo de lucro",
    "sen fins de lucro",
    "ong",
    "ongs",
    "organizaciones no gubernamentales",
    "entidades no lucrativas",
    "entidades sin animo",
    "asociaciones",
    "fundaciones",
    "tercer sector",
    "personas juridicas que no desarrollan actividad economica",
    "entidades de custodia",
    "interes general",
    "interes social",
    "irpf",
    "entitats",
)


class Dealbreaker(NamedTuple):
    term: str
    warning: str
    penalty: int


_NOMINATIVA = "Subvención nominativa (asignada a un beneficiario concreto)."
_DIRECTA = "Concesión directa (no es concurrencia competitiva abierta)."
_APORTACION = "Aportación a una entidad concreta: no es una convocatoria abierta."
_TRANSFERENCIA = "Transferencia a una entidad concreta: no es una convocatoria abierta."
_CONVENIO = "Convenio con una entidad concreta: no es una convocatoria abierta."
_CINEGETICA = "Relacionada con actividad cinegética."
_PESQUERO = "Orientada al sector pesquero."
_EIA = "Trámite de evaluación ambiental, no una ayuda."
_SELECTIVO = "Proceso selectivo de empleo público."
_TFG = "Premio a trabajos académicos (TFG/TFM), no financia proyectos de una ONG."
_BECAS = "Becas de formación para personas físicas."
_AMPAS = "Dirigida a AMPAS/centros educativos."
_GENERICA = "Convocatoria genérica municipal (deporte/cultura) con línea ambiental menor."
_RELIGIOSO = "Restauración de patrimonio religioso, no ambiental."

DEALBREAKER_TERMS: tuple[Dealbreaker, ...] = (
    Dealbreaker("nominativa", _NOMINATIVA, 45),
    Dealbreaker("subv. nom", _NOMINATIVA, 45),
    Dealbreaker("subv.nom", _NOMINATIVA, 45),
    Dealbreaker("concesion directa", _DIRECTA, 40),
    Dealbreaker("subvencion directa", _DIRECTA, 40),
    Dealbreaker("aportacion al", _APORTACION, 40),
    Dealbreaker("aportacion a la", _APORTACION, 40),
    Dealbreaker("transferencia al", _TRANSFERENCIA, 40),
    Dealbreaker("transferencia a la", _TRANSFERENCIA, 40),
    Dealbreaker("contribucion voluntaria", "Contribución a un organismo concreto: no es una convocatoria abierta.", 40),
    Dealbreaker(
        "convocatoria instrumental",
        "Convocatoria instrumental de cooperación internacional: proyecto en otro país con socio predefinido.",
        25,
    ),
    Dealbreaker("anulada", "Convocatoria anulada.", 60),
    Dealbreaker("concessio directa", _DIRECTA, 40),
    Dealbreaker("convenio", _CONVENIO, 35),
    Dealbreaker("conveni", _CONVENIO, 35),
    Dealbreaker("formalizacion", "Formalización de contrato ya adjudicado.", 60),
    Dealbreaker("adjudicacion", "Adjudicación ya resuelta.", 40),
    Dealbreaker("protectora de animales", "Orientada a protectoras de animales domésticos, no a restauración.", 35),
    Dealbreaker("animales de compania", "Orientada a animales de compañía, no a restauración.", 35),
    Dealbreaker("colonias felinas", "Orientada a colonias felinas, no a restauración.", 35),
    Dealbreaker("caza", _CINEGETICA, 20),
    Dealbreaker("cinegetic", _CINEGETICA, 20),
    Dealbreaker("pesca", _PESQUERO, 20),
    Dealbreaker("pesquer", _PESQUERO, 20),
    Dealbreaker("acuicultura", "Orientada a acuicultura.", 20),
    Dealbreaker("procesional", "Patrimonio cultural/religioso, no restauración ecológica.", 55),
    Dealbreaker("patrimonio historico", "Patrimonio histórico/artístico, ajeno a restauración ecológica.", 45),
    Dealbreaker("patrimonio cultural", "Patrimonio cultural, ajeno a restauración ecológica.", 40),
    Dealbreaker("bienes culturales", "Bienes culturales/artísticos, ajeno a restauración ecológica.", 45),
    Dealbreaker("bien de interes cultural", "Bien de interés cultural, ajeno a restauración ecológica.", 45),
    Dealbreaker("retablo", "Restauración artística, no ambiental.", 55),
    Dealbreaker("iglesia", _RELIGIOSO, 40),
    Dealbreaker("ermita", _RELIGIOSO, 40),
    Dealbreaker("cofradia", "Entidad religiosa/cultural, ajena al ámbito ambiental.", 50),
    Dealbreaker("evaluacion de impacto ambiental", _EIA, 50),
    Dealbreaker("informe de impacto ambiental", _EIA, 50),
    Dealbreaker("declaracion de impacto ambiental", _EIA, 50),
    Dealbreaker("autorizacion ambiental", "Trámite de autorización ambiental, no una ayuda.", 50),
    Dealbreaker("informacion publica", "Trámite de información pública, no una ayuda.", 40),
    Dealbreaker("deslinde", "Trámite de deslinde, no una ayuda.", 45),
    Dealbreaker("oposiciones", _SELECTIVO, 50),
    Dealbreaker("proceso selectivo", _SELECTIVO, 50),
    Dealbreaker("trabajos fin de", _TFG, 40),
    Dealbreaker("fin de grado", _TFG, 40),
    Dealbreaker("fin de estudios", _TFG, 40),
    Dealbreaker("tesis doctoral", "Premio a trabajos académicos, no financia proyectos de una ONG.", 40),
    Dealbreaker("beca de", _BECAS, 30),
    Dealbreaker("becas", _BECAS, 30),
    Dealbreaker("vehiculo", "Ayuda a vehículos/movilidad, fuera del ámbito de Reforesta.", 30),
    Dealbreaker("eficiencia energetica", "Eficiencia energética, fuera de las líneas de Reforesta.", 20),
    Dealbreaker("autoconsumo", "Energía/autoconsumo, fuera de las líneas de Reforesta.", 25),
    Dealbreaker("residuos", "Gestión de residuos, fuera de las líneas principales de Reforesta.", 10),
    Dealbreaker("ampas", _AMPAS, 20),
    Dealbreaker("afas", _AMPAS, 20),
    Dealbreaker("asociaciones de madres y padres", _AMPAS, 20),
    Dealbreaker(
        "centros de educacion ambiental",
        "Programa para grupos escolares (alumnado y profesorado de centros educativos), no para ONG.",
        30,
    ),
    Dealbreaker("centros educativos", "Dirigida a centros educativos.", 15),
    Dealbreaker("formacion profesional", "Formación profesional, fuera de las líneas de Reforesta.", 20),
    Dealbreaker("clubes", _GENERICA, 12),
    Dealbreaker("deportivas", _GENERICA, 12),
    Dealbreaker("regadio", "Orientada a regadíos/explotaciones agrarias.", 15),
    Dealbreaker("ganader", "Orientada a explotaciones ganaderas.", 15),
    Dealbreaker("explotaciones agrarias", "Orientada a explotaciones agrarias.", 15),
)


class GeoRegion(NamedTuple):
    delta: int
    reason: str
    cap: int = 100


class GeoFit:
    """Where Reforesta (based in Madrid) can realistically apply; applied at read time by geographic_fit()."""

    regions: dict[str, GeoRegion] = {
        "Comunidad de Madrid": GeoRegion(12, "Comunidad de Madrid: vuestro territorio de trabajo."),
        "Estatal": GeoRegion(10, "Ámbito estatal: podéis presentaros desde Madrid."),
        # Horizon research topics are capped separately (KindFit.horizon_cap), so this mainly lifts LIFE
        "Unión Europea": GeoRegion(4, "Ámbito europeo: abierta a entidades españolas."),
        # neighbours: plausible but usually require acting there, so capped below the core territory's best calls
        "Castilla y León": GeoRegion(
            3, "Castilla y León: comparte el Sistema Central con Madrid; actuar allí es plausible.", 70
        ),
        "Castilla-La Mancha": GeoRegion(
            3, "Castilla-La Mancha: región vecina donde una ONG madrileña puede actuar.", 70
        ),
    }
    # Ayuntamientos inside Comunidad de Madrid (Reforesta works with them).
    madrid_municipal = GeoRegion(
        4, "Ayuntamiento de la Comunidad de Madrid: trabajáis con ayuntamientos de vuestro territorio."
    )
    # Regional government, diputación or university of another autonomous community.
    other_region = -12
    # Ayuntamiento outside Comunidad de Madrid (or of an unidentified municipality).
    other_municipal = -22
    # Out-of-territory calls stay "medio" at most, below closed in-territory calls (next edition).
    out_of_territory_cap = 50
    # Closed calls in territory other than competitive grants for non-profits (those keep their fit).
    closed_cap = 52


class KindFit:
    """Actionability by kind of publication, applied after GeoFit (see kind_fit())."""

    bulletin_cap = 45  # bulletin entries that are not a call
    tender_penalty = 15  # tenders: service contracts, a secondary route for an NGO
    tender_cap = 57
    horizon_cap = 48  # Horizon Europe topics need an international research consortium
    min_title_topic = 12  # tenders/notices whose TITLE barely touches Reforesta's topics
    off_topic_cap = 30
    university_cap = 45  # calls issued by a university usually target its own students/staff
