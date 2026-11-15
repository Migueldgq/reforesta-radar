// Single source of truth for the demo's beat order and on-screen text (launch-video style: white canvas,
// one typed headline per beat, one cropped piece of the real app below it).
// - "screen" beats are recorded by capture.mjs (ACTIONS[id]); their length comes from the recording
//   (captures/<id>.json). `headlines[i]` types in when the recording logs `head i`.
// - "intro" / "statement" / "assistant" / "outro" are rendered by HyperFrames with a fixed `duration`.
// - In any text, *words in asterisks* are set in the brand green, and {fuentes} / {total} / {alto} are replaced with
//   the app's numbers at capture time (captures/facts.json): numbers on screen are never typed by hand.
// - `canvas: "green"` puts a beat on the forest-green canvas (one contrast section, circular wipe in and out).
// - The "assistant" beat shows a question and the answer built from the radar's real tool output
//   (captures/assistant.json, written by capture.mjs from /mcp).
// compose.mjs builds composition/index.html from this list. Keep GUION.md in sync.

export const FPS = 30;
export const REPO_URL = "github.com/Migueldgq/reforesta-radar";

export const SCENES = [
  { id: "intro", kind: "intro", duration: 2.2, name: "Reforesta Radar" },
  { id: "statement", kind: "statement", duration: 3.2, lines: ["{fuentes} fuentes, {total} convocatorias", "*y un equipo de siete.*"] },
  { id: "inicio", kind: "screen", route: "/", headlines: ["Las lee *cada mañana*", "Si hoy no hay nada bueno, *lo dice*"] },
  { id: "ganasteis", kind: "screen", route: "/", headlines: ["Arriba, *la que ya ganasteis*", "Cuándo abre y *quién la gana*"] },
  { id: "motivos", kind: "screen", route: "/?c=bdns:930968", headlines: ["Cada nota, *con sus motivos*", "Y sus avisos: *aquí ganan empresas*"] },
  { id: "empresas", kind: "screen", route: "/empresas", headlines: ["Fundaciones, *comprobadas a mano*", "Y también *lo que las limita*"] },
  { id: "equipo", kind: "screen", route: "/?c=bdns:926034", headlines: ["Marcadla *en estudio*", "¿Os sirve? *Votadlo*", "Asignadla y *dejad una nota*"] },
  { id: "seguimiento", kind: "screen", route: "/seguimiento", headlines: ["Todo el equipo, *un solo tablero*"] },
  {
    id: "asistente",
    kind: "assistant",
    canvas: "green",
    duration: 8.0,
    headline: "Pregúntaselo a *vuestro asistente*",
    sources: "Consultó el radar: búsqueda y ficha",
  },
  {
    id: "outro",
    kind: "outro",
    duration: 4.6,
    name: "Reforesta Radar",
    tagline: "Menos horas buscando, *más horas en el monte.*",
    cta: "Ver el código",
    url: REPO_URL,
  },
];
