// Single source of truth for the demo's scene order and on-screen text.
// - "screen" scenes are recorded by capture.mjs (ACTIONS[id]); their length comes from the recording
//   (captures/<id>.json). `captions[i]` is shown from the moment the recording logs `caption i`.
// - "card" scenes are typographic cards rendered by HyperFrames with a fixed `duration`.
// compose.mjs builds composition/index.html from this list. Keep GUION.md in sync.

export const FPS = 30;
export const CUT = 0.12; // seconds of overlap between scenes: a near-hard cut
export const REPO_URL = "github.com/Migueldgq/reforesta-radar";

export const SCENES = [
  { id: "landing", kind: "screen", route: "/landing", captions: [] },
  {
    id: "problema",
    kind: "card",
    duration: 3,
    eyebrow: "El problema",
    title: "4–5 solicitudes al año.",
    subtitle: "Siempre las mismas cuatro fuentes.",
  },
  { id: "fuentes", kind: "screen", route: "/fuentes", captions: ["11 fuentes, una sola lista"] },
  { id: "mapa", kind: "screen", route: "/", captions: ["Todo de un vistazo", "Pulsa Madrid: la tabla responde"] },
  { id: "encaje", kind: "screen", route: "/", captions: ["Hoy, nada abierto que encaje", "Lo que vuelve: próximas ediciones"] },
  {
    id: "ejemplos",
    kind: "screen",
    route: null, // continues on the page left by "encaje"
    captions: ["Ejemplo del reto: cerró en junio", "¿Encaja? 85, y por qué", "A «En estudio»", "El otro ejemplo, justo debajo"],
    lowerThirds: [
      { chip: "Ejemplo del reto", title: "Subvenciones a entidades sin ánimo de lucro · proyectos ambientales 2026", meta: "BDNS 904719 · Comunidad de Madrid" },
      { chip: "Ejemplo del reto", title: "Actividades de interés general · protección del medio ambiente 2026", meta: "BDNS 923290 · MITECO" },
    ],
  },
  { id: "seguimiento", kind: "screen", route: "/seguimiento", captions: ["Seguimiento: arrastra y decide"] },
  { id: "perfil", kind: "screen", route: "/perfil", captions: ["Perfil: ajustad el criterio", "El efecto, al momento"] },
  { id: "empresas", kind: "screen", route: "/empresas", captions: ["Empresas: el canal RSC"] },
  { id: "analizar", kind: "screen", route: "/analizar", captions: ["Unas bases en PDF…", "…una ficha de decisión"] },
  {
    id: "outro",
    kind: "card",
    duration: 3,
    eyebrow: "Reforesta Radar",
    title: "Menos horas leyendo bases, más horas en el monte.",
    subtitle: REPO_URL,
  },
];
