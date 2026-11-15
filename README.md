# Reforesta Radar

Proyecto para **1hack A Coruña — El reto de Reforesta** (Common Seeds / The Agile Monkeys). El enunciado completo está en [RETO.md](./RETO.md).

- Vídeo de la demo: **pendiente** <!-- TODO: enlace al vídeo -->
- Despliegue: **pendiente** <!-- TODO: URL pública -->

Reforesta presenta 4 o 5 solicitudes al año porque encuentra las convocatorias revisando a mano cuatro fuentes y leyendo bases de decenas de páginas. Reforesta Radar consulta las siete fuentes públicas y privadas que propone el reto, junta todo en una sola lista, puntúa cada convocatoria según el perfil de Reforesta y explica por qué encaja o por qué no. El equipo marca lo que le interesa y lo sigue en un tablero hasta presentarlo. No usa inteligencia artificial generativa ni claves de API: todas las reglas están en el código y se pueden leer. **No redacta propuestas**: eso lo excluye el propio reto, y Reforesta ya sabe hacerlo.

---

## Qué problema ataca y con qué ángulo

El cuello de botella no es escribir, es **encontrar y decidir**. El radar ataca las dos cosas:

| Dolor de Reforesta (RETO.md) | Qué hace el radar |
|---|---|
| Revisan siempre las mismas 4 fuentes | Lee 7 fuentes y marca con **«Fuera de tus 4 fuentes»** lo que no habrían visto. En la foto del 15/11/2026, 497 de 528 resultados vienen de fuera de MITECO, Fundación Biodiversidad, Comunidad de Madrid y Agenda 2030. |
| Leer decenas de páginas para saber si encaja | Cada resultado trae una puntuación de 0 a 100 con sus **motivos** y sus **avisos** en frases cortas («Concurrencia competitiva…», «Dirigida a ayuntamientos…»). Las bases en PDF se resumen en una ficha. |
| Las convocatorias anuales se pasan de fecha | Las convocatorias competitivas que cerraron en los últimos 12 meses **se conservan a propósito** como aviso de «próxima edición», para preparar la siguiente con tiempo. |
| El canal de empresas (RSC) está a cero | Vista **Empresas** con programas privados seleccionados a mano, el motivo de encaje y un ángulo para el primer contacto. |

Relación con los tres criterios de evaluación:

1. **El problema.** El ángulo elegido es capacidad de detección y priorización, no generación de texto. Objetivo del reto: pasar de 4–5 a **10 solicitudes al año** con el mismo equipo y abrir las **2–4 primeras empresas**. El tablero de Seguimiento tiene una columna «Presentada» para contar esas solicitudes.
2. **Funciona con convocatorias reales.** Todos los datos salen en vivo de fuentes oficiales. La prueba de la organización: las dos convocatorias de ejemplo del reto aparecen en la lista, ambas como convocatorias periódicas cerradas, con el motivo «la edición actual cerró el …; prepara la siguiente con tiempo»:
   - **BDNS 923290** — MITECO, ayudas para actividades de interés general en investigación científica y técnica y protección del medio ambiente, anualidad 2026 (cerró el 24/08/2026, fecha estimada).
   - **BDNS 904719** — Comunidad de Madrid, subvenciones a entidades sin ánimo de lucro para proyectos ambientales 2026 (Orden 1689/2026; cerró el 08/06/2026).
3. **El lunes.** Se abre en el navegador y funciona sin configurar nada: sin cuentas, sin claves, sin base de datos. Si una fuente falla, se siguen mostrando sus últimos datos buenos y la vista Fuentes lo dice.

---

## Qué hace, vista por vista

**Inicio.** Lista única de oportunidades (subvenciones, licitaciones, anuncios en boletines, fondos europeos y programas de empresas).
- Cuatro cifras arriba que también sirven de filtro rápido: abiertas ahora, cierran en 30 días o menos, encaje alto, fuera de tus 4 fuentes.
- Gráficos de resumen que filtran al pulsarlos: cuándo cierran (próximas 12 semanas), línea de trabajo, territorio, fuente, tipo, importe total y estado de seguimiento.
- Tabla ordenable por columnas, con barra de filtros, chips para quitar cada filtro y buscador de texto (atajo `⌘K` o `/`).
- Los filtros se guardan en la dirección de la página: se puede copiar el enlace y enviárselo a un compañero con la misma vista.
- Al abrir una oportunidad se ve el detalle: motivos y avisos, plazos, importe, beneficiarios, enlaces oficiales y documentos adjuntos, que se pueden analizar con un clic.
- La última lista descargada se guarda en el navegador, así que la página se pinta al instante y se actualiza por detrás.

**Seguimiento.** Tablero con cuatro columnas: En estudio, A presentar, Presentada y Descartada. Las tarjetas se mueven arrastrándolas. Destaca la siguiente convocatoria que cierra. El estado se guarda en el navegador (ver limitaciones).

**Empresas.** Programas de RSC y fundaciones privadas (6 a día de hoy): por qué encajan con Reforesta, importe orientativo, calendario y ángulo para la propuesta. Incluye una guía de tres pasos: elegir tres, marcarlas «En estudio», preparar una página por empresa.

**Analizar PDF.** Sube unas bases (hasta 15 MB) o usa los dos PDF de ejemplo del reto (`data/samples/`). Extrae el texto en el servidor y devuelve una ficha: por qué encaja, qué vigilar, quién puede pedirla, dinero, plazos y requisitos, con la misma puntuación que el resto del radar.

**Fuentes.** Transparencia: estado de cada fuente (Funciona / Parcial / Sin respuesta), cuántos resultados aporta, una nota con lo que se ha leído y cuándo, y un botón para volver a consultar todo.

---

## De dónde salen los datos

Foto del **15/11/2026 a las 01:42** (hora peninsular), tomada del endpoint `/api/oportunidades`. Las cifras cambian cada día.

| Fuente | Qué se lee | Cómo | Resultados |
|---|---|---|---|
| **BDNS** (infosubvenciones.es) | 68 búsquedas de los últimos 12 meses: temas ambientales en castellano, catalán y euskera; convocatorias genéricas del tercer sector (interés general, IRPF, 0,7 %); y por organismo (MITECO, Fundación Biodiversidad, OAPN, confederaciones hidrográficas…). Ficha completa de las 230 más prometedoras. | API JSON oficial | 481 |
| **BOE** | Sumarios de los últimos 30 días: extractos de convocatorias y licitaciones abiertas con encaje ambiental; se lee el texto de cada anuncio para sacar plazo y objeto. | API de datos abiertos (JSON) + HTML del anuncio | 5 |
| **UE · Funding & Tenders** | 5 búsquedas (LIFE, bosques, biodiversidad, restauración, especies invasoras), solo con plazo futuro. | API SEDIA oficial (JSON) | 25 (24 Horizon Europe, 1 LIFE) |
| **Fundación Biodiversidad** | Buscador de convocatorias y ficha de cada una. | HTML | 10 (todas cerradas, como referencia) |
| **BOCM** (Comunidad de Madrid) | Sumarios de los últimos 21 días y el texto de cada anuncio candidato. | XML oficial + HTML | 1 |
| **DOG** (Galicia) | Secciones I–III y VI de los últimos 45 días. | HTML | 0 |
| **RSC · empresas y fundaciones** | Lista seleccionada a mano en `src/lib/rsc-opportunities.ts`. | Datos en el código | 6 |
| **Total** (tras quitar duplicados) | | | **528** |

Resumen de esa foto: 30 abiertas, 20 que abren próximamente, 165 cerradas (próxima edición) y 313 sin fecha publicada. Por encaje: 20 alto, 97 medio, 411 bajo. Una fuente con 0 resultados no está rota: significa que ese día no publicó nada con encaje ambiental (la nota de la vista Fuentes lo detalla).

---

## Cómo decide el encaje

La puntuación (0–100) se calcula con reglas fijas, en `src/lib/scoring.ts` y `src/lib/reforesta-profile.ts`. En palabras sencillas:

- **Suma** si el título o la finalidad hablan de lo que hace Reforesta. Hay listas de palabras por cada línea de trabajo (restauración, conservación, educación ambiental, agroambiental y custodia), en castellano, catalán, gallego y euskera. Lo que aparece en el título cuenta el doble que lo que solo aparece en la finalidad.
- **Suma** si es de concurrencia competitiva, si menciona expresamente a entidades sin ánimo de lucro, si está abierta o abre pronto, si viene de fuera de las 4 fuentes habituales y si el presupuesto es de 50.000 € o más.
- **Resta** si es nominativa, de concesión directa o un convenio; si es solo para empresas o para ayuntamientos; o si es de otro ámbito (patrimonio cultural, caza, pesca, eficiencia energética, becas, trámites de impacto ambiental, adjudicaciones…).
- **Topes**: sin ningún tema ambiental, como mucho 35; nominativa o directa, como mucho 25; cerrada, como mucho 50; si no puede pedirla una ONG, como mucho 45. Las de Horizon Europe se limitan a 58 porque Reforesta entraría como socio de un consorcio, no como líder.
- **Niveles**: encaje alto desde 60, medio de 40 a 59, bajo por debajo de 40.

Cada regla que se aplica deja una frase en «motivos» o en «avisos», así que el equipo ve por qué una convocatoria tiene esa nota y puede no estar de acuerdo con ella.

---

## Cómo arrancarlo

Requisitos: **Node.js 20.9 o superior** (lo exige Next.js 16; probado con Node 22). No hace falta ninguna variable de entorno ni clave de API.

```bash
npm install
npm run dev          # desarrollo: http://localhost:3000
```

Producción:

```bash
npm run build
npm run start
```

Al arrancar, el servidor empieza a consultar las fuentes en segundo plano. La primera vez, sin nada guardado, la consulta completa tarda unos 20–28 s. Después se guarda una copia en `.cache/oportunidades.json`, y tras un reinicio la primera respuesta llega en unos 0,1 s.

Endpoints:

| Ruta | Para qué |
|---|---|
| `GET /api/oportunidades` | Todas las oportunidades en un modelo común, más el estado de cada fuente. `?refresh=1` fuerza una consulta nueva. |
| `POST /api/analyze-pdf` | Analiza un PDF (subido, de ejemplo, documento BDNS o URL). |
| `GET /api/convocatorias`, `/api/boe`, `/api/fuentes` | Rutas de la versión anterior; la interfaz ya no las usa. |

---

## Arquitectura

Next.js 16 (App Router, TypeScript), Tailwind CSS v4 y `unpdf` para leer PDF. No usa base de datos.

- `src/lib/aggregate.ts` — lista de fuentes, con la caducidad y el tiempo máximo de espera de cada una; junta los resultados, quita duplicados y ordena por encaje y fecha.
- `src/lib/opportunity.ts` — modelo común `Opportunity`, al que se traduce cada fuente.
- `src/lib/bdns.ts`, `boe.ts`, `sources/multi-source.ts` (UE, BOCM, DOG, Fundación Biodiversidad), `rsc-opportunities.ts` — un conector por fuente.
- `src/lib/scoring.ts` + `reforesta-profile.ts` — reglas de encaje y perfil de Reforesta.
- `src/lib/cache.ts` — caché del servidor:
  - *stale-while-revalidate*: siempre responde al momento con lo último que tiene y refresca por detrás si tiene más de 10 minutos;
  - caducidad por fuente según cuánto publica cada una (de 2 h la BDNS a 6 h la UE y la Fundación Biodiversidad);
  - si una fuente falla o tarda más de 25 s (35 s la BDNS), se usan sus últimos datos buenos, marcados como «Parcial»;
  - las fichas BDNS y los sumarios de días pasados se guardan aparte para no volver a pedirlos;
  - copia en disco en `.cache/`.
- `src/instrumentation.ts` — lanza la primera consulta al arrancar el servidor.
- `src/lib/pdf-analyzer.ts` — extracción de texto y ficha de decisión del PDF.
- `src/app/*` y `src/components/radar/*` — rutas `/`, `/seguimiento`, `/empresas`, `/analizar` y `/fuentes`. La interfaz se está rediseñando con aspecto nativo de macOS; este README describe el comportamiento, no el aspecto.

---

## Limitaciones conocidas

- **Plazos de la BDNS.** Muchas convocatorias no publican fecha exacta, solo «20 días hábiles desde la publicación». En la foto del 15/11/2026, 311 de los 481 resultados de la BDNS no tienen fecha de cierre. En 89 casos la fecha se estima y lleva el aviso «confirmar en el extracto oficial».
- **Fichas BDNS incompletas.** Solo se descarga la ficha completa de las 230 convocatorias más prometedoras de cada consulta. El resto se muestra con los datos de la búsqueda y un aviso; puede faltar plazo, tipo o beneficiarios.
- **El seguimiento es de cada navegador.** El tablero se guarda en el navegador (`localStorage`): no se comparte entre el equipo ni entre dispositivos.
- **Importes de empresas orientativos.** Los importes y calendarios de la lista RSC son aproximados, no están verificados con cada entidad y hay que confirmarlos en su web.
- **LIFE.** Ahora mismo no hay ninguna convocatoria LIFE de naturaleza abierta. La única LIFE abierta (European City Facility) es de transición energética y va dirigida a municipios. La mayoría de los fondos europeos que aparecen son de Horizon Europe, para consorcios de investigación.
- **Las reglas se pueden equivocar.** La puntuación busca palabras, no entiende el texto: puede dar nota alta a algo que no encaja o pasar por alto una convocatoria redactada de forma poco habitual. Por eso siempre muestra sus motivos.
- **Fuentes frágiles.** Los boletines leídos en HTML (DOG, Fundación Biodiversidad) dejan de funcionar si cambian su web. Si una fuente falla, la vista Fuentes lo indica y se siguen mostrando sus últimos datos buenos.
- **Alojamiento serverless.** En plataformas sin disco persistente (p. ej. Vercel) se pierde la copia de `.cache/`, y cada arranque en frío vuelve a tardar 20–28 s. Conviene un servidor Node con disco.
- **Cobertura autonómica parcial.** Hoy se leen 2 boletines autonómicos (Madrid y Galicia), los que propone el reto. Los demás territorios llegan solo a través de la BDNS. Los boletines provinciales y municipales no se leen directamente.

---

## Siguientes pasos

1. **Estado compartido del equipo**: guardar seguimiento, notas y responsables en una base de datos, para que las 6–7 personas vean el mismo tablero.
2. **Consulta programada y alertas**: ejecutar la consulta cada día y avisar por correo o Slack cuando aparezca una convocatoria nueva con encaje alto o cuando se acerque un cierre.
3. **Más boletines autonómicos y provinciales**, empezando por los territorios donde Reforesta tiene acuerdos de custodia.
