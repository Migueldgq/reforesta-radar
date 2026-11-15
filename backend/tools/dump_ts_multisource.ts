// Runs the TypeScript eu / fb / bocm / dog connectors (src/lib/sources/multi-source.ts) on the recorded fixtures in
// backend/tests/fixtures/<id>/responses.json, with fetch stubbed and the clock frozen, and saves what they return
// to backend/tests/fixtures/<id>/expected.json. tests/test_sources_multi.py runs the Python ports on the same
// fixtures and must produce the same items and health. Read-only with respect to src/.
//
// Run from the repo root (needs node_modules):
//   TZ=Europe/Madrid npx tsx backend/tools/dump_ts_multisource.ts
import fs from "fs";
import path from "path";

// Frozen "now" per connector (keep in sync with NOW in tests/test_sources_multi.py)
const NOWS: Record<string, string> = {
  eu: "2026-11-15T12:00:00+01:00",
  fb: "2026-11-15T12:00:00+01:00",
  bocm: "2026-11-15T12:00:00+01:00",
  dog: "2026-06-08T12:00:00+02:00",
};

let fixed = 0;
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(fixed);
    else super(...(args as [string]));
  }
  static now() {
    return fixed;
  }
}
globalThis.Date = FrozenDate as unknown as DateConstructor;

const FIXTURES = path.join(__dirname, "..", "tests", "fixtures");
let responses: Record<string, string> = {};
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const body = responses[url];
  return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { status: 200 });
}) as typeof fetch;

async function main() {
  const ms = await import("../../src/lib/sources/multi-source");
  const scrapers: Record<string, () => Promise<unknown>> = {
    eu: ms.scrapeEu,
    fb: ms.scrapeFundacionBiodiversidad,
    bocm: ms.scrapeBocm,
    dog: ms.scrapeDog,
  };
  for (const [id, scrape] of Object.entries(scrapers)) {
    fixed = RealDate.parse(NOWS[id]);
    responses = JSON.parse(fs.readFileSync(path.join(FIXTURES, id, "responses.json"), "utf8"));
    const result = await scrape();
    fs.writeFileSync(path.join(FIXTURES, id, "expected.json"), JSON.stringify(result, null, 1) + "\n");
    console.log(id, (result as { items: unknown[] }).items.length, "items");
  }
}

main();
