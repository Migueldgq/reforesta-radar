// Single source of truth for the demo's beat order and on-screen text (launch-video style: white canvas,
// one typed headline per beat, one cropped piece of the real app below it).
// - "screen" beats are recorded by capture.mjs (ACTIONS[id]); their length comes from the recording
//   (captures/<id>.json). `headlines[i]` types in when the recording logs `head i`.
// - "intro" / "statement" / "outro" are typographic beats rendered by HyperFrames with a fixed `duration`.
// - In headline text, *words in asterisks* are set in the brand green.
// - `canvas: "green"` puts a beat on the forest-green canvas (one contrast section) and shows the UI as a card.
// compose.mjs builds composition/index.html from this list. Keep GUION.md in sync.

export const FPS = 30;
export const REPO_URL = "github.com/Migueldgq/reforesta-radar";

export const SCENES = [
  { id: "intro", kind: "intro", duration: 2.2, name: "Reforesta Radar" },
  { id: "statement", kind: "statement", duration: 3.0, lines: ["Cada convocatoria que se escapa", "*es monte que no se planta.*"] },
  { id: "fuentes", kind: "screen", route: "/fuentes", headlines: ["*11 fuentes*, una sola lista"] },
  { id: "inicio", kind: "screen", route: "/", headlines: ["Lo importante, *de un vistazo*"] },
  { id: "semana", kind: "screen", route: "/", headlines: ["Pulsa una *semana*…", "…y la lista *responde*"] },
  { id: "mapa", kind: "screen", route: "/", headlines: ["O pulsa *Madrid*", "Solo lo de *vuestro territorio*"] },
  { id: "encaje", kind: "screen", route: "/?tier=alto&cerradas=1", headlines: ["¿Encaja? *Y por qué*", "Marcadla *en estudio*"] },
  { id: "seguimiento", kind: "screen", route: "/seguimiento", headlines: ["Del radar *al tablero*"] },
  { id: "perfil", kind: "screen", route: "/perfil", headlines: ["El criterio *es vuestro*", "La lista *se reordena*"] },
  { id: "analizar", kind: "screen", route: "/analizar", headlines: ["¿Unas bases en PDF?", "*Una ficha* para decidir"] },
  { id: "empresas", kind: "screen", route: "/empresas", canvas: "green", headlines: ["Y el canal *de empresas*"] },
  {
    id: "outro",
    kind: "outro",
    duration: 4.6,
    name: "Reforesta Radar",
    tagline: "Menos horas leyendo bases, *más horas en el monte.*",
    cta: "Ver el código",
    url: REPO_URL,
  },
];
