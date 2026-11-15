# 0029. Plazo estimado: se guarda como fecha de cierre, marcado como estimado

- Estado: Aceptada
- Fecha: 2026-11-15 (rama `feat/fase-4-cierre`, `SCORING_VERSION` 16)

## Contexto
Convivían dos mecanismos contradictorios para las convocatorias BDNS sin `fechaFinSolicitud`:

- uno antiguo en `bdns.py` (heredado del TypeScript) que leía «N días» de `textFin`, lo contaba desde la fecha de
  registro en BDNS y **guardaba el resultado como `deadline`**, con el aviso «Fecha límite estimada a partir de
  «…»: confirmar en el extracto oficial». La web y el asistente lo enseñaban como una fecha exacta («18 de noviembre
  de 2026 · 3 días»), y la cita salía cortada porque BDNS trunca `textFin` a 100 caracteres («…y del extracto de»);
- el de [0028](0028-plazo-estimado-de-las-convocatorias-sin-fecha.md), que decía que una estimación nunca se guarda
  como `deadline` y solo la usaba para dar la convocatoria por cerrada.

En los datos de noviembre de 2026, 105 convocatorias visibles pasaban por el mecanismo antiguo. La fecha estimada es
útil (ordenar por cierre, «cierra en N días»), así que se mantiene, pero tiene que verse como estimación.

## Decisión
Un solo mecanismo, en `detail_to_raw` (`bdns.py`), para toda convocatoria BDNS sin fecha de cierre:

1. Si `textFin` trae una fecha escrita («15/12/2026», «Línea 2- 31.10.26»), es la fecha de cierre **declarada**.
2. Si no, el plazo («10 días hábiles desde la publicación», «Un mes», «Diez días (10) naturales») se lee con
   `estimated_end` (el lector de 0028) desde la primera publicación en un diario oficial (o desde
   `fechaInicioSolicitud`). El resultado se guarda como `deadline` y el ítem lleva **`deadlineEstimated: true`**.
   Un «N días» sin decir hábiles o naturales se cuenta como hábiles: es la regla general del art. 30.2 de la Ley
   39/2015. Siguen sin leerse dos plazos distintos y un plazo que no cuenta desde la publicación (por ejemplo,
   «desde la fecha del ataque»).
3. Si BDNS marca la convocatoria como abierta y la fecha leída ya pasó, no se guarda fecha y se avisa del conflicto
   (como antes), citando el texto con `excerpt` (corta en una palabra y añade «…» si BDNS lo truncó).

`deadlineEstimated` llega a todas partes donde se ve la fecha: en la API (campo del ítem), en los motivos
(«Plazo abierto: quedan unos 3 días (fecha estimada).», «Cierra en unos 3 días (fecha estimada): valorar si da
tiempo.», «la edición actual cerró hacia el 11/2/2026 (fecha estimada)»), en un aviso con el plazo leído («Fecha de
cierre estimada: 10 días hábiles desde la publicación, hacia el 18 nov 2026. BDNS no da la fecha exacta: confirmar en
el extracto oficial.») y en el servidor MCP (`cierreEstimado: true`, más `cierreNota` en la ficha, y la instrucción
de no darla como exacta). BOE, BOCM y DOG, que ya estimaban desde la fecha del boletín, marcan igual sus fechas
estimadas. El paso 6 de `score_convocatoria` deja de estimar por su cuenta: solo conserva la regla de antigüedad de
0028 (sin plazo legible y publicada hace 270 días o más, «Probablemente cerrada»).

## Consecuencias
- 116 convocatorias BDNS llevan `deadlineEstimated` en los datos de noviembre de 2026. Cambia una nota (BDNS 910779,
  38 → 42, de bajo a medio: un plazo «de un mes» que ahora se lee y la da por cerrada como edición periódica). Los
  niveles pasan de 37/196/94 a 37/197/93.
- Contra las 90 convocatorias BDNS en caché que sí traen fecha oficial y un plazo legible, la estimación acierta el día
  en 58, se queda a 2 días o menos en 80 y a 5 o menos en 88; tiende a quedarse corta (festivos, cómputo de meses), lo
  que es el lado prudente. Dos casos se desvían meses: BDNS registró como fin una fecha muy posterior al plazo
  escrito.
- La web debe enseñar `deadlineEstimated` («hacia el 18 nov · fecha estimada») en lugar de la fecha exacta.
- El campo no entra en el hash de contenido cuando es `false`, así que las filas antiguas no cuentan como cambiadas.

## Alternativas consideradas
- No guardar la estimación (0028): se pierde el orden por cierre y «cierra en N días»; descartado.
- Seguir contando desde la fecha de registro en BDNS (mecanismo antiguo): la publicación en el diario es la que abre
  el plazo; descartado.
- Contar el «N días» sin calificar como naturales (lo que hacía el mecanismo antiguo): contradice la regla general de
  la Ley 39/2015; descartado.
