# 0034. Desactivar fuentes por configuración

- Estado: Aceptada
- Fecha: 2026-11-15 (rama `feat/fase-4-cierre`)

## Contexto
Cuando una fuente falla durante días o da datos malos, la única forma de quitarla era tocar el código
(`app/sources/__init__.py`) y reconstruir la imagen.

## Decisión
- `RADAR_DISABLED_SOURCES` (ids separados por comas, por ejemplo `dog,bocm`) desactiva fuentes sin cambiar el código.
- La ingesta no las lee. Sus filas guardadas se conservan, pero la API no las sirve: ni en la lista, ni en la portada,
  ni en el asistente MCP.
- Fuentes las muestra con estado `disabled` («Desactivada»), cuenta 0 y una nota que lo explica.
- Al quitarla de la variable, sus convocatorias vuelven tal como estaban y la siguiente ingesta las pone al día.

## Consecuencias
- Desactivar y volver a activar no pierde nada ni obliga a una carga completa.
- Un id desconocido en la variable se ignora con un aviso en el registro de la ingesta.
- La web debe entender el estado `disabled` en `SourceHealth.status`.

## Alternativas consideradas
- Borrar las filas de la fuente al desactivarla: perdería el historial y la reactivación tardaría una ingesta.
- Seguir sirviendo las filas guardadas sin actualizarlas: mostraría como vigentes datos que nadie comprueba.
