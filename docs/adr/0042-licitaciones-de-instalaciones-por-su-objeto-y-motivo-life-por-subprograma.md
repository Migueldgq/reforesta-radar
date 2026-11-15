# 0042. Licitaciones de instalaciones juzgadas por su objeto y motivo LIFE según el subprograma

- Estado: Aceptada
- Fecha: 2026-11-15 (rama `feat/revision-ia`)

## Contexto
Dos reglas decían algo falso:
- La regla de licitaciones de instalaciones de [0032](0032-reglas-de-sector-leader-y-licitaciones-de-instalaciones.md)
  saltaba con la palabra «suministro» en cualquier parte del título y dejaba la licitación en 30 con el aviso «el tema
  sale del nombre del centro». Hundía también un «Suministro de planta forestal para reforestación», cuyo tema es el
  propio objeto.
- Toda convocatoria LIFE llevaba el motivo «Programa LIFE: el instrumento europeo de referencia para naturaleza y
  biodiversidad», también `LIFE-2025-CET-EUCF` (European City Facility), del subprograma de transición a la energía
  limpia.

## Decisión
- `rank.facility_tender`: una licitación de vigilancia, limpieza, suministros o mantenimiento (`FACILITY_SERVICE`)
  solo se topa en 30 con el aviso si su objeto, sin el nombre del centro al que sirve, no tiene tema propio. El objeto
  es lo que sigue a «Objeto:» o «contrato de»; el nombre del centro, lo que empieza por «de/del/en/para (el/la…)
  centro, edificio, sede, instalaciones, dependencias u oficinas». Lo usan `kind_fit` y `kind_ceiling`.
- `eu.to_raw`: el subprograma sale del identificador de la convocatoria. `NAT`: el motivo de siempre. `CET`: ningún
  motivo LIFE y el aviso «Subprograma LIFE de transición a la energía limpia: es de energía, no de naturaleza ni
  biodiversidad.». Los demás (`ENV`, `CLIMA`…): «Programa LIFE: el programa europeo de medio ambiente y acción por el
  clima.». La nota no cambia: el motivo LIFE nunca sumaba puntos.
- `SCORING_VERSION` 19.

## Consecuencias
- Diferencias buscadas en las referencias congeladas (0020), editadas a mano, no regeneradas:
  - `tests/fixtures/eu/expected.json`: `eu:LIFE-2025-CET-EUCF` pierde el motivo LIFE y gana el aviso CET (nota 35
    igual).
  - En el golden de la API, `ted:746638-2026` («Suministro de árboles y tutores… plantación en zonas verdes») deja de
    contar como licitación de instalaciones; su nota sigue en 12 y ahora coincide con la del TypeScript. Las dos del
    CENEAM siguen topadas en 30.
  - El golden de la API conserva el motivo LIFE de la convocatoria CET: es la salida congelada del TypeScript y
    `tests/golden_reconstruct.py` reproduce aquel conector.
- Al desplegar una `SCORING_VERSION` nueva, `ingest-scheduler` ingesta en el acto (antes, las notas viejas seguían
  hasta las 9:00 del día siguiente).
- La lista de palabras del nombre de un centro se mantiene a mano, como la de servicios de instalaciones.

## Alternativas consideradas
- Quitar «suministros» de `FACILITY_SERVICE`: los suministros de oficina o combustible de un centro de educación
  ambiental volverían a subir por el nombre del centro.
- Quitar el motivo LIFE a todas: perderían un motivo verdadero las de naturaleza y biodiversidad.
