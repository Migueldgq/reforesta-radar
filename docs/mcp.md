# Conectar un asistente de IA al radar (MCP)

El radar es también un **servidor MCP de solo lectura**: el asistente de IA que ya usas (Claude Code, Claude Desktop,
claude.ai, Cursor u otro compatible con [MCP](https://modelcontextprotocol.io)) puede buscar convocatorias, leer
fichas e historial y responder cosas como «¿qué hay abierto para charcas en Madrid y qué nos falta para pedirlo?». El
asistente razona; el radar solo le da datos. No hay ninguna llamada a un modelo de IA de nuestro lado y el asistente
no puede cambiar nada. Decisiones: [ADR 0026](adr/0026-servidor-mcp-de-solo-lectura-con-dos-niveles.md) y
[ADR 0027](adr/0027-tokens-personales-para-el-mcp.md).

## Inicio rápido (sin token)

Con Claude Code, una línea (la URL es la de la web más `/mcp`):

```bash
claude mcp add --transport http reforesta-radar http://localhost:3010/mcp
```

En producción, `https://<tu-dominio>/mcp`. Así el asistente ve lo mismo que la portada pública: convocatorias,
programas de empresas, fuentes y las reglas de puntuación, con la nota del servidor.

## Con token: ver también el tablero del equipo

Un token personal añade el tablero (estado, persona asignada, notas), los votos «sirve / no sirve» y las notas con
los ajustes del Perfil del equipo (las mismas que ves en la web).

1. En la web: tu nombre (abajo a la izquierda) → **Mi cuenta** → **Conectar un asistente (MCP)**.
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

## Claude Desktop y claude.ai

- Como **conector personalizado** (Ajustes → Conectores → Añadir) con la URL `https://<tu-dominio>/mcp`: funciona la
  parte pública. Esos conectores autentican con OAuth, que el radar no implementa (ADR 0026), así que no pueden
  enviar el token.
- **Un servidor en `localhost` solo es alcanzable desde el mismo ordenador.** claude.ai se conecta desde los
  servidores de Anthropic: necesita la URL HTTPS pública del radar desplegado.
- Para la vista de equipo en Claude Desktop puede usarse un puente local que añada la cabecera (por ejemplo
  `npx mcp-remote https://<tu-dominio>/mcp --header "Authorization: Bearer rr_pat_…"` en su configuración); no está
  verificado en este proyecto.

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

- **El proveedor de tu asistente ve todo lo que devuelven las herramientas.** Sin token es información pública; con
  token incluye las notas, votos y asignaciones del equipo. No escribáis en las notas nada que no deba salir.
- Las personas aparecen solo por su nombre: nunca correos, tokens ni hashes. Los ganadores de ediciones anteriores
  son solo recuentos por tipo de entidad (la base no guarda nombres de personas físicas).

## Configuración (`.env`)

| Variable | Por defecto | Para qué |
|---|---|---|
| `RADAR_MCP_PUBLIC` | `true` | Herramientas públicas sin token. `false`: todo pide token (401 sin él). |
| `RADAR_MCP_PUBLIC_RATE` | `60` | Peticiones sin token por minuto y por IP (429 después). |
| `RADAR_MCP_URL` | `RADAR_PUBLIC_URL` + `/mcp` | URL que muestra «Mi cuenta» en los comandos. |
| `RADAR_MCP_ALLOWED_HOSTS` / `RADAR_MCP_ALLOWED_ORIGINS` | – | `Host` / `Origin` aceptados además de localhost, `api` y los de `RADAR_PUBLIC_URL` y `RADAR_MCP_URL` (`host:*` = cualquier puerto). Otro `Host` → 421, otro `Origin` → 403. |
| `RADAR_MCP_USER` | – | Solo stdio: correo de la cuenta cuya vista de equipo se usa. |

## Antes de publicarlo en internet

- [ ] `RADAR_PUBLIC_URL` (o `RADAR_MCP_URL`) con la URL https real: de ella salen el `Host` y el `Origin`
      aceptados y los comandos de Mi cuenta.
- [ ] El proxy inverso deja pasar `POST /mcp` sin almacenar la respuesta y sin registrar la cabecera
      `Authorization`.
- [ ] Sin un proxy que fije `X-Forwarded-For` (docs/backend.md), todos los clientes comparten la IP del contenedor
      `web`: el límite sin token (60/min) y el de tokens no válidos (30 en 15 min) son comunes a todos.
- [ ] Decidir si se quiere la parte pública (`RADAR_MCP_PUBLIC`).
- [ ] Explicar al equipo que lo que devuelve el radar con token lo ve el proveedor de su asistente.
