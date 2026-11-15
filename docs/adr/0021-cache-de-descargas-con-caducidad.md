# 0021. Caché de descargas con caducidad en `fetch_cache`

- Estado: Aceptada
- Fecha: 2026-11-14 (35056ca, PR #12; port a Python en 3361a77)

## Contexto
Muchas respuestas de las fuentes apenas cambian (fichas BDNS, sumarios de días pasados, árboles de organismos,
concesiones antiguas). Pedirlas en cada ingesta es lento y castiga APIs públicas que ya responden 429.

## Decisión
`Memo` (`backend/app/sources/memo.py`) es una caché por clave con caducidad. La ingesta la carga de la tabla
`fetch_cache` y guarda al final las entradas nuevas, «para que las ejecuciones repetidas sigan siendo baratas y
educadas». La caducidad depende del dato: por ejemplo, ficha BDNS 24 h si tiene fecha de fin y 3 h si no; árboles de
organismos 7 días; ediciones anteriores 90 días; concesiones 7, 30 o 90 días según su antigüedad. Claves y formas
iguales a las del TypeScript.

## Consecuencias
- Ingesta en caliente de segundos (BDNS unos 10 s; historial, 0 peticiones).
- Un dato corregido en la fuente puede tardar hasta su caducidad en verse.
- La ingesta borra las entradas caducadas hace más de 30 días (`backend/app/ingest/store.py`).

## Alternativas consideradas
- Pedir todo en cada ingesta: lento y poco respetuoso con las fuentes (ver contexto).
