# 0003. Backend en Python (FastAPI) y Postgres, todo en Docker

- Estado: Aceptada
- Fecha: 2026-11-15 (3361a77, PR #18; conectores en d162feb, PR #21; corte en 74f7b9e, PR #23)

## Contexto
La primera versión era solo Next.js: rutas `src/app/api/*`, conectores en TypeScript, caché en `.cache/`, y un
Postgres opcional en Supabase alimentado por un workflow de GitHub Actions tres veces al día (35056ca). Al terminar
el evento ya no había plazo. El responsable del proyecto dio estos motivos para cambiar: el producto trabaja sobre
muchos datos y debe servir de base para funciones futuras; prefiere Python para el trabajo con datos; y de momento se
ejecuta en local.

## Decisión
Un único backend en `backend/`: Python 3.13, FastAPI, SQLAlchemy Core y Alembic sobre Postgres 16, gestionado con
`uv`. `docker-compose.yml` levanta `postgres`, `api`, `ingest-scheduler` y `web`. La ingesta (`python -m app.ingest`)
escribe en una transacción; la API solo lee Postgres y nunca consulta las fuentes al responder. Se eliminaron el
backend TypeScript, la migración de Supabase y la ingesta en GitHub Actions.

## Consecuencias
- Un `docker compose up` arranca todo sin cuentas ni claves externas.
- Dos lenguajes en el repo (TypeScript en la web, Python en el backend) y un contrato JSON que mantener a mano
  (`src/lib/opportunity.ts` ↔ `backend/app/models.py`).
- Sin copias de seguridad automáticas de Postgres (riesgo listado en `docs/backend.md`).
- El port exigió pruebas de paridad (ver 0020).

## Alternativas consideradas
- Seguir con Next.js + Supabase + GitHub Actions: descartado por los motivos de arriba; además Supabase Free se pausa
  sin actividad y no hace copias, y GitHub desactiva los cron sin actividad (riesgos de la versión anterior de
  `docs/backend.md`).
- Despliegue serverless: el `README.md` de entonces ya avisaba de que en plataformas sin disco (p. ej. Vercel) cada
  arranque en frío tardaba 20–28 s.
