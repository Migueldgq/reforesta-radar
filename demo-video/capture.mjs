#!/usr/bin/env node
// Records each "screen" scene of the demo from the live app with local Chrome (puppeteer-core).
//
//   node capture.mjs                  # all screen scenes, in order (some continue from the previous page)
//   node capture.mjs perfil analizar  # only these scene ids
//
// Env: BASE_URL (default http://localhost:3000), CHROME_PATH, VIEWPORT (default 1440x810), DSF (default 2), HEADFUL=1.
//
// For every scene it writes:
//   composition/assets/scenes/<id>.mp4  H.264 at native 2x pixels (2880x1620), speed-ramped and trimmed to the action
//   captures/<id>.json                  interaction log in OUTPUT time: clicks, zooms, captions, lower thirds
// compose.mjs turns that log into zooms, click sounds and captions, so they stay in sync after a re-capture.
// A scene that fails is retried once, then skipped with a warning (compose.mjs shows a placeholder).

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
  captureDir: path.join(HERE, "captures"),
  clipDir: path.join(HERE, "composition/assets/scenes"),
  waitTimeout: 20000,
  // Speed-ramps for non-essential motion (output = real time / speed).
  travelSpeed: 2.5,
  scrollSpeed: 3,
  triageStorageKey: "reforesta-radar:seguimiento:v1",
  apiPath: "/api/oportunidades",
  examples: {
    madrid: { id: "bdns:904719", row: /proyectos ambientales 2026/i },
    miteco: { id: "bdns:923290", row: /actividades inter[eé]s general/i },
  },
  sel: {
    homeReady: [{ css: "tbody tr" }],
    landingReady: [{ css: "h1" }],
    mapMadrid: [{ css: "[aria-label^='Comunidad de Madrid']" }, { css: "path", attr: ["aria-label", /Madrid/] }],
    tableTop: [{ css: "main table thead" }, { css: "main table" }],
    statEncajeAlto: [{ css: "main button", text: /^Encaje alto/ }],
    tabProximas: [{ css: "[role=tab]", text: /^Próximas ediciones/ }, { css: "main button", text: /^Próximas ediciones/ }],
    row: (re) => [{ css: "tbody tr", text: re }, { css: "[role=row]", text: re }],
    rowBadge: /^Cerró el/, // inside the row
    drawerFit: [{ css: "[role=dialog] [aria-label='¿Encaja?']" }, { css: "[role=dialog] section", text: /¿Encaja\?/, smallest: true }],
    triageEstudio: [{ css: "[role=dialog] [role=radio]", text: /^En estudio$/ }, { css: "[role=dialog] button", text: /^En estudio$/ }],
    sourcesTable: [{ css: "main table tbody" }, { css: "main table" }],
    boardReady: [{ css: "[data-col]" }],
    boardCard: (col, re) => [{ css: `[data-col='${col}'] [data-slot=card]`, text: re }, { css: `[data-col='${col}'] [data-slot=card]` }],
    boardColumn: (col) => [{ css: `[data-col='${col}']` }],
    perfilLine: "Educación ambiental",
    perfilOption: "Mucho más",
    perfilEffect: [{ css: "main div, main section, main aside", text: /^Efecto de vuestros ajustes/, smallest: true }],
    empresasReady: [{ css: "main h1" }],
    empresasCard: [{ css: "main [data-slot=card]", text: /Santander|Iberdrola|Caixa|Fundaci/ }, { css: "main article" }],
    pdfSample: [{ css: "button", text: /Orden 1689\/2026/ }, { css: "button", text: /BDNS 923290/ }],
    pdfVerdict: [{ css: "[aria-live=polite] *", text: /\d+\s*\/\s*100/, smallest: true }, { css: "main *", text: /\d+\s*\/\s*100/, smallest: true }],
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

/** One scene's recording: CDP screencast frames at native device pixels, plus an event log (wall clock). */
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
const caption = (i) => ev("caption", { i });
const lowerThird = (i) => ev("lower", { i });
const lowerThirdOff = () => ev("lowerOff");

/**
 * Zoom the final video onto viewport point (x, y) while fn runs. With `keep` (a box in viewport px) the scale is
 * capped and the origin shifted so that the whole box stays inside the frame once zoomed.
 */
async function zoom(x, y, scale, fn, keep = null) {
  if (keep) {
    const { width: VWp, height: VHp } = CONFIG.viewport;
    scale = Math.max(1.15, Math.min(scale, (0.97 * VWp) / keep.width, (0.97 * VHp) / keep.height));
    const fit = (p, lo0, hi0, size) => {
      const lo = (scale * hi0 - size) / (scale - 1); // keeps the far edge inside
      const hi = (scale * lo0) / (scale - 1); // keeps the near edge inside
      return lo > hi ? (lo + hi) / 2 : Math.min(Math.max(p, lo), hi);
    };
    x = fit(x, keep.x, keep.x + keep.width, VWp);
    y = fit(y, keep.y, keep.y + keep.height, VHp);
    scale = Math.round(scale * 100) / 100;
  }
  ev("zoomIn", { x, y, scale });
  await sleep(350); // the zoom-in eases over ~0.3 s of output time
  try {
    await fn?.();
  } finally {
    ev("zoomOut");
    await sleep(300);
  }
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

async function clickEl(page, el, { pause = 250, dy = 0 } = {}) {
  const b = await box(el);
  const y = b.y + Math.min(b.height / 2, 22) + dy;
  await glide(page, b.cx, y);
  await click(page, b.cx, y, pause);
}

/** Smooth-scroll the largest scrollable area (inside `rootCss` if given) so `el` (or dy) moves into view. Ramped. */
async function scroll(page, { dy = null, el = null, rootCss = null, ms = 900 } = {}) {
  await ramp(CONFIG.scrollSpeed, () =>
    page.evaluate(
      async (dy, el, rootCss, ms) => {
        const root = rootCss ? document.querySelector(rootCss) : document;
        if (!root) return;
        const cands = [...root.querySelectorAll("*")].filter((e) => {
          const cs = getComputedStyle(e);
          return /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 4;
        });
        if (!rootCss && document.scrollingElement.scrollHeight > innerHeight + 4) cands.push(document.scrollingElement);
        const target = cands.sort((a, b) => b.clientHeight - a.clientHeight)[0];
        if (!target) return;
        if (el) dy = el.getBoundingClientRect().top - innerHeight * 0.35;
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
      rootCss,
      ms,
    ),
  );
  await sleep(120);
}

// Fake cursor (headless Chrome paints none) with a click ripple.
const CURSOR_SCRIPT = (hideCss) => {
  const install = () => {
    if (document.getElementById("__demo_cursor")) return;
    const st = document.createElement("style");
    st.textContent = hideCss + `
      #__demo_cursor{position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;
        transform:translate(-100px,-100px)}
      #__demo_cursor svg{transform-origin:3px 3px;transition:transform 120ms ease;filter:drop-shadow(0 2px 3px rgba(0,0,0,.28))}
      #__demo_cursor.down svg{transform:scale(.86)}
      .__demo_ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;pointer-events:none;
        z-index:2147483646;border:2px solid oklch(0.37 0.07 158);background:oklch(0.37 0.07 158 / .14);
        animation:__demo_rip 520ms cubic-bezier(.2,.7,.3,1) forwards}
      @keyframes __demo_rip{from{transform:scale(.25);opacity:1}to{transform:scale(1.35);opacity:0}}`;
    document.head.appendChild(st);
    const c = document.createElement("div");
    c.id = "__demo_cursor";
    c.innerHTML = `<svg width="30" height="30" viewBox="0 0 22 22"><path d="M3 2 L3 17 L7.2 13.2 L10 19.5 L12.6 18.4 L9.9 12.3 L15.5 12.3 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
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
      setTimeout(() => r.remove(), 600);
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
  await sleep(500); // charts/fonts settle before recording starts
}

/* ------------------------------------------------------------------ */
/* Scenes: `run` executes while recording; READY is awaited before.   */
/* ------------------------------------------------------------------ */
const S = CONFIG.sel;
const ACTIONS = {
  // Cold open: the landing hero's own entrance animation, recorded from navigation.
  async landing(page) {
    await skip(async () => {
      await page.goto(CONFIG.baseUrl + "/landing", { waitUntil: "domcontentloaded" });
      await must(page, S.landingReady, "landing h1");
    });
    caption(0);
    await sleep(3800);
  },

  async fuentes(page) {
    caption(0);
    const t = await must(page, S.sourcesTable, "sources table");
    const b = await box(t, { scroll: false });
    await glide(page, b.x + b.width * 0.42, b.y + 90, 700);
    await zoom(b.x + b.width * 0.42, b.y + 120, 1.45, () => sleep(2000));
  },

  async mapa(page) {
    caption(0);
    await sleep(1100);
    const madrid = await must(page, S.mapMadrid, "Madrid on the map");
    const m = await box(madrid, { scroll: false });
    await glide(page, m.cx, m.cy, 700);
    await zoom(m.cx, m.cy, 1.8, async () => {
      await sleep(250);
      await click(page, m.cx, m.cy, 700);
    });
    caption(1);
    const top = await must(page, S.tableTop, "table");
    await scroll(page, { el: top });
    const tb = await box(top, { scroll: false });
    await zoom(tb.x + tb.width * 0.35, tb.y + 140, 1.4, () => sleep(1900));
  },

  async encaje(page) {
    caption(0);
    const card = await must(page, S.statEncajeAlto, "Encaje alto stat card");
    const c = await box(card, { scroll: false });
    await glide(page, c.cx, c.cy, 700);
    await zoom(c.cx, c.cy, 1.9, async () => {
      await sleep(1700);
      await click(page, c.cx, c.cy, 500);
    });
    caption(1);
    const tab = await must(page, S.tabProximas, "Próximas ediciones tab");
    const tbx = await box(tab);
    await glide(page, tbx.cx, tbx.cy, 700);
    await zoom(tbx.cx, tbx.cy, 1.6, async () => {
      await sleep(200);
      await click(page, tbx.cx, tbx.cy, 900);
    });
  },

  async ejemplos(page) {
    const row = await must(page, S.row(CONFIG.examples.madrid.row), "row for BDNS 904719");
    await scroll(page, { el: row });
    const badge = await find(page, [{ css: "*", text: S.rowBadge, smallest: true }], { root: row, timeout: 2000 });
    caption(0);
    lowerThird(0);
    if (badge) {
      const b = await box(badge, { scroll: false });
      await glide(page, b.cx, b.cy + 26, 700);
      await zoom(b.cx, b.cy, 1.9, () => sleep(1700));
    } else warn("ejemplos: no «Cerró el…» badge in the row");
    lowerThirdOff();
    await clickEl(page, row, { pause: 200 });
    await skip(() => must(page, [{ css: "[role=dialog]" }], "detail sheet"));
    await skip(() => sleep(450)); // sheet slide-in
    caption(1);
    const fit = await must(page, S.drawerFit, "¿Encaja? section");
    const f = await box(fit, { scroll: false });
    await glide(page, f.x + 60, f.y + 40, 600);
    await zoom(f.x, f.y, 1.6, () => sleep(3000), { x: f.x - 8, y: f.y - 8, width: f.width + 16, height: Math.min(f.height, 340) });
    const estudio = await find(page, S.triageEstudio, { timeout: 3000 });
    if (estudio) {
      caption(2);
      const e = await box(estudio);
      await glide(page, e.cx, e.cy, 600);
      await zoom(e.cx, e.cy, 1.7, async () => {
        await sleep(150);
        await click(page, e.cx, e.cy, 800);
      });
    }
    await page.keyboard.press("Escape");
    await skip(() => sleep(450));
    const other = await find(page, S.row(CONFIG.examples.miteco.row), { timeout: 3000 });
    if (other) {
      caption(3);
      lowerThird(1);
      const o = await box(other, { scroll: false });
      await glide(page, o.x + o.width * 0.3, o.cy, 600);
      await zoom(o.x + o.width * 0.3, o.cy, 1.6, () => sleep(2000));
      lowerThirdOff();
    } else warn("ejemplos: row for BDNS 923290 not found");
  },

  async seguimiento(page) {
    caption(0);
    await sleep(500);
    const card = await must(page, S.boardCard("estudio", CONFIG.examples.madrid.row), "card in En estudio");
    const target = await must(page, S.boardColumn("presentar"), "A presentar column");
    const a = await box(card, { scroll: false });
    const tb = await box(target, { scroll: false });
    const start = { x: a.cx, y: a.y + 28 };
    const end = { x: tb.cx, y: tb.y + 120 };
    await glide(page, start.x, start.y, 600);
    const span = { x: a.x - 10, y: Math.min(a.y, tb.y) - 10, width: tb.x + tb.width - a.x + 20, height: a.height + 140 };
    await zoom((start.x + end.x) / 2, (start.y + end.y) / 2, 1.35, async () => {
      await page.mouse.down();
      ev("click", { x: start.x, y: start.y });
      await glide(page, start.x + 12, start.y + 6, 120, 1);
      await glide(page, end.x, end.y, 1100, 1); // the drag is the moment that matters: real time
      await sleep(150);
      await page.mouse.up();
      ev("click", { x: end.x, y: end.y, soft: true });
      await sleep(1400);
    }, span);
  },

  async perfil(page) {
    caption(0);
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
    const b = await box(el);
    await glide(page, b.cx, b.cy, 700);
    await zoom(b.cx - 120, b.cy, 1.6, async () => {
      await sleep(400);
      await click(page, b.cx, b.cy, 500);
    });
    caption(1);
    const eff = await must(page, S.perfilEffect, "Efecto de vuestros ajustes panel");
    const e = await box(eff, { scroll: false });
    await glide(page, e.x + e.width * 0.6, e.y + 90, 600);
    await zoom(e.x, e.y, 1.6, () => sleep(2900), { x: e.x - 8, y: e.y - 8, width: e.width + 16, height: Math.min(e.height, 380) });
  },

  async empresas(page) {
    caption(0);
    await sleep(700);
    const firstCard = await find(page, S.empresasCard, { timeout: 3000 });
    if (firstCard) {
      const k = await box(firstCard, { scroll: false });
      await glide(page, k.x + k.width * 0.3, k.y + 40, 600);
      await zoom(k.x, k.y, 1.5, () => sleep(1600), { x: k.x - 8, y: k.y - 8, width: k.width + 16, height: Math.min(k.height, 300) + 16 });
    }
    await scroll(page, { dy: 520, ms: 1200 });
    await sleep(600);
  },

  async analizar(page) {
    caption(0);
    const sample = await must(page, S.pdfSample, "sample PDF button");
    const s = await box(sample);
    await glide(page, s.cx, s.cy, 700);
    await zoom(s.cx, s.cy, 1.6, async () => {
      await sleep(200);
      await click(page, s.cx, s.cy, 300);
    });
    const verdict = await skip(() => find(page, S.pdfVerdict, { timeout: 40000 }));
    if (!verdict) throw new Error("no PDF result after 40 s");
    caption(1);
    await sleep(300);
    const v = await box(verdict);
    await zoom(v.x, v.y, 1.7, () => sleep(3000), { x: v.x - 30, y: v.y - 40, width: 820, height: 360 });
  },
};

const READY = {
  fuentes: S.sourcesTable,
  mapa: S.homeReady,
  encaje: S.homeReady,
  seguimiento: S.boardReady,
  perfil: S.perfilEffect,
  empresas: S.empresasReady,
  analizar: S.pdfSample,
};

/** Puts a few real calls on the tracking board (the Madrid example is added during "ejemplos"). */
async function seedBoard(page, withEjemplos) {
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
  // If "ejemplos" (which marks it «En estudio» on camera) is not recorded in this run, put the Madrid example on the board.
  const ex = withEjemplos ? null : items.find((o) => o.id === CONFIG.examples.madrid.id);
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
  const begin = events.find((e) => e.type === "begin").t - t0;
  for (const e of events.filter((e) => e.type === "ramp")) {
    const t = Math.max(0, e.t - t0);
    if (t > cur.a) segs.push({ a: cur.a, b: t, speed: cur.speed });
    cur = { a: t, speed: e.speed };
  }
  segs.push({ a: cur.a, b: tEnd, speed: cur.speed });
  // Drop everything before "begin" (the recorder warm-up).
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
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }, { name: "prefers-reduced-motion", value: "no-preference" }]);
    await page.evaluateOnNewDocument(CURSOR_SCRIPT, CONFIG.hideCss);
    await seedBoard(page, scenes.some((s) => s.id === "ejemplos"));

    for (const scene of scenes) {
      log(`▶ ${scene.id} ${scene.route ?? "(same page)"}`);
      for (let attempt = 1; attempt <= 2; attempt++) {
        take = null;
        try {
          mousePos = { x: CONFIG.viewport.width * 0.78, y: CONFIG.viewport.height * 0.62 };
          // A scene with route null continues the previous page; when run alone, rebuild that state.
          if (scene.route === null && (only.length || attempt > 1)) {
            await goto(page, "/?tier=alto&cerradas=1", S.homeReady);
          } else if (scene.route && scene.id !== "landing") {
            await goto(page, scene.route, READY[scene.id]);
          }
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
      if (scene.id !== "encaje") await page.keyboard.press("Escape").catch(() => {});
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
