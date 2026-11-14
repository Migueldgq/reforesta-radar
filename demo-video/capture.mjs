#!/usr/bin/env node
// Records each "screen" scene of the demo from the live app with local Chrome (puppeteer-core),
// then transcodes it to an H.264 clip of exactly the scene's duration for the HyperFrames composition.
//
//   node capture.mjs                 # all screen scenes
//   node capture.mjs inicio encaja   # only these scene ids
//
// Env: BASE_URL (default http://localhost:3000), CHROME_PATH, DSF (deviceScaleFactor, default 2), HEADFUL=1.
// Output: captures/raw/<id>.webm (raw screencast) and composition/assets/scenes/<id>.mp4 (1920x1080, 30 fps).
// A scene that fails is skipped with a warning; compose.mjs shows a placeholder for any missing clip.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { FPS, SCENES } from "./scenes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* CONFIG — every selector and app-specific detail lives here.        */
/* A selector is a list of alternatives, tried in order:              */
/*   { css, text?: RegExp, attr?: [name, RegExp], within?: css }      */
/* `text` matches the element's visible text; first visible match wins.*/
/* ------------------------------------------------------------------ */
const CONFIG = {
  baseUrl: process.env.BASE_URL ?? "http://localhost:3000",
  // VIEWPORT=1440x810 renders the UI ~33% larger in the final 1080p video (more legible); default per brief.
  viewport: (([w, h]) => ({ width: w, height: h }))((process.env.VIEWPORT ?? "1920x1080").split("x").map(Number)),
  deviceScaleFactor: Number(process.env.DSF ?? 2),
  chromeCandidates: [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ],
  // Hide dev-only chrome (Next.js dev indicator) and scrollbars in the recording.
  hideCss: `nextjs-portal{display:none!important} *::-webkit-scrollbar{display:none} *{scrollbar-width:none}`,
  rawDir: path.join(HERE, "captures/raw"),
  clipDir: path.join(HERE, "composition/assets/scenes"),
  waitTimeout: 20000,
  // Board seeding: written to localStorage before recording so Seguimiento is not empty.
  triageStorageKey: "reforesta-radar:seguimiento:v1",
  apiPath: "/api/oportunidades",
  // The organisers' two example calls (README: "La prueba de la organización").
  examples: [
    { id: "bdns:923290", search: "científica", row: /investigaci[oó]n cient[ií]fica/i },
    { id: "bdns:904719", search: "madrid ambientales", row: /proyectos ambientales 2026/i },
  ],
  sel: {
    homeReady: [{ css: "tbody tr" }, { css: "[role=row]" }],
    kpiCards: [{ css: "main button", text: /Abiertas ahora|Encaje alto/ }],
    chartWeekBar: [{ css: "button[aria-label^='Semana del']", attr: ["aria-label", /: [1-9]\d* convocatorias/] }],
    chartWorkLine: [{ css: "main button", text: /^Restauraci[oó]n de ecosistemas/ }],
    clearFilters: [{ css: "main button", text: /^Limpiar/ }, { css: "button[aria-label^='Quitar filtro']" }],
    sortByDeadline: [{ css: "thead button, th button, th", text: /^Plazo/ }],
    tableRow: [{ css: "tbody tr" }, { css: "[role=row]" }],
    search: [{ css: "input[type=search]" }, { css: "input[aria-label='Buscar']" }, { css: "input[placeholder^='Buscar']" }],
    drawer: [{ css: "[role=dialog]" }],
    drawerFit: [{ css: "[role=dialog] [aria-label='¿Encaja?']" }, { css: "[role=dialog] section", text: /¿Encaja\?/ }],
    triageEstudio: [{ css: "[role=dialog] [role=radio]", text: /^En estudio$/ }, { css: "[role=dialog] button", text: /^En estudio$/ }],
    fueraKpi: [{ css: "main button", text: /Fuera de tus 4 fuentes/ }, { css: "[role=switch]" }, { css: "button", text: /Fuera de tus 4 fuentes/ }],
    boardReady: [{ css: "[data-col]" }],
    boardCardIn: (col) => [{ css: `[data-col='${col}'] [data-slot=card]` }, { css: `[data-col='${col}'] [class*=card]` }],
    boardColumn: (col, label) => [{ css: `[data-col='${col}']` }, { css: "section", text: new RegExp(`^${label}`) }],
    pageHeading: [{ css: "main h1" }, { css: "h1" }],
    // Madrid sample first: it is the 12-page bases and yields a fuller ficha than the 3-page MITECO extract.
    pdfSample: [{ css: "button", text: /Orden 1689\/2026/ }, { css: "button", text: /BDNS 923290/ }],
    pdfResult: [{ css: "[aria-live=polite]", text: /encaj/i }, { css: "main", text: /\/\s*100/ }],
    sourcesTable: [{ css: "main table" }, { css: "main" }],
  },
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const warn = (...a) => console.warn("  ⚠", ...a);
const log = (...a) => console.log(...a);

function chromePath() {
  const p = CONFIG.chromeCandidates.find((c) => c && existsSync(c));
  if (!p) throw new Error("Chrome not found. Set CHROME_PATH to a Chrome/Chromium executable.");
  return p;
}

/** Returns an ElementHandle for the first visible element matching any alternative, or null. */
async function find(page, specs, { timeout = CONFIG.waitTimeout, index = 0 } = {}) {
  const t0 = Date.now();
  const serial = specs.map((s) => ({
    css: s.css,
    text: s.text ? [s.text.source, s.text.flags] : null,
    attr: s.attr ? [s.attr[0], s.attr[1].source, s.attr[1].flags] : null,
  }));
  do {
    const h = await page.evaluateHandle(
      (serial, index) => {
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
        };
        for (const s of serial) {
          let els;
          try {
            els = [...document.querySelectorAll(s.css)];
          } catch {
            continue;
          }
          els = els.filter(visible);
          if (s.text) {
            const re = new RegExp(s.text[0], s.text[1]);
            els = els.filter((e) => re.test((e.innerText || e.textContent || "").trim()));
          }
          if (s.attr) {
            const re = new RegExp(s.attr[1], s.attr[2]);
            els = els.filter((e) => re.test(e.getAttribute(s.attr[0]) ?? ""));
          }
          if (els[index]) return els[index];
        }
        return null;
      },
      serial,
      index,
    );
    const el = h.asElement();
    if (el) return el;
    await h.dispose();
    await sleep(200);
  } while (Date.now() - t0 < timeout);
  return null;
}

async function must(page, specs, what, opts) {
  const el = await find(page, specs, opts);
  if (!el) throw new Error(`not found: ${what}`);
  return el;
}

/** Smooth, eased mouse move so the injected cursor glides instead of jumping. */
let mousePos = { x: 960, y: 540 };
async function glide(page, x, y, ms = 650) {
  // Time-based (not step-based) so the move lasts `ms` however slow each CDP round trip is.
  const from = { ...mousePos };
  const t0 = Date.now();
  for (;;) {
    const t = Math.min(1, (Date.now() - t0) / ms);
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    if (t === 1) break;
    await sleep(10);
  }
  mousePos = { x, y };
}

async function center(el) {
  await el.scrollIntoView().catch(() => {});
  const b = await el.boundingBox();
  if (!b) throw new Error("element has no box");
  return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 24) };
}

async function clickEl(page, el, { pause = 350 } = {}) {
  const c = await center(el);
  await glide(page, c.x, c.y);
  await sleep(150);
  await page.mouse.click(c.x, c.y);
  await sleep(pause);
}

async function clickSel(page, specs, what, opts) {
  await clickEl(page, await must(page, specs, what, opts), opts);
}

async function typeInto(page, specs, text) {
  const el = await must(page, specs, "search box");
  await clickEl(page, el, { pause: 150 });
  await el.evaluate((e) => e.select()); // select previous text so typing replaces it
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text, { delay: 40 });
}

/** Smooth-scrolls the largest scrollable area (inside `rootCss` if given) by dy pixels. */
async function scrollBy(page, dy, { rootCss = null, ms = 900 } = {}) {
  await page.evaluate(
    async (dy, rootCss, ms) => {
      const root = rootCss ? document.querySelector(rootCss) : document;
      if (!root) return;
      const cands = [...root.querySelectorAll("*")].filter((e) => {
        const cs = getComputedStyle(e);
        return /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 4;
      });
      if (!rootCss && document.scrollingElement.scrollHeight > innerHeight + 4) cands.push(document.scrollingElement);
      const target = cands.sort((a, b) => b.clientHeight - a.clientHeight)[0];
      if (!target) return;
      const start = target.scrollTop;
      const t0 = performance.now();
      await new Promise((done) => {
        const step = (now) => {
          const t = Math.min(1, (now - t0) / ms);
          const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
          target.scrollTop = start + dy * e;
          t < 1 ? requestAnimationFrame(step) : done();
        };
        requestAnimationFrame(step);
      });
    },
    dy,
    rootCss,
    ms,
  );
}

// Fake cursor: headless Chrome does not paint the mouse pointer.
const CURSOR_SCRIPT = (hideCss) => {
  const install = () => {
    if (document.getElementById("__demo_cursor")) return;
    const st = document.createElement("style");
    st.textContent = hideCss + `
      #__demo_cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;
        transform:translate(-100px,-100px);transition:transform 40ms linear}
      #__demo_cursor.down svg{transform:scale(.88)}
      #__demo_cursor svg{transform-origin:2px 2px;transition:transform 120ms ease;filter:drop-shadow(0 1px 2px rgba(0,0,0,.25))}`;
    document.head.appendChild(st);
    const c = document.createElement("div");
    c.id = "__demo_cursor";
    c.innerHTML = `<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 17 L7.2 13.2 L10 19.5 L12.6 18.4 L9.9 12.3 L15.5 12.3 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    document.documentElement.appendChild(c);
    addEventListener("mousemove", (e) => (c.style.transform = `translate(${e.clientX}px,${e.clientY}px)`), true);
    addEventListener("pointermove", (e) => (c.style.transform = `translate(${e.clientX}px,${e.clientY}px)`), true);
    addEventListener("mousedown", () => c.classList.add("down"), true);
    addEventListener("mouseup", () => c.classList.remove("down"), true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
};

async function goto(page, route, readySpecs) {
  await page.goto(CONFIG.baseUrl + route, { waitUntil: "networkidle2", timeout: 60000 });
  if (readySpecs) await must(page, readySpecs, `ready marker for ${route}`, { timeout: 45000 });
  await page.mouse.move(mousePos.x, mousePos.y);
  await sleep(600); // let charts/fonts settle before recording
}

/* ------------------------------------------------------------------ */
/* Scenes: `prepare` runs before recording, `run` while recording.    */
/* ------------------------------------------------------------------ */
const S = CONFIG.sel;
const ACTIONS = {
  async fuentes(page) {
    await sleep(1800);
    await scrollBy(page, 420, { ms: 2200 });
    await sleep(800);
    const t = await find(page, S.tableRow, { timeout: 2000, index: 2 });
    if (t) await glide(page, (await center(t)).x, (await center(t)).y, 900);
  },

  async inicio(page) {
    await sleep(900);
    const bar = await find(page, S.chartWeekBar, { index: 1 });
    if (bar) await clickEl(page, bar, { pause: 1400 });
    else warn("inicio: no week bar");
    const line = await find(page, S.chartWorkLine, { timeout: 3000 });
    if (line) await clickEl(page, line, { pause: 1200 });
    await scrollBy(page, 640, { ms: 1400 });
    await sleep(900);
    const clear = await find(page, S.clearFilters, { timeout: 2000 });
    if (clear) await clickEl(page, clear, { pause: 900 });
  },

  async encaja(page) {
    await sleep(500);
    await scrollBy(page, 560, { ms: 1000 });
    const row = await must(page, S.tableRow, "first table row");
    await clickEl(page, row, { pause: 1300 });
    await must(page, S.drawer, "detail drawer");
    const fit = await find(page, S.drawerFit, { timeout: 3000 });
    if (fit) {
      const c = await center(fit);
      await glide(page, c.x, c.y, 800);
    }
    await sleep(1600);
    await scrollBy(page, 520, { rootCss: "[role=dialog]", ms: 1400 });
    await sleep(600);
    const estudio = await find(page, S.triageEstudio, { timeout: 2000 });
    if (estudio) await clickEl(page, estudio, { pause: 900 });
  },

  async ejemplos(page) {
    for (const ex of CONFIG.examples) {
      await typeInto(page, S.search, ex.search);
      await sleep(600);
      const row = await find(page, [{ css: "tbody tr", text: ex.row }, { css: "[role=row]", text: ex.row }], { timeout: 6000 });
      if (!row) {
        warn(`ejemplos: row for ${ex.id} not found`);
        continue;
      }
      await clickEl(page, row, { pause: 1000 });
      const reason = await find(page, [{ css: "[role=dialog] li, [role=dialog] p", text: /edici[oó]n actual cerr[oó]/i }], { timeout: 3000 });
      if (reason) {
        const c = await center(reason);
        await glide(page, c.x + 40, c.y, 700);
      }
      await sleep(1500);
      await page.keyboard.press("Escape");
      await sleep(500);
    }
  },

  async fuera(page) {
    await sleep(700);
    await clickSel(page, S.fueraKpi, "Fuera de tus 4 fuentes", { pause: 1300 });
    await scrollBy(page, 620, { ms: 1500 });
    await sleep(800);
  },

  async seguimiento(page) {
    await sleep(900);
    const card = await must(page, S.boardCardIn("estudio"), "card in En estudio");
    const target = await must(page, S.boardColumn("presentar", "A presentar"), "A presentar column");
    const a = await center(card);
    const tb = await target.boundingBox();
    await glide(page, a.x, a.y, 700);
    await sleep(250);
    await page.mouse.down();
    await glide(page, a.x + 12, a.y + 6, 120); // pass the drag threshold
    await glide(page, tb.x + tb.width / 2, tb.y + 140, 1300);
    await sleep(300);
    await page.mouse.up();
    await sleep(1500);
  },

  async empresas(page) {
    await sleep(1500);
    await scrollBy(page, 700, { ms: 2600 });
    await sleep(800);
  },

  async analizar(page) {
    await sleep(700);
    await clickSel(page, S.pdfSample, "sample PDF button", { pause: 300 });
    const res = await find(page, S.pdfResult, { timeout: 30000 });
    if (!res) warn("analizar: no result after 30 s");
    await sleep(900);
    await scrollBy(page, 520, { ms: 1800 });
    await sleep(600);
  },
};

const READY = {
  fuentes: S.sourcesTable,
  inicio: S.homeReady,
  encaja: S.homeReady,
  ejemplos: S.homeReady,
  fuera: S.homeReady,
  seguimiento: S.boardReady,
  empresas: S.pageHeading,
  analizar: S.pdfSample,
};

/** Puts a few real high-fit calls (plus the organisers' examples) on the tracking board. */
async function seedBoard(page) {
  try {
    let items;
    for (let i = 0; i < 5 && !items; i++) {
      try {
        items = (await (await fetch(CONFIG.baseUrl + CONFIG.apiPath)).json()).items;
      } catch {
        await sleep(3000); // the API may be mid-refresh or the dev server recompiling
      }
    }
    if (!items) throw new Error(`no data from ${CONFIG.apiPath}`);
    const top = [...items].sort((a, b) => b.fit.score - a.fit.score).slice(0, 4);
    const ex = CONFIG.examples.map((e) => items.find((o) => o.id === e.id)).filter(Boolean);
    const status = ["estudio", "estudio", "presentar", "presentada"];
    const map = {};
    const add = (o, s) => (map[o.id] = { status: s, at: new Date().toISOString(), titulo: o.titulo, organismo: o.organismo, deadline: o.deadline ?? null });
    top.forEach((o, i) => add(o, status[i]));
    ex.forEach((o) => add(o, "estudio"));
    await page.goto(CONFIG.baseUrl + "/seguimiento", { waitUntil: "domcontentloaded" });
    await page.evaluate((k, v) => localStorage.setItem(k, v), CONFIG.triageStorageKey, JSON.stringify(map));
    log(`  seeded board with ${Object.keys(map).length} calls`);
  } catch (e) {
    warn("could not seed the board:", e.message);
  }
}

function transcode(raw, out, duration) {
  // Downscale (supersampled when DSF=2) to 1920x1080, hold the last frame if short, cut to exact length.
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-i", raw,
    "-vf", `scale=1920:1080:flags=lanczos,fps=${FPS},tpad=stop_mode=clone:stop_duration=${duration}`,
    "-t", String(duration),
    "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    out,
  ]);
}

/* ------------------------------------------------------------------ */
async function main() {
  const only = process.argv.slice(2);
  const scenes = SCENES.filter((s) => s.kind === "screen" && (only.length === 0 || only.includes(s.id)));
  if (!scenes.length) return log("No matching screen scenes.");

  try {
    const r = await fetch(CONFIG.baseUrl, { method: "HEAD" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error(`App not reachable at ${CONFIG.baseUrl} (${e.message}). Start it with \`npm run dev\` in the repo root.`);
    process.exit(1);
  }
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    console.error("ffmpeg not found. On macOS: brew install ffmpeg");
    process.exit(1);
  }

  mkdirSync(CONFIG.rawDir, { recursive: true });
  mkdirSync(CONFIG.clipDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: process.env.HEADFUL ? false : true,
    defaultViewport: { ...CONFIG.viewport, deviceScaleFactor: CONFIG.deviceScaleFactor },
    args: [`--window-size=${CONFIG.viewport.width},${CONFIG.viewport.height}`, "--hide-scrollbars", "--lang=es-ES"],
  });
  const ok = [];
  const failed = [];
  try {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }, { name: "prefers-reduced-motion", value: "no-preference" }]);
    await page.evaluateOnNewDocument(CURSOR_SCRIPT, CONFIG.hideCss);
    await seedBoard(page);

    for (const scene of scenes) {
      log(`▶ ${scene.id} (${scene.duration}s) ${scene.route}`);
      const raw = path.join(CONFIG.rawDir, `${scene.id}.webm`);
      const out = path.join(CONFIG.clipDir, `${scene.id}.mp4`);
      for (let attempt = 1; attempt <= 2; attempt++) {
        let recorder = null;
        try {
          mousePos = { x: 1500, y: 700 };
          await goto(page, scene.route, READY[scene.id]);
          recorder = await page.screencast({ path: raw, fps: FPS, quality: 12 });
          const t0 = Date.now();
          await ACTIONS[scene.id](page);
          const left = scene.duration * 1000 - (Date.now() - t0);
          if (left > 0) await sleep(left + 300);
          else warn(`${scene.id}: actions took ${((Date.now() - t0) / 1000).toFixed(1)}s, clip is cut at ${scene.duration}s`);
          await recorder.stop();
          recorder = null;
          transcode(raw, out, scene.duration);
          ok.push(scene.id);
          log(`  ✓ ${path.relative(HERE, out)}`);
          break;
        } catch (e) {
          if (recorder) await recorder.stop().catch(() => {});
          // A dev-server hot reload mid-scene destroys the page context: retry once.
          if (attempt === 1) {
            warn(`${scene.id} failed (${e.message}), retrying`);
            await sleep(3000);
            continue;
          }
          failed.push(scene.id);
          warn(`${scene.id} skipped: ${e.message}`);
          rmSync(out, { force: true }); // compose.mjs will show a placeholder
        } finally {
          await page.keyboard.press("Escape").catch(() => {});
        }
      }
    }
  } finally {
    await browser.close();
  }
  log(`\nCaptured: ${ok.join(", ") || "none"}${failed.length ? `\nSkipped: ${failed.join(", ")}` : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
