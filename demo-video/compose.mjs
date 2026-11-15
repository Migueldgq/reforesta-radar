#!/usr/bin/env node
// Builds the HyperFrames composition from scenes.mjs + the capture logs (captures/<id>.json), launch-video style:
//   white canvas, a typed headline at the top of each beat (key words in green), and below it one cropped piece of
//   the real app, framed by a camera that pushes in and pans between the regions the capture logged.
//   Beats change with a blur/scale swap; one contrast beat sits on a green canvas behind a circular wipe.
//
//   composition/index.html            the film
//   composition/assets/audio/mix.wav  one stereo mix: music bed + typing ticks, clicks, whooshes, pops
//
// Env: MUSIC=0 leaves the music bed out (sound effects only). MUSIC_FILE=<path> swaps the track.
//
//   node compose.mjs && npx hyperframes render composition --output out/demo-final.mp4

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FPS, SCENES } from "./scenes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMP = path.join(HERE, "composition");

/* ---------- canvas geometry ---------- */
const W = 1920;
const H = 1080;
const STAGE = { top: 168, h: H - 168 }; // where the UI lives, under the headline
const FIT = { w: 1760, h: 780 }; // a camera region is fitted into this box…
const MAX_SCALE = 2.0; // …but never past 2 canvas px per CSS px (the capture is 2x: stays sharp)
const OVERLAP = 0.32; // s: beats overlap by this much (blur swap)
const CPS = 0.034; // s per typed character
const CARD_RADIUS = 18;
const CONNECT_HOLD = 3.0; // s: the assistant section's MCP connector card, before the chat
const RAIL = 52; // CSS px: width of the app's collapsed sidebar rail in the capture (48) plus a little margin

/* ---------- audio ---------- */
const MUSIC_ON = process.env.MUSIC !== "0";
const MUSIC_FILE = process.env.MUSIC_FILE ?? path.join(HERE, "audio/music/holiznacc0-autumn.mp3");
const MUSIC_LUFS = -20; // the bed alone, before the effects go on top
const TARGET_LUFS = -17; // the whole mix
const KENNEY = path.join(HERE, "audio/kenney-interface");
const HF_SFX = path.join(HERE, "node_modules/hyperframes/dist/skills/media-use/audio/assets/sfx");
// gainDb is applied to the source file; every source peaks near 0 dBFS (Kenney) or −2…−5 dBFS (Pixabay).
const SFX = {
  type1: { file: path.join(KENNEY, "click_002.ogg"), gainDb: -17 },
  type2: { file: path.join(KENNEY, "click_003.ogg"), gainDb: -18 },
  click: { file: path.join(KENNEY, "click_001.ogg"), gainDb: -4 },
  clickBody: { file: path.join(HF_SFX, "click.mp3"), gainDb: -6 },
  drop: { file: path.join(KENNEY, "drop_002.ogg"), gainDb: -7 },
  pop: { file: path.join(KENNEY, "pluck_001.ogg"), gainDb: -9 },
  whoosh: { file: path.join(HF_SFX, "whoosh-short.mp3"), gainDb: -6 },
  swish: { file: path.join(HF_SFX, "whoosh-short.mp3"), gainDb: -15 },
  wipe: { file: path.join(HF_SFX, "whoosh.mp3"), gainDb: -2 },
};

// Brand mark: the app's sidebar logo (lucide "sprout" on the green rounded square).
const MARK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3"/><path d="M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4"/><path d="M5 21h14"/></svg>`;
const GITHUB_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>`;

// The app's numbers at capture time ({fuentes}, {total}, {alto} in scenes.mjs text).
const FACTS_FILE = path.join(HERE, "captures", "facts.json");
const FACTS = existsSync(FACTS_FILE) ? JSON.parse(readFileSync(FACTS_FILE, "utf8")) : {};
const fill = (text) =>
  text.replace(/\{(\w+)\}/g, (m, k) => {
    if (FACTS[k] == null) throw new Error(`no value for ${m} in captures/facts.json: run capture.mjs first`);
    return String(FACTS[k]);
  });

const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
const AWARD_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/></svg>`;
// lucide "plug": the MCP connector
const PLUG_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/></svg>`;
const CAL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r3 = (n) => Math.round(n * 1000) / 1000;

/* ---------- typed text: "*green words*" → per-character spans ---------- */
function typed(text) {
  const parts = fill(text).split(/(\*[^*]+\*)/).filter(Boolean);
  let n = 0;
  const html = parts
    .map((p) => {
      const em = p.startsWith("*");
      const t = em ? p.slice(1, -1) : p;
      const chars = [...t].map((c) => `<span class="c">${c === " " ? " " : esc(c)}</span>`).join("");
      n += [...t].length;
      return em ? `<span class="em">${chars}</span>` : chars;
    })
    .join("");
  return { html, n };
}

/* ---------- timeline ---------- */
let t = 0;
const timed = SCENES.map((s) => {
  let duration = s.duration;
  let log = null;
  if (s.kind === "screen") {
    const f = path.join(HERE, "captures", `${s.id}.json`);
    const clip = path.join(COMP, "assets/scenes", `${s.id}.mp4`);
    if (existsSync(f) && existsSync(clip)) {
      log = JSON.parse(readFileSync(f, "utf8"));
      duration = log.duration + 0.25; // a short hold on the last frame before the swap
    } else duration = 2.5; // placeholder
  }
  const start = r3(t);
  t += duration - OVERLAP;
  return { ...s, start, duration: r3(duration), end: r3(start + duration), log };
});
const total = r3(t + OVERLAP);

/* ---------- camera math ---------- */
function camera(r, vp) {
  const s = Math.min(FIT.w / r.w, FIT.h / r.h, r.max ?? MAX_SCALE);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  // Never show the app's collapsed sidebar rail at the left edge: keep the visible area right of it.
  const x = Math.min(W / 2 - s * cx, -RAIL * s);
  return { scale: r3(s), x: r3(x), y: r3(STAGE.h * 0.47 - s * cy), vp };
}

/* ---------- markup + animation ---------- */
const html = [];
const anim = [];
const sounds = []; // { t, kind, g? }  g = extra gain in dB
const swap = (sel, a, b) => {
  anim.push(`tl.fromTo("${sel}", { opacity: 0, filter: "blur(14px)", scale: 0.965 }, { opacity: 1, filter: "blur(0px)", scale: 1, duration: 0.42, ease: "power3.out" }, ${r3(a)});`);
  anim.push(`tl.to("${sel}", { opacity: 0, filter: "blur(14px)", scale: 1.035, duration: 0.3, ease: "power2.in" }, ${r3(b - 0.3)});`);
};

/** A typed line: chars appear one by one, caret follows, then blinks out. Returns the time typing ends. */
function typeLine(id, a, n, { caret = true, tick = true, cps = CPS } = {}) {
  // display:none until typed, so a centred line grows from the middle like the reference
  anim.push(`gsap.utils.toArray("#${id} .c").forEach((c, i) => { tl.set(c, { display: "none" }, 0); tl.set(c, { display: "inline" }, ${r3(a)} + i * ${cps}); });`);
  const end = a + n * cps;
  if (caret) {
    anim.push(`tl.set("#${id} .caret", { opacity: 1 }, ${r3(a)}); tl.set("#${id} .caret", { opacity: 0 }, ${r3(end + 0.22)}); tl.set("#${id} .caret", { opacity: 1 }, ${r3(end + 0.44)}); tl.set("#${id} .caret", { opacity: 0 }, ${r3(end + 0.66)});`);
  }
  if (tick) for (let i = 0; i < n; i++) sounds.push({ t: a + i * cps, kind: i % 2 ? "type2" : "type1", g: ((i * 7) % 5) - 2 });
  return end;
}

let firstGreen = null;
timed.forEach((s, idx) => {
  const z = 10 + idx * 2;
  const win = (a, d) => `data-start="${r3(a)}" data-duration="${r3(d)}"`;
  if (idx > 0 && s.kind !== "outro" && s.canvas !== "green") sounds.push({ t: s.start, kind: "whoosh" });

  if (s.kind === "intro") {
    // Optional typed lead-in before the mark (e.g. "Os presentamos"); without it the mark pops first.
    const lead = s.lead ? typed(s.lead) : null;
    const name = typed(s.name);
    html.push(`<section id="b-${s.id}" class="clip beat center" ${win(s.start, s.duration)} style="z-index:${z}">
        <div class="intro-line">
          ${lead ? `<span id="${s.id}-lead" class="typed">${lead.html}</span>` : ""}
          <span class="mark mark-intro">${MARK_SVG}</span>
          <span id="${s.id}-name" class="typed strong">${name.html}<span class="caret"></span></span>
        </div>
      </section>`);
    const a = s.start + 0.15;
    const e1 = lead ? typeLine(`${s.id}-lead`, a, lead.n, { caret: false }) : a - 0.05;
    anim.push(`tl.fromTo("#b-${s.id} .mark", { scale: 0, rotate: -12 }, { scale: 1, rotate: 0, duration: 0.42, ease: "back.out(2.2)" }, ${r3(e1 + 0.1)});`);
    sounds.push({ t: e1 + 0.1, kind: "pop" });
    typeLine(`${s.id}-name`, e1 + 0.42, name.n);
    anim.push(`tl.to("#b-${s.id} .intro-line", { opacity: 0, filter: "blur(14px)", scale: 1.04, duration: 0.3, ease: "power2.in" }, ${r3(s.end - 0.3)});`);
    return;
  }

  if (s.kind === "statement") {
    const l1 = typed(s.lines[0]);
    const l2 = typed(s.lines[1]);
    html.push(`<section id="b-${s.id}" class="clip beat center" ${win(s.start, s.duration)} style="z-index:${z}">
        <div class="statement">
          <p id="${s.id}-l1" class="typed">${l1.html}</p>
          <p id="${s.id}-l2" class="typed">${l2.html}<span class="caret"></span></p>
        </div>
      </section>`);
    const e1 = typeLine(`${s.id}-l1`, s.start + 0.2, l1.n, { caret: false });
    typeLine(`${s.id}-l2`, e1 + 0.12, l2.n);
    swap(`#b-${s.id} .statement`, s.start, s.end);
    return;
  }

  if (s.kind === "assistant") {
    // Green contrast section: first the radar as an MCP connector of an AI agent, then a question and the answer
    // built from the radar's real tool output (captures/assistant.json), its tool calls tagged as MCP. Neutral cards in
    // the film's own style: no agent's name, logo or look.
    const f = path.join(HERE, "captures", "assistant.json");
    if (!existsSync(f)) throw new Error("captures/assistant.json missing: run capture.mjs first");
    const A = JSON.parse(readFileSync(f, "utf8"));
    const fi = A.ficha;
    const hist = fi.historial ?? {};
    const won = fi.encaje.motivos.find((m) => /^Reforesta ya la ganó/.test(m));
    const title = fi.titulo.charAt(0) + fi.titulo.slice(1).toLowerCase();
    const opening = [hist.typicalOpening?.text, hist.typicalWindow ? `plazo habitual: ${hist.typicalWindow}` : null].filter(Boolean).join("; ");
    const lines = [
      { cls: "a-title", html: esc(title) },
      { cls: "a-meta", html: `${esc(fi.territorio)} · nota ${esc(fi.encaje.nota)}` },
      won && { cls: "a-fact", icon: AWARD_SVG, html: esc(won) },
      opening && { cls: "a-fact", icon: CAL_SVG, html: esc(opening.charAt(0).toUpperCase() + opening.slice(1)) + "." },
      { cls: "a-src", html: `${esc(new URL(fi.url).host)} · ${esc(fi.fuente)} ${esc(fi.id.split(":")[1] ?? "")}` },
    ].filter(Boolean);
    const q = typed(A.question);
    html.push(`<div id="bg-${s.id}" class="clip greenbg" ${win(s.start, s.duration + 0.7)} style="z-index:${z - 1}"></div>`);
    anim.push(`tl.fromTo("#bg-${s.id}", { clipPath: "circle(0% at 50% 56%)" }, { clipPath: "circle(75% at 50% 56%)", duration: 0.6, ease: "power3.inOut" }, ${r3(s.start)});`);
    sounds.push({ t: s.start, kind: "wipe" });
    const a = s.start;
    const L = a + CONNECT_HOLD; // the connector card gives way to the chat

    // Two headlines like the screen beats: one over the connector, one over the chat.
    const [h0, h1] = s.headlines.map(typed);
    html.push(`<div id="h-${s.id}-0" class="clip headline on-green" ${win(a + 0.35, L - a - 0.35)} style="z-index:150"><p class="typed">${h0.html}<span class="caret"></span></p></div>`);
    typeLine(`h-${s.id}-0`, a + 0.35, h0.n);
    anim.push(`tl.to("#h-${s.id}-0 p", { opacity: 0, filter: "blur(10px)", duration: 0.2, ease: "power2.in" }, ${r3(L - 0.2)});`);
    html.push(`<div id="h-${s.id}-1" class="clip headline on-green" ${win(L, s.end - L + 0.35)} style="z-index:150"><p class="typed">${h1.html}<span class="caret"></span></p></div>`);
    typeLine(`h-${s.id}-1`, L, h1.n);

    // Lead-in: the radar as an MCP connector of an AI agent (unbranded; the address host is a neutral stand-in).
    const c = s.connector;
    html.push(`<div id="cn-${s.id}" class="connector" style="z-index:${z}">
        <p class="cn-label">${PLUG_SVG}<span>${esc(c.label)}</span></p>
        <div class="cn-row">
          <span class="mark mark-cn">${MARK_SVG}</span>
          <div class="cn-id">
            <p class="cn-name">${esc(c.name)}</p>
            <p class="cn-url"><span class="muted">${esc(c.host)}</span>${esc(c.path)}<span class="muted"> · ${esc(c.note)}</span></p>
          </div>
          <span class="cn-state">${CHECK_SVG}<span>${esc(c.state)}</span></span>
        </div>
        <p class="cn-standard">${esc(c.standard)}</p>
      </div>`);
    anim.push(`tl.fromTo("#cn-${s.id}", { opacity: 0, y: 60, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "power3.out" }, ${r3(a + 0.45)});`);
    anim.push(`tl.fromTo("#cn-${s.id} .cn-state", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(2.2)" }, ${r3(a + 1.5)});`);
    sounds.push({ t: a + 1.5, kind: "pop", g: -3 });
    anim.push(`tl.to("#cn-${s.id}", { opacity: 0, filter: "blur(14px)", scale: 1.035, duration: 0.3, ease: "power2.in" }, ${r3(L - 0.3)});`);
    sounds.push({ t: L - 0.15, kind: "swish" });

    // The chat: the question, the radar's MCP tool calls, the answer.
    html.push(`<div id="w-${s.id}" class="chat" style="z-index:${z}">
        <div class="q"><p id="q-${s.id}" class="typed">${q.html}<span class="caret"></span></p></div>
        <div class="steps"><span class="tools-tag" id="tt-${s.id}">${PLUG_SVG}<span>${esc(s.toolsTag)}</span></span>${A.calls.map((c, i) => `<span class="step" id="st-${s.id}-${i}">${CHECK_SVG}<span>${i === 0 ? "Buscó en el radar" : "Abrió la ficha"}</span></span>`).join("")}</div>
        <div class="answer">${lines.map((l, i) => `<p class="${l.cls}" id="al-${s.id}-${i}">${l.icon ? `<span class="ico">${l.icon}</span>` : ""}<span>${l.html}</span></p>`).join("")}</div>
      </div>`);
    anim.push(`tl.fromTo("#w-${s.id}", { opacity: 0, y: 60, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "power3.out" }, ${r3(L + 0.1)});`);
    const qEnd = typeLine(`q-${s.id}`, L + 0.65, q.n, { cps: 0.024 });
    anim.push(`tl.fromTo("#tt-${s.id}", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out" }, ${r3(qEnd + 0.15)});`);
    A.calls.forEach((_, i) => {
      const t = qEnd + 0.35 + i * 0.4;
      anim.push(`tl.fromTo("#st-${s.id}-${i}", { opacity: 0, y: 8, scale: 0.92 }, { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: "back.out(1.8)" }, ${r3(t)});`);
      sounds.push({ t, kind: "type1", g: 4 });
    });
    const ansAt = qEnd + 0.35 + A.calls.length * 0.4 + 0.15;
    lines.forEach((_, i) => {
      anim.push(`tl.fromTo("#al-${s.id}-${i}", { opacity: 0, y: 12, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.45, ease: "power3.out" }, ${r3(ansAt + i * 0.22)});`);
    });
    return;
  }

  if (s.kind === "outro") {
    const name = typed(s.name);
    const tag = typed(s.tagline);
    const [host, ...rest] = s.url.split("/");
    html.push(`<section id="b-${s.id}" class="clip beat outro" ${win(s.start, s.duration)} style="z-index:${200}">
        <div class="outro-inner">
          <div class="brand"><span class="mark mark-outro">${MARK_SVG}</span><span class="brand-name">${esc(s.name)}</span></div>
          <p id="${s.id}-tag" class="typed tagline">${tag.html}<span class="caret"></span></p>
          <span class="cta">${GITHUB_SVG}<span>${esc(s.cta)}</span></span>
          <p class="url"><span class="muted">${esc(host)}/</span>${esc(rest.join("/"))}</p>
        </div>
        <svg class="pointer" width="34" height="34" viewBox="0 0 22 22"><path d="M3 2 L3 17 L7.2 13.2 L10 19.5 L12.6 18.4 L9.9 12.3 L15.5 12.3 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>
      </section>`);
    void name;
    const a = s.start;
    // white canvas returns with a circular wipe over the green section
    anim.push(`tl.fromTo("#b-${s.id}", { clipPath: "circle(0% at 50% 56%)" }, { clipPath: "circle(75% at 50% 56%)", duration: 0.6, ease: "power3.inOut" }, ${r3(a)});`);
    sounds.push({ t: a, kind: "wipe" });
    anim.push(`tl.fromTo("#b-${s.id} .mark", { scale: 0, rotate: -12 }, { scale: 1, rotate: 0, duration: 0.45, ease: "back.out(2.2)" }, ${r3(a + 0.4)});`);
    sounds.push({ t: a + 0.4, kind: "pop" });
    anim.push(`tl.fromTo("#b-${s.id} .brand-name", { opacity: 0, x: -14, filter: "blur(8px)" }, { opacity: 1, x: 0, filter: "blur(0px)", duration: 0.4, ease: "power3.out" }, ${r3(a + 0.55)});`);
    const te = typeLine(`${s.id}-tag`, a + 1.0, tag.n);
    anim.push(`tl.fromTo("#b-${s.id} .cta", { opacity: 0, y: 14, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "back.out(1.8)" }, ${r3(te + 0.1)});`);
    anim.push(`tl.fromTo("#b-${s.id} .url", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" }, ${r3(te + 0.3)});`);
    // a pointer glides in and presses the button
    const pc = te + 0.45;
    anim.push(`tl.fromTo("#b-${s.id} .pointer", { opacity: 0, x: 1160, y: 820 }, { opacity: 1, x: 958, y: 622, duration: 0.6, ease: "power3.out" }, ${r3(pc)});`);
    anim.push(`tl.to("#b-${s.id} .cta", { scale: 0.95, duration: 0.08, yoyo: true, repeat: 1, ease: "power1.inOut" }, ${r3(pc + 0.66)});`);
    sounds.push({ t: pc + 0.66, kind: "click" }, { t: pc + 0.66, kind: "clickBody" });
    return;
  }

  /* ---------- screen beat ---------- */
  const green = s.canvas === "green";
  if (green && firstGreen === null) {
    firstGreen = s;
    html.push(`<div id="bg-${s.id}" class="clip greenbg" ${win(s.start, s.duration + 0.7)} style="z-index:${z - 1}"></div>`);
    anim.push(`tl.fromTo("#bg-${s.id}", { clipPath: "circle(0% at 50% 56%)" }, { clipPath: "circle(75% at 50% 56%)", duration: 0.6, ease: "power3.inOut" }, ${r3(s.start)});`);
    sounds.push({ t: s.start, kind: "wipe" });
  }
  const ev = s.log?.events ?? [];
  const vp = s.log?.viewport ?? { width: 1440, height: 810 };

  // Headlines: each lives until the next one (or the beat's end), blur-swapping on change.
  const heads = ev.filter((e) => e.type === "head" && s.headlines?.[e.i] != null);
  if (!heads.length && s.headlines?.length) heads.push({ t: 0, i: 0 });
  heads.forEach((h, k) => {
    const a = s.start + Math.max(0, h.t) + (k === 0 ? 0.12 : 0);
    const b = k + 1 < heads.length ? s.start + heads[k + 1].t : s.end;
    const id = `h-${s.id}-${k}`;
    const tx = typed(s.headlines[h.i]);
    html.push(`<div id="${id}" class="clip headline${green ? " on-green" : ""}" ${win(a, b - a)} style="z-index:150"><p class="typed">${tx.html}<span class="caret"></span></p></div>`);
    typeLine(id, a, tx.n);
    anim.push(`tl.to("#${id} p", { opacity: 0, filter: "blur(10px)", duration: 0.2, ease: "power2.in" }, ${r3(b - 0.2)});`);
  });

  if (!s.log) {
    html.push(`<div id="ph-${s.id}" class="clip placeholder" ${win(s.start, s.duration)} style="z-index:${z}"><span>Captura pendiente · ${esc(s.id)}</span></div>`);
    return;
  }

  const cams = ev.filter((e) => e.type === "cam");
  const first = cams[0] ?? { x: 0, y: 0, w: vp.width, h: vp.height };
  const c0 = camera(first, vp);
  const vid = `v-${s.id}`;
  const video = `<video id="${vid}" class="clip screen" src="assets/scenes/${s.id}.mp4" ${win(s.start, s.duration)} muted playsinline></video>`;

  if (green) {
    // The UI as a card on the green canvas: crop box = the region at the camera's scale.
    const cw = Math.round(first.w * c0.scale);
    const ch = Math.round(first.h * c0.scale);
    const left = Math.round((W - cw) / 2);
    const top = Math.round(STAGE.top + STAGE.h * 0.47 - ch / 2);
    html.push(`<div id="w-${s.id}" class="wrap card" style="z-index:${z};left:${left}px;top:${top}px;width:${cw}px;height:${ch}px">
        ${video}
      </div>`);
    anim.push(`tl.set("#${vid}", { transformOrigin: "0 0", x: ${r3(-first.x * c0.scale)}, y: ${r3(-first.y * c0.scale)}, scale: ${c0.scale} }, 0);`);
    anim.push(`tl.fromTo("#w-${s.id}", { opacity: 0, y: 60, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "power3.out" }, ${r3(s.start + 0.25)});`);
    anim.push(`tl.to("#w-${s.id}", { opacity: 0, filter: "blur(14px)", scale: 1.035, duration: 0.3, ease: "power2.in" }, ${r3(s.end - 0.3)});`);
  } else {
    html.push(`<div id="w-${s.id}" class="wrap stage" style="z-index:${z}">
        ${video}
      </div>`);
    // Start a little wider and push in while the headline types.
    const push = camera({ x: first.x - first.w * 0.06, y: first.y - first.h * 0.06, w: first.w * 1.12, h: first.h * 1.12 }, vp);
    anim.push(`tl.set("#${vid}", { transformOrigin: "0 0", x: ${push.x}, y: ${push.y}, scale: ${push.scale} }, 0);`);
    anim.push(`tl.to("#${vid}", { x: ${c0.x}, y: ${c0.y}, scale: ${c0.scale}, duration: 1.5, ease: "power2.out" }, ${r3(s.start + 0.05)});`);
    // Hide what lies left of css x = curtain (the dimmed list behind a side sheet): a white curtain whose right edge
    // follows the camera. It can start with the beat (sheet already open) or with a later camera move.
    let curtainX = null;
    if (first.curtain != null) {
      curtainX = first.curtain;
      html.push(`<div id="cu-${s.id}" class="clip curtain" ${win(s.start, s.duration)} style="z-index:${z + 1}"></div>`);
      anim.push(`tl.set("#cu-${s.id}", { x: ${r3(push.x + push.scale * curtainX - W)} }, 0);`);
      anim.push(`tl.fromTo("#cu-${s.id}", { opacity: 0 }, { opacity: 1, duration: 0.42, ease: "power3.out" }, ${r3(s.start)});`);
      anim.push(`tl.to("#cu-${s.id}", { x: ${r3(c0.x + c0.scale * curtainX - W)}, duration: 1.5, ease: "power2.out" }, ${r3(s.start + 0.05)});`);
    }
    let prev = c0;
    for (const c of cams.slice(1)) {
      const k = camera(c, vp);
      const d = Math.max(0.2, c.dur ?? 0.7);
      anim.push(`tl.to("#${vid}", { x: ${k.x}, y: ${k.y}, scale: ${k.scale}, duration: ${d}, ease: "power3.inOut" }, ${r3(s.start + c.t)});`);
      if (c.curtain != null && curtainX == null) {
        curtainX = c.curtain;
        html.push(`<div id="cu-${s.id}" class="clip curtain" ${win(s.start + c.t, s.end - s.start - c.t)} style="z-index:${z + 1}"></div>`);
        // fades in fast and rides with the camera move, so its edge stays on the sheet's edge
        anim.push(`tl.fromTo("#cu-${s.id}", { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power2.out" }, ${r3(s.start + c.t)});`);
        anim.push(`tl.fromTo("#cu-${s.id}", { x: ${r3(prev.x + prev.scale * curtainX - W)} }, { x: ${r3(k.x + k.scale * curtainX - W)}, duration: ${d}, ease: "power3.inOut", immediateRender: false }, ${r3(s.start + c.t)});`);
      } else if (curtainX != null) {
        anim.push(`tl.to("#cu-${s.id}", { x: ${r3(k.x + k.scale * curtainX - W)}, duration: ${d}, ease: "power3.inOut" }, ${r3(s.start + c.t)});`);
      }
      if (d >= 0.5) sounds.push({ t: s.start + c.t, kind: "swish" });
      prev = k;
    }
    swap(`#w-${s.id}`, s.start, s.end);
  }

  for (const e of ev) {
    if (e.type === "click") sounds.push({ t: s.start + e.t, kind: "click" }, { t: s.start + e.t, kind: "clickBody" });
    if (e.type === "drop") sounds.push({ t: s.start + e.t, kind: "drop" });
  }
});

/* ---------- audio: one mix ---------- */
function buildAudio() {
  const dir = path.join(COMP, "assets/audio");
  mkdirSync(dir, { recursive: true });
  const sfxOut = path.join(dir, "sfx.wav");
  const out = path.join(dir, "mix.wav");
  const kinds = Object.keys(SFX).filter((k) => existsSync(SFX[k].file));
  const used = sounds.filter((s) => s.t >= 0 && s.t < total && kinds.includes(s.kind)).sort((a, b) => a.t - b.t);
  const inputs = ["-f", "lavfi", "-t", String(total), "-i", "anullsrc=r=48000:cl=stereo", ...kinds.flatMap((k) => ["-i", SFX[k].file])];
  const chains = [];
  const labels = [];
  kinds.forEach((k, i) => {
    const list = used.filter((s) => s.kind === k);
    if (!list.length) return;
    chains.push(`[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${SFX[k].gainDb}dB,asplit=${list.length}${list.map((_, j) => `[${k}${j}]`).join("")}`);
    list.forEach((s, j) => {
      const ms = Math.round(s.t * 1000);
      chains.push(`[${k}${j}]volume=${s.g ?? 0}dB,adelay=${ms}|${ms}[d${k}${j}]`);
      labels.push(`[d${k}${j}]`);
    });
  });
  chains.push(`[0:a]${labels.join("")}amix=inputs=${labels.length + 1}:duration=first:normalize=0:dropout_transition=0[mix]`);
  // The filter graph is long (one branch per typed character): pass it through a script file.
  writeFileSync(path.join(dir, "cues.json"), JSON.stringify(used.map((s) => ({ t: r3(s.t), kind: s.kind })), null, 0));
  const script = path.join(dir, "sfx-graph.txt");
  writeFileSync(script, chains.join(";\n"));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-/filter_complex", script, "-map", "[mix]", "-c:a", "pcm_s24le", sfxOut]);

  let mixIn = sfxOut;
  if (MUSIC_ON && existsSync(MUSIC_FILE)) {
    // Music bed: loudness-normalised, faded in and out, ending with the film.
    const music = path.join(dir, "music.wav");
    const fadeOut = 2.2;
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", MUSIC_FILE, "-t", String(total),
      "-af", `aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=${MUSIC_LUFS}:TP=-3:LRA=11,afade=t=in:d=0.8,afade=t=out:st=${r3(total - fadeOut)}:d=${fadeOut},apad=whole_dur=${total}`,
      "-ar", "48000", "-c:a", "pcm_s24le", music]);
    const both = path.join(dir, "premix.wav");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", music, "-i", sfxOut, "-filter_complex",
      "[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[m]", "-map", "[m]", "-c:a", "pcm_s24le", both]);
    mixIn = both;
  }
  // Bring the whole mix to the target loudness, then a limiter (true peak stays ≤ −1 dBFS).
  const measured = lufsOf(mixIn);
  const gain = r3(TARGET_LUFS - measured);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mixIn, "-af",
    `volume=${gain}dB,alimiter=limit=0.79:level=false:attack=1:release=60,aresample=48000`, "-c:a", "pcm_s16le", out]);
  return { file: "assets/audio/mix.wav", cues: used.length, gain, music: MUSIC_ON && existsSync(MUSIC_FILE) };
}
/** Integrated loudness (LUFS) from ffmpeg's ebur128 summary. */
function lufsOf(file) {
  const p = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=framelog=quiet", "-f", "null", "-"], { encoding: "utf8" });
  const m = [...p.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1);
  if (!m) throw new Error("could not measure loudness of " + file);
  return Number(m[1]);
}
const audio = buildAudio();
html.push(`<audio id="mix" src="${audio.file}" data-start="0" data-duration="${total}" data-track-index="9" data-volume="1"></audio>`);

/* ---------- page ---------- */
const page = `<!doctype html>
<!-- GENERATED by compose.mjs from scenes.mjs and captures/*.json. Edit those, not this file. -->
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      @font-face { font-family: "Geist"; src: url("assets/fonts/geist-latin.woff2") format("woff2"); font-weight: 100 900; font-display: block; }
      :root {
        --ground: oklch(1 0 0);
        --ink: oklch(0.205 0 0);
        --muted: oklch(0.52 0 0);
        --border: oklch(0.922 0 0);
        --accent: oklch(0.37 0.07 158);
        --accent-ink: oklch(0.985 0 0);
        --accent-light: oklch(0.86 0.07 158);
        --accent-wash: oklch(0.955 0.015 158);
        --font: "Geist", ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", sans-serif;
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: var(--ground); }
      #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; font-family: var(--font); color: var(--ink); background: var(--ground); }
      .clip { position: absolute; inset: 0; }

      .typed { white-space: pre; }
      .typed .c { display: none; }
      .em { color: var(--accent); }
      .caret { display: inline-block; width: 0.07em; height: 0.92em; margin-left: 0.06em; vertical-align: -0.1em; background: currentColor; opacity: 0; border-radius: 1px; }

      .beat.center { display: grid; place-items: center; }
      .intro-line { display: flex; align-items: center; gap: 22px; font-size: 76px; font-weight: 500; letter-spacing: -0.035em; }
      .intro-line .strong { font-weight: 600; }
      .mark { display: inline-grid; place-items: center; background: var(--accent); color: var(--accent-ink); flex: none; }
      .mark svg { width: 56%; height: 56%; }
      .mark-intro { width: 84px; height: 84px; border-radius: 20px; }
      .statement { text-align: center; font-size: 84px; font-weight: 500; letter-spacing: -0.04em; line-height: 1.12; }

      .headline { inset: 0 0 auto 0; height: ${STAGE.top}px; display: grid; place-items: center; padding-top: 18px; }
      .headline p { font-size: 54px; font-weight: 500; letter-spacing: -0.03em; }
      .headline.on-green { color: var(--accent-ink); }
      .headline.on-green .em { color: var(--accent-light); }

      .wrap { position: absolute; opacity: 0; }
      .wrap.stage {
        left: 0; top: ${STAGE.top}px; width: ${W}px; height: ${STAGE.h}px; overflow: hidden;
        -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 46px, #000 calc(100% - 120px), transparent 100%), linear-gradient(to right, transparent 0, #000 150px, #000 calc(100% - 150px), transparent 100%);
        -webkit-mask-composite: source-in; mask-composite: intersect;
      }
      .wrap.card {
        overflow: hidden; border-radius: ${CARD_RADIUS}px; background: var(--ground);
        box-shadow: 0 1px 0 rgba(255,255,255,.06) inset, 0 40px 80px -30px rgba(0,0,0,.45);
      }
      .screen { position: absolute; left: 0; top: 0; width: 1440px; height: 810px; will-change: transform; }
      .greenbg { background: var(--accent); }
      .curtain { right: auto; width: ${W}px; top: ${STAGE.top}px; background: var(--ground); }
      .placeholder { display: grid; place-items: center; top: ${STAGE.top}px; }
      .placeholder span { font-size: 32px; color: var(--muted); }

      .connector { position: absolute; left: 50%; top: ${STAGE.top + 215}px; width: 1100px; margin-left: -550px; opacity: 0; padding: 40px 52px 46px;
        border-radius: 24px; background: var(--ground); box-shadow: 0 40px 80px -30px rgba(0,0,0,.45); display: flex; flex-direction: column; gap: 26px; }
      .cn-label { display: flex; align-items: center; gap: 10px; font-size: 27px; font-weight: 500; color: var(--muted); }
      .cn-label svg { width: 27px; height: 27px; }
      .cn-row { display: flex; align-items: center; gap: 30px; }
      .mark-cn { width: 104px; height: 104px; border-radius: 26px; }
      .cn-id { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
      .cn-name { font-size: 56px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; }
      .cn-url { font-size: 32px; font-weight: 500; letter-spacing: -0.01em; }
      .cn-url .muted { color: var(--muted); }
      .cn-standard { font-size: 26px; color: var(--muted); padding-top: 22px; margin-top: -2px; border-top: 1.5px solid var(--border); }
      .cn-state, .tools-tag { display: inline-flex; align-items: center; flex: none; border-radius: 999px; background: var(--accent-wash); color: var(--accent); font-weight: 600; }
      .cn-state { gap: 10px; padding: 12px 24px 12px 18px; font-size: 30px; opacity: 0; }
      .cn-state svg { width: 30px; height: 30px; }
      .tools-tag { gap: 8px; padding: 8px 16px 8px 13px; font-size: 22px; opacity: 0; }
      .tools-tag svg { width: 22px; height: 22px; }
      .chat { position: absolute; left: 50%; top: ${STAGE.top + 92}px; width: 1240px; margin-left: -620px; opacity: 0; padding: 40px 48px 44px;
        border-radius: 24px; background: var(--ground); box-shadow: 0 40px 80px -30px rgba(0,0,0,.45); display: flex; flex-direction: column; gap: 26px; }
      .chat .q { align-self: flex-end; max-width: 88%; padding: 18px 26px; border-radius: 22px 22px 6px 22px; background: var(--accent-wash); font-size: 35px; font-weight: 500; letter-spacing: -0.015em; }
      .chat .q .typed { white-space: pre-wrap; }
      .steps { display: flex; align-items: center; gap: 12px; }
      .step { display: inline-flex; align-items: center; gap: 9px; padding: 8px 16px 8px 12px; border-radius: 999px; border: 1.5px solid var(--border); color: var(--muted); font-size: 24px; font-weight: 500; opacity: 0; }
      .step svg { width: 24px; height: 24px; color: var(--accent); }
      .answer { display: flex; flex-direction: column; gap: 14px; }
      .answer p { display: flex; align-items: flex-start; gap: 14px; opacity: 0; }
      .a-title { font-size: 40px; font-weight: 600; letter-spacing: -0.025em; line-height: 1.2; }
      .a-meta { font-size: 27px; color: var(--muted); margin-top: -6px; margin-bottom: 6px; }
      .a-fact { font-size: 34px; font-weight: 500; letter-spacing: -0.015em; line-height: 1.3; }
      .a-fact .ico { flex: none; width: 34px; height: 34px; margin-top: 3px; color: var(--accent); }
      .a-fact .ico svg { width: 100%; height: 100%; }
      .a-src { font-size: 24px; color: var(--muted); margin-top: 6px; }
      .outro { background: var(--ground); display: grid; place-items: center; }
      .outro-inner { display: flex; flex-direction: column; align-items: center; gap: 26px; transform: translateY(-10px); }
      .brand { display: flex; align-items: center; gap: 22px; }
      .mark-outro { width: 96px; height: 96px; border-radius: 24px; }
      .brand-name { font-size: 92px; font-weight: 600; letter-spacing: -0.045em; }
      .tagline { font-size: 46px; font-weight: 500; letter-spacing: -0.025em; margin-top: 4px; }
      .cta { display: inline-flex; align-items: center; gap: 12px; margin-top: 10px; padding: 16px 30px; border-radius: 14px; background: var(--accent); color: var(--accent-ink); font-size: 30px; font-weight: 500; opacity: 0; }
      .cta svg { width: 30px; height: 30px; }
      .url { font-size: 30px; font-weight: 500; letter-spacing: -0.01em; opacity: 0; }
      .url .muted { color: var(--muted); }
      .pointer { position: absolute; left: 0; top: 0; opacity: 0; filter: drop-shadow(0 2px 3px rgba(0,0,0,.28)); }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-fps="${FPS}" data-width="${W}" data-height="${H}">
      ${html.join("\n      ")}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      ${anim.join("\n      ")}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;

writeFileSync(path.join(COMP, "index.html"), page);
const missing = timed.filter((s) => s.kind === "screen" && !s.log).map((s) => s.id);
console.log(
  `composition/index.html: ${timed.length} beats, ${total}s, ${audio.cues} sound cues, music ${audio.music ? "on" : "off"} (mix gain ${audio.gain} dB)` +
    (missing.length ? ` (placeholders: ${missing.join(", ")})` : ""),
);
console.log(timed.map((s) => `  ${s.start.toFixed(2).padStart(6)}s  ${s.id}`).join("\n"));
