# Conectar un asistente de IA al radar (MCP)

El radar es también un **servidor MCP de solo lectura**: el asistente de IA que ya usas (Claude Code, Claude Desktop,
claude.ai, Cursor u otro compatible con [MCP](https://modelcontextprotocol.io)) puede buscar convocatorias, leer
fichas e historial y responder cosas como «¿qué hay abierto para charcas en Madrid y qué nos falta para pedirlo?». El
asistente razona; el radar solo le da datos. No hay ninguna llamada a un modelo de IA de nuestro lado y el asistente
no puede cambiar nada. Decisiones: [ADR 0026](adr/0026-servidor-mcp-de-solo-lectura-con-dos-niveles.md),
[ADR 0027](adr/0027-tokens-personales-para-el-mcp.md) y [ADR 0035](adr/0035-iniciar-sesion-desde-el-asistente-oauth.md).
Guía paso a paso para el equipo, sin tecnicismos: [guia-asistente.md](guia-asistente.md).

## Dos direcciones

| Dirección | Qué ve el asistente | Cómo entra |
|---|---|---|
| `https://<tu-dominio>/mcp/equipo` | Todo: convocatorias, programas, fuentes y además el tablero del equipo, notas, votos y las notas con el Perfil del equipo | **Inicia sesión con tu cuenta del radar** desde el asistente (o un token personal) |
| `https://<tu-dominio>/mcp` | Solo lo público (lo mismo que la portada) | Sin credenciales (o con token personal para la vista de equipo, como antes) |

La del equipo nunca responde sin credenciales: devuelve 401 y el asistente abre la página de entrada del radar. La
pública nunca pide iniciar sesión. Son dos conectores distintos: el equipo usa la primera.

## Conectar con inicio de sesión (lo normal)

**claude.ai o Claude Desktop** (necesita el radar publicado en internet con https):

1. Ajustes → Conectores → **Añadir conector personalizado**.
2. Nombre: «Reforesta Radar». URL: `https://<tu-dominio>/mcp/equipo`. Sin tocar las opciones avanzadas.
3. **Conectar**: se abre el radar; entra con tu correo y contraseña y pulsa **Permitir**.

**Claude Code** (vale también con el radar en `http://localhost`, en el mismo ordenador):

```bash
claude mcp add --transport http reforesta-radar https://<tu-dominio>/mcp/equipo
```

Luego, dentro de Claude Code, `/mcp` → `reforesta-radar` → **Authenticate** (o `claude mcp login reforesta-radar`).
Se abre el navegador; entra y pulsa **Permitir**. `claude mcp list` debe decir «Connected».

Qué pasa por debajo (OAuth 2.1, revisión 2026-07-28 de la especificación MCP; detalle en el ADR 0035):

| Paso | Ruta |
|---|---|
| Sin credenciales, 401 con `WWW-Authenticate: Bearer resource_metadata="…", scope="radar:leer"` | `POST /mcp/equipo` |
| Metadatos del recurso (RFC 9728) | `GET /.well-known/oauth-protected-resource/mcp/equipo` (y la raíz) |
| Metadatos del servidor de autorización (RFC 8414); emisor = `RADAR_PUBLIC_URL` | `GET /.well-known/oauth-authorization-server` |
| Registro del asistente (RFC 7591) | `POST /oauth/register` |
| Autorización con PKCE S256 → página `/autorizar` de la web, tras el login | `GET /oauth/authorize` |
| Código → token de acceso (1 h, solo para `/mcp/equipo`) + refresco (rotado) | `POST /oauth/token` |
| Revocar (toda la concesión) | `POST /oauth/revoke` |

Los errores de `/oauth/authorize` antes de que decidas se muestran en una página del radar; nunca se redirige con un
error a la dirección del cliente salvo si es de tu ordenador (loopback). Los límites solo frenan peticiones que
fallan: una petición correcta pasa siempre, y `/mcp/equipo` responde 401 (nunca 429) a un token caducado.

Los asistentes conectados se ven y se desconectan en **Mi cuenta → Conectar un asistente**. Se desconectan solos al
cambiar o restablecer la contraseña, al cambiar de rol o al desactivar la cuenta.

## Con token personal (uso técnico)

Para clientes que no saben iniciar sesión. Un token personal añade el tablero (estado, persona asignada, notas), los
votos «sirve / no sirve» y las notas con los ajustes del Perfil del equipo (las mismas que ves en la web), en
cualquiera de las dos direcciones.

1. En la web: tu nombre (abajo a la izquierda) → **Mi cuenta** → **Conectar un asistente** → **Para uso técnico**.
2. Ponle un nombre («Claude en mi portátil»), elige caducidad (30 días, 90 o 1 año) y **Crear token**.
3. Copia el token o el comando ya preparado. **Solo se muestra una vez.**

```bash
claude mcp add --transport http reforesta-radar https://<tu-dominio>/mcp --header "Authorization: Bearer rr_pat_…"
```

Otros clientes que aceptan una configuración JSON con cabeceras:

```json
{ "mcpServers": { "reforesta-radar": { "type": "http", "url": "https://<tu-dominio>/mcp",
  "headers": { "Authorization": "Bearer rr_pat_…" } } } }
```

- Trátalo como una contraseña. Si se filtra, revócalo en Mi cuenta.
- Caduca en la fecha elegida, deja de valer si te desactivan la cuenta y **se revoca al cambiar o restablecer la
  contraseña** (y al cambiarte el rol): crea uno nuevo después.
- Un token caducado o revocado no pasa a vista pública: el asistente recibe un error 401 y debes cambiarlo.

## Sin iniciar sesión (solo datos públicos)

```bash
claude mcp add --transport http reforesta-radar-publico https://<tu-dominio>/mcp
```

O como conector personalizado en claude.ai con esa URL. Así el asistente ve lo mismo que la portada pública:
convocatorias, programas de empresas, fuentes y las reglas de puntuación, con la nota del servidor.

## Dónde funciona cada cliente

- **claude.ai y Claude Desktop** se conectan desde los servidores de Anthropic, no desde tu ordenador: necesitan la
  URL **https pública** del radar desplegado. Un radar en `localhost` no les llega (haría falta un túnel).
- **Claude Code** se conecta desde tu ordenador: vale con `http://localhost:3010/mcp/equipo` en local.
- En planes Team o Enterprise de Claude, el conector personalizado lo añade un propietario de la organización; luego
  cada persona pulsa **Conectar** con su cuenta del radar.

## Modo local por stdio

Para quien tiene el radar en su ordenador (lee la base de datos directamente, así que no pide token):

```bash
claude mcp add reforesta-radar-local -- docker compose -f /ruta/a/reforesta/docker-compose.yml run --rm -T api python -m app.mcp
```

Solo la parte pública. Para la vista de equipo, añade `-e RADAR_MCP_USER=<correo de una cuenta activa>` tras `-T`.

## Herramientas

Todas son de solo lectura (anotadas `readOnlyHint`) y devuelven JSON compacto (textos recortados, sin HTML).

| Herramienta | Qué devuelve | Pregunta de ejemplo |
|---|---|---|
| `buscar_convocatorias` | Filas compactas: título, organismo, territorio, estado, cierre y días restantes, cuándo suele abrir, importe, nota, 1-2 motivos, url oficial. Filtros: texto (alternativas con `\|`), estado, territorio, línea de trabajo, fuente, organismo, nota mínima, cierra antes de, tipo; orden por encaje, cierre o recientes; 20 por página (máx. 50) con `desde`. | «¿Qué hay abierto para charcas o anfibios en Madrid?» |
| `ver_convocatoria` | La ficha de la web: motivos y avisos de la nota, fechas, importe, beneficiarios, documentos, programa (empresas) e historial BDNS (cuándo suele abrir, plazo habitual, quién ganó por tipo de entidad, si Reforesta ganó y cuánto, ONG afines). Con token: estado en el tablero, asignada, notas y votos. | «¿Cuándo suele abrir la de proyectos ambientales de la Comunidad de Madrid y la ha ganado Reforesta?» |
| `programas_empresas` | Programas de fundaciones y empresas comprobados a mano: requisitos, límites, territorio, última ventana, fecha de comprobación (`verifiedOn`) y lo no comprobado. | «¿Qué fundaciones financian reforestación?» |
| `tablero_equipo` | **Solo con token.** Recuento por estado y filas con asignada, cierre, nº de notas y la última nota; filtros por estado y persona. | «¿Qué tenemos en estudio y quién lo lleva?» |
| `fuentes` | Estado de cada fuente en la última carga y hora de la última carga correcta. | «¿De cuándo son los datos?» |
| `perfil_reforesta` | Quién es Reforesta y cómo se puntúa (líneas de trabajo y pesos, excluyentes, territorio, niveles). Con token: los ajustes del Perfil del equipo. | «¿Por qué esta tiene un 45?» |

Fuera, a propósito: analizar PDFs (descarga archivos remotos: coste y riesgo SSRF; el asistente puede abrir la URL de
las bases), cualquier escritura y el filtro de organismos del equipo en las búsquedas.

## Privacidad

- **El proveedor de tu asistente ve todo lo que devuelven las herramientas.** Sin credenciales es información
  pública; con sesión iniciada o con token incluye las notas, votos y asignaciones del equipo. No escribáis en las notas nada que no deba salir.
- Las personas aparecen solo por su nombre: nunca correos, tokens ni hashes. Los ganadores de ediciones anteriores
  son solo recuentos por tipo de entidad (la base no guarda nombres de personas físicas).

## Configuración (`.env`)

| Variable | Por defecto | Para qué |
|---|---|---|
| `RADAR_MCP_PUBLIC` | `true` | Herramientas públicas sin token. `false`: todo pide token (401 sin él). |
| `RADAR_MCP_PUBLIC_RATE` | `60` | Peticiones sin token por minuto y por IP (429 después). |
| `RADAR_MCP_URL` | `RADAR_PUBLIC_URL` + `/mcp` | URL pública del servidor MCP; la del equipo es esta + `/equipo` (y es la audiencia de los tokens de acceso). Si está en otro dominio, ese dominio tiene que llevar `/mcp/equipo` y `/.well-known/oauth-protected-resource/mcp/equipo` a la API. |
| `RADAR_MCP_ALLOWED_HOSTS` / `RADAR_MCP_ALLOWED_ORIGINS` | – | `Host` / `Origin` aceptados además de localhost, `api` y los de `RADAR_PUBLIC_URL` y `RADAR_MCP_URL` (`host:*` = cualquier puerto). Otro `Origin` → 403; otro `Host` → 421, pero solo al llamar al puerto de la API directamente: a través de la web el rewrite de Next cambia el `Host` a `api:8000`, así que ahí protege solo el `Origin`. |
| `RADAR_MCP_OAUTH` | `true` | Iniciar sesión desde el asistente en `RADAR_MCP_URL` + `/equipo`. Solo funciona con `RADAR_PUBLIC_URL` en https (o `http://localhost` para uso local); con `RADAR_COOKIE_SECURE=true` y una URL http queda apagado. |
| `RADAR_MCP_USER` | – | Solo stdio: correo de la cuenta cuya vista de equipo se usa. |

## Antes de publicarlo en internet

- [ ] `RADAR_PUBLIC_URL` (o `RADAR_MCP_URL`) con la URL https real: de ella salen el `Host` y el `Origin`
      aceptados y los comandos de Mi cuenta.
- [ ] El proxy inverso deja pasar `POST /mcp` sin almacenar la respuesta y sin registrar la cabecera
      `Authorization`.
- [ ] Hasta que un proxy inverso dé la IP real del cliente, todos los que llegan por la web comparten la IP del
      contenedor `web`: el cupo sin token (60/min) es uno para todos, y los tokens no válidos de cualquiera agotan
      los 30 en 15 min para todos (un token válido nunca se rechaza por eso). Para tener IP real:
      - el proxy **sobrescribe** `X-Forwarded-For` (nginx: `proxy_set_header X-Forwarded-For $remote_addr;`, no
        `$proxy_add_x_forwarded_for`, que añade a lo que mande el cliente);
      - `FORWARDED_ALLOW_IPS` = red de compose (p. ej. `172.16.0.0/12`);
      - el contenedor `web` no es alcanzable sin pasar por el proxy (puerto publicado solo en `127.0.0.1` o sin
        publicar). Si no, Next solo pone `X-Forwarded-For` cuando falta, la cabecera la decide el cliente y todos
        los límites (también el de login) se saltan cambiándola.
- [ ] Tiempos máximos de petición y de lectura del cuerpo en el proxy (las respuestas de `/mcp` son JSON, no
      streams: unos segundos bastan).
- [ ] Opcional: caché corta en el proxy para `GET /api/public/oportunidades` (es igual para todos).
- [ ] Decidir si se quiere la parte pública (`RADAR_MCP_PUBLIC`).
- [ ] Explicar al equipo que lo que devuelve el radar con token lo ve el proveedor de su asistente.
- [ ] Inicio de sesión desde el asistente (ADR 0035): `RADAR_PUBLIC_URL=https://…` exacta (es el emisor OAuth; los
      clientes la comparan letra a letra) y `RADAR_COOKIE_SECURE=true`. Comprobar
      `curl https://<dominio>/.well-known/oauth-authorization-server` y que `POST /mcp/equipo` sin credenciales da 401
      con `resource_metadata`.
- [ ] El proxy reenvía `/mcp/equipo`, `/.well-known/oauth-*` y `/oauth/*` sin caché, y **no registra** la cadena de
      consulta de `/autorizar` (lleva el id de la solicitud) ni los cuerpos de `/oauth/token` (códigos, refrescos).
- [ ] claude.ai llega desde la red de Anthropic (`160.79.104.0/21` según su documentación): no bloquearla si hay
      cortafuegos.
- [ ] Detrás del proxy de la web todas las peticiones llegan con la misma IP: los límites de OAuth solo frenan fallos
      y nunca una petición correcta; el registro no tiene límite global (la tabla se acota sola, ADR 0035
      «Límites»). Si un proxy de confianza da la IP real, poned `FORWARDED_ALLOW_IPS` con su dirección y se añade un
      límite de 10 registros por IP.
- [ ] Con varias réplicas de la API, los límites (registro, autorización, fallos en `/oauth/token`) son por
      proceso: con una sola instancia, como hoy, no hace falta nada.
