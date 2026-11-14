// Single source of truth for the demo's scene order, timing and on-screen captions.
// capture.mjs records the scenes with `route`; compose.mjs builds composition/index.html from this list.
// Keep it in sync with GUION.md (same ids, durations and captions).

export const FPS = 30;
export const CROSSFADE = 0.5; // seconds each scene overlaps the previous one

export const REPO_URL = "github.com/Migueldgq/reforesta-radar";

/** kind: "card" = typographic card made in HyperFrames; "screen" = captured from the app. */
export const SCENES = [
  {
    id: "intro",
    kind: "card",
    duration: 4,
    eyebrow: "1hack A Coruña · Reto Reforesta",
    title: "Reforesta Radar",
    subtitle: "Encontrar y priorizar convocatorias, sin leerse cada base.",
  },
  {
    id: "problema",
    kind: "card",
    duration: 6,
    eyebrow: "El problema",
    title: "4–5 solicitudes al año.",
    subtitle: "Siempre las mismas cuatro fuentes. Decenas de páginas por convocatoria.",
  },
  { id: "fuentes", kind: "screen", route: "/fuentes", duration: 7, caption: "Once fuentes públicas y privadas, en una sola lista" },
  { id: "inicio", kind: "screen", route: "/", duration: 10, caption: "Gráficos que filtran la tabla al pulsarlos" },
  { id: "encaja", kind: "screen", route: "/", duration: 10, caption: "¿Encaja? Nota de 0 a 100, con sus motivos y sus avisos" },
  { id: "ejemplos", kind: "screen", route: "/?cerradas=1", duration: 16, caption: "Las dos convocatorias del reto, encontradas: «prepara la siguiente edición»" },
  { id: "fuera", kind: "screen", route: "/", duration: 7, caption: "«Fuera de tus 4 fuentes»: lo que hoy no estáis viendo" },
  { id: "seguimiento", kind: "screen", route: "/seguimiento", duration: 8, caption: "Seguimiento: de «En estudio» a «A presentar», arrastrando" },
  { id: "empresas", kind: "screen", route: "/empresas", duration: 7, caption: "Empresas: programas de RSC con motivo de encaje y ángulo de contacto" },
  { id: "analizar", kind: "screen", route: "/analizar", duration: 9, caption: "Analizar PDF: unas bases convertidas en una ficha de decisión" },
  {
    id: "outro",
    kind: "card",
    duration: 6,
    eyebrow: "Reforesta Radar",
    title: "Menos horas leyendo bases, más horas en el monte.",
    subtitle: REPO_URL,
  },
];

export const totalDuration = () => SCENES.reduce((t, s) => t + s.duration, 0) - CROSSFADE * (SCENES.length - 1);
