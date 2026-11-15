# 0009. BDNS: leer la ficha completa de cada candidata

- Estado: Aceptada
- Fecha: 2026-11-15 (2bd5e7b, PR #27; concurrencia en 7a81fdc, PR #29)

## Contexto
La versión TypeScript solo descargaba la ficha de las 230 convocatorias más prometedoras, porque leía en vivo dentro
de una petición web de 35 s. El resto quedaba «lite»: sin plazo, tipo ni beneficiarios. El tope dejaba 286
convocatorias sin esos datos; en total, 313 sin fecha de cierre conocida.

## Decisión
La ingesta, que ya es un proceso por lotes (hasta 8 min por fuente), lee la ficha de **toda** candidata que pasa la
preselección. `MAX_ENRICH` sube de 230 a 2000 y queda solo como límite de seguridad. Para no castigar la API pública:
`DETAIL_CONCURRENCY = 4` (la mitad que antes) y hasta 3 reintentos ante 429, 5xx o errores de red. Las fichas se
guardan en `fetch_cache` (0021).

## Consecuencias
- Las convocatorias sin fecha de cierre conocida pasaron de 313 a 72.
- Con la ficha, `keep()` ve el tipo real y descarta las no competitivas.
- Ingesta en frío de unos 2 min (la BDNS responde 429 a cerca de la mitad de los primeros intentos); en caliente,
  unos 10 s.
- Los ítems lite ya solo aparecen cuando una ficha falla.

## Alternativas consideradas
- Mantener el tope de 230: existía por un límite de tiempo que el backend por lotes ya no tiene.
