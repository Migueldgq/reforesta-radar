# Reforesta Radar

> **Menos horas leyendo bases, más horas en el monte.**  
> Proyecto para **1hack A Coruña — El reto de Reforesta** (Common Seeds / The Agile Monkeys). Ver especificación completa del reto en [RETO.md](./RETO.md).

## El problema que resuelve
Reforesta (ONG con >30 años plantando y un equipo de 6–7 personas) solo presenta 4–5 convocatorias al año porque revisa a mano las mismas 4 fuentes (MITECO, Fundación Biodiversidad, Comunidad de Madrid y Agenda 2030) y pierde horas leyendo PDFs de decenas de páginas para decidir si una ayuda encaja. Además, su canal de empresas/RSC está a cero.

**Reforesta Radar** recopila y prioriza convocatorias reales de **subvenciones, licitaciones y boletines oficiales** (especialmente **fuera de esas 4 fuentes**), y resume cualquier PDF de bases en una **Ficha de Decisión en 30 segundos**, lista para abrir y usar el lunes. *(No redacta propuestas: aporta capacidad de detección y priorización.)*

## Qué incluye
1. **Subvenciones BDNS (en vivo · `infosubvenciones.es`):**
   - Consulta 10 búsquedas ambientales en paralelo en la API pública de la BDNS y enriquece las 40 convocatorias más relevantes.
   - Filtra por **Comunidad Autónoma**, **Línea de trabajo de Reforesta**, **Estado del plazo**, **Concurrencia competitiva** y **"Fuera de tus 4 fuentes"**.
   - Puntúa cada convocatoria (**0–100**) y detecta **dealbreakers** (nominativas/directas, solo PYMEs, plazos cerrados, etc.).
   - Flujo de **triaje para el equipo** (*En estudio / A presentar / Descartada*) persistido en el navegador y análisis en 1 clic de los PDFs adjuntos.
2. **Licitaciones & BOE (en vivo · `boe.es`):**
   - Escanea los últimos 14 días de la API de Datos Abiertos del BOE: **Sección V.A (Licitaciones / Contratación del Sector Público)**, **Sección III** y **Sección V.B**.
   - Permite filtrar solo licitaciones y analizar el PDF oficial del BOE en 1 clic.
3. **Boletines & UE (en vivo):**
   - **UE Funding & Tenders / Programa LIFE** (API SEDIA oficial de la Comisión Europea).
   - **DOG (Diario Oficial de Galicia)** (scraper HTML Secciones III y VI).
   - **BOCM (Boletín Oficial de la Comunidad de Madrid)** (scraper XML oficial).
   - **Fundación Biodiversidad** (scraper de convocatorias).
4. **Analizador de Bases (PDF → 30s):**
   - Extrae texto en servidor con `unpdf` sin depender de API keys externas de LLM.
   - Incluye acceso directo a los **2 PDFs reales de ejemplo del reto** (`Comunidad de Madrid · Orden 1689/2026` y `MITECO · BDNS 923290`) en `data/samples/`.
5. **Empresas & RSC (0 → 2–4 empresas):**
   - Directorio curado y filtrable por línea de trabajo con importes típicos y ángulo concreto de propuesta para abrir el canal corporativo el lunes.

## Stack técnico
- **Next.js 16** (App Router, TypeScript)
- **Tailwind CSS v4** + **Lucide React**
- **unpdf** para extracción de texto de PDFs en servidor
- Conectores en vivo a **BDNS**, **BOE**, **BOCM**, **DOG**, **UE SEDIA (LIFE / Funding & Tenders)** y **Fundación Biodiversidad**

## Cómo arrancarlo en local

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

Para producción:
```bash
npm run build
npm run start
```
