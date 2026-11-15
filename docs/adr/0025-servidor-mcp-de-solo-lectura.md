# 0025. Servidor MCP de solo lectura para el asistente del equipo

- Estado: Sustituida por 0026
- Fecha: 2026-11-15 (fecha de registro; no hay commit asociado)

## Contexto
El encaje no usa LLM (0006), pero razonar sobre las bases con un asistente de IA puede ayudar al equipo. El
proyecto no quiere pagar un modelo.

## Decisión (propuesta, planificada)
Un servidor MCP con herramientas de solo lectura sobre los mismos datos (oportunidades, motivos y avisos, historial,
tablero) para que el asistente de IA que ya use el equipo pueda consultarlos.

## Consecuencias si se acepta
- El equipo obtiene razonamiento con IA sin que el proyecto pague el modelo.
- Hay que decidir cómo se autentica (las cuentas de 0016 son por cookie) y qué datos del equipo expone.
- Una superficie más que mantener y asegurar.

## Alternativas consideradas
- Integrar un LLM en la app: ver 0006.
