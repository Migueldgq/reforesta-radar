# 0028. Plazo estimado de las convocatorias BDNS sin fecha de cierre

- Estado: Sustituida por 0029
- Fecha: 2026-11-15 (rama `feat/fase-3-mcp`, `SCORING_VERSION` 15)

## Contexto
Muchas fichas BDNS no traen `fechaFinSolicitud`, solo el plazo escrito («Dos meses desde el día siguiente al de la
publicación de la convocatoria en el BOP») en `textInicio` / `textFin`, y casi siempre `abierto: false`. La
puntuación solo las daba por cerradas si BDNS decía «no abierta» y la fecha de inicio tenía 45 días o más; sin fecha
de inicio quedaban en «Sin fecha fija» dentro de «Para pedir ahora». Así seguían como abiertas, por ejemplo, las
bases de Palencia publicadas en diciembre de 2025 con dos meses de plazo (BDNS 874408, nivel alto) y una resolución de
Castilla-La Mancha de enero de 2026 con tres meses (883531). En los datos de noviembre de 2026, 24 de las 37
convocatorias BDNS vivas sin fecha estaban en ese caso.

## Decisión
En `score_convocatoria` (paso 6), una convocatoria sin fecha de cierre, sin inicio futuro y que BDNS no marca como
abierta se juzga con dos datos nuevos de `ScoreInput` que solo rellena el conector BDNS: `fecha_publicacion` (primer
anuncio en un diario oficial; si no hay, `fechaRecepcion`) y `texto_plazo` (`textInicio · textFin`).

- **Plazo legible** (`estimated_end`): un único plazo «N días hábiles / naturales» o «N meses» (es, ca, gl; también
  «mismo ordinal del mes siguiente»), ligado a la publicación. Se cuenta desde la publicación (o desde
  `fechaInicioSolicitud` si existe); los días hábiles solo saltan fines de semana. Si el final estimado ya pasó, la
  convocatoria queda «cerrada» con el aviso «Plazo estimado: cerró hacia el 11 feb 2026 (2 meses desde la
  publicación).». La fecha estimada nunca se guarda como `deadline`. Un «N días» sin decir hábiles o naturales, dos
  plazos distintos o un plazo sin referencia a la publicación no se leen.
- **Sin plazo legible**: publicada hace `STALE_UNDATED_DAYS` (270) días o más, y sin texto de plazo abierto («todo el
  año», «hasta agotar el crédito», «pendiente de…», «convocatoria abierta», «permanente»…), queda «cerrada» con el
  aviso «Probablemente cerrada: sin fecha de cierre y publicada hace N meses; confirmar en las bases.». El umbral sale
  de los datos: el 98 % de las convocatorias BDNS competitivas con fecha (271 de 277) cierran en menos de 270 días
  desde su publicación (mediana 30, percentil 90 114 días).

Si BDNS marca la convocatoria como abierta no se toca: sigue el aviso de conflicto ya existente en `bdns.py`. Al
pasar a «cerrada» se aplican las reglas de siempre (0008): una competitiva para entidades sin ánimo de lucro pasa a
«Próximas ediciones» con su encaje.

## Consecuencias
- En los datos de noviembre de 2026, 24 convocatorias pasan de «Sin fecha fija» a cerradas (23 por plazo estimado, 1
  por antigüedad); ninguna con fecha cambia. Tres de ellas suben de bajo a medio por la regla de 0008.
- La fecha estimada puede desviarse unos días (festivos, fecha real de publicación en el boletín): por eso el aviso
  dice «hacia» y pide confirmar.
- Una convocatoria antigua de verdad permanente cuyo texto no lo diga con esas palabras se dará por cerrada; el aviso
  lo deja ver.
- El cliente no recalcula el estado del plazo (usa `fit.deadlineState`), así que la web no necesita cambios.

## Alternativas consideradas
- Guardar la estimación como `deadline`: la mostraría como fecha exacta; descartado.
- Umbral de 180 días: con los datos de hoy cambia lo mismo, pero el 7 % de las competitivas con fecha siguen abiertas
  a esa edad; se prefirió el umbral más prudente.
- Confiar solo en `abierto: false` para cerrarlas todas: también cerraría las recientes cuyo plazo aún corre;
  descartado.
