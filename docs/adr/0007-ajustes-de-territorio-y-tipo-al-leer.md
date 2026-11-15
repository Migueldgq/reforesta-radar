# 0007. Ajustes de territorio y tipo al leer, con topes

- Estado: Aceptada
- Fecha: 2026-11-14 (5544cf3, PR #8; f28b462, PR #9)

## Contexto
Una convocatoria puede hablar de restauración y aun así no servir: exige sede en otra comunidad, es de un
ayuntamiento lejano, es una licitación o un anuncio informativo. Sin tope, esas subirían arriba solo por sus
palabras.

## Decisión
La ingesta guarda el encaje **base**. Al leer, `backend/app/scoring/rank.py` aplica `geographic_fit` y `kind_fit`
(constantes en `profile.py`, `GeoFit` y `KindFit`):

- territorio: suma para estatal y Comunidad de Madrid; resta para otras comunidades y municipios ajenos, y si resta,
  tope en 50 (`out_of_territory_cap`);
- tipo: licitaciones −15 y tope 57; anuncios que no son convocatoria, tope 45; temas de Horizon Europe, tope 48;
  universidades, tope 45; sin tema en el título, tope 30.

Cada ajuste deja su motivo o aviso.

## Consecuencias
- Lo que Reforesta no puede pedir no llega a encaje alto, aunque hable de sus temas.
- Cambiar el ranking no exige volver a ingestar (motivo en `docs/backend.md`).
- La vista Perfil aplica los ajustes del equipo en el navegador encima de esta nota (`src/lib/scoring.ts`), así que
  la lógica está en dos lenguajes.
- Topes fijos: una convocatoria de otra comunidad abierta a entidades de toda España puede quedar infravalorada.

## Alternativas consideradas
- Excluir del todo lo que no es de su territorio: motivo no registrado.
