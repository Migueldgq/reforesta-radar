import type { RscOpportunity } from "./types";

export const RSC_OPPORTUNITIES: RscOpportunity[] = [
  {
    id: "rsc-iberdrola",
    entity: "Fundación Iberdrola España",
    program: "Programa Social & Biodiversidad (Convocatoria anual de ayudas)",
    type: "Fundación privada",
    focus: ["restauracion", "conservacion", "educacion"],
    typicalAmount: "20.000 € – 40.000 € por proyecto",
    cadence: "Convocatoria anual (primer trimestre)",
    whyReforesta:
      "Financian proyectos de conservación de biodiversidad, restauración de hábitats y educación ambiental ejecutados por entidades sin ánimo de lucro.",
    pitchAngle:
      "Proponer restauración de riberas o mejora de hábitat de aves/anfibios con métricas claras de hectáreas recuperadas y voluntariado corporativo.",
    url: "https://www.fundacioniberdrolaespana.org/",
  },
  {
    id: "rsc-montemadrid",
    entity: "Fundación Montemadrid & CaixaBank",
    program: "Convocatoria de Medioambiente y Desarrollo Sostenible",
    type: "Fundación privada",
    focus: ["conservacion", "educacion", "restauracion"],
    typicalAmount: "10.000 € – 35.000 €",
    cadence: "Anual (Comunidad de Madrid y alrededores)",
    whyReforesta:
      "Encaje geográfico directo con el histórico de Reforesta en Madrid y Sierra de Guadarrama; prioridad a ONG locales con trayectoria.",
    pitchAngle:
      "Control de especies invasoras (ailanto) y creación de charcas para tritones/anfibios con participación ciudadana.",
    url: "https://www.fundacionmontemadrid.es/",
  },
  {
    id: "rsc-endesa",
    entity: "Endesa / Fundación Endesa",
    program: "Premios y alianzas de Biodiversidad y Ecosistemas",
    type: "Programa RSC",
    focus: ["conservacion", "restauracion"],
    typicalAmount: "15.000 € – 60.000 € (patrocinio o convenio)",
    cadence: "Continuo / Anual",
    whyReforesta:
      "Reforesta ya tiene experiencia en mejora de hábitat de aves con empresas de energía: caso de éxito replicable.",
    pitchAngle:
      "Ofrecer paquete llave en mano: mejora de hábitat avifauna + plantación autóctona bajo líneas/entornos rurales con reporte de impacto.",
    url: "https://www.fundacionendesa.org/",
  },
  {
    id: "rsc-repsol",
    entity: "Fundación Repsol (Motor Verde)",
    program: "Reforestación y sumideros de carbono en España",
    type: "Programa RSC",
    focus: ["restauracion", "agroambiental"],
    typicalAmount: "Convenio por hectárea plantada",
    cadence: "Ventanilla abierta para propietarios y entidades ejecutoras",
    whyReforesta:
      "Buscan socios técnicos sobre el terreno con acuerdos de custodia del territorio y capacidad de plantación en zonas quemadas.",
    pitchAngle:
      "Presentar cartera de terrenos municipales/privados con acuerdos de custodia listos para reforestar.",
    url: "https://www.fundacionrepsol.com/",
  },
  {
    id: "rsc-lacaixa",
    entity: "Fundación ”la Caixa”",
    program: "Convocatorias Territoriales (Medioambiente e inclusión)",
    type: "Fundación privada",
    focus: ["educacion", "restauracion"],
    typicalAmount: "15.000 € – 50.000 €",
    cadence: "Anual por comunidad autónoma",
    whyReforesta:
      "Valoran proyectos ambientales que incorporen empleo verde, voluntariado o educación ambiental con colectivos vulnerables.",
    pitchAngle:
      "Combinar educación ambiental + brigadas o talleres de plantación inclusivos en parques regionales.",
    url: "https://fundacionlacaixa.org/",
  },
  {
    id: "rsc-santander",
    entity: "Banco Santander (Santander España)",
    program: "Convocatoria Santander Sostenible / Proyectos medioambientales",
    type: "Programa RSC",
    focus: ["restauracion", "educacion", "agroambiental"],
    typicalAmount: "10.000 € – 30.000 €",
    cadence: "Anual",
    whyReforesta:
      "Canal directo para ONGs españolas con proyectos medibles en reforestación y programas agroambientales.",
    pitchAngle:
      "Programa agroambiental con agricultores + apadrinamiento de árboles con seguimiento anual.",
    url: "https://www.bancosantander.es/",
  },
];
