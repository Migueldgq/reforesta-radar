# 0018. Votos «sirve / no sirve» para ajustar la puntuación

- Estado: Aceptada
- Fecha: 2026-11-15 (39cad03; rama `feat/fase-2-usuarios`)

## Contexto
Los pesos de la puntuación (0005) los fijamos nosotros a partir del enunciado. Quien sabe si una convocatoria sirve
es el equipo de Reforesta.

## Decisión
Cada persona puede votar una convocatoria «sirve» o «no sirve», con motivo opcional (`votes`, uno por persona y
convocatoria). Los administradores ven los desacuerdos en `GET /api/votes/disagreements`: «sirve» con nota < 40 o
«no sirve» con nota ≥ 60. Sirven para ajustar los pesos con el criterio del equipo y no con el nuestro.

## Consecuencias
- Datos reales para corregir reglas y para decidir si revisar 0006.
- Los votos no cambian la nota automáticamente: alguien tiene que leerlos y tocar las reglas (con su ADR si cambia el
  comportamiento).
- Solo es útil si el equipo vota.

## Alternativas consideradas
- Ajuste automático de pesos con los votos: motivo no registrado.
