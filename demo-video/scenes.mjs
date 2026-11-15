// Single source of truth for the demo's beat order, on-screen text and narration (launch-video style: white canvas,
// one typed headline per beat, one cropped piece of the real app below it, a voice that explains it).
// - "screen" beats are recorded by capture.mjs (ACTIONS[id]); their length comes from the recording
//   (captures/<id>.json) and from the narration. `headlines[i]` types in when the recording logs `head i`.
// - "intro" / "statement" / "assistant" / "outro" are rendered by HyperFrames; their length comes from the narration
//   (never shorter than `duration`). A statement types `lines[i]` when voice line i starts.
// - `voice`: the narration of the beat, one entry per audio file (voice-lines.mjs names them NN-<beat>.wav and
//   GUION-VOZ.md lists them). `text` is what is said and subtitled; `say` (optional) is the respelled text the local
//   voice reads; `notes` (optional) are pronunciation notes for whoever records the line; `seed` (optional) is the
//   ElevenLabs seed for that line when the default one gives a bad take. In "screen" beats the
//   recording logs `say k` where line k starts; the voice drives the timing (compose.mjs holds the picture if a line
//   needs longer).
// - In any on-screen text, *words in asterisks* are set in the brand green, and {fuentes} / {total} / {alto} are
//   replaced with the app's numbers at capture time (captures/facts.json): numbers on screen are never typed by hand.
// - `canvas: "green"` puts a beat on the forest-green canvas (one contrast section, circular wipe in and out).
// - The "assistant" beat first shows the radar connected to an AI agent as an MCP connector (its /mcp server), then a
//   question and the answer built from the radar's real tool output (captures/assistant.json, written by capture.mjs
//   from /mcp), with the tool calls tagged as MCP. Its voice lines with `phase: 1` play over the chat.
// compose.mjs builds composition/index.html from this list. Keep GUION.md in sync (GUION-VOZ.md is generated).

export const FPS = 30;
export const REPO_URL = "github.com/Migueldgq/reforesta-radar";

const MCP = "MCP se lee letra a letra: «eme, ce, pe».";

export const SCENES = [
  {
    id: "intro",
    kind: "intro",
    duration: 2.2,
    name: "Reforesta Radar",
    voice: [{ text: "Esto es Reforesta Radar." }],
  },
  {
    id: "problema",
    kind: "statement",
    duration: 3.2,
    lines: ["Cientos de convocatorias, *decenas de webs*", "*y un equipo de siete.*"],
    voice: [
      { text: "Cada año salen cientos de ayudas y programas que podrían financiar vuestros proyectos." },
      { text: "Pero están repartidos por muchas webs distintas, y revisarlos a mano lleva horas a un equipo pequeño." },
    ],
  },
  {
    id: "promesa",
    kind: "statement",
    duration: 3.2,
    lines: ["El radar busca y ordena,", "*vosotros decidís.*"],
    voice: [
      { text: "Reforesta Radar los busca por vosotros, los ordena y os explica por qué." },
      { text: "No escribe las solicitudes: os ayuda a decidir dónde poner el tiempo." },
    ],
  },
  {
    id: "inicio",
    kind: "screen",
    route: "/",
    headlines: ["Siete fuentes, *una sola lista*", "Por plazo, *tema o territorio*", "Si hoy no hay nada bueno, *lo dice*"],
    voice: [
      { text: "Cada mañana, a las nueve, el radar lee siete fuentes públicas y privadas, y lo junta todo en una sola lista." },
      { text: "Podéis mirarla por plazo, por línea de trabajo o por territorio." },
      { text: "Y si hoy no hay nada abierto que encaje bien, os lo dice, y os enseña lo que se repite cada año, para prepararlo con tiempo." },
    ],
  },
  {
    id: "ganasteis",
    kind: "screen",
    route: "/",
    headlines: ["Arriba, *la que ya ganasteis*", "Una nota, *con sus motivos*", "Cuándo abre y *quién la gana*"],
    voice: [
      { text: "Arriba del todo, una que ya conocéis: la de proyectos ambientales de la Comunidad de Madrid." },
      { text: "Cada una lleva una nota de cero a cien. Esta tiene cien, con sus motivos." },
      {
        text: "Y lee las ediciones anteriores: Reforesta la ganó en 2025, 2024 y 2022.",
        say: "Y lee las ediciones anteriores: Reforesta la ganó en dos mil veinticinco, dos mil veinticuatro y dos mil veintidós.",
        notes: "Años en palabras: «dos mil veinticinco, dos mil veinticuatro y dos mil veintidós».",
      },
      { text: "Suele abrir entre abril y septiembre, y en los dos últimos años todas las ayudas fueron a entidades sin ánimo de lucro." },
    ],
  },
  {
    id: "motivos",
    kind: "screen",
    route: "/?c=bdns:930968",
    headlines: ["Y sus avisos: *aquí ganan empresas*", "Reglas a la vista, *no una caja negra*"],
    voice: [
      { text: "La nota también avisa. Esta, de Madrid y forestal, parece buena, pero ninguna de las ayudas anteriores fue a una entidad sin ánimo de lucro." },
      {
        text: "Y se queda en un 45. La nota sale de reglas a la vista. Una inteligencia artificial solo ayuda a descartar lo que no tiene que ver.",
        say: "Y se queda en un cuarenta y cinco. La nota sale de reglas a la vista. Una inteligencia artificial solo ayuda a descartar lo que no tiene que ver.",
        notes: "«45» se lee «cuarenta y cinco».",
      },
    ],
  },
  {
    id: "empresas",
    kind: "screen",
    route: "/empresas",
    headlines: ["Fundaciones, *comprobadas a mano*", "Y también *lo que las limita*"],
    voice: [
      { text: "Los programas de empresas y fundaciones no salen en ningún boletín: están comprobados a mano." },
      { text: "Cada uno dice su plazo y qué lo limita: este de Fundación Unicaja solo vale en Andalucía o en Ciudad Real." },
      { text: "Como no se actualizan solos, conviene revisarlos." },
    ],
  },
  {
    id: "analizar",
    kind: "screen",
    route: "/analizar",
    headlines: ["¿Tenéis las bases? *Subid el PDF*", "Misma nota, *mismos motivos*"],
    voice: [
      {
        text: "¿Os llegan las bases de una convocatoria en PDF? Subidlas en Analizar PDF.",
        say: "¿Os llegan las bases de una convocatoria en pe de efe? Subidlas en Analizar pe de efe.",
        notes: "PDF se lee «pe, de, efe».",
      },
      {
        text: "Si la convocatoria ya está en el radar, el PDF lleva la misma nota que en la lista, con los mismos motivos y avisos.",
        say: "Si la convocatoria ya está en el radar, el pe de efe lleva la misma nota que en la lista, con los mismos motivos y avisos.",
        notes: "PDF se lee «pe, de, efe».",
      },
    ],
  },
  {
    id: "equipo",
    kind: "screen",
    route: "/?c=bdns:926034",
    headlines: ["Marcadla *en estudio*", "¿Os sirve? *Votadlo*", "Asignadla y *dejad una nota*"],
    voice: [
      { text: "Cuando una os interesa, se decide en equipo. Primero, la marcáis en estudio." },
      { text: "Cada persona vota si os sirve. Los votos muestran dónde la nota y el equipo no están de acuerdo." },
      { text: "Después, elegís quién se encarga y dejáis una nota, que verá todo el equipo." },
    ],
  },
  {
    id: "seguimiento",
    kind: "screen",
    route: "/seguimiento",
    headlines: ["Todo el equipo, *un solo tablero*"],
    voice: [
      { text: "Todo acaba en un tablero compartido: en estudio, a presentar, presentada y descartada." },
      { text: "Para cambiar una de columna, basta con arrastrarla." },
    ],
  },
  {
    id: "invitar",
    kind: "screen",
    route: "/equipo",
    headlines: ["Invitad al equipo *con un enlace*", "Cada persona, *con su rol*"],
    voice: [
      { text: "Al radar se entra por invitación: escribís el correo, y el radar crea un enlace que enviáis vosotros." },
      { text: "El enlace sirve una sola vez y caduca en siete días." },
      { text: "Hay dos roles: administración, que gestiona el equipo, y equipo, que usa y edita el tablero." },
    ],
  },
  {
    id: "fuentes",
    kind: "screen",
    route: "/fuentes",
    headlines: ["De dónde sale todo, *a la vista*", "¿No queréis esperar? *Actualizad ahora*"],
    voice: [
      {
        text: "En Fuentes veis de dónde sale cada dato: la Base de Datos Nacional de Subvenciones, el BOE, los fondos europeos y cuatro fuentes más.",
        say: "En Fuentes veis de dónde sale cada dato: la Base de Datos Nacional de Subvenciones, el Boe, los fondos europeos y cuatro fuentes más.",
        notes: "BOE se lee como palabra: «boe».",
      },
      { text: "De cada una, cuántos resultados dio y si la última carga fue bien." },
      { text: "Y si no queréis esperar a mañana, alguien de administración puede pedir una actualización en el momento." },
    ],
  },
  {
    id: "asistente",
    kind: "assistant",
    canvas: "green",
    duration: 10.2,
    // headlines[0] types over the connector card, headlines[1] over the chat
    headlines: ["Conectadlo por MCP *a cualquier agente de IA*", "Pregúntaselo a *vuestro agente de IA*"],
    voice: [
      {
        text: "Y si usáis un agente de inteligencia artificial, podéis conectarle el radar por MCP, un estándar abierto que vale para cualquiera.",
        say: "Y si usáis un agente de inteligencia artificial, podéis conectarle el radar por eme ce pe, un estándar abierto que vale para cualquiera.",
        notes: MCP,
        seed: 11, // ElevenLabs: with the default seed, Whisper hears «ene ce pe»
      },
      { text: "Es de solo lectura: puede buscar y leer, pero no cambia nada." },
      { phase: 1, text: "Le preguntáis con vuestras palabras; él busca en el radar y os responde con los mismos datos que veis en la aplicación." },
    ],
    // The radar's own MCP server (/mcp), connected to an unbranded AI agent. `host` is the live radar's public address.
    // `standard`: MCP is an open standard, so the honest claim is "any agent that supports MCP".
    connector: {
      label: "Conector MCP",
      name: "Reforesta Radar",
      host: "reforesta-radar.miguelddev.com",
      path: "/mcp",
      note: "Solo lectura",
      state: "Conectado",
      standard: "Estándar abierto: vale cualquier agente de IA compatible con MCP",
    },
    toolsTag: "MCP · Reforesta Radar",
  },
  {
    id: "outro",
    kind: "outro",
    duration: 4.6,
    name: "Reforesta Radar",
    tagline: "Menos horas buscando, *más horas en el monte.*",
    cta: "Ver el código",
    url: REPO_URL,
    voice: [{ text: "Reforesta Radar. Menos horas buscando, y más horas en el monte." }],
  },
];
