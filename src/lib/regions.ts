import { normalizeText } from "./scoring";

/**
 * Comunidad de Madrid municipalities whose names do not contain "madrid" (BDNS search rows give only
 * the town name, e.g. "AYUNTAMIENTO DE GETAFE"). Ambiguous names shared with towns elsewhere are left out.
 */
const MADRID_MUNICIPALITIES = [
  "getafe", "mostoles", "alcala de henares", "fuenlabrada", "leganes", "alcorcon", "torrejon de ardoz", "parla",
  "alcobendas", "san sebastian de los reyes", "pozuelo de alarcon", "rivas-vaciamadrid", "coslada", "valdemoro",
  "majadahonda", "collado villalba", "aranjuez", "arganda del rey", "boadilla del monte", "pinto", "colmenar viejo",
  "tres cantos", "san fernando de henares", "galapagar", "arroyomolinos", "villaviciosa de odon", "navalcarnero",
  "ciempozuelos", "torrelodones", "paracuellos de jarama", "mejorada del campo", "algete", "villanueva de la canada",
  "san martin de la vega", "guadarrama", "alpedrete", "moralzarzal", "collado mediano", "cercedilla", "navacerrada",
  "becerril de la sierra", "boalo", "manzanares el real", "soto del real", "miraflores de la sierra",
  "hoyo de manzanares", "escorial", "valdemorillo", "colmenarejo", "villanueva del pardillo", "rascafria", "lozoya",
  "buitrago del lozoya", "bustarviejo", "guadalix de la sierra", "san agustin del guadalix", "pedrezuela",
  "torrelaguna", "patones", "montejo de la sierra", "la hiruela", "hiruela", "somosierra", "acebeda", "canencia",
  "gargantilla del lozoya", "pinilla del valle", "alameda del valle", "navarredonda y san mames", "puentes viejas",
  "lozoyuela", "cabanillas de la sierra", "valdemanco", "navalafuente", "venturada", "atazar", "san lorenzo de el escorial",
  "santa maria de la alameda", "zarzalejo", "robledo de chavela", "navalagamella", "fresnedillas de la oliva",
  "san martin de valdeiglesias", "pelayos de la presa", "cadalso de los vidrios", "cenicientos", "villa del prado",
  "aldea del fresno", "chapineria", "navas del rey", "colmenar del arroyo", "brunete", "quijorna", "sevilla la nueva",
  "villamanta", "villamantilla", "villanueva de perales", "moraleja de enmedio", "grinon", "cubas de la sagra",
  "torrejon de la calzada", "torrejon de velasco", "casarrubuelos", "serranillos del valle", "batres", "titulcia",
  "chinchon", "colmenar de oreja", "villaconejos", "valdelaguna", "belmonte de tajo", "villarejo de salvanes",
  "fuentiduena de tajo", "estremera", "villamanrique de tajo", "morata de tajuna", "perales de tajuna", "tielmes",
  "carabana", "orusco de tajuna", "ambite", "villar del olmo", "nuevo baztan", "loeches", "campo real",
  "velilla de san antonio", "torres de la alameda", "villalbilla", "santos de la humosa", "meco",
  "camarma de esteruelas", "daganzo de arriba", "ajalvir", "cobena", "fuente el saz de jarama", "valdeolmos-alalpardo",
  "valdetorres de jarama", "talamanca de jarama", "torremocha de jarama", "el vellon", "vellon, el",
];

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

// Checked in order with whole-word matching ("soria" must not match "asesoria").
const KEYWORD_TO_CCAA: { patterns: string[]; ccaa: string }[] = [
  { patterns: ["madrid", ...MADRID_MUNICIPALITIES], ccaa: "Comunidad de Madrid" },
  {
    patterns: ["galicia", "coruna", "lugo", "ourense", "pontevedra", "xunta"],
    ccaa: "Galicia",
  },
  // before Cataluña: "Generalitat Valenciana" must not fall into the generic "generalitat"
  {
    patterns: ["valencia", "valenciana", "alicante", "castellon"],
    ccaa: "Comunitat Valenciana",
  },
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
  { patterns: ["pais vasco", "euskadi", "donostia", "gasteiz", "bilbao", "bizkaia", "gipuzkoa", "araba", "alava"], ccaa: "País Vasco" },
  { patterns: ["asturias"], ccaa: "Asturias" },
  { patterns: ["cantabria"], ccaa: "Cantabria" },
  { patterns: ["navarra"], ccaa: "Navarra" },
  { patterns: ["la rioja", "rioja"], ccaa: "La Rioja" },
  { patterns: ["murcia"], ccaa: "Región de Murcia" },
  { patterns: ["canarias", "tenerife", "gran canaria", "las palmas", "palmas, las", "lanzarote", "fuerteventura"], ccaa: "Canarias" },
  // after Canarias so "Las Palmas" is not taken for Palma (Mallorca)
  { patterns: ["baleares", "balears", "mallorca", "menorca", "ibiza", "eivissa", "palma"], ccaa: "Illes Balears" },
  { patterns: ["ceuta"], ccaa: "Ceuta" },
  { patterns: ["melilla"], ccaa: "Melilla" },
];

const wordRe = new Map<string, RegExp>();
function hasWord(normText: string, word: string): boolean {
  let re = wordRe.get(word);
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`);
    wordRe.set(word, re);
  }
  return re.test(normText);
}

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
    if (entry.patterns.some((p) => hasWord(haystack, p))) {
      return entry.ccaa;
    }
  }

  if (normalizeText(nivelAdmin).includes("estado")) {
    return "Estatal / Nacional";
  }

  return "Estatal / Sin especificar";
}
