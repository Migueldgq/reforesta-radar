# Guion del vídeo de demo — Reforesta Radar (narrado)

Duración: **3:38,4** (218.4 s). 1920×1080, 30 fps, H.264 + AAC, `faststart`. Misma estética que la v5 (lienzo blanco, un titular escrito por momento con palabras clave en verde, una pieza recortada de la app real con cámara que entra y se desplaza; sección del agente de IA en lienzo verde), ahora **con locución** en castellano de España que lo explica para quien no es técnico. Los titulares pasan a ser rótulos cortos que acompañan a la voz. Subtítulos aparte, sin quemar: `out/demo-final.es.srt`. La versión anterior, sin voz, se conserva en `out/demo-v5.mp4`.

**La voz marca el ritmo**: cada momento dura lo que su locución más un respiro (ver «Voice» en `README.md`). Voz: «Emilio – Warm, Solid and Convincing» de ElevenLabs (`eleven_v4`), una frase por archivo (`GUION-VOZ.md`). Los tiempos de abajo son los del montaje final y cambian si cambian los archivos de voz o se vuelve a grabar.

Las cifras que se ven (7 fuentes, 323 convocatorias, 100, 86, 45…) son las de la app el día de la grabación (15 nov 2026). La app se graba con una cuenta de demostración ficticia y un tablero de ejemplo («Datos de demostración» en `README.md`).

| t | id | En pantalla | Titular |
|---|---|---|---|
| 0:00,0 | `intro` | Salta la marca y se escribe «Reforesta Radar». | — |
| 0:02,8 | `problema` | Dos líneas centradas, cada una al empezar su frase. | «Cientos de convocatorias, *decenas de webs*» / «*y un equipo de siete.*» |
| 0:15,1 | `promesa` | Dos líneas centradas. | «El radar busca y ordena,» / «*vosotros decidís.*» |
| 0:25,4 | `inicio` | `/` empezando justo bajo la cabecera (sin el chip «Perfil ajustado»): las cuatro tarjetas (abiertas, cierran en 30 días, encaje alto, próximas ediciones); los gráficos por línea de trabajo y territorio; el aviso «Ahora mismo no hay convocatorias abiertas con encaje alto…» y las primeras filas. | «Siete fuentes, *una sola lista*» → «Por plazo, *tema o territorio*» → «Si hoy no hay nada bueno, *lo dice*» |
| 0:45,0 | `ganasteis` | Primera fila (BDNS 904719, nota 100). Clic → ficha: «¿Encaja?» con sus motivos; Ediciones anteriores: «Reforesta la ganó en 2025, 2024 y 2022» (de cerca), cuándo abre, plazo habitual y quién la ganó. | «Arriba, *la que ya ganasteis*» → «Una nota, *con sus motivos*» → «Cuándo abre y *quién la gana*» |
| 1:11,5 | `motivos` | Ficha de BDNS 930968: **45** «Puede encajar: revisa los avisos», motivos (Madrid, forestal) y avisos (cierre estimado; «Ninguna de las 37 ayudas anteriores fue a una entidad sin ánimo de lucro…»); luego toda la lista de motivos y avisos. | «Y sus avisos: *aquí ganan empresas*» → «Reglas a la vista, *no una caja negra*» |
| 1:31,2 | `empresas` | `/empresas`: el texto «Esta lista no es automática: la hacemos a mano…»; tarjeta de Fundación Unicaja, de cerca «Último plazo» y «Qué lo limita»; abajo «Comprobado el 15 nov 2026». | «Fundaciones, *comprobadas a mano*» → «Y también *lo que las limita*» |
| 1:48,8 | `analizar` | `/analizar`: **Elegir archivo** → `miteco-convocatoria-923290.pdf` (BDNS 923290, en el radar). **86/100** «Encaje alto», «Es la nota del radar para esta convocatoria, la misma que en la lista.» (la cámara se para en esa línea) y corte a **Motivos** y **Avisos**. El extracto automático de texto no sale. | «¿Tenéis las bases? *Subid el PDF*» → «Misma nota, *mismos motivos*» |
| 2:03,0 | `equipo` | Ficha de BDNS 926034: **En estudio**, **Nos sirve**, Responsable → **Marta Ibáñez** (la lista desplegada se corta), nota «Encaja con riberas. ¿Lo miras esta semana?» y **Añadir nota**. | «Marcadla *en estudio*» → «¿Os sirve? *Votadlo*» → «Asignadla y *dejad una nota*» |
| 2:20,6 | `seguimiento` | `/seguimiento`: el puntero recorre las cuatro columnas; se arrastra la tarjeta recién marcada de «En estudio» a «A presentar». | «Todo el equipo, *un solo tablero*» |
| 2:31,1 | `invitar` | `/equipo`: Personas (Diego Martín, Lucía Serrano, Marta Ibáñez). **Invitar** → nuria@example.org, «Nuria Campos», **Crear invitación** → «Invitación lista» («Sirve una vez y caduca en 7 días»). **Hecho**: roles y «Enlaces pendientes · Nuria Campos». | «Invitad al equipo *con un enlace*» → «Cada persona, *con su rol*» |
| 2:49,4 | `fuentes` | `/fuentes`: la tabla (fuente, estado, resultados, nota) baja despacio por las siete fuentes; vuelve arriba; cabecera con «Una ingesta programada consulta todas las fuentes cada mañana a las 9:00» y el puntero sobre **Actualizar ahora** (no se pulsa). | «De dónde sale todo, *a la vista*» → «¿No queréis esperar? *Actualizad ahora*» |
| 3:09,7 | `asistente` | Lienzo verde. Tarjeta de conector (sin marca de ningún agente): «Conector MCP», «Reforesta Radar», «reforesta-radar.miguelddev.com/mcp» y debajo «Solo lectura», «✓ Conectado», «Estándar abierto: vale cualquier agente de IA compatible con MCP». Después el chat: «¿Qué convocatoria de Madrid ya hemos ganado y cuándo suele abrir?», «MCP · Reforesta Radar», «Buscó en el radar», «Abrió la ficha» y la respuesta con la salida real de `/mcp`. | «Conectadlo por MCP *a cualquier agente de IA*» → «Pregúntaselo a *vuestro agente de IA*» |
| 3:31,6 | `outro` | Barrido de vuelta al blanco: marca + «Reforesta Radar», lema, «Ver el código» y github.com/Migueldgq/reforesta-radar. | «Menos horas buscando, *más horas en el monte.*» |

## Locución, tal como está montada

| t | Archivo | Texto |
|---|---|---|
| 0:00,5 – 0:02,5 | `01-intro` | Esto es Reforesta Radar. |
| 0:03,3 – 0:08,6 | `02-problema` | Cada año salen cientos de ayudas y programas que podrían financiar vuestros proyectos. |
| 0:08,9 – 0:14,7 | `03-problema` | Pero están repartidos por muchas webs distintas, y revisarlos a mano lleva horas a un equipo pequeño. |
| 0:15,6 – 0:20,3 | `04-promesa` | Reforesta Radar los busca por vosotros, los ordena y os explica por qué. |
| 0:20,7 – 0:25,1 | `05-promesa` | No escribe las solicitudes: os ayuda a decidir dónde poner el tiempo. |
| 0:25,9 – 0:32,6 | `06-inicio` | Cada mañana, a las nueve, el radar lee siete fuentes públicas y privadas, y lo junta todo en una sola lista. |
| 0:33,1 – 0:36,9 | `07-inicio` | Podéis mirarla por plazo, por línea de trabajo o por territorio. |
| 0:37,4 – 0:44,5 | `08-inicio` | Y si hoy no hay nada abierto que encaje bien, os lo dice, y os enseña lo que se repite cada año, para prepararlo con tiempo. |
| 0:45,5 – 0:50,9 | `09-ganasteis` | Arriba del todo, una que ya conocéis: la de proyectos ambientales de la Comunidad de Madrid. |
| 0:51,4 – 0:56,2 | `10-ganasteis` | Cada una lleva una nota de cero a cien. Esta tiene cien, con sus motivos. |
| 0:56,7 – 1:03,9 | `11-ganasteis` | Y lee las ediciones anteriores: Reforesta la ganó en 2025, 2024 y 2022. |
| 1:04,4 – 1:11,0 | `12-ganasteis` | Suele abrir entre abril y septiembre, y en los dos últimos años todas las ayudas fueron a entidades sin ánimo de lucro. |
| 1:12,0 – 1:21,5 | `13-motivos` | La nota también avisa. Esta, de Madrid y forestal, parece buena, pero ninguna de las ayudas anteriores fue a una entidad sin ánimo de lucro. |
| 1:22,0 – 1:30,8 | `14-motivos` | Y se queda en un 45. La nota sale de reglas a la vista. Una inteligencia artificial solo ayuda a descartar lo que no tiene que ver. |
| 1:31,7 – 1:37,3 | `15-empresas` | Los programas de empresas y fundaciones no salen en ningún boletín: están comprobados a mano. |
| 1:37,8 – 1:44,8 | `16-empresas` | Cada uno dice su plazo y qué lo limita: este de Fundación Unicaja solo vale en Andalucía o en Ciudad Real. |
| 1:45,3 – 1:48,2 | `17-empresas` | Como no se actualizan solos, conviene revisarlos. |
| 1:49,3 – 1:54,6 | `18-analizar` | ¿Os llegan las bases de una convocatoria en PDF? Subidlas en Analizar PDF. |
| 1:55,2 – 2:02,4 | `19-analizar` | Si la convocatoria ya está en el radar, el PDF lleva la misma nota que en la lista, con los mismos motivos y avisos. |
| 2:03,5 – 2:08,5 | `20-equipo` | Cuando una os interesa, se decide en equipo. Primero, la marcáis en estudio. |
| 2:09,0 – 2:15,0 | `21-equipo` | Cada persona vota si os sirve. Los votos muestran dónde la nota y el equipo no están de acuerdo. |
| 2:15,5 – 2:20,1 | `22-equipo` | Después, elegís quién se encarga y dejáis una nota, que verá todo el equipo. |
| 2:21,1 – 2:27,2 | `23-seguimiento` | Todo acaba en un tablero compartido: en estudio, a presentar, presentada y descartada. |
| 2:27,7 – 2:30,6 | `24-seguimiento` | Para cambiar una de columna, basta con arrastrarla. |
| 2:31,6 – 2:37,9 | `25-invitar` | Al radar se entra por invitación: escribís el correo, y el radar crea un enlace que enviáis vosotros. |
| 2:38,4 – 2:41,9 | `26-invitar` | El enlace sirve una sola vez y caduca en siete días. |
| 2:42,4 – 2:48,9 | `27-invitar` | Hay dos roles: administración, que gestiona el equipo, y equipo, que usa y edita el tablero. |
| 2:49,9 – 2:58,9 | `28-fuentes` | En Fuentes veis de dónde sale cada dato: la Base de Datos Nacional de Subvenciones, el BOE, los fondos europeos y cuatro fuentes más. |
| 2:59,4 – 3:03,5 | `29-fuentes` | De cada una, cuántos resultados dio y si la última carga fue bien. |
| 3:04,0 – 3:09,2 | `30-fuentes` | Y si no queréis esperar a mañana, alguien de administración puede pedir una actualización en el momento. |
| 3:10,7 – 3:18,4 | `31-asistente` | Y si usáis un agente de inteligencia artificial, podéis conectarle el radar por MCP, un estándar abierto que vale para cualquiera. |
| 3:18,7 – 3:22,9 | `32-asistente` | Es de solo lectura: puede buscar y leer, pero no cambia nada. |
| 3:24,2 – 3:31,3 | `33-asistente` | Le preguntáis con vuestras palabras; él busca en el radar y os responde con los mismos datos que veis en la aplicación. |
| 3:32,6 – 3:37,1 | `34-outro` | Reforesta Radar. Menos horas buscando, y más horas en el monte. |

## Notas

- La app no redacta solicitudes y la nota sale de reglas (ADR 0005 y 0006). La locución lo dice así, y dice que una inteligencia artificial solo ayuda a descartar lo que no tiene que ver.
- «Por plazo, tema o territorio»: son los gráficos de la portada, que filtran la lista al pulsarlos.
- En Analizar PDF se usa el PDF público de la convocatoria BDNS 923290 porque está en el radar y lleva la misma nota que en la lista (86). Ese PDF no trae un objeto extraíble, así que el resumen automático («No se pudo extraer un resumen automático del objeto») queda fuera del plano: la cámara se para en la línea de la nota y corta a los motivos.
- La portada se graba empezando bajo su cabecera: el chip «Perfil ajustado» refleja el Perfil guardado del equipo real y no forma parte del vídeo (no se ha tocado ese ajuste).
- El agente de IA no es de la app: el radar le da datos por su servidor MCP de solo lectura (`/mcp`). MCP es un estándar abierto; las tarjetas no llevan nombre, logo ni aspecto de ningún agente. La tarjeta muestra la dirección pública del radar (`reforesta-radar.miguelddev.com/mcp`). El enlace de invitación del momento `invitar` también sale con esa dirección: la app local lo construye sobre `localhost`, y el filtro de respuestas de la captura cambia solo el esquema, host y puerto (la ruta es la de la app).
- «Actualizar ahora» solo se señala con el puntero: pulsarlo lanzaría una ingesta.
- Personas en pantalla: Lucía Serrano, Diego Martín, Marta Ibáñez y Nuria Campos (invitación) son cuentas ficticias (`@example.org`) creadas para grabar y borradas después.
