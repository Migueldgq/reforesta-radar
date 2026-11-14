import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { analyzePdfBuffer } from "@/lib/pdf-analyzer";
import { downloadPdf, MAX_PDF_BYTES, pdfCacheGet, pdfCacheSet } from "@/lib/pdf-cache";

const SAMPLE_FILES: Record<string, { file: string; label: string }> = {
  madrid: {
    file: "comunidad-madrid-orden-1689-2026.pdf",
    label: "Comunidad de Madrid · Orden 1689/2026.pdf",
  },
  miteco: {
    file: "miteco-convocatoria-923290.pdf",
    label: "MITECO · BDNS 923290.pdf",
  },
};

const NOT_PDF_ERROR =
  "El documento oficial no es un PDF con texto (puede ser un Word, una imagen o un enlace). Ábrelo desde la web oficial.";

function isPdf(bytes: Uint8Array): boolean {
  // "%PDF" may be preceded by a few junk bytes
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 1024));
  return head.includes("%PDF");
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: "No se recibió ningún archivo PDF." },
          { status: 400 }
        );
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isPdf(bytes)) return NextResponse.json({ error: NOT_PDF_ERROR }, { status: 415 });
      const result = await analyzePdfBuffer(bytes, file.name);
      return NextResponse.json(result);
    }

    const body = (await req.json()) as {
      sample?: string;
      docId?: number;
      pdfUrl?: string;
      fileName?: string;
    };

    if (body.sample && SAMPLE_FILES[body.sample]) {
      const sample = SAMPLE_FILES[body.sample];
      const filePath = path.join(process.cwd(), "data", "samples", sample.file);
      const buffer = await fs.readFile(filePath);
      const result = await analyzePdfBuffer(buffer, sample.label);
      return NextResponse.json(result);
    }

    if (body.docId) {
      const url = `https://www.infosubvenciones.es/bdnstrans/api/convocatorias/documentos?vpd=GE&idDocumento=${encodeURIComponent(
        String(body.docId)
      )}`;
      return analyzeRemote(url, body.fileName || `BDNS-doc-${body.docId}.pdf`, "No se pudo descargar el PDF desde la BDNS.");
    }

    if (body.pdfUrl) {
      const parsed = new URL(body.pdfUrl);
      const allowedHosts = [
        "www.boe.es",
        "boe.es",
        "www.infosubvenciones.es",
        "www.bocm.es",
        "bocm.es",
        "www.xunta.gal",
        "xunta.gal",
        "fundacion-biodiversidad.es",
        "www.fundacion-biodiversidad.es",
        "ec.europa.eu",
        "api.tech.ec.europa.eu",
        "ted.europa.eu",
        "www.juntadeandalucia.es",
        "bocyl.jcyl.es",
        "www.bocyl.jcyl.es",
        "contrataciondelestado.es",
        "www.contrataciondelestado.es",
        "www.fundacionmontemadrid.es",
      ];
      if (!allowedHosts.includes(parsed.hostname)) {
        return NextResponse.json(
          { error: "Host de PDF no permitido." },
          { status: 400 }
        );
      }
      return analyzeRemote(
        body.pdfUrl,
        body.fileName || parsed.pathname.split("/").pop() || "documento.pdf",
        "No se pudo descargar el PDF oficial."
      );
    }

    return NextResponse.json(
      { error: "Parámetros inválidos para analizar PDF." },
      { status: 400 }
    );
  } catch (err) {
    console.error("PDF analysis error:", err);
    return NextResponse.json(
      { error: "Error procesando el PDF. Comprueba que sea un PDF válido con texto." },
      { status: 500 }
    );
  }
}

// Download (15 s timeout, size cap) + analyze a remote PDF; results cached by URL so re-opening is instant.
async function analyzeRemote(url: string, fileName: string, failMsg: string) {
  const key = `${url}|${fileName}`;
  const hit = pdfCacheGet<Awaited<ReturnType<typeof analyzePdfBuffer>>>(key);
  if (hit) return NextResponse.json(hit);
  const bytes = await downloadPdf(url);
  if (bytes === "too-large") {
    return NextResponse.json(
      { error: `El PDF supera ${MAX_PDF_BYTES / 1024 / 1024} MB; ábrelo en la web oficial.` },
      { status: 413 }
    );
  }
  if (!bytes) return NextResponse.json({ error: failMsg }, { status: 502 });
  if (!isPdf(bytes)) return NextResponse.json({ error: NOT_PDF_ERROR }, { status: 415 });
  const result = await analyzePdfBuffer(bytes, fileName);
  pdfCacheSet(key, result);
  return NextResponse.json(result);
}
