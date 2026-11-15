#!/usr/bin/env node
// The narration as audio files: one file per voice line in scenes.mjs, named NN-<beat>.<wav|mp3|m4a|…> in voice/
// (git-ignored). Any voice works: the local draft (voice.py) or files recorded elsewhere, saved under the same names.
//
//   node voice-lines.mjs script   # writes GUION-VOZ.md (the script to record, with file names) and voice/lines.in.json
//   node voice-lines.mjs status   # which files exist and how long each line is
//
// capture.mjs and compose.mjs call measure(): every file is trimmed of leading/trailing silence and converted to
// composition/assets/voice/NN-<beat>.wav (48 kHz mono); its length is what times the film.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCENES } from "./scenes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VOICE_DIR = process.env.VOICE_DIR ?? path.join(HERE, "voice");
const OUT_DIR = path.join(HERE, "composition/assets/voice");
const EXTS = [".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"];
// Draft voice for voice.py (local, free): Kokoro-82M, Spanish female voice "ef_dora".
export const DRAFT = { engine: "kokoro", voice: "ef_dora", speed: 1.0 };
// Seconds around each line, shared by capture.mjs (holds) and compose.mjs (placement, freezes):
// a line starts `lead` after its `say` mark, the first of a beat no earlier than `first` into the beat, the next one at
// least `gap` after it ends, and the beat ends at least `tail` after its last line.
export const TIMING = { lead: 0.12, first: 0.5, gap: 0.38, tail: 0.65 };

/** Every voice line in film order: { n, name, beat, k, text, say, notes, phase }. */
export function lines() {
  const out = [];
  for (const s of SCENES)
    (s.voice ?? []).forEach((v, k) => {
      const n = out.length + 1;
      out.push({ n, name: `${String(n).padStart(2, "0")}-${s.id}`, beat: s.id, k, text: v.text, say: v.say ?? v.text, notes: v.notes ?? "", phase: v.phase ?? 0 });
    });
  return out;
}

function source(name) {
  for (const e of EXTS) {
    const f = path.join(VOICE_DIR, name + e);
    if (existsSync(f)) return f;
  }
  return null;
}

/**
 * Trimmed copies + durations. Returns { [name]: { file (composition-relative), duration, src } }; lines without a file
 * are missing (capture and compose then fall back to an estimate from the word count, and say so).
 */
export function measure({ quiet = false } = {}) {
  mkdirSync(OUT_DIR, { recursive: true });
  const cacheFile = path.join(OUT_DIR, "measure.json");
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
  const res = {};
  const missing = [];
  for (const l of lines()) {
    const src = source(l.name);
    if (!src) {
      missing.push(l.name);
      continue;
    }
    const stamp = `${src}|${statSync(src).mtimeMs}|${statSync(src).size}`;
    const out = path.join(OUT_DIR, `${l.name}.wav`);
    if (cache[l.name]?.stamp !== stamp || !existsSync(out)) {
      // silence off both ends (−50 dB), 40 ms kept, 48 kHz mono
      const trim = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.04,areverse";
      // 10 ms fades so a line that starts or ends on sound (a breath) does not click
      const fades = "afade=t=in:d=0.01,areverse,afade=t=in:d=0.02,areverse";
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-af", `aformat=channel_layouts=mono,${trim},aresample=48000,${fades}`, "-c:a", "pcm_s16le", out]);
      const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString().trim());
      cache[l.name] = { stamp, duration: Math.round(duration * 1000) / 1000 };
    }
    res[l.name] = { file: `assets/voice/${l.name}.wav`, duration: cache[l.name].duration, src };
  }
  writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
  if (missing.length && !quiet) console.warn(`  ⚠ no voice file for ${missing.length} line(s) in ${path.relative(HERE, VOICE_DIR)}/ (${missing.join(", ")}): timed from an estimate`);
  return res;
}

/** Seconds a line takes: its file, or an estimate (≈ 14 characters per second) when there is none yet. */
export function durations() {
  const m = measure({ quiet: true });
  return Object.fromEntries(lines().map((l) => [l.name, m[l.name]?.duration ?? Math.round((l.text.length / 14) * 100) / 100]));
}

function script() {
  const L = lines();
  const rows = L.map((l) => `| \`${l.name}\` | ${l.text.replace(/\|/g, "\\|")} | ${l.notes || "—"} |`);
  const md = `# Guion de la locución (para grabar)

Generado por \`node voice-lines.mjs script\` a partir de \`scenes.mjs\`: no se edita a mano (se cambia el texto en
\`scenes.mjs\` y se vuelve a generar).

Una frase por archivo. Cada línea se guarda en \`demo-video/voice/\` con el nombre de la primera columna y cualquier
extensión de audio (\`.wav\`, \`.mp3\`, \`.m4a\`…), por ejemplo \`voice/01-intro.mp3\`. Los silencios del principio y del
final se recortan solos y el vídeo se ajusta a lo que dure cada archivo: después basta con \`npm run render\`.

Tono: castellano de España, cercano y tranquilo, tratando de «vosotros». Frases cortas, sin prisa. Las notas de
pronunciación dicen cómo leer siglas, cifras y años; el texto se graba tal cual.

| Archivo | Texto | Notas de pronunciación |
|---|---|---|
${rows.join("\n")}

## Texto seguido (para pegar en una herramienta de voz)

${L.map((l) => `${l.name}: ${l.text}`).join("\n\n")}
`;
  writeFileSync(path.join(HERE, "GUION-VOZ.md"), md);
  mkdirSync(VOICE_DIR, { recursive: true });
  writeFileSync(path.join(VOICE_DIR, "lines.in.json"), JSON.stringify({ ...DRAFT, lines: L.map((l) => ({ id: l.name, text: l.text, say: l.say })) }, null, 1));
  console.log(`GUION-VOZ.md + voice/lines.in.json: ${L.length} lines, ${L.reduce((a, l) => a + l.text.split(/\s+/).length, 0)} words`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === "script") script();
  else if (cmd === "status") {
    const m = measure();
    for (const l of lines()) console.log(`${l.name.padEnd(16)} ${m[l.name] ? m[l.name].duration.toFixed(2).padStart(6) + "s  " + path.basename(m[l.name].src) : "   —    (missing)"}`);
    console.log(`total speech: ${Object.values(m).reduce((a, x) => a + x.duration, 0).toFixed(1)}s`);
  } else console.log("usage: node voice-lines.mjs script | status");
}
