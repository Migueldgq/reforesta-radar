# 0019. Analizador de PDF por reglas, con protección SSRF

- Estado: Aceptada
- Fecha: 2026-11-15 (d162feb, PR #21; el analizador existe desde cfb6d85, 2026-11-14)

## Contexto
Leer unas bases de decenas de páginas es uno de los dolores del reto. «Analizar PDF» acepta un archivo subido, uno de
los ejemplos, un documento de la BDNS o una URL. Descargar una URL que da el usuario permite a un atacante hacer que
el servidor pida direcciones internas (SSRF). La versión TypeScript solo comprobaba el primer host contra una lista y
seguía redirecciones a cualquier sitio.

## Decisión
- El análisis usa las mismas reglas que el resto del radar (sin LLM, 0006): extrae el texto con `pypdf` y devuelve
  una ficha (encaje, qué vigilar, quién puede pedirla, dinero, plazos, requisitos).
- La descarga por URL (`backend/app/pdf/download.py`): lista de hosts permitidos; en cada salto (URL inicial y cada
  redirección, máximo 5) solo http/https en el puerto por defecto, el host se resuelve una vez y toda dirección debe
  ser pública, y se conecta a esa IP exacta (contra DNS rebinding); límite de 15 MB leyendo por partes, un tiempo
  total, sin proxies del entorno. Caché LRU de 50 PDFs remotos.

## Consecuencias
- El servidor no puede usarse para alcanzar la red interna a través del analizador.
- Solo entiende lo que las reglas buscan; un PDF escaneado sin texto no da ficha útil.
- La lista de hosts limita qué URLs se pueden analizar.

## Alternativas consideradas
- Resumir con un LLM: posible más adelante y bajo demanda (0006).
