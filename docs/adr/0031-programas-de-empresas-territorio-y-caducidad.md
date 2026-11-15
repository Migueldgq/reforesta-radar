# 0031. Programas de empresas: su territorio, su etiqueta y aviso de lista caducada

- Estado: Aceptada
- Fecha: 2026-11-15 (rama `feat/fase-4-cierre`)

## Contexto
Los programas de [0013](0013-programas-de-empresas-lista-comprobada.md) salían todos con `region: "Estatal"`, también
la Fundación Unicaja, que solo financia proyectos en Andalucía o en la provincia de Ciudad Real, y con la etiqueta de
fuente «RSC · Privado», que la web no distinguía bien de las de un boletín. La fecha de comprobación estaba escrita
dos veces (`VERIFIED_ON` y la nota de `RSC_HEALTH`) y nada avisaba cuando la lista se quedaba antigua.

## Decisión
- `region` de un programa es su `territory` cuando la entidad limita dónde se hace el proyecto, y «Estatal» solo
  cuando acepta proyectos en toda España. `geographic_fit` no penaliza el territorio de un ítem `empresa`: ese límite
  ya es uno de sus límites comprobados (resta y avisa una vez).
- `sourceLabel` de todos los programas es «Programa de empresa/fundación» (`kind` sigue siendo `empresa` y
  `nivelAdmin` `Privada`).
- `VERIFIED_ON` es la única fecha: la nota de Fuentes y «Programa privado comprobado…» salen de ella.
- Pasados `STALE_AFTER_DAYS` (180) días desde `VERIFIED_ON`, la fuente sale como «partial» con «Lista comprobada hace
  N meses: toca revisarla.» y cada programa lleva el aviso «Datos comprobados hace N meses: pueden haber cambiado;
  revisa la web de la entidad.» (sin restar puntos). Se recalcula en cada ingesta diaria.

## Consecuencias
- Ninguna nota cambia hoy. El filtro de territorio del asistente encuentra la Fundación Unicaja por «Andalucía» o
  «Ciudad Real».
- `region` de un programa puede ser un texto libre («Andalucía o provincia de Ciudad Real»), no un nombre de
  comunidad: la web no debe buscarlo en el mapa ni en los ajustes de territorio del Perfil.
- 180 días es un umbral elegido para una revisión semestral como mínimo (el mantenimiento recomienda una mensual);
  motivo del número exacto no registrado.

## Alternativas consideradas
- Una lista de comunidades por programa: más exacta para el mapa, pero «provincia de Ciudad Real» no es una
  comunidad; pendiente si la web lo necesita.
- Restar puntos a una lista caducada: no la hace menos cierta, solo más dudosa; se prefirió el aviso.
