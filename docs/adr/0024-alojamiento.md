# 0024. Alojamiento: VPS pequeño con Dokploy u Oracle Always Free

- Estado: Sustituida por 0037
- Fecha: 2026-11-15 (fecha de registro; no hay commit asociado)

## Contexto
Todo corre en local con `docker compose` (0003). El `README.md` tiene el despliegue como «pendiente». La pila
necesita procesos permanentes (Postgres, API, `ingest-scheduler`), así que no encaja en una plataforma serverless.

## Decisión (propuesta, no tomada)
Desplegar el mismo `docker-compose.yml` en un VPS pequeño gestionado con Dokploy, o en una máquina de Oracle Cloud
Always Free. Nada está desplegado todavía.

## Consecuencias si se acepta
- Mismo entorno que en local.
- Hará falta: proxy inverso con https que fije `X-Forwarded-For` (0004, 0016), `RADAR_COOKIE_SECURE=true`,
  `RADAR_PUBLIC_URL` real y copias de seguridad de Postgres (pendiente en `docs/backend.md`).

## Alternativas consideradas
- Plataformas serverless (p. ej. Vercel) con base gestionada: no cubren el planificador ni la base sin piezas
  extra; el `README.md` anterior a 0003 ya avisaba de arranques en frío de 20–28 s sin disco persistente.
