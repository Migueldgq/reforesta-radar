# 0043. Panel de Dokploy en un dominio público, con 2FA obligatorio y límites de peticiones

- Estado: Aceptada
- Fecha: 2026-11-15 (rama `feat/panel-dominio`)
- Sustituye en parte a: [0039](0039-despliegue-con-dokploy.md), solo el punto «El panel no se publica»; el resto de
  0039 sigue vigente.

## Contexto
ADR 0039 dejó el panel de Dokploy solo detrás de un túnel SSH (`127.0.0.1:3000`), sin ruta en Traefik, porque el
panel equivale a root en la máquina y la cuenta aún no tenía 2FA; publicarlo con dominio y 2FA obligatorio quedó como
opción documentada. El responsable ha decidido publicarlo en `https://panel.miguelddev.com` para entrar desde
cualquier sitio, también desde el móvil, donde el túnel no es práctico. El asistente recomendó seguir con el túnel; el
responsable eligió la comodidad, con la condición de que el panel solo se publique con 2FA activado en su cuenta.
Hay un registro DNS `A` `panel.miguelddev.com` → la IP del servidor (sin `AAAA` ni `CAA`).

Comprobado el 2026-11-15 en la base de datos de Dokploy (solo recuentos): primero 1 cuenta en el panel y 0 con 2FA
(no se publicó); después de que el responsable lo activara, 1 de 1 con 2FA verificado. Publicado ese mismo día con
`sudo reforesta-panel public`.

## Decisión
- **Ruta propia de Traefik en el repositorio**, `deploy/traefik-panel.yml`, que se copia a
  `/etc/dokploy/traefik/dynamic/reforesta-panel.yml`: ``Host(`panel.miguelddev.com`)`` solo en el punto de entrada
  https, certificado del resolvedor `letsencrypt` que ya existe (cuenta ACME sin correo, `deploy/traefik.yml`), y en
  http solo una redirección 301 a https. Ningún otro nombre (la IP, `dokploy.docker.localhost`, el dominio del radar,
  nombres desconocidos) llega al panel; `dokploy.yml` sigue solo con comentarios.
- **No se usa «Server Domain» de Dokploy** (Settings → Web Server). Dokploy solo escribe `dokploy.yml` y
  `middlewares.yml` en ese directorio: al arrancar si faltan, y al guardar ese ajuste (comprobado en el código de
  v0.31.2: `createDefaultServerTraefikConfig`, `createDefaultMiddlewares`, `updateServerTraefik`). Un fichero propio
  con nombres propios (`panel-*`) no lo toca nadie al reiniciar Dokploy, al reiniciar la máquina ni con
  `install.sh update`, vive en git y lleva límites y cabeceras que el ajuste de Dokploy no permite.
- **Un interruptor**, `deploy/panel.sh` instalado por `setup-server.sh` como `reforesta-panel`:
  `public` instala la ruta **solo si todas las cuentas del panel tienen 2FA** (cuenta filas de `user` con
  `two_factor_enabled`, sin leer su contenido); `private` la borra; `status` dice cuál rige. Traefik vigila el
  directorio: el cambio se nota en segundos, sin reiniciar nada ni cortar el radar. `setup-server.sh` no publica el
  panel por su cuenta; si ya estaba publicado, refresca la ruta desde el repositorio.
- **Límites por IP del cliente** (middleware `rateLimit` de Traefik, IP de la conexión TCP, nunca
  `X-Forwarded-For`): 20 peticiones/s de media con ráfagas de 200 en todo el panel (cargar el panel pide unos cien
  ficheros a la vez; luego consulta unas pocas veces por segundo; cada websocket de logs o terminal es una petición), y
  5 por minuto con ráfagas de 10 en `/api/auth/sign-in`, `/sign-up`, `/two-factor`, `/request-password-reset` y
  `/reset-password`. Por encima, 429; se recupera solo.
- **Cabeceras:** HSTS de un año, `nosniff`, `X-Frame-Options: DENY` (Dokploy ya lo manda, con `frame-ancestors
  'none'`), `Referrer-Policy: no-referrer` (sustituye la de Dokploy) y `X-Robots-Tag: noindex, nofollow`. Sin panel ni
  API de Traefik y sin log de accesos, como en 0039.
- **IP real:** Traefik descarta el `X-Forwarded-For` que mande el cliente y pone el de la conexión (0039); Dokploy
  (better-auth) limita por la primera IP de esa cabecera. El túnel no pasa por Traefik y sigue siendo la entrada de
  emergencia: el puerto 3000 sigue publicado solo hacia el propio servidor (`DOCKER-USER`), cerrado desde fuera.
- **Sin registro abierto:** con una cuenta de propietario creada, `/register` redirige a `/` (comprobado en el
  servidor) y `/api/auth/sign-up/email` responde «Admin is already created» salvo con una invitación válida que el
  propio administrador genera (comprobado en el código de v0.31.2, sin crear cuentas).

## Consecuencias
- Se entra al panel desde cualquier navegador, también el móvil, sin cliente SSH.
- **Riesgo aceptado:** el inicio de sesión de un panel equivalente a root queda expuesto a internet. Una
  vulnerabilidad de autenticación de Dokploy (o de better-auth) pasaría a ser explotable desde fuera, sin túnel. Se
  mitiga con 2FA obligatorio, los límites de arriba y **Dokploy al día** (`install.sh update` de una versión fijada,
  como dice 0039); si se publica un fallo grave sin parche, `sudo reforesta-panel private` hasta poder actualizar.
- Protecciones propias de Dokploy v0.31.2 (better-auth 1.6.23, valores por defecto, en memoria: se reinician con el
  servicio): 3 intentos cada 10 s por IP en `/sign-in`, `/sign-up` y `/two-factor/*`; 100 peticiones cada 10 s en el
  resto de `/api/auth`; tras 10 códigos 2FA fallidos seguidos, la cuenta se bloquea 15 minutos. No hay bloqueo de
  cuenta por contraseñas fallidas: lo frenan solo los límites por IP.
- Dokploy autoalojado pone sus cookies de sesión sin `Secure` (`useSecureCookies: false`); con HSTS el navegador no
  vuelve a pedir el panel por http después de la primera visita.
- El certificado de `panel.miguelddev.com` aparece en los registros públicos de Certificate Transparency: el nombre
  del panel deja de ser discreto.
- Una dirección más que vigilar: `deploy/smoke.sh` comprueba que `Host: dokploy.docker.localhost` no llega al panel y,
  con `PANEL_URL`, que el panel responde con HSTS.
- **Volver a privado en un paso:** `sudo reforesta-panel private` (o borrar
  `/etc/dokploy/traefik/dynamic/reforesta-panel.yml`).

## Alternativas consideradas
- Seguir solo con el túnel SSH (0039): lo recomendó el asistente; el responsable lo descartó por comodidad (entrar
  desde el móvil).
- «Server Domain» de Dokploy: su configuración vive solo en la base de datos del panel, reescribe `dokploy.yml` y no
  admite límites de peticiones ni cabeceras.
- Publicar sin 2FA: descartado por el propio responsable; el interruptor se niega a hacerlo.
