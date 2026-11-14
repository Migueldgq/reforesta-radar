import { normalizeText } from "./scoring";

const NUTS_PREFIX_TO_CCAA: Record<string, string> = {
  ES11: "Galicia",
  ES12: "Asturias",
  ES13: "Cantabria",
  ES21: "País Vasco",
  ES22: "Navarra",
  ES23: "La Rioja",
  ES24: "Aragón",
  ES30: "Comunidad de Madrid",
  ES41: "Castilla y León",
  ES42: "Castilla-La Mancha",
  ES43: "Extremadura",
  ES51: "Cataluña",
  ES52: "Comunitat Valenciana",
  ES53: "Illes Balears",
  ES61: "Andalucía",
  ES62: "Región de Murcia",
  ES63: "Ceuta",
  ES64: "Melilla",
  ES70: "Canarias",
};

const KEYWORD_TO_CCAA: { patterns: string[]; ccaa: string }[] = [
  {
    patterns: ["galicia", "coruna", "lugo", "ourense", "pontevedra", "xunta"],
    ccaa: "Galicia",
  },
  { patterns: ["madrid"], ccaa: "Comunidad de Madrid" },
  {
    patterns: [
      "cataluna",
      "catalunya",
      "barcelona",
      "girona",
      "lleida",
      "tarragona",
      "generalitat",
      "propietat forestal",
    ],
    ccaa: "Cataluña",
  },
  {
    patterns: [
      "andalucia",
      "sevilla",
      "malaga",
      "granada",
      "cadiz",
      "cordoba",
      "jaen",
      "almeria",
      "huelva",
    ],
    ccaa: "Andalucía",
  },
  {
    patterns: ["valencia", "alicante", "castellon", "generalitat valenciana"],
    ccaa: "Comunitat Valenciana",
  },
  {
    patterns: [
      "castilla y leon",
      "burgos",
      "leon",
      "salamanca",
      "valladolid",
      "soria",
      "segovia",
      "avila",
      "palencia",
      "zamora",
    ],
    ccaa: "Castilla y León",
  },
  {
    patterns: [
      "castilla-la mancha",
      "toledo",
      "ciudad real",
      "albacete",
      "cuenca",
      "guadalajara",
    ],
    ccaa: "Castilla-La Mancha",
  },
  { patterns: ["aragon", "zaragoza", "huesca", "teruel"], ccaa: "Aragón" },
  { patterns: ["extremadura", "badajoz", "caceres"], ccaa: "Extremadura" },
  { patterns: ["pais vasco", "euskadi", "bizkaia", "gipuzkoa", "araba", "alava"], ccaa: "País Vasco" },
  { patterns: ["asturias"], ccaa: "Asturias" },
  { patterns: ["cantabria"], ccaa: "Cantabria" },
  { patterns: ["navarra"], ccaa: "Navarra" },
  { patterns: ["la rioja", "rioja"], ccaa: "La Rioja" },
  { patterns: ["murcia"], ccaa: "Región de Murcia" },
  { patterns: ["baleares", "balears", "mallorca", "menorca", "ibiza"], ccaa: "Illes Balears" },
  { patterns: ["canarias", "tenerife", "gran canaria", "palma", "lanzarote"], ccaa: "Canarias" },
];

export function inferComunidadAutonoma(
  regiones: string[],
  organismo: string,
  nivelAdmin: string
): string {
  for (const reg of regiones) {
    const match = reg.match(/^(ES\d{2})/i);
    if (match) {
      const code = match[1].toUpperCase();
      if (NUTS_PREFIX_TO_CCAA[code]) return NUTS_PREFIX_TO_CCAA[code];
    }
  }

  const haystack = normalizeText(`${regiones.join(" ")} ${organismo}`);
  for (const entry of KEYWORD_TO_CCAA) {
    if (entry.patterns.some((p) => haystack.includes(p))) {
      return entry.ccaa;
    }
  }

  if (normalizeText(nivelAdmin).includes("estado")) {
    return "Estatal / Nacional";
  }

  return "Estatal / Sin especificar";
}
