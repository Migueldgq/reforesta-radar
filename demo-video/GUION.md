# Guion del vídeo de demo — Reforesta Radar

Duración total: **≈85 s** (11 escenas, fundidos de 0,5 s entre ellas). 1920×1080, 30 fps, sin música.
Los ids, duraciones y rótulos de esta tabla son los de `scenes.mjs`: si cambias uno, cambia el otro.

Hilo: el problema → el radar lee 11 fuentes → decide por ti qué encaja → encuentra las convocatorias del reto → os enseña lo que no veíais → seguimiento → empresas → PDF → cierre.
Criterios del jurado (RETO.md): **el problema** (escenas 1–2, 7), **funciona con convocatorias reales** (escenas 3, 6, 10), **el lunes** (sin cuentas ni claves; escenas 8 y 11).

| # | id | Dur. | En pantalla | Rótulo en pantalla | Locución (opcional) |
|---|---|---|---|---|---|
| 1 | `intro` | 4 s | Tarjeta: «1hack A Coruña · Reto Reforesta» / **Reforesta Radar** | Encontrar y priorizar convocatorias, sin leerse cada base. | «Reforesta Radar: encontrar y priorizar convocatorias sin leerse cada base.» |
| 2 | `problema` | 6 s | Tarjeta de texto | **4–5 solicitudes al año.** Siempre las mismas cuatro fuentes. Decenas de páginas por convocatoria. | «Hoy Reforesta presenta cuatro o cinco solicitudes al año. Las encuentra revisando siempre las mismas cuatro fuentes y leyendo bases de decenas de páginas.» |
| 3 | `fuentes` | 7 s | `/fuentes`: tabla con el estado de cada fuente (Funciona / Parcial / Sin respuesta) y cuántos resultados aporta; scroll suave. | 01 · Once fuentes públicas y privadas, en una sola lista | «El radar consulta once fuentes —BDNS, BOE, la UE, boletines autonómicos, fundaciones y empresas— y lo junta todo en una lista.» |
| 4 | `inicio` | 10 s | `/`: cifras de arriba y gráficos. Se pulsa una barra de «Cuándo cierran» y luego «Restauración de ecosistemas»: la tabla se filtra. Scroll a la tabla; «Limpiar». | 02 · Gráficos que filtran la tabla al pulsarlos | «En Inicio, cada gráfico es un filtro: cuándo cierran, línea de trabajo, territorio.» |
| 5 | `encaja` | 10 s | `/`: se abre la primera convocatoria. Panel de detalle con «¿Encaja?», nota de 0 a 100, motivos y avisos; se marca «En estudio». | 03 · ¿Encaja? Nota de 0 a 100, con sus motivos y sus avisos | «Cada convocatoria trae una nota y, sobre todo, el porqué: motivos y avisos en frases cortas. Sin IA generativa: reglas que se pueden leer.» |
| 6 | `ejemplos` | 16 s | `/?cerradas=1`: se busca «científica» → BDNS 923290 (MITECO); luego «madrid ambientales» → BDNS 904719 (Comunidad de Madrid). En ambos, el motivo «la edición actual cerró el …; prepara la siguiente con tiempo». | 04 · Las dos convocatorias del reto, encontradas: «prepara la siguiente edición» | «Las dos convocatorias de ejemplo del reto aparecen. Ya cerraron, y por eso el radar las guarda: como aviso para preparar la próxima edición con tiempo.» |
| 7 | `fuera` | 7 s | `/`: se pulsa la cifra «Fuera de tus 4 fuentes»; la tabla muestra solo lo que viene de fuera de MITECO, Fundación Biodiversidad, Comunidad de Madrid y Agenda 2030. | 05 · «Fuera de tus 4 fuentes»: lo que hoy no estáis viendo | «Y marca lo que viene de fuera de vuestras cuatro fuentes: la gran mayoría de los resultados.» |
| 8 | `seguimiento` | 8 s | `/seguimiento`: tablero En estudio / A presentar / Presentada / Descartada; se arrastra una tarjeta de «En estudio» a «A presentar». | 06 · Seguimiento: de «En estudio» a «A presentar», arrastrando | «Lo que interesa pasa a un tablero, hasta presentarlo. La columna Presentada cuenta las solicitudes del año.» |
| 9 | `empresas` | 7 s | `/empresas`: programas de RSC y fundaciones con motivo de encaje, importe orientativo y ángulo para el primer contacto; scroll. | 07 · Empresas: programas de RSC con motivo de encaje y ángulo de contacto | «Para el canal de empresas, que hoy está a cero: programas seleccionados, por qué encajan y cómo abrir la conversación.» |
| 10 | `analizar` | 9 s | `/analizar`: se pulsa el PDF de ejemplo «Comunidad de Madrid · Orden 1689/2026»; aparece la ficha (nota, motivos, avisos, quién puede pedirla, dinero, plazos, requisitos); scroll. | 08 · Analizar PDF: unas bases convertidas en una ficha de decisión | «¿Unas bases de doce páginas? Se suben y en segundos hay una ficha con la misma puntuación que el resto del radar.» |
| 11 | `outro` | 6 s | Tarjeta final | **Menos horas leyendo bases, más horas en el monte.** github.com/Migueldgq/reforesta-radar | «Sin cuentas, sin claves, sin base de datos: se abre y funciona. Menos horas leyendo bases, más horas en el monte.» |

## Notas

- **Cifras**: el guion no cita números concretos (547 resultados, 513 de fuera…) porque los datos son en vivo y cambian cada día; lo que se ve en pantalla es el dato del día de la grabación.
- **Locución**: ≈150 palabras, cabe en ≈75 s a ritmo tranquilo. Si se graba, el ritmo de la voz manda: ajusta las duraciones en `scenes.mjs`.
- **Escena 10**: se usa el PDF de Madrid (12 páginas) porque el de MITECO es un extracto de 3 páginas y su ficha sale casi vacía («No se pudo extraer un resumen automático»).
- Todo lo que se afirma sale del README: 11 fuentes, nota 0–100 con motivos y avisos, sin IA generativa ni claves, las dos convocatorias del reto como «próxima edición», «Fuera de tus 4 fuentes», tablero con columna Presentada, vista Empresas, ficha de PDF.
