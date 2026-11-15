# 0044. Despliegue sin corte: la versión nueva de `api` y `web` arranca antes de parar la vieja

- Estado: Aceptada
- Fecha: 2026-11-15 (rama `feat/despliegue-sin-corte`)
- Sustituye en parte a: [0039](0039-despliegue-con-dokploy.md), solo el comando de la app en Dokploy
  (`… up -d --build`); el resto de 0039 sigue vigente.

## Contexto
Con el comando de ADR 0039, `docker compose up -d --build` para cada contenedor cambiado y crea otro. Medido en
producción el 2026-11-15 (una sonda cada medio segundo a `/landing`, `/login` y `/api/public/oportunidades`; en una
copia de la pila con las imágenes de producción, 10 por segundo): Traefik respondía 404 mientras no había `web`, y la
API daba 500 y peticiones colgadas 5 s mientras se recreaba `api` (12-14 s en total; 42 de 179 peticiones fallidas en
la copia). El responsable quiere que un despliegue no devuelva errores a los visitantes. Restricciones: seguir
desplegando el commit exacto por la ruta de ADR 0039 (CI, `reforesta-radar-deploy`, vuelta atrás automática), Dokploy
gestionando la app y el panel usable, `postgres` sin reinicios, nunca dos `ingest-scheduler`, migraciones seguras con
dos versiones de la API a la vez, la misma configuración de seguridad de Traefik.

## Decisión
- **Arrancar antes de parar, con Compose.** `deploy/deploy.sh` pone en la app de Dokploy (API `compose.update`, solo
  si difiere) un comando de cuatro `docker compose` encadenados con `&&` (lo único que Dokploy admite):
  `build`; `up -d --no-recreate --wait` (crea lo que falte); `up -d --no-recreate --scale api=2 --scale web=2 --wait
  api web` (un segundo contenedor de cada uno con las imágenes nuevas, hasta que esté sano); `up -d --remove-orphans`
  (vuelve a uno de cada; Compose quita primero el desfasado, y recrea `ingest-scheduler` parando el viejo antes). El
  botón «Rebuild» del panel usa el mismo comando.
- **`web` se retira en dos tiempos** (`scripts/web-start.sh`, `RADAR_DRAIN_SECONDS=6`): tras SIGTERM sigue sirviendo
  3 s (Traefik añade el nuevo al recibir su `health_status`), luego `/healthz` (`src/app/healthz/route.ts`) responde
  503 y el health check de Traefik sobre el servicio (cada segundo) deja de mandarle peticiones; 3 s después Next se
  cierra. Además, el middleware `retry` de Traefik (3 intentos) repite en el otro `web` una conexión rechazada.
- **`api`**: el nombre `api` resuelve a los dos contenedores mientras conviven; uvicorn, al parar, deja de aceptar y
  acaba lo que tiene (`stop_grace_period: 30s`). Healthchecks con `start_interval: 2s` para que la versión nueva entre
  en segundos.
- **Migraciones.** Las aplica la API nueva antes de escuchar, una vez, mientras la vieja sigue sirviendo. Regla: toda
  migración es compatible con la versión anterior (añadir sí; borrar, renombrar o `NOT NULL` sin valor por defecto, en
  dos despliegues). Detalle en [despliegue.md](../despliegue.md#despliegue-sin-corte).
- **Vuelta atrás.** Si la versión nueva no llega a sana, el paso 3 falla con las viejas intactas; `deploy.sh` quita los
  contenedores nuevos no sanos (`drop_unready`) y despliega el commit anterior con el mismo comando.
- **Vigilancia.** `deploy/probe.sh` corre desde GitHub Actions durante cada despliegue; cualquier respuesta que no sea
  2xx/3xx sale como aviso en el run.

## Consecuencias
- Medido en producción con sondas desde fuera y desde el propio servidor: 0 respuestas fallidas en dos despliegues
  con imágenes nuevas de `web` y `api` (753 y 323 peticiones), uno sin cambios (327) y la prueba de vuelta atrás (un
  `web` con el healthcheck roto: 1.455 peticiones, las viejas sirvieron todo el rato, salida con error en 3,5 min).
- **Cambiar una etiqueta `traefik.*` de `web` corta ~6 s (404)** en ese despliegue: con los dos `web` vivos, Traefik ve
  el router definido dos veces de forma distinta y lo descarta. Pasó dos veces al introducir este cambio. Pendiente
  si llega a molestar: mover routers y middlewares al proveedor de ficheros.
- Una API nueva que escucha pero responde mal recibe parte del tráfico hasta la vuelta atrás (Docker la añade al
  nombre `api` al arrancar, sana o no); su healthcheck solo mira `/health`.
- Cambiar `postgres` sigue cortando. Una carga diaria en curso se interrumpe si coincide con un despliegue (como antes).
- Los contenedores de `api` y `web` cambian de número en cada despliegue (`<app>-api-7`); los comandos de la guía los
  buscan por la etiqueta de servicio. Unos segundos hay dos de cada (memoria: ~200 MB más de uso real).
- Un `web` roto tarda ~105 s en contar como «unhealthy» (antes ~95 s). Cada despliegue tarda unos segundos más: espera
  a que la versión nueva esté sana antes de quitar la vieja, y 6 s de drenaje.
- Solo el primer comando de la cadena corre con `env -i` en Dokploy: los demás heredan el entorno del contenedor de
  Dokploy, que hoy no tiene ninguna variable que use nuestro compose (comprobado en v0.31.2). Revisar al subir Dokploy.
- `/healthz` es público (responde `ok`); no da información.

## Alternativas consideradas
- Solo el middleware `retry` o solo health checks de Traefik, sin solapar contenedores: no cubren los segundos sin
  ningún `web` ni la API recreándose.
- Solapar sin el 503 de `/healthz` (solo esperar tras SIGTERM): probado en producción; Traefik seguía usando las
  conexiones abiertas con el `web` viejo, Next no podía cerrar hasta que Docker lo mataba a los 30 s y Traefik marcaba
  después su dirección ya borrada: 502 y peticiones colgadas 10 s.
- Hacer el relevo en `deploy.sh` fuera de Dokploy: el botón «Rebuild» seguiría cortando y Dokploy no registraría el
  despliegue.
- `docker rollout` (complemento de la CLI de Docker): hace lo mismo con `--scale`, pero habría que instalarlo dentro del
  contenedor de Dokploy (donde corre el comando) y Dokploy solo admite `docker compose` en el comando.
- App de tipo «stack» (Swarm, `update_config.order: start-first`): `docker stack deploy` no construye imágenes (haría
  falta un registro), cambia redes (overlay), nombres de volumen (migrar la base) y de contenedor (`deploy.sh`, copias),
  e ignora `depends_on`. Mucho más cambio que el problema.
- Sacar a `api` de la red antes de pararla: corta las peticiones en curso y deja conexiones colgadas.
