# 0027. Tokens personales de acceso para el servidor MCP

- Estado: Aceptada
- Fecha: 2026-11-15 (8d2541f, 5ad24f6; rama `feat/fase-3-mcp`)

## Contexto
La vista de equipo del servidor MCP (0026) muestra el tablero, las notas y los votos. Un cliente MCP no lleva la
cookie de sesión de 0016 y no hay servidor OAuth.

## Decisión
- Cada persona crea sus tokens en «Mi cuenta» (`/api/me/tokens`, sesión por cookie y regla CSRF de 0016; un token
  nunca abre `/api/*`). Se envía como `Authorization: Bearer rr_pat_…` y solo abre `/mcp`.
- `rr_pat_` + 32 bytes aleatorios; en la base solo su sha256 (como las sesiones). Se muestra una vez.
- Caduca siempre: de 1 a 365 días, 90 por defecto (no hay token sin caducidad). Guarda el último uso (como mucho cada
  5 minutos). Máximo 20 activos por persona. Lo revoca su dueño.
- Deja de valer al instante si la cuenta se desactiva, y se revoca siempre que se cierran todas las sesiones de la
  persona: cambio o restablecimiento de contraseña, cambio de rol, desactivación (`revoke_sessions`). Reactivar la
  cuenta no lo recupera.
- Un token no válido es 401 con `WWW-Authenticate: Bearer error="invalid_token"`; 30 fallos por IP en 15 minutos
  dan 429 a esa IP.

## Consecuencias
- Revocación inmediata y una fuga de la base no da tokens usables.
- El token da acceso de lectura al tablero del equipo hasta que caduca: si se filtra (por ejemplo en un archivo de
  configuración del asistente), hay que revocarlo.
- Tras un cambio de contraseña hay que crear tokens nuevos.

## Alternativas consideradas
- OAuth 2.1 como pide la especificación MCP: un servidor de autorización propio para 7 personas; queda para cuando
  haga falta conectar clientes remotos de un clic.
- Aceptar la cookie de sesión en `/mcp`: abre CSRF y los clientes MCP no la tienen.
