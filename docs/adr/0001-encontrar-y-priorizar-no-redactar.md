# 0001. Encontrar y priorizar convocatorias, no redactar propuestas

- Estado: Aceptada
- Fecha: 2026-11-14 (cfb6d85, primer commit con `RETO.md`)

## Contexto
Reforesta presenta 4 o 5 solicitudes al año. Según el enunciado (`RETO.md`), el tiempo se va en encontrar
convocatorias y en leer decenas de páginas para saber si encajan, no en escribir. El propio reto dice: «no redacta la
propuesta. Reforesta ya sabe escribir; lo que le falta es capacidad para encontrar y priorizar».

## Decisión
La herramienta encuentra, puntúa y explica convocatorias (públicas y de empresas), y ayuda al equipo a seguirlas
hasta presentarlas. No genera textos de solicitud.

## Consecuencias
- Todo el esfuerzo va a cobertura de fuentes, calidad del encaje y explicaciones.
- No hace falta un modelo generativo (ver 0006).
- Si el equipo pide ayuda para redactar, queda fuera de alcance: exigiría un ADR nuevo.

## Alternativas consideradas
- Asistente de redacción de propuestas: excluido por el enunciado.
