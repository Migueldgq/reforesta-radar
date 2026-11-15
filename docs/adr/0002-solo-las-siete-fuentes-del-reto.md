# 0002. Solo las siete fuentes que propone el reto

- Estado: Aceptada
- Fecha: 2026-11-15 (6258019, PR #19)

## Contexto
Durante el hackathon se añadieron cuatro fuentes más allá de las que cita `RETO.md`: TED (licitaciones UE), BOCYL,
BOJA y la Fundación Montemadrid (6b67011). El responsable del proyecto pidió quitarlas para ceñirse a lo que proponía
el reto y porque la BDNS ya agrega la mayoría de las subvenciones públicas españolas.

## Decisión
El radar lee siete fuentes: `bdns`, `boe`, `eu` (Funding & Tenders), `bocm`, `dog`, `fb` (Fundación Biodiversidad)
y `rsc` (programas de empresas). `SOURCE_ORDER` en `backend/app/sources/__init__.py` las fija. La ingesta marca como
`gone_at` las filas de fuentes que ya no están registradas.

## Consecuencias
- Menos conectores que mantener, sobre todo de los frágiles que leen HTML.
- Los boletines autonómicos que no son Madrid ni Galicia llegan solo a través de la BDNS; los provinciales y
  municipales no se leen directamente (limitación documentada en `README.md`).
- `ted` y `bocyl` siguen en el golden de paridad solo como casos de puntuación (ver 0020), no como fuentes.

## Alternativas consideradas
- Mantener las once fuentes: descartado por la petición del responsable del proyecto.
- Añadir más boletines autonómicos: sigue en «Siguientes pasos» del `README.md`; necesitaría un ADR.
