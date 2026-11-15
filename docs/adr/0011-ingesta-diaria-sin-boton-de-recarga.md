# 0011. Ingesta diaria a las 9:00, sin botón de recarga

- Estado: Aceptada
- Fecha: 2026-11-15 (103070e y 6de442d, PR #29; peticiones de administrador en 81252a5, rama `feat/fase-2-usuarios`)

## Contexto
La ingesta corría cada 8 h (`RADAR_INGEST_EVERY_S`) y la web tenía un botón de recarga que solo volvía a leer la base
de datos, no las fuentes. Los boletines publican de madrugada y los plazos duran semanas, así que más de una carga al
día no aporta.

## Decisión
- `ingest-scheduler` (`backend/app/ingest/scheduler.py`) ejecuta una ingesta al día a `RADAR_INGEST_AT` (09:00,
  `Europe/Madrid`). Comprueba cada 30 s: si no ha habido ninguna ingesta correcta desde las últimas 9:00 (equipo
  dormido), ingesta al despertar; si la base nunca se ha llenado, ingesta en el acto; un fallo se reintenta a la hora.
- La web no tiene botón de recarga: el pie de la barra lateral dice de cuándo son los datos. Con más de 36 h sin
  ingesta correcta, la API marca `ingestStale` e Inicio avisa.
- Un administrador puede pedir «Actualizar ahora»: `POST /api/ingest` solo registra la petición en `ingest_requests`
  (una abierta a la vez) y el planificador la recoge. La API nunca ejecuta la ingesta.

## Consecuencias
- Carga predecible y respetuosa con las fuentes; la API responde rápido porque solo lee Postgres.
- Una convocatoria publicada después de las 9:00 aparece al día siguiente (salvo petición de un administrador).
- La API y la ingesta quedan separadas: un fallo de una fuente no tumba la web.

## Alternativas consideradas
- Varias ingestas al día (3 en GitHub Actions, luego cada 8 h): no aportan por el ritmo de publicación.
- Que la API lance la ingesta al pedirla: descartado; se usa una cola en la base de datos.
