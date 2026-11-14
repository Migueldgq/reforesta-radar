// Bounded in-memory cache of PDF analyses (keyed by source URL) + size-capped PDF download.
import { USER_AGENT } from "./http";

const MAX_ENTRIES = 50;
export const MAX_PDF_BYTES = 15 * 1024 * 1024;

const g = globalThis as typeof globalThis & { __radarPdfCache?: Map<string, unknown> };
const cache = (g.__radarPdfCache ??= new Map<string, unknown>());

export function pdfCacheGet<T>(key: string): T | undefined {
  const v = cache.get(key);
  if (v === undefined) return undefined;
  cache.delete(key); // LRU: move to the end
  cache.set(key, v);
  return v as T;
}

export function pdfCacheSet(key: string, value: unknown) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
}

/** Download a PDF with a timeout and a hard size cap. */
export async function downloadPdf(url: string, timeoutMs = 15000): Promise<Uint8Array | "too-large" | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    if (!res.ok || !res.body) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_PDF_BYTES) {
      await res.body.cancel();
      return "too-large";
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PDF_BYTES) {
        await reader.cancel();
        return "too-large";
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out;
  } catch {
    return null;
  }
}
