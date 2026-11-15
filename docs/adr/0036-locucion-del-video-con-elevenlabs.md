# 0036. Locución del vídeo de demo con ElevenLabs, una frase por archivo

- Estado: Aceptada
- Fecha: 2026-11-15 (rama `feat/video-narrado`)

## Contexto
El vídeo de demo (ADR 0022) era de 88 s, solo con titulares, música y efectos. Para el público de Reforesta y del
jurado, muchas personas no técnicas, hace falta una versión más larga que lo explique con voz. ADR 0022 pide que todo
se genere en local, sin cuenta ni clave de API.

Se probaron voces gratuitas y locales para castellano: Kokoro-82M (`ef_dora`, `em_alex`, `em_santa`; Apache-2.0),
Piper (`es_ES-davefx-medium`, `es_ES-sharvard-medium`) y las voces de macOS (Mónica, Eddy, Flo). El responsable del
proyecto las escuchó y no quiso ninguna como voz final. Eligió una voz de la biblioteca de ElevenLabs en castellano de
España, «Emilio – Warm, Solid and Convincing» (`ZCh4e9eZSUf41K4cmCEL`), con su propia cuenta de pago (plan Starter, que
incluye licencia comercial).

## Decisión
- La locución es **una frase por archivo de audio** en `demo-video/voice/NN-<momento>.<wav|mp3|…>` (fuera de git).
  `scenes.mjs` guarda el texto de cada frase; `GUION-VOZ.md` (generado) dice qué frase va en qué archivo, con notas de
  pronunciación aparte.
- **La voz marca el ritmo**: `capture.mjs` marca dónde empieza cada frase (`say k`) y espera a que termine;
  `compose.mjs` mide los archivos reales, coloca cada frase y, si una voz nueva dura más, congela la imagen en esa marca
  (`<id>.rt.mp4`) en vez de volver a grabar. Cambiar los archivos de voz y renderizar basta para rehacer tiempos y mezcla.
- La voz final se genera con `demo-video/elevenlabs.py` (API de ElevenLabs, modelo `eleven_v4`, `language_code` `es`,
  una petición por frase con la frase anterior y la siguiente como contexto, caché por texto). Solo se envía el texto de
  la locución; la clave se lee de `~/.elevenlabs.env` y no entra en el repositorio.
- La versión local y gratuita (`demo-video/voice.py`, Kokoro-82M) se mantiene como **borrador** para ajustar tiempos
  sin gastar créditos, y para comprobar cada frase con reconocimiento de voz local (Whisper `large-v3-turbo` con MLX).
- Mezcla: la voz encima (−16 LUFS la pista de voz), la música bajada 13 dB bajo cada frase, el conjunto a −16 LUFS
  integrados y pico real por debajo de −1 dBTP. Subtítulos en `out/demo-final.es.srt`, sin quemar.

## Consecuencias
- Es una excepción a «sin cuenta ni clave de API» de ADR 0022, solo para la voz: el resto del vídeo sigue saliendo en
  local de la app real.
- Rehacer la voz final cuesta créditos de ElevenLabs (unos 3 000 caracteres el guion entero) y necesita una cuenta con
  acceso a voces de la biblioteca (el plan gratuito las rechaza por API). Cualquier otra voz, también una grabada a
  mano, sirve guardándola con los mismos nombres.
- Los modelos locales (unos 2 GB entre Kokoro, Whisper y Piper) y el audio generado no se versionan: el README dice cómo
  volver a obtenerlos.
- Nadie ha comprobado de oído la pronunciación de siglas (MCP, PDF, BOE) en la voz final; el reconocimiento de voz las
  transcribe bien, pero no distingue «eme ce pe» de una lectura en inglés.

## Alternativas consideradas
- Kokoro-82M, Piper o voces de macOS como voz final: gratis y en local, pero el responsable del proyecto no las quiso
  tras escucharlas; además, las voces de macOS solo se pueden usar en contenido personal no comercial.
- Voces prediseñadas de ElevenLabs en el plan gratuito: acento castellano no garantizado y uso solo no comercial.
- Grabar la voz una persona: motivo no registrado (los archivos por frase lo siguen permitiendo).
