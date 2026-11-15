# 0022. Vídeo de demo generado en local desde la app real

- Estado: Aceptada
- Fecha: 2026-11-14 (a234b59, PR #10; versión actual en 6dfc379, PR #16)

## Contexto
El reto pide un vídeo corto que explique el proyecto. La interfaz cambia a menudo y un vídeo grabado a mano se
queda viejo.

## Decisión
`demo-video/` genera el vídeo a partir de la app real: `capture.mjs` graba cada escena con Chrome (puppeteer-core),
`compose.mjs` monta la composición y HyperFrames la renderiza **en local, sin cuenta, sin clave de API y sin subir
nada** (`demo-video/README.md`). El guion está en `GUION.md` y las licencias del audio en `CREDITS.md`.

## Consecuencias
- El vídeo se vuelve a grabar con un comando cuando cambia la interfaz.
- Los selectores de `CONFIG` en `capture.mjs` se rompen si cambia la interfaz.
- Las cifras del vídeo son las que mostraba la app al grabar.

## Alternativas consideradas
- Grabación manual: motivo no registrado.
