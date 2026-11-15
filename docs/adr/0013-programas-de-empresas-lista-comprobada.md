# 0013. Programas de empresas: lista comprobada a mano

- Estado: Aceptada
- Fecha: 2026-11-15 (339154d y a29d629, PR #30)

## Contexto
El canal de empresas (RSC) es uno de los objetivos del reto. No hay una fuente pública que agregue estos programas.
Una auditoría contra las webs de cada entidad encontró mal cinco de las seis entradas originales (una inventada, una
que no era un programa de financiación, dos solo sociales, una discontinuada) y ningún importe ni fecha que cuadrara
con una fuente.

## Decisión
`backend/app/sources/rsc.py` es la única lista de programas (la web la lee de la API; se borró la copia en
TypeScript). Cada entrada se comprueba en la web de la entidad: página del programa, bases, importe tal como se
publica, última ventana, requisitos y límites. `VERIFIED_ON` guarda la fecha de comprobación y lo que no se pudo
comprobar se marca explícitamente «sin comprobar». `score_rsc` trata cada programa como una convocatoria (abierta o
cerrada según su ventana) y cada límite resta y deja un aviso.

## Consecuencias
- Lo que ve el equipo es verificable, con enlaces a la fuente.
- La lista no se actualiza sola: al abrir o cerrar una edición hay que editar `rsc.py`.
- Solo seis programas: cobertura pequeña.

## Alternativas consideradas
- Mantener la lista anterior: descartado tras la auditoría.
- Rastrear webs de fundaciones automáticamente: motivo no registrado.
