# Conectar el radar a tu agente de IA (Claude)

Con esto, puedes preguntarle a Claude cosas como «¿qué hay abierto para charcas en Madrid?» y él mira el radar por
ti. Se hace una vez y tarda un par de minutos.

## Antes de empezar: qué tiene que ser verdad

- **El radar tiene que estar publicado en internet, con una dirección que empiece por `https://`** (por ejemplo
  `https://radar.reforesta.es`). Claude en la web y en la aplicación de escritorio se conecta desde los ordenadores de
  Anthropic, no desde el tuyo: si el radar solo funciona en el portátil de alguien (`http://localhost…`), no le llega.
- Si el radar está **solo en un ordenador**, únicamente funciona con **Claude Code** en ese mismo ordenador (apartado
  «Si usas Claude Code», más abajo).
- Necesitas tu **cuenta del radar** (el correo y la contraseña con los que entras en la web).
- Si vuestra cuenta de Claude es de empresa (plan Team o Enterprise), puede que el conector tenga que añadirlo
  primero la persona que administra Claude en Reforesta. Después, cada persona solo pulsa «Conectar».

## 1. Conectarlo (Claude en la web o en la aplicación de escritorio)

1. En la web del radar: tu nombre (abajo a la izquierda) → **Mi cuenta** → **Conectar un agente de IA**. Ahí verás la
   **dirección del radar** para el agente. Pulsa **Copiar**. Termina en `/mcp/equipo`.
2. En Claude: abre **Ajustes** (en algunas versiones, **Configuración**; está en tu nombre o tu foto, abajo a la
   izquierda) → **Conectores**.
3. Pulsa **Añadir conector personalizado**.
4. Nombre: `Reforesta Radar`. URL: pega la dirección que copiaste. No toques las opciones avanzadas. Pulsa
   **Añadir**.
5. Pulsa **Conectar**. Se abre una ventana del radar:
   - si no tenías la sesión abierta, entra con tu correo y tu contraseña de siempre;
   - verás «**Claude quiere leer el radar de Reforesta con tu cuenta**: convocatorias, tablero del equipo, notas y
     votos. Solo lectura; no puede cambiar nada», con una etiqueta verde «Claude» y «El permiso se envía a
     claude.ai».
6. Pulsa **Permitir**. La ventana vuelve a Claude y el conector aparece como conectado.

Si en el paso 5 ves una etiqueta amarilla «**No reconocido**» o una dirección que no es `claude.ai`, pulsa
**No permitir**: no es Claude.

Continúa solo si tú mismo acabas de pulsar «Conectar» en tu propio Claude; si alguien te ha enviado el enlace de esa
página, pulsa **No permitir**, aunque diga «Claude».

En una conversación nueva, comprueba que el conector «Reforesta Radar» está activado (en el menú de herramientas,
debajo de donde escribes) y pregunta.

### Si usas Claude Code

En una terminal, con la dirección que te da Mi cuenta:

```bash
claude mcp add --transport http reforesta-radar https://<la-dirección-del-radar>/mcp/equipo
```

Abre Claude Code, escribe `/mcp`, elige `reforesta-radar` y **Authenticate**. Se abre el navegador con el radar:
entra y pulsa **Permitir**.

## 2. Qué preguntarle

Algunas preguntas que el radar sabe responder:

1. «¿Qué convocatorias hay abiertas ahora para charcas o anfibios en la Comunidad de Madrid?»
2. «¿Qué cierra en los próximos 30 días con encaje alto para Reforesta?»
3. «Busca subvenciones de reforestación de ámbito estatal y ordénalas por fecha de cierre.»
4. «¿Cuándo suele abrir la convocatoria de proyectos ambientales de la Comunidad de Madrid, y la ha ganado Reforesta
   alguna vez?»
5. «¿Qué fundaciones o empresas financian proyectos de reforestación o educación ambiental?»
6. «¿Qué tenemos en estudio en el tablero y quién lleva cada una?»
7. «¿Qué lleva Ana en el tablero y qué se nos cierra pronto?»
8. «Resúmeme la ficha de esta convocatoria: importe, quién puede pedirla, documentos y plazo.» (pegando el título)
9. «¿Por qué esta convocatoria tiene un 45? ¿Qué le falta para encajar mejor?»
10. «¿De cuándo son los datos del radar? ¿Alguna fuente ha fallado?»

Pide siempre el enlace oficial: las bases de la convocatoria mandan sobre lo que diga el radar o el agente.

## 3. Desconectarlo

- **Desde el radar** (lo más seguro): Mi cuenta → Conectar un agente de IA → en «Agentes de IA conectados», **Desconectar**.
  Deja de funcionar al momento.
- **Desde Claude**: Ajustes → Conectores → Reforesta Radar → Desconectar o eliminar.
- También se desconecta solo si cambias o restableces tu contraseña, o si te desactivan la cuenta. Para volver a
  usarlo, pulsa otra vez **Conectar** en Claude.

## 4. Qué puede ver y qué no

- **Puede ver:** las convocatorias y programas de empresas del radar, de cuándo son los datos, cómo se puntúa, y del
  equipo: el tablero (estado de cada convocatoria y quién la lleva), las notas, los votos «sirve / no sirve» y los
  ajustes del Perfil.
- **No puede:** cambiar nada (ni el tablero, ni notas, ni votos, ni el Perfil), ver correos ni contraseñas de nadie,
  ni analizar PDFs.
- **Lo que lee, lo ve también Anthropic** (la empresa de Claude), como cualquier cosa que le cuentes a Claude. Las
  notas del equipo salen del radar cuando el agente las consulta: no escribáis en ellas nada que no deba salir.

## 5. Si algo no funciona

| Lo que ves | Qué hacer |
|---|---|
| Claude dice que no puede conectar o que la dirección no responde | Comprueba que la dirección empieza por `https://` y termina en `/mcp/equipo`. Si el radar solo está en un ordenador, con Claude en la web no funcionará (ver «Antes de empezar»). |
| Al pulsar Conectar no se abre ninguna ventana | Mira si el navegador bloqueó la ventana emergente y permítela. |
| «Esta solicitud ya no vale» en el radar | Han pasado más de 10 minutos o se abrió en otro navegador. Vuelve a Claude y pulsa Conectar otra vez. |
| «Correo o contraseña incorrectos» | Son los de la web del radar, no los de Claude. Si no la recuerdas, pide a un administrador un enlace para restablecerla. |
| Funcionaba y ahora Claude dice que hay que volver a conectar | Has cambiado la contraseña, te han desconectado o lleva más de un mes sin usarse. Pulsa Conectar otra vez. |
| Claude responde pero no sabe nada del tablero | Seguramente usaste la dirección que termina en `/mcp` (solo datos públicos). Quita ese conector y añade el de `/mcp/equipo`. |
| Ves «No reconocido» al conectar | No continúes si no lo has conectado tú. Pulsa No permitir. |
| «Hay demasiadas solicitudes de conexión pendientes» | Entra en la web del radar con tu cuenta en ese mismo navegador y vuelve a pulsar Conectar en Claude. |

Si nada de esto lo arregla, avisa a quien mantiene el radar y dile qué paso falló y qué mensaje viste.
