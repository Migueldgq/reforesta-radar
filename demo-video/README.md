# Demo video pipeline

Builds the short demo video the hackathon asks for ("un vídeo corto explicando el proyecto") from the live app, with [HyperFrames](https://hyperframes.heygen.com/) rendering locally (no account, no API key, nothing uploaded).

v4 is a product-launch film (about 58 s, 1920×1080, 30 fps): a white canvas, one short typed headline per beat with the key words in the brand green, and under it one cropped piece of the real app, framed by a camera that pushes in and pans. Beats change with a blur/scale swap; one section (the assistant) sits on a green canvas behind a circular wipe. Music bed plus typing ticks, clicks, whooshes and pops. The beat list and timestamps are in `GUION.md`; the previous cut is kept as `out/demo-v3.mp4` (renders are git-ignored).

```
demo-data.mjs (demo team: accounts file, board, notes, votes)
scenes.mjs ─► capture.mjs ─► composition/assets/scenes/<id>.mp4   (2880×1620, speed-ramped, trimmed)
                        ├──► captures/<id>.json                    (camera targets, clicks, headline changes — output time)
                        ├──► captures/facts.json                   (the app's numbers for {placeholders} in the copy)
                        └──► captures/assistant.json               (real /mcp tool output for the assistant beat)
           ─► compose.mjs ─► composition/index.html + assets/audio/mix.wav ─► hyperframes render ─► out/demo-final.mp4
```

- `scenes.mjs` — beat order and all on-screen text. Headlines use `*asterisks*` for the green words and `{fuentes}` / `{total}` / `{alto}` for the app's numbers (filled from `captures/facts.json`: never type a number by hand). Screen beats take their length from the recording; intro/statement/assistant/outro have a fixed `duration`. `canvas: "green"` marks the contrast section.
- `demo-data.mjs` — the fictional team the video shows (see «Demo data» below): `seed` puts real calls on the shared board with assignees, notes and votes through the app's API and resets the call that is marked on camera; `cleanup` deletes the demo accounts and everything they wrote.
- `capture.mjs` — signs in through the API as the demo admin and gives Chrome the session cookie, then drives local Chrome (puppeteer-core) at **1440×810, deviceScaleFactor 2**, with the app's sidebar collapsed (its own `sidebar_state` cookie), and records the CDP screencast at native 2× pixels. Each beat logs `head` (headline i starts), `cam` (the region of the page to frame, in CSS px; `curtain` hides what is left of a side sheet), `click` and `drop`. Saved list filters (`CONFIG.clearStorageKeys`, e.g. the organism selection) are cleared before every page load so each beat starts unfiltered. The side sheet opens without its slide and dimming overlay (the composition hides the list behind it with a white curtain). Before recording it also writes `facts.json` and calls the read-only assistant tools on `/mcp` (no token) for `assistant.json`. Cursor travel and scrolls are speed-ramped, waits for loads are cut, the moment that matters plays at 1×. **All selectors are in `CONFIG` at the top.** A failing beat is retried once in a fresh tab, then skipped (placeholder in the video).
- `compose.mjs` — writes the composition from the logs: camera = scale + translate of the clip so the logged region fills the stage (never past 2 canvas px per CSS px unless a `cam` asks for a closer `max`, so text stays sharp; never showing the sidebar rail), a 1.5 s push-in while each headline types, eased pans between regions, a white curtain that rides the camera to hide what lies beside a side sheet, typed headlines (character by character, caret), blur/scale swaps between beats, and the assistant section: a neutral chat card in the film's own style (no real assistant's name, logo or look) whose answer is built only from `assistant.json`. It also builds the audio mix (see Sound).
- `GUION.md` — the script, beat by beat, with timestamps and an optional voice-over.
- `CREDITS.md` — every audio file, its source and licence.

## Prerequisites

- Node.js 22+, FFmpeg 7+ (`brew install ffmpeg`), Google Chrome (or set `CHROME_PATH`).
- The app running in Docker (`docker compose up -d` in the repo root): capture uses the production web at http://localhost:3010 (no Next dev badge). Another URL: `BASE_URL=…`.
- The demo accounts and an accounts file (below).
- Once: `cd demo-video && npm install`. Check with `npx hyperframes doctor`.

## Demo data

The app needs a signed-in session and a believable team. Use **fictional people with `@example.org` addresses only**, never a real account.

1. Admin, from the repo root (keep the password out of logs; it is shown once):
   `docker compose run --rm api python -m app.users create-admin lucia@example.org --name "Lucía Serrano" --generate`
2. Two members through the invitation flow (`POST /api/team/invitations` as the admin, then `POST /api/auth/invitation/accept`; `docs/api-auth.md`): `diego@example.org` «Diego Martín», `marta@example.org` «Marta Ibáñez».
3. An accounts file outside git — `DEMO_ACCOUNTS=/path/accounts.json` (default `demo-video/.demo-accounts.json`, git-ignored):
   `{ "lucia": { "email": "lucia@example.org", "password": "…" }, "diego": {…}, "marta": {…} }`
4. `node demo-data.mjs seed` (capture also runs it when it records `equipo`). The first seed saves `org_settings` to `captures/org-settings-before.json`.

When the video is final: `node demo-data.mjs cleanup` deletes the three accounts, their sessions, tokens, votes, invitations, notes and the board rows they created, and puts back the organisation settings saved before the first seed **only if a demo account changed them** (a change by a real person is left alone). Then delete the accounts file.

Privacy: the assignee picker lists every active account in the database, so the open list is cut from the film (`skip` in the `equipo` beat). Check the frames for any real name, e-mail or token before publishing.

## Re-run

```bash
cd demo-video
export DEMO_ACCOUNTS=/path/accounts.json
npm run capture      # record all screen beats in one pass (~1.5 min; numbers on screen are whatever the app shows then)
npm run render       # compose + render → out/demo-final.mp4 (~1.5 min)
# or both:
npm run all
```

Variants:

```bash
node capture.mjs ganasteis motivos # re-record some beats only
HEADFUL=1 node capture.mjs equipo  # watch Chrome while it records
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
