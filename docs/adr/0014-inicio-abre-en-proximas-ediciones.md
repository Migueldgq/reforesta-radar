# 0014. Inicio abre en «Próximas ediciones» si nada abierto encaja bien

- Estado: Aceptada
- Fecha: 2026-11-15 (91ae6d5, ccb0b4f, 7ceda8c; PR #30)

## Contexto
Hay días en que ninguna convocatoria abierta tiene encaje alto. Abrir Inicio en una lista de abiertas mediocres
da la impresión de que el radar no sirve, mientras lo útil está en las próximas ediciones (0008).

## Decisión
Si al cargar los primeros datos no hay ninguna convocatoria abierta de encaje alto (tras los ajustes del Perfil; las
que no tienen fecha no cuentan como abiertas), Inicio abre en la pestaña «Próximas ediciones» y muestra un aviso que
lo explica. Se decide una sola vez y no se aplica si la URL ya indica una pestaña; la pestaña elegida se recuerda al
recargar.

## Consecuencias
- El equipo ve primero algo accionable.
- La vista por defecto depende de los datos del día, lo que puede despistar; el aviso lo compensa.

## Alternativas consideradas
- Abrir siempre en abiertas: era el comportamiento anterior; ver contexto.
