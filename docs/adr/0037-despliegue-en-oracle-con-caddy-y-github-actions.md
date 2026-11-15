# 0037. Despliegue en Oracle Cloud Always Free con Caddy, copias diarias y GitHub Actions

- Estado: Sustituida por 0039
- Fecha: 2026-11-15 (rama `feat/despliegue`)
- Sustituye a: [0024](0024-alojamiento.md)

## Contexto
ADR 0024 dejó el alojamiento como propuesta (VPS con Dokploy u Oracle Always Free). El radar necesita procesos
permanentes (Postgres, API, `ingest-scheduler`), https real para el inicio de sesión desde el agente de IA (el emisor
OAuth es `RADAR_PUBLIC_URL`, ADR 0035), la IP real del cliente para los límites por IP, y copias de la base. Hay una
VM de Oracle Cloud Always Free ya creada (Frankfurt, Ampere A1 ARM, 2 OCPU, 12 GB, 48 GB de disco, Ubuntu 24.04) y
un dominio propio. El repositorio es público.

## Decisión
- **Alojamiento:** una sola VM de Oracle Cloud Always Free con la misma pila de `docker compose` que en local,
  construida en el servidor (ARM) desde el repositorio público, en `/opt/reforesta-radar`, propiedad de un usuario
  `deploy` sin contraseña ni `sudo`. Preparación reproducible con `deploy/setup-server.sh`.
- **Proxy:** Caddy como contenedor en `docker-compose.prod.yml` (superpuesto a `docker-compose.yml`), con https
  automático de Let's Encrypt, cuenta ACME **sin correo**, HSTS y cabeceras por defecto que no pisan las de la app,
  límites de cuerpo iguales a los de la API (1 MiB, 16 MiB para `/api/analyze-pdf`), compresión y un log de accesos
  sin cadenas de consulta, tokens de enlace, cookies, `Authorization` ni `Referer`. Solo Caddy publica puertos (80 y
  443). Caddy sobrescribe `X-Forwarded-For`; la red de compose tiene subred fija y `FORWARDED_ALLOW_IPS` es esa
  subred, así que la API ve la IP real. Sin panel (ni Dokploy ni Coolify): menos piezas y ninguna superficie de
  administración más.
- **Dominio:** un solo ajuste, `RADAR_DOMAIN`, en el `.env` del servidor; de él salen el certificado y
  `RADAR_PUBLIC_URL`. Hoy `reforesta-radar.miguelddev.com` (registro `A` sin proxy). Caddy solo atiende ese nombre,
  para que cookies y emisor OAuth tengan un único origen.
- **Secretos:** generados en el servidor en `/opt/reforesta-radar/.env` (600, `deploy`); nunca en el repositorio.
  Sin SMTP: los administradores copian los enlaces de invitación.
- **Copias:** `deploy/backup.sh` (`pg_dump` comprimido, comprobado con `pg_restore --list`) cada día a las 03:30
  UTC con un temporizador de systemd, en `/var/backups/reforesta-radar`, 14 días. La restauración está documentada
  y probada en una base aparte. La copia fuera del servidor (Object Storage de Oracle) queda como siguiente paso.
- **CI/CD:** GitHub Actions. `ci.yml` en cada PR y en `main` (ruff, pytest con Postgres 16, tsc, lint, build).
  `deploy.yml` solo tras un CI verde de un push a `main` de este repositorio (o a mano sobre `main`): entra por SSH
  con una clave generada en el servidor solo para esto, restringida en `authorized_keys` a un comando forzado
  (`deploy/ci-deploy.sh`, sin pty ni reenvíos) que solo acepta `deploy <commit de 40 hex>` de `origin/main`. La
  huella del servidor va fijada en GitHub. `deploy/deploy.sh` etiqueta las imágenes con el commit, aplica solo
  `alembic upgrade head` y, si la versión nueva no arranca sana, vuelve sola a la anterior.

## Consecuencias
- Coste cero y la misma pila que en local; un fallo se reproduce con `docker compose`.
- **Oracle puede reclamar la VM si está inactiva**: según su documentación, «Idle Always Free compute instances may
  be reclaimed by Oracle» si durante 7 días el percentil 95 de CPU, la red y (en A1) la memoria están por debajo del
  20 %. El radar cumple las tres casi todo el tiempo (≈ 9 % de memoria medido). La documentación consultada no dice
  si una cuenta de pago lo evita. Mientras no haya copia fuera del servidor, perder la VM es perder los datos del
  equipo.
- Una sola VM, sin redundancia: si cae, el radar cae. Las actualizaciones de seguridad del sistema son automáticas,
  pero no reinician la máquina.
- ARM: las imágenes se construyen en el servidor (unos 2,5 minutos la primera vez); no hay registro de imágenes.
- El usuario `deploy` está en el grupo `docker`, que equivale a root en la máquina. Por eso su única clave tiene un
  comando forzado; aun así, quien pueda fusionar en `main` puede ejecutar código en el servidor (como en cualquier
  CD). Las migraciones no se deshacen al volver atrás: tienen que ser compatibles con la versión anterior.
- Let's Encrypt limita los intentos fallidos (5 por hora y nombre): `RADAR_ACME_CA` permite probar con su entorno
  de pruebas.

## Alternativas consideradas
- VPS de pago con Dokploy o Coolify (ADR 0024): un panel añade otra pieza que mantener y otra superficie de
  administración expuesta; para una sola pila de compose no aporta lo suficiente.
- nginx + certbot: más configuración y una renovación aparte; Caddy hace https y renovación solo.
- `sslip.io` como dominio provisional: funcionaba sin cuenta, pero el dominio propio ya estaba disponible y evita
  cambiar el emisor OAuth después.
- Despliegue «pull» (un temporizador en el servidor que hace `git fetch` y despliega `main`): no necesita ninguna
  clave en GitHub, pero desplegaría aunque CI fallase (o habría que consultar la API de GitHub desde el servidor),
  con retraso, y sin un resultado visible en el PR. Se prefirió el «push» con una clave limitada a un comando.
- Plataformas serverless con base gestionada: no cubren el planificador ni la base sin piezas extra (ADR 0024).
