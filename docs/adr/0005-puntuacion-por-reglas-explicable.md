# 0005. Puntuación por reglas, explicada punto por punto

- Estado: Aceptada
- Fecha: 2026-11-14 (cfb6d85; reglas actuales tras 6b67011, 5544cf3 y f28b462)

## Contexto
El equipo de Reforesta tiene que decidir rápido si una convocatoria merece leerse. Una nota sin explicación no le
ayuda a decidir ni le deja discrepar.

## Decisión
Cada convocatoria recibe una puntuación de 0 a 100 calculada con reglas fijas en `backend/app/scoring/`
(`score.py`, `profile.py`, `rank.py`):

- pesos de palabras clave por línea de trabajo (restauración, conservación, educación, agroambiental y custodia), en
  castellano, catalán, gallego y euskera; el título cuenta el doble que la finalidad;
- sumas por concurrencia competitiva, mención a entidades sin ánimo de lucro, plazo abierto o próximo, organismo que
  no revisan a mano y presupuesto de 50.000 € o más;
- descartes y restas (nominativa, concesión directa, convenio, solo empresas o ayuntamientos, otros ámbitos);
- topes por elegibilidad, plazo y territorio (ver 0007);
- niveles con `tier_for`: alto ≥ 60, medio ≥ 40, bajo por debajo.

Cada regla aplicada deja una frase en `reasons` o en `warnings`. Las tablas de perfil (`profile.py`) se escribieron
a mano a partir del enunciado y de la web de Reforesta. `SCORING_VERSION` (ahora 14) se sube con cada cambio de
puntuación y se guarda en `ingest_runs`.

## Consecuencias
- El equipo ve por qué una convocatoria tiene esa nota y puede no estar de acuerdo.
- Determinista, gratis y comprobable con tests.
- Busca palabras, no entiende el texto: puede dar nota alta a algo que no encaja o pasar por alto una convocatoria
  redactada de forma poco habitual (limitación del `README.md`).
- Las tablas se mantienen a mano.

## Alternativas consideradas
- Clasificación con un modelo de lenguaje: ver 0006.
