# Backend del radar (Postgres en Supabase)

Todo es opcional: sin `DATABASE_URL` la app funciona igual que antes (memoria + `.cache/oportunidades.json`).

## Arquitectura

```
GitHub Actions (cron 3×/día + "Run workflow")
   └─ npx tsx scripts/ingest.ts ──► fuentes (BDNS, BOE, UE, BOCM, DOG, FB, BOJA, BOCYL, TED, Montemadrid, RSC)
            │  una transacción por ejecución
            ▼
   Postgres (Supabase): opportunities · opportunity_changes · ingest_runs · source_runs · fetch_cache
            ▲  lectura (caché en memoria 60 s)
   Next.js /api/oportunidades ──► rank() en lectura (encaje geográfico + tipo) ──► UI
```

- La ingesta guarda el ítem **base**; el ranking se aplica al leer, así un cambio de puntuación no exige reingestar.
- Una fuente que falla no toca sus filas. Solo una fuente con estado `ok` marca como `gone_at` lo que ya no devuelve.
- `?refresh=1` con base de datos no consulta las fuentes desde la web: devuelve el estado guardado.
- Si la base de datos no responde (o aún no hay ninguna ingesta correcta), la web usa la caché local y lo indica en `storageError`.
- Esquema: `supabase/migrations/0001_init.sql`. SQL de la app: `src/lib/db.ts` y `src/lib/store-pg.ts`.

## Puesta en marcha

1. Crear un proyecto en supabase.com (región UE, p. ej. Frankfurt). Guardar la contraseña de la base de datos.
2. Aplicar la migración: *SQL Editor* → pegar `supabase/migrations/0001_init.sql` → *Run*. O bien:
   `psql "<cadena Session pooler>" -f supabase/migrations/0001_init.sql` (es idempotente).
3. En GitHub: *Settings → Secrets and variables → Actions → New repository secret* `DATABASE_URL` con la cadena
   **Session pooler** (puerto 5432 en `*.pooler.supabase.com`; sirve para la ingesta y para `pg_dump`).
4. *Actions → Ingest → Run workflow* para la primera carga (~30–40 s de fuentes).
5. En el hosting de la web, `DATABASE_URL` con la cadena **Transaction pooler** (puerto 6543). Redesplegar.

## Ejecutar la ingesta en local

```
DATABASE_URL="postgresql://..." npx tsx scripts/ingest.ts             # todas las fuentes
DATABASE_URL="postgresql://..." npx tsx scripts/ingest.ts --source bdns,boe
npx tsx scripts/ingest.ts --dry-run                                    # sin escribir (sin DB: compara contra vacío)
```

El resumen muestra por fuente: nuevas / cambiadas / iguales / desaparecidas, duración y grupos de posibles
duplicados (no se fusionan todavía). Sale con código 1 solo si fallan todas las fuentes o la escritura.

## Riesgos conocidos y salvaguardas

| Riesgo | Salvaguarda |
|---|---|
| Supabase Free **se pausa tras 7 días sin actividad** | La ingesta 3×/día debería contar como actividad (sin verificar con Supabase). Si se pausa, la web cae a la caché local (`storageError`). |
| Supabase Free **no tiene copias de seguridad automáticas** | Job `backup` nocturno: `pg_dump` como artefacto con 7 días de retención. Provisional hasta tener un bucket externo. |
| GitHub **desactiva los cron tras 60 días sin actividad** en repos públicos | Aviso de frescura: `ingestStale` (> 12 h sin ingesta correcta) muestra "Los datos no se actualizan desde hace N h". Reactivar en *Actions*. |
| Una fuente cambia su HTML | Se registra en `source_runs`; sus filas anteriores siguen visibles y la fuente sale como parcial. |
| El cron es UTC | 06/13/19 h en invierno; en verano corre una hora más tarde (ver comentario en el workflow). |

Plan B si Supabase da problemas: Postgres en **Fly.io** (o cualquier Postgres gestionado). Solo cambia
`DATABASE_URL`; el script de ingesta es independiente de Next y puede programarse con cualquier cron.

## Siguiente tramo

- Auth con Supabase (enlace mágico) y tablas con políticas RLS explícitas (migración 0002).
- Tablero de seguimiento compartido (estado, responsable, notas por oportunidad).
- Perfil de equipo guardado en la base de datos.
- "Nuevo desde tu última visita" (usa `first_seen_at` y `opportunity_changes`).
- Alertas (correo) para oportunidades nuevas de encaje alto o plazos que cierran.
