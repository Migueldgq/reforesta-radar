// Shared HTTP helpers for the source connectors: generic UA, timeouts, concurrency limit.

export const USER_AGENT = "Mozilla/5.0 (compatible; ReforestaRadar/1.0)";

// Identical concurrent GETs share one upstream request (survives HMR via globalThis).
const g = globalThis as typeof globalThis & { __radarGetInFlight?: Map<string, Promise<string | null>> };
const getInFlight = (g.__radarGetInFlight ??= new Map());

export function fetchText(
  url: string,
  init: RequestInit & { timeoutMs?: number; retries?: number } = {}
): Promise<string | null> {
  if (init.method && init.method !== "GET") return fetchTextOnce(url, init);
  const key = `${url}\n${JSON.stringify(init.headers ?? {})}`;
  let p = getInFlight.get(key);
  if (!p) {
    p = fetchTextOnce(url, init).finally(() => getInFlight.delete(key));
    getInFlight.set(key, p);
  }
  return p;
}

/** Timeout on every attempt; one retry with backoff, only on network errors, 5xx or 429. */
async function fetchTextOnce(
  url: string,
  init: RequestInit & { timeoutMs?: number; retries?: number }
): Promise<string | null> {
  const { timeoutMs = 10000, retries = 1, headers, ...rest } = init;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const backoff = () => new Promise((r) => setTimeout(r, 800 * (attempt + 1) + Math.random() * 400));
    try {
      const res = await fetch(url, {
        ...rest,
        headers: { "User-Agent": USER_AGENT, ...(headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await backoff();
        continue;
      }
      if (!res.ok) return null;
      return await res.text();
    } catch (e) {
      // retry real network failures, not our own timeout (that would just double the wait)
      if ((e as Error)?.name === "TimeoutError" || attempt >= retries) return null;
      await backoff();
    }
  }
  return null;
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<T | null> {
  const text = await fetchText(url, {
    ...init,
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
  });
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Runs `fn` over `items` with at most `limit` promises in flight. Preserves order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function decodeHtml(str: string): string {
  return str
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&rsquo;|&lsquo;|&#8217;|&#8216;/g, "'")
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
    .replace(/&hellip;|&#8230;/g, "…")
    .replace(/&ndash;|&#8211;/g, "–")
    .replace(/&mdash;|&#8212;/g, "—")
    .replace(/&([aeiou])acute;/gi, (_, v: string) => ({ a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" })[v] ?? v)
    .replace(/&ntilde;/g, "ñ")
    .replace(/&Ntilde;/g, "Ñ")
    .replace(/&uuml;/g, "ü")
    .replace(/&ordm;/g, "º")
    .replace(/&ordf;/g, "ª")
    .replace(/&euro;/g, "€")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "dd/mm/yyyy" -> "yyyy-mm-dd" (null if not parseable) */
export function esDateToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
