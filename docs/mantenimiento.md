# Mantenimiento

Para quien herede el radar. El radar funciona solo día a día: carga las fuentes cada mañana y, si una falla, sigue
enseñando sus últimos datos buenos. Pero no se mantiene solo. Hace falta **una persona técnica una hora al mes,
más o menos**, que sepa usar una terminal, Docker y git y leer algo de Python. Esa hora se va en:

| Tarea | Cada cuánto | Tiempo aproximado | ¿Técnica? |
|---|---|---|---|
| Mirar la vista Fuentes y los logs de la carga | Semanal (5 min) o mensual | 10 min | En parte |
| Volver a comprobar los programas de empresas | Mensual, y al cerrar o abrir una edición | 30 min | Sí (editar código) |
| Hacer y comprobar una copia de seguridad | Semanal (automatizable) / comprobar al mes | 5 min | Sí |
| Revisar «Ajuste de notas» con el equipo | Mensual | 15 min | No (cambiar reglas, sí) |
| Actualizar dependencias | Trimestral | 1–2 h | Sí |
| Altas y bajas de personas | Cuando haga falta | 2 min | No |

Los comandos de este documento se ejecutan en la carpeta del repositorio, con el radar arrancado
(`docker compose up -d`).

## Si nadie lo mantiene, qué se estropea primero

1. **Programas de empresas** (semanas). Las fechas son las de la última edición comprobada. Cuando una edición cierra
   pasa a «próxima edición»; cuando abre una nueva, el radar no se entera. A los 180 días de la última comprobación,
   Fuentes avisa «Lista comprobada hace N meses: toca revisarla» y cada programa lleva un aviso igual.
2. **Fuentes leídas en HTML** (meses). DOG y Fundación Biodiversidad se leen de la web; si cambian su diseño, la
   fuente sale como «Error» o «Parcial» en Fuentes y sus convocatorias se quedan congeladas en la última carga buena.
   BOE, BOCM, BDNS y la UE usan APIs o XML oficiales, más estables, pero también pueden cambiar.
3. **Dependencias** (meses o años). Sin actualizar, se acumulan fallos de seguridad conocidos. Las imágenes base
   están fijadas a una versión concreta (`python:3.13.18-slim`, `node:22.23.5-alpine`, `postgres:16.16-alpine`):
   reconstruir no trae versiones nuevas, pero tampoco sus parches de seguridad hasta que alguien las suba (ver
   [Actualizar dependencias](#actualizar-dependencias)). Node 22 deja de tener soporte en abril de 2027.
4. **La nota** se queda con las palabras de hoy. Si cambia cómo se redactan las convocatorias o el equipo cambia de
   prioridades, la lista se ordena peor poco a poco. La vista Perfil lo amortigua sin tocar código.
5. **Sin copias de seguridad**, un disco roto o un `docker compose down -v` por error borran cuentas, tablero, notas y
   votos. Los datos de las fuentes se recuperan con una carga nueva; el trabajo del equipo, no.

## Programas de empresas (RSC)

- **Dónde está la lista:** `backend/app/sources/rsc.py`, tupla `RSC_PROGRAMMES` (hoy seis: Fundación Unicaja,
  Fundación Ibercaja, BBVA Asset Management, Fundación Endesa, Fundación BBVA y PreZero). Es la única copia: la web la
  lee de la API.
- **Fecha de comprobación:** la constante `VERIFIED_ON` (`"2026-11-15"`), una para toda la lista y la única que hay
  que cambiar. La app la enseña como «Comprobado el…» en Empresas y en cada ficha, el servidor MCP como `verifiedOn`
  y la nota de Fuentes la toma de ahí. Pasados 180 días (`STALE_AFTER_DAYS`) sin cambiarla, Fuentes marca la lista
  como parcial y cada programa avisa de que sus datos pueden haber cambiado.
- **Territorio:** si la entidad limita dónde se hace el proyecto, ponlo en `territory` (sale como territorio del
  programa) y añade un `Limit` que lo explique; sin `territory`, el programa sale como «Estatal».
- **Cómo revisarla:**
  1. Para cada programa, abre `url` y `bases_url` y compara con `opens_at`, `deadline`, `window`, `amount`,
     `beneficiarios`, `requirements`, `territory` y `limits`. Copia los importes y fechas tal como se publican.
  2. Si abrió una edición nueva, cambia `opens_at`, `deadline` y `window` (el estado abierta/cerrada sale de esas
     fechas). Si lo que no se pudo comprobar cambia, actualiza `unverified`.
  3. Si un programa desaparece, quítalo; para añadir uno, copia la estructura de otro.
  4. Cambia `VERIFIED_ON` a la fecha de la revisión.
  5. Comprueba y aplica:

     ```bash
     cd backend && uv run pytest tests/test_sources.py && cd ..   # los tests de RSC; ajústalos si cambiaste datos que comprueban
     docker compose up -d --build                                 # reconstruye con la lista nueva
     docker compose run --rm ingest --source rsc                  # la carga en segundos
     ```

## Salud de las fuentes

- **En la app:** vista **Fuentes**. Cada fuente sale como «Correcta», «Sin novedades» (funciona pero hoy no aportó
  nada; normal en DOG o BOCM), «Parcial» (parte de las peticiones falló) o «Error» (no respondió o se agotó su tiempo,
  8 minutos por fuente), con una nota de lo que se leyó. Arriba, la hora de la última carga. Si pasan más de 36 h sin
  una carga correcta, Inicio enseña «Los datos son de hace N h…».
- **En los logs:**

  ```bash
  docker compose logs --tail 100 ingest-scheduler
  ```

  Al empezar, la carga escribe `[ingest] leyendo 7 fuentes…`; cada fuente avisa al terminar
  (`[ingest] boe: 5 convocatorias en 3 s (ok)`) y la BDNS, la más lenta (un par de minutos), cuenta las fichas leídas
  cada 15 s. Mientras dura, la API responde `ingest.running: true`. Al final deja una tabla por fuente (`status`,
  `items`, `new`, `chg`, `same`, `gone`, `secs`) y termina con
  `ingest finished with exit code N` (0 = bien; 1 = fallaron todas las fuentes o la escritura). Una fuente que falla
  sale con `status error` y su motivo, por ejemplo «Sin respuesta en 480 s» o «Error: …». Los logs de Docker se
  pierden al borrar el contenedor (`docker compose down`); el historial queda en la base:

  ```bash
  docker compose exec postgres psql -U radar -d radar -c \
    "select r.id, r.started_at, r.status, s.source_id, s.status, s.count, s.error
       from ingest_runs r join source_runs s on s.run_id = r.id
      order by r.id desc, s.source_id limit 21"
  ```

- **Probar una fuente sin escribir nada:** `docker compose run --rm ingest --source dog --dry-run`.
- **Qué hacer con una fuente rota:** arreglar su conector en `backend/app/sources/<id>.py` (pasos y tests en
  [backend/README.md](../backend/README.md#how-to-add-a-source-step-by-step)). Mientras falle, sus convocatorias
  anteriores se siguen viendo.
- **Desactivar una fuente sin tocar código:** en el `.env`, `RADAR_DISABLED_SOURCES=dog,bocm` (ids separados por
  comas: `bdns`, `boe`, `eu`, `bocm`, `dog`, `fb`, `rsc`) y `docker compose up -d` para aplicarlo. La carga diaria se
  la salta, sus convocatorias **dejan de mostrarse** (en la web y en el agente de IA, por MCP) y Fuentes la enseña como
  «Desactivada». Sus datos **no se borran**: siguen en la base y vuelven a verse en cuanto se quita de la lista (la
  carga siguiente los pone al día). El tablero conserva las que el equipo seguía. Se eligió ocultar en vez de seguir
  enseñando sus últimos datos porque se desactiva una fuente cuando no se quiere ver; si solo está rota, no hace falta
  desactivarla (ya se ven sus últimos datos buenos con el aviso de error). Un id desconocido se ignora con un aviso
  en el log. Para quitar una fuente del todo, bórrala del diccionario `SOURCES` en `backend/app/sources/__init__.py`.
- **Cargar ahora:** un administrador pulsa «Actualizar ahora» en Fuentes (empieza en menos de 30 s), o desde la
  terminal `docker compose run --rm ingest`.

## Ajustar la nota

Hay tres niveles, de menos a más técnico:

1. **Vista Perfil (cualquier persona del equipo, sin tocar código).** Palabras que suman, términos que excluyen,
   prioridad por línea de trabajo y por territorio, tipos que interesan e importe mínimo. Se aplica al leer, para
   todo el equipo, y la ficha de cada convocatoria dice qué parte de la nota viene del Perfil.
2. **Revisar «Ajuste de notas» (administración, mensual).** En **Equipo → Ajuste de notas** salen las convocatorias
   donde los votos del equipo y la nota no coinciden: «Os sirve, pero tiene nota baja» (votada «sirve» con menos de 40)
   y «No os sirve, pero tiene nota alta» (votada «no sirve» con 60 o más). Los votos no cambian la nota solos
   ([ADR 0018](adr/0018-votos-sirve-no-sirve.md)). Con el equipo, mirad los motivos de cada caso: si se repite un
   patrón, se corrige en el Perfil o, si es general, en las reglas.
3. **Cambiar las reglas (técnico).** Las tablas de palabras, excluyentes, territorio y tipos están en
   `backend/app/scoring/profile.py`; la lógica, en `score.py`, `rank.py` y `history.py` de la misma carpeta. Al
   cambiarlas:
   - Fallarán a propósito los tests de paridad (`tests/test_parity_functions.py`, `tests/test_parity_golden.py`),
     que congelan la nota de la versión anterior: actualiza las expectativas afectadas (ver
     [backend/README.md](../backend/README.md#scoring-parity-with-the-typescript)).
   - Sube `SCORING_VERSION` en `backend/app/scoring/__init__.py` (hoy 17).
   - Si cambias el territorio (`GeoFit`), cambia igual `GEO_FIT` en `src/lib/reforesta-profile.ts`: la vista Perfil
     de la web lo usa para sus ajustes por territorio. `tests/test_geo_fit_web_copy.py` falla si no coinciden.
   - Si cambia el comportamiento, escribe un ADR ([docs/adr/README.md](adr/README.md)).
   - `uv run pytest` en `backend/`, `docker compose up -d --build` y `docker compose run --rm ingest` para
     repuntuar.

## Copias de seguridad

En producción hay una copia diaria automática y la restauración está probada: ver
[despliegue.md](despliegue.md#copias-de-seguridad-y-restauración). En una instalación local no hay copias automáticas. Todo lo que no se recupera con una carga nueva (cuentas, tablero, notas, votos, Perfil)
está en Postgres, en el volumen de Docker `reforesta-radar_radar-pgdata`.

**Hacer una copia** (no hace falta parar nada):

```bash
mkdir -p ~/radar-backups
docker compose exec -T postgres pg_dump -U radar -d radar -Fc > ~/radar-backups/radar-$(date +%F).dump
```

Fuera de la carpeta del repositorio a propósito: dentro acabaría en git o en la imagen de la web. Lleva una copia a
otro sitio (otro disco o la nube de la organización): contiene correos y nombres del equipo y sus notas. Para hacerla
cada día, una línea de `cron` con `cd` a la carpeta del repositorio y ese comando.

**Restaurar** (sustituye todo lo que hay en la base por la copia):

```bash
docker compose stop web api ingest-scheduler
docker compose exec -T postgres pg_restore -U radar -d radar --clean --if-exists --no-owner < ~/radar-backups/radar-AAAA-MM-DD.dump
docker compose start api ingest-scheduler web
```

**Comprobar una copia** sin tocar la base buena: restaurarla en una base aparte y contar filas.

```bash
docker compose exec postgres createdb -U radar radar_check
docker compose exec -T postgres pg_restore -U radar -d radar_check --no-owner < ~/radar-backups/radar-AAAA-MM-DD.dump
docker compose exec postgres psql -U radar -d radar_check -c "select count(*) from users; select count(*) from tracking;"
docker compose exec postgres dropdb -U radar radar_check
```

En una máquina nueva: `docker compose up -d --build`, esperar a que `api` esté `healthy` (crea las tablas) y
restaurar como arriba.

## Actualizar dependencias

Cada tres meses, en una rama aparte:

```bash
# Backend (Python, con uv: https://docs.astral.sh/uv/)
cd backend
uv lock --upgrade && uv sync
uv run ruff check && uv run pytest     # los tests de base de datos usan el Postgres de compose en :5440
cd ..

# Frontend (Node.js 20.9 o superior)
npm outdated
npm update                             # dentro de los rangos de package.json; los saltos de versión mayor, uno a uno
npm run lint && npm run build

# Imágenes y prueba completa (tras subir las versiones fijadas, ver abajo)
docker compose up -d --build
docker compose run --rm ingest         # comprobar que todas las fuentes siguen en «ok»
```

- **Imágenes base fijadas.** Están en tres sitios: `FROM python:…` en `backend/Dockerfile`, `FROM node:…` en
  `Dockerfile` e `image: postgres:…` en `docker-compose.yml`. En producción, además, `image: caddy:…` en
  `docker-compose.prod.yml` (`docker run --rm caddy:2-alpine caddy version` da la última 2.x). Para subirlas, mira la última versión de la misma
  rama (por ejemplo `docker pull python:3.13-slim && docker run --rm python:3.13-slim python -V`, igual con
  `node:22-alpine` y `node -v`, y `postgres:16-alpine` con `postgres -V`), escribe ese número en los tres sitios,
  reconstruye y pasa la prueba completa de arriba. Dentro de la misma versión mayor de Postgres (16.x) basta con
  cambiar la etiqueta: los datos del volumen sirven tal cual.
- **Nombre de las imágenes.** Las imágenes propias se llaman `<proyecto>-backend:dev` y `<proyecto>-web:dev`
  (`reforesta-radar` por defecto). Una segunda copia del radar arrancada con otro nombre de proyecto
  (`docker compose -p prueba up -d --build`, por ejemplo para probar una instalación limpia) construye las suyas y no
  pisa las del radar en marcha. Usa también otros puertos (`RADAR_WEB_PORT`, `RADAR_API_PORT`, `RADAR_DB_PORT`).

- `next` está fijado a una versión exacta (`16.4.6`), igual que `react` y `mcp` (Python); súbelos a mano leyendo sus
  notas de versión. El aviso de `AGENTS.md` sobre Next.js 16 sigue valiendo.
- Cambiar de versión mayor de Postgres (de 16 a 17) no se hace con `pull`: copia de seguridad, `docker compose down
  -v`, cambiar la imagen en `docker-compose.yml`, arrancar y restaurar.

## Accesos

- **Altas:** **Equipo → Invitar** (enlace de un solo uso, 7 días). Mantened siempre al menos dos administradores.
- **Bajas:** **Equipo → Personas → desactivar**. Cierra sus sesiones al momento, invalida sus tokens del agente de IA
  (MCP) y las invitaciones y enlaces que había creado. No se borra a nadie: sus notas siguen firmadas.
- **Contraseña olvidada:** un administrador genera un enlace de restablecimiento en Equipo (24 h). Sin ningún
  administrador: `docker compose run --rm api python -m app.users create-admin <correo>` con otro correo.
- **Tokens del agente de IA (MCP):** cada persona ve y revoca los suyos en **Mi cuenta**. Caducan solos (30 días a 1 año)
  y se revocan al cambiar la contraseña o el rol.
- **Cerrar todas las sesiones y revocar todos los tokens** (si se sospecha una filtración):

  ```bash
  docker compose exec postgres psql -U radar -d radar -c \
    "delete from sessions; update personal_tokens set revoked_at = now() where revoked_at is null;"
  ```

- **Contraseña de Postgres:** `RADAR_DB_PASSWORD` solo se aplica al crear el volumen. Para cambiarla después:

  ```bash
  docker compose exec postgres psql -U radar -d radar -c "alter user radar password 'NUEVA'"
  # poner RADAR_DB_PASSWORD=NUEVA en .env y luego:
  docker compose up -d
  ```

  Cambiar solo el `.env` deja la API sin poder conectarse.
- **Correo (`SMTP_*`):** si se configura, rota la contraseña del buzón donde la gestione el proveedor y cámbiala en
  `.env` (`docker compose up -d` para aplicarla).

## Lo que no se ha podido comprobar

- Los tiempos de este documento son estimaciones de quien lo escribió, no medidas con un equipo real.
- No se ha probado una subida de versión mayor de Postgres ni de Next.js.
- El aviso de fin de soporte de Node 22 (abril de 2027) es el calendario publicado de Node.js; compruébalo.
