# 0041. Revisión por IA: una segunda opinión que solo descarta, nunca puntúa

- Estado: Aceptada
- Fecha: 2026-11-15 (rama `feat/revision-ia`)
- Sustituye a [0006](0006-sin-llm-en-el-encaje.md)

## Contexto
0006 dejó el encaje solo a reglas «por ahora», a revisar cuando hubiera pruebas de que las reglas fallan. Las hay:
tras [0040](0040-palabras-ambiguas-y-sin-bonificacion-sin-tema.md) quedaron en la lista temas que las palabras clave no
distinguen, porque la palabra es la correcta y el sentido no: «voluntariado» solo (35 convocatorias de voluntariado
social o de protección civil, 3 en «alto»), «ambiental/medioambiental» solo (ayudas a sindicatos del sector
medioambiental, premios de medio ambiente y energía) y minicentrales hidroeléctricas. Una lista de excluyentes para
cada caso se queda corta enseguida (0040, alternativas). El responsable del proyecto aprobó este diseño.

## Decisión
- Las reglas siguen dando la nota (0005). La IA no la sube ni la cambia nunca: solo opina si el **tema** de la
  convocatoria tiene que ver con el trabajo de Reforesta. Requisitos, territorio, importe y plazos siguen siendo cosa
  de las reglas.
- Modelo: Google Gemini `gemini-flash-lite-latest` (`RADAR_AI_MODEL`) por su API REST `generateContent`, con el
  cliente HTTP que ya usa el backend (`httpx`; ninguna dependencia nueva), `temperature` 0 y respuesta JSON atada a un
  esquema: `veredicto` `si` | `no` | `dudoso` y `motivo`, una frase en castellano. El código lo valida otra vez
  (`app/review.py`): un veredicto desconocido, un JSON roto o un motivo vacío cuentan como «sin veredicto»; el motivo se
  limpia de caracteres de control, se recorta a 200 caracteres y se muestra como texto plano.
- Solo se envía el texto público de la convocatoria: título, organismo, tipo y finalidad o resumen. Nunca datos de
  personas, notas, votos, tablero, correos ni nada del equipo. El texto va como dato en el mensaje del usuario y las
  instrucciones en la instrucción de sistema, que pide ignorar cualquier orden que traiga el texto.
- Cuándo: en la ingesta, después de guardar (a la vez que el historial BDNS), solo para las convocatorias sin un
  veredicto vigente, de mejor a peor nota y como mucho `RADAR_AI_MAX_CALLS` (300) por ejecución. Dos peticiones a la
  vez, 30 s por petición, dos reintentos tras un 429 o un 5xx (con la espera que indica Google) y parada tras tres 429
  seguidos (cuota agotada). Al arrancar `ingest-scheduler` se ejecuta una vez el paso solo, para que un cambio de
  instrucciones o de modelo surta efecto tras desplegar. Los programas de empresas no se envían: esa lista se
  comprueba a mano (0013).
- Caché: tabla `ai_reviews` (migración 0009), una fila por convocatoria con un hash del texto enviado, la versión de
  las instrucciones (`PROMPT_VERSION`) y el modelo. Un veredicto vale mientras el hash coincide; si cambia algo, la
  convocatoria se ve sin veredicto hasta que se vuelve a preguntar.
- **Falla abierto**: cualquier error (sin respuesta, 429, error HTTP, respuesta no válida) es «sin veredicto» y la
  convocatoria sigue en la lista por las reglas. La ingesta nunca falla por la IA.
- Efecto del veredicto:
  - `no`: sale de la lista por defecto y de todas las cifras de Inicio, pero no se borra: queda en «Descartadas por la
    IA (n)», debajo de la lista, con su motivo. Una convocatoria que el equipo ya sigue (cualquier fila en el tablero:
    estado, responsable o notas) o que alguien votó «Nos sirve» nunca se oculta. «Sí encaja» en la ficha es
    precisamente ese voto «Nos sirve» (0018), así que se recuerda sin tabla nueva y sirve también para ajustar reglas.
  - `dudoso`: sigue en la lista con una etiqueta neutra «Revisión por IA: dudosa».
  - `si`: sigue en la lista; la ficha enseña la revisión.
  - En la ficha va en su propio apartado «Revisión por IA», separado de los motivos de las reglas.
- API y MCP: cada convocatoria lleva `aiReview` (`revisionIA` en el MCP). `/api/oportunidades` y las herramientas MCP
  dejan fuera los `no` con la misma regla (`?descartadas=1` o `incluir_descartadas` los incluyen). La API pública, el
  MCP sin sesión y la portada no saben nada del equipo, así que ocultan todos los `no`.
- Apagada por defecto: sin `GEMINI_API_KEY`, o con `RADAR_AI_REVIEW=false`, no se envía nada, no se lee nada de
  `ai_reviews` y la app se comporta exactamente como antes, sin rastro de la revisión en la interfaz.

## Consecuencias
- Se quita ruido que las reglas no pueden distinguir sin tocar la nota ni sus motivos, y lo descartado se puede
  auditar y devolver.
- Google recibe el texto público de las convocatorias; nada más. Con el nivel gratuito, Google puede usar lo enviado
  para mejorar sus productos: es texto ya publicado en boletines oficiales.
- Nivel gratuito: cuota por minuto y por día limitada; `gemini-flash-lite-latest` respondió en ~1 s por convocatoria
  en las pruebas (un día antes, ~8 s; el modelo no «lite» tardó más de 40 s). Con la caché, cada día solo se pregunta
  por lo nuevo o lo cambiado. Si se agota la cuota, lo que falte se pregunta en la siguiente ingesta.
- No determinista: el mismo texto puede recibir otro veredicto con otro modelo o en otro momento. Se mitiga con
  `temperature` 0 y con la caché (un veredicto no cambia mientras no cambie el texto, las instrucciones o el modelo).
- Puede equivocarse hacia `no` con una convocatoria que sí encaja. Las instrucciones piden `dudoso` ante la duda y
  nunca `no` para temas ambientales; aun así, el equipo debe mirar «Descartadas por la IA» de vez en cuando.
- Un paso más que mantener: la clave, la cuota y el texto de las instrucciones (`docs/mantenimiento.md`).
- Los textos que decían «sin IA» (portada, README, MCP) dicen ahora la verdad en los dos estados: la nota sale de
  reglas; una IA, si está activada, solo ayuda a descartar.

## Alternativas consideradas
- Que la IA puntúe o ajuste la nota: lo descartó 0006 (coste, no determinista, difícil de explicar) y el responsable
  quiere la nota por reglas.
- Más excluyentes en las reglas para «voluntariado» o «ambiental»: cada caso nuevo exige otra regla (0040).
- Borrar o no listar los `no`: no se podrían auditar ni recuperar.
- Una capa de proveedores intercambiables: un solo proveedor no la justifica.
- El SDK de Google: el cliente HTTP del backend basta para una petición REST.
- El modelo no «lite»: tardaba más de 40 s por petición en el nivel gratuito.
