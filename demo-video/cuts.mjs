// Shorter cuts of the film, built from the same takes and recordings (no new voice, no re-capture).
//   CUT=<name> node compose.mjs   → composition/cut-<name>.html, its own mix, out/<output>.es.srt
// `keep`: beat id → the indexes of its voice lines that stay (beats not listed are dropped). In a recorded beat the
// kept lines must be its first ones: the recording is cut where the first dropped line would start (its `say` mark),
// so nothing that belongs to a dropped line is on screen. In the assistant beat, keeping no `phase: 1` line drops the
// chat and leaves the connector card. Every kept line must make sense without the dropped ones.

export const CUTS = {
  // About 2 min for X (no Premium: 2:20 max).
  x: {
    output: "demo-x-2min",
    keep: {
      intro: [0],
      problema: [0, 1],
      promesa: [0, 1],
      inicio: [0], // seven sources, one list
      ganasteis: [0, 1, 2], // the 100 with its reasons, won before
      motivos: [0, 1], // the 45 and its warnings; rules you adjust in the Perfil
      perfil: [0], // «Ahí…» refers to the Perfil named in motivos[1]: keep both or neither
      ia: [0],
      equipo: [0], // marked «en estudio»
      seguimiento: [0, 1], // the shared board
      asistente: [0, 1], // MCP connector card only
      outro: [0],
    },
  },
};
