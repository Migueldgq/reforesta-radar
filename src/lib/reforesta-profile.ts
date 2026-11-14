import type { WorkLine } from "./types";

export const WORK_LINE_LABELS: Record<WorkLine, string> = {
  restauracion: "Restauración de ecosistemas",
  conservacion: "Conservación de hábitats",
  educacion: "Educación ambiental",
  agroambiental: "Agroambiental y custodia",
};

export const REFORESTA_PROFILE = {
  name: "Asociación Reforesta",
  yearsActive: 30,
  teamSize: "6-7 personas",
  legalForm: "ONG / Entidad sin ánimo de lucro (ESAL)",
  coreMission:
    "Restauración de ecosistemas forestales, conservación de hábitats y educación ambiental mediante acuerdos de custodia del territorio con ayuntamientos, parques regionales y propietarios privados.",
  manualSources: [
    {
      label: "MITECO",
      patterns: [
        "transicion ecologica",
        "miteco",
        "reto demografico",
      ],
    },
    {
      label: "Fundación Biodiversidad",
      patterns: ["fundacion biodiversidad", "biodiversidad"],
    },
    {
      label: "Comunidad de Madrid (ambiental)",
      patterns: ["comunidad de madrid", "madrid"],
    },
    {
      label: "Agenda 2030",
      patterns: ["agenda 2030", "derechos sociales y agenda 2030"],
    },
  ],
};

export const KEYWORD_RULES: {
  line: WorkLine;
  keywords: { term: string; weight: number; label: string }[];
}[] = [
  {
    line: "restauracion",
    keywords: [
      { term: "reforest", weight: 22, label: "Reforestación" },
      { term: "restauracion", weight: 18, label: "Restauración ecológica" },
      { term: "plantacion", weight: 16, label: "Plantación de especies" },
      { term: "forestal", weight: 14, label: "Ámbito forestal" },
      { term: "incendio", weight: 15, label: "Recuperación post-incendio" },
      { term: "bosque", weight: 12, label: "Masas forestales" },
      { term: "ribera", weight: 14, label: "Restauración de riberas" },
      { term: "charca", weight: 18, label: "Charcas y humedales" },
      { term: "humedal", weight: 15, label: "Humedales" },
      { term: "arbolado", weight: 14, label: "Arbolado" },
      { term: "sumidero", weight: 12, label: "Sumideros de carbono" },
    ],
  },
  {
    line: "conservacion",
    keywords: [
      { term: "biodiversidad", weight: 18, label: "Biodiversidad" },
      { term: "habitat", weight: 16, label: "Mejora de hábitats" },
      { term: "conservacion", weight: 14, label: "Conservación" },
      { term: "anfibio", weight: 18, label: "Anfibios" },
      { term: "triton", weight: 18, label: "Tritones / fauna" },
      { term: "especies invasoras", weight: 18, label: "Control de invasoras" },
      { term: "exoticas invasoras", weight: 18, label: "Control de invasoras" },
      { term: "ailanto", weight: 20, label: "Control de ailanto" },
      { term: "aves", weight: 12, label: "Hábitat de aves" },
      { term: "fauna", weight: 10, label: "Fauna silvestre" },
      { term: "ecosistema", weight: 14, label: "Ecosistemas" },
      { term: "medio ambiente", weight: 10, label: "Medio ambiente" },
      { term: "natural", weight: 6, label: "Medio natural" },
    ],
  },
  {
    line: "educacion",
    keywords: [
      { term: "educacion ambiental", weight: 20, label: "Educación ambiental" },
      { term: "sensibilizacion", weight: 12, label: "Sensibilización" },
      { term: "voluntariado ambiental", weight: 16, label: "Voluntariado ambiental" },
      { term: "voluntariado", weight: 10, label: "Voluntariado" },
      { term: "divulgacion", weight: 8, label: "Divulgación" },
    ],
  },
  {
    line: "agroambiental",
    keywords: [
      { term: "custodia del territorio", weight: 22, label: "Custodia del territorio" },
      { term: "agroambiental", weight: 18, label: "Agroambiental" },
      { term: "agricultor", weight: 12, label: "Trabajo con agricultores" },
      { term: "desarrollo rural", weight: 10, label: "Desarrollo rural" },
      { term: "suelo", weight: 8, label: "Protección de suelos" },
    ],
  },
];

export const ONG_POSITIVE_TERMS = [
  "sin animo de lucro",
  "sin fines de lucro",
  "ong",
  "entidades no lucrativas",
  "asociaciones",
  "fundaciones",
  "tercer sector",
  "personas juridicas que no desarrollan actividad economica",
  "entidades de custodia",
];

export const DEALBREAKER_TERMS: { term: string; warning: string; penalty: number }[] = [
  {
    term: "nominativa",
    warning: "Subvención nominativa/directa (asignada a un beneficiario concreto).",
    penalty: 45,
  },
  {
    term: "concesion directa",
    warning: "Concesión directa (no es concurrencia competitiva abierta).",
    penalty: 40,
  },
  {
    term: "protectora de animales",
    warning: "Orientada a protectoras de animales domésticos/acogida, no restauración forestal.",
    penalty: 35,
  },
  {
    term: "caza",
    warning: "Relacionada con actividad cinegética.",
    penalty: 25,
  },
  {
    term: "pesca",
    warning: "Orientada al sector pesquero.",
    penalty: 20,
  },
  {
    term: "pyme",
    warning: "Menciona PYMEs/empresas; verificar si admite entidades sin ánimo de lucro.",
    penalty: 12,
  },
  {
    term: "autonomos",
    warning: "Menciona autónomos; comprobar si excluye asociaciones.",
    penalty: 12,
  },
  {
    term: "procesional",
    warning: "Patrimonio cultural/religioso, no restauración ecológica.",
    penalty: 55,
  },
  {
    term: "patrimonio historico",
    warning: "Patrimonio histórico/artístico, ajeno a restauración forestal.",
    penalty: 45,
  },
  {
    term: "bienes culturales",
    warning: "Bienes culturales/artísticos, ajeno a restauración ecológica.",
    penalty: 45,
  },
  {
    term: "retablo",
    warning: "Restauración artística, no ambiental.",
    penalty: 55,
  },
  {
    term: "cofradia",
    warning: "Entidad religiosa/cultural, ajena al ámbito ambiental.",
    penalty: 50,
  },
];
