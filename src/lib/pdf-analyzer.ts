import { extractText } from "unpdf";
import { normalizeText, scoreConvocatoria } from "./scoring";
import type { PdfAnalysisResult } from "./types";

function cleanWhitespace(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.;])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25 && s.length <= 420);
}

function findMatchingSentences(
  sentences: string[],
  patterns: RegExp[],
  limit = 3
): string[] {
  const hits: string[] = [];
  for (const s of sentences) {
    const norm = normalizeText(s);
    if (patterns.some((p) => p.test(norm))) {
      hits.push(s);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

function detectTitleAndOrganism(text: string, fallbackName: string): {
  title: string;
  organism: string | null;
} {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 4)
    .slice(0, 30);

  let organism: string | null = null;
  for (const line of lines) {
    const norm = normalizeText(line);
    if (
      /^(consejeria|ministerio|diputacion|ayuntamiento|junta|xunta|generalitat|fundacion)/i.test(
        norm
      )
    ) {
      organism = line;
      break;
    }
  }

  const joined = lines.join(" ");
  const orderMatch = joined.match(
    /(Orden\s+\d+\/\d{4}[^.]{10,220}\.|Resoluci[oó]n[^.]{10,220}\.|Extracto[^.]{10,220}\.)/i
  );

  const title = orderMatch?.[1]?.trim() || lines[0] || fallbackName;
  return { title, organism };
}

export async function analyzePdfBuffer(
  buffer: Buffer | Uint8Array,
  fileName: string
): Promise<PdfAnalysisResult> {
  // unpdf rejects Node Buffer instances even though Buffer extends Uint8Array
  const uint8 = Buffer.isBuffer(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : buffer;
  const { totalPages, text: rawText } = await extractText(uint8, {
    mergePages: true,
  });

  const text = cleanWhitespace(rawText || "");
  const sentences = splitSentences(text);
  const { title, organism } = detectTitleAndOrganism(text, fileName);

  const summaryHits = findMatchingSentences(
    sentences,
    [/objeto|finalidad|tienen por objeto|destinadas a financiar/],
    2
  );
  const summary =
    summaryHits.join(" ") ||
    sentences.slice(0, 2).join(" ") ||
    "No se pudo extraer un resumen automático del objeto.";

  const beneficiaries = findMatchingSentences(
    sentences,
    [/beneficiari|entidades sin animo|sin fines de lucro|podran solicitar|podran acceder/],
    3
  );

  const budgetHighlights = findMatchingSentences(
    sentences,
    [/(\d[\d.,]*\s*(euros|€)|cuantia|presupuesto|credito|financiacion|porcentaje|\d+\s*%)/],
    3
  );

  const deadlineHighlights = findMatchingSentences(
    sentences,
    [/plazo de presentacion|dias habiles|dias naturales|fecha limite|hasta el \d/],
    3
  );

  const requirements = findMatchingSentences(
    sentences,
    [/requisit|cofinanci|memoria|justific|antiguedad|ambito|exclusi|incompatible/],
    4
  );

  const fit = scoreConvocatoria({
    titulo: title,
    organismo: organism || fileName,
    extraText: text.slice(0, 24000),
  });

  return {
    fileName,
    totalPages,
    charCount: text.length,
    title,
    organism,
    summary,
    beneficiaries,
    budgetHighlights,
    deadlineHighlights,
    requirements,
    fit,
    excerpt: text.slice(0, 1800),
  };
}
