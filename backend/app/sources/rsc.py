"""RSC: hand-curated private / CSR programmes (ports of src/lib/rsc-opportunities.ts and rscItems() in
src/lib/aggregate.ts). No network: the list lives here and is edited by hand.
"""

from typing import Literal, NamedTuple

from app.models import RscInfo, SourceHealth, WorkLine
from app.sources.base import FetchResult, RawOpportunity, RscScoreInput, Source, SourceContext


class RscProgramme(NamedTuple):
    id: str
    entity: str
    program: str
    type: Literal["Fundación privada", "Programa RSC", "Convocatoria mixta"]
    focus: list[WorkLine]
    typical_amount: str
    cadence: str
    why_reforesta: str
    pitch_angle: str
    url: str


RSC_PROGRAMMES: tuple[RscProgramme, ...] = (
    RscProgramme(
        id="rsc-iberdrola",
        entity="Fundación Iberdrola España",
        program="Programa Social & Biodiversidad (Convocatoria anual de ayudas)",
        type="Fundación privada",
        focus=["restauracion", "conservacion", "educacion"],
        typical_amount="20.000 € – 40.000 € por proyecto",
        cadence="Convocatoria anual (primer trimestre)",
        why_reforesta="Financian proyectos de conservación de biodiversidad, restauración de hábitats y educación "
        "ambiental ejecutados por entidades sin ánimo de lucro.",
        pitch_angle="Proponer restauración de riberas o mejora de hábitat de aves/anfibios con métricas claras de "
        "hectáreas recuperadas y voluntariado corporativo.",
        url="https://www.fundacioniberdrolaespana.org/",
    ),
    RscProgramme(
        id="rsc-montemadrid",
        entity="Fundación Montemadrid & CaixaBank",
        program="Convocatoria de Medioambiente y Desarrollo Sostenible",
        type="Fundación privada",
        focus=["conservacion", "educacion", "restauracion"],
        typical_amount="10.000 € – 35.000 €",
        cadence="Anual (Comunidad de Madrid y alrededores)",
        why_reforesta="Encaje geográfico directo con el histórico de Reforesta en Madrid y Sierra de Guadarrama; "
        "prioridad a ONG locales con trayectoria.",
        pitch_angle="Control de especies invasoras (ailanto) y creación de charcas para tritones/anfibios con "
        "participación ciudadana.",
        url="https://www.fundacionmontemadrid.es/",
    ),
    RscProgramme(
        id="rsc-endesa",
        entity="Endesa / Fundación Endesa",
        program="Premios y alianzas de Biodiversidad y Ecosistemas",
        type="Programa RSC",
        focus=["conservacion", "restauracion"],
        typical_amount="15.000 € – 60.000 € (patrocinio o convenio)",
        cadence="Continuo / Anual",
        why_reforesta="Reforesta ya tiene experiencia en mejora de hábitat de aves con empresas de energía: caso de "
        "éxito replicable.",
        pitch_angle="Ofrecer paquete llave en mano: mejora de hábitat avifauna + plantación autóctona bajo "
        "líneas/entornos rurales con reporte de impacto.",
        url="https://www.fundacionendesa.org/",
    ),
    RscProgramme(
        id="rsc-repsol",
        entity="Fundación Repsol (Motor Verde)",
        program="Reforestación y sumideros de carbono en España",
        type="Programa RSC",
        focus=["restauracion", "agroambiental"],
        typical_amount="Convenio por hectárea plantada",
        cadence="Ventanilla abierta para propietarios y entidades ejecutoras",
        why_reforesta="Buscan socios técnicos sobre el terreno con acuerdos de custodia del territorio y capacidad de "
        "plantación en zonas quemadas.",
        pitch_angle="Presentar cartera de terrenos municipales/privados con acuerdos de custodia listos para "
        "reforestar.",
        url="https://www.fundacionrepsol.com/",
    ),
    RscProgramme(
        id="rsc-lacaixa",
        entity="Fundación ”la Caixa”",
        program="Convocatorias Territoriales (Medioambiente e inclusión)",
        type="Fundación privada",
        focus=["educacion", "restauracion"],
        typical_amount="15.000 € – 50.000 €",
        cadence="Anual por comunidad autónoma",
        why_reforesta="Valoran proyectos ambientales que incorporen empleo verde, voluntariado o educación ambiental "
        "con colectivos vulnerables.",
        pitch_angle="Combinar educación ambiental + brigadas o talleres de plantación inclusivos en parques "
        "regionales.",
        url="https://fundacionlacaixa.org/",
    ),
    RscProgramme(
        id="rsc-santander",
        entity="Banco Santander (Santander España)",
        program="Convocatoria Santander Sostenible / Proyectos medioambientales",
        type="Programa RSC",
        focus=["restauracion", "educacion", "agroambiental"],
        typical_amount="10.000 € – 30.000 €",
        cadence="Anual",
        why_reforesta="Canal directo para ONGs españolas con proyectos medibles en reforestación y programas "
        "agroambientales.",
        pitch_angle="Programa agroambiental con agricultores + apadrinamiento de árboles con seguimiento anual.",
        url="https://www.bancosantander.es/",
    ),
)

RSC_HEALTH = SourceHealth(
    id="rsc",
    name="RSC · Fundaciones y empresas",
    category="RSC Privado",
    status="ok",
    count=0,
    url="",
    note="Lista curada a mano de programas privados que financian proyectos ambientales de ONG en España "
    "(sin plazo fijo).",
)


def to_raw(r: RscProgramme) -> RawOpportunity:
    return RawOpportunity(
        id=f"rsc:{r.id}",
        source="rsc",
        source_label="RSC · Privado",
        kind="empresa",
        titulo=f"{r.entity} — {r.program}",
        organismo=r.entity,
        region="Estatal",
        nivel_admin="Privada",
        deadline_text=r.cadence,
        amount_text=r.typical_amount,
        tipo=r.type,
        beneficiarios=["Entidades sin ánimo de lucro"],
        url=r.url,
        summary=r.why_reforesta,
        rsc=RscInfo(why_reforesta=r.why_reforesta, pitch_angle=r.pitch_angle, cadence=r.cadence),
        score_input=RscScoreInput(titulo=r.program, focus=r.focus, why_reforesta=r.why_reforesta),
    )


class RscSource(Source):
    id = "rsc"
    name = RSC_HEALTH.name

    async def fetch(self, ctx: SourceContext) -> FetchResult:
        return FetchResult(items=[to_raw(r) for r in RSC_PROGRAMMES], health=RSC_HEALTH.model_copy())
