# Guion del vídeo de demo — Reforesta Radar (v3, vídeo de lanzamiento)

Duración: **≈53 s** (52,9 s). 1920×1080, 30 fps, H.264 + AAC. Formato de vídeo de lanzamiento: lienzo blanco, un titular corto por momento (se escribe letra a letra, palabras clave en verde) y debajo **una pieza recortada de la app real**, grande, con la cámara que entra y se desplaza. Cambios entre momentos con desenfoque y escala; un momento en lienzo verde con barrido circular. Música de fondo + tecleo, clics, *whoosh* y *pop*.

Los ids y textos son los de `scenes.mjs`. La duración de cada momento de pantalla sale de la grabación (`captures/<id>.json`); los tiempos de abajo son los de la versión renderizada y cambian si se vuelve a capturar.

| t (s) | id | En pantalla | Titular |
|---|---|---|---|
| 0,0 | `intro` | Salta la marca (cuadrado verde con el brote) y se escribe «Reforesta Radar», centrados. | — |
| 1,9 | `statement` | Dos líneas centradas; la segunda en verde. | «Cada convocatoria que se escapa / *es monte que no se planta.*» |
| 4,6 | `fuentes` | `/fuentes`: «7 fuentes · 528 convocatorias» y la tabla con su estado; la cámara baja por las fuentes. | «*7 fuentes*, una sola lista» |
| 8,9 | `inicio` | `/`: las cuatro tarjetas (Abiertas ahora, Cierran en ≤30 días, Encaje alto, Próximas ediciones: 30 · 11 · 20 · 160). | «Lo importante, *de un vistazo*» |
| 12,0 | `semana` | Gráfico «Cuándo cierran»: clic en una semana; la cámara baja a la tabla, ya filtrada («Cierran la semana del …»). | «Pulsa una *semana*…» → «…y la lista *responde*» |
| 17,0 | `mapa` | Mapa «Territorio»: zoom a Madrid, clic; la tabla queda en «Territorio: Comunidad de Madrid». | «O pulsa *Madrid*» → «Solo lo de *vuestro territorio*» |
| 22,7 | `encaje` | Fila de BDNS 904719 (ejemplo del reto, Comunidad de Madrid); se abre la ficha: **85 · Sí, merece la pena estudiarla** y sus motivos; clic en **En estudio**. | «¿Encaja? *Y por qué*» → «Marcadla *en estudio*» |
| 31,0 | `seguimiento` | `/seguimiento`: se arrastra la tarjeta de 904719 de «En estudio» a «A presentar». | «Del radar *al tablero*» |
| 34,9 | `perfil` | `/perfil`: «Educación ambiental» → **Mucho más**; la cámara pasa al panel «Efecto de vuestros ajustes» (Encaje alto 0 → N, notas «antes → ahora»). | «El criterio *es vuestro*» → «La lista *se reordena*» |
| 39,6 | `analizar` | `/analizar`: clic en el PDF del reto «Comunidad de Madrid · Orden 1689/2026» → ficha con nota /100, «Encaje alto», motivos y avisos (la espera se corta). | «¿Unas bases en PDF?» → «*Una ficha* para decidir» |
| 45,4 | `empresas` | Lienzo verde (barrido circular): la primera tarjeta de `/empresas` (programa RSC con motivo de encaje) como tarjeta flotante. | «Y el canal *de empresas*» |
| 48,3 | `outro` | Barrido circular de vuelta al blanco: marca + «Reforesta Radar», lema escrito, botón «Ver el código» (un puntero lo pulsa) y github.com/Migueldgq/reforesta-radar. | «Menos horas leyendo bases, *más horas en el monte.*» |

## Locución opcional (≈95 palabras, si se graba)

«Reforesta Radar. Cada convocatoria que se escapa es monte que no se planta. Siete fuentes, en una sola lista. Lo importante, de un vistazo: pulsa una semana o pulsa Madrid, y la lista responde. ¿Encaja? Un 85, y el porqué. La marcamos en estudio y pasa al tablero de seguimiento. El criterio es vuestro: subid el peso de una línea y la lista se reordena. ¿Unas bases en PDF? Una ficha para decidir. Y el canal de empresas, también. Menos horas leyendo bases, más horas en el monte.»

Si se añade, la voz manda: alarga las pausas (`sleep`) de `capture.mjs` y baja `MUSIC_LUFS` en `compose.mjs` unos dB.

## Notas

- Las cifras que se ven (7 fuentes, 528 convocatorias, 30 abiertas, 85, 84/100, Encaje alto 0 → 8…) son las de la app el día de la grabación; los titulares no citan cifras salvo «7 fuentes»: si cambia el número de fuentes de la app, cámbialo en `scenes.mjs` y vuelve a capturar `fuentes`.
- La app no redacta solicitudes: el vídeo enseña encontrar, priorizar, explicar el encaje, hacer seguimiento y leer bases. Nada más.
- Se usa el PDF de Madrid (12 páginas): el de MITECO es un extracto de 3 páginas y su ficha sale casi vacía.
- Sin página de aterrizaje (`/landing`): todo es la app.
