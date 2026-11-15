# Despliegue

Cómo está publicado el radar, cómo se actualiza y qué hacer cuando algo va mal. Para quien llega por primera vez:
no hace falta saber nada del servidor, solo tener acceso SSH a él. Las decisiones y sus contrapartidas están en
[ADR 0037](adr/0037-despliegue-en-oracle-con-caddy-y-github-actions.md).

**Producción hoy:** <https://reforesta-radar.miguelddev.com> (servidor MCP del equipo:
`https://reforesta-radar.miguelddev.com/mcp/equipo`). En los ejemplos genéricos de abajo el dominio aparece como
`radar.example.org`.

## Qué hay y dónde

```
Internet ──▶ cortafuegos de Oracle (lista de seguridad de la VCN: 22, 80, 443)
         ──▶ cortafuegos del propio servidor (iptables: 22, 80, 443)
         ──▶ caddy :80/:443 (https automático, cabeceras de seguridad, límites, log sin datos sensibles)
         ──▶ web :3000 (Next.js; reenvía /api/*, /mcp*, /oauth/*, /.well-known/oauth-* a la API)
         ──▶ api :8000 (FastAPI) ──▶ postgres :5432
             ingest-scheduler (carga diaria a las 9:00, hora de Madrid)
```

Solo Caddy publica puertos (80 y 443). `web`, `api` y `postgres` solo son alcanzables dentro de la red de Docker.

| Qué | Dónde |
|---|---|
| Servidor | Oracle Cloud Always Free, Frankfurt, una VM Ampere A1 (ARM, 2 OCPU, 12 GB, disco de 48 GB), Ubuntu 24.04, hora del sistema en UTC |
| Acceso | `ssh ubuntu@<IP>` con la clave del responsable (usuario con `sudo`) |
| Código | `/opt/reforesta-radar` (clon del repositorio público; propiedad del usuario `deploy`) |
| Secretos | `/opt/reforesta-radar/.env` (permisos 600, usuario `deploy`): dominio, contraseña de Postgres, etiqueta de las imágenes. Nunca en git |
| Ficheros de compose | `docker-compose.yml` + `docker-compose.prod.yml` (el `.env` define `COMPOSE_FILE`, así que `docker compose …` en esa carpeta usa los dos) |
| Proxy | `deploy/Caddyfile`; certificados en el volumen `reforesta-radar_caddy-data` |
| Base de datos | volumen `reforesta-radar_radar-pgdata` |
| Copias | `/var/backups/reforesta-radar/radar-<fecha UTC>.dump` (14 días), temporizador `reforesta-radar-backup.timer` (03:30 UTC) |
| Scripts | `deploy/setup-server.sh` (preparar el servidor), `deploy/deploy.sh` (desplegar), `deploy/backup.sh` (copia), `deploy/ci-deploy.sh` (lo único que puede hacer la clave de GitHub) |

**Usuarios del servidor.** `ubuntu` es la cuenta de administración (tiene `sudo`). `deploy` es un usuario sin
contraseña ni `sudo` que es dueño del código y ejecuta Docker; su única clave SSH es la de GitHub Actions, limitada a
desplegar. Ojo: estar en el grupo `docker` equivale en la práctica a ser root en la máquina (se puede montar `/` en un
contenedor), por eso esa clave solo puede ejecutar un comando. Los comandos de abajo se lanzan como `deploy`:

```bash
sudo -iu deploy           # abre una sesión como deploy
cd /opt/reforesta-radar
```

**Correo.** No hay SMTP configurado: los administradores copian el enlace de invitación o de restablecimiento en
**Equipo** y lo mandan ellos. «He olvidado mi contraseña» no aparece.

## Cómo llega un cambio a producción (CI/CD)

1. Se abre un PR. **CI** (`.github/workflows/ci.yml`) pasa `ruff check`, `ruff format --check` y `pytest` del
   backend (con un Postgres 16 de usar y tirar) y `npm ci`, `tsc --noEmit`, `npm run lint` y `npm run build` de la web.
2. Se fusiona en `main`. CI vuelve a pasar sobre `main`.
3. Si CI sale en verde, **Deploy** (`.github/workflows/deploy.yml`) entra por SSH con la clave de despliegue y pide
   `deploy <commit>`. En el servidor, `deploy/ci-deploy.sh` comprueba que es un commit completo de 40 caracteres que
   está en `origin/main` y llama a `deploy/deploy.sh <commit>`. Si CI falla, no se despliega nada. Nunca se despliega
   desde un PR ni desde un fork, y dos despliegues no se solapan.
4. `deploy.sh` construye las imágenes en el servidor (etiquetadas con el commit), aplica las migraciones
   (`alembic upgrade head`, nada más), arranca, espera a los healthchecks y prueba `/login` y los metadatos OAuth a
   través de Caddy. Si la versión nueva no arranca sana, **vuelve sola a la anterior** (sus imágenes siguen en disco)
   y el workflow sale en rojo.
5. El workflow comprueba desde fuera `https://<dominio>/login` y que el emisor OAuth es exactamente la URL pública.

Tarda unos 3-5 minutos desde que CI termina (la mayor parte es construir en el servidor).

### Desplegar a mano

Desde GitHub: **Actions → Deploy → Run workflow** (rama `main`); el campo `sha` vacío despliega la cabeza de `main`.

Desde el servidor:

```bash
sudo -u deploy /opt/reforesta-radar/deploy/deploy.sh              # origin/main
sudo -u deploy /opt/reforesta-radar/deploy/deploy.sh <commit>     # un commit concreto
```

Al final enseña el commit en marcha, el estado de cada servicio y el tamaño de las imágenes.

### Volver a una versión anterior

- Si el despliegue falla, la vuelta atrás es automática.
- Si la versión nueva arranca pero tiene un fallo: **Actions → Deploy → Run workflow** con el `sha` del commit
  bueno (tiene que estar en `main`), o `deploy.sh <commit>` en el servidor. Reconstruye ese commit (o reutiliza sus
  imágenes si son las anteriores).
- Las migraciones no se deshacen solas. Se escriben para que la versión anterior siga funcionando con la base
  nueva; si una no lo permite, hay que restaurar una copia (abajo).

### Rotar la clave de despliegue

Cada año, o si se sospecha que se ha filtrado. En el servidor:

```bash
# 1. Clave nueva, solo para esto, en un fichero que solo lee root
sudo install -d -m 700 /root/ci-key
sudo ssh-keygen -t ed25519 -N '' -C reforesta-radar-ci -f /root/ci-key/id_ed25519
# 2. Autorizarla solo para el comando de despliegue (sustituye a la anterior)
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo "command=\"/opt/reforesta-radar/deploy/ci-deploy.sh\",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty $(sudo cat /root/ci-key/id_ed25519.pub)" \
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

## Cambiar el dominio

El dominio es un solo valor, `RADAR_DOMAIN`, en `/opt/reforesta-radar/.env`. De él salen el certificado,
`RADAR_PUBLIC_URL` (enlaces de invitación, emisor OAuth, URL del MCP) y la cookie segura.

1. Crea un registro DNS `A` del nombre nuevo a la IP del servidor, **sin proxy** (en Cloudflare, nube gris: «DNS
   only»). Si el dominio tiene un registro `CAA`, debe permitir `letsencrypt.org`. Comprueba:
   `dig +short radar.example.org @1.1.1.1` → la IP.
2. En el servidor: `sudo -u deploy sed -i 's/^RADAR_DOMAIN=.*/RADAR_DOMAIN=radar.example.org/' /opt/reforesta-radar/.env`
3. `sudo -u deploy /opt/reforesta-radar/deploy/deploy.sh` (o solo `docker compose up -d` como `deploy`). Caddy pide el
   certificado en segundos.
4. En GitHub, cambia la variable `RADAR_PUBLIC_URL` del entorno `production`.
5. Las sesiones siguen valiendo, pero los agentes de IA conectados con la URL vieja tienen que volver a conectarse
   con la nueva (el emisor OAuth cambia), y los enlaces de invitación ya enviados apuntan al dominio viejo.

El nombre viejo deja de servir la app (Caddy solo atiende `RADAR_DOMAIN`): a propósito, para que cookies y emisor
OAuth tengan un solo origen.

**Probar un dominio nuevo sin gastar intentos** de Let's Encrypt (límite de 5 validaciones fallidas por hora): pon
`RADAR_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory` en el `.env`, `docker compose up -d caddy`,
comprueba que lo obtiene (el navegador avisará: es de pruebas), quita la línea y vuelve a `docker compose up -d caddy`.

## Ver qué pasa

Como `deploy`, en `/opt/reforesta-radar`:

```bash
docker compose ps                                  # estado y healthchecks
docker compose logs --tail 100 -f api              # API (una línea por petición, con la IP real del cliente)
docker compose logs --tail 100 ingest-scheduler    # carga diaria
docker compose logs --tail 50 caddy                # accesos (JSON) y certificados
docker stats --no-stream                           # CPU y memoria por contenedor
df -h / && free -h                                 # disco y memoria del servidor
```

Los logs de Docker rotan solos (5 ficheros de 10 MB por servicio). El log de Caddy no guarda cadenas de consulta
(`?…`, donde va el id de `/autorizar` y los códigos OAuth), ni tokens de `/invitacion/…` y `/restablecer/…`, ni
cookies, ni la cabecera `Authorization`, ni el `Referer`.

## Copias de seguridad y restauración

`reforesta-radar-backup.timer` ejecuta `deploy/backup.sh` cada día a las 03:30 UTC (si el servidor estaba apagado, al
arrancar): `pg_dump` en formato comprimido, comprobado con `pg_restore --list`, en
`/var/backups/reforesta-radar/` (solo root), y borra las de más de 14 días. Si falla, el servicio queda en rojo:

```bash
systemctl list-timers reforesta-radar-backup.timer      # próxima ejecución
sudo systemctl start reforesta-radar-backup.service     # una copia ahora
journalctl -u reforesta-radar-backup.service -n 20      # resultado
sudo ls -lh /var/backups/reforesta-radar/
```

**Comprobar una copia sin tocar la base buena** (hacerlo de vez en cuando; restaura en una base aparte, cuenta filas y
la borra):

```bash
cd /opt/reforesta-radar
f=$(sudo sh -c 'ls -1t /var/backups/reforesta-radar/radar-*.dump | head -1')   # la carpeta solo la lee root
sudo -u deploy docker compose exec -T postgres createdb -U radar radar_check
sudo cat "$f" | sudo -u deploy docker compose exec -T postgres pg_restore -U radar -d radar_check --no-owner
for t in users tracking tracking_notes votes opportunities; do
  echo "$t: $(sudo -u deploy docker compose exec -T postgres psql -U radar -d radar -Atc "select count(*) from $t") en uso / $(sudo -u deploy docker compose exec -T postgres psql -U radar -d radar_check -Atc "select count(*) from $t") en la copia"
done
sudo -u deploy docker compose exec -T postgres dropdb -U radar radar_check
```

**Restaurar de verdad** (sustituye todo lo que hay en la base por la copia; lo que se hizo después se pierde):

```bash
cd /opt/reforesta-radar
sudo -u deploy docker compose stop caddy web api ingest-scheduler
sudo cat /var/backups/reforesta-radar/radar-AAAAMMDDTHHMMSSZ.dump \
  | sudo -u deploy docker compose exec -T postgres pg_restore -U radar -d radar --clean --if-exists --no-owner
sudo -u deploy docker compose up -d --wait
```

**Siguiente paso, no hecho:** una copia fuera del servidor. Hoy las copias están en el mismo disco que la base: si
Oracle borra la VM, se pierden las dos. Oracle Object Storage tiene 20 GB gratis (Always Free) y una copia comprimida
ocupa pocos MB; bastaría con subir cada día la última copia con `oci os object put` o `rclone` a un bucket privado
con caducidad de objetos. Contienen correos, nombres y notas del equipo: el bucket no puede ser público.

## Crear el primer administrador

No hay ninguna cuenta. Se crea desde el servidor (la contraseña se genera y se enseña **una sola vez**; cámbiala al
entrar en Mi cuenta):

```bash
cd /opt/reforesta-radar
sudo -u deploy docker compose exec api python -m app.users create-admin tu@correo.org --name "Tu Nombre" --generate
```

Sin `--generate`, en una terminal interactiva, pregunta la contraseña dos veces. Después, entra en
`https://<dominio>/login` e invita al resto desde **Equipo → Invitar** (copia el enlace y mándalo tú). Mantened al
menos dos administradores.

## Cortafuegos: hay dos

1. **Lista de seguridad de la VCN** (consola de Oracle → Networking → Virtual cloud networks → la VCN → Security
   Lists → Default): reglas de entrada TCP 22, 80 y 443 desde `0.0.0.0/0`. No se toca desde el servidor.
2. **iptables del servidor**: la imagen de Ubuntu de Oracle trae reglas propias que rechazan todo salvo SSH.
   `setup-server.sh` añade 80 y 443 antes del `REJECT`, en caliente y en `/etc/iptables/rules.v4` (se cargan al
   arrancar). No uses `netfilter-persistent save`: guardaría también las reglas que Docker crea al arrancar. Los
   puertos publicados por Docker pasan por la cadena `FORWARD`, donde Docker pone sus reglas delante del `REJECT` de
   Oracle.

Si la web no responde desde fuera pero `curl -k --resolve <dominio>:443:127.0.0.1 https://<dominio>/login` funciona
en el servidor, el problema está en uno de los dos cortafuegos.

## Oracle Always Free: límites y riesgos

Según la [documentación de Oracle](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
(consultada el 2026-11-15):

- **Recursos gratis**: Ampere A1 «the first 1,500 OCPU hours and 9,000 GB hours per month for free», es decir
  «equivalent to 2 OCPUs and 12 GB of memory» (lo que tiene esta VM); 200 GB de disco en total (arranque y volúmenes);
  10 TB al mes de tráfico de salida; 20 GB de Object Storage.
- **Una VM inactiva se puede reclamar**: «Idle Always Free compute instances may be reclaimed by Oracle». Se
  considera inactiva si durante 7 días el percentil 95 de CPU está por debajo del 20 %, la red por debajo del 20 % y
  (en A1) la memoria por debajo del 20 %. **El radar cumple las tres**: medido el 2026-11-15 tras la primera carga,
  los cinco contenedores usan unos 300 MB y el sistema 1 GB de 12 (≈ 9 %), y la CPU solo sube durante la carga de
  las 9:00 (unos 2 minutos). Es decir, el riesgo de reclamación es real. Si Oracle avisa por correo de que va a
  reclamarla o la para:
  1. Arrancarla desde la consola (Compute → Instances → Start) si solo está parada; todo vuelve solo (`restart:
     unless-stopped` y el temporizador de copias).
  2. Si se borró: nueva VM Ubuntu 24.04 A1, `setup-server.sh`, `deploy.sh`, restaurar la última copia (por eso hace
     falta la copia fuera del servidor).
  3. Pasar la cuenta a «Pay As You Go» evita la reclamación por inactividad según los foros de Oracle, pero la
     documentación consultada no lo dice: compruébalo antes de contar con ello.
- **No pulses «Upgrade»** a una cuenta de pago sin decidirlo: Oracle dice que no cobra los recursos Always Free tras
  pasar a pago y que «will only charge you for resource usage above the Always Free limits», pero a partir de ahí
  cualquier recurso que se cree por encima de esos límites se factura.
- **Sin redundancia**: una sola VM, un solo disco. Si cae, el radar cae hasta que vuelva. Es ARM (aarch64): las
  imágenes se construyen en el propio servidor.

## Preparar un servidor nuevo desde cero

Ubuntu 24.04 con acceso SSH y `sudo`. Abre 80 y 443 en la lista de seguridad de la VCN y apunta el DNS a la IP.

```bash
sudo git clone https://github.com/Migueldgq/reforesta-radar.git /opt/reforesta-radar
sudo RADAR_DOMAIN=radar.example.org /opt/reforesta-radar/deploy/setup-server.sh
sudo -u deploy /opt/reforesta-radar/deploy/deploy.sh
```

`setup-server.sh` se puede repetir sin miedo: instala Docker desde su repositorio oficial, deja activas las
actualizaciones de seguridad automáticas, abre 80/443 en iptables, crea un swap de 2 GB, el usuario `deploy`, el
`.env` con una contraseña de Postgres aleatoria (no la enseña) y el temporizador de copias. No cambia la zona horaria
(UTC; la app usa `Europe/Madrid` por su cuenta). Después: el primer administrador (arriba), la clave de despliegue
(«Rotar la clave de despliegue») y, si hay datos, restaurar una copia.
