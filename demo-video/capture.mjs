#!/usr/bin/env node
// Records each "screen" beat of the demo from the live app with local Chrome (puppeteer-core).
//
//   node capture.mjs                  # all screen beats, in order
//   node capture.mjs perfil analizar  # only these beat ids
//
// Env: BASE_URL (default http://localhost:3000), CHROME_PATH, VIEWPORT (default 1440x810), DSF (default 2), HEADFUL=1.
//
// For every beat it writes:
//   composition/assets/scenes/<id>.mp4  H.264 at native 2x pixels (2880x1620), speed-ramped and trimmed to the action
//   captures/<id>.json                  event log in OUTPUT time: camera targets, clicks, headline changes
// compose.mjs turns that log into the camera moves (crop/push/pan on the white canvas), click sounds and headlines,
// so everything stays in sync after a re-capture. A beat that fails is retried once, then skipped with a warning.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { FPS, SCENES } from "./scenes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* CONFIG — every selector and app-specific detail lives here.        */
/* A selector is a list of alternatives, tried in order:              */
/*   { css, text?: RegExp, attr?: [name, RegExp], smallest?: true }   */
/* `text` matches visible text; `smallest` picks the tightest match.  */
/* ------------------------------------------------------------------ */
const [VW, VH] = (process.env.VIEWPORT ?? "1440x810").split("x").map(Number);
const CONFIG = {
  baseUrl: process.env.BASE_URL ?? "http://localhost:3000",
  viewport: { width: VW, height: VH },
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
  // The app's own collapsed-sidebar state (shadcn cookie): more room for the content we crop.
  cookies: [{ name: "sidebar_state", value: "false" }],
  captureDir: path.join(HERE, "captures"),
  clipDir: path.join(HERE, "composition/assets/scenes"),
  waitTimeout: 20000,
  // Speed-ramps for non-essential motion (output = real time / speed).
  travelSpeed: 2.2,
  scrollSpeed: 2.5,
  // Output seconds a camera move takes (compose.mjs uses the same value per event).
  camMove: 0.7,
  triageStorageKey: "reforesta-radar:seguimiento:v1",
  apiPath: "/api/oportunidades",
  examples: {
    madrid: { id: "bdns:904719", row: /proyectos ambientales 2026/i },
  },
  sel: {
    homeReady: [{ css: "tbody tr" }],
    statTiles: [{ css: "main button", text: /^Abiertas ahora/ }, { css: "main button", text: /^Fuera de tus/ }],
    chartCard: [{ css: "main [data-slot=card]", text: /^Cuándo cierran/ }],
    chartTitle: [{ css: "main *", text: /^Cuándo cierran$/, smallest: true }],
    weekBar: [{ css: "main button", attr: ["aria-label", /^Semana del .*: [1-9]\d* convocatorias/] }],
    mapTitle: [{ css: "main *", text: /^Territorio$/, smallest: true }],
    mapMadrid: [{ css: "[aria-label^='Comunidad de Madrid']" }, { css: "path", attr: ["aria-label", /Madrid/] }],
    tableTop: [{ css: "main table thead" }, { css: "main table" }],
    row: (re) => [{ css: "tbody tr", text: re }, { css: "[role=row]", text: re }],
    drawerFit: [{ css: "[role=dialog] [aria-label='¿Encaja?']" }, { css: "[role=dialog] section", text: /¿Encaja\?/, smallest: true }],
    triageEstudio: [{ css: "[role=dialog] [role=radio]", text: /^En estudio$/ }, { css: "[role=dialog] button", text: /^En estudio$/ }],
    sourcesSummary: [{ css: "main *", text: /^\d+ fuentes · \d+ convocatorias/, smallest: true }, { css: "main p", text: /fuentes ·/ }],
    sourcesTable: [{ css: "main table" }],
    boardReady: [{ css: "[data-col]" }],
    boardCard: (col, re) => [{ css: `[data-col='${col}'] [data-slot=card]`, text: re }, { css: `[data-col='${col}'] [data-slot=card]` }],
    boardColumn: (col) => [{ css: `[data-col='${col}']` }],
    perfilLine: "Educación ambiental",
    perfilOption: "Mucho más",
    // the whole panel (title + numbers + top-5 list), not just its title row
    perfilEffect: [{ css: "main div, main section, main aside", text: /^Efecto de vuestros ajustes[\s\S]*primeras/, smallest: true }, { css: "main div, main section, main aside", text: /^Efecto de vuestros ajustes/, smallest: true }],
    empresasCard: [{ css: "main [data-slot=card]", text: /Santander|Iberdrola|Caixa|Fundaci/ }, { css: "main article" }],
    pdfDrop: [{ css: "main *", text: /^Arrastra un PDF/, smallest: true }],
    pdfSample: [{ css: "button", text: /Orden 1689\/2026/ }, { css: "button", text: /BDNS 923290/ }],
    pdfVerdict: [{ css: "main *", text: /^\d+\s*\/\s*100$/, smallest: true }, { css: "main *", text: /\d+\s*\/\s*100/, smallest: true }],
    pdfMotivos: [{ css: "main *", text: /^Motivos$/, smallest: true }],
  },
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;
const warn = (...a) => console.warn("  ⚠", ...a);
const log = (...a) => console.log(...a);

function chromePath() {
  const p = CONFIG.chromeCandidates.find((c) => c && existsSync(c));
  if (!p) throw new Error("Chrome not found. Set CHROME_PATH to a Chrome/Chromium executable.");
  return p;
}

/** First visible element matching any alternative (optionally inside `root`), or null. */
async function find(page, specs, { timeout = CONFIG.waitTimeout, index = 0, root = null } = {}) {
  const t0 = Date.now();
  const serial = specs.map((s) => ({
    css: s.css,
    smallest: !!s.smallest,
    text: s.text ? [s.text.source, s.text.flags] : null,
    attr: s.attr ? [s.attr[0], s.attr[1].source, s.attr[1].flags] : null,
  }));
  do {
    const h = await page.evaluateHandle(
      (serial, index, root) => {
        const scope = root ?? document;
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
        };
        for (const s of serial) {
          let els;
          try {
            els = [...scope.querySelectorAll(s.css)];
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
          if (s.smallest) {
            const area = (e) => e.getBoundingClientRect().width * e.getBoundingClientRect().height;
            els.sort((a, b) => area(a) - area(b));
          }
          if (els[index]) return els[index];
        }
        return null;
      },
      serial,
      index,
      root,
    );
    const el = h.asElement();
    if (el) return el;
    await h.dispose();
    await sleep(150);
  } while (Date.now() - t0 < timeout);
  return null;
}

async function must(page, specs, what, opts) {
  const el = await find(page, specs, opts);
  if (!el) throw new Error(`not found: ${what}`);
  return el;
}

/* ---------- Recording + interaction log ---------- */

/** One beat's recording: CDP screencast frames at native device pixels, plus an event log (wall clock). */
class Take {
  constructor(page, dir) {
    this.page = page;
    this.dir = dir;
    this.frames = [];
    this.events = [];
    this.pending = [];
  }
  async start() {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.cdp = await this.page.createCDPSession();
    this.cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      this.cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      const file = path.join(this.dir, `f${String(this.frames.length).padStart(5, "0")}.jpg`);
      this.frames.push({ file, ts: metadata.timestamp });
      this.pending.push(writeFile(file, Buffer.from(data, "base64")));
    });
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 92,
      maxWidth: CONFIG.viewport.width * CONFIG.deviceScaleFactor,
      maxHeight: CONFIG.viewport.height * CONFIG.deviceScaleFactor,
      everyNthFrame: 1,
    });
    // Force a first frame even if the page is static.
    await this.page.evaluate(() => document.body.style.setProperty("--demo-nudge", String(Math.random())));
    this.ev("begin");
  }
  ev(type, data = {}) {
    this.events.push({ t: now(), type, ...data });
  }
  async stop() {
    this.ev("end");
    await sleep(120);
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    await Promise.all(this.pending);
    await this.cdp.detach().catch(() => {});
  }
}

let take = null; // current Take
let mousePos = { x: 0, y: 0 };

const ev = (type, data) => take?.ev(type, data);
/** Runs fn with its wall time compressed by `speed` in the output (Infinity = cut out). */
async function ramp(speed, fn) {
  ev("ramp", { speed });
  try {
    return await fn();
  } finally {
    ev("ramp", { speed: 1 });
  }
}
const skip = (fn) => ramp(Infinity, fn);
/** Headline i of this beat starts typing (text lives in scenes.mjs). */
const headline = (i) => ev("head", { i });

/** Union of boxes, padded. */
function region(boxes, pad = 20) {
  const bs = [boxes].flat();
  const x = Math.min(...bs.map((b) => b.x)) - pad;
  const y = Math.min(...bs.map((b) => b.y)) - pad;
  const r = Math.max(...bs.map((b) => b.x + b.width)) + pad;
  const btm = Math.max(...bs.map((b) => b.y + b.height)) + pad;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(r - x), h: Math.round(btm - y) };
}

/**
 * Camera: from now on the composition frames region `r` (viewport CSS px) on the white canvas, moving there over
 * `dur` output seconds (0 = cut). Waits for the move unless `wait` is false.
 */
async function cam(r, { dur = CONFIG.camMove, wait = true, max = null } = {}) {
  ev("cam", { ...r, dur, ...(max ? { max } : {}) });
  if (wait && dur > 0) await sleep(dur * 1000 + 60);
}

/** The results-count line above the table ("N convocatorias"); the map card can show a same-looking label. */
async function tableCount(page) {
  const h = await page.evaluateHandle(() => {
    const els = [...document.querySelectorAll("main span, main div, main p")].filter((e) => /^\d+ convocatorias$/.test(e.innerText?.trim() ?? ""));
    const tableTop = document.querySelector("main table")?.getBoundingClientRect().top ?? Infinity;
    return els.filter((e) => e.getBoundingClientRect().top < tableTop).sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top || a.innerText.length - b.innerText.length)[0] ?? null;
  });
  const el = h.asElement();
  if (!el) throw new Error("not found: table count");
  return el;
}

/** Smooth, eased, time-based mouse move; ramped (fast) in the output. */
async function glide(page, x, y, ms = 600, speed = CONFIG.travelSpeed) {
  const from = { ...mousePos };
  await ramp(speed, async () => {
    const t0 = Date.now();
    for (;;) {
      const t = Math.min(1, (Date.now() - t0) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      if (t === 1) break;
      await sleep(10);
    }
  });
  mousePos = { x, y };
}

async function box(el, { scroll = true } = {}) {
  if (scroll) await el.scrollIntoView().catch(() => {});
  const b = await el.boundingBox();
  if (!b) throw new Error("element has no box");
  return { ...b, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}

async function click(page, x, y, pause = 250) {
  await page.mouse.click(x, y);
  ev("click", { x, y });
  await sleep(pause);
}

/** Smooth-scroll the page's main scroller by dy (or so that `el` sits at `at` of the viewport height). Ramped. */
async function scroll(page, { dy = null, el = null, at = 0.3, ms = 900 } = {}) {
  await ramp(CONFIG.scrollSpeed, () =>
    page.evaluate(
      async (dy, el, at, ms) => {
        const cands = [...document.querySelectorAll("*")].filter((e) => {
          const cs = getComputedStyle(e);
          return /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 4;
        });
        if (document.scrollingElement.scrollHeight > innerHeight + 4) cands.push(document.scrollingElement);
        const target = cands.sort((a, b) => b.clientHeight - a.clientHeight)[0];
        if (!target) return;
        if (el) dy = el.getBoundingClientRect().top - innerHeight * at;
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
      el,
      at,
      ms,
    ),
  );
  await sleep(100);
}

// Fake cursor (headless Chrome paints none) with a click ripple. Sized for a 1.5–2x crop.
const CURSOR_SCRIPT = (hideCss) => {
  const install = () => {
    if (document.getElementById("__demo_cursor")) return;
    const st = document.createElement("style");
    st.textContent = hideCss + `
      #__demo_cursor{position:fixed;left:0;top:0;width:20px;height:20px;z-index:2147483647;pointer-events:none;
        transform:translate(-100px,-100px)}
      #__demo_cursor svg{transform-origin:3px 3px;transition:transform 120ms ease;filter:drop-shadow(0 1px 2px rgba(0,0,0,.28))}
      #__demo_cursor.down svg{transform:scale(.85)}
      .__demo_ripple{position:fixed;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;pointer-events:none;
        z-index:2147483646;border:1.5px solid oklch(0.37 0.07 158);background:oklch(0.37 0.07 158 / .12);
        animation:__demo_rip 480ms cubic-bezier(.2,.7,.3,1) forwards}
      @keyframes __demo_rip{from{transform:scale(.25);opacity:1}to{transform:scale(1.3);opacity:0}}`;
    document.head.appendChild(st);
    const c = document.createElement("div");
    c.id = "__demo_cursor";
    c.innerHTML = `<svg width="20" height="20" viewBox="0 0 22 22"><path d="M3 2 L3 17 L7.2 13.2 L10 19.5 L12.6 18.4 L9.9 12.3 L15.5 12.3 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    document.documentElement.appendChild(c);
    const move = (e) => (c.style.transform = `translate(${e.clientX}px,${e.clientY}px)`);
    addEventListener("mousemove", move, true);
    addEventListener("pointermove", move, true);
    addEventListener("mousedown", (e) => {
      c.classList.add("down");
      const r = document.createElement("div");
      r.className = "__demo_ripple";
      r.style.left = e.clientX + "px";
      r.style.top = e.clientY + "px";
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 560);
    }, true);
    addEventListener("mouseup", () => c.classList.remove("down"), true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
};

async function goto(page, route, readySpecs) {
  await page.goto(CONFIG.baseUrl + route, { waitUntil: "networkidle2", timeout: 60000 });
  if (readySpecs) await must(page, readySpecs, `ready marker for ${route}`, { timeout: 45000 });
  await page.mouse.move(mousePos.x, mousePos.y);
  await sleep(600); // charts/fonts settle before recording starts
}

/* ------------------------------------------------------------------ */
/* Beats: `run` executes while recording; READY is awaited before.    */
/* Each starts with headline(0) and a camera target; compose.mjs adds */
/* a slow push-in while the headline types (~1 s), so hold for it.    */
/* ------------------------------------------------------------------ */
const S = CONFIG.sel;
const TYPE_HOLD = 1100; // ms the first headline needs to type in before the action starts

const ACTIONS = {
  async fuentes(page) {
    const sum = await box(await must(page, S.sourcesSummary, "sources summary"), { scroll: false });
    const tableEl = await must(page, S.sourcesTable, "sources table");
    const table = await box(tableEl, { scroll: false });
    headline(0);
    await cam(region([sum, { ...table, height: 330 }], 24), { dur: 0 });
    await glide(page, table.x + table.width * 0.45, table.y + 70, 500);
    await sleep(TYPE_HOLD + 300);
    // Pan down the list of sources.
    await scroll(page, { dy: 320, ms: 1200 });
    const t2 = await box(tableEl, { scroll: false });
    await cam(region([{ x: t2.x, y: Math.max(70, t2.y + 330), width: t2.width, height: 360 }], 24), { dur: 0.9 });
    await sleep(1200);
  },

  async inicio(page) {
    const a = await box(await must(page, [S.statTiles[0]], "Abiertas ahora tile"), { scroll: false });
    const d = await box(await must(page, [S.statTiles[1]], "Fuera de tus fuentes tile"), { scroll: false });
    headline(0);
    await cam(region([a, d], 28), { dur: 0 });
    await sleep(TYPE_HOLD);
    await glide(page, a.x + a.width * 0.5, a.y + a.height * 0.55, 500);
    await sleep(700);
    await glide(page, d.x + d.width * 0.45, d.y + d.height * 0.55, 700);
    await sleep(900);
  },

  async semana(page) {
    const card = await box(await must(page, S.chartTitle, "chart title"), { scroll: false });
    const bars = [];
    for (let i = 0; i < 12; i++) {
      const el = await find(page, S.weekBar, { index: i, timeout: 500 });
      if (!el) break;
      bars.push({ el, b: await box(el, { scroll: false }) });
    }
    if (!bars.length) throw new Error("no week bars");
    const left = bars[0].b;
    const right = bars.at(-1).b;
    const chart = { x: card.x, y: card.y, width: right.x + right.width - card.x, height: left.y + left.height + 30 - card.y };
    headline(0);
    await cam(region(chart, 24), { dur: 0 });
    await sleep(TYPE_HOLD - 300);
    // The tallest bar in the first weeks.
    const target = bars.slice(0, 8).sort((p, q) => q.b.height - p.b.height)[0] ?? bars[0];
    const pt = { x: target.b.cx, y: target.b.y + target.b.height - 60 };
    await glide(page, pt.x, pt.y, 700);
    await sleep(200);
    await click(page, pt.x, pt.y, 600);
    // The table below reacts: scroll to it and show the filtered count.
    headline(1);
    const count = await tableCount(page);
    await scroll(page, { el: count, at: 0.12 });
    const c = await box(count, { scroll: false });
    const top = await box(await must(page, S.tableTop, "table head"), { scroll: false });
    await cam(region([c, { x: top.x, y: c.y, width: top.width, height: 330 }], 20), { dur: 0.8 });
    await sleep(1700);
  },

  async mapa(page) {
    const title = await box(await must(page, S.mapTitle, "map title"), { scroll: false });
    const madrid = await must(page, S.mapMadrid, "Madrid on the map");
    const m = await box(madrid, { scroll: false });
    headline(0);
    const mapBox = { x: title.x, y: title.y, width: 420, height: 380 };
    await cam(region(mapBox, 16), { dur: 0 });
    await glide(page, m.cx + 60, m.cy + 80, 400);
    await sleep(TYPE_HOLD - 400);
    await cam(region({ x: m.cx - 150, y: m.cy - 120, width: 300, height: 240 }, 0), { dur: 0.6 });
    await glide(page, m.cx, m.cy, 600);
    await sleep(150);
    await click(page, m.cx, m.cy, 700);
    headline(1);
    const count = await tableCount(page);
    await scroll(page, { el: count, at: 0.12 });
    const c = await box(count, { scroll: false });
    const top = await box(await must(page, S.tableTop, "table head"), { scroll: false });
    await cam(region([c, { x: top.x, y: c.y, width: top.width, height: 330 }], 20), { dur: 0.8 });
    await sleep(1700);
  },

  async encaje(page) {
    const row = await must(page, S.row(CONFIG.examples.madrid.row), "row for BDNS 904719");
    await skip(() => scroll(page, { el: row, at: 0.4, ms: 50 }));
    const r = await box(row, { scroll: false });
    headline(0);
    await cam(region({ x: r.x, y: r.y - 90, width: r.width, height: r.height + 180 }, 10), { dur: 0 });
    await glide(page, r.x + 300, r.cy, 600);
    await sleep(TYPE_HOLD - 300);
    await click(page, r.x + 300, r.cy, 150);
    await skip(() => must(page, [{ css: "[role=dialog]" }], "detail sheet"));
    const dlg = await box(await must(page, [{ css: "[role=dialog]" }], "detail sheet"), { scroll: false });
    const sheetX = CONFIG.viewport.width - dlg.width; // where the right-side sheet lands (it is still sliding in now)
    await cam({ ...region({ x: sheetX, y: 0, width: dlg.width, height: 520 }, 0), curtain: sheetX }, { dur: 0.6, wait: false });
    await sleep(500); // sheet slide-in, on camera
    const fit = await box(await must(page, S.drawerFit, "¿Encaja? section"), { scroll: false });
    await cam(region({ x: fit.x, y: fit.y, width: fit.width, height: 70 }, 18), { dur: 0.6 });
    await glide(page, fit.x + 120, fit.y + 30, 400);
    await sleep(700);
    // Pan down the reasons.
    await cam(region({ x: fit.x, y: fit.y + 60, width: fit.width, height: Math.min(fit.height - 60, 260) }, 16), { dur: 0.9 });
    await sleep(1500);
    const estudio = await find(page, S.triageEstudio, { timeout: 3000 });
    if (estudio) {
      headline(1);
      const e = await box(estudio, { scroll: false });
      await cam(region({ x: fit.x, y: e.y - 40, width: fit.width, height: 120 }, 16), { dur: 0.7 });
      await glide(page, e.cx, e.cy, 500);
      await sleep(250);
      await click(page, e.cx, e.cy, 1200);
    } else warn("encaje: «En estudio» not found");
  },

  async seguimiento(page) {
    const card = await must(page, S.boardCard("estudio", CONFIG.examples.madrid.row), "card in En estudio");
    const colA = await box(await must(page, S.boardColumn("estudio"), "En estudio column"), { scroll: false });
    const colB = await box(await must(page, S.boardColumn("presentar"), "A presentar column"), { scroll: false });
    const a = await box(card, { scroll: false });
    headline(0);
    await cam(region([{ ...colA, height: Math.min(colA.height, 420) }, { ...colB, height: Math.min(colB.height, 420) }], 16), { dur: 0 });
    const start = { x: a.cx, y: a.y + 28 };
    const end = { x: colB.cx, y: colB.y + 140 };
    await glide(page, start.x, start.y, 600);
    await sleep(TYPE_HOLD - 300);
    await page.mouse.down();
    ev("click", { x: start.x, y: start.y });
    await glide(page, start.x + 12, start.y + 6, 120, 1);
    await glide(page, end.x, end.y, 1000, 1); // the drag is the moment that matters: real time
    await sleep(150);
    await page.mouse.up();
    ev("drop", { x: end.x, y: end.y });
    await sleep(1500);
  },

  async perfil(page) {
    const btn = await page.evaluateHandle(
      (line, opt) => {
        const rows = [...document.querySelectorAll("main div")].filter((d) => d.innerText.trim().startsWith(line) && d.querySelector("[role=radio]"));
        const row = rows.sort((a, b) => a.innerText.length - b.innerText.length)[0];
        return row ? [...row.querySelectorAll("[role=radio]")].find((r) => r.innerText.trim() === opt) : null;
      },
      S.perfilLine,
      S.perfilOption,
    );
    const el = btn.asElement();
    if (!el) throw new Error(`not found: «${S.perfilOption}» for ${S.perfilLine}`);
    await skip(() => scroll(page, { el, at: 0.45, ms: 50 }));
    const b = await box(el, { scroll: false });
    const rowBox = await page.evaluate((el) => {
      let r = el;
      while (r && r.getBoundingClientRect().width < 500) r = r.parentElement;
      const q = r.getBoundingClientRect();
      return { x: q.x, y: q.y, width: q.width, height: q.height };
    }, el);
    headline(0);
    await cam(region({ ...rowBox, y: rowBox.y - 50, height: rowBox.height + 100 }, 12), { dur: 0 });
    await glide(page, b.cx, b.cy, 700);
    await sleep(TYPE_HOLD - 500);
    await click(page, b.cx, b.cy, 500);
    headline(1);
    await skip(() => sleep(700)); // the effect panel re-lays out after the change
    const eff = await box(await must(page, S.perfilEffect, "Efecto de vuestros ajustes panel"), { scroll: false });
    await cam(region({ ...eff, height: Math.min(eff.height, 340) }, 16), { dur: 0.8 });
    await glide(page, eff.x + eff.width * 0.7, eff.y + 60, 500);
    await sleep(2200);
  },

  async analizar(page) {
    const drop = await box(await must(page, S.pdfDrop, "drop zone"), { scroll: false });
    const sample = await must(page, S.pdfSample, "sample PDF button");
    const s = await box(sample, { scroll: false });
    headline(0);
    await cam(region([{ x: drop.x - 250, y: drop.y - 80, width: drop.width + 500, height: 120 }, s], 24), { dur: 0 });
    await glide(page, s.cx, s.cy, 700);
    await sleep(TYPE_HOLD - 400);
    await click(page, s.cx, s.cy, 300);
    const verdict = await skip(() => find(page, S.pdfVerdict, { timeout: 40000 }));
    if (!verdict) throw new Error("no PDF result after 40 s");
    headline(1);
    await sleep(100);
    const v = await box(verdict, { scroll: false });
    const mot = await box(await must(page, S.pdfMotivos, "Motivos"), { scroll: false });
    await cam(region({ x: v.x, y: v.y - 60, width: 720, height: 180 }, 20), { dur: 0.7 });
    await glide(page, v.x + 300, v.y + 30, 500);
    await sleep(1000);
    await cam(region({ x: mot.x, y: mot.y - 10, width: 720, height: 200 }, 20), { dur: 0.9 });
    await sleep(1500);
  },

  async empresas(page) {
    const k = await box(await must(page, S.empresasCard, "first company card"), { scroll: false });
    headline(0);
    await cam(region(k, 0), { dur: 0 });
    await glide(page, k.x + k.width * 0.55, k.y + k.height * 0.45, 600);
    await sleep(TYPE_HOLD + 1600);
  },
};

const READY = {
  fuentes: S.sourcesTable,
  inicio: S.homeReady,
  semana: S.homeReady,
  mapa: S.homeReady,
  encaje: S.homeReady,
  seguimiento: S.boardReady,
  perfil: S.perfilEffect,
  empresas: S.empresasCard,
  analizar: S.pdfSample,
};

/** Puts a few real calls on the tracking board (the Madrid example is added during "encaje"). */
async function seedBoard(page, withEncaje) {
  let items;
  for (let i = 0; i < 5 && !items; i++) {
    try {
      items = (await (await fetch(CONFIG.baseUrl + CONFIG.apiPath)).json()).items;
    } catch {
      await sleep(3000); // API mid-refresh or dev server recompiling
    }
  }
  if (!items) return warn(`could not seed the board: no data from ${CONFIG.apiPath}`);
  const top = [...items].sort((a, b) => b.fit.score - a.fit.score).filter((o) => o.id !== CONFIG.examples.madrid.id).slice(0, 4);
  const status = ["estudio", "presentar", "presentada", "estudio"];
  const map = {};
  top.forEach((o, i) => (map[o.id] = { status: status[i], at: new Date().toISOString(), titulo: o.titulo, organismo: o.organismo, deadline: o.deadline ?? null }));
  // If "encaje" (which marks it «En estudio» on camera) is not recorded in this run, put the Madrid example on the board.
  const ex = withEncaje ? null : items.find((o) => o.id === CONFIG.examples.madrid.id);
  if (ex) map[ex.id] = { status: "estudio", at: new Date().toISOString(), titulo: ex.titulo, organismo: ex.organismo, deadline: ex.deadline ?? null };
  await page.goto(CONFIG.baseUrl + "/seguimiento", { waitUntil: "domcontentloaded" });
  await page.evaluate((k, v) => localStorage.setItem(k, v), CONFIG.triageStorageKey, JSON.stringify(map));
  log(`  seeded board with ${Object.keys(map).length} calls`);
}

/* ---------- Post-processing: ramps → output timeline, frames → H.264 ---------- */

/** Builds [ {a, b, speed} ] segments in recording time (seconds from first frame). */
function segments(events, t0, tEnd) {
  const segs = [];
  let cur = { a: 0, speed: 1 };
  // The beat starts when its first headline does (lookups before that are cut).
  const begin = (events.find((e) => e.type === "head") ?? events.find((e) => e.type === "begin")).t - t0;
  for (const e of events.filter((e) => e.type === "ramp")) {
    const t = Math.max(0, e.t - t0);
    if (t > cur.a) segs.push({ a: cur.a, b: t, speed: cur.speed });
    cur = { a: t, speed: e.speed };
  }
  segs.push({ a: cur.a, b: tEnd, speed: cur.speed });
  // Drop everything before the start (recorder warm-up, element lookups).
  return segs.map((s) => ({ ...s, a: Math.max(s.a, begin) })).filter((s) => s.b - s.a > 0.02);
}

function mapTime(segs, t) {
  let out = 0;
  for (const s of segs) {
    if (t <= s.a) break;
    const span = Math.min(t, s.b) - s.a;
    if (s.speed !== Infinity) out += span / s.speed;
  }
  return out;
}

function encode(id, take) {
  const frames = take.frames;
  if (frames.length < 2) throw new Error("no frames recorded");
  const t0 = frames[0].ts;
  const tEnd = take.events.at(-1).t - t0;
  const list = path.join(take.dir, "frames.txt");
  const lines = [];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].ts - t0 : tEnd;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - (f.ts - t0)).toFixed(4)}`);
  });
  lines.push(`file '${frames.at(-1).file}'`);
  writeFileSync(list, lines.join("\n"));

  const segs = segments(take.events, t0, tEnd).filter((s) => s.speed !== Infinity);
  const W = CONFIG.viewport.width * CONFIG.deviceScaleFactor;
  const H = CONFIG.viewport.height * CONFIG.deviceScaleFactor;
  const parts = segs.map((s, i) => `[v${i}]trim=start=${s.a.toFixed(4)}:end=${s.b.toFixed(4)},setpts=(PTS-STARTPTS)/${s.speed}[s${i}]`);
  const filter = [
    `[0:v]scale=${W}:${H}:flags=lanczos,fps=${FPS * 2},split=${segs.length}${segs.map((_, i) => `[v${i}]`).join("")}`,
    ...parts,
    `${segs.map((_, i) => `[s${i}]`).join("")}concat=n=${segs.length}:v=1:a=0,fps=${FPS},format=yuv420p[out]`,
  ].join(";");
  const out = path.join(CONFIG.clipDir, `${id}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-filter_complex", filter, "-map", "[out]",
    "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-movflags", "+faststart", out]);
  const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString().trim());

  const allSegs = segments(take.events, t0, tEnd);
  const events = take.events
    .filter((e) => !["ramp", "begin", "end"].includes(e.type))
    .map((e) => ({ ...e, t: Math.round(mapTime(allSegs, e.t - t0) * 1000) / 1000 }));
  const sidecar = { id, duration, viewport: CONFIG.viewport, deviceScaleFactor: CONFIG.deviceScaleFactor, fps: FPS, events };
  writeFileSync(path.join(CONFIG.captureDir, `${id}.json`), JSON.stringify(sidecar, null, 1));
  return { out, duration };
}

/* ------------------------------------------------------------------ */
async function main() {
  const only = process.argv.slice(2);
  const scenes = SCENES.filter((s) => s.kind === "screen" && (only.length === 0 || only.includes(s.id)));
  if (!scenes.length) return log("No matching screen beats.");

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
  mkdirSync(CONFIG.captureDir, { recursive: true });
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
    // A fresh tab per beat (same browser profile, so cookies and the seeded board persist): a tab left with an open
    // sheet could end up with a detached frame and fail every later beat.
    const newPage = async () => {
      const pg = await browser.newPage();
      await pg.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }, { name: "prefers-reduced-motion", value: "no-preference" }]);
      await pg.evaluateOnNewDocument(CURSOR_SCRIPT, CONFIG.hideCss);
      await pg.setCookie(...CONFIG.cookies.map((c) => ({ ...c, url: CONFIG.baseUrl })));
      return pg;
    };
    let page = await newPage();
    await seedBoard(page, scenes.some((s) => s.id === "encaje"));

    for (const scene of scenes) {
      log(`▶ ${scene.id} ${scene.route}`);
      for (let attempt = 1; attempt <= 2; attempt++) {
        take = null;
        await page.close().catch(() => {});
        page = await newPage();
        try {
          mousePos = { x: CONFIG.viewport.width * 0.72, y: CONFIG.viewport.height * 0.7 };
          await goto(page, scene.route, READY[scene.id]);
          take = new Take(page, path.join(CONFIG.captureDir, "raw", scene.id));
          await take.start();
          await ACTIONS[scene.id](page);
          await take.stop();
          const { duration } = encode(scene.id, take);
          ok.push(scene.id);
          log(`  ✓ ${scene.id}.mp4 ${duration.toFixed(2)}s (${take.frames.length} frames)`);
          break;
        } catch (e) {
          if (take) await take.stop().catch(() => {});
          if (attempt === 1) {
            warn(`${scene.id} failed (${e.message}), retrying`);
            await sleep(3000);
            continue;
          }
          failed.push(scene.id);
          warn(`${scene.id} skipped: ${e.message}`);
          rmSync(path.join(CONFIG.clipDir, `${scene.id}.mp4`), { force: true });
          rmSync(path.join(CONFIG.captureDir, `${scene.id}.json`), { force: true });
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
