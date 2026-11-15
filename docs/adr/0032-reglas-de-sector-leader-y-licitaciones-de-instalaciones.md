# 0032. Asociaciones del sector, grupos LEADER y licitaciones de instalaciones

- Estado: Aceptada
- Fecha: 2026-11-15 (rama `feat/fase-4-cierre`)

## Contexto
Tres tipos de convocatoria puntuaban como si fueran para una ONG ambiental:
- Ayudas a agrupaciones de defensa sanitaria ganaderas, asociaciones de cazadores o comunidades de regantes. La
  categoría BDNS «personas jurídicas que no desarrollan actividad económica» o la palabra «asociaciones» sumaban la
  señal de ONG (+10/+14), aunque las asociaciones son las del propio sector.
- Gastos de funcionamiento y animación de los Grupos de Desarrollo Rural (LEADER): solo esos grupos pueden pedirlos,
  y llegaban a «alto» (62).
- Licitaciones de vigilancia o mantenimiento de las instalaciones del CENEAM: el tema («Educación Ambiental») venía
  del nombre del centro. Quedaban en el tope de licitación (57) y, con el ajuste «Educación» del Perfil, subían a 67
  «alto», porque el Perfil se aplica después de los topes por tipo.

## Decisión
- `score.py`, paso 4: si salta un aviso de sector (caza, pesca, acuicultura, regadíos, explotaciones ganaderas o
  agrarias) y el texto no nombra expresamente a entidades sin ánimo de lucro (ONG, entidades no lucrativas, tercer
  sector…), no hay señal de ONG: elegibilidad desconocida y aviso «Las asociaciones a las que se dirige son del propio
  sector…».
- `score.py`, paso 4: «grupos de desarrollo rural / acción local» junto a «funcionamiento», «animación», «apoyo a los
  grupos» o «gestores de la estrategia» en el título: no elegible, −30 y aviso «Para los Grupos de Desarrollo Rural
  (LEADER) de la zona: solo ellos pueden pedirla.».
- `rank.kind_fit`: una licitación cuyo título es un servicio de vigilancia, seguridad, limpieza, suministros o
  mantenimiento de instalaciones, edificios o equipos queda en el tope «fuera de tema» (30), con aviso.
- `fit.scoreCap` lleva el tope por tipo aplicado (`rank.kind_ceiling`). Ningún ajuste posterior (el Perfil, en
  `team_profile.py` y en la web) puede subir una convocatoria por encima de él; sí puede bajarla.
- `SCORING_VERSION` 17.

## Consecuencias
Sobre las 327 convocatorias del radar del 15 nov 2026 (alto/medio/bajo 37/197/93 → 34/192/97, 323 en la lista):
- Salen de la lista (bajan del umbral de 25): los tres gastos de funcionamiento LEADER (bdns:920464, 910261, 913981)
  y bdns:895021 (asociaciones de caza de Felanitx).
- Las dos licitaciones del CENEAM pasan de 57 «medio» a 30 «bajo».
- Trece ayudas del sector bajan 10 o 14 puntos (p. ej. bdns:939835, ADS ganaderas de Castilla-La Mancha, 59 → 49;
  bdns:905310, regadíos, 62 «alto» → 52).
- La web tiene que aplicar el mismo límite con `scoreCap` en su paso de Perfil (`src/components/radar/profile.ts`).
- Las pruebas de paridad con la versión TypeScript ([0020](0020-paridad-congelada-con-la-version-typescript.md))
  registran estos casos como diferencias buscadas (`KNOWN_GAPS`, `INTENDED`).

## Alternativas consideradas
- Aplicar el Perfil antes de los topes por tipo: obligaba a mover el Perfil al servidor para la web, que lo aplica en
  el navegador sin recargar.
- Descartar del todo las licitaciones de instalaciones: el tope deja verlas en «bajo» por si el equipo las quiere.
