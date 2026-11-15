# 0004. Next.js solo como frontend que reenvía `/api/*`

- Estado: Aceptada
- Fecha: 2026-11-15 (74f7b9e, PR #23)

## Contexto
Con el backend en Python (0003), las rutas de API de Next.js sobraban. El navegador necesita seguir llamando a un
único origen (cookies de sesión, sin CORS en producción).

## Decisión
`src/` es solo interfaz. `next.config.ts` reescribe `/api/:path*` a `${API_URL}/api/:path*` y compila con
`output: "standalone"`. `API_URL` se fija al construir la imagen (las rewrites se serializan en `next build`) y al
ejecutar (la portada lee la API en el servidor). `proxyClientMaxBodySize` es `16mb` para que quepan PDFs de 15 MB.

## Consecuencias
- El navegador nunca llama al puerto de la API; la cookie de sesión y la comprobación CSRF funcionan en el mismo
  origen (ver 0016).
- Cambiar `API_URL` obliga a reconstruir la imagen `web`.
- Next reenvía la cabecera `X-Forwarded-For` del cliente sin fijarla: sin un proxy inverso delante, el límite de
  intentos por IP no es fiable (riesgo listado en `docs/backend.md`).

## Alternativas consideradas
- Llamar a la API directamente desde el navegador con CORS: motivo no registrado.
