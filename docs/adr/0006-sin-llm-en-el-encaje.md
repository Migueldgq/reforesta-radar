# 0006. Sin LLM en el encaje, por ahora

- Estado: Sustituida por 0041
- Fecha: 2026-11-14 (03f68f1, «No usa inteligencia artificial generativa ni claves de API» en el `README.md`)

## Contexto
Se podría pedir a un modelo de lenguaje que leyera cada convocatoria y juzgara si encaja. Motivos que dio el
responsable del proyecto para no hacerlo todavía: el dominio es estrecho y las reglas bastan; las reglas son gratis,
deterministas y explicables; el equipo leerá las bases de todos modos; y aún no hay pruebas de que las reglas fallen.

## Decisión
El encaje se calcula solo con reglas (0005). No hay llamadas a modelos ni claves de API.

Se revisará cuando haya opiniones reales del equipo (votos «sirve / no sirve», 0018) que muestren fallos de las
reglas. El único sitio que se ha considerado para un LLM más adelante es «Analizar PDF», bajo demanda.

## Consecuencias
- Sin coste por uso, sin dependencia de un proveedor y con resultados reproducibles.
- Sin comprensión del texto: los falsos positivos y negativos de las reglas siguen ahí.
- La revisión depende de que el equipo vote lo bastante.

## Alternativas consideradas
- LLM para puntuar cada convocatoria en la ingesta: coste, no determinista y difícil de explicar.
- Dar acceso de solo lectura al asistente de IA del propio equipo: ver 0025 (propuesta).
