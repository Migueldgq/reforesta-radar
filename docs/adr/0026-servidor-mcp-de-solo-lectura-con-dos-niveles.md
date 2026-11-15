# 0026. Servidor MCP de solo lectura en `/mcp`, con acceso público y de equipo

- Estado: Sustituida por 0035
- Fecha: 2026-11-15 (df1af9d, 5ad24f6, 8334f14, 17fcbc5; rama `feat/fase-3-mcp`)

## Contexto
0025 proponía un servidor MCP para que el asistente de IA que ya usa cada persona del equipo consulte el radar sin
que el proyecto pague un modelo (0006). Faltaba decidir transporte, autenticación y qué datos expone. Las cuentas
(0016) son por cookie, que un cliente MCP no tiene. El responsable del proyecto pidió que conectar no exija crear un
token en el caso común.

## Decisión
- **Dónde:** dentro de la API (mismo contenedor y base de datos), con el SDK oficial `mcp` 2.3.0 (`MCPServer`),
  revisión de la especificación 2026-07-28. Streamable HTTP en `/mcp`, sin estado (`stateless_http`) y con
  respuestas JSON; solo POST (GET y DELETE, 405: no hay flujo abierto por cliente). La web reenvía `/mcp` a la API
  como `/api/*`. Además, stdio para uso local: `python -m app.mcp`.
- **Solo lectura:** seis herramientas anotadas `readOnlyHint` (`buscar_convocatorias`, `ver_convocatoria`,
  `programas_empresas`, `tablero_equipo`, `fuentes`, `perfil_reforesta`), cada una en una transacción
  `SET TRANSACTION READ ONLY`. Reutilizan la lectura y el orden de `/api/oportunidades` (`read_state` + `rank`).
  Salida JSON compacta: textos recortados, búsqueda paginada (20 por defecto, 50 como máximo), sin HTML.
- **Dos niveles:**
  - *Público, sin credenciales* (desactivable con `RADAR_MCP_PUBLIC=false`): convocatorias, programas de empresas,
    fuentes y reglas por defecto. Es lo mismo que ya sirve `/api/public/oportunidades` a la portada (y las reglas,
    que están en el código y en el JS de la web), así que no expone nada nuevo. Nota del servidor, sin el Perfil del
    equipo. Límite por IP (`RADAR_MCP_PUBLIC_RATE`, 60 por minuto).
  - *Equipo, con token personal* (0027) o, en stdio, con `RADAR_MCP_USER`: además el Perfil del equipo aplicado a
    la nota (port en Python de `applyProfileAll` de la web, `app/scoring/team_profile.py`, para que la nota coincida
    con la de la web), el tablero, las notas, los votos y los ajustes del Perfil. Un token no válido es siempre 401,
    nunca una vista pública.
- **Protecciones de `/mcp`:** límite de cuerpo de 1 MiB (el mismo middleware que `/api/`), `Host` y `Origin`
  validados con la protección contra DNS rebinding del SDK (valores de `RADAR_PUBLIC_URL`, `RADAR_MCP_URL` y
  `RADAR_MCP_ALLOWED_HOSTS` / `_ORIGINS`; el `Host` solo cuenta al llamar a la API directamente, porque el rewrite
  de Next lo cambia a `api:8000`: por la web protege el `Origin`), la cookie de sesión no se lee (sin superficie
  CSRF).
- **Fuera:** `analizar_pdf` (descarga PDFs remotos: coste y superficie SSRF por una función que el asistente puede
  hacer con la URL de las bases), escritura de cualquier tipo, el filtro de organismos del equipo en las búsquedas
  (se devuelve en `perfil_reforesta`) y OAuth.

## Consecuencias
- Cualquiera del equipo conecta su asistente con una línea (`claude mcp add --transport http …/mcp`) y, si quiere
  el tablero, con un token.
- El proveedor del asistente ve lo que devuelven las herramientas, incluidas las notas del equipo con token.
- La autenticación no es la de la especificación (OAuth 2.1 con metadatos RFC 9728): los conectores remotos de un
  clic (Claude Desktop o claude.ai como «custom connector») solo funcionan con la parte pública. OAuth queda como
  opción futura.
- El port del Perfil duplica lógica de la web: un cambio en `src/components/radar/profile.ts` hay que repetirlo.
- El límite por IP se comparte cuando todos llegan por el mismo proxy (ver 0016 sobre `X-Forwarded-For`).

## Alternativas consideradas
- Todo con token: más fricción para datos que ya son públicos.
- Servidor aparte: otro servicio que desplegar para la misma base de datos.
- Devolver la nota del servidor también al equipo: la web y el asistente darían notas distintas.
