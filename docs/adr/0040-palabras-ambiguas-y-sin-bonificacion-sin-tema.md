# 0040. Palabras clave ambiguas y ninguna bonificación sin encaje temático

- Estado: Aceptada
- Fecha: 2026-11-15 (rama `fix/scoring-falsos-positivos`)

## Contexto
El responsable del proyecto vio en el radar una licitación del BOCM del Hospital Gregorio Marañón: «Suministro de
productos alimenticios de aves frescas, congeladas y ovoproductos para la cocina del Hospital». Salía con 30
(«Encaje bajo»), línea «Conservación de hábitats» y los motivos «Encaje temático: Hábitat de aves» y «No es de los
organismos que ya revisáis a mano…: fácil que se os pase». Causas:
- `score_convocatoria` (paso 1) contaba cualquier palabra clave suelta: «aves» bastaba para dar tema, línea de trabajo
  y motivo. El BOCM conserva lo que tiene línea de trabajo y nota base ≥ 35, y esta tenía 44.
- La bonificación de +4 y el motivo «fácil que se os pase» se daban a cualquier convocatoria de un organismo que no
  revisan a mano, encajara o no.
- Si no había ningún motivo, se añadía «Coincidencia parcial con el ámbito ambiental.», que solo podía salir cuando
  no había ninguna coincidencia temática: siempre era falso.
- El aviso de licitación decía «contrato de servicios» también en suministros y obras.

En los datos reales del 15 nov 2026 (ingesta completa: 1 604 convocatorias BDNS, 124 candidatas del BOCM, títulos del
BOE y del DOG), las palabras que encajaban solas con ruido fueron «aves» (1 caso, ruido), «natura» como inicio de
«natural/naturaleza» (≈55 títulos distintos, la mayoría ruido: «catástrofes naturales», «piedra natural», «Paraíso
Natural», «gastos de naturaleza corriente»), «ecosistema» («ecosistema de nodos edge», «ecosistema del destino»
turístico), «hábitat» (la fundación «Hàbitat3», un proyecto urbano) y «sensibilización» (pobreza, IRPF, pymes). Otras
palabras de la lista (bosque, ribera, flora, plantación, sumidero…) no aparecieron solas con ruido.

## Decisión
- `profile.KEYWORD_CONTEXT`: tabla nueva con las palabras ambiguas («aves», «natura», «ecosistema», «habitat»,
  «sensibilizacion») y, para cada una, las expresiones que la confirman («aves esteparias», «rapaces», «ZEPA»,
  «fauna»…; «parques naturales», «espacio natural», «aula de la naturaleza»…). `score.topic_matches` la aplica: una
  palabra ambigua cuenta solo si el título o la finalidad tienen una de sus expresiones o si ha coincidido otra
  palabra clave que no es ambigua. Lo usan el paso 1 de `score_convocatoria` y el tema del título de `rank.kind_fit`.
  `KEYWORD_RULES` no cambia.
- Sin coincidencia temática: ni línea de trabajo, ni motivo «Encaje temático», ni bonificación ni motivo «No es de los
  organismos que ya revisáis a mano»; en su lugar, el aviso «Sin encaje temático: ni el título ni la finalidad hablan
  de vuestras líneas de trabajo.». Se quita «Coincidencia parcial con el ámbito ambiental.». El dato
  `outsideManualSources` sigue (la ficha lo enseña como hecho, sin marca de motivo).
- Dónde se corta: una convocatoria sin encaje temático real **no se lista**. BOCM, DOG y BDNS ya exigían una línea de
  trabajo en `keep()`; el BOE la exige ahora también. Con una coincidencia real se sigue listando aunque sea un
  suministro o el organismo no sea ambiental (un hospital que restaura su jardín pasa por su objeto): el tema se mira
  solo en el objeto (título y finalidad), nunca en el nombre del organismo. Las licitaciones siguen con sus topes
  (0032).
- `rank.tender_warning`: el aviso de licitación dice «contrato de suministro» u «obras» cuando el objeto empieza por
  esa palabra; si no, «servicios» como antes.
- `SCORING_VERSION` 18.

## Consecuencias
Sobre la ingesta real del 15 nov 2026, puntuada con las reglas de antes y de ahora (alto/medio/bajo 40/193/91 →
39/186/80; 324 → 305 en la lista):
- Salen 19: la licitación del hospital, 2 por «ecosistema» (nodos edge, destinos turísticos) y 16 por «natural»
  («catástrofes naturales», «emergencias naturales», ferias de piedra natural, mercados del «Paraíso Natural»,
  deporte «en la naturaleza», juegos escolares «Naturavila», socorrismo en «espazos acuáticos naturais»…). Una era
  «alto» (bdns:929820, formación en emergencias naturales e incendios, 67): queda para que el responsable la revise.
- Cambian 2 de la UE que siguen: un tema Horizon de transporte marítimo pierde «Ecosistemas» (48 «medio» → 27
  «bajo») y «European City Facility» pierde el motivo del organismo.
- Las convocatorias que Reforesta ha ganado (BDNS 904719, 923290) no cambian.
- Paridad con la versión TypeScript (0020): el aviso nuevo marca las diferencias buscadas (`INTENDED`); en el golden
  de la API son 125 ítems sin tema (cambian motivos, no la nota) y 9 que pierden su única palabra ambigua, todos
  ruido. Los fixtures del BOCM y de la UE se editan a mano por lo mismo.
- La tabla de palabras ambiguas se mantiene a mano: una palabra nueva que meta ruido hay que añadirla allí con sus
  expresiones. La vista Perfil todavía no enseña estas condiciones.
- Quedan sin tocar, a decidir por el responsable: «voluntariado» solo (35 convocatorias de voluntariado social o de
  protección civil, 3 en «alto») y «ambiental/medioambiental» solo (ayudas a sindicatos del sector medioambiental,
  premios de medio ambiente y energía, minicentrales hidroeléctricas). Son temas ambiguos, no palabras con otro
  significado.

## Alternativas consideradas
- Excluir el título del hospital o los organismos sanitarios: arregla un caso y no los demás; además el tema ya no se
  mira en el organismo.
- Una lista de bienes ajenos (alimentos, material sanitario, combustible…) como excluyentes de suministros: sin la
  palabra ambigua ninguna licitación de suministro de los datos tenía tema; una lista así se queda corta enseguida.
- Mantenerlas en la lista con nota casi nula: el radar promete señal, no volumen; sin tema no hay nada que revisar.
- Quitar «natura», «aves»… de `KEYWORD_RULES`: se perderían «parques naturales», «aves esteparias» o «aula de la
  naturaleza».
