# 0035. Iniciar sesión desde el agente de IA (OAuth 2.1) en una segunda dirección, `/mcp/equipo`

- Estado: Aceptada
- Fecha: 2026-11-15 (rama `feat/mcp-oauth`)

## Contexto
0026 dejó el servidor MCP con dos niveles: público sin credenciales en `/mcp` y equipo con un token personal (0027)
pegado en un comando o en una cabecera. Para una persona no técnica de la ONG eso no sirve. El responsable del
proyecto pidió «conectar el radar a mi Claude y ya»: pegar la dirección en «Añadir conector», que se abra el radar,
entrar con la cuenta de siempre, aprobar y listo. Eso es el flujo de autorización de MCP (revisión 2026-07-28 de la
especificación, la que usa el SDK `mcp` 2.3.0): OAuth 2.1 con PKCE, metadatos del recurso (RFC 9728) señalados desde
`WWW-Authenticate`, metadatos del servidor de autorización (RFC 8414), indicadores de recurso (RFC 8707) y registro
de clientes. Los clientes (Claude Code, claude.ai, Claude Desktop) solo empiezan a iniciar sesión cuando reciben un
**401**: una respuesta 200 o un error de herramienta no lo dispara. Y hoy `/mcp` sin credenciales responde 200 con
las herramientas públicas.

## Decisión
Sigue en pie todo lo de 0026 (dónde vive, transporte, las seis herramientas de solo lectura, el nivel público y sus
protecciones) salvo «OAuth, fuera». 0027 (tokens personales) no cambia.

- **Dos direcciones.** `/mcp` sigue igual (público sin credenciales, equipo con token personal). Nueva
  `<RADAR_MCP_URL>/equipo` (`/mcp/equipo`): nunca responde sin credenciales; sin ellas, 401 con
  `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp/equipo", scope="radar:leer"`.
  Acepta un token de acceso emitido para esa dirección o un token personal. Así el conector «del equipo» pide iniciar
  sesión al conectarlo, en cualquier cliente, y la dirección pública nunca lo pide.
- **El radar es su propio servidor de autorización** (una sola organización, cuentas y sesiones propias, 0016), sin
  proveedor de identidad externo ni dependencias nuevas. Se usan las piezas del SDK: la interfaz
  `OAuthAuthorizationServerProvider` (implementada en `app/oauth/provider.py`, con la base de datos) y sus
  manejadores de `/authorize`, `/token` y `/register`, que ya validan PKCE S256, la URI de vuelta y los tipos de
  concesión. Se escribe a mano solo lo que el SDK deja al servidor o hace distinto de lo que queremos: las URL salen de
  `RADAR_PUBLIC_URL` / `RADAR_MCP_URL` (nunca del `Host`), los límites (solo frenan fallos), la página de error de
  `/oauth/authorize`, la cookie que ata la solicitud al
  navegador, la comprobación de `resource` en `/oauth/token`, la comparación del secreto de cliente contra su hash,
  `/oauth/revoke` (el del SDK exige `client_secret` también a clientes públicos) y la página de permiso.
- **Rutas:** `/.well-known/oauth-protected-resource/mcp/equipo` (y la raíz), `/.well-known/oauth-authorization-server`
  (emisor = `RADAR_PUBLIC_URL` sin ruta), `/oauth/authorize|token|register|revoke`; la web las reenvía a la API como
  `/mcp`. Un solo permiso, `radar:leer` (solo lectura; no hay herramientas de escritura). Se anuncia
  `authorization_response_iss_parameter_supported` y se envía `iss` (RFC 9207).
- **Flujo:** `/oauth/authorize` guarda la solicitud (10 min, id aleatorio guardado como hash), pone la cookie
  `radar_oauth` (HttpOnly, SameSite=Lax, ruta `/api/oauth/`) y manda el navegador a la página `/autorizar` de la web,
  detrás del login normal (`?next=` conserva la solicitud). La página dice, en castellano llano, «<agente> quiere
  leer el radar de Reforesta con tu cuenta…», con el nombre que se dio el agente, a qué dirección se envía el
  permiso y un aviso claro si no lo reconocemos; «Permitir» / «No permitir» son `POST /api/oauth/consent/decision` con
  sesión, regla CSRF de 0016 y la cookie del navegador que empezó. La página no se deja enmarcar
  (`frame-ancestors 'none'`, `X-Frame-Options: DENY`). Sea cual sea el cliente, avisa: continúa solo si tú mismo
  acabas de pulsar «Conectar» en tu propio agente; si alguien te ha enviado el enlace, «No permitir».
- **Errores antes de decidir** (cliente o URI de vuelta desconocidos, falta PKCE, `resource` ajeno…): una página de
  error en el radar, nunca una redirección a la URI de vuelta del cliente (RFC 9700 §4.11.2: quien registra el cliente
  elige esa URI, y redirigir convertiría `/oauth/authorize` en un redirector abierto). Solo se redirige con error si
  la URI es loopback (un programa de su propio ordenador) o, tras «No permitir», si es la de Claude o loopback. «No
  permitir» en un cliente **No reconocido** deja a la persona en el radar («No permitido»), sin visitar su sitio.
- **Reconocido** = la URI de vuelta es la de Claude (`https://claude.ai/api/mcp/auth_callback`, también en claude.com):
  el permiso solo puede llegar a Claude, pero no dice a la cuenta de Claude de quién (por eso el aviso de arriba va
  en todas). **En tu ordenador** = loopback (Claude Code). Cualquier otra, **No reconocido**, con aviso.
- **Secretos opacos y solo su sha256 en la base** (como sesiones y tokens personales; no hacen falta JWT firmados
  porque el mismo proceso emite y comprueba): código de un solo uso de 60 s atado a cliente, URI de vuelta, reto PKCE,
  persona y recurso (reusarlo revoca lo que produjo); token de acceso de 1 hora con audiencia = la dirección del
  equipo, comprobada en cada llamada; token de refresco rotado en cada uso, y presentar uno ya rotado revoca toda la
  concesión. Un reintento o un duplicado en paralelo en los 10 s siguientes al primer uso (código o refresco) se
  rechaza con `invalid_grant` sin revocar nada: así un cliente que reintenta no pierde los tokens que acaba de
  recibir, y nunca hay dos pares válidos (el cambio de estado es atómico). La concesión caduca a los 30 días sin uso.
- **Registro dinámico (RFC 7591)**, sin autenticar como manda el estándar y sin límite global (ver «Límites»): como
  mucho 5000 clientes guardados; con la tabla llena, el registro más antiguo sin usar (nunca aprobado y sin solicitud
  pendiente) deja sitio. Los que nadie autoriza se borran a las 24 h y los inactivos sin concesión viva a los 90
  días, nunca uno con una solicitud pendiente (su persona puede estar entrando). URI de vuelta solo `https://` o
  `http://` en loopback (cualquier puerto en loopback, RFC 8252 §7.3), sin fragmento ni credenciales, como mucho 5 de
  512 caracteres; el nombre se limpia (NFC, sin caracteres de control ni de dirección, los que se ven en blanco como
  espacios, como mucho una marca combinante por letra, 60 caracteres) y la página lo recorta a dos líneas. No se
  ofrecen los documentos de metadatos de cliente (CIMD): claude.ai vuelve al registro dinámico si el servidor no los
  anuncia.
- **Límites: nunca se rechaza una petición que saldría bien.** Detrás del proxy de la web (la reescritura de Next)
  todas las peticiones llegan con la misma IP, así que un límite por IP es un límite para todo el equipo y lo agota
  cualquiera. Por eso:
  - `/oauth/token` y `/oauth/revoke` procesan primero y solo cuentan los fallos (60 por minuto y por IP); pasado el
    límite, los fallos reciben 429, salvo `invalid_grant` (el cliente lo necesita para volver a conectar). Una
    petición correcta pasa siempre.
  - `/oauth/authorize`: las solicitudes válidas no tienen límite de ritmo; los errores cuentan (30 cada 10 minutos por
    IP) y después reciben 429. Lo que se acota es la tabla de solicitudes pendientes: las anónimas (sin sesión del
    radar en ese navegador) como mucho 10 por cliente y 1000 en total; las de una persona con sesión no cuentan ahí
    (tienen su propio tope de 20). Se rechaza la más nueva, nunca se echa una que ya espera, y al abrir la página de
    permiso con sesión la solicitud pasa a ser de esa persona. Si las anónimas están llenas, la página pide entrar en
    el radar y volver a pulsar «Conectar». Las caducadas se borran como mucho una vez por minuto, por índice.
  - `/mcp/equipo` responde siempre 401 con `WWW-Authenticate` a un token desconocido o caducado, nunca 429: el cliente
    necesita ese 401 para refrescar. Los tokens son aleatorios de 256 bits: no hay nada que adivinar.
  - `/oauth/register`: sin presupuesto global (uno compartido lo puede mantener gastado cualquiera, para siempre).
    La tabla la acota el tope de 5000: un registro nuevo siempre cabe echando al más antiguo sin usar, y como las
    solicitudes anónimas están topadas en 1000, casi toda la tabla se puede echar. Un agente aprobado alguna vez,
    o con una solicitud pendiente, no se echa.
  - Con un proxy de confianza que da la IP real (`FORWARDED_ALLOW_IPS` distinto de `127.0.0.1`), además 10 registros
    por IP cada 10 minutos.
- **Revocación:** «Desconectar» en Mi cuenta, `/oauth/revoke`, y todas las concesiones de una persona con
  `revoke_sessions` (cambio o restablecimiento de contraseña, cambio de rol, desactivación); una cuenta desactivada no
  pasa ninguna comprobación.
- **Solo con https:** si `RADAR_COOKIE_SECURE` está activo y `RADAR_PUBLIC_URL` no es https, o con
  `RADAR_MCP_OAUTH=false`, no hay metadatos ni rutas OAuth (404) y `/mcp/equipo` solo acepta tokens personales.
  Con `http://localhost` funciona para uso local (Claude Code en el mismo ordenador).

## Consecuencias
- Una persona no técnica conecta el radar pegando una dirección y pulsando «Permitir». Los tokens personales quedan
  como opción técnica y siguen igual.
- Hay que explicar dos direcciones: la pública (`/mcp`, sin iniciar sesión) y la del equipo (`/mcp/equipo`).
- claude.ai y Claude Desktop se conectan desde la infraestructura de Anthropic: solo funcionan con el radar publicado
  en internet con https. En un portátil, solo Claude Code en ese mismo ordenador.
- El registro dinámico es una puerta sin autenticar: cualquiera puede registrar un cliente con el nombre que quiera.
  Lo que protege es la página de permiso (nombre, dirección de vuelta, aviso). Una persona engañada para pulsar
  «Permitir» en una solicitud ajena daría lectura del tablero a un tercero: la cookie de navegador obliga a que la
  solicitud empiece en su propio navegador, pero no impide que se le envíe el enlace de `/oauth/authorize`.
- Límites conocidos, aceptados:
  - La detección de reutilización tiene 10 s de gracia. Un ladrón que gane la carrera con un código o un refresco
    robado (lo use antes que el cliente legítimo, o en esos 10 s) se queda con un par de tokens válido hasta que la
    persona vuelva a conectar ese agente o lo desconecte en Mi cuenta: el cliente legítimo solo recibe
    `invalid_grant`. Pasado el margen, presentar uno usado sí revoca la concesión.
  - El límite de fallos de `/oauth/token` no frena adivinar: no hace falta, todos los secretos (códigos, tokens,
    secretos de cliente) son aleatorios de 256 bits.
  - Registro: un registro nuevo puede ser echado antes de su primera solicitud si alguien registra más de 5000
    clientes en esos segundos (unas mil peticiones por segundo sostenidas, un ataque de volumen que tumbaría
    igualmente el servicio). Con la sesión del radar abierta, una solicitud nunca se rechaza por basura anónima;
    sin ella, una inundación de solicitudes anónimas obliga a entrar en el radar primero.
  - Los límites por IP solo frenan fallos: un flujo de basura desde la misma IP que el equipo no le cierra el paso.
- Más superficie que revisar antes de publicar (lista en docs/backend.md y docs/mcp.md).

## Alternativas consideradas
- Autenticación «perezosa» en `/mcp` (401 solo al llamar a una herramienta de equipo, como recomienda la
  documentación de conectores de Claude): Claude Code no abre el navegador en ese caso (pide ejecutar `/mcp`) y el
  comportamiento de cada cliente varía; dos direcciones son predecibles en todos.
- `/mcp` siempre con 401: rompe el acceso público de 0026.
- Proveedor de identidad externo: otra cuenta y otro servicio para un equipo de 7 personas que ya tiene cuentas.
- JWT firmados como tokens de acceso: claves que custodiar y revocación más difícil, sin ganancia con un solo proceso.
- CIMD: obliga al servidor a descargar URL arbitrarias (superficie SSRF) y el registro dinámico ya cubre los clientes.
