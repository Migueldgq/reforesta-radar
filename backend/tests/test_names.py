"""Organism display names (app/sources/names.py) and their migration (0007)."""

import json

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.scoring.score import ScoreInput, score_convocatoria
from app.sources.names import organism_name

CASES = {
    "COMUNIDAD DE MADRID": "Comunidad de Madrid",
    "CASTILLA-LA MANCHA": "Castilla-La Mancha",
    "AYUNTAMIENTO DE SANT JOAN DESPÍ · SANT JOAN DESPÍ": "Ayuntamiento de Sant Joan Despí · Sant Joan Despí",
    "DIPUTACIÓN PROVINCIAL DE CASTELLÓ/CASTELLÓN · DIPUTACIÓN PROV. DE CASTELLÓN":
        "Diputación Provincial de Castelló/Castellón · Diputación Prov. de Castellón",
    "DIRECCION GENERAL ORDENACION AGROPECUARIA · CASTILLA-LA MANCHA":
        "Dirección General Ordenación Agropecuaria · Castilla-La Mancha",
    "DEPARTAMENTO DE INTERIOR, FUNCION PUBLICA Y JUSTICIA · COMUNIDAD FORAL DE NAVARRA":
        "Departamento de Interior, Función Pública y Justicia · Comunidad Foral de Navarra",
    "DEPARTAMENT D'AGRICULTURA, RAMADERIA, PESCA I ALIMENTACIÓ · CATALUÑA":
        "Departament d'Agricultura, Ramaderia, Pesca i Alimentació · Cataluña",
    "AYUNTAMIENTO DE SANTA EULÀRIA DES RIU · SANTA EULÀRIA DES RIU":
        "Ayuntamiento de Santa Eulària des Riu · Santa Eulària des Riu",
    "AGENCIA GALLEGA DE DESARROLLO RURAL (AGADER) · GALICIA": "Agencia Gallega de Desarrollo Rural (AGADER) · Galicia",
    "UNIVERSITAT DE VALÈNCIA (ESTUDI GENERAL)": "Universitat de València (Estudi General)",
    "DIPUTACIÓN PROVINCIAL DE CORUÑA, A · DIPUTACIÓN PROV. DE A CORUÑA":
        "Diputación Provincial de Coruña, A · Diputación Prov. de A Coruña",
    "CONSORCIO PARA LA GESTIÓN DE RESIDUOS ZONA V5": "Consorcio para la Gestión de Residuos Zona V5",
    "AYUNTAMIENTO DE VITORIA-GASTEIZ · VITORIA-GASTEIZ": "Ayuntamiento de Vitoria-Gasteiz · Vitoria-Gasteiz",
    "ORGANISMO AUTÓNOMO PARQUES NACIONALES · MINISTERIO PARA LA TRANSICIÓN ECOLÓGICA Y EL RETO DEMOGRÁFICO":
        "Organismo Autónomo Parques Nacionales · Ministerio para la Transición Ecológica y el Reto Demográfico",
    # mixed case from a person or another source: untouched
    "Comisión Europea · Horizon Europe (HORIZON-CL6-2027-01-BIODIV-01)":
        "Comisión Europea · Horizon Europe (HORIZON-CL6-2027-01-BIODIV-01)",
    "Comisión Europea · LIFE (LIFE-2025-CET-EUCF)": "Comisión Europea · LIFE (LIFE-2025-CET-EUCF)",
    "BBVA Asset Management": "BBVA Asset Management",
    # one name per organism across connectors
    "FUNDACIÓN BIODIVERSIDAD · MINISTERIO PARA LA TRANSICIÓN ECOLÓGICA Y EL RETO DEMOGRÁFICO":
        "Fundación Biodiversidad (MITECO)",
    "Fundación Biodiversidad (MITECO)": "Fundación Biodiversidad (MITECO)",
}  # fmt: skip


@pytest.mark.parametrize("raw", CASES)
def test_organism_name(raw: str) -> None:
    assert organism_name(raw) == CASES[raw]
    assert organism_name(CASES[raw]) == CASES[raw]  # idempotent


@pytest.mark.parametrize("raw", CASES)
def test_manual_source_matching_is_unchanged(raw: str) -> None:
    def match(org: str) -> str | None:
        return score_convocatoria(ScoreInput(titulo="x", organismo=org)).manual_source_match

    assert match(organism_name(raw)) == match(raw)


async def test_migration_renames_stored_names_and_the_saved_filter(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        data = {"organismo": "COMUNIDAD DE MADRID", "titulo": "t"}
        await conn.execute(text("insert into opportunities (id, source, kind, titulo, organismo, url, data, "
                                "content_hash) values ('x:1', 'bdns', 'subvencion', 't', 'COMUNIDAD DE MADRID', 'u', "
                                "cast(:d as jsonb), 'h')"), {"d": json.dumps(data)})  # fmt: skip
        await conn.execute(text("insert into tracking (opportunity_id, status, titulo, organismo) "
                                "values ('x:1', 'estudio', 't', 'COMUNIDAD DE MADRID')"))  # fmt: skip
        await conn.execute(text("insert into org_settings (id, organisms) values (1, cast(:o as jsonb))"),
                           {"o": json.dumps(["COMUNIDAD DE MADRID", "Comunidad de Madrid", "Fundación Biodiversidad "
                                             "(MITECO)"])})  # fmt: skip

        def run(sync_conn) -> None:  # noqa: ANN001
            from alembic.migration import MigrationContext
            from alembic.operations import Operations

            ctx = MigrationContext.configure(sync_conn)
            with Operations.context(ctx):
                _load_migration().upgrade()

        await conn.run_sync(run)
        row = (await conn.execute(text("select organismo, data->>'organismo' from opportunities"))).one()
        assert tuple(row) == ("Comunidad de Madrid", "Comunidad de Madrid")
        assert (await conn.execute(text("select organismo from tracking"))).scalar() == "Comunidad de Madrid"
        assert (await conn.execute(text("select organisms from org_settings"))).scalar() == [
            "Comunidad de Madrid", "Fundación Biodiversidad (MITECO)"]  # fmt: skip


def _load_migration():  # noqa: ANN202
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0007_organism_display_names.py"
    spec = importlib.util.spec_from_file_location("m0007", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod
