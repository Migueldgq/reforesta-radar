# 0012. Puntuar por quién ganó ediciones anteriores (BDNS)

- Estado: Aceptada
- Fecha: 2026-11-15 (2f5f3b6, eedf870, 56784ce, b1be587; PR #30)

## Contexto
Una convocatoria puede encajar por tema y, aun así, darse casi siempre a ayuntamientos o empresas. La BDNS publica
las concesiones de ediciones anteriores, pero no tiene un identificador de serie que una las ediciones.

## Decisión
- Tras la escritura principal, un paso aparte (`backend/app/ingest/history.py`) busca ediciones anteriores de las
  convocatorias relevantes y las guarda en `bdns_editions`. Si falla o se agota su tiempo, la ingesta sigue siendo
  correcta.
- Emparejado (`backend/app/sources/bdns_history.py`): mismo organismo, Jaccard ≥ 0,5 sobre las palabras del título
  sin texto repetitivo, como mucho una por año, sin modificaciones, ampliaciones ni correcciones.
- Señales al leer (`backend/app/scoring/history.py`): Reforesta ganó una edición +8; ONG afines de una lista curada
  +3; ≥ 70 % de ≥ 5 concesiones a entidades sin ánimo de lucro +6; < 20 % −10 con aviso; ninguna, tope 45. Las
  penalizaciones solo se aplican si el emparejado es fiable (Jaccard ≥ 0,6 en todas, o ≥ 2 ediciones que coinciden).
- **Privacidad**: las concesiones nombran a personas físicas. Solo se guardan recuentos por tipo de NIF, importes,
  fechas y coincidencias con la lista curada de organizaciones; nunca la respuesta original ni nombres de personas.

## Consecuencias
- Sube lo que Reforesta o sus pares ya ganaron y baja lo que nunca va a ONG.
- El emparejado por título puede fallar; por eso las penalizaciones exigen base fiable y los recuentos se muestran.
- Más peticiones a la BDNS (unas 1 100 en frío, 0 en caliente gracias a `fetch_cache`).

## Alternativas consideradas
- Guardar las concesiones completas: descartado por privacidad.
