# Audio credits

Every sound in the demo video, where it comes from and under which licence. Nothing here needs attribution; it is given anyway.

| File (in the mix) | Used for | Source | Author | Licence |
|---|---|---|---|---|
| `audio/music/holiznacc0-autumn.mp3` ("28 HoliznaCC0 - Autumn", from the *Chill Beats* collection) | Music bed under the whole film | https://opengameart.org/content/chill-beats-collection (file `chill_beats.zip`) | Holizna (HoliznaCC0) | CC0 1.0 (public domain dedication). Page: "This Music is public domain Cc0, so use it how you want!" |
| `audio/kenney-interface/click_001.ogg` | Every on-screen click (top layer) | https://kenney.nl/assets/interface-sounds ("Interface Sounds" 1.0) | Kenney (kenney.nl) | CC0 1.0 (`audio/kenney-interface/License.txt`) |
| `audio/kenney-interface/click_002.ogg`, `click_003.ogg` | Typing ticks under the typed headlines (alternating) | same pack | Kenney | CC0 1.0 |
| `audio/kenney-interface/drop_002.ogg` | Card dropped on the tracking board | same pack | Kenney | CC0 1.0 |
| `audio/kenney-interface/pluck_001.ogg` | Brand mark pop (intro and outro) | same pack | Kenney | CC0 1.0 |
| `click.mp3` (HyperFrames CLI bundle) | Body of every click (layered under Kenney's click) | `node_modules/hyperframes/dist/skills/media-use/audio/assets/sfx/`, sourced by HyperFrames from Pixabay (see its `CREDITS.md`) | Pixabay contributors | Pixabay Content License |
| `whoosh-short.mp3` (HyperFrames CLI bundle) | Beat changes (blur swap) and, quieter, camera pans | same | Pixabay contributors | Pixabay Content License |
| `whoosh.mp3` (HyperFrames CLI bundle) | Circular wipes into and out of the green section | same | Pixabay contributors | Pixabay Content License |

Licences: CC0 1.0 https://creativecommons.org/publicdomain/zero/1.0/ · Pixabay Content License https://pixabay.com/service/license-summary/ (free commercial use in derivative works such as a rendered video, no attribution required).

Repository policy: the CC0 files live in `audio/` and are committed. The Pixabay effects are not copied into the repo; they are read from the installed CLI and only end up inside the rendered mix (`composition/assets/audio/`, git-ignored).

Swapping the music: any track you are licensed to use, e.g. `MUSIC_FILE=path/to/track.mp3 npm run render`. Add a row here when you do.
