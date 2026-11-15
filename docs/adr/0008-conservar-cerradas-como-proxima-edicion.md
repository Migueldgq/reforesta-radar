# 0008. Conservar las convocatorias cerradas como próxima edición

- Estado: Aceptada
- Fecha: 2026-11-14 (ff94886, PR #2)

## Contexto
Muchas convocatorias son anuales. Si solo se muestran las abiertas, una buena convocatoria que cerró la semana pasada
desaparece y el equipo se entera tarde de la siguiente edición. Las dos convocatorias de ejemplo del reto estaban
cerradas.

## Decisión
Las convocatorias competitivas cerradas en los últimos 12 meses se conservan, ordenadas por debajo de las abiertas,
con el motivo «la edición actual cerró el …; prepara la siguiente con tiempo». Las subvenciones competitivas
recurrentes para entidades sin ánimo de lucro mantienen su nota de encaje: el nivel responde a «¿es para nosotros?» y
el estado del plazo a «¿podemos pedirla ahora?» (f28b462).

## Consecuencias
- Las dos convocatorias de ejemplo del reto (BDNS 923290 y 904719) aparecen en la lista.
- Hay muchas más filas cerradas que abiertas; de ahí la vista «Próximas ediciones» (0014) y el historial BDNS (0012).

## Alternativas consideradas
- Descartar las cerradas: era el comportamiento anterior; se perdían las convocatorias recurrentes.
