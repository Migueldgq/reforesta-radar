# Guion del vídeo de demo — Reforesta Radar (v4, vídeo de lanzamiento)

Duración: **≈58 s** (57,9 s). 1920×1080, 30 fps, H.264 + AAC, `faststart`. Mismo formato que la v3: lienzo blanco, un titular corto por momento (se escribe letra a letra, palabras clave en verde) y debajo **una pieza recortada de la app real**, con la cámara que entra y se desplaza. Cambios entre momentos con desenfoque y escala; una sección en lienzo verde con barrido circular de entrada y salida. Música de fondo + tecleo, clics, *whoosh* y *pop*. La v3 se conserva en `out/demo-v3.mp4`.

Los ids y textos son los de `scenes.mjs`. La duración de cada momento de pantalla sale de la grabación (`captures/<id>.json`); los tiempos de abajo son los de la versión renderizada y cambian si se vuelve a capturar. Las cifras de los titulares (`{fuentes}`, `{total}`) salen de la app al capturar (`captures/facts.json`), nunca se escriben a mano. La app se graba con la sesión de una cuenta de demostración (ficticia) y un tablero de ejemplo: ver «Datos de demostración» en `README.md`.

| t (s) | id | En pantalla | Titular |
|---|---|---|---|
| 0,0 | `intro` | Salta la marca (cuadrado verde con el brote) y se escribe «Reforesta Radar», centrados. | — |
| 1,9 | `statement` | Dos líneas centradas; la segunda en verde. | «7 fuentes, 323 convocatorias / *y un equipo de siete.*» |
| 4,8 | `inicio` | `/`: cabecera «323 oportunidades de 7 fuentes · datos de hace …» y las cuatro tarjetas (35 · 14 · 34 · 252); la cámara baja al aviso «Ahora mismo no hay convocatorias abiertas con encaje alto…» y a las primeras filas. | «Las lee *cada mañana*» → «Si hoy no hay nada bueno, *lo dice*» |
| 10,4 | `ganasteis` | Primera fila: **100**, «Ya la ganasteis», «Ha abierto entre abril y septiembre». Clic → ficha: «Sí, merece la pena estudiarla», «Reforesta ya la ganó en 2025 (29.378 €), 2024 y 2022». La cámara se abre a la ficha entera, baja a **Ediciones anteriores** y se acerca: «Reforesta la ganó en 2025, 2024 y 2022», «Cuándo abre: Ha abierto entre abril y septiembre», «Plazo habitual: 10 días hábiles», quién la ganó; después las ediciones con «La ganasteis». | «Arriba, *la que ya ganasteis*» → «Cuándo abre y *quién la gana*» |
| 21,9 | `motivos` | Ficha de BDNS 930968 (montes de titularidad privada, Comunidad de Madrid): **45** «Puede encajar: revisa los avisos» y sus motivos; la cámara baja a los avisos: cierre estimado («≈», 15 días hábiles) y «Ninguna de las 37 ayudas anteriores fue a una entidad sin ánimo de lucro (fueron sobre todo a empresas)». | «Cada nota, *con sus motivos*» → «Y sus avisos: *aquí ganan empresas*» |
| 27,2 | `empresas` | `/empresas`: tarjeta de Fundación Unicaja (abierta, «19 días», «Cierra el 4 dic», «Solo Andalucía o provincia de Ciudad Real»); la cámara se acerca a «Último plazo» y «Qué lo limita». | «Fundaciones, *comprobadas a mano*» → «Y también *lo que las limita*» |
| 32,7 | `equipo` | Ficha de BDNS 926034 (Fundación Biodiversidad): clic en **En estudio**, clic en **Nos sirve** («Votos del equipo · Nos sirve: 1»), Responsable → **Marta Ibáñez** (la lista desplegada se corta: nombraría todas las cuentas de la base), se escribe la nota «Encaja con riberas. ¿Lo miras esta semana?» y **Añadir nota**. | «Marcadla *en estudio*» → «¿Os sirve? *Votadlo*» → «Asignadla y *dejad una nota*» |
| 41,4 | `seguimiento` | `/seguimiento`: las cuatro columnas con iniciales de la persona asignada y nº de notas; se arrastra la tarjeta recién marcada de «En estudio» a «A presentar». | «Todo el equipo, *un solo tablero*» |
| 45,6 | `asistente` | Lienzo verde (barrido circular). Tarjeta de chat neutra (sin nombre, logo ni aspecto de ningún asistente): pregunta «¿Qué convocatoria de Madrid ya hemos ganado y cuándo suele abrir?», pasos «Buscó en el radar» y «Abrió la ficha», y la respuesta montada con la salida real de `buscar_convocatorias` y `ver_convocatoria` (`/mcp`, sin token): título, «Comunidad de Madrid · nota 100», «Reforesta ya la ganó en 2025 (29.378 €), 2024 y 2022.», «Ha abierto entre abril y septiembre; plazo habitual: 10 días hábiles.», fuente. | «Pregúntaselo a *vuestro asistente*» |
| 53,3 | `outro` | Barrido circular de vuelta al blanco: marca + «Reforesta Radar», lema escrito, botón «Ver el código» (un puntero lo pulsa) y github.com/Migueldgq/reforesta-radar. | «Menos horas buscando, *más horas en el monte.*» |

## Locución opcional (≈100 palabras, si se graba)

«Reforesta Radar. Siete fuentes, cientos de convocatorias y un equipo de siete. El radar las lee cada mañana, y si hoy no hay nada bueno, lo dice. Arriba, la que ya ganasteis: cuándo suele abrir y quién la gana. Cada nota lleva sus motivos y sus avisos: esta parece buena, pero la ganan empresas. Las fundaciones, comprobadas a mano, con lo que las limita. Marcadla en estudio, votadla, asignadla y dejad una nota: todo el equipo en un solo tablero. Y pregúntaselo a vuestro asistente. Menos horas buscando, más horas en el monte.»

Si se añade, la voz manda: alarga las pausas (`sleep`) de `capture.mjs` y baja `MUSIC_LUFS` en `compose.mjs` unos dB.

## Notas

- Las cifras que se ven (7 fuentes, 323 convocatorias, 35 · 14 · 34 · 252, 100, 45, 19 días…) son las de la app el día de la grabación (15 nov 2026). Las de los titulares salen de `captures/facts.json`.
- La app no redacta solicitudes: el vídeo enseña encontrar, priorizar, explicar la nota, decidir en equipo y consultar el radar desde un asistente. Nada más.
- El asistente no es de la app: el radar le da datos (servidor de solo lectura). La tarjeta es un dibujo propio del vídeo; el texto de la respuesta sale tal cual de las herramientas.
- Personas en pantalla: Lucía Serrano, Diego Martín y Marta Ibáñez son cuentas ficticias (`@example.org`) creadas para grabar y borradas después.
