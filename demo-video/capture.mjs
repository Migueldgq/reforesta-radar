#!/usr/bin/env node
// Records each "screen" beat of the demo from the live app with local Chrome (puppeteer-core).
//
//   node capture.mjs                  # all screen beats, in order
//   node capture.mjs perfil analizar  # only these beat ids
//
// Env: BASE_URL (default http://localhost:3010), DEMO_ACCOUNTS (see demo-data.mjs), CHROME_PATH, VIEWPORT (default 1440x810), DSF (default 2), HEADFUL=1.
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
import { BASE_URL, ON_CAMERA, demoPeople, login, seed } from "./demo-data.mjs";
import { FPS, SCENES } from "./scenes.mjs";
import { TIMING, durations, lines as voiceLines } from "./voice-lines.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* CONFIG — every selector and app-specific detail lives here.        */
/* A selector is a list of alternatives, tried in order:              */
/*   { css, text?: RegExp, attr?: [name, RegExp], smallest?: true }   */
/* `text` matches visible text; `smallest` picks the tightest match.  */
/* ------------------------------------------------------------------ */
const [VW, VH] = (process.env.VIEWPORT ?? "1440x810").split("x").map(Number);
const CONFIG = {
  baseUrl: BASE_URL, // demo-data.mjs: BASE_URL, default http://localhost:3010 (the Docker web: production build, no dev badge)
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
  // Dialogs open over a white veil instead of the dark one: the page behind fades out like the film's canvas.
  // The side sheet opens without its slide and dimming overlay: the composition hides the list behind it with a white
  // curtain that rides the camera move, and a sliding edge would open a gap next to it.
  hideCss: `nextjs-portal{display:none!important} *::-webkit-scrollbar{display:none} *{scrollbar-width:none} [data-slot=sheet-overlay]{background:transparent!important} [data-slot=sheet-content]{animation:none!important} [data-slot=dialog-overlay]{background:rgb(255 255 255 / .9)!important}`,
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
  // Saved UI state that would filter the lists: cleared before every page load so each beat starts unfiltered.
  clearStorageKeys: ["reforesta-radar:organismos:v1"],
  apiPath: "/api/oportunidades",
  mcpPath: "/mcp",
  examples: {
    // The best call: score 100, already won by Reforesta (its detail shows the past editions).
    won: { id: "bdns:904719", row: /proyectos ambientales 2026/i },
    // Looks right (Madrid, forests) but the past awards went to companies: the score says so.
    companies: { id: "bdns:930968" },
    // Marked, voted, assigned and annotated on camera (demo-data.mjs resets it before every capture).
    team: { id: ON_CAMERA },
    company: /Fundación Unicaja/,
    // A real public PDF of a call that is in the radar (BDNS 923290, MITECO): the app gives it the list's own score.
    pdf: path.join(HERE, "../data/samples/miteco-convocatoria-923290.pdf"),
    // Invited on camera (fictional; the invitation is revoked by `demo-data.mjs cleanup`).
    invite: { email: "nuria@example.org", name: "Nuria Campos" },
  },
  // What the assistant beat asks the radar (real tool calls against /mcp, public tools, no token).
  mcp: {
    question: "¿Qué convocatoria de Madrid ya hemos ganado y cuándo suele abrir?",
    search: { texto: "ambiental", territorio: "Madrid", encaje_minimo: 60 },
  },
  sel: {
    homeTitle: [{ css: "main h1", text: /^Convocatorias$/ }],
    homeSub: [{ css: "main p, main div", text: /^\d+ oportunidades de \d+ fuentes/, smallest: true }],
    statTiles: [{ css: "main button", text: /^Abiertas ahora/ }, { css: "main button", text: /^Próximas ediciones\n\d+\n/ }],
    notice: [{ css: "main [role=status]", text: /^Ahora mismo no hay convocatorias abiertas/ }],
    tableTop: [{ css: "main table thead" }, { css: "main table" }],
    row: (re) => [{ css: "tbody tr", text: re }, { css: "[role=row]", text: re }],
    dialog: [{ css: "[role=dialog]" }],
    drawerFit: [{ css: "[role=dialog] [aria-label='¿Encaja?']" }],
    drawerHist: [{ css: "[role=dialog] [aria-labelledby=hist-h]" }],
    drawerHistRows: [{ css: "[role=dialog] [aria-label='Ediciones anteriores en BDNS']" }],
    triage: [{ css: "[role=dialog] [aria-labelledby=triage-h]" }],
    triageEstudio: [{ css: "[role=dialog] [role=radio]", text: /^En estudio$/ }],
    votes: [{ css: "[role=dialog] section[aria-labelledby=vote-h]" }],
    voteYes: [{ css: "[role=dialog] [aria-labelledby=vote-h] button", text: /Nos sirve$/ }],
    assignee: [{ css: "[role=dialog] [aria-labelledby=assignee-h][role=combobox]" }, { css: "[role=dialog] button[aria-labelledby=assignee-h]" }],
    assigneeOption: (name) => [{ css: "[role=option]", text: new RegExp(`^${name}$`) }],
    notes: [{ css: "[role=dialog] section[aria-labelledby=notes-h]" }],
    noteInput: [{ css: "[role=dialog] textarea" }],
    noteAdd: [{ css: "[role=dialog] button", text: /^Añadir nota$/ }],
    boardReady: [{ css: "[data-col]" }],
    boardCard: (col, re) => [{ css: `[data-col='${col}'] [data-slot=card]`, text: re }, { css: `[data-col='${col}'] [data-slot=card]` }],
    boardColumn: (col) => [{ css: `[data-col='${col}']` }],
    empresasCard: (re) => [{ css: "main [data-slot=card]", text: re }, { css: "main article", text: re }],
    sourcesSummary: [{ css: "main p", text: /^\d+ fuentes · \d+ convocatorias/ }],
    sourcesTable: [{ css: "main table" }],
    sourcesHeader: [{ css: "main header" }],
    ingestNow: [{ css: "main button", text: /^Actualizar ahora$/ }],
    pdfPick: [{ css: "main button", text: /^Elegir archivo$/ }],
    pdfDrop: [{ css: "main [data-slot=card]", text: /^Arrastra un PDF/ }],
    pdfScore: [{ css: "main [data-slot=badge]", text: /^\d+\s*\/100$/ }],
    pdfSame: [{ css: "main p", text: /^Es la nota del radar/ }],
    pdfMotivos: [{ css: "main section", text: /^Motivos/ }],
    teamPeople: [{ css: "main section[aria-labelledby=people-h]" }],
    teamLinks: [{ css: "main section[aria-labelledby=inv-h]" }],
    teamInvite: [{ css: "main button", text: /^Invitar$/ }],
    inviteEmail: [{ css: "[role=dialog] input[type=email]" }],
    inviteName: [{ css: "[role=dialog] input:not([type=email])" }],
    inviteCreate: [{ css: "[role=dialog] button", text: /^Crear invitación$/ }],
    inviteReady: [{ css: "[role=dialog]", text: /^Invitación lista/ }],
    inviteDone: [{ css: "[role=dialog] button", text: /^Hecho$/ }],
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

/* ---------- Narration: the voice times the beat ---------- */
// Line k of the current beat starts TIMING.lead after `say(k)` (the first no earlier than TIMING.first into the beat);
// `say(k+1)` first waits, in OUTPUT time, until line k has finished plus TIMING.gap. Durations come from the voice files
// (voice-lines.mjs); compose.mjs places the lines with the same rules and holds the picture if a new voice runs longer.
let VOICE = {}; // name → seconds
let beatVoice = []; // the current beat's line names
let vcur = null; // { k, t } the line playing (output seconds)
const voiceMs = (k) => (VOICE[beatVoice[k]] ?? 0) * 1000;
/** Output seconds since the beat began (ramps applied, cuts removed). */
function outNow() {
  const t0 = take.events[0].t;
  const tn = now() - t0;
  return mapTime(segments(take.events, t0, tn), tn);
}
async function voiceWait(after = TIMING.gap) {
  if (!vcur) return;
  const start = vcur.k === 0 ? Math.max(TIMING.first, vcur.t + TIMING.lead) : vcur.t + TIMING.lead;
  const remain = start + voiceMs(vcur.k) / 1000 + after - outNow();
  if (remain > 0) await sleep(remain * 1000);
}
async function say(k) {
  if (k >= beatVoice.length) throw new Error(`say(${k}): this beat has ${beatVoice.length} voice line(s) in scenes.mjs`);
  await voiceWait();
  ev("say", { k });
  vcur = { k, t: outNow() };
}

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

/**
 * Smooth-scroll the page's main scroller by dy (or so that `el` sits at `at` of the viewport height). Ramped.
 * `within` (CSS) limits the search for the scroller to that element, e.g. the open side sheet.
 */
async function scroll(page, { dy = null, el = null, at = 0.3, ms = 900, within = null, speed = CONFIG.scrollSpeed } = {}) {
  await ramp(speed, () =>
    page.evaluate(
      async (dy, el, at, ms, within) => {
        const scope = within ? document.querySelector(within) : document;
        const cands = [...scope.querySelectorAll("*")].filter((e) => {
          const cs = getComputedStyle(e);
          return /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 4;
        });
        if (!within && document.scrollingElement.scrollHeight > innerHeight + 4) cands.push(document.scrollingElement);
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
      within,
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

// Privacy: the database may hold real people's accounts. Every API response the page reads goes through this filter
// before the app sees it, so only the demo team (@example.org, ids in `allowed`) can ever be rendered: people,
// invitations and resets of anyone else are dropped, notes and votes by anyone else are dropped, and an assignee or
// "…By" field pointing at anyone else becomes empty. The app and the database are not touched.
const PRIVACY_SCRIPT = (allowed, names) => {
  const ok = new Set(allowed);
  const okName = new Set(names);
  const other = (v) => v && typeof v === "object" && typeof v.id === "number" && !ok.has(v.id);
  const drop = (v) =>
    v && typeof v === "object" && !Array.isArray(v) &&
    ((typeof v.email === "string" && !/@example\.org$/i.test(v.email)) ||
      (typeof v.id === "number" && typeof v.name === "string" && "active" in v && !ok.has(v.id)) ||
      (typeof v.userId === "number" && !ok.has(v.userId)) ||
      other(v.user) || other(v.author));
  const clean = (v) => {
    if (Array.isArray(v)) return v.filter((x) => !drop(x)).map(clean);
    if (!v || typeof v !== "object") return v;
    for (const k of Object.keys(v)) {
      if (k === "assignee" || /By$/.test(k)) {
        const x = v[k];
        if (other(x) || (typeof x === "number" && !ok.has(x)) || (typeof x === "string" && !okName.has(x))) v[k] = null;
      } else v[k] = clean(v[k]);
    }
    return v;
  };
  const orig = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await orig(...args);
    const url = String(args[0]?.url ?? args[0]);
    if (!/\/api\//.test(url) || !(res.headers.get("content-type") ?? "").includes("json")) return res;
    const body = clean(await res.clone().json());
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(JSON.stringify(body), { status: res.status, statusText: res.statusText, headers });
  };
};

/** Fails the beat if any e-mail address on the page (text or form values) is not a demo one. Prints only a count. */
async function assertOnlyDemoEmails(page) {
  const bad = await page.evaluate(() => {
    const text = document.body.innerText + " " + [...document.querySelectorAll("input, textarea")].map((e) => e.value).join(" ");
    return (text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []).filter((e) => !/@example\.org$/i.test(e)).length;
  });
  if (bad) throw new Error(`privacy: ${bad} non-demo e-mail address(es) on the page`);
}

async function goto(page, route, readySpecs) {
  await page.goto(CONFIG.baseUrl + route, { waitUntil: "networkidle2", timeout: 60000 });
  if (readySpecs) await must(page, readySpecs, `ready marker for ${route}`, { timeout: 45000 });
  await page.mouse.move(mousePos.x, mousePos.y);
  await sleep(600); // charts/fonts settle before recording starts
}

/* ------------------------------------------------------------------ */
/* Beats: `run` executes while recording; READY is awaited before.    */
/* Each starts with headline(0), say(0) and a camera target; say(k)   */
/* marks where voice line k starts and holds for the previous line.  */
/* ------------------------------------------------------------------ */
const S = CONFIG.sel;

const DIALOG = "[role=dialog]";

/** The right-side sheet: its left edge (where the white curtain stops) once it has slid in. */
async function sheet(page) {
  const d = await box(await must(page, S.dialog, "detail sheet"), { scroll: false });
  return { ...d, left: CONFIG.viewport.width - d.width };
}

/** A box for the element whose text matches `re` inside `root` (smallest match). */
async function textBox(page, re, what, root = "main") {
  return box(await must(page, [{ css: `${root} *`, text: re, smallest: true }], what), { scroll: false });
}

const ACTIONS = {
  async inicio(page) {
    // The page opens scrolled just past its header (PREPARE): the four tiles, the charts, then the list.
    const a = await box(await must(page, [S.statTiles[0]], "Abiertas ahora tile"), { scroll: false });
    const d = await box(await must(page, [S.statTiles[1]], "Próximas ediciones tile"), { scroll: false });
    headline(0);
    await say(0);
    await cam(region([a, d], 28), { dur: 0 });
    await glide(page, a.x + a.width * 0.5, a.cy + 10, 900, 1.4);
    await sleep(900);
    await glide(page, d.x + d.width * 0.45, d.cy + 10, 1400, 1.4);
    // Line 1: the same list by work line and by territory (the charts filter it when pressed).
    // the charts card sits between the tiles and «Más gráficos» (a filter chip further down has the same label)
    const more = await textBox(page, /^Más gráficos$/, "Más gráficos");
    const top = a.y + a.height + 12;
    await say(1);
    headline(1);
    await cam(region({ x: a.x, y: top, width: d.x + d.width - a.x, height: more.y - top - 4 }, 12), { dur: 0.8 });
    await glide(page, a.x + 220, top + 70, 800, 1.4);
    await sleep(700);
    await glide(page, d.x + d.width * 0.1, top + 200, 1300, 1.4);
    // Line 2: the honest notice and the top of the ranked list.
    const notice = await must(page, S.notice, "quiet notice");
    await say(2);
    headline(2);
    await scroll(page, { el: notice, at: 0.16, ms: 900 });
    const n = await box(notice, { scroll: false });
    const r = await box(await must(page, S.row(CONFIG.examples.won.row), "first row"), { scroll: false });
    await cam(region([n, { ...r, height: r.height + 60 }], 20), { dur: 0.8 });
    await glide(page, n.x + n.width * 0.45, n.cy, 700, 1.4);
  },

  async ganasteis(page) {
    const row = await must(page, S.row(CONFIG.examples.won.row), "row of the call Reforesta already won");
    await skip(() => scroll(page, { el: row, at: 0.45, ms: 50 }));
    const r = await box(row, { scroll: false });
    headline(0);
    await say(0);
    await cam(region({ x: r.x, y: r.y - 30, width: r.width, height: r.height + 60 }, 10), { dur: 0 });
    await glide(page, r.x + 320, r.cy, 1000, 1.4);
    // Line 1: open it — the score and its reasons.
    await say(1);
    headline(1);
    await click(page, r.x + 320, r.cy, 150);
    await skip(() => must(page, S.drawerFit, "detail sheet"));
    const sh = await sheet(page);
    await cam({ ...region({ x: sh.left, y: 0, width: sh.width, height: 460 }, 0), curtain: sh.left }, { dur: 0.6, wait: false });
    await sleep(700);
    const fit = await box(await must(page, S.drawerFit, "¿Encaja? section"), { scroll: false });
    await cam(region({ x: fit.x, y: fit.y, width: fit.width, height: Math.min(fit.height, 330) }, 18), { dur: 0.7 });
    await glide(page, fit.x + 260, fit.y + 120, 700, 1.4);
    await sleep(600);
    await glide(page, fit.x + 300, fit.y + 230, 900, 1.4);
    // Line 2: the past editions — who won it (Reforesta included).
    const hist = await must(page, S.drawerHist, "Ediciones anteriores");
    await say(2);
    headline(2);
    await cam({ ...region({ x: sh.left, y: 120, width: sh.width, height: 560 }, 0), curtain: sh.left }, { dur: 0.7, wait: false });
    await scroll(page, { el: hist, at: 0.3, ms: 900, within: DIALOG });
    await sleep(300);
    const h = await box(hist, { scroll: false });
    const cuando = await textBox(page, /^Cuándo abre$/, "Cuándo abre", DIALOG);
    // The strongest fact: a closer push than the usual 2x limit (slightly upscaled, on purpose).
    await cam(region({ x: h.x, y: h.y, width: h.width, height: cuando.y - h.y - 4 }, 14), { dur: 0.9, max: 2.5 });
    await glide(page, h.x + h.width * 0.93, h.y + 52, 700, 1.4);
    // Line 3: when it opens, how long it stays open, who wins it.
    const quien = await textBox(page, /^Quién la ganó$/, "Quién la ganó", DIALOG);
    const rows = await box(await must(page, S.drawerHistRows, "editions list"), { scroll: false });
    await say(3);
    await cam(region({ x: h.x, y: cuando.y, width: h.width, height: rows.y - cuando.y - 6 }, 14), { dur: 0.9 });
    await glide(page, h.x + h.width * 0.55, cuando.y + 36, 700, 1.4);
    await sleep(Math.max(0, voiceMs(3) * 0.45));
    await glide(page, h.x + h.width * 0.62, quien.y + 40, 900, 1.4);
  },

  async motivos(page) {
    const sh = await sheet(page);
    const fit = await box(await must(page, S.drawerFit, "¿Encaja? section"), { scroll: false });
    log(`  motivos: score shown «${await page.evaluate((el) => el.innerText.split("\n").slice(0, 3).join(" · "), await must(page, S.drawerFit, "fit"))}»`);
    headline(0);
    await say(0);
    // Line 0: what looks right (Madrid, forestry), then the warning that pulls it down.
    await cam({ ...region({ x: fit.x, y: fit.y, width: fit.width, height: 210 }, 18), curtain: sh.left }, { dur: 0 });
    await glide(page, fit.x + 330, fit.y + 150, 900, 1.4);
    await sleep(Math.max(400, voiceMs(0) * 0.3));
    const w1 = await textBox(page, /^Fecha de cierre estimada/, "estimated-date warning", DIALOG);
    const w2 = await textBox(page, /^Ninguna de las \d+ ayudas anteriores|^Solo \d+ de \d+ ayudas anteriores/, "companies warning", DIALOG);
    await cam(region([{ ...w1, x: fit.x, width: fit.width }, { ...w2, x: fit.x, width: fit.width }], 18), { dur: 0.8 });
    await glide(page, w2.x + w2.width * 0.5, w2.cy, 800, 1.4);
    // Line 1: the score, and rules, not a black box — every reason and warning at once.
    await say(1);
    headline(1);
    await cam(region({ x: fit.x, y: fit.y, width: fit.width, height: w2.y + w2.height - fit.y }, 18), { dur: 0.9 });
    await glide(page, fit.x + 70, fit.y + 40, 900, 1.4);
    await sleep(Math.max(400, voiceMs(1) * 0.3));
    await glide(page, fit.x + fit.width * 0.75, fit.y + 120, 900, 1.4);
  },

  async empresas(page) {
    // Line 0: the page says it in its own words — checked by hand, each card dated.
    const intro = await box(await must(page, [{ css: "main p", text: /^Esta lista no es automática/ }], "manual-list note"), { scroll: false });
    const title = await box(await must(page, [{ css: "main h1" }], "page title"), { scroll: false });
    const card = await must(page, S.empresasCard(CONFIG.examples.company), "Fundación Unicaja card");
    headline(0);
    await say(0);
    await cam(region([title, intro], 24), { dur: 0 });
    await glide(page, intro.x + intro.width * 0.55, intro.cy + 4, 900, 1.4);
    // Line 1: one programme — its deadline and what limits it.
    await say(1);
    headline(1);
    await skip(() => scroll(page, { el: card, at: 0.06, ms: 50 }));
    const k = await box(card, { scroll: false });
    const lim = await textBox(page, /^Qué lo limita$/, "Qué lo limita");
    const last = await textBox(page, /^Último plazo$/, "Último plazo");
    await cam(region({ x: k.x, y: k.y, width: k.width, height: last.y + 60 - k.y }, 10), { dur: 0 });
    await glide(page, k.x + k.width * 0.55, last.y + 30, 900, 1.4);
    await sleep(Math.max(0, voiceMs(1) * 0.35));
    // Closer on the right column (deadline + limits); the curtain hides the left column so no half-words show.
    await cam({ ...region({ x: lim.x, y: last.y - 4, width: k.x + k.width - lim.x - 12, height: lim.y + 96 - last.y }, 14), curtain: lim.x - 20 }, { dur: 0.8 });
    await glide(page, lim.x + 300, lim.y + 92, 700, 1.4); // under the text, not on it
    // Line 2: the card's own check date.
    const checked = await textBox(page, /^Comprobado el /, "Comprobado el");
    await say(2);
    await cam({ ...region({ x: k.x, y: checked.y - 150, width: k.width, height: 200 }, 12), curtain: false }, { dur: 0.9 });
    await glide(page, checked.x + checked.width + 40, checked.cy + 18, 800, 1.4);
  },

  async equipo(page) {
    const sh = await sheet(page);
    const triage = await must(page, S.triage, "Vuestra decisión");
    await skip(() => scroll(page, { el: triage, at: 0.36, ms: 50, within: DIALOG }));
    const tr = await box(triage, { scroll: false });
    const votes = await box(await must(page, S.votes, "votes"), { scroll: false });
    const x = sh.left + 20;
    const w = sh.width - 40;
    headline(0);
    await say(0);
    await cam({ ...region({ x, y: tr.y - 34, width: w, height: votes.y + votes.height - tr.y + 34 }, 10), curtain: sh.left }, { dur: 0 });
    const est = await box(await must(page, S.triageEstudio, "En estudio"), { scroll: false });
    await glide(page, est.cx, est.cy, 1000, 1.4);
    await sleep(Math.max(300, voiceMs(0) * 0.45));
    await click(page, est.cx, est.cy, 600);
    await say(1);
    headline(1);
    const yes = await box(await must(page, S.voteYes, "Nos sirve"), { scroll: false });
    await glide(page, yes.cx, yes.cy, 800, 1.4);
    await sleep(500);
    await click(page, yes.cx, yes.cy, 900);
    // Line 2: assign and leave a note.
    const asg = await must(page, S.assignee, "Responsable");
    await say(2);
    headline(2);
    await scroll(page, { el: asg, at: 0.36, ms: 700, within: DIALOG });
    const a = await box(asg, { scroll: false });
    const notes = await box(await must(page, S.notes, "Notas"), { scroll: false });
    await cam(region({ x, y: a.y - 34, width: w, height: notes.y + notes.height - a.y + 34 }, 10), { dur: 0.7 });
    await glide(page, a.x + 120, a.cy, 500, 1.4);
    await sleep(150);
    // The open list is cut from the film: it names every account in the database, and the only one we may show is
    // the demo team. Picked with the keyboard, so the pointer does not jump; the click sound lands on the cut.
    await skip(async () => {
      await click(page, a.x + 120, a.cy, 350);
      await must(page, S.assigneeOption(DEMO_TEAM.assignee), "assignee option");
      await page.keyboard.type(DEMO_TEAM.assignee.split(" ")[0], { delay: 40 });
      await page.keyboard.press("Enter");
      await sleep(450); // list closed and its fade-out finished
      if (!(await page.evaluate((el) => el.innerText, asg)).includes(DEMO_TEAM.assignee)) throw new Error("assignee not set");
    });
    await sleep(400);
    const ta = await box(await must(page, S.noteInput, "note box"), { scroll: false });
    await glide(page, ta.x + 160, ta.y + 22, 500, 1.4);
    await click(page, ta.x + 160, ta.y + 22, 150);
    await ramp(1.6, () => page.keyboard.type(DEMO_TEAM.note, { delay: 38 }));
    await sleep(200);
    const add = await box(await must(page, S.noteAdd, "Añadir nota"), { scroll: false });
    await glide(page, add.cx, add.cy, 500, 1.4);
    await click(page, add.cx, add.cy, 900);
  },

  async fuentes(page) {
    const sum = await box(await must(page, S.sourcesSummary, "sources summary"), { scroll: false });
    const t = await box(await must(page, S.sourcesTable, "sources table"), { scroll: false });
    headline(0);
    await say(0);
    // The whole table (name, state, results, note), then slowly down through the seven sources while they are named.
    await cam(region({ x: t.x, y: sum.y, width: t.width, height: 400 }, 20), { dur: 0 });
    await glide(page, t.x + t.width * 0.2, t.y + 64, 700, 1.4);
    await sleep(1200);
    await scroll(page, { dy: 640, ms: Math.max(2500, voiceMs(0) * 0.55), speed: 1 });
    // Line 1: per source, its results and how the last load went.
    await say(1);
    await scroll(page, { dy: -2000, ms: 900 });
    const t2 = await box(await must(page, S.sourcesTable, "sources table"), { scroll: false });
    const st = await textBox(page, /^Estado$/, "Estado header");
    await cam(region({ x: t.x, y: t2.y, width: t.width, height: 330 }, 16), { dur: 0.8 });
    await glide(page, st.x + 30, t2.y + 70, 800, 1.4);
    // Line 2: the admin's «Actualizar ahora»: hovered, never pressed (an ingest would change the data).
    await say(2);
    headline(1);
    const hd = await box(await must(page, S.sourcesHeader, "header"), { scroll: false });
    const b = await box(await must(page, S.ingestNow, "Actualizar ahora"), { scroll: false });
    await cam(region({ x: hd.x, y: hd.y, width: t.width, height: t2.y + 150 - hd.y }, 20), { dur: 0.8 });
    await glide(page, b.cx, b.cy, 1000, 1.4);
  },

  async analizar(page) {
    const hd = await box(await must(page, [{ css: "main header" }], "header"), { scroll: false });
    const drop = await box(await must(page, S.pdfDrop, "drop zone"), { scroll: false });
    const pick = await box(await must(page, S.pdfPick, "Elegir archivo"), { scroll: false });
    headline(0);
    await say(0);
    await cam(region([hd, drop], 24), { dur: 0 });
    await glide(page, pick.cx, pick.cy, 1100, 1.4);
    await sleep(Math.max(300, voiceMs(0) * 0.5));
    const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10000 }), click(page, pick.cx, pick.cy, 0)]);
    await chooser.accept([CONFIG.examples.pdf]);
    await sleep(500); // «Leyendo el PDF…» shows for a moment; the rest of the wait is cut
    const score = await skip(() => must(page, S.pdfScore, "PDF score", { timeout: 60000 }));
    await skip(() => sleep(400));
    // Line 1: the radar's own score for this call, then its reasons and warnings.
    const title = await box(await must(page, [{ css: "main [data-slot=card] h2" }], "result title"), { scroll: false });
    const same = await box(await must(page, S.pdfSame, "same-score line"), { scroll: false });
    await say(1);
    headline(1);
    // The text extract under the score line is not part of the shot: the camera stops at the line (`floor`) and the
    // cut to the reasons happens with the extract scrolled out of the page.
    await cam({ ...region({ x: title.x, y: title.y, width: title.width, height: same.y + same.height - title.y }, 20), floor: same.y + same.height + 10 }, { dur: 0.7 });
    const sc = await box(score, { scroll: false });
    await glide(page, sc.x + sc.width + 140, sc.cy + 26, 700, 1.4);
    await sleep(Math.max(1200, voiceMs(1) * 0.45));
    const mot = await must(page, S.pdfMotivos, "Motivos");
    await skip(() => scroll(page, { el: mot, at: 0.02, ms: 50 }));
    const m = await box(mot, { scroll: false });
    await cam(region({ x: title.x, y: m.y, width: title.width, height: Math.min(m.height, 430) }, 18), { dur: 0 });
    await glide(page, title.x + title.width * 0.3, m.y + 90, 800, 1.4);
  },

  async invitar(page) {
    const ppl = await box(await must(page, S.teamPeople, "Personas"), { scroll: false });
    const inv = await box(await must(page, S.teamInvite, "Invitar"), { scroll: false });
    headline(0);
    await say(0);
    await cam(region(ppl, 20), { dur: 0 });
    await glide(page, inv.cx, inv.cy, 900, 1.4);
    await sleep(500);
    await click(page, inv.cx, inv.cy, 400);
    const dlg = await box(await must(page, S.dialog, "invite dialog"), { scroll: false });
    await cam(region(dlg, 16), { dur: 0.6 });
    const { email, name } = CONFIG.examples.invite;
    const em = await box(await must(page, S.inviteEmail, "e-mail field"), { scroll: false });
    await glide(page, em.x + 140, em.cy, 400);
    await click(page, em.x + 140, em.cy, 150);
    await ramp(1.6, () => page.keyboard.type(email, { delay: 38 }));
    const nm = await box(await must(page, S.inviteName, "name field"), { scroll: false });
    await glide(page, nm.x + 140, nm.cy, 300);
    await click(page, nm.x + 140, nm.cy, 150);
    await ramp(1.6, () => page.keyboard.type(name, { delay: 38 }));
    await sleep(250);
    const cr = await box(await must(page, S.inviteCreate, "Crear invitación"), { scroll: false });
    await glide(page, cr.cx, cr.cy, 400);
    await click(page, cr.cx, cr.cy, 150);
    await skip(() => must(page, S.inviteReady, "Invitación lista"));
    await sleep(350);
    const rd = await box(await must(page, S.dialog, "link dialog"), { scroll: false });
    await cam(region(rd, 16), { dur: 0.6 });
    // Line 1: one use, seven days.
    await say(1);
    const once = await textBox(page, /Sirve una (sola )?vez/, "one-use note", DIALOG).catch(() => null);
    if (once) await glide(page, once.x + once.width * 0.6, once.cy + 18, 800, 1.4);
    // Line 2: close it — the people and their roles, with the new invitation pending.
    await say(2);
    headline(1);
    const done = await box(await must(page, S.inviteDone, "Hecho"), { scroll: false });
    await glide(page, done.cx, done.cy, 500);
    await click(page, done.cx, done.cy, 0);
    // The dialog's fade-out briefly shows another title (its text resets as it closes): cut it.
    await skip(() => sleep(450));
    const p2 = await box(await must(page, S.teamPeople, "Personas"), { scroll: false });
    const links = await box(await must(page, S.teamLinks, "Enlaces pendientes"), { scroll: false });
    await cam(region([p2, links], 20), { dur: 0.8 });
    await glide(page, p2.x + p2.width * 0.62, p2.y + 120, 900, 1.4);
  },

  async seguimiento(page) {
    const colA = await box(await must(page, S.boardColumn("estudio"), "En estudio column"), { scroll: false });
    const colB = await box(await must(page, S.boardColumn("presentar"), "A presentar column"), { scroll: false });
    const colD = await box(await must(page, S.boardColumn("descartada"), "Descartada column"), { scroll: false });
    // The call marked on camera if it is in view, else the second card of the column.
    let card = await find(page, [{ css: "[data-col='estudio'] [data-slot=card]", text: /F\.S\.P\./ }], { timeout: 1500 });
    if (card && (await box(card, { scroll: false })).y > 560) card = null;
    card ??= await must(page, [{ css: "[data-col='estudio'] [data-slot=card]" }], "card in En estudio", { index: 1 });
    const c = await box(card, { scroll: false });
    headline(0);
    await say(0);
    await cam(region({ x: colA.x, y: colA.y, width: colD.x + colD.width - colA.x, height: 470 }, 16), { dur: 0 });
    // The pointer walks the four columns while they are named.
    for (const col of ["estudio", "presentar", "presentada", "descartada"]) {
      const k = await box(await must(page, S.boardColumn(col), col), { scroll: false });
      await glide(page, k.x + 60, k.y + 18, 700, 1.4);
      await sleep(250);
    }
    await say(1);
    const start = { x: c.cx, y: c.y + 28 };
    const end = { x: colB.cx, y: colB.y + 160 };
    await glide(page, start.x, start.y, 600);
    await sleep(300);
    await page.mouse.down();
    ev("click", { x: start.x, y: start.y });
    await glide(page, start.x + 12, start.y + 6, 120, 1);
    await glide(page, end.x, end.y, 1000, 1); // the drag is the moment that matters: real time
    await sleep(150);
    await page.mouse.up();
    ev("drop", { x: end.x, y: end.y });
  },
};

/** Before recording: put the page back in its starting state (runs after the page loads, outside the take). */
const PREPARE = {
  // Start just past the page header (the list and its tiles are the subject), with the pointer off the map.
  async inicio(page) {
    mousePos = { x: CONFIG.viewport.width * 0.5, y: CONFIG.viewport.height * 0.2 };
    await page.mouse.move(mousePos.x, mousePos.y);
    const a = await box(await must(page, [S.statTiles[0]], "Abiertas ahora tile"), { scroll: false });
    await scroll(page, { dy: a.y - 14, ms: 50 });
    await sleep(400);
  },
  // An invitation left by an earlier take would already be listed: revoke it (through the page, so the privacy
  // filter applies) and reload.
  async invitar(page) {
    const n = await page.evaluate(async (email) => {
      const team = await (await fetch("/api/team")).json();
      const stale = team.invitations.filter((i) => i.email === email);
      for (const i of stale) await fetch(`/api/team/invitations/${i.id}`, { method: "DELETE", headers: { "X-Radar-CSRF": "1" } });
      return stale.length;
    }, CONFIG.examples.invite.email);
    if (n) await goto(page, "/equipo", READY.invitar);
  },
};

const READY = {
  fuentes: S.sourcesTable,
  analizar: S.pdfPick,
  invitar: S.teamInvite,
  inicio: S.notice,
  ganasteis: S.notice,
  motivos: S.drawerFit,
  empresas: S.empresasCard(CONFIG.examples.company),
  equipo: S.triage,
  seguimiento: S.boardReady,
};

/** What the on-camera teammate does in "equipo". */
const DEMO_TEAM = { assignee: "Marta Ibáñez", note: "Encaja con riberas. ¿Lo miras esta semana?" };

/** Real numbers for the typed copy (scenes.mjs `{placeholders}`), read from the app at capture time. */
async function writeFacts(cookie) {
  const r = await fetch(CONFIG.baseUrl + CONFIG.apiPath, { headers: { cookie } });
  const j = await r.json();
  const facts = { total: j.items.length, fuentes: j.sources?.length ?? null, alto: j.items.filter((o) => o.fit?.tier === "alto").length, at: new Date().toISOString() };
  writeFileSync(path.join(CONFIG.captureDir, "facts.json"), JSON.stringify(facts, null, 1));
  log(`  facts: ${facts.fuentes} fuentes · ${facts.total} convocatorias · ${facts.alto} encaje alto`);
}

/** The assistant beat: the radar's real answers (read-only tools over /mcp, no token) for one question. */
async function writeAssistant() {
  const call = async (name, args) => {
    const r = await fetch(CONFIG.baseUrl + CONFIG.mcpPath, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const j = await r.json();
    if (!j.result || j.result.isError) throw new Error(`${name}: ${JSON.stringify(j).slice(0, 200)}`);
    return j.result.structuredContent;
  };
  const found = await call("buscar_convocatorias", CONFIG.mcp.search);
  const hit = found.convocatorias.find((c) => c.motivos?.some((m) => /^Reforesta ya la ganó/.test(m))) ?? found.convocatorias[0];
  const ficha = await call("ver_convocatoria", { id: hit.id });
  const out = { question: CONFIG.mcp.question, calls: [{ tool: "buscar_convocatorias", args: CONFIG.mcp.search, total: found.total }, { tool: "ver_convocatoria", args: { id: hit.id } }], hit, ficha };
  writeFileSync(path.join(CONFIG.captureDir, "assistant.json"), JSON.stringify(out, null, 1));
  log(`  assistant: ${hit.id} (${found.total} results)`);
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
    console.error(`App not reachable at ${CONFIG.baseUrl} (${e.message}). Start it with \`docker compose up -d\` in the repo root (or set BASE_URL).`);
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
  const people = await demoPeople(); // the only accounts the page may show (PRIVACY_SCRIPT)
  try {
    // A fresh tab per beat (same browser profile, so cookies and the seeded board persist): a tab left with an open
    // sheet could end up with a detached frame and fail every later beat.
    const newPage = async () => {
      const pg = await browser.newPage();
      await pg.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }, { name: "prefers-reduced-motion", value: "no-preference" }]);
      await pg.evaluateOnNewDocument(CURSOR_SCRIPT, CONFIG.hideCss);
      await pg.evaluateOnNewDocument(PRIVACY_SCRIPT, people.map((p) => p.id), people.map((p) => p.name));
      await pg.evaluateOnNewDocument((keys) => keys.forEach((k) => { try { localStorage.removeItem(k); } catch {} }), CONFIG.clearStorageKeys);
      await pg.setCookie(...CONFIG.cookies.map((c) => ({ ...c, url: CONFIG.baseUrl })));
      return pg;
    };
    // Signed in as the demo admin (fictional account, see demo-data.mjs); the cookie is shared by every tab.
    VOICE = durations();
    const session = await login("lucia");
    const [name, value] = session.split(/=(.*)/s);
    CONFIG.cookies.push({ name, value, httpOnly: true });
    if (scenes.some((s) => s.id === "equipo")) await seed(); // on-camera call back to «Sin revisar»
    await writeFacts(session);
    await writeAssistant();
    let page = await newPage();

    for (const scene of scenes) {
      log(`▶ ${scene.id} ${scene.route}`);
      for (let attempt = 1; attempt <= 2; attempt++) {
        take = null;
        await page.close().catch(() => {});
        page = await newPage();
        try {
          mousePos = { x: CONFIG.viewport.width * 0.72, y: CONFIG.viewport.height * 0.7 };
          await goto(page, scene.route, READY[scene.id]);
          await PREPARE[scene.id]?.(page);
          await assertOnlyDemoEmails(page);
          take = new Take(page, path.join(CONFIG.captureDir, "raw", scene.id));
          beatVoice = voiceLines().filter((l) => l.beat === scene.id).map((l) => l.name);
          vcur = null;
          await take.start();
          await ACTIONS[scene.id](page);
          await voiceWait(TIMING.tail); // the last line ends before the beat does
          vcur = null;
          await assertOnlyDemoEmails(page);
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
