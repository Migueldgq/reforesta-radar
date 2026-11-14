# Demo video pipeline

Builds the short demo video the hackathon asks for ("un vídeo corto explicando el proyecto") from the live app, with [HyperFrames](https://hyperframes.heygen.com/) rendering locally (no account, no API key, nothing uploaded).

```
scenes.mjs ─► capture.mjs ─► composition/assets/scenes/<id>.mp4   (2880×1620, speed-ramped, trimmed)
                        └──► captures/<id>.json                    (clicks, zooms, captions, lower thirds — output time)
           ─► compose.mjs ─► composition/index.html + assets/sfx/mix.wav ─► hyperframes render ─► out/demo-final.mp4
```

- `scenes.mjs` — scene order, captions (≤6 words) and lower-third text. Screen scenes take their length from the recording; cards have a fixed `duration`.
- `capture.mjs` — drives local Chrome (puppeteer-core) at **1440×810, deviceScaleFactor 2** and records the CDP screencast at native 2× pixels, so zooms stay sharp. Each scene's actions log their interactions; cursor travel and scrolling are **speed-ramped** (×2.5–3), waits for loads are cut, and the moment that matters plays at 1×. The fake cursor is enlarged and draws a click ripple. **All selectors are in `CONFIG` at the top.** A failing scene is retried once, then skipped (placeholder in the video).
- `compose.mjs` — writes the HyperFrames composition from the logs: near-hard cuts (0.12 s), **punch-in zooms** (×1.35–1.9, 0.3 s ease, origin at the interaction and shifted so the target stays in frame), numbered kinetic captions, lower thirds for the challenge's two example calls, intro/outro cards. It also builds one sound-effects stem: a click on every logged click (≈ −18 dBFS), a soft whoosh on cuts and a quieter one on zooms, limited at −3 dBFS.
- `GUION.md` — the script, scene by scene, with an optional voice-over.

## Prerequisites

- Node.js 22+, FFmpeg (`brew install ffmpeg`), Google Chrome (or set `CHROME_PATH`).
- The app at http://localhost:3000 (`npm run dev` in the repo root) with its data cache warm.
- Once: `cd demo-video && npm install`. Check with `npx hyperframes doctor`.

## Re-run

```bash
cd demo-video
npm run capture      # record all screen scenes (~1.5 min)
npm run render       # compose + render → out/demo-final.mp4 (~1.5 min)
# or both:
npm run all
```

Variants:

```bash
node capture.mjs perfil analizar   # re-record some scenes ("ejemplos" alone rebuilds its start state from the URL)
HEADFUL=1 node capture.mjs mapa    # watch Chrome while it records
npm run render:draft               # faster, lower-quality check → out/demo-draft.mp4
npm run preview                    # HyperFrames browser editor
npm run lint
```

To change pacing: hold times are the `sleep(...)` calls inside each scene in `capture.mjs` (`ACTIONS`); ramp speeds are `CONFIG.travelSpeed` / `CONFIG.scrollSpeed`. To change wording: `scenes.mjs` (no re-capture needed, just `npm run render`).

## Sound

The click and whoosh come from the sound effects bundled with the `hyperframes` CLI (`node_modules/hyperframes/dist/skills/media-use/audio/assets/sfx/`, from Pixabay under the [Pixabay Content License](https://pixabay.com/service/license-summary/): free commercial use in derivative works such as a rendered video, no attribution required). They are mixed into the rendered video only; the files and the generated `composition/assets/sfx/mix.wav` are git-ignored, so the repo does not redistribute them on their own. No music: HyperFrames bundles no music track.

Voice-over is optional (not included): record your own (`composition/assets/voz.wav`) or try local Kokoro TTS (`pip install kokoro-onnx soundfile`, then `npx hyperframes tts locucion.txt --voice ef_dora --output composition/assets/voz.wav`); then add an `<audio>` element in `compose.mjs` and lengthen the holds to fit the voice. HeyGen voices need an account/API key.
