import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { analyzePdfBuffer } from "@/lib/pdf-analyzer";

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
      const arrayBuffer = await file.arrayBuffer();
      const result = await analyzePdfBuffer(
        new Uint8Array(arrayBuffer),
        file.name
      );
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
      const url = `https://www.infosubvenciones.es/bdnstrans/api/convocatorias/documentos?idDoc=${encodeURIComponent(
        String(body.docId)
      )}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        return NextResponse.json(
          { error: "No se pudo descargar el PDF desde la BDNS." },
          { status: 502 }
        );
      }
      const arrayBuffer = await res.arrayBuffer();
      const result = await analyzePdfBuffer(
        new Uint8Array(arrayBuffer),
        body.fileName || `BDNS-doc-${body.docId}.pdf`
      );
      return NextResponse.json(result);
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
      ];
      if (!allowedHosts.includes(parsed.hostname)) {
        return NextResponse.json(
          { error: "Host de PDF no permitido." },
          { status: 400 }
        );
      }
      const res = await fetch(body.pdfUrl, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        return NextResponse.json(
          { error: "No se pudo descargar el PDF oficial." },
          { status: 502 }
        );
      }
      const arrayBuffer = await res.arrayBuffer();
      const result = await analyzePdfBuffer(
        new Uint8Array(arrayBuffer),
        body.fileName || parsed.pathname.split("/").pop() || "documento.pdf"
      );
      return NextResponse.json(result);
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
