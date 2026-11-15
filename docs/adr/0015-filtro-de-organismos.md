# 0015. Filtro de organismos en lugar de «fuera de tus 4 fuentes»

- Estado: Aceptada
- Fecha: 2026-11-15 (4afa4dc, PR #25; texto del motivo en b0708f4, PR #29)

## Contexto
Inicio tenía una cifra, una vista rápida y un interruptor para «convocatorias fuera de las 4 fuentes que ya revisáis
a mano». Los usuarios lo leían como «fuera de las fuentes de la app» y resultaba confuso.

## Decisión
Se quitan la cifra, la vista rápida y el interruptor. Un filtro «Organismo» con buscador deja al equipo elegir qué
organismos convocantes ver. La elección se guardaba en el navegador; con cuentas pasa a `org_settings` y es del
equipo (0017). El motivo de puntuación pasa a nombrar los organismos («No es de los organismos que ya revisáis a
mano»). La cuarta cifra muestra las próximas ediciones.

## Consecuencias
- El equipo decide qué organismos le importan, en lugar de una regla fija.
- Se pierde el atajo directo a «lo que no habríais visto»; la información sigue en el motivo de cada convocatoria.

## Alternativas consideradas
- Solo cambiar el texto de la cifra: motivo no registrado.
