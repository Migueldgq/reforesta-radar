# 0023. Flujo de git: Conventional Commits y PR por tanda

- Estado: Aceptada
- Fecha: 2026-11-15 (primer commit con este formato: 7a81fdc, PR #29)

## Contexto
Hasta el PR #28 cada PR llevaba uno o dos commits grandes con títulos libres. Así cuesta revisar y revertir.

## Decisión
- Mensajes en inglés con Conventional Commits (`feat(scoring): …`, `fix(bdns): …`, `docs: …`).
- Commits pequeños y de un solo propósito.
- Un PR agrupa una tanda de commits relacionados (por ejemplo, PR #29 «fase 0 limpieza», PR #30 «fase 1 matcheo»).

## Consecuencias
- Historial legible por área; cada commit se puede revertir solo.
- Más commits por PR que revisar.

## Alternativas consideradas
- Uno o dos commits grandes por PR: era la práctica anterior (ver contexto).
