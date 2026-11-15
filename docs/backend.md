# Backend del radar (FastAPI + Postgres)

El backend es la app de Python en `backend/` (detalles de código, tests y cómo añadir una fuente en
[backend/README.md](../backend/README.md)). Next.js es solo interfaz: reenvía `/api/*` a esta API.

## Arquitectura

```
ingest-scheduler (una vez al día, a las 9:00 de Madrid)
   └─ python -m app.ingest ──► fuentes (BDNS, BOE, UE, BOCM, DOG, FB, RSC)
            │  una transacción por ejecución
            ▼
   Postgres 16: opportunities · opportunity_changes · ingest_runs · source_runs · fetch_cache · bdns_editions
                users · sessions · invitations · password_resets · tracking · tracking_notes · org_settings ·
                votes · ingest_requests · personal_tokens
            ▲  lectura / escritura del equipo
   API FastAPI (/api/oportunidades, /api/fuentes, /api/perfil, /api/analyze-pdf, /api/auth, /api/board, …, /mcp)
            ▲  rewrite /api/* (next.config.ts, API_URL)
   Next.js ──► navegador
```

- La ingesta guarda el ítem **base**; el encaje geográfico y por tipo y el orden se aplican al leer, así un cambio
  de ranking no exige reingestar.
- Una fuente que falla no toca sus filas. Solo una fuente con estado `ok` marca como `gone_at` lo que ya no devuelve.
  Las filas de fuentes que ya no están registradas se marcan `gone_at` en la siguiente ingesta.
- La API nunca consulta las fuentes al responder: no hay `?refresh=1`. La web no tiene botón de recarga; el pie de
  la barra lateral dice de cuándo son los datos («Datos de hoy, 9:02»). Un administrador puede pedir una carga con
  «Actualizar ahora» en la vista Fuentes: la API solo la apunta en `ingest_requests` y la ejecuta `ingest-scheduler`.
- `ingestStale` (más de 36 h sin una ingesta correcta, es decir, una carga diaria perdida) hace que Inicio muestre
  «Los datos son de hace N h: la carga diaria no ha terminado bien desde entonces».
- Si Postgres no responde, la API devuelve 503. Si la API no responde, la web abre con la última lista guardada en
  el navegador y un aviso con la hora de esos datos; los cambios del equipo (tablero, votos, asignaciones) quedan
  desactivados con una explicación, y la web reintenta sola y recarga al volver el servidor. Sin copia guardada
  muestra un estado de error. La portada se pinta sin cifras.
- Esquema: migraciones de Alembic en `backend/alembic/` (la API las aplica al arrancar).
- `SCORING_VERSION` (`backend/app/scoring/__init__.py`, ahora 17) se guarda en cada `ingest_runs`; súbelo cuando
  cambie la puntuación.
- Historial BDNS: tras guardar la ingesta, un paso aparte busca ediciones anteriores de las convocatorias BDNS
  relevantes (cuándo suelen abrir, cuánto plazo dan) y quién las ganó (solo recuentos por tipo de entidad, nunca
  nombres de personas). Va en la tabla `bdns_editions` y la API lo añade como `history` a cada convocatoria. Suma
  puntos si Reforesta u ONG ambientales afines ganaron ediciones anteriores y avisa si casi nunca gana una entidad
  sin ánimo de lucro. Si falla o se agota su tiempo (`HISTORY_TIMEOUT_S`, 30 min), la ingesta sigue siendo
  correcta. Detalles en [backend/README.md](../backend/README.md).

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
| `ingest-scheduler` | — | Una ingesta al día a las `RADAR_INGEST_AT` (09:00, hora de Madrid). Comprueba cada 30 s: si el equipo estaba dormido a esa hora, ingesta al despertar; si la base nunca se ha ingestado, ingesta en el acto. Un fallo se reintenta a la hora. También ejecuta el «Actualizar ahora» que pide un administrador (en ~30 s). |

Los valores se cambian en un `.env` en la raíz (ver `.env.example`). Para el frontend en local con recarga en
caliente: `docker compose up -d postgres api` y `npm run dev` (usa `API_URL`, por defecto `http://localhost:8010`).

## Cuentas y equipo

La app (todo salvo la portada) exige iniciar sesión. Una sola organización, dos roles: `admin` (gestiona personas y
puede pedir una actualización de datos) y `member` (edita todo el tablero). No hay registro abierto: se entra solo
por invitación. Contrato completo para la web: [api-auth.md](api-auth.md).

```bash
# Primer administrador (nunca desde la web). Pide la contraseña dos veces; sin terminal, o con --generate,
# genera una y la muestra una sola vez.
docker compose run --rm api python -m app.users create-admin ana@example.org --name Ana
```

- **Crea al menos dos administradores.** Si el único admin olvida su contraseña, otro admin le genera un enlace de
  restablecimiento; sin ninguno, solo queda crear otro con el comando de arriba.
- Arranque desatendido (opcional): `RADAR_BOOTSTRAP_ADMIN_EMAIL` y `RADAR_BOOTSTRAP_ADMIN_PASSWORD` en el `.env`
  crean el primer admin al arrancar la API, solo si la tabla `users` está vacía. Quítalos después.
- Invitaciones y restablecimientos: un admin genera el enlace (`RADAR_PUBLIC_URL/invitacion/…`, 7 días;
  `…/restablecer/…`, 24 h; un solo uso) y lo envía él mismo. Con `SMTP_HOST` y `SMTP_FROM` configurados, la API
  además lo manda por correo y se activa «¿Olvidaste la contraseña?».
- Seguridad: contraseñas Argon2id (mínimo 10 caracteres); sesión en cookie `HttpOnly` + `SameSite=Lax` (con
  `RADAR_COOKIE_SECURE=true` detrás de https), caduca a los 30 días sin uso y se revoca al cerrar sesión, cambiar
  la contraseña o el rol, o desactivar la cuenta; en la base solo hay hashes de los tokens. Las peticiones que
  cambian datos llevan la cabecera `X-Radar-CSRF: 1` y se rechazan si el navegador dice que vienen de otro sitio.
  Inicio de sesión limitado: 50 fallos por cuenta cada 15 min como tope duro; por cuenta e IP, 5 (a partir de ahí
  se responde «espera» a las contraseñas incorrectas, pero la correcta sigue entrando). Cuerpos de más de 1 MiB
  (16 MiB para PDF) se rechazan antes de mirar la sesión; Argon2 se ejecuta como mucho 2 a la vez.
- Estado compartido en Postgres: tablero de seguimiento (`tracking`, `tracking_notes`; sobrevive a que una
  convocatoria desaparezca de las fuentes), perfil y filtro de organismos del equipo (`org_settings`), votos
  «sirve / no sirve» (`votes`) y peticiones de actualización (`ingest_requests`). Lo que cada navegador tenía en
  `localStorage` se importa una vez al entrar sin pisar lo que el equipo ya guardó.

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
la ingesta programada es el servicio `ingest-scheduler` (`backend/app/ingest/scheduler.py`).

## Antes de publicarlo en internet

Publicado en <https://reforesta-radar.miguelddev.com> con `docker-compose.prod.yml` y `deploy/Caddyfile`
([despliegue.md](despliegue.md), ADR 0037). Marcado lo que ese despliegue ya resuelve:

- [x] Proxy inverso con https delante de `web` que **sobrescribe** `X-Forwarded-For`: Caddy (no confía en ningún
      proxy, así que pone la IP del que conecta). `FORWARDED_ALLOW_IPS` = la subred fija de compose
      (`RADAR_NET_SUBNET`, `172.28.89.0/24`). Comprobado: la API registra la IP pública del cliente, no la de `web`, y
      un `X-Forwarded-For` falso no pasa.
- [x] `web` no es alcanzable sin pasar por Caddy: en producción solo Caddy publica puertos (80 y 443).
- [x] Tiempos máximos en el proxy (cabeceras 10 s, cuerpo 2 min) y el log no registra `Authorization`, cookies,
      `Referer` ni cadenas de consulta.
- [ ] Opcional: caché corta en el proxy para `GET /api/public/oportunidades` (no hecho; la API ya manda
      `Cache-Control: public, max-age=60`).
- [x] Límite de cuerpo también en el proxy: 1 MiB, 16 MiB en `/api/analyze-pdf`.
- [x] `RADAR_COOKIE_SECURE=true` y `RADAR_PUBLIC_URL=https://<RADAR_DOMAIN>` (los pone `docker-compose.prod.yml`).
- [x] El puerto de la API sin publicar en producción (ni el de Postgres).
- [x] El log del proxy no guarda los tokens de `/invitacion/*` ni `/restablecer/*` (los sustituye por `REDACTED`).
- [ ] Quitar `RADAR_BOOTSTRAP_ADMIN_EMAIL` / `_PASSWORD` del `.env` tras el primer arranque (en producción no se
      usan: el primer admin se crea con `python -m app.users`); al menos dos admins.
- [ ] Valorar una vida máxima absoluta de la sesión (hoy: 30 días desde el último uso, sin tope absoluto).
- [x] Copias de seguridad diarias de Postgres (`deploy/backup.sh`, 14 días). Pendiente: copia fuera del servidor.
- [x] Servidor MCP e inicio de sesión desde el agente de IA: ver la lista de
      [mcp.md](mcp.md#antes-de-publicarlo-en-internet). El emisor OAuth es exactamente
      `https://reforesta-radar.miguelddev.com` (comprobado).

## Riesgos conocidos

| Riesgo | Salvaguarda |
|---|---|
| Copias de Postgres en el mismo disco que la base | En producción, copia diaria con `deploy/backup.sh` (14 días, [despliegue.md](despliegue.md#copias-de-seguridad-y-restauración)); falta una copia fuera del servidor. En local: [mantenimiento.md](mantenimiento.md#copias-de-seguridad). |
| Equipo apagado o dormido a las 9:00 | `ingest-scheduler` comprueba cada 30 s e ingesta al despertar si no hubo ninguna ingesta correcta desde las 9:00. |
| Una fuente cambia su HTML | Se registra en `source_runs`; sus filas anteriores siguen visibles y la fuente sale como parcial o error. |
| IP del cliente poco fiable | Next reenvía el `X-Forwarded-For` que manda el navegador y no añade el suyo, así que la API no se lo cree (`FORWARDED_ALLOW_IPS=127.0.0.1` por defecto): todos los navegadores comparten la IP del contenedor `web`. Por eso una contraseña correcta nunca se rechaza por fallos ajenos (solo el tope de 50 fallos por cuenta bloquea a todos). Con un proxy inverso delante que sobrescriba `X-Forwarded-For`, poner en `FORWARDED_ALLOW_IPS` la red de compose (p. ej. `172.16.0.0/12`). En producción ya es así (Caddy, `docker-compose.prod.yml`). |

## Siguiente tramo

- «Nuevo desde tu última visita» (usa `first_seen_at` y `opportunity_changes`).
- Alertas (correo) para oportunidades nuevas de encaje alto o plazos que cierran.
