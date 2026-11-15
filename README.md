# Reforesta Radar

Reforesta es una ONG de restauración ambiental con un equipo de 6 o 7 personas que presenta 4 o 5 solicitudes de
financiación al año, encontradas a mano en cuatro fuentes. Reforesta Radar lee cada mañana siete fuentes públicas y
privadas de convocatorias, las junta en una sola lista, puntúa cada una según el perfil de Reforesta y explica por qué
encaja o no, para que el equipo dedique su tiempo a decidir y no a buscar. **No redacta propuestas**: el reto lo
excluye y Reforesta ya sabe hacerlo.

Proyecto para **1hack A Coruña: el reto de Reforesta** (Common Seeds / The Agile Monkeys). Enunciado en
[RETO.md](./RETO.md).

- Vídeo de la demo: pendiente <!-- TODO: enlace al vídeo -->
- Despliegue público: <https://reforesta-radar.miguelddev.com> (Oracle Cloud Always Free, Dokploy y GitHub Actions;
  cómo se despliega y se mantiene en [docs/despliegue.md](./docs/despliegue.md)).

## Qué hace hoy

**Encontrar**
- Una ingesta diaria (9:00, hora de Madrid) consulta las siete fuentes, guarda el resultado en Postgres y conserva los
  últimos datos buenos de una fuente que falle.
- Lista única de convocatorias, licitaciones, fondos europeos y programas de empresas, con buscador (`⌘K` o `/`),
  filtros (plazo, línea de trabajo, territorio, fuente, tipo, importe, organismo, seguimiento) y gráficos que filtran
  al pulsarlos, incluido un mapa por comunidad. Los filtros viven en la dirección de la página: un enlace copiado
  abre la misma vista.
- Las convocatorias periódicas que ya cerraron se conservan como «próxima edición», para preparar la siguiente.
- Vista **Empresas**: programas de fundaciones y empresas comprobados a mano en la web de cada entidad.

**Priorizar**
- Nota de 0 a 100 por reglas, con sus motivos y avisos en frases cortas.
- Historial de cada convocatoria BDNS: cuándo suele abrir, cuánto plazo da y qué tipo de entidad la ganó (Reforesta
  incluida).
- **Analizar PDF**: sube unas bases (hasta 15 MB) o un documento de la convocatoria y devuelve una ficha (quién puede
  pedirla, dinero, plazos, requisitos, qué vigilar). Si el PDF es de una convocatoria del radar (por su documento o su
  código BDNS), lleva la misma nota que en la lista; si no, la nota sale solo del texto del PDF, y si el PDF tiene muy
  poco texto lo dice en vez de puntuarlo.
- **Perfil**: el equipo ajusta la nota a su criterio (palabras extra, términos excluidos, prioridad por línea y
  territorio, tipos, importe mínimo). Es uno para todo el equipo.

**Decidir en equipo**
- Cuentas propias por invitación; dos roles (administrador y miembro).
- **Seguimiento**: tablero compartido (En estudio, A presentar, Presentada, Descartada) con persona asignada y notas.
- Votos «sirve / no sirve» en cada convocatoria; los administradores ven en **Equipo → Ajuste de notas** dónde el
  equipo y la nota no están de acuerdo.
- **Fuentes**: estado de cada fuente en la última carga; un administrador puede pedir «Actualizar ahora».

**Conectar un agente de IA**
- Servidor MCP de solo lectura en `/mcp` para Claude Code, Claude Desktop u otro agente compatible: sin token ve
  lo mismo que la portada pública; con un token personal (Mi cuenta) también el tablero del equipo. Ver
  [docs/mcp.md](./docs/mcp.md).

No usa IA generativa ni claves de API: todas las reglas están en el código.

## Puesta en marcha

### Requisitos

- Git y Docker con Compose v2 (Docker Desktop en Mac o Windows; Docker Engine en Linux). No hace falta Node ni
  Python en el ordenador.
- Unos 2 GB libres de disco para las imágenes.
- Libres en el ordenador los puertos 3010 (web), 8010 (API) y 5440 (Postgres). Se cambian en un `.env` (ver abajo).
- Conexión a internet: la primera carga consulta las fuentes en vivo.

### Arrancar

```bash
git clone <url-del-repositorio> reforesta-radar
cd reforesta-radar
docker compose up -d --build
```

Construye las imágenes y arranca cuatro servicios: `postgres`, `api` (FastAPI), `ingest-scheduler` (la carga
diaria) y `web` (Next.js). En la prueba de esta guía, construir tardó unos 80 segundos y arrancar 10 más, con las
imágenes base ya descargadas; la primera vez hay que sumar su descarga (Node, Python y Postgres). `docker compose ps`
debe mostrar `api` como `healthy`.

### Primera carga de datos

Empieza sola en cuanto arranca `ingest-scheduler` (la base está vacía). En la prueba de esta guía tardó **4 minutos**:
la lista aparece a los 2 (cuando el log enseña la tabla de fuentes) y el historial de la BDNS se completa unos 2
minutos después. Durante los 2 primeros minutos el log no enseña progreso. Para seguirla:

```bash
docker compose logs -f ingest-scheduler   # termina con "ingest finished with exit code 0"; Ctrl+C para salir
```

Mientras tanto la web funciona pero la lista está vacía. Las fuentes son APIs y webs públicas: si alguna no responde,
la carga sigue con las demás y la vista Fuentes lo dice.

### Primera cuenta

Las cuentas solo se crean por invitación; la primera, la de administración, desde la terminal:

```bash
docker compose run --rm api python -m app.users create-admin ana@example.org --name Ana
```

Pide la contraseña dos veces (mínimo 10 caracteres). Con `--generate` la genera y la enseña una sola vez.

### Abrir

- App: http://localhost:3010 (lleva a la pantalla de entrada). Portada pública: http://localhost:3010/landing.
- API: http://localhost:8010, documentación interactiva en http://localhost:8010/docs.
- Las demás personas se invitan desde **Equipo → Invitar**, que da un enlace para enviar a mano (caduca en 7 días).
  Crea al menos dos administradores: si el único olvida su contraseña, solo se recupera con el comando de arriba.

### Parar, actualizar, empezar de cero

```bash
docker compose down                        # para todo; los datos se quedan en el volumen de Postgres
docker compose up -d                       # vuelve a arrancar
git pull && docker compose up -d --build   # actualizar a una versión nueva del código
docker compose down -v                     # BORRA la base (cuentas, tablero, votos y datos); la siguiente vez carga de cero
```

### Configuración

Todo es opcional: copiar `.env.example` a `.env` y cambiar lo necesario. Lo más habitual:

- Puertos: `RADAR_WEB_PORT`, `RADAR_API_PORT`, `RADAR_DB_PORT`. Si cambias el de la web, cambia también
  `RADAR_PUBLIC_URL` (por ejemplo `http://localhost:3020`): con ella se construyen los enlaces de invitación y se
  decide qué direcciones acepta `/mcp`.
- Hora de la carga diaria: `RADAR_INGEST_AT` (por defecto `09:00`, hora de Madrid). Si el ordenador estaba apagado
  a esa hora, la carga se hace al encenderlo.
- Contraseña de Postgres: `RADAR_DB_PASSWORD` (la de serie, `radar`, solo vale para uso local).
- Correo (opcional, `SMTP_*`): manda las invitaciones por correo y activa «¿Olvidaste la contraseña?».
- Lanzar una carga a mano: `docker compose run --rm ingest` (o `--source boe,rsc` para algunas fuentes).

Antes de publicarlo en internet hay una lista de comprobación en [docs/backend.md](./docs/backend.md#antes-de-publicarlo-en-internet).

## Cómo funciona

Una vez al día, el servicio `ingest-scheduler` ejecuta la ingesta: cada fuente tiene su conector en
`backend/app/sources/`, que descarga, normaliza a un modelo común y puntúa; todo se escribe en Postgres en una sola
transacción, y una fuente que falla no toca sus datos anteriores. Después, un paso aparte lee el historial de las
convocatorias BDNS relevantes. La API en Python (FastAPI) solo lee Postgres: nunca consulta las fuentes al responder.
Al leer aplica el encaje por territorio y tipo, el historial y el Perfil del equipo. La web en Next.js es solo
interfaz y reenvía `/api/*` y `/mcp` a la API. Detalle en [docs/backend.md](./docs/backend.md).

## De dónde salen los datos

Cifras de la carga del 15/11/2026 (cambian cada día): **327 oportunidades**, de ellas 35 abiertas, 18 que abren
pronto, 264 cerradas (la mayoría como próxima edición) y 10 sin fecha; 37 de encaje alto, 196 medio, 94 bajo.
292 de las 327 son de organismos distintos de los cuatro que Reforesta ya revisa a mano.

| Fuente | Qué se lee | Resultados | Límites |
|---|---|---|---|
| **BDNS** (infosubvenciones.es) | API oficial: 68 búsquedas de los últimos 12 meses (temas ambientales en castellano, catalán y euskera; tercer sector, IRPF e interés general; por organismo: MITECO, Fundación Biodiversidad, OAPN, confederaciones). Se lee la ficha completa de cada candidata (1 038 de 1 604). | 281 | Solo se quedan las que tocan un tema ambiental y no son nominativas, convenios ni concesión directa. Muchas fichas no traen fecha de cierre: el plazo se estima desde el texto («20 días hábiles…») y se avisa de que es estimado. |
| **BOE** | API de sumarios de los últimos 30 días; texto de cada anuncio candidato. | 5 | Solo extractos de convocatorias y licitaciones abiertas con encaje ambiental. |
| **UE · Funding & Tenders** | API SEDIA: 5 búsquedas (LIFE, bosques, biodiversidad, restauración), solo con plazo futuro. | 25 | Casi todo es Horizon Europe, para consorcios de investigación (nota limitada a 58). Hoy no hay ninguna LIFE de naturaleza abierta. |
| **BOCM** (Comunidad de Madrid) | Sumarios XML de los últimos 21 días y texto de cada anuncio candidato. | 1 | Pocas convocatorias ambientales por boletín. |
| **DOG** (Galicia) | Sumarios HTML de los últimos 45 días (secciones I–III y VI). | 0 | Lectura de HTML: se rompe si cambia la web. 0 es normal: ese periodo no publicó nada con encaje. |
| **Fundación Biodiversidad** | Buscador de convocatorias y ficha de cada una (HTML). | 10 | Hoy todas cerradas (se muestran como referencia). Lectura de HTML. |
| **Empresas y fundaciones (RSC)** | Lista hecha a mano en `backend/app/sources/rsc.py`. | 6 | No se actualiza sola: comprobada el 15/11/2026 (ver Mantenimiento). |

El total quita duplicados entre fuentes. Los demás boletines autonómicos, provinciales y municipales llegan solo si
también se publican en la BDNS. La decisión de limitarse a estas siete fuentes está en
[ADR 0002](./docs/adr/0002-solo-las-siete-fuentes-del-reto.md).

Las dos convocatorias de ejemplo del reto aparecen en la lista como próximas ediciones de encaje alto, con su
historial: **BDNS 904719** (Comunidad de Madrid, proyectos ambientales 2026, Orden 1689/2026; Reforesta ya la ganó en
2025, 2024 y 2022) y **BDNS 923290** (MITECO, interés general y protección del medio ambiente 2026). Sus PDF están en
`data/samples/` para probar Analizar PDF.

## Cómo se calcula la nota

Reglas fijas en `backend/app/scoring/` (`score.py`, `profile.py`, `rank.py`, `history.py`). En palabras sencillas:

- **Suma** si el título o la finalidad hablan de lo que hace Reforesta (listas de palabras por línea de trabajo:
  restauración, conservación, educación ambiental, agroambiental y custodia; en castellano, catalán, gallego y
  euskera; el título cuenta más; las palabras ambiguas como «aves» o «natural» solo cuentan en su contexto), si es de
  concurrencia competitiva, si menciona a entidades sin ánimo de lucro, si está abierta o abre pronto, si —con encaje
  temático— no es de los cuatro organismos que ya revisan a mano y si el presupuesto llega a 50.000 €.
- **Resta** si es nominativa, directa o un convenio; si es solo para empresas o ayuntamientos; o si es de otro ámbito
  (patrimonio, caza, pesca, eficiencia energética, becas…). También por territorio: lejos de donde trabaja
  Reforesta, baja.
- **Historial (BDNS)**: suma si Reforesta u ONG ambientales afines ganaron ediciones anteriores; resta y avisa si casi
  nunca la gana una entidad sin ánimo de lucro.
- **Topes**: sin tema ambiental, como mucho 35; nominativa o directa, 25; si una ONG no puede pedirla, 45; Horizon
  Europe, 58. Los programas de empresas quedan como mucho en encaje medio.
- **Niveles**: alto desde 60, medio de 40 a 59, bajo por debajo de 40.

Cada regla aplicada deja una frase en los motivos o los avisos, así que se puede discutir la nota. Las reglas buscan
palabras, no entienden el texto: pueden fallar con convocatorias redactadas de forma poco habitual. Detalle en
[ADR 0005](./docs/adr/0005-puntuacion-por-reglas-explicable.md), [0007](./docs/adr/0007-ajustes-de-territorio-y-tipo-al-leer.md)
y [0012](./docs/adr/0012-puntuar-por-ganadores-de-ediciones-anteriores.md); la vista Perfil de la app enseña las
tablas en uso.

## Lo que se mantiene a mano

- **Programas de empresas** (`backend/app/sources/rsc.py`): seis programas comprobados en la web de cada entidad el
  15/11/2026 (campo `VERIFIED_ON`, que la app muestra como «Comprobado el…»). Cuando una edición cierra o abre hay
  que cambiar fechas e importes a mano. Nada avisa de que la comprobación envejece.
- **Tablas de palabras y pesos** (`backend/app/scoring/profile.py`): cambiarlas exige tocar código y tests. Para
  ajustes del día a día está la vista Perfil, que no requiere a nadie técnico.

Qué hacer, cada cuánto y cómo: [docs/mantenimiento.md](./docs/mantenimiento.md).

## Privacidad

- Del historial de adjudicaciones de la BDNS solo se guardan recuentos por tipo de entidad (sin ánimo de lucro,
  empresa, administración, persona…), importes, fechas y si ganó alguna ONG de una lista conocida. Nunca nombres de
  personas físicas.
- Los datos del equipo (cuentas, tablero, notas, votos) se quedan en la base de datos local. Las contraseñas se
  guardan con Argon2id; de las sesiones, invitaciones y tokens solo se guarda su hash.
- Lo que devuelve el servidor MCP con un token personal (tablero, notas, votos) lo ve el proveedor del agente que
  lo use.

## Documentación

- [docs/backend.md](./docs/backend.md): servicios, cuentas, ingesta, riesgos y lista antes de publicar.
- [docs/mantenimiento.md](./docs/mantenimiento.md): tareas periódicas, copias de seguridad, qué se estropea primero.
- [docs/api-auth.md](./docs/api-auth.md): contrato de la API para la web (cuentas, tablero, votos, ajustes).
- [docs/mcp.md](./docs/mcp.md): conectar un agente de IA.
- [docs/adr/](./docs/adr/README.md): decisiones de arquitectura y por qué se tomaron.
- [backend/README.md](./backend/README.md): código del backend, tests y cómo añadir una fuente.

Pruebas de extremo a extremo (Playwright, app entera con datos fijos, en una pila aparte en los puertos 3090/8090/5490):
`npm run e2e`. Detalle en [e2e/README.md](./e2e/README.md).

Desarrollo del frontend con recarga en caliente (Node.js 20.9 o superior): `docker compose up -d postgres api`,
`npm install` y `npm run dev` (http://localhost:3000, llama a la API en `localhost:8010`).

## Estado y limitaciones conocidas

Prototipo funcional de hackathon, usado con datos reales, sin desplegar en internet.

- **Datos de la mañana.** La lista es la de la última carga. Una convocatoria publicada después de las 9:00 aparece
  al día siguiente, salvo que un administrador pulse «Actualizar ahora». Si pasan más de 36 h sin una carga
  correcta, Inicio lo avisa.
- **Plazos estimados.** Muchas convocatorias BDNS no publican fecha de cierre; la fecha se estima a partir del texto y
  lleva un aviso para confirmarla en el extracto oficial.
- **Fuentes frágiles.** DOG y Fundación Biodiversidad se leen en HTML y dejan de funcionar si cambian su web. Una
  fuente que falla mantiene sus datos anteriores y sale como «Error» o «Parcial» en Fuentes.
- **Cobertura autonómica parcial.** Solo se leen directamente los boletines de Madrid y Galicia.
- **Programas de empresas** a mano: envejecen si nadie los revisa.
- **Sin copias de seguridad automáticas** de Postgres (comandos en [docs/mantenimiento.md](./docs/mantenimiento.md)).
- **Sin alertas** por correo o Slack de convocatorias nuevas o cierres próximos.
- **Una sola organización** por instalación.
