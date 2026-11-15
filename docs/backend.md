# Backend del radar (FastAPI + Postgres)

El backend es la app de Python en `backend/` (detalles de código, tests y cómo añadir una fuente en
[backend/README.md](../backend/README.md)). Next.js es solo interfaz: reenvía `/api/*` a esta API.

## Arquitectura

```
ingest-scheduler (al arrancar y cada 8 h)
   └─ python -m app.ingest ──► fuentes (BDNS, BOE, UE, BOCM, DOG, FB, RSC)
            │  una transacción por ejecución
            ▼
   Postgres 16: opportunities · opportunity_changes · ingest_runs · source_runs · fetch_cache
            ▲  lectura
   API FastAPI (/api/oportunidades, /api/fuentes, /api/perfil, /api/analyze-pdf)
            ▲  rewrite /api/* (next.config.ts, API_URL)
   Next.js ──► navegador
```

- La ingesta guarda el ítem **base**; el encaje geográfico y por tipo y el orden se aplican al leer, así un cambio
  de ranking no exige reingestar.
- Una fuente que falla no toca sus filas. Solo una fuente con estado `ok` marca como `gone_at` lo que ya no devuelve.
  Las filas de fuentes que ya no están registradas se marcan `gone_at` en la siguiente ingesta.
- La API nunca consulta las fuentes al responder: no hay `?refresh=1`. «Volver a cargar» en la web solo vuelve a
  leer la API.
- `ingestStale` (más de 12 h sin una ingesta correcta) hace que Inicio muestre «Los datos no se actualizan desde
  hace N h».
- Si Postgres no responde, la API devuelve 503; si la API no responde, la web muestra un estado de error (o la
  última copia guardada en el navegador, con un aviso). La portada se pinta sin cifras.
- Esquema: migraciones de Alembic en `backend/alembic/` (la API las aplica al arrancar).
- `SCORING_VERSION` (`backend/app/scoring/__init__.py`, ahora 12) se guarda en cada `ingest_runs`; súbelo cuando
  cambie la puntuación base.

## Puesta en marcha

```bash
docker compose up -d --build        # postgres, api, ingest-scheduler, web
docker compose ps                   # api "healthy"; la primera ingesta tarda unos minutos
```

| Servicio | URL / puerto (host) | Notas |
|---|---|---|
| `web` | http://localhost:3010 (`RADAR_WEB_PORT`) | Next.js `standalone`, usuario sin privilegios. `API_URL=http://api:8000` se fija al construir la imagen (rewrites) y al ejecutar (portada). |
| `api` | http://localhost:8010 (`RADAR_API_PORT`), docs en `/docs` | Con healthcheck sobre `/health`. |
| `postgres` | `localhost:5440` (`RADAR_DB_PORT`) | Usuario, contraseña y base `radar` (solo desarrollo; `RADAR_DB_PASSWORD`). |
| `ingest-scheduler` | — | Ingesta al arrancar y cada `RADAR_INGEST_EVERY_S` (28800 s = 8 h). |

Los valores se cambian en un `.env` en la raíz (ver `.env.example`). Para el frontend en local con recarga en
caliente: `docker compose up -d postgres api` y `npm run dev` (usa `API_URL`, por defecto `http://localhost:8010`).

## Ejecutar la ingesta a mano

```bash
docker compose run --rm ingest                     # todas las fuentes
docker compose run --rm ingest --source bdns,boe    # algunas
docker compose run --rm ingest --dry-run            # sin escribir
```

El resumen muestra por fuente: nuevas / cambiadas / iguales / desaparecidas y la duración. Sale con código 1 solo
si fallan todas las fuentes o la escritura.

## Qué se retiró

El backend anterior en TypeScript (rutas `src/app/api/*`, conectores y caché en `src/lib/`, `.cache/`,
`scripts/ingest.ts`, la migración de `supabase/` y el workflow de GitHub Actions que ingestaba en Supabase
3 veces al día) se eliminó al pasar a Python. Ya no hay ingesta en GitHub Actions ni base de datos en Supabase:
la ingesta programada es el servicio `ingest-scheduler`. Para algo más robusto en un servidor, usar el cron del
host con `docker compose run --rm ingest --trigger schedule`.

## Riesgos conocidos

| Riesgo | Salvaguarda |
|---|---|
| Sin copias de seguridad automáticas de Postgres | Pendiente: `pg_dump` periódico del volumen `radar-pgdata`. |
| El bucle de `ingest-scheduler` no es un cron: si el contenedor se recrea, ingesta otra vez al arrancar | Aceptable (la ingesta es idempotente); usar el cron del host si importa la hora exacta. |
| Una fuente cambia su HTML | Se registra en `source_runs`; sus filas anteriores siguen visibles y la fuente sale como parcial o error. |

## Siguiente tramo

- Tablero de seguimiento compartido (estado, responsable, notas por oportunidad) con autenticación.
- Perfil de equipo guardado en la base de datos.
- «Nuevo desde tu última visita» (usa `first_seen_at` y `opportunity_changes`).
- Alertas (correo) para oportunidades nuevas de encaje alto o plazos que cierran.
