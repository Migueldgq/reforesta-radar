#!/usr/bin/env python3
"""ElevenLabs narration (optional, paid service): only the narration text of scenes.mjs is sent.

The API key is read from ~/.elevenlabs.env (ELEVENLABS_API_KEY=…, or env ELEVENLABS_ENV for another file); it is never
printed or written anywhere.

    python3 elevenlabs.py account                              # plan tier and remaining characters (free plan: premade voices only, mp3 ≤128 kbps)
    python3 elevenlabs.py voices [query]                       # voices this account can use
    python3 elevenlabs.py sample <voice_id> <out.mp3> "<text>"
    python3 elevenlabs.py lines <voice_id>                     # every line of voice/lines.in.json → voice/NN-<beat>.mp3

`lines` sends `text` (not the local voice's respelling), one request per line with the previous/next line as context,
and caches by a hash of voice, model, settings and text: an unchanged line is never sent again.
"""

import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = "https://api.elevenlabs.io"
MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_v4")  # language_code is accepted by v4/v3, not by multilingual_v2
SETTINGS = {"stability": 0.5, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": True, "speed": 1.05}


def key():
    f = Path(os.environ.get("ELEVENLABS_ENV", Path.home() / ".elevenlabs.env"))
    for line in f.read_text().splitlines():
        if line.strip().startswith("ELEVENLABS_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit(f"no ELEVENLABS_API_KEY in {f}")


def call(method, path, body=None, raw=False):
    req = urllib.request.Request(API + path, method=method, headers={"xi-api-key": key(), "content-type": "application/json", "accept": "*/*"},
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
            return data if raw else json.loads(data)
    except urllib.error.HTTPError as e:  # body only: never the request headers
        sys.exit(f"HTTP {e.code} on {method} {path.split('?')[0]}: {e.read().decode(errors='replace')[:500]}")


SEED = 7  # a line can set its own `seed` in scenes.mjs when a take needs another try


def tts(voice, text, out, prev=None, nxt=None, seed=SEED):
    body = {"text": text, "model_id": MODEL, "voice_settings": SETTINGS, "seed": seed}
    if MODEL.startswith(("eleven_v4", "eleven_v3")):
        body["language_code"] = "es"
    if prev:
        body["previous_text"] = prev
    if nxt:
        body["next_text"] = nxt
    Path(out).write_bytes(call("POST", f"/v1/text-to-speech/{voice}?output_format=mp3_44100_128", body, raw=True))


def cmd_account():
    s = call("GET", "/v1/user/subscription")
    print(json.dumps({k: s.get(k) for k in ("tier", "status", "character_count", "character_limit", "next_character_count_reset_unix", "can_use_instant_voice_cloning")}, indent=1))
    print("remaining:", (s.get("character_limit") or 0) - (s.get("character_count") or 0))


def cmd_voices(q=""):
    v = call("GET", "/v2/voices?page_size=100" + (f"&search={q}" if q else ""))
    for x in v.get("voices", []):
        lab = x.get("labels") or {}
        langs = ",".join(f"{l.get('language')}:{l.get('accent', '')}" for l in (x.get("verified_languages") or []))
        print(f"{x['voice_id']}  {x['name']:<28} {x.get('category', ''):<10} {lab.get('gender', '')} {lab.get('accent', '')} {lab.get('description', '')} {lab.get('use_case', '')} [{langs}]")


def cmd_lines(voice):
    spec = json.loads((HERE / "voice/lines.in.json").read_text())
    cache_f = HERE / "voice/.elevenlabs.json"
    cache = json.loads(cache_f.read_text()) if cache_f.exists() else {}
    L = spec["lines"]
    sent = 0
    for i, line in enumerate(L):
        key = [voice, MODEL, SETTINGS, line["text"]] + ([line["seed"]] if "seed" in line else [])  # default seed: old hashes stay valid
        h = hashlib.sha1(json.dumps(key).encode()).hexdigest()[:12]
        out = HERE / "voice" / f"{line['id']}.mp3"
        if cache.get(line["id"]) == h and out.exists():
            continue
        tts(voice, line["text"], out, L[i - 1]["text"] if i else None, L[i + 1]["text"] if i + 1 < len(L) else None, line.get("seed", SEED))
        wav = HERE / "voice" / f"{line['id']}.wav"  # the local draft of this line, if any, would shadow the new file
        if wav.exists():
            wav.rename(wav.with_suffix(".kokoro.wav.bak"))
        cache[line["id"]] = h
        sent += len(line["text"])
        cache_f.write_text(json.dumps(cache, indent=1))
        print(f"  ✓ {line['id']} ({len(line['text'])} chars)")
    print(f"sent {sent} characters")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["account"]:
        cmd_account()
    elif a[:1] == ["voices"]:
        cmd_voices(*a[1:2])
    elif a[:1] == ["sample"]:
        tts(a[1], a[3], a[2])
        print(a[2])
    elif a[:1] == ["lines"]:
        cmd_lines(a[1])
    else:
        print(__doc__)
