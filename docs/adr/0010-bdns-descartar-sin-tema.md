# 0010. BDNS: descartar las convocatorias sin tema ambiental

- Estado: Aceptada
- Fecha: 2026-11-15 (6d5c57f, PR #29)

## Contexto
La BDNS se consulta con búsquedas «prioritarias» del tercer sector (interés general, IRPF 0,7 %). La versión
TypeScript conservaba cualquier convocatoria de esas búsquedas abierta a ONG aunque no tocara ninguna línea de
trabajo. En una ejecución real eso metía unas 260 convocatorias sociales (mayores, mujeres, discapacidad, IRPF) y
ninguna ambiental.

## Decisión
`keep()` del conector BDNS exige al menos una línea de trabajo (coincidencia de tema) para toda convocatoria, venga
de la búsqueda que venga. Las búsquedas prioritarias siguen leyendo sus fichas primero.

## Consecuencias
- Desaparecen unas 260 convocatorias que solo hacían ruido.
- Una convocatoria genérica de interés general que sí financie proyectos ambientales sin nombrarlos en título o
  finalidad se pierde.

## Alternativas consideradas
- Mantener la excepción y bajarles la nota: motivo no registrado.
