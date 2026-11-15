# 0039. Despliegue con Dokploy en la misma VM de Oracle, con el panel solo por túnel SSH

- Estado: Aceptada
- Fecha: 2026-11-15 (rama `feat/dokploy`)
- Sustituye a: [0037](0037-despliegue-en-oracle-con-caddy-y-github-actions.md)

## Contexto
ADR 0037 publicó el radar con Caddy y scripts propios en una VM de Oracle Cloud Always Free (ARM, 2 OCPU, 12 GB) y
descartó un panel porque «para una sola pila de compose no aporta lo suficiente». El responsable va a alojar más
proyectos suyos en esa máquina y ha decidido gestionarlos con Dokploy. El radar guarda una cuenta real y datos que no
se pueden perder; el inicio de sesión desde el agente (ADR 0035) necesita https, la IP real del cliente y un emisor
OAuth exacto. Solo 22, 80 y 443 están abiertos en la lista de seguridad de Oracle, que no se toca.

## Decisión
- **Dokploy v0.31.2** (fijada; instalador comprobado por SHA-256 en `deploy/setup-server.sh`) en la misma VM. Trae
  Docker Swarm (para sus propios servicios; pool de direcciones `10.200.0.0/16`, que no pisa la VCN `10.0.0.0/16`) y
  Traefik v3.7 en 80/443. Caddy desaparece del repositorio (`deploy/Caddyfile`, servicio `caddy`).
- **El radar es una app «Docker Compose» de Dokploy** (tipo compose, no stack: sin réplicas de Swarm, el
  planificador sigue siendo un solo contenedor) que clona el repositorio público por URL (sin GitHub App) y ejecuta un
  comando propio: `docker compose -p <app> -f docker-compose.yml -f docker-compose.prod.yml up -d --build`. Dokploy
  escribe el `.env` con `RADAR_DOMAIN` y `RADAR_DB_PASSWORD`; el resto sale de `docker-compose.prod.yml`.
- **Traefik solo llega a `web`**, por una red propia `reforesta-radar-edge` (interna), con etiquetas en
  `docker-compose.prod.yml`: router https con Let's Encrypt, redirección http → https y HSTS. No se usan los dominios
  de Dokploy, para que el enrutado viva en el repositorio. Las demás cabeceras de seguridad pasan a `next.config.ts`
  (Traefik no sabe poner una cabecera solo si la app no la puso, como el `?` de Caddy).
- **Configuración estática de Traefik en el repositorio** (`deploy/traefik.yml`): cuenta ACME **sin correo**, sin
  `api.insecure` (sin panel ni API de Traefik), sin HTTP/3, 2 minutos para leer una petición y sin log de accesos.
  Traefik descarta el `X-Forwarded-For` del cliente y pone la IP real; la API confía solo en la subred del proyecto
  (`FORWARDED_ALLOW_IPS`). El log de accesos que queda es el de uvicorn, ahora sin cadenas de consulta.
- **El panel no se publica.** Su puerto 3000 está cerrado en Oracle y, en el propio servidor, la cadena `DOCKER-USER`
  (`deploy/docker-user-firewall.sh`) solo deja pasar 80/443 hacia contenedores. Se quita la ruta que Dokploy crea por
  defecto en Traefik (`Host: dokploy.docker.localhost` en el puerto 80, alcanzable desde internet). Se entra con
  `ssh -L`. Darle un dominio con https y 2FA obligatorio queda como opción documentada, no hecha.
- **CI sigue siendo la puerta.** Sin despliegue automático de Dokploy al hacer push. GitHub Actions, tras CI verde en
  `main`, usa la misma clave con comando forzado; `ci-deploy.sh` (usuario `deploy`, ya sin grupo `docker`) solo puede
  llamar por `sudo` a `reforesta-radar-deploy` (`deploy/deploy.sh`, de root), que comprueba que el commit está en
  `main`, lo deja en la copia de Dokploy y le pide por su API local (clave en un fichero solo de root) que reconstruya
  sin clonar; espera a la salud y, si falla, vuelve al commit anterior igual. Así se despliega el commit exacto.
- **Copias:** las mismas (diarias, 14 días, en el servidor), más una copia opcional fuera con un PUT a una URL
  preautenticada de Object Storage (`BACKUP_PAR_URL`, solo escritura). No se usan las copias de Dokploy: piden un
  destino S3 con claves de acceso (en Oracle, «Customer Secret Keys» de un usuario, con todos sus permisos), cuando una
  PAR solo permite escribir objetos en un bucket; y las copias locales y su prueba de restauración no dependen del
  panel.
- **Límites de memoria** por servicio en `docker-compose.prod.yml` (de 768 MB a 1,5 GB, 4,3 GB en total) para que otro
  proyecto no deje sin memoria al radar ni al revés.

## Consecuencias
- Varios proyectos en la máquina sin repetir proxy, certificados ni scripts para cada uno.
- **Más superficie de ataque.** El panel de Dokploy equivale a root en la máquina (monta el socket de Docker): quien
  entre en él controla el servidor y todos los proyectos. Por eso solo por túnel y con 2FA pendiente de activar.
  Dokploy y su Postgres son otro software que mantener al día (`install.sh update` de una versión fijada).
- **Más memoria:** Dokploy, su Postgres y Traefik usan unos 590 MB en reposo (medido el 2026-11-15), frente a unos
  60 MB de Caddy.
- **Swarm** activo (solo lo usa Dokploy). El radar no depende de él.
- **Configuración fuera del repositorio**, solo en la base de datos de Dokploy: la cuenta de administrador (y su 2FA),
  la clave de API, el proyecto «Reforesta Radar» y la app «Radar» (URL del repositorio, rama, ruta
  `./docker-compose.yml`, comando propio, despliegue automático apagado) y su entorno (`RADAR_DOMAIN`,
  `RADAR_DB_PASSWORD`). En el servidor, fuera de git: `/etc/reforesta-radar/deploy.env` (nombre e id de la app,
  dominio, rama) y `dokploy-api-key`. Cómo recrearlo todo: [despliegue.md](../despliegue.md#preparar-un-servidor-nuevo-desde-cero).
  Si se pierde la base de datos de Dokploy, el radar sigue funcionando (son contenedores de compose con
  `restart: unless-stopped`), pero no se puede desplegar hasta recrear la app.
- Un despliegue reconstruye en el servidor (aprox. 1 minuto con caché); volver atrás también reconstruye el commit
  anterior. Los botones «Deploy» del panel clonan la cabeza de la rama sin pasar por CI: no se usan.
- Let's Encrypt sin correo: Traefik registra una cuenta anónima cuando la necesita (nadie avisa si la renovación
  falla; el workflow y `deploy/smoke.sh` comprueban el certificado al desplegar).
- Los límites de tamaño de las peticiones los pone la app (API 1 MiB, 16 MiB en `/api/analyze-pdf`, 16 KiB en
  `/oauth/*`; Next, 16 MB en lo que reenvía a la API), no el proxy: el middleware `buffering` de Traefik también
  retiene las respuestas enteras y rompería el streaming de las páginas.

## Alternativas consideradas
- Seguir con Caddy y scripts (ADR 0037): cada proyecto nuevo repetiría proxy, certificados y despliegue a mano.
- Coolify: motivo no registrado (el responsable eligió Dokploy).
- Dejar que Dokploy despliegue al hacer push (webhook): se saltaría CI.
- Desplegar con el botón/API «deploy» de Dokploy: clona la cabeza de la rama, no un commit concreto, y no hay vuelta
  atrás automática para apps compose.
- Dominios de Dokploy en vez de etiquetas propias: la configuración quedaría solo en el panel y Dokploy reescribe el
  fichero de compose; tampoco permitían la red propia solo para `web`.
- «Isolated deployments» de Dokploy: mete a todos los servicios (Postgres y la API incluidos) en la red de Traefik.
- Panel con dominio público desde el principio: más cómodo, pero expone a internet un panel equivalente a root antes
  de tener 2FA.
