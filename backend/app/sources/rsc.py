"""RSC: private programmes (foundations and companies) that fund environmental projects of Spanish non-profits.

No network: the list lives here and is edited by hand. Every fact was checked on the funder's own site or bases on
`VERIFIED_ON`; amounts and dates are copied as published. When an edition ends, update its window and dates (the
deadline state comes from them, like any call). This is the only copy of the list: the web app reads it from the API.
"""

from typing import Literal, NamedTuple

from app.models import RscInfo, SourceHealth, WorkLine
from app.sources.base import FetchResult, RawOpportunity, RscScoreInput, Source, SourceContext

VERIFIED_ON = "2026-11-15"


class Limit(NamedTuple):
    text: str  # shown as a warning and under "Qué lo limita"
    penalty: int  # points off the curated score


class RscProgramme(NamedTuple):
    id: str
    entity: str
    program: str
    kind: Literal["ayuda", "premio"]
    focus: list[WorkLine]
    url: str  # the programme's own page
    bases_url: str | None
    amount: str  # as published
    opens_at: str  # last window, YYYY-MM-DD
    deadline: str
    window: str  # last window, in words
    timing: str | None  # when the next edition may open
    about: str  # what it funds, from the source
    beneficiarios: list[str]
    requirements: list[str]
    territory: str | None
    why_reforesta: str
    limits: list[Limit]
    unverified: str | None = None


RSC_PROGRAMMES: tuple[RscProgramme, ...] = (
    RscProgramme(
        id="rsc-unicaja-medioambiente",
        entity="Fundación Unicaja",
        program="Convocatoria de proyectos de Medio Ambiente",
        kind="ayuda",
        focus=["conservacion", "restauracion", "educacion"],
        url="https://www.fundacionunicaja.com/convocatoria-medio-ambiente/",
        bases_url="https://www.fundacionunicaja.com/wp-content/uploads/2026/11/Bases-Convocatoria-Medio-Ambiente.pdf",
        amount="Entre 10.000 € y 100.000 € por proyecto",
        opens_at="2026-11-05",
        deadline="2026-12-04",
        window="Del 5 nov al 4 dic 2026, hasta las 14:00. Resuelve antes del 12 feb 2027.",
        timing=None,
        about="Financia proyectos que conserven y restauren la biodiversidad y el patrimonio natural de Andalucía y "
        "la provincia de Ciudad Real, y proyectos de educación y sensibilización ambiental.",
        beneficiarios=["Entidades públicas o privadas con domicilio en España"],
        requirements=[
            "Entidad legalmente constituida y con domicilio en España.",
            "El proyecto se hace en Andalucía o en la provincia de Ciudad Real.",
            "Una sola propuesta por entidad, de 12 meses como máximo.",
            "Incluir una actividad en la que pueda participar el voluntariado de Fundación Unicaja.",
        ],
        territory="Andalucía o provincia de Ciudad Real",
        why_reforesta="Financia conservación y restauración de bosques y espacios naturales, y educación ambiental: "
        "lo mismo que hace Reforesta.",
        limits=[
            Limit(
                "Solo proyectos en Andalucía o en la provincia de Ciudad Real: Reforesta tendría que trabajar allí.",
                8,
            )
        ],
    ),
    RscProgramme(
        id="rsc-ibercaja-medioambiente",
        entity="Fundación Ibercaja",
        program="Convocatoria Sostenibilidad y Protección del Medioambiente",
        kind="ayuda",
        focus=["restauracion", "conservacion", "educacion"],
        url="https://www.fundacionibercaja.es/convocatorias/convocatoria-2026-sostenibilidad-y-proteccion-del-"
        "medioambiente/",
        bases_url="https://www.fundacionibercaja.es/resources/activities/documents/1780390157-1780390156732.pdf",
        amount="Hasta 20.000 €; la ayuda nunca supera lo que aporta la entidad",
        opens_at="2026-06-02",
        deadline="2026-06-30",
        window="Del 2 al 30 jun 2026, hasta las 12:00. En 2025 el plazo se amplió hasta el 28 oct.",
        timing="Fecha variable: en 2025 cerró en octubre; en 2026, en junio",
        about="Apoya proyectos de entidades sin ánimo de lucro en conservación de la biodiversidad y espacios "
        "naturales (gestión forestal sostenible, restauración), economía circular, sostenibilidad rural y "
        "educación ambiental.",
        beneficiarios=["Asociaciones y fundaciones sin ánimo de lucro"],
        requirements=[
            "Asociación o fundación inscrita en su registro hace al menos 2 años.",
            "Al menos 2 años de experiencia demostrada en medio ambiente.",
            "Poner al menos tanto dinero como se pide: la ayuda nunca supera lo que aporta la entidad.",
            "Tener cuenta en Ibercaja Banco al firmar el convenio.",
            "Un proyecto por entidad, en España, de 12 meses como máximo.",
        ],
        territory=None,
        why_reforesta="Es de ámbito nacional y entre sus líneas están la gestión forestal sostenible, la "
        "restauración de espacios naturales y la educación ambiental.",
        limits=[
            Limit("Cofinanciación: Reforesta debe aportar al menos lo mismo que pide (máximo 20.000 €).", 3),
            Limit("Hay que tener cuenta en Ibercaja Banco para firmar el convenio.", 2),
        ],
    ),
    RscProgramme(
        id="rsc-bbva-futuro",
        entity="BBVA Asset Management",
        program="Convocatoria Solidaria BBVA Futuro",
        kind="ayuda",
        focus=["restauracion"],
        url="https://www.bbva.com/es/es/sostenibilidad/bbva-asset-management-repartira-un-millon-de-euros-en-"
        "proyectos-solidarios-y-priorizara-los-de-reforestacion/",
        bases_url=None,
        amount="Medioambiente: un premio de 72.000 € y cuatro de 32.000 € (edición 2026)",
        opens_at="2026-01-16",
        deadline="2026-02-16",
        window="Del 16 ene al 16 feb 2026 (octava edición).",
        timing="La edición anterior abrió en enero de 2026",
        about="Donaciones a proyectos sociales y medioambientales desarrollados en España. En 2026 dio prioridad a "
        "la restauración, la reforestación y la prevención de incendios, y a las zonas quemadas en 2025.",
        beneficiarios=["Por comprobar en las bases"],
        requirements=[
            "Proyecto desarrollado en España.",
            "En medioambiente, prioridad a reforestación, restauración y prevención de incendios.",
        ],
        territory=None,
        why_reforesta="En 2026 priorizó la reforestación y la recuperación de zonas quemadas: el núcleo del trabajo "
        "de Reforesta.",
        limits=[Limit("Requisitos de la entidad sin comprobar: leed las bases antes de preparar nada.", 4)],
        unverified="No hemos podido leer las bases (bloquean la descarga automática): los datos salen de la nota de "
        "prensa de BBVA. Quién puede presentarse está sin comprobar.",
    ),
    RscProgramme(
        id="rsc-endesa-biodiversidad",
        entity="Fundación Endesa",
        program="Convocatoria de ayudas a proyectos de Biodiversidad",
        kind="ayuda",
        focus=["conservacion", "restauracion"],
        url="https://www.fundacionendesa.org/es/biodiversidad/convocatoria-proyectos-biodiversidad",
        bases_url="https://www.fundacionendesa.org/content/dam/fundacion-endesa-com/biodiversidad/ii-convocatoria-"
        "de-biodiversidad/Bases%20Convocatoria%20Biodiversidad.pdf",
        amount="100.000 € por proyecto (dos proyectos, uno por categoría)",
        opens_at="2026-09-15",
        deadline="2026-10-16",
        window="Del 15 sep al 16 oct 2026 (II edición). La I edición fue del 15 sep al 27 oct de 2025.",
        timing="Suele abrir en septiembre",
        about="Financia proyectos de conservación de especies en peligro de extinción o vulnerables en España.",
        beneficiarios=["Entidades privadas sin ánimo de lucro registradas en España"],
        requirements=[
            "Entidad privada sin ánimo de lucro registrada en España, con la conservación en sus estatutos.",
            "Al menos dos ejercicios completos de actividad en proyectos de conservación.",
            "Cuentas de los dos últimos años auditadas por un auditor externo.",
            "La especie del proyecto debe estar en un catálogo de especies amenazadas (estatal o autonómico).",
            "Fundación Endesa paga al menos el 60 % del coste; el proyecto dura un año.",
        ],
        territory=None,
        why_reforesta="Solo encaja si Reforesta mejora el hábitat de una especie catalogada como amenazada.",
        limits=[
            Limit("Exige cuentas de los dos últimos años auditadas por un auditor externo.", 6),
            Limit(
                "Solo especies de un catálogo de especies amenazadas; no paga proyectos que sean solo de educación "
                "o sensibilización.",
                6,
            ),
        ],
    ),
    RscProgramme(
        id="rsc-fbbva-premio-biodiversidad",
        entity="Fundación BBVA",
        program="Premios Biodiversidad: Premio Biodiversidad España",
        kind="premio",
        focus=["conservacion", "restauracion", "educacion"],
        url="https://www.biophilia-fbbva.es/premios/xxi-premios-biodiversidad/",
        bases_url="https://www.biophilia-fbbva.es/wp-content/uploads/sites/3/2025/12/bases-xxi-premios-"
        "biodiversidad.pdf",
        amount="250.000 € (conservación en España) · 80.000 € (educación y comunicación ambiental en España)",
        opens_at="2026-01-30",
        deadline="2026-04-30",
        window="Del 30 ene al 30 abr 2026 (XXI edición).",
        timing="La edición anterior abrió en enero de 2026",
        about="Premia proyectos de conservación de hábitats, especies o ecosistemas en España ya terminados y con "
        "resultados, y trabajos de educación y comunicación ambiental.",
        beneficiarios=["Entidades sin ánimo de lucro con sede en España"],
        requirements=[
            "Entidad sin ánimo de lucro con sede en España, constituida antes de 2024.",
            "Proyecto ya terminado (antes del 31 dic 2025 en la XXI edición) con resultados medibles.",
            "La propia entidad puede presentar su candidatura.",
        ],
        territory=None,
        why_reforesta="Si Reforesta tiene una restauración terminada con resultados medidos, o un programa de "
        "educación ambiental, puede presentarlo.",
        limits=[Limit("Es un premio a trabajo ya terminado, no dinero para un proyecto nuevo.", 8)],
    ),
    RscProgramme(
        id="rsc-prezero-sumate",
        entity="PreZero",
        program="Súmate: convocatoria de ayudas a proyectos sociales y medioambientales",
        kind="ayuda",
        focus=["educacion"],
        url="https://prezero.com/es/sumate-prezero",
        bases_url=None,
        amount="Sin cifra fija: lo que donan los empleados, duplicado por la empresa, se reparte entre un máximo de "
        "10 proyectos",
        opens_at="2026-09-01",
        deadline="2026-10-04",
        window="Del 1 sep al 4 oct 2026 (V convocatoria).",
        timing="La edición anterior abrió en septiembre de 2026",
        about="Apoya proyectos de ONG y fundaciones, sobre todo de inclusión sociolaboral y de concienciación "
        "medioambiental (incluida la educación ambiental). Los empleados votan los ganadores.",
        beneficiarios=["Organizaciones privadas sin ánimo de lucro registradas en España"],
        requirements=[
            "Organización privada sin ánimo de lucro con domicilio en España, inscrita hace al menos 1 año.",
            "El proyecto incluye voluntariado abierto al personal de PreZero.",
            "Se ejecuta en 12 meses; ganan los proyectos que votan los empleados.",
        ],
        territory=None,
        why_reforesta="Pide voluntariado y prioriza la concienciación ambiental: encaja con jornadas de plantación "
        "con voluntarios.",
        limits=[Limit("Importe incierto: depende de lo que done la plantilla.", 4)],
    ),
)

RSC_HEALTH = SourceHealth(
    id="rsc",
    name="RSC · Fundaciones y empresas",
    category="RSC Privado",
    status="ok",
    count=0,
    url="",
    note="Lista hecha a mano de programas privados que financian proyectos ambientales de ONG en España, "
    "comprobada en la web de cada entidad el 15 nov 2026.",
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
        opens_at=r.opens_at,
        deadline=r.deadline,
        deadline_text=r.window,
        amount_text=r.amount,
        tipo="Premio" if r.kind == "premio" else "Ayuda a proyectos",
        beneficiarios=r.beneficiarios,
        url=r.url,
        bases_url=r.bases_url,
        summary=r.about,
        rsc=RscInfo(
            kind=r.kind,
            why_reforesta=r.why_reforesta,
            limits=[lim.text for lim in r.limits],
            requirements=r.requirements,
            territory=r.territory,
            window=r.window,
            timing=r.timing,
            verified_on=VERIFIED_ON,
            unverified=r.unverified,
        ),
        score_input=RscScoreInput(
            titulo=r.program,
            focus=r.focus,
            about=r.about,
            opens_at=r.opens_at,
            deadline=r.deadline,
            limits=[(lim.text, lim.penalty) for lim in r.limits],
            verified_on=VERIFIED_ON,
        ),
    )


class RscSource(Source):
    id = "rsc"
    name = RSC_HEALTH.name

    async def fetch(self, ctx: SourceContext) -> FetchResult:
        return FetchResult(items=[to_raw(r) for r in RSC_PROGRAMMES], health=RSC_HEALTH.model_copy())
