# Guion del vídeo de demo — Reforesta Radar (v2, dinámico)

Duración objetivo: **55–60 s**. 1920×1080, 30 fps, H.264 + AAC. Sin música ni locución: solo efectos (clic en cada clic, un *whoosh* suave en cortes y zooms).
Los ids y rótulos son los de `scenes.mjs`. La duración de cada escena de pantalla sale de la grabación (`captures/<id>.json`): no se fija a mano.

Ritmo: cortes casi secos (0,12 s), desplazamientos del cursor y scroll acelerados ×2,5–3, y a velocidad real en el momento que importa. Cada momento clave lleva un zoom (×1,4–1,9) centrado en la interacción.

Historia honesta: **hoy no hay ninguna convocatoria abierta con encaje alto para Reforesta**; el radar enseña lo que volverá y cuándo cerró, para prepararlo con tiempo.

| # | id | ≈Dur. | En pantalla | Zoom / efecto | Rótulo (≤6 palabras) |
|---|---|---|---|---|---|
| 0 | `landing` | 3,8 s | `/landing`: animación de entrada del hero («Cada convocatoria que se escapa es monte que no se planta»). Arranque en frío. | — | — |
| 1 | `problema` | 3 s | Tarjeta: **4–5 solicitudes al año.** Siempre las mismas cuatro fuentes. | palabras que entran | — |
| 2 | `fuentes` | 3 s | `/fuentes`: tabla de las 11 fuentes con su estado. | ×1,45 sobre la tabla | 01 · 11 fuentes, una sola lista |
| 3 | `mapa` | 6 s | `/`: vista general; clic en **Comunidad de Madrid** en el mapa; scroll a la tabla, ya filtrada. | ×1,8 en Madrid (clic) → ×1,4 en la tabla | 02 · Todo de un vistazo → Pulsa Madrid: la tabla responde |
| 4 | `encaje` | 5,5 s | Tarjeta **Encaje alto 20 — «Ninguna abierta hoy · ver próximas ediciones»**; clic; pestaña **Próximas ediciones**. | ×1,9 en la tarjeta → ×1,6 en la pestaña | 03 · Hoy, nada abierto que encaje → Lo que vuelve: próximas ediciones |
| 5 | `ejemplos` | 13 s | Fila **BDNS 904719** (Comunidad de Madrid, ejemplo del reto) con «Cerró el 8 jun · próxima edición»; se abre: **85 · Sí, merece la pena estudiarla** y sus motivos; se marca **En estudio**; se cierra y justo debajo está **BDNS 923290** (MITECO), el otro ejemplo. | ×1,9 en la etiqueta → ×1,6 en el veredicto → ×1,7 en «En estudio» → ×1,6 en la fila 923290. Rótulo inferior animado para cada ejemplo. | 04 · Ejemplo del reto: cerró en junio → ¿Encaja? 85, y por qué → A «En estudio» → El otro ejemplo, justo debajo |
| 6 | `seguimiento` | 4,5 s | `/seguimiento`: se arrastra la tarjeta de 904719 de «En estudio» a «A presentar». | ×1,35 siguiendo el arrastre | 05 · Seguimiento: arrastra y decide |
| 7 | `perfil` | 5,7 s | `/perfil`: «Educación ambiental» → **Mucho más**; el panel «Efecto de vuestros ajustes» cambia al momento (Encaje alto 0 → N, notas «antes → ahora»). | ×1,6 en el control → ×1,6 en el panel | 06 · Perfil: ajustad el criterio → El efecto, al momento |
| 8 | `empresas` | 4 s | `/empresas`: programas de RSC con motivo de encaje. | ×1,5 en la primera tarjeta | 07 · Empresas: el canal RSC |
| 9 | `analizar` | 5,5 s | `/analizar`: PDF de ejemplo «Comunidad de Madrid · Orden 1689/2026» → ficha con nota /100, motivos y avisos (la espera de la extracción se corta). | ×1,6 en el botón → ×1,7 en el veredicto | 08 · Unas bases en PDF… → …una ficha de decisión |
| 10 | `outro` | 3 s | Tarjeta: **Menos horas leyendo bases, más horas en el monte.** github.com/Migueldgq/reforesta-radar | palabras que entran | — |

## Locución opcional (≈110 palabras, si se graba)

«Cada convocatoria que se escapa es monte que no se planta. Reforesta presenta cuatro o cinco solicitudes al año, buscando siempre en las mismas cuatro fuentes. El radar lee once. En Inicio, todo de un vistazo: pulsa Madrid y la tabla responde. Hoy no hay nada abierto que encaje de verdad; pero el radar enseña lo que vuelve. La convocatoria de ejemplo del reto, la de la Comunidad de Madrid: un 85, y el porqué. La marcamos en estudio; la del MITECO está justo debajo. En Seguimiento se arrastra hasta presentarla. En Perfil ajustáis el criterio y veis el efecto al momento. Empresas para el canal RSC, y cualquier PDF de bases, convertido en una ficha. Menos horas leyendo bases, más horas en el monte.»

Si se añade, la voz manda: alarga las pausas (`sleep`) de `capture.mjs` donde haga falta y vuelve a capturar.

## Notas

- Las cifras que se ven (20 de encaje alto, 85, 84…) son las del día de la grabación; el guion no las cita de memoria.
- Se usa el PDF de Madrid (12 páginas): el de MITECO es un extracto de 3 páginas y su ficha sale casi vacía.
- Lo que se afirma está en el README (11 fuentes, nota 0–100 con motivos, ediciones cerradas como «próxima edición», tablero de seguimiento, empresas, ficha de PDF, sin cuentas ni claves) o se ve en pantalla en la app actual (mapa, pestaña «Próximas ediciones», Perfil). El README aún no describe el mapa ni el Perfil: conviene añadirlos antes de entregar.
