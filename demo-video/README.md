# Demo video pipeline

Builds the short demo video the hackathon asks for ("un vídeo corto explicando el proyecto") from the live app, with [HyperFrames](https://hyperframes.heygen.com/) rendering locally (no account, no API key, nothing uploaded).

v3 is a product-launch film (about 53 s, 1920×1080, 30 fps): a white canvas, one short typed headline per beat with the key words in the brand green, and under it one cropped piece of the real app, framed by a camera that pushes in and pans. Beats change with a blur/scale swap; one beat sits on a green canvas behind a circular wipe. Music bed plus typing ticks, clicks, whooshes and pops. The beat list and timestamps are in `GUION.md`.

```
scenes.mjs ─► capture.mjs ─► composition/assets/scenes/<id>.mp4   (2880×1620, speed-ramped, trimmed)
                        └──► captures/<id>.json                    (camera targets, clicks, headline changes — output time)
           ─► compose.mjs ─► composition/index.html + assets/audio/mix.wav ─► hyperframes render ─► out/demo-final.mp4
```

- `scenes.mjs` — beat order and all on-screen text. Headlines use `*asterisks*` for the green words. Screen beats take their length from the recording; intro/statement/outro have a fixed `duration`. `canvas: "green"` marks the contrast beat.
- `capture.mjs` — drives local Chrome (puppeteer-core) at **1440×810, deviceScaleFactor 2**, with the app's sidebar collapsed (its own `sidebar_state` cookie), and records the CDP screencast at native 2× pixels. Each beat logs `head` (headline i starts), `cam` (the region of the page to frame, in CSS px; `curtain` hides what is left of a side sheet), `click` and `drop`. Cursor travel and scrolls are speed-ramped, waits for loads are cut, the moment that matters plays at 1×. **All selectors are in `CONFIG` at the top.** A failing beat is retried once in a fresh tab, then skipped (placeholder in the video).
- `compose.mjs` — writes the composition from the logs: camera = scale + translate of the clip so the logged region fills the stage (never past 2 canvas px per CSS px, so text stays sharp; never showing the sidebar rail), a 1.5 s push-in while each headline types, eased pans between regions, typed headlines (character by character, caret), blur/scale swaps between beats, the green section as a card. It also builds the audio mix (see Sound).
- `GUION.md` — the script, beat by beat, with timestamps and an optional voice-over.
- `CREDITS.md` — every audio file, its source and licence.

## Prerequisites

- Node.js 22+, FFmpeg 7+ (`brew install ffmpeg`), Google Chrome (or set `CHROME_PATH`).
- The app at http://localhost:3000 (`npm run dev` in the repo root) with its data cache warm.
- Once: `cd demo-video && npm install`. Check with `npx hyperframes doctor`.

## Re-run

```bash
cd demo-video
npm run capture      # record all screen beats in one pass (~2.5 min; numbers on screen are whatever the app shows then)
npm run render       # compose + render → out/demo-final.mp4 (~1.5 min)
# or both:
npm run all
```

Variants:

```bash
node capture.mjs perfil analizar   # re-record some beats only
HEADFUL=1 node capture.mjs mapa    # watch Chrome while it records
npm run render:draft               # faster, lower-quality check → out/demo-draft.mp4
npm run preview                    # HyperFrames browser editor
npm run lint                       # "nested_structure" warnings are expected: the film is one generated file
```

To change wording: `scenes.mjs`, then `npm run render` (no re-capture). To change pacing or framing: the `sleep(...)` holds and `cam(...)` regions inside each beat in `capture.mjs` (`ACTIONS`), then re-capture that beat. Ramp speeds: `CONFIG.travelSpeed` / `CONFIG.scrollSpeed`. Canvas layout, typing speed, max zoom and overlap: constants at the top of `compose.mjs`.

## Sound

`compose.mjs` builds one stereo mix, `composition/assets/audio/mix.wav` (git-ignored):

1. an effects stem: a tick per typed character (Kenney, CC0), a layered click on every logged click (Kenney + HyperFrames' Pixabay click), a drop sound on the board, a pop on the brand mark, a whoosh on every beat change, a softer one on camera pans, a long whoosh on the circular wipes;
2. the music bed (HoliznaCC0 "Autumn", CC0), loudness-normalised to −20 LUFS, faded in (0.8 s) and out (2.2 s);
3. the sum brought to **−17 LUFS integrated** and limited (true peak about −1.5…−2 dBTP). Clicks land around −6…−8 dBFS peak.

The cue list it used is written to `composition/assets/audio/cues.json` (handy to check levels).

- **Music off:** `MUSIC=0 npm run render` (or `npm run render:nomusic` → `out/demo-final-nomusic.mp4`). Effects only, still normalised to −17 LUFS.
- **Swap the track:** `MUSIC_FILE=/path/to/track.mp3 npm run render`, or replace the default path `MUSIC_FILE` in `compose.mjs`. Use only audio you are licensed to publish, and add it to `CREDITS.md`.
- Loudness targets: `MUSIC_LUFS` and `TARGET_LUFS` in `compose.mjs`; effect levels: `SFX` (gain per file).

Sources and licences: `CREDITS.md`. The CC0 files are committed in `audio/`; the Pixabay effects are read from the installed `hyperframes` package and only end up inside the rendered mix.

Voice-over is optional (not included): record your own and add an `<audio id="voz">` in `compose.mjs` (lower `MUSIC_LUFS` a few dB under a voice), and lengthen the holds in `capture.mjs` to fit it.
