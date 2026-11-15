# 0033. Analizar PDF: la nota del radar cuando el PDF es de una convocatoria suya

- Estado: Aceptada
- Fecha: 2026-11-15 (rama `feat/fase-4-cierre`)

## Contexto
El analizador de [0019](0019-analizador-pdf-por-reglas-con-proteccion-ssrf.md) puntuaba siempre el texto del PDF con
el título y el organismo que encontraba en la cabecera. Abierto desde una convocatoria del radar, ignoraba lo que el
radar ya sabía de ella. El ejemplo «MITECO 923290» (una ficha BDNS de tres páginas, 2.200 caracteres) sacaba 25
«bajo» cuando la misma convocatoria tiene 86 «alto» en la lista. Sin organismo reconocido, el PDF recibía el motivo
«No es de los organismos que ya revisáis a mano…» con su bonificación, y la portada prometía «la misma puntuación que
el resto del radar».

## Decisión
- Si el PDF es de una convocatoria guardada (por el `docId` con que la web lo pide o por el código BDNS impreso en el
  PDF), la ficha lleva la nota de esa convocatoria tal como sale en la lista (pasos geográfico, de tipo e historial),
  con su título y organismo. `scoreSource: "radar"` y `callId`.
- Si no, se puntúa el texto del PDF (`scoreSource: "pdf"`). Sin organismo reconocido no hay motivo ni bonificación
  de «organismos que revisáis a mano».
- Con menos de 3.000 caracteres de texto no se puntúa (`scoreSource: "none"`, nota 0 y el aviso «No hemos podido
  leer lo suficiente de este PDF para puntuarlo.»).
- La caché de descargas guarda el texto extraído, no la ficha, para que la nota siga a la de la lista tras cada
  ingesta.

## Consecuencias
- «La misma nota que en la lista» solo es cierta para PDF de convocatorias del radar; la portada debe decirlo así.
- La ficha del ejemplo de Madrid baja de 84 a 80: su organismo es ahora la Consejería completa y, al ser de la
  Comunidad de Madrid, es de los que el equipo ya revisa (sin la bonificación de +4).
- La nota «radar» va sin el ajuste del Perfil; la web lo aplica como a la lista.
- 3.000 caracteres es un umbral elegido sobre los dos ejemplos (2.200 y 34.000); motivo del número exacto no
  registrado.

## Alternativas consideradas
- Leer la ficha BDNS impresa campo a campo: el orden del texto depende del extractor de PDF y cambia entre versiones.
- Mezclar los datos de la convocatoria con el texto del PDF y volver a puntuar: daría una nota distinta de la de la
  lista para la misma convocatoria, que es justo lo que se quería evitar.
