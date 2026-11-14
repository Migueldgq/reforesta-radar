#!/usr/bin/env node
// Builds the HyperFrames composition from scenes.mjs + the capture logs (captures/<id>.json):
//   composition/index.html          scenes back to back (near-hard cuts), punch-in zooms at each logged interaction,
//                                   kinetic numbered captions, lower thirds for the challenge's example calls
//   composition/assets/sfx/mix.wav  one sound-effects stem: a click on every logged click, a whoosh on cuts and zooms
// A screen scene without a clip becomes a placeholder, so a render always works.
//
//   node compose.mjs && npx hyperframes render composition --output out/demo-final.mp4

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CUT, FPS, SCENES } from "./scenes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMP = path.join(HERE, "composition");

// Bundled with the hyperframes CLI (Pixabay Content License, see its CREDITS.md); used only inside the rendered mix.
const SFX_DIR = path.join(HERE, "node_modules/hyperframes/dist/skills/media-use/audio/assets/sfx");
const SFX = {
  click: { file: "click.mp3", gainDb: -12.6 }, // source peak −5.4 dBFS → about −18 dBFS
  clickSoft: { file: "click-soft.mp3", gainDb: -16 },
  cut: { file: "whoosh-short.mp3", gainDb: -20 }, // source peak −2.1 → about −22 dBFS
  zoom: { file: "whoosh-short.mp3", gainDb: -27 }, // a breath under the clicks
};

// Frame geometry (1920×1080 canvas): the recording sits in a soft frame, captions in the band below.
const FRAME = { x: 96, y: 20, w: 1728, h: 972 };
const ZOOM_IN = 0.3; // s
const ZOOM_OUT = 0.28; // s

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r3 = (n) => Math.round(n * 1000) / 1000;
const pct = (v) => `${r3(v * 100)}%`;

/* ---------- timeline ---------- */
let t = 0;
let step = 0;
const timed = SCENES.map((s) => {
  let duration = s.duration;
  let log = null;
  if (s.kind === "screen") {
    const f = path.join(HERE, "captures", `${s.id}.json`);
    const clip = path.join(COMP, "assets/scenes", `${s.id}.mp4`);
    if (existsSync(f) && existsSync(clip)) {
      log = JSON.parse(readFileSync(f, "utf8"));
      duration = log.duration;
    } else duration = 2.5; // placeholder
  }
  const start = r3(t);
  t += duration - CUT;
  const numbered = s.kind === "screen" && (s.captions?.length ?? 0) > 0;
  return { ...s, start, duration: r3(duration), log, n: numbered ? ++step : null };
});
const total = r3(t + CUT);

/* ---------- markup + animation ---------- */
const html = [];
const anim = [];
const sounds = []; // { t, kind }
const inFrame = []; // videos live in one shared, untimed frame (a <video> must not sit inside a timed wrapper)

timed.forEach((s, idx) => {
  const z = (idx + 1) * 10;
  const win = (a, d) => `data-start="${r3(a)}" data-duration="${r3(d)}"`;
  if (idx > 0) {
    anim.push(`tl.fromTo("#${s.kind === "card" ? "card" : "vid"}-${s.id}", { opacity: 0 }, { opacity: 1, duration: ${CUT}, ease: "none" }, ${s.start});`);
    sounds.push({ t: s.start, kind: "cut" });
  }

  if (s.kind === "card") {
    html.push(`<section id="card-${s.id}" class="clip card${s.id === "outro" ? " outro" : ""}" ${win(s.start, s.duration)} data-track-index="1" style="z-index:${100 + z}">
        <p class="eyebrow">${esc(s.eyebrow)}</p>
        <h1 class="title">${s.title.split(" ").map((w) => `<span class="w">${esc(w)}</span>`).join(" ")}</h1>
        <p class="subtitle">${esc(s.subtitle)}</p>
      </section>`);
    anim.push(`tl.fromTo("#card-${s.id} .eyebrow", { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, ease: "power2.out" }, ${r3(s.start + 0.05)});`);
    anim.push(`tl.fromTo("#card-${s.id} .w", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.32, ease: "power3.out", stagger: 0.045 }, ${r3(s.start + 0.12)});`);
    anim.push(`tl.fromTo("#card-${s.id} .subtitle", { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "power2.out" }, ${r3(s.start + 0.45)});`);
    return;
  }

  // Screen scene: frame + video (or placeholder)
  const vid = `vid-${s.id}`;
  const media = s.log
    ? `<video id="${vid}" class="screen" src="assets/scenes/${s.id}.mp4" ${win(s.start, s.duration)} data-track-index="2" muted playsinline style="z-index:${z}"></video>`
    : `<div id="${vid}" class="clip placeholder" ${win(s.start, s.duration)} data-track-index="2" style="z-index:${z}"><span>Captura pendiente · ${esc(s.id)}</span></div>`;
  inFrame.push(media);
  if (!s.log) return;

  const { width: vw, height: vh } = s.log.viewport;
  const ev = s.log.events;

  // Punch-in zooms, origin at the interaction point.
  let open = null;
  for (const e of ev) {
    if (e.type === "zoomIn") open = e;
    if (e.type === "zoomOut" && open) {
      const a = s.start + open.t;
      const b = Math.max(a + ZOOM_IN + 0.1, s.start + e.t);
      anim.push(`tl.set("#${vid}", { transformOrigin: "${pct(open.x / vw)} ${pct(open.y / vh)}" }, ${r3(a - 0.01)});`);
      anim.push(`tl.to("#${vid}", { scale: ${open.scale}, duration: ${ZOOM_IN}, ease: "power3.out" }, ${r3(a)});`);
      anim.push(`tl.to("#${vid}", { scale: 1, duration: ${ZOOM_OUT}, ease: "power2.inOut" }, ${r3(b)});`);
      sounds.push({ t: a, kind: "zoom" });
      open = null;
    }
  }
  for (const e of ev) if (e.type === "click") sounds.push({ t: s.start + e.t, kind: e.soft ? "clickSoft" : "click" });

  // Kinetic captions: each one lives until the next caption or the end of the scene.
  const caps = ev.filter((e) => e.type === "caption" && s.captions?.[e.i]);
  caps.forEach((c, k) => {
    const a = s.start + c.t;
    const b = k + 1 < caps.length ? s.start + caps[k + 1].t : s.start + s.duration;
    const id = `cap-${s.id}-${k}`;
    html.push(`<div id="${id}" class="clip caption" ${win(a, b - a)} data-track-index="3" style="z-index:${200 + z}">
        <span class="step">${String(s.n).padStart(2, "0")}</span><span class="text">${esc(s.captions[c.i])}</span>
      </div>`);
    anim.push(`tl.fromTo("#${id} > *", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.2, ease: "power2.out", stagger: 0.05 }, ${r3(a)});`);
  });

  // Lower thirds for the challenge's example calls.
  let lt = null;
  const lows = [];
  for (const e of ev) {
    if (e.type === "lower") lt = e;
    if ((e.type === "lowerOff" || e === ev.at(-1)) && lt) {
      lows.push({ ...lt, end: e.type === "lowerOff" ? e.t : s.duration });
      lt = null;
    }
  }
  lows.forEach((l, k) => {
    const info = s.lowerThirds?.[l.i];
    if (!info) return;
    const a = s.start + l.t;
    const d = Math.max(0.6, l.end - l.t);
    const id = `lt-${s.id}-${k}`;
    html.push(`<div id="${id}" class="clip lower" ${win(a, d)} data-track-index="4" style="z-index:${300 + z}">
        <span class="chip">${esc(info.chip)}</span>
        <p class="lt-title">${esc(info.title)}</p>
        <p class="lt-meta">${esc(info.meta)}</p>
      </div>`);
    anim.push(`tl.fromTo("#${id}", { x: -28, opacity: 0 }, { x: 0, opacity: 1, duration: 0.25, ease: "power3.out" }, ${r3(a)});`);
    anim.push(`tl.to("#${id}", { x: -16, opacity: 0, duration: 0.18, ease: "power2.in" }, ${r3(a + d - 0.18)});`);
  });
});

/* ---------- sound-effects stem ---------- */
function buildSfx() {
  const dir = path.join(COMP, "assets/sfx");
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, "mix.wav");
  const kinds = Object.keys(SFX);
  const used = sounds.filter((s) => s.t >= 0 && s.t < total).sort((a, b) => a.t - b.t);
  // Input 0 is a silent bed of the film's exact length; amix ends with it.
  const inputs = ["-f", "lavfi", "-t", String(total), "-i", "anullsrc=r=48000:cl=stereo", ...kinds.flatMap((k) => ["-i", path.join(SFX_DIR, SFX[k].file)])];
  const per = Object.fromEntries(kinds.map((k) => [k, used.filter((s) => s.kind === k)]));
  const chains = [];
  const labels = [];
  kinds.forEach((k, i) => {
    const list = per[k];
    if (!list.length) return;
    chains.push(`[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${SFX[k].gainDb}dB,asplit=${list.length}${list.map((_, j) => `[${k}${j}]`).join("")}`);
    list.forEach((s, j) => {
      const ms = Math.round(s.t * 1000);
      chains.push(`[${k}${j}]adelay=${ms}|${ms}[d${k}${j}]`);
      labels.push(`[d${k}${j}]`);
    });
  });
  if (!labels.length) return null;
  chains.push(`[0:a]${labels.join("")}amix=inputs=${labels.length + 1}:duration=first:normalize=0:dropout_transition=0,alimiter=limit=0.7:level=false[mix]`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", chains.join(";"), "-map", "[mix]", "-c:a", "pcm_s16le", out]);
  return { file: "assets/sfx/mix.wav", count: used.length };
}
const sfx = existsSync(SFX_DIR) ? buildSfx() : null;
if (sfx) html.push(`<audio id="sfx" src="${sfx.file}" data-start="0" data-duration="${total}" data-track-index="5" data-volume="1"></audio>`);

/* ---------- page ---------- */
const page = `<!doctype html>
<!-- GENERATED by compose.mjs from scenes.mjs and captures/*.json. Edit those, not this file. -->
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      @font-face { font-family: "Geist"; src: url("assets/fonts/geist-latin.woff2") format("woff2"); font-weight: 100 900; font-display: block; }
      :root {
        --ground: oklch(1 0 0);
        --ink: oklch(0.205 0 0);
        --muted: oklch(0.52 0 0);
        --border: oklch(0.922 0 0);
        --accent: oklch(0.37 0.07 158);
        --accent-soft: oklch(0.37 0.07 158 / 0.1);
        --font: "Geist", ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", sans-serif;
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: var(--ground); }
      #root { position: relative; width: 1920px; height: 1080px; overflow: hidden; font-family: var(--font); color: var(--ink); background: var(--ground); }
      .clip { position: absolute; inset: 0; }

      .card { background: var(--ground); display: flex; flex-direction: column; justify-content: center; padding: 0 200px; gap: 26px; }
      .eyebrow { font-size: 26px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
      .title { font-size: 112px; font-weight: 600; letter-spacing: -0.04em; line-height: 1.02; max-width: 1450px; }
      .title .w { display: inline-block; }
      .subtitle { font-size: 40px; color: var(--muted); max-width: 1300px; line-height: 1.3; }
      .outro .title { font-size: 88px; }
      .outro .subtitle { color: var(--accent); font-weight: 500; }

      .frame {
        position: absolute; left: ${FRAME.x}px; top: ${FRAME.y}px; width: ${FRAME.w}px; height: ${FRAME.h}px;
        overflow: hidden; border-radius: 14px; border: 1px solid var(--border);
        box-shadow: 0 30px 70px -44px rgba(0, 0, 0, 0.35); isolation: isolate; background: var(--ground);
      }
      .screen { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover; will-change: transform; }
      .placeholder { display: grid; place-items: center; background: oklch(0.97 0 0); }
      .placeholder span { font-size: 32px; color: var(--muted); }

      .caption { inset: auto 0 0 0; top: ${FRAME.y + FRAME.h}px; display: flex; align-items: center; justify-content: center; gap: 16px; }
      .caption .step {
        font-size: 20px; font-weight: 600; color: var(--accent); background: var(--accent-soft);
        padding: 4px 10px; border-radius: 999px; font-variant-numeric: tabular-nums; letter-spacing: 0.04em;
      }
      .caption .text { font-size: 36px; font-weight: 600; letter-spacing: -0.015em; }

      .lower {
        inset: auto; left: ${FRAME.x + 36}px; top: ${FRAME.y + FRAME.h - 210}px; width: 760px;
        background: var(--ground); border: 1px solid var(--border); border-radius: 14px;
        opacity: 0; box-shadow: 0 18px 40px -20px rgba(0, 0, 0, 0.35); padding: 22px 26px; display: flex; flex-direction: column; gap: 8px;
      }
      .lower .chip { align-self: flex-start; font-size: 17px; font-weight: 600; color: var(--accent); background: var(--accent-soft); padding: 4px 10px; border-radius: 999px; letter-spacing: 0.02em; }
      .lower .lt-title { font-size: 26px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.25; }
      .lower .lt-meta { font-size: 21px; color: var(--muted); font-variant-numeric: tabular-nums; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-fps="${FPS}" data-width="1920" data-height="1080">
      <div id="frame" class="frame">
        ${inFrame.join("\n        ")}
      </div>
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
  `composition/index.html: ${timed.length} scenes, ${total}s` +
    (sfx ? `, ${sfx.count} sound cues` : ", no sfx (hyperframes not installed?)") +
    (missing.length ? ` (placeholders: ${missing.join(", ")})` : ""),
);
