# Despliegue

Cómo está publicado el radar, cómo se actualiza y qué hacer cuando algo va mal. Para quien llega por primera vez:
no hace falta saber nada del servidor, solo tener acceso SSH a él. Las decisiones y sus contrapartidas están en
[ADR 0039](adr/0039-despliegue-con-dokploy.md) (Dokploy), que sustituye a la 0037 (Caddy).

**Producción hoy:** <https://reforesta-radar.miguelddev.com> (servidor MCP del equipo:
`https://reforesta-radar.miguelddev.com/mcp/equipo`). En los ejemplos genéricos de abajo el dominio aparece como
`radar.example.org` y el nombre de la app de Dokploy como `<app>` (hoy `reforesta-radar-prod-fb9o1w`).

## Qué hay y dónde

```
Internet ──▶ cortafuegos de Oracle (lista de seguridad de la VCN: 22, 80, 443)
         ──▶ cortafuegos del servidor (iptables INPUT: 22, 80, 443; DOCKER-USER: hacia contenedores solo 80, 443)
         ──▶ Traefik de Dokploy :80/:443 (https de Let's Encrypt, http → https, HSTS)
         ──▶ web :3000 (Next.js; reenvía /api/*, /mcp*, /oauth/*, /.well-known/oauth-* a la API)
         ──▶ api :8000 (FastAPI) ──▶ postgres :5432
             ingest-scheduler (carga diaria a las 9:00, hora de Madrid)
Panel de Dokploy :3000 ── desde el propio servidor (túnel SSH), y por Traefik :443 solo para
                          panel.miguelddev.com (ADR 0043)
```

Traefik solo ve `web`, por la red `reforesta-radar-edge`. `api` y `postgres` solo son alcanzables dentro de la red
del proyecto. Ningún servicio del radar publica puertos.

| Qué | Dónde |
|---|---|
| Servidor | Oracle Cloud Always Free, Frankfurt, una VM Ampere A1 (ARM, 2 OCPU, 12 GB, disco de 48 GB), Ubuntu 24.04, hora del sistema en UTC |
| Acceso | `ssh ubuntu@<IP>` con la clave del responsable (usuario con `sudo`) |
| Dokploy | v0.31.2 (servicios de Swarm `dokploy` y `dokploy-postgres`, contenedor `dokploy-traefik`); datos en `/etc/dokploy` y en los volúmenes `dokploy` y `dokploy-postgres` |
| La app | Proyecto «Reforesta Radar» → app compose «Radar» (`<app>`). Su copia del repositorio: `/etc/dokploy/compose/<app>/code` (solo root: lo protege `/etc/dokploy/compose` en modo 700, que pone `setup-server.sh` y Dokploy no cambia; el `code/.env` que Dokploy reescribe en cada despliegue queda en 644 dentro) |
| Ficheros de compose | `docker-compose.yml` + `docker-compose.prod.yml` (comando propio de la app, abajo) |
| Secretos | En el entorno de la app en Dokploy (`RADAR_DOMAIN`, `RADAR_DB_PASSWORD` y, opcional, `GEMINI_API_KEY`), que Dokploy escribe en `code/.env` al desplegar. Nunca en git |
| Configuración del servidor | `/etc/reforesta-radar/deploy.env` (app, id, dominio, rama; sin secretos), `/etc/reforesta-radar/dokploy-api-key` (600), `/etc/reforesta-radar/backup.env` (600, opcional) |
| Proxy | Traefik: `deploy/traefik.yml` → `/etc/dokploy/traefik/traefik.yml`; certificados en `/etc/dokploy/traefik/dynamic/acme.json`; rutas del radar en las etiquetas de `web` (`docker-compose.prod.yml`) |
| Base de datos | volumen `<app>_radar-pgdata` |
| Copias | `/var/backups/reforesta-radar/radar-<fecha UTC>.dump` (14 días), temporizador `reforesta-radar-backup.timer` (03:30 UTC); copia fuera opcional |
| Scripts (instalados por `setup-server.sh` en `/usr/local/sbin`) | `reforesta-radar-deploy` (`deploy/deploy.sh`), `reforesta-radar-ci-deploy` (`deploy/ci-deploy.sh`), `reforesta-radar-backup` (`deploy/backup.sh`), `docker-user-firewall` |
| Clon del repositorio para administrar | `/opt/reforesta-radar` (de root): de aquí salen los scripts y `setup-server.sh` |

**Usuarios del servidor.** `ubuntu` es la cuenta de administración (tiene `sudo`). `deploy` es un usuario sin
contraseña, sin grupo `docker` y con una sola regla de `sudo`: ejecutar `reforesta-radar-deploy`. Su única clave SSH
es la de GitHub Actions, que solo puede pedir `deploy <commit>`. Los comandos de abajo se lanzan como `ubuntu` con
`sudo`.

**Correo.** No hay SMTP configurado: los administradores copian el enlace de invitación o de restablecimiento en
**Equipo** y lo mandan ellos. «He olvidado mi contraseña» no aparece.

## El panel de Dokploy

Hoy el panel está publicado en <https://panel.miguelddev.com>, con 2FA obligatorio
([abajo](#el-panel-con-dominio-panelmiguelddevcom)). Su puerto 3000 sigue cerrado desde internet (Oracle y
`DOCKER-USER`), y `setup-server.sh` quita la ruta que Dokploy crea en Traefik para `Host: dokploy.docker.localhost`.
El túnel funciona siempre, publicado o no: es la entrada de emergencia. Para entrar por él, desde tu ordenador:

```bash
ssh -i ~/.ssh/oracle-reforesta.key -N -L 3300:127.0.0.1:3000 ubuntu@130.61.182.106
```

y abre <http://localhost:3300> (el 3000 local lo usa `npm run dev`). Cierra el túnel con Ctrl+C al acabar.

- **Cuenta.** Hay una, de administrador, con el correo del responsable. Su contraseña inicial está en
  `/root/dokploy-admin-initial-password` (solo root): `ssh … 'sudo cat /root/dokploy-admin-initial-password'`. Al
  entrar: **Settings → Profile**, cambia la contraseña y activa **2FA**; después borra el fichero
  (`sudo rm /root/dokploy-admin-initial-password`).
- **Qué no tocar.** El botón **Deploy** de la app clona la cabeza de la rama sin pasar por CI: no lo uses (usa
  **Actions → Deploy → Run workflow**). No actives **Auto Deploy** ni los webhooks. No le pongas dominios a la app
  (el enrutado está en `docker-compose.prod.yml`). No actives **Isolated Deployments**. **Requests** activa el log de
  accesos de Traefik, que guarda las rutas con su cadena de consulta (`/autorizar?solicitud=…`): déjalo apagado.
  Cambiar en **Settings → Web Server** el correo de Let's Encrypt o los puertos de Traefik reescribe
  `/etc/dokploy/traefik/traefik.yml`: después vuelve a ejecutar `setup-server.sh` (o compáralo con
  `deploy/traefik.yml`). Deja vacío **Server Domain**: reescribe `dokploy.yml` con una segunda ruta al panel, sin los
  límites ni las cabeceras de la nuestra.
- **Clave de API.** `reforesta-radar-deploy` (perfil → API/CLI), sin límite de peticiones (la que se crea sin tocar
  nada admite 10 al día). Copia solo en `/etc/reforesta-radar/dokploy-api-key`. Si la regeneras, escríbela ahí:
  `sudo bash -c 'umask 077; read -rs -p "clave: " k; echo; printf "%s\n" "$k" > /etc/reforesta-radar/dokploy-api-key'`.
- **Telemetría.** Dokploy autoalojado no manda analítica: PostHog, Google Tag Manager, HubSpot y OpenPanel solo se
  cargan en su versión en la nube (`IS_CLOUD`, comprobado en el código de v0.31.2). Al crear la primera cuenta pide
  la IP pública del servidor a `ifconfig.io` (o `icanhazip.com`, `ipecho.net`). Traefik tiene `sendAnonymousUsage: false`.

### El panel con dominio (`panel.miguelddev.com`)

[ADR 0043](adr/0043-panel-de-dokploy-con-dominio-publico.md) (publicado el 2026-11-15). Más cómodo (entra desde el móvil), pero
**el panel equivale a root en la máquina** (controla Docker): quien entre controla el servidor y todos los proyectos.
Un interruptor en el servidor, `reforesta-panel` (`deploy/panel.sh`, instalado por `setup-server.sh`):

```bash
sudo reforesta-panel status    # público o privado, y cuántas cuentas del panel tienen 2FA
sudo reforesta-panel public    # publica; se niega si alguna cuenta del panel no tiene 2FA
sudo reforesta-panel private   # vuelve a solo túnel, en segundos
```

`public` copia `deploy/traefik-panel.yml` (del clon `/opt/reforesta-radar`) a
`/etc/dokploy/traefik/dynamic/reforesta-panel.yml`; Traefik lo lee solo, sin reiniciar, y pide el certificado a
Let's Encrypt en segundos. `private` lo borra. El radar no se corta en ningún caso.

**Para publicarlo:**

1. DNS `A` `panel.miguelddev.com` → la IP, sin proxy (ya existe).
2. Por el túnel: **Settings → Profile → 2FA** en **todas** las cuentas del panel (hoy, una).
3. En el servidor: `cd /opt/reforesta-radar && sudo git pull` (si aún no tiene este cambio),
   `sudo ./deploy/setup-server.sh` (instala `reforesta-panel`) y `sudo reforesta-panel public`.
4. Desde fuera: `PANEL_URL=https://panel.miguelddev.com deploy/smoke.sh https://reforesta-radar.miguelddev.com`, y
   entra en el panel.

**Qué hace la ruta:** solo `Host: panel.miguelddev.com`, solo por https (en http, 301 a https); cualquier otro
nombre, la IP sola o `dokploy.docker.localhost` dan 404. Certificado del resolvedor `letsencrypt` de siempre (cuenta
sin correo). Límites por IP del cliente (la de la conexión, no `X-Forwarded-For`): 20 peticiones/s con ráfagas de
200 en todo el panel, y 5 por minuto con ráfagas de 10 en el inicio de sesión, los códigos 2FA, el registro y el
restablecimiento de contraseña; por encima, 429 hasta que pasa la ventana (12 s por petición en el inicio de
sesión). Cabeceras: HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `noindex`. El
registro de cuentas nuevas está cerrado (Dokploy solo lo admite sin propietario o con una invitación). Dokploy además
limita a 3 intentos cada 10 s por IP el inicio de sesión y los códigos 2FA, y bloquea la cuenta 15 minutos tras 10
códigos 2FA fallidos.

**Si te bloquea un 429:** espera; el límite del inicio de sesión se recupera en 12 s por intento, el general en
segundos. Si no puedes esperar, entra por el túnel (no pasa por Traefik).

**No** quites el puerto 3000 del servicio `dokploy` (`--publish-rm`): el túnel dejaría de servir y es la única entrada
si el dominio o Traefik fallan. Desde fuera sigue cerrado (`DOCKER-USER` y la lista de seguridad de Oracle).

## Cómo llega un cambio a producción (CI/CD)

1. Se abre un PR. **CI** (`.github/workflows/ci.yml`) pasa `ruff check`, `ruff format --check` y `pytest` del
   backend (con un Postgres 16 de usar y tirar), `npm ci`, `tsc --noEmit`, `npm run lint` y `npm run build` de la web,
   y las pruebas de extremo a extremo con Playwright ([e2e/README.md](../e2e/README.md)). Deploy solo arranca si los
   tres trabajos salen en verde. Aparte, **Crysk** (`.github/workflows/crysk.yml`, ADR 0045) revisa el PR con IA y
   deja comentarios: es solo consultivo, no bloquea la fusión ni el despliegue.
2. Se fusiona en `main`. CI vuelve a pasar sobre `main`.
3. Si CI sale en verde, **Deploy** (`.github/workflows/deploy.yml`) entra por SSH con la clave de despliegue y pide
   `deploy <commit>`. En el servidor, el comando forzado `reforesta-radar-ci-deploy` comprueba el formato y llama por
   `sudo` a `reforesta-radar-deploy <commit>`. Si CI falla, no se despliega nada. Nunca se despliega desde un PR ni
   desde un fork, y dos despliegues no se solapan.
4. `reforesta-radar-deploy` comprueba que el commit está en `main` (en un espejo del repositorio,
   `/var/lib/reforesta-radar/repo.git`) y que ya tiene el formato de Dokploy, lo deja en la copia de Dokploy y le pide
   por su API (en `127.0.0.1:3000`) que **reconstruya sin clonar** («redeploy»). Dokploy construye las imágenes y
   sustituye `api` y `web` **sin corte** ([abajo](#despliegue-sin-corte), ADR 0044): arranca la versión nueva al lado
   de la vieja y solo quita la vieja cuando la nueva está sana. La API nueva aplica `alembic upgrade head` antes de
   escuchar. El script espera a que Dokploy termine, a que los cuatro servicios estén sanos y a que `/login` y el
   emisor OAuth respondan a través de Traefik. Si algo falla (un contenedor «unhealthy», la construcción, el sitio),
   **vuelve solo al commit anterior** de la misma forma y el workflow sale en rojo.
5. Mientras tanto, el workflow pregunta cada medio segundo por `/landing`, `/login` y `/api/public/oportunidades`
   desde fuera (`deploy/probe.sh`); cualquier respuesta que no sea 2xx/3xx sale como aviso amarillo en el resumen del
   run («Requests failed during the deploy»), sin ponerlo en rojo. Si aparece, algo ha roto el despliegue sin corte:
   mira [Si un despliegue corta](#si-un-despliegue-corta).
6. El workflow comprueba desde fuera `https://<dominio>/login` y que el emisor OAuth es exactamente la URL pública.
7. Después ejecuta `deploy/smoke.sh <URL pública>` (del commit desplegado): comprobaciones de solo lectura desde fuera
   (`/login` con el nombre de la app, `/api/board` → 401 sin sesión, `/api/public/oportunidades` con datos, `POST /mcp`
   público → 200, `POST /mcp/equipo` → 401 con `resource_metadata`, emisor OAuth, http → https y HSTS, y que
   `Host: dokploy.docker.localhost` no llega al panel). No crea
   cuentas, clientes OAuth ni datos. **Ojo: corre después de la vuelta atrás automática.** Si falla, el workflow sale
   en rojo con cada comprobación fallida anotada, pero la versión nueva sigue en marcha: vuelve a la anterior a mano
   (abajo). Se puede lanzar en cualquier momento desde cualquier ordenador:
   `deploy/smoke.sh https://reforesta-radar.miguelddev.com`.

Tarda 1-2 minutos desde que CI termina (con la caché de construcción del servidor).

### Despliegue sin corte

[ADR 0044](adr/0044-despliegue-sin-corte.md). Antes, cada despliegue paraba `web` y `api` y los volvía a crear: unos
segundos de 404 (Traefik sin `web`) y 12-14 s de errores en la API. Ahora los visitantes no lo notan (medido en
producción: cero respuestas fallidas en dos despliegues con imágenes nuevas, uno sin cambios y la prueba de vuelta
atrás; abajo, lo que aún puede cortar).

**Cómo va.** El comando de la app en Dokploy (lo pone `reforesta-radar-deploy`; `dokploy_command` en
`deploy/deploy.sh`) encadena cuatro `docker compose`:

1. `build`: construye las imágenes. Nada se para.
2. `up -d --no-recreate --wait`: crea lo que falte (un servidor nuevo) sin tocar lo que ya corre.
3. `up -d --no-recreate --scale api=2 --scale web=2 --wait api web`: arranca un segundo `api` y un segundo `web` con
   las imágenes nuevas, al lado de los viejos, y espera a que estén sanos. La API nueva aplica las migraciones antes de
   escuchar, mientras la vieja sigue sirviendo. Si no llegan a sanos, se queda aquí: los viejos no se han tocado.
4. `up -d --remove-orphans`: vuelve a uno de cada; Compose quita primero el contenedor desfasado (el viejo). Recrea
   `ingest-scheduler` (para el viejo y luego arranca el nuevo: nunca hay dos) y solo toca `postgres` si cambia su
   propia definición.

Por eso los contenedores cambian de número en cada despliegue (`<app>-api-7`, `<app>-web-6`…); `postgres` e
`ingest-scheduler` siguen en `-1`. Para dar con uno: `docker ps --filter label=com.docker.compose.service=api`.

**Por qué nadie ve el cambio.**
- Traefik solo manda tráfico a un `web` sano (healthcheck de Docker) y, además, comprueba cada segundo `/healthz` de
  cada `web` (`src/app/healthz/route.ts`).
- El `web` viejo, al recibir SIGTERM (`scripts/web-start.sh`), sigue sirviendo 3 s (Traefik añade el nuevo), luego su
  `/healthz` responde 503 y Traefik deja de mandarle peticiones, 3 s más para acabar las que tiene, y Next se cierra
  (`RADAR_DRAIN_SECONDS=6`). Sin el 503, Traefik seguía enviándole peticiones hasta que Docker lo mataba a los 30 s y
  luego marcaba su dirección ya inexistente (medido: 502 y peticiones colgadas 10 s).
- Si aun así una conexión a un `web` es rechazada, el middleware `retry` de Traefik la repite en el otro (solo errores
  de red antes de cualquier respuesta, nunca un código HTTP).
- `web` llega a la API por el nombre `api`, que mientras hay dos contenedores resuelve a los dos. Uvicorn, al pararse,
  deja de aceptar conexiones y acaba las peticiones en curso (hasta 30 s, `stop_grace_period`), y Docker quita su
  dirección del nombre al pararse. En las pruebas ninguna petición a la API falló en ese cambio.

**Regla para las migraciones: compatibles con la versión anterior.** Durante unos segundos la API vieja trabaja con la
base ya migrada (y si la versión nueva falla, la vuelta atrás no deshace la migración). Una migración puede añadir
tablas, columnas que admitan nulos o tengan valor por defecto, e índices; no puede borrar ni renombrar algo que la
versión en marcha use, ni añadir un `NOT NULL` sin valor por defecto. Para eso, en dos despliegues: primero el código
que deja de usarlo, después la migración que lo quita.

**Lo que aún corta** (en ese despliegue, no después):
- **Cambiar una etiqueta `traefik.*` de `web`** (`docker-compose.prod.yml`): mientras conviven el `web` viejo y el
  nuevo, Traefik ve el router definido dos veces de forma distinta y lo descarta (log: «HTTP router defined multiple
  times with different configurations»). Medido: unos 6 s de 404 en todo el sitio. Haz esos cambios cuando haya poco
  uso.
- Cambiar `postgres` (versión, configuración): se recrea y la API falla mientras arranca, como antes.
- Una API nueva que escucha pero responde errores recibe parte del tráfico desde que arranca hasta que la vuelta
  atrás la quita (Docker la añade al nombre `api` en cuanto arranca, sana o no).
- Una petición que dure más de 30 s en el contenedor que se va (p. ej. un análisis de PDF muy lento) se corta.
- Una carga diaria en curso en `ingest-scheduler` se interrumpe si se despliega a la vez (como antes).

¿Por qué no el «deploy» de Dokploy? Clona la cabeza de una rama: no puede desplegar un commit concreto, y si `main`
avanzara entre el CI verde y el clon desplegaría un commit sin comprobar. El despliegue automático de Dokploy (webhook)
se saltaría CI. Por eso la app tiene **Auto Deploy apagado** y el script fija el commit él mismo.

La rama que acepta el script es `RADAR_DEPLOY_BRANCH` en `/etc/reforesta-radar/deploy.env` (`main`). La rama de la
app en el panel solo la usa el botón **Deploy** (que no se usa); que diga `main` para que, si alguien lo pulsa, al
menos clone `main`. Con el proveedor **Git** esa rama es el campo `customGitBranch` de la API (**General → Provider:
Git → Branch**); el campo `branch` es el del proveedor GitHub y aquí no se usa. Compruébalo con `compose.one`.

### Desplegar a mano

Desde GitHub: **Actions → Deploy → Run workflow** (rama `main`); el campo `sha` vacío despliega la cabeza de `main`.

Desde el servidor (un commit de `main`, los 40 caracteres):

```bash
sudo reforesta-radar-deploy <commit>
```

Al final enseña el commit en marcha y el estado de cada servicio. Para reconstruir sin cambiar de commit, el botón
**Rebuild** del panel (no **Deploy**) hace lo mismo que el script sin las comprobaciones (también sin corte: usa el
mismo comando). No edites el comando de la app en el panel (**Advanced → Command**): el script lo vuelve a poner en
cada despliegue.

Para ver si un despliegue a mano corta, deja la sonda corriendo desde tu ordenador mientras tanto y párala con Ctrl+C
al acabar (resume respuestas por código y el corte más largo):

```bash
deploy/probe.sh https://reforesta-radar.miguelddev.com
```

**Probar una rama antes de fusionarla** (cambios del propio despliegue, como ADR 0044): el script solo acepta commits
de `RADAR_DEPLOY_BRANCH`. Cámbiala un momento y devuélvela a `main` al acabar (comprueba antes con
`gh run list --workflow deploy.yml` que no hay un despliegue de GitHub en marcha; el script además toma un cerrojo):

```bash
sudo sed -i 's/^RADAR_DEPLOY_BRANCH=.*/RADAR_DEPLOY_BRANCH=<rama>/' /etc/reforesta-radar/deploy.env
sudo reforesta-radar-deploy <commit de la rama>
sudo sed -i 's/^RADAR_DEPLOY_BRANCH=.*/RADAR_DEPLOY_BRANCH=main/' /etc/reforesta-radar/deploy.env
```

Si lo que cambia es `deploy/deploy.sh`, instálalo antes desde la rama (`sudo install -m 755 deploy.sh
/usr/local/sbin/reforesta-radar-deploy`); tras fusionar, `cd /opt/reforesta-radar && sudo git pull && sudo
./deploy/setup-server.sh` deja el servidor igual que `main`.

### Volver a una versión anterior

- Si el despliegue falla, la vuelta atrás es automática y sin corte (probada el 2026-11-15: un commit con el
  healthcheck de `web` roto; los contenedores viejos siguieron sirviendo todo el rato, el script quitó el `web` nuevo
  «unhealthy», volvió al commit anterior y salió con error en 3,5 minutos, sin ninguna petición fallida). Tarda: un
  `web` nuevo roto tarda unos 105 s en contar como «unhealthy» (30 s de arranque y 5 fallos cada 15 s).
- Si la versión nueva arranca pero tiene un fallo: **Actions → Deploy → Run workflow** con el `sha` del commit
  bueno (tiene que estar en `main`), o `sudo reforesta-radar-deploy <commit>` en el servidor. Reconstruye ese commit.
- Las migraciones no se deshacen solas. Se escriben para que la versión anterior siga funcionando con la base
  nueva ([la regla](#despliegue-sin-corte)); si una no lo permite, hay que restaurar una copia (abajo).
- Commits de antes de Dokploy (sin `reforesta-radar-edge` en `docker-compose.prod.yml`) se rechazan: arrancarían
  Caddy en puertos que ya tiene Traefik.

### Rotar la clave de despliegue

Cada año, o si se sospecha que se ha filtrado. En el servidor:

```bash
# 1. Clave nueva, solo para esto, en un fichero que solo lee root
sudo install -d -m 700 /root/ci-key
sudo ssh-keygen -t ed25519 -N '' -C reforesta-radar-ci -f /root/ci-key/id_ed25519
# 2. Autorizarla solo para el comando de despliegue (sustituye a la anterior)
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo "command=\"/usr/local/sbin/reforesta-radar-ci-deploy\",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty $(sudo cat /root/ci-key/id_ed25519.pub)" \
  | sudo tee /home/deploy/.ssh/authorized_keys > /dev/null
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys && sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

Desde tu ordenador (con `gh` autenticado; la clave pasa del servidor a GitHub sin tocar tu disco ni tu pantalla):

```bash
ssh ubuntu@<IP> 'sudo cat /root/ci-key/id_ed25519' | gh secret set DEPLOY_SSH_KEY --env production -R Migueldgq/reforesta-radar
ssh ubuntu@<IP> 'sudo rm -rf /root/ci-key'    # ya está en GitHub: borrarla del servidor
```

Lanza **Run workflow** para comprobarla. Para cortar el acceso de GitHub al momento: vaciar
`/home/deploy/.ssh/authorized_keys`.

La primera vez, además, hay que crear el entorno `production` en GitHub y sus variables (ver la cabecera de
`.github/workflows/deploy.yml`): `DEPLOY_HOST` (la IP), `DEPLOY_USER` (`deploy`), `RADAR_PUBLIC_URL`
(`https://<dominio>`) y `DEPLOY_KNOWN_HOSTS`, la huella del servidor, que se saca **desde el propio servidor** (no con
`ssh-keyscan` desde fuera, que se fía de la red):

```bash
ssh ubuntu@<IP> 'echo "<IP> $(cut -d" " -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"' \
  | gh variable set DEPLOY_KNOWN_HOSTS --env production -R Migueldgq/reforesta-radar
```

## Revisión por IA (opcional)

Apagada mientras no haya clave ([ADR 0041](adr/0041-revision-por-ia-que-solo-descarta.md)). Para encenderla:

1. Crea una clave de la API de Gemini en Google AI Studio (el nivel gratuito basta para la carga diaria).
2. En el panel, app «Radar» → **Environment**: añade `GEMINI_API_KEY=<la clave>` y guarda. Opcionales, con estos
   valores por defecto: `RADAR_AI_REVIEW=true` (con `false` se apaga sin borrar la clave),
   `RADAR_AI_MODEL=gemini-flash-lite-latest`, `RADAR_AI_MAX_CALLS=300`.
3. Redespliega (Deploy en el panel, o `sudo reforesta-radar-deploy <commit en marcha>`). Al arrancar,
   `ingest-scheduler` pide los veredictos que falten (en sus logs, `[review] …`); después, cada ingesta diaria solo
   pregunta por lo nuevo o lo cambiado.

La clave solo vive en el entorno de Dokploy y en `code/.env` (solo root); `docker-compose.yml` y
`docker-compose.prod.yml` solo pasan el nombre de la variable. Para apagarla, `RADAR_AI_REVIEW=false` (o quita la
clave) y redespliega.

## Cambiar el dominio

El dominio es un solo valor, `RADAR_DOMAIN`. De él salen la regla de Traefik, el certificado, `RADAR_PUBLIC_URL`
(enlaces de invitación, emisor OAuth, URL del MCP) y la cookie segura.

1. Crea un registro DNS `A` del nombre nuevo a la IP del servidor, **sin proxy** (en Cloudflare, nube gris: «DNS
   only»). Si el dominio tiene un registro `CAA`, debe permitir `letsencrypt.org`. Comprueba:
   `dig +short radar.example.org @1.1.1.1` → la IP.
2. En el panel, app «Radar» → **Environment**: cambia `RADAR_DOMAIN` y guarda.
3. En el servidor, cambia `RADAR_DOMAIN` en `/etc/reforesta-radar/deploy.env` y redespliega el commit en marcha:
   `sudo reforesta-radar-deploy $(sudo git -C /etc/dokploy/compose/<app>/code rev-parse HEAD)`. Traefik pide el
   certificado en segundos.
4. En GitHub, cambia la variable `RADAR_PUBLIC_URL` del entorno `production`.
5. Las sesiones siguen valiendo, pero los agentes de IA conectados con la URL vieja tienen que volver a conectarse
   con la nueva (el emisor OAuth cambia), y los enlaces de invitación ya enviados apuntan al dominio viejo.

El nombre viejo deja de servir la app (Traefik solo enruta `RADAR_DOMAIN`): a propósito, para que cookies y emisor
OAuth tengan un solo origen.

**Let's Encrypt** limita los intentos fallidos (5 por hora y nombre). La cuenta ACME es anónima (sin correo,
`deploy/traefik.yml`): nadie recibe avisos de caducidad, pero Traefik renueva solo y cada despliegue comprueba el
certificado desde fuera.

## Ver qué pasa

`api` y `web` cambian de número en cada despliegue: búscalos por servicio.

```bash
c() { sudo docker ps -q --filter label=com.docker.compose.project=<app> --filter label=com.docker.compose.service=$1; }
sudo docker ps --format 'table {{.Names}}\t{{.Status}}'          # estado y healthchecks
sudo docker logs --tail 100 -f $(c api)                           # API (una línea por petición, con la IP real del cliente)
sudo docker logs --tail 100 $(c ingest-scheduler)                 # carga diaria
sudo docker logs --tail 50 dokploy-traefik                        # errores de Traefik y certificados
sudo docker stats --no-stream                                     # CPU y memoria por contenedor
df -h / && free -h                                                # disco y memoria del servidor
journalctl -t reforesta-radar-deploy -t reforesta-radar-ci -n 20  # despliegues pedidos, hechos, rechazados
```

Los logs de despliegue de Dokploy están en el panel (app → **Deployments**) y en `/etc/dokploy/logs/<app>/`.

### Si un despliegue corta

El aviso «Requests failed during the deploy» del workflow (o `deploy/probe.sh` a mano) dice qué rutas fallaron, con
qué código y cuánto duró. Para ver qué pasó en el servidor en ese momento:

```bash
# Qué contenedor arrancó, se dio por sano, recibió SIGTERM y murió, con la hora (UTC)
sudo docker events --since 30m --until 0s --filter label=com.docker.compose.project=<app> --filter type=container \
  --format '{{.Time}} {{.Action}} {{.Actor.Attributes.name}}' | grep -v exec_
sudo docker logs --since 30m dokploy-traefik       # «defined multiple times»: cambió una etiqueta de web (arriba)
```

- **404 en todo el sitio unos segundos**: Traefik se quedó sin router. Lo normal es un cambio de etiquetas `traefik.*`
  de `web` (esperado una vez). Si no hubo ninguno, mira que el `web` nuevo llegó a sano antes de que se parara el viejo.
- **502 o peticiones colgadas en las páginas**: Traefik mandó peticiones a un `web` que ya se iba. Comprueba que el
  `web` viejo murió unos 6 s después de su `kill` (no a los 30 s: entonces Next no pudo cerrar) y que `/healthz`
  responde (`curl https://<dominio>/healthz` → `ok`).
- **500 solo en `/api/…`**: Next no llegó a la API. Mira los logs del `web` en marcha (`Failed to proxy`) y si la API
  vieja tardó en pararse.
- **El despliegue se queda en el paso 3** (Dokploy: «container … is unhealthy»): la versión nueva no arranca bien; el
  script vuelve solo a la anterior. Si alguna vez quedan dos `api` o dos `web` (un despliegue cortado a medias), el
  siguiente despliegue quita los que no están sanos; con los dos sanos no hace falta tocar nada.

**Qué se registra.** Traefik no guarda log de accesos (solo errores). La única línea por petición es la de la API:
IP del cliente, método, ruta **sin cadena de consulta** (`backend/app/access_log.py`), código. Nunca cabeceras
(`Authorization`, cookies, `Referer`), cuerpos ni tokens: los de `/invitacion/…` y `/restablecer/…` viajan en el
cuerpo de un POST, no en la ruta de la API. Los logs de Docker rotan solos (5 ficheros de 10 MB por servicio del radar;
3 de 10 MB los de Dokploy, por `/etc/docker/daemon.json`).

## Copias de seguridad y restauración

`reforesta-radar-backup.timer` ejecuta `reforesta-radar-backup` (`deploy/backup.sh`) cada día a las 03:30 UTC (si el
servidor estaba apagado, al arrancar): `pg_dump` en formato comprimido del contenedor `postgres` de la app,
comprobado con `pg_restore --list`, en `/var/backups/reforesta-radar/` (solo root), y borra las de más de 14 días. Si
falla, el servicio queda en rojo:

```bash
systemctl list-timers reforesta-radar-backup.timer      # próxima ejecución
sudo systemctl start reforesta-radar-backup.service     # una copia ahora
journalctl -u reforesta-radar-backup.service -n 20      # resultado
sudo ls -lh /var/backups/reforesta-radar/
```

**Comprobar una copia sin tocar la base buena** (hacerlo de vez en cuando; restaura en una base aparte, cuenta filas y
la borra):

```bash
PG=<app>-postgres-1
f=$(sudo sh -c 'ls -1t /var/backups/reforesta-radar/radar-*.dump | head -1')   # la carpeta solo la lee root
sudo docker exec $PG createdb -U radar radar_check
sudo cat "$f" | sudo docker exec -i $PG pg_restore -U radar -d radar_check --no-owner
for t in users tracking tracking_notes votes opportunities bdns_editions; do
  echo "$t: $(sudo docker exec $PG psql -U radar -d radar -Atc "select count(*) from $t") en uso / $(sudo docker exec $PG psql -U radar -d radar_check -Atc "select count(*) from $t") en la copia"
done
sudo docker exec $PG dropdb -U radar radar_check
```

**Restaurar de verdad** (sustituye todo lo que hay en la base por la copia; lo que se hizo después se pierde):

```bash
A=<app>
c() { sudo docker ps -aq --filter label=com.docker.compose.project=$A --filter label=com.docker.compose.service=$1; }
WEB=$(c web) API=$(c api) SCHED=$(c ingest-scheduler)   # api y web cambian de número en cada despliegue
sudo docker stop $WEB $API $SCHED
sudo docker exec $A-postgres-1 dropdb -U radar --force radar
sudo docker exec $A-postgres-1 createdb -U radar -O radar radar
sudo cat /var/backups/reforesta-radar/radar-AAAAMMDDTHHMMSSZ.dump \
  | sudo docker exec -i $A-postgres-1 pg_restore -U radar -d radar --no-owner --exit-on-error
sudo docker start $API && sleep 15 && sudo docker start $WEB $SCHED
```

### Copia fuera del servidor (Object Storage de Oracle)

Hoy las copias están en el mismo disco que la base: si Oracle borra la VM, se pierden las dos. `backup.sh` sube cada
copia a un bucket de Object Storage (20 GB gratis en Always Free; cada copia ocupa unos 4 MB) si existe
`BACKUP_PAR_URL`: una **URL preautenticada (PAR) que solo permite escribir objetos** en ese bucket. Si la subida
falla, el servicio queda en rojo (la copia local se queda). La URL nunca se escribe en el log. Contienen correos,
nombres y notas del equipo: el bucket es privado.

1. **Bucket.** Consola de Oracle → **Storage → Object Storage & Archive Storage → Buckets** → **Create Bucket**:
   nombre `reforesta-radar-backups`, **Standard**, cifrado gestionado por Oracle, **sin** acceso público (por
   defecto). Opcional: en el bucket, **Lifecycle Policy Rules → Create Rule**, acción **Delete**, 90 días, para que
   no crezca sin fin.
2. **PAR de solo escritura.** En el bucket → **Pre-Authenticated Requests → Create Pre-Authenticated Request**:
   **Target: Bucket**, **Access Type: Permit object writes** (no lecturas ni listado), una fecha de caducidad (p. ej.
   un año; apúntala para renovarla). Copia la **URL** que enseña (solo se ve una vez); termina en `/o/`.
3. **Ponerla en el servidor sin que pase por el historial** (la pide sin eco; el historial solo guarda el comando):

   ```bash
   ssh ubuntu@<IP>
   sudo bash -c 'umask 077; install -d -m 755 /etc/reforesta-radar; read -rs -p "PAR URL: " u; echo; printf "BACKUP_PAR_URL=%s\n" "$u" > /etc/reforesta-radar/backup.env'
   sudo systemctl start reforesta-radar-backup.service; journalctl -u reforesta-radar-backup.service -n 5 -o cat
   ```

   Debe decir `backup: uploaded radar-….dump off-site`, y el objeto aparece en el bucket.
4. **Restaurar desde la copia de fuera** (la PAR no deja leer, a propósito): en la consola, bucket → **Objects** → el
   `radar-….dump` más reciente → **Download**. Súbelo al servidor y sigue «Restaurar de verdad»:

   ```bash
   scp radar-AAAAMMDDTHHMMSSZ.dump ubuntu@<IP>:/tmp/
   ssh ubuntu@<IP> 'sudo install -m 600 /tmp/radar-*.dump /var/backups/reforesta-radar/ && rm /tmp/radar-*.dump'
   ```

Para quitar la copia de fuera: `sudo rm /etc/reforesta-radar/backup.env` (y borra la PAR en la consola). El código de
subida está probado contra un servidor HTTP local de usar y tirar (PUT aceptado → copia idéntica; 403 y servidor
caído → el servicio queda en rojo; la URL no aparece en el journal), no contra Oracle.

**¿Y las copias de Dokploy?** Dokploy sabe hacer `pg_dump` de un servicio de una app compose y copias de volúmenes,
pero solo a un destino S3 con clave de acceso y secreta. En Oracle eso son «Customer Secret Keys» de un usuario, con
todos los permisos de ese usuario sobre Object Storage; la PAR solo deja escribir objetos en un bucket. Además las
copias locales, su comprobación y la restauración no dependen del panel. Por eso no se usan (ADR 0039).

## Crear el primer administrador del radar

En un servidor sin cuentas (la contraseña se genera y se enseña **una sola vez**; cámbiala al entrar en Mi cuenta):

```bash
sudo docker exec -it $(sudo docker ps -q --filter label=com.docker.compose.project=<app> --filter label=com.docker.compose.service=api) python -m app.users create-admin tu@correo.org --name "Tu Nombre" --generate
```

Después, entra en `https://<dominio>/login` e invita al resto desde **Equipo → Invitar** (copia el enlace y mándalo
tú). Mantened al menos dos administradores.

## Cortafuegos: hay tres capas

1. **Lista de seguridad de la VCN** (consola de Oracle → Networking → Virtual cloud networks → la VCN → Security
   Lists → Default): reglas de entrada TCP 22, 80 y 443 desde `0.0.0.0/0`. No se toca desde el servidor.
2. **iptables `INPUT`**: la imagen de Ubuntu de Oracle trae reglas propias que rechazan todo salvo SSH.
   `setup-server.sh` añade 80 y 443 antes del `REJECT`, en caliente y en `/etc/iptables/rules.v4`. No uses
   `netfilter-persistent save`: guardaría también las reglas que Docker crea al arrancar.
3. **iptables `DOCKER-USER`**: los puertos que publica Docker no pasan por `INPUT` sino por `FORWARD`, y ahí Docker
   consulta primero `DOCKER-USER`. `docker-user-firewall.service` (`deploy/docker-user-firewall.sh`, tras cada arranque
   de Docker) solo deja entrar por la interfaz pública conexiones nuevas a 80 y 443. Así el puerto 3000 del panel solo se
   alcanza desde el propio servidor (si el panel se publica, entra por Traefik en 443, no por el 3000), y cualquier puerto que publique otro proyecto queda cerrado hasta que se añada
   aquí a propósito.

Si la web no responde desde fuera pero `curl -k --resolve <dominio>:443:127.0.0.1 https://<dominio>/login` funciona
en el servidor, el problema está en uno de los cortafuegos.

## Más proyectos en la misma máquina

Para eso está Dokploy. Para añadir uno:

1. **DNS:** un registro `A` `<nombre>.miguelddev.com` → la IP del servidor, sin proxy.
2. **Panel** (por el túnel): **Projects → Create Project**, y dentro una app (**Application** si es un Dockerfile, o
   **Compose**). Fuente: la URL de su repositorio (si es privado, una clave SSH de despliegue o la integración de
   GitHub). **Auto Deploy** a tu criterio: con él cada push a la rama despliega sin esperar a ningún CI.
3. **Dominio:** pestaña **Domains** de la app: el nombre, el puerto interno del contenedor, HTTPS con Let's Encrypt.
   Dokploy pone las etiquetas de Traefik y la conecta a `dokploy-network`. No publiques puertos (`ports:`): el
   cortafuegos `DOCKER-USER` los bloquearía y no hacen falta. Para compose, mejor **Isolated Deployments** activado
   (cada proyecto en su red).
4. **Recursos:** pon límites de memoria a sus servicios (en compose, `deploy.resources.limits.memory`; en una
   Application, **Advanced → Resources**). No conectes nada más a `reforesta-radar-edge`: esa red es solo de `web` y
   Traefik.

**Lo que da la máquina.** 2 OCPU ARM, 12 GB de RAM, 48 GB de disco (Always Free). Medido el 2026-11-15 en reposo:

| Qué | Memoria |
|---|---|
| Dokploy (panel) | ~500 MB |
| Postgres de Dokploy | ~60 MB |
| Traefik | ~25 MB |
| Radar: web / api / ingest-scheduler / postgres | ~75 / ~100 / ~55 / ~100 MB |
| Sistema en total | 1,8 GB usados de 11,6 GB; disco 19 GB de 48 GB (la imagen de Dokploy ocupa 4,5 GB y la caché de construcción del radar unos 8 GB, que `deploy.sh` purga a los 7 días) |

Límites del radar (`docker-compose.prod.yml`, comprobados con `docker inspect`): `web` 768 MB, `api` 1 GB,
`postgres` 1 GB, `ingest-scheduler` 1,5 GB (la carga diaria es lo que más usa), con reservas de 128-256 MB. En total
4,3 GB como máximo: quedan unos 6 GB para otros proyectos y Dokploy. Durante un despliegue hay unos segundos dos `web` y
dos `api` (ADR 0044): 1,8 GB más de límite, unos 200 MB más de uso real. Con muchos proyectos, la CPU (2 núcleos) se
nota antes que la memoria, sobre todo al construir imágenes en el servidor.

**Reclamación por inactividad.** Oracle puede reclamar una VM Always Free inactiva (ver abajo). Más proyectos la hacen
menos «inactiva», pero no lo garantizan: la regla mira los percentiles de CPU, red y memoria de 7 días.

## Oracle Always Free: límites y riesgos

Según la [documentación de Oracle](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
(consultada el 2026-11-15):

- **Recursos gratis**: Ampere A1 «the first 1,500 OCPU hours and 9,000 GB hours per month for free», es decir
  «equivalent to 2 OCPUs and 12 GB of memory» (lo que tiene esta VM); 200 GB de disco en total (arranque y volúmenes);
  10 TB al mes de tráfico de salida; 20 GB de Object Storage.
- **Una VM inactiva se puede reclamar**: «Idle Always Free compute instances may be reclaimed by Oracle». Se
  considera inactiva si durante 7 días el percentil 95 de CPU está por debajo del 20 %, la red por debajo del 20 % y
  (en A1) la memoria por debajo del 20 %. Con Dokploy la máquina usa unos 1,8 GB de 12 (≈ 15 %) en reposo: el riesgo
  sigue siendo real. Si Oracle avisa por correo de que va a reclamarla o la para:
  1. Arrancarla desde la consola (Compute → Instances → Start) si solo está parada; todo vuelve solo (probado con
     `sudo reboot`: Dokploy, Traefik, los cuatro servicios del radar, el cortafuegos y el temporizador de copias).
  2. Si se borró: «Preparar un servidor nuevo desde cero» (abajo) y restaurar la última copia de fuera.
  3. Pasar la cuenta a «Pay As You Go» evita la reclamación por inactividad según los foros de Oracle, pero la
     documentación consultada no lo dice: compruébalo antes de contar con ello.
- **No pulses «Upgrade»** a una cuenta de pago sin decidirlo: Oracle dice que no cobra los recursos Always Free tras
  pasar a pago y que «will only charge you for resource usage above the Always Free limits», pero a partir de ahí
  cualquier recurso que se cree por encima de esos límites se factura.
- **Sin redundancia**: una sola VM, un solo disco. Si cae, el radar cae hasta que vuelva. Es ARM (aarch64): las
  imágenes se construyen en el propio servidor.

## Preparar un servidor nuevo desde cero

Ubuntu 24.04 con acceso SSH y `sudo`. Abre 80 y 443 en la lista de seguridad de la VCN y apunta el DNS a la IP.

1. **La máquina** (repetible sin miedo):

   ```bash
   sudo git clone https://github.com/Migueldgq/reforesta-radar.git /opt/reforesta-radar
   sudo /opt/reforesta-radar/deploy/setup-server.sh
   ```

   Instala Docker desde su repositorio oficial con rotación de logs, deja activas las actualizaciones de seguridad
   automáticas, abre 80/443 en iptables, el cortafuegos `DOCKER-USER`, un swap de 2 GB, **Dokploy v0.31.2**
   (instalador comprobado por SHA-256; Swarm con el pool `10.200.0.0/16`), la configuración de Traefik de
   `deploy/traefik.yml`, quita la ruta pública del panel e instala el interruptor `reforesta-panel` (el panel queda
   privado), crea la red `reforesta-radar-edge`, el usuario `deploy` con
   su regla de `sudo`, los scripts en `/usr/local/sbin` y el temporizador de copias. No cambia la zona horaria (UTC; la
   app usa `Europe/Madrid` por su cuenta). Para subir de versión de Dokploy: cambia `DOKPLOY_VERSION` y
   `DOKPLOY_INSTALLER_SHA256` en el script (el `install.sh` de esa versión en las releases de GitHub de Dokploy; lee
   sus notas) y en el servidor ejecuta ese `install.sh` con el argumento `update`.
2. **El panel** (túnel de arriba): crea la cuenta de administrador (la primera visita la crea; correo del responsable,
   contraseña fuerte, 2FA). En **Settings → Profile → API/CLI**, crea la clave `reforesta-radar-deploy` **con
   «Rate limit» apagado** y guárdala en `/etc/reforesta-radar/dokploy-api-key` (comando de arriba).
3. **La app:** **Create Project** «Reforesta Radar» → **Create Service → Compose** «Radar», tipo **Docker Compose**.
   - **General → Provider: Git**: URL `https://github.com/Migueldgq/reforesta-radar.git`, rama `main`, Compose Path
     `./docker-compose.yml`. **Auto Deploy apagado.**
   - **Advanced → Command**: `compose -p <app> -f docker-compose.yml -f docker-compose.prod.yml up -d --build --remove-orphans`
     (`<app>` es el «App Name» que Dokploy le dio, arriba en la app). Sirve para este primer arranque; el primer
     `reforesta-radar-deploy` lo cambia por el del [despliegue sin corte](#despliegue-sin-corte).
   - **Environment**: `RADAR_DOMAIN=<dominio>` y `RADAR_DB_PASSWORD=<openssl rand -hex 32>`.
   - Sin **Domains**, sin **Isolated Deployments**. Pulsa **Deploy** esta única vez (clona la rama).
   - Lo mismo por API, desde el servidor, con la clave: `project.create`, `compose.create`
     (`composeType: docker-compose`, `sourceType: git`), `compose.update` (`customGitUrl`, `customGitBranch`,
     `composePath`, `command`, `autoDeploy: false`, `env`) y `compose.deploy`, contra `http://127.0.0.1:3000/api/…`
     con la cabecera `x-api-key` (así se creó la de hoy). Dokploy v0.31.2 también exporta e importa proyectos entre
     instancias (según sus notas de versión; no probado aquí).
4. **El servidor sabe cuál es la app** (`RADAR_COMPOSE_ID`: el último tramo de la URL de la app en el panel,
   `…/services/compose/<id>`):

   ```bash
   sudo tee /etc/reforesta-radar/deploy.env > /dev/null <<'EOF'
   RADAR_APP=<app>
   RADAR_COMPOSE_ID=<id>
   RADAR_DOMAIN=<dominio>
   RADAR_DEPLOY_BRANCH=main
   EOF
   ```

5. **Datos:** el primer administrador del radar (arriba) o restaurar una copia («Restaurar de verdad»); la clave de
   despliegue («Rotar la clave de despliegue»). Comprueba con `deploy/smoke.sh https://<dominio>`.
6. **El panel con dominio** (opcional, ADR 0043): con 2FA ya activado en el panel, `sudo reforesta-panel public`
   («El panel con dominio», arriba). Si el dominio del panel cambia, cámbialo en `deploy/traefik-panel.yml`.
