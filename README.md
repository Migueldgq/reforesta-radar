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
| Revisan siempre las mismas 4 fuentes | Lee 7 fuentes y marca con **«No es de los organismos que ya revisáis a mano»** lo que no habrían visto. En la foto del 15/11/2026, 497 de 528 resultados vienen de fuera de MITECO, Fundación Biodiversidad, Comunidad de Madrid y Agenda 2030. |
| Leer decenas de páginas para saber si encaja | Cada resultado trae una puntuación de 0 a 100 con sus **motivos** y sus **avisos** en frases cortas («Concurrencia competitiva…», «Dirigida a ayuntamientos…»). Las bases en PDF se resumen en una ficha. |
| Las convocatorias anuales se pasan de fecha | Las convocatorias competitivas que cerraron en los últimos 12 meses **se conservan a propósito** como aviso de «próxima edición», para preparar la siguiente con tiempo. |
| El canal de empresas (RSC) está a cero | Vista **Empresas** con programas privados seleccionados a mano, el motivo de encaje y un ángulo para el primer contacto. |

Relación con los tres criterios de evaluación:

1. **El problema.** El ángulo elegido es capacidad de detección y priorización, no generación de texto. Objetivo del reto: pasar de 4–5 a **10 solicitudes al año** con el mismo equipo y abrir las **2–4 primeras empresas**. El tablero de Seguimiento tiene una columna «Presentada» para contar esas solicitudes.
2. **Funciona con convocatorias reales.** Todos los datos salen en vivo de fuentes oficiales. La prueba de la organización: las dos convocatorias de ejemplo del reto aparecen en la lista, ambas como convocatorias periódicas cerradas, con el motivo «la edición actual cerró el …; prepara la siguiente con tiempo»:
   - **BDNS 923290** — MITECO, ayudas para actividades de interés general en investigación científica y técnica y protección del medio ambiente, anualidad 2026 (cerró el 24/08/2026, fecha estimada).
   - **BDNS 904719** — Comunidad de Madrid, subvenciones a entidades sin ánimo de lucro para proyectos ambientales 2026 (Orden 1689/2026; cerró el 08/06/2026).
3. **El lunes.** Se arranca con un solo `docker compose up` y se abre en el navegador: sin cuentas ni claves de API. Una ingesta programada consulta las fuentes cada mañana a las 9:00; si una fuente falla, se siguen mostrando sus últimos datos buenos y la vista Fuentes lo dice.

---

## Qué hace, vista por vista

**Inicio.** Lista única de oportunidades (subvenciones, licitaciones, anuncios en boletines, fondos europeos y programas de empresas).
- Cuatro cifras arriba que también sirven de filtro rápido: abiertas ahora, cierran en 30 días o menos, encaje alto, de organismos que no revisáis a mano.
- Gráficos de resumen que filtran al pulsarlos: cuándo cierran (próximas 12 semanas), línea de trabajo, territorio, fuente, tipo, importe total y estado de seguimiento.
- Tabla ordenable por columnas, con barra de filtros, chips para quitar cada filtro y buscador de texto (atajo `⌘K` o `/`).
- Los filtros se guardan en la dirección de la página: se puede copiar el enlace y enviárselo a un compañero con la misma vista.
- Al abrir una oportunidad se ve el detalle: motivos y avisos, plazos, importe, beneficiarios, enlaces oficiales y documentos adjuntos, que se pueden analizar con un clic.
- La última lista descargada se guarda en el navegador, así que la página se pinta al instante y se actualiza por detrás. Si la API no responde, se sigue viendo esa copia con un aviso.

**Seguimiento.** Tablero con cuatro columnas: En estudio, A presentar, Presentada y Descartada. Las tarjetas se mueven arrastrándolas. Destaca la siguiente convocatoria que cierra. El estado se guarda en el navegador (ver limitaciones).

**Empresas.** Programas de RSC y fundaciones privadas (6 a día de hoy): por qué encajan con Reforesta, importe orientativo, calendario y ángulo para la propuesta. Incluye una guía de tres pasos: elegir tres, marcarlas «En estudio», preparar una página por empresa.

**Analizar PDF.** Sube unas bases (hasta 15 MB) o usa los dos PDF de ejemplo del reto (`data/samples/`). Extrae el texto en el servidor y devuelve una ficha: por qué encaja, qué vigilar, quién puede pedirla, dinero, plazos y requisitos, con la misma puntuación que el resto del radar.

**Fuentes.** Transparencia: estado de cada fuente en la última ingesta (Funciona / Parcial / Sin respuesta), cuántos resultados aporta, una nota con lo que se ha leído y cuándo fue la última ingesta.

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
| **RSC · empresas y fundaciones** | Lista seleccionada a mano en `backend/app/sources/rsc.py`. | Datos en el código | 6 |
| **Total** (tras quitar duplicados) | | | **528** |

Resumen de esa foto: 30 abiertas, 20 que abren próximamente, 165 cerradas (próxima edición) y 313 sin fecha publicada. Por encaje: 20 alto, 97 medio, 411 bajo. Una fuente con 0 resultados no está rota: significa que ese día no publicó nada con encaje ambiental (la nota de la vista Fuentes lo detalla).

---

## Cómo decide el encaje

La puntuación (0–100) se calcula con reglas fijas, en `backend/app/scoring/` (`score.py`, `profile.py`, `rank.py`). En palabras sencillas:

- **Suma** si el título o la finalidad hablan de lo que hace Reforesta. Hay listas de palabras por cada línea de trabajo (restauración, conservación, educación ambiental, agroambiental y custodia), en castellano, catalán, gallego y euskera. Lo que aparece en el título cuenta el doble que lo que solo aparece en la finalidad.
- **Suma** si es de concurrencia competitiva, si menciona expresamente a entidades sin ánimo de lucro, si está abierta o abre pronto, si no es de los cuatro organismos que ya revisan a mano y si el presupuesto es de 50.000 € o más.
- **Resta** si es nominativa, de concesión directa o un convenio; si es solo para empresas o para ayuntamientos; o si es de otro ámbito (patrimonio cultural, caza, pesca, eficiencia energética, becas, trámites de impacto ambiental, adjudicaciones…).
- **Topes**: sin ningún tema ambiental, como mucho 35; nominativa o directa, como mucho 25; cerrada, como mucho 50; si no puede pedirla una ONG, como mucho 45. Las de Horizon Europe se limitan a 58 porque Reforesta entraría como socio de un consorcio, no como líder.
- **Niveles**: encaje alto desde 60, medio de 40 a 59, bajo por debajo de 40.

Cada regla que se aplica deja una frase en «motivos» o en «avisos», así que el equipo ve por qué una convocatoria tiene esa nota y puede no estar de acuerdo con ella.

---

## Cómo arrancarlo

Requisito: **Docker** con Compose. No hace falta ninguna clave de API.

```bash
docker compose up -d --build   # Postgres + API + ingesta programada + web
```

- Web: http://localhost:3010 (la portada en `/landing`).
- API (FastAPI): http://localhost:8010, documentación en http://localhost:8010/docs.
- La primera ingesta empieza sola al arrancar y tarda unos minutos; después se repite cada día a las 9:00 (hora de Madrid, `RADAR_INGEST_AT`; si el equipo estaba dormido, al despertar). Para lanzar una a mano: `docker compose run --rm ingest` (o `--source boe,rsc` para algunas fuentes).
- Puertos, contraseña de Postgres e intervalo de ingesta: copiar `.env.example` a `.env` y editarlo.

Desarrollo del frontend (recarga en caliente, Node.js 20.9 o superior):

```bash
docker compose up -d postgres api   # solo el backend
npm install
npm run dev                          # http://localhost:3000, llama a la API en localhost:8010
```

El backend se desarrolla aparte con `uv` (ver [backend/README.md](./backend/README.md)).

Endpoints (todos los sirve la API de Python; la web los expone en su mismo origen bajo `/api/...`):

| Ruta | Para qué |
|---|---|
| `GET /api/oportunidades` | Todas las oportunidades en un modelo común, puntuadas y ordenadas, más el estado de cada fuente y la hora de la última ingesta. |
| `GET /api/fuentes` | Estado de cada fuente en su última ingesta. |
| `GET /api/perfil` | Reglas y perfil de Reforesta que usa la puntuación (vista Perfil). |
| `POST /api/analyze-pdf` | Analiza un PDF (subido, de ejemplo, documento BDNS o URL). |

---

## Arquitectura

```
fuentes ──► ingesta (diaria, 9:00) ──► Postgres ◄── API (FastAPI) ◄── /api/* ── Next.js ◄── navegador
```

- **Frontend** (`src/`): Next.js 16 (App Router, TypeScript) y Tailwind CSS v4. Solo interfaz: no tiene rutas de API propias. Next reenvía `/api/*` a la API (rewrite en `next.config.ts`, destino en `API_URL`), así el navegador siempre llama al mismo origen. La portada lee las cifras de la API en el servidor; si la API no responde, se pinta sin números.
  - `src/lib/opportunity.ts`, `types.ts` — tipos del contrato JSON.
  - `src/lib/scoring.ts`, `reforesta-profile.ts` — se usan en el navegador para aplicar los ajustes de la vista Perfil sin volver a llamar a la API.
- **Backend** (`backend/`): Python 3.13, FastAPI, SQLAlchemy y Alembic sobre Postgres 16. Un conector por fuente, la puntuación, la ingesta y el análisis de PDF (`pypdf`). Detalles en [docs/backend.md](./docs/backend.md) y [backend/README.md](./backend/README.md).
- **Ingesta**: `python -m app.ingest` consulta todas las fuentes, puntúa y escribe en una sola transacción. La API nunca consulta las fuentes al responder: lee Postgres y aplica el encaje geográfico y por tipo.

---

## Limitaciones conocidas

- **Plazos de la BDNS.** Muchas convocatorias no publican fecha exacta, solo «20 días hábiles desde la publicación». En la foto del 15/11/2026, 311 de los 481 resultados de la BDNS no tienen fecha de cierre. En 89 casos la fecha se estima y lleva el aviso «confirmar en el extracto oficial».
- **Fichas BDNS incompletas.** Solo se descarga la ficha completa de las 230 convocatorias más prometedoras de cada consulta. El resto se muestra con los datos de la búsqueda y un aviso; puede faltar plazo, tipo o beneficiarios.
- **El seguimiento es de cada navegador.** El tablero se guarda en el navegador (`localStorage`): no se comparte entre el equipo ni entre dispositivos.
- **Importes de empresas orientativos.** Los importes y calendarios de la lista RSC son aproximados, no están verificados con cada entidad y hay que confirmarlos en su web.
- **LIFE.** Ahora mismo no hay ninguna convocatoria LIFE de naturaleza abierta. La única LIFE abierta (European City Facility) es de transición energética y va dirigida a municipios. La mayoría de los fondos europeos que aparecen son de Horizon Europe, para consorcios de investigación.
- **Las reglas se pueden equivocar.** La puntuación busca palabras, no entiende el texto: puede dar nota alta a algo que no encaja o pasar por alto una convocatoria redactada de forma poco habitual. Por eso siempre muestra sus motivos.
- **Fuentes frágiles.** Los boletines leídos en HTML (DOG, Fundación Biodiversidad) dejan de funcionar si cambian su web. Si una fuente falla, la vista Fuentes lo indica y se siguen mostrando sus últimos datos buenos.
- **Datos de la mañana.** La API solo enseña lo que guardó la última ingesta, la de las 9:00; una convocatoria publicada más tarde aparece al día siguiente. Si la ingesta lleva más de 12 h sin terminar bien, Inicio muestra un aviso.
- **Cobertura autonómica parcial.** Hoy se leen 2 boletines autonómicos (Madrid y Galicia), los que propone el reto. Los demás territorios llegan solo a través de la BDNS. Los boletines provinciales y municipales no se leen directamente.

---

## Siguientes pasos

1. **Estado compartido del equipo**: guardar seguimiento, notas y responsables en una base de datos, para que las 6–7 personas vean el mismo tablero.
2. **Alertas**: la ingesta ya es programada; falta avisar por correo o Slack cuando aparezca una convocatoria nueva con encaje alto o cuando se acerque un cierre.
3. **Más boletines autonómicos y provinciales**, empezando por los territorios donde Reforesta tiene acuerdos de custodia.
