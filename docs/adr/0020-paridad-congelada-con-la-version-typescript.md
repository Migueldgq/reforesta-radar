# 0020. Paridad congelada con la versión TypeScript

- Estado: Aceptada
- Fecha: 2026-11-15 (3361a77, PR #18; d162feb, PR #21)

## Contexto
Al pasar el backend a Python (0003) había que garantizar que la puntuación no cambiaba sin querer: mismas notas,
mismos textos y mismo orden de motivos y avisos. «Corrección por encima de elegancia» (`backend/README.md`).

## Decisión
Antes de borrar el backend TypeScript se volcaron sus salidas como referencias congeladas en `backend/tests/golden/`:
2 168 casos de `scoreConvocatoria`, 3 630 de `geographicFit` + `kindFit`, las tablas del perfil valor a valor y la
respuesta completa de `/api/oportunidades` (542 ítems), más las entradas que la API no exponía. Los tests
`test_parity_functions.py` y `test_parity_golden.py` las comparan. Se conservan rarezas del TypeScript (`js_round`,
regex solo ASCII) para no romper la paridad. Un cambio intencionado de puntuación actualiza las expectativas y sube
`SCORING_VERSION`.

## Consecuencias
- Cualquier cambio de puntuación se ve en los tests.
- Las herramientas de volcado se borraron con el TypeScript: las referencias no se pueden regenerar, solo editar.
- Arrastran casos de fuentes retiradas (`ted`, `bocyl`) y rarezas conocidas (`deadline_from_days` con «1 mes»).
- Los programas de empresas (0013) quedan fuera de la paridad.

## Alternativas consideradas
- Reescribir la puntuación sin referencia: motivo no registrado.
