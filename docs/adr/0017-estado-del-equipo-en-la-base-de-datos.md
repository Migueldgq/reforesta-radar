# 0017. Estado del equipo en la base de datos

- Estado: Aceptada
- Fecha: 2026-11-15 (d999cde, 39cad03; rama `feat/fase-2-usuarios`)

## Contexto
El tablero de seguimiento, el perfil y el filtro de organismos se guardaban en `localStorage`: cada navegador tenía
el suyo y el equipo no veía lo mismo (limitación del `README.md` y primer «siguiente paso»).

## Decisión
- El estado del equipo vive en Postgres: tablero (`tracking`, `tracking_notes`) con estado, responsable y notas;
  perfil y filtro de organismos (`org_settings`, una fila para toda la organización).
- Cada fila de `tracking` guarda una copia de título, organismo, plazo y enlace, así que una convocatoria que deja
  de aparecer en las fuentes sigue en el tablero.
- Todo miembro puede editarlo todo; gana la última escritura por campo.
- Lo que cada navegador tenía se importa una vez (`POST /api/import`): lo que el equipo ya guardó siempre gana; el
  navegador solo rellena huecos.

## Consecuencias
- Un tablero compartido para todo el equipo y entre dispositivos.
- Sin bloqueos ni historial de cambios: dos personas que editan a la vez pisan sus cambios.
- La app (salvo la portada) exige sesión (0016).

## Alternativas consideradas
- Permisos por tarjeta o por rol: motivo no registrado.
