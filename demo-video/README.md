# Demo video pipeline

Builds the short demo video the hackathon asks for ("un vídeo corto explicando el proyecto") from the live app, with [HyperFrames](https://hyperframes.heygen.com/) rendering locally (no account, no API key, nothing uploaded).

The narrated cut (about 3¾ min, 1920×1080, 30 fps) explains the radar to a non-technical audience with a voice-over in Castilian Spanish: a white canvas, one short typed headline per beat with the key words in the brand green (titles that support the voice), and under it one cropped piece of the real app, framed by a camera that pushes in and pans. Beats change with a blur/scale swap; one section (the AI agent over MCP) sits on a green canvas behind a circular wipe. Voice on top, music bed ducked under it, typing ticks, clicks, whooshes and pops; Spanish subtitles as a separate file (`out/demo-final.es.srt`). **The voice drives the timing** (see «Voice»). The beat list, timestamps and the narration as recorded are in `GUION.md`; the script to record is `GUION-VOZ.md`. The previous, silent 88 s cut is kept as `out/demo-v5.mp4` (renders are git-ignored).

```
demo-data.mjs (demo team: accounts file, board, notes, votes)
scenes.mjs (beats, headlines, narration text) ─► voice-lines.mjs script ─► GUION-VOZ.md + voice/lines.in.json
voice/NN-<beat>.mp3|wav   (elevenlabs.py, voice.py or recorded by hand; measured by voice-lines.mjs)
scenes.mjs ─► capture.mjs ─► composition/assets/scenes/<id>.mp4   (2880×1620, speed-ramped, trimmed, held for the voice)
                        ├──► captures/<id>.json                    (camera targets, clicks, headline changes — output time)
                        ├──► captures/facts.json                   (the app's numbers for {placeholders} in the copy)
                        └──► captures/assistant.json               (real /mcp tool output for the assistant beat)
           ─► compose.mjs ─► composition/index.html + assets/audio/mix.wav + out/demo-final.es.srt ─► hyperframes render ─► out/demo-final.mp4
```

- `scenes.mjs` — beat order, all on-screen text and the narration (`voice`: one entry per audio file, with an optional respelling `say` for the local draft voice and pronunciation `notes`). Headlines use `*asterisks*` for the green words and `{fuentes}` / `{total}` / `{alto}` for the app's numbers (filled from `captures/facts.json`: never type a number by hand). Screen beats take their length from the recording; intro/statement/assistant/outro have a fixed `duration`. `canvas: "green"` marks the contrast section.
- `demo-data.mjs` — the fictional team the video shows (see «Demo data» below): `seed` puts real calls on the shared board with assignees, notes and votes through the app's API and resets the call that is marked on camera; `cleanup` deletes the demo accounts and everything they wrote.
- `capture.mjs` — signs in through the API as the demo admin and gives Chrome the session cookie, then drives local Chrome (puppeteer-core) at **1440×810, deviceScaleFactor 2**, with the app's sidebar collapsed (its own `sidebar_state` cookie), and records the CDP screencast at native 2× pixels. Each beat logs `head` (headline i starts), `say` (voice line k starts; see «Voice»), `cam` (the region of the page to frame, in CSS px; `curtain` hides what is left of a side sheet, `floor` what is below the shot), `click` and `drop`. Saved list filters (`CONFIG.clearStorageKeys`, e.g. the organism selection) are cleared before every page load so each beat starts unfiltered. The side sheet opens without its slide and dimming overlay (the composition hides the list behind it with a white curtain). Before recording it also writes `facts.json` and calls the read-only assistant tools on `/mcp` (no token) for `assistant.json`. Cursor travel and scrolls are speed-ramped, waits for loads are cut, the moment that matters plays at 1×. **All selectors are in `CONFIG` at the top.** A failing beat is retried once in a fresh tab, then skipped (placeholder in the video). `analizar` uploads `data/samples/miteco-convocatoria-923290.pdf` (a public BDNS printout of a call in the radar, so the app gives it the list's own score) through the file picker; the automatic text extract under the score is kept out of the shot (a `floor` camera target and a cut to the reasons with the extract scrolled away), since this printout has no extractable summary; `fuentes` only hovers «Actualizar ahora» (pressing it would start an ingest). `inicio` starts scrolled just past the page header, so the team's saved profile chip («Perfil ajustado») is not in that shot. `perfil` shows the team's real, shared profile read-only (the pointer only hovers; never click there, it would change the list for everyone), with its shots timed on the phrases of its one voice line (`voiceAt`); the keywords the team saved by hand stay out of the shot (`floor`, a cut, then `ceil`). `ia` needs the «Revisión por IA» on (ADR 0041) and real verdicts in the database: it opens the «Descartadas por la IA» block and one of its calls (`CONFIG.examples.aiDiscarded`), and only hovers «Sí encaja».
- `compose.mjs` — writes the composition from the logs: camera = scale + translate of the clip so the logged region fills the stage (never past 2 canvas px per CSS px unless a `cam` asks for a closer `max`, so text stays sharp; never showing the sidebar rail), a 1.5 s push-in while each headline types, eased pans between regions, a white curtain that rides the camera to hide what lies beside a side sheet, typed headlines (character by character, caret), blur/scale swaps between beats, and the AI-agent section: first a connector card (the radar's MCP server at `/mcp`, «Conectado», open standard so any MCP-compatible agent works; the host is the live radar's public address, `reforesta-radar.miguelddev.com`), then a neutral chat card in the film's own style (no real agent's name, logo or look) whose answer is built only from `assistant.json`, with the tool calls tagged «MCP · Reforesta Radar». It also builds the audio mix (see Sound).
- `GUION.md` — the film beat by beat, with timestamps and the narration as recorded.
- `GUION-VOZ.md` — generated (`node voice-lines.mjs script`): every voice line, the file name it must be saved as, pronunciation notes, and the plain text to paste into a speech tool.
- `voice-lines.mjs` — the voice lines and their files (`voice/NN-<beat>.<wav|mp3|m4a|…>`, git-ignored); trims each file's leading/trailing silence into `composition/assets/voice/` and measures it. `node voice-lines.mjs status` lists what is there.
- `elevenlabs.py` — the final voice (ElevenLabs API); `voice.py` — a free local draft voice (Kokoro) and the speech-to-text check (Whisper). See «Voice».
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

The `invitar` beat invites «Nuria Campos» (nuria@example.org) on camera; `cleanup` deletes that invitation with the rest (it was created by the demo admin), and before each take capture revokes one left by an earlier take.

Privacy: the database may hold real people's accounts. While recording, `capture.mjs` (`PRIVACY_SCRIPT`) wraps the page's `fetch` so every `/api/*` JSON response is filtered before the app renders it: only the demo accounts (their ids, `@example.org` e-mails) can appear in people lists, invitations, assignees, notes, votes or "…By" fields. It changes neither the app nor the database. Each beat also fails if any non-`@example.org` address is in the page text or form fields (`assertOnlyDemoEmails`; it prints only a count). The assignee picker's open list is still cut from the film (`skip` in the `equipo` beat). Dialogs open over a white veil instead of the dark overlay. Links the local stack builds on its own address (the invitation link) are shown with the public address of the radar (`CONFIG.publicUrl`): the same filter rewrites only the scheme, host and port of a `localhost` link in API responses. Check the frames for any real name, e-mail or token before publishing.

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
2. the music bed (HoliznaCC0 "Autumn", CC0), loudness-normalised to −24 LUFS, faded in (0.8 s) and out (2.2 s);
3. the voice stem, every line at its place, brought to −16 LUFS (speech; the pauses are gated out of the measurement);
4. the music ducked by 13 dB under every line (fully down 0.3 s before it, back up from 0.35 s after it, smooth ramps; `DUCK_*` in `compose.mjs`);
5. the sum brought to **−16 LUFS integrated** and limited (true peak under −1 dBTP). Clicks sit well under the voice.

The cue list it used is written to `composition/assets/audio/cues.json` (handy to check levels).

- **Music off:** `MUSIC=0 npm run render` (or `npm run render:nomusic` → `out/demo-final-nomusic.mp4`). Voice and effects, still normalised to −16 LUFS.
- **Swap the track:** `MUSIC_FILE=/path/to/track.mp3 npm run render`, or replace the default path `MUSIC_FILE` in `compose.mjs`. Use only audio you are licensed to publish, and add it to `CREDITS.md`.
- Loudness targets: `VOICE_LUFS`, `MUSIC_LUFS`, `DUCK_DB` and `TARGET_LUFS` in `compose.mjs`; effect levels: `SFX` (gain per file).

Sources and licences: `CREDITS.md`. The CC0 files are committed in `audio/`; the Pixabay effects are read from the installed `hyperframes` package and only end up inside the rendered mix.

## Voice

One audio file per line: `voice/NN-<beat>.<ext>` (names and texts in `GUION-VOZ.md`). Any voice works: replace the files (same names, any audio format) and run `npm run render`; nothing else changes. How the voice times the film:

- `capture.mjs` logs `say k` where line k of a beat starts and waits (in output time) until it has finished plus `TIMING.gap` before the next action (`TIMING` in `voice-lines.mjs`: line starts 0.12 s after its mark, the first of a beat at least 0.5 s in, 0.38 s between lines, 0.65 s after the last one).
- `compose.mjs` measures the real files and places each line with the same rules. If a new voice runs longer than the recording allowed for, the picture **holds its frame** at that mark (a freeze, built into `assets/scenes/<id>.rt.mp4`) instead of needing a new capture; shorter lines just leave more air. Re-capture only to make the motion fit a very different voice.
- Headlines change on the line they belong to; statements type their line i when voice line i starts.
- The subtitles (`out/demo-final.es.srt`, not burned in) and `voice/timeline.json` (every line's start/end and scene) are written by `compose.mjs`; it warns if a line comes within 250 ms of a scene change.

Final voice (ElevenLabs, needs the project owner's account; only the narration text is sent):

```bash
# key in ~/.elevenlabs.env as ELEVENLABS_API_KEY=… (never in the repo)
python3 elevenlabs.py account                       # plan and remaining characters
node voice-lines.mjs script                         # after editing the narration in scenes.mjs
python3 elevenlabs.py lines ZCh4e9eZSUf41K4cmCEL    # «Emilio», model eleven_v4; only changed lines are sent (cache: voice/.elevenlabs.json)
```

Free local draft (for timing only; ~2 GB of models under `models/`, git-ignored):

```bash
uv venv --python 3.12 .venv
VIRTUAL_ENV=.venv uv pip install kokoro==0.9.4 mlx-whisper==0.4.3 soundfile   # + piper-tts==1.3.0 to try Piper
export HF_HOME=$PWD/models/hf                       # Kokoro-82M (~330 MB) and Whisper large-v3-turbo (~1.6 GB) download here
.venv/bin/python voice.py lines                     # voice/NN-<beat>.wav (Kokoro ef_dora); delete them before using a recorded voice
.venv/bin/python voice.py check                     # Whisper transcript of every trimmed line vs. the script (voice/check.json)
```

A line that comes back wrong in `check`: fix its text (or its `say` respelling for the local voice) in `scenes.mjs`, `node voice-lines.mjs script`, regenerate. Licences: `CREDITS.md`; decision: `docs/adr/0036-locucion-del-video-con-elevenlabs.md`.
