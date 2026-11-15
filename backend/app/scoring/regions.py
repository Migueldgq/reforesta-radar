"""Autonomous community from NUTS codes / organism names (port of src/lib/regions.ts)."""

import re

from app.scoring.text import has_word, normalize_text

# Comunidad de Madrid municipalities whose names do not contain "madrid" (BDNS search rows give only the
# town name, e.g. "AYUNTAMIENTO DE GETAFE"). Ambiguous names shared with towns elsewhere are left out.
MADRID_MUNICIPALITIES = (
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
    "lozoyuela", "cabanillas de la sierra", "valdemanco", "navalafuente", "venturada", "atazar",
    "san lorenzo de el escorial", "santa maria de la alameda", "zarzalejo", "robledo de chavela", "navalagamella",
    "fresnedillas de la oliva", "san martin de valdeiglesias", "pelayos de la presa", "cadalso de los vidrios",
    "cenicientos", "villa del prado", "aldea del fresno", "chapineria", "navas del rey", "colmenar del arroyo",
    "brunete", "quijorna", "sevilla la nueva", "villamanta", "villamantilla", "villanueva de perales",
    "moraleja de enmedio", "grinon", "cubas de la sagra", "torrejon de la calzada", "torrejon de velasco",
    "casarrubuelos", "serranillos del valle", "batres", "titulcia", "chinchon", "colmenar de oreja", "villaconejos",
    "valdelaguna", "belmonte de tajo", "villarejo de salvanes", "fuentiduena de tajo", "estremera",
    "villamanrique de tajo", "morata de tajuna", "perales de tajuna", "tielmes", "carabana", "orusco de tajuna",
    "ambite", "villar del olmo", "nuevo baztan", "loeches", "campo real", "velilla de san antonio",
    "torres de la alameda", "villalbilla", "santos de la humosa", "meco", "camarma de esteruelas", "daganzo de arriba",
    "ajalvir", "cobena", "fuente el saz de jarama", "valdeolmos-alalpardo", "valdetorres de jarama",
    "talamanca de jarama", "torremocha de jarama", "el vellon", "vellon, el",
)  # fmt: skip

NUTS_PREFIX_TO_CCAA = {
    "ES11": "Galicia",
    "ES12": "Asturias",
    "ES13": "Cantabria",
    "ES21": "País Vasco",
    "ES22": "Navarra",
    "ES23": "La Rioja",
    "ES24": "Aragón",
    "ES30": "Comunidad de Madrid",
    "ES41": "Castilla y León",
    "ES42": "Castilla-La Mancha",
    "ES43": "Extremadura",
    "ES51": "Cataluña",
    "ES52": "Comunitat Valenciana",
    "ES53": "Illes Balears",
    "ES61": "Andalucía",
    "ES62": "Región de Murcia",
    "ES63": "Ceuta",
    "ES64": "Melilla",
    "ES70": "Canarias",
}

# Checked in order with whole-word matching ("soria" must not match "asesoria").
KEYWORD_TO_CCAA: tuple[tuple[tuple[str, ...], str], ...] = (
    (("madrid", *MADRID_MUNICIPALITIES), "Comunidad de Madrid"),
    (("galicia", "coruna", "lugo", "ourense", "pontevedra", "xunta"), "Galicia"),
    # before Cataluña: "Generalitat Valenciana" must not fall into the generic "generalitat"
    (("valencia", "valenciana", "alicante", "castellon"), "Comunitat Valenciana"),
    (
        ("cataluna", "catalunya", "barcelona", "girona", "lleida", "tarragona", "generalitat", "propietat forestal"),
        "Cataluña",
    ),
    (("andalucia", "sevilla", "malaga", "granada", "cadiz", "cordoba", "jaen", "almeria", "huelva"), "Andalucía"),
    (
        (
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
        ),
        "Castilla y León",
    ),
    (("castilla-la mancha", "toledo", "ciudad real", "albacete", "cuenca", "guadalajara"), "Castilla-La Mancha"),
    (("aragon", "zaragoza", "huesca", "teruel"), "Aragón"),
    (("extremadura", "badajoz", "caceres"), "Extremadura"),
    (
        ("pais vasco", "euskadi", "donostia", "gasteiz", "bilbao", "bizkaia", "gipuzkoa", "araba", "alava"),
        "País Vasco",
    ),
    (("asturias",), "Asturias"),
    (("cantabria",), "Cantabria"),
    (("navarra",), "Navarra"),
    (("la rioja", "rioja"), "La Rioja"),
    (("murcia",), "Región de Murcia"),
    (
        ("canarias", "tenerife", "gran canaria", "las palmas", "palmas, las", "lanzarote", "fuerteventura"),
        "Canarias",
    ),
    # after Canarias so "Las Palmas" is not taken for Palma (Mallorca)
    (("baleares", "balears", "mallorca", "menorca", "ibiza", "eivissa", "palma"), "Illes Balears"),
    (("ceuta",), "Ceuta"),
    (("melilla",), "Melilla"),
)

_NUTS = re.compile(r"^(ES\d{2})", re.IGNORECASE)


def infer_comunidad_autonoma(regiones: list[str], organismo: str, nivel_admin: str) -> str:
    for reg in regiones:
        m = _NUTS.match(reg)
        if m and (ccaa := NUTS_PREFIX_TO_CCAA.get(m.group(1).upper())):
            return ccaa

    haystack = normalize_text(f"{' '.join(regiones)} {organismo}")
    for patterns, ccaa in KEYWORD_TO_CCAA:
        if any(has_word(haystack, p) for p in patterns):
            return ccaa

    if "estado" in normalize_text(nivel_admin):
        return "Estatal / Nacional"
    return "Estatal / Sin especificar"
