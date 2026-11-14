# Demo video pipeline

Builds the short demo video the hackathon asks for ("un vídeo corto explicando el proyecto") from the live app.

```
scenes.mjs ──► capture.mjs ──► composition/assets/scenes/<id>.mp4 ─┐
   │            (puppeteer-core + local Chrome, records the app)    │
   └─────────► compose.mjs ──► composition/index.html ──────────────┴─► hyperframes render ─► out/demo-draft.mp4
```

- `scenes.mjs` — scene order, durations and captions (the single source of truth; mirrors `GUION.md`).
- `capture.mjs` — opens each route at 1920×1080 (deviceScaleFactor 2), performs the scene's clicks/scrolls/drag with a visible cursor, records it with `page.screencast()` and transcodes to an exact-length H.264 clip. **All selectors are in the `CONFIG` object at the top.** A scene that fails is skipped with a warning.
- `compose.mjs` — writes the [HyperFrames](https://hyperframes.heygen.com/) composition: intro and outro cards, each clip in a soft frame with its caption, 0.5 s crossfades. Missing clips become a grey placeholder, so a render always works.
- `GUION.md` — script in Spanish, scene by scene, with an optional voice-over.

Everything runs locally. No HeyGen account, API key or upload is involved.

## Prerequisites

- Node.js 22+ (`node -v`), FFmpeg (`ffmpeg -version`; macOS: `brew install ffmpeg`), Google Chrome installed (or set `CHROME_PATH`).
- The app running at http://localhost:3000 (`npm run dev` in the repo root), with its data cache warm (open it once).
- Once: `cd demo-video && npm install`. HyperFrames downloads its own headless Chrome on the first render (`npx hyperframes browser ensure`). Check with `npx hyperframes doctor`.

Telemetry: the npm scripts set `HYPERFRAMES_NO_TELEMETRY=1`. To turn it off for good: `npx hyperframes telemetry disable`.

## Re-run (when the UI is final)

```bash
cd demo-video
npm run capture            # record every screen scene (~2–3 min)
npm run render             # compose + render → out/demo-draft.mp4
# or both:
npm run all
```

Useful variants:

```bash
node capture.mjs encaja ejemplos     # re-record only some scenes
HEADFUL=1 node capture.mjs inicio    # watch Chrome while it records
VIEWPORT=1440x810 node capture.mjs   # bigger, more legible UI in the 1080p video
DSF=1 node capture.mjs               # faster capture if the cursor stutters
npm run preview                      # HyperFrames browser editor for the composition
npm run render:final                 # highest quality → out/demo-final.mp4
```

If a scene prints `⚠ … skipped: not found: …`, fix that selector in `CONFIG.sel` (capture.mjs). If it prints `actions took Xs, clip is cut`, raise that scene's `duration` in `scenes.mjs` (and in `GUION.md`) or shorten its pauses in `ACTIONS`.

## Optional: voice-over and music

Not included by default. Options, all local and free:

- **Your own voice** (recommended for Spanish): record `composition/assets/voz.wav`, then add to the composition (in `compose.mjs` markup) `<audio id="voz" src="assets/voz.wav" data-start="0" data-track-index="4"></audio>`.
- **Local TTS** (Kokoro-82M; per the docs no API key and nothing leaves the machine; not tested here): `pip install kokoro-onnx soundfile`, then e.g. `npx hyperframes tts locucion.txt --voice ef_dora --output composition/assets/voz.wav` (`ef_*`/`em_*` voices are Spanish). Listen before using it: quality in Spanish is acceptable, not natural.
- HeyGen voices, music catalogue and avatars need a HeyGen account/API key (`npx hyperframes auth login`) and may be billed: not used here.
- Music: only tracks you have a licence for, placed as `<audio … data-volume="0.15">`.

If narration is added, its length sets the pace: adjust the durations in `scenes.mjs` to match.
