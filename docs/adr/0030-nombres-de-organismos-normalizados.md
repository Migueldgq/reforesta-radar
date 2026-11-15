# 0030. Nombres de organismos normalizados al ingestar

- Estado: Aceptada
- Fecha: 2026-11-15 (rama `feat/fase-4-cierre`, migración 0007)

## Contexto
BDNS escribe los organismos en mayúsculas («COMUNIDAD DE MADRID · DIPUTACIÓN PROV. DE CASTELLÓN») y a veces sin
tildes («DIRECCION GENERAL ORDENACION AGROPECUARIA»). La web los pasaba a minúsculas con `tidy()` y salía «Comunidad
de madrid», «Castilla-la mancha», «Diputación prov. De castellón». Además, la Fundación Biodiversidad aparecía como
dos organismos: «Fundación Biodiversidad (MITECO)» (conector `fb`) y «FUNDACIÓN BIODIVERSIDAD · MINISTERIO PARA LA
TRANSICIÓN…» (BDNS), así que el filtro de organismos la partía en dos.

## Decisión
La ingesta guarda cada organismo con su nombre de pantalla, `organism_name` (`backend/app/sources/names.py`):

- Cada parte « · » escrita casi toda en mayúsculas pasa a mayúsculas iniciales a la española: partículas en
  minúscula (de, del, la, y, e, en, para, por, a, i, des, d'…, nunca como primera palabra ni tras guion, barra o
  coma), siglas conocidas y una palabra corta entre paréntesis en mayúsculas («(AGADER)»), códigos con cifras tal
  cual («V5»), guiones y barras («Castilla-La Mancha», «Alicante/Alacant»), elisión catalana («d'Agricultura»).
- Se recuperan las tildes de un diccionario pequeño de palabras administrativas muy comunes (dirección, ordenación,
  consejería, diputación, administración, transición, ecológica, demográfico, pública, agrícola, economía,
  educación…) solo en las partes que venían en mayúsculas.
- Los nombres ya escritos en mayúsculas y minúsculas (los de RSC, la UE, el BOCM…) no se tocan.
- Una tabla corta de alias (`ALIASES`) da un solo nombre a un organismo que llega escrito de dos formas; hoy solo la
  Fundación Biodiversidad.

Se aplica en `run_source` antes de puntuar; la puntuación compara organismos con `normalize_text` (sin mayúsculas ni
tildes), así que no cambia ninguna nota. La migración 0007 reescribe con la misma función lo ya guardado: las filas
de `opportunities`, las fichas del tablero (`tracking.organismo`) y el filtro de organismos guardado del equipo
(`org_settings.organisms`, que guarda nombres), para que el filtro siga coincidiendo.

## Consecuencias
- En los datos de noviembre de 2026 cambian 165 de los 197 nombres distintos; la web ya no necesita `tidy()` para los
  organismos (sigue sirviendo para títulos en mayúsculas).
- La primera ingesta tras la migración registra una vez el cambio de nombre en `opportunity_changes`.
- Las erratas de la fuente se quedan («ORDENACIÓN DELTERRITORIO», «DE I'INFANT»), y un artículo que forma parte del
  topónimo necesita una regla aparte (`FIXES`: «de A Coruña»).
- Un filtro de organismos guardado en una URL antigua o en `localStorage` con el nombre en mayúsculas deja de
  coincidir: la web debe comparar por `normalize`, o el equipo volver a elegirlo.
- El aviso «Convocatoria municipal de …» sigue usando el `_title_case` congelado por la paridad (0020), que pone en
  minúscula lo que va tras un guion («Vitoria-gasteiz»).

## Alternativas consideradas
- Arreglarlo solo en la web: el asistente MCP, las fichas del tablero y el filtro guardado seguirían con los nombres en
  mayúsculas; descartado.
- Aplicarlo al leer: no exigía migración, pero las fichas del tablero se guardan desde la columna `organismo`;
  descartado.
- Quitar la segunda parte repetida («Ayuntamiento de Getafe · Getafe»): cambia más nombres de los pedidos; pendiente.
