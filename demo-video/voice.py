#!/usr/bin/env python3
"""Narration for the demo video, generated locally (no account, no API key, nothing uploaded).

    .venv/bin/python voice.py sample <engine> <voice> <out.wav> "<text>"   # one test line
    .venv/bin/python voice.py lines                                       # every line in voice/lines.in.json
    .venv/bin/python voice.py check                                       # speech-to-text of every line vs. the script

Engines: kokoro (Kokoro-82M, voices ef_dora / em_alex / em_santa), piper (es_ES voices in models/piper), say (macOS).
`lines` reads voice/lines.in.json (written by `node voice-lines.mjs script`, from scenes.mjs) and writes
voice/NN-<beat>.wav, the same files a recorded voice would replace. A line is only regenerated when its spoken text
(`say`), engine, voice or speed changes. `check` needs the trimmed copies that compose.mjs/capture.mjs make.
"""

import hashlib
import json
import re
import unicodedata
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
MODELS = HERE / "models"
VOICE_DIR = HERE / "voice"
LINES_IN = VOICE_DIR / "lines.in.json"
KEYS = VOICE_DIR / ".keys.json"
SR = 48000


def resample(audio, sr):
    if sr == SR:
        return audio.astype(np.float32)
    with tempfile.TemporaryDirectory() as d:
        a, b = Path(d) / "a.wav", Path(d) / "b.wav"
        sf.write(a, audio, sr)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", a, "-ar", str(SR), "-af", "aresample=filter_size=64", b], check=True)
        out, _ = sf.read(b, dtype="float32")
        return out


_kokoro = {}


def tts_kokoro(text, voice, speed):
    from kokoro import KPipeline

    if "p" not in _kokoro:
        _kokoro["p"] = KPipeline(lang_code="e", repo_id="hexgrad/Kokoro-82M")
    parts = [np.asarray(a, dtype=np.float32) for _, _, a in _kokoro["p"](text, voice=voice, speed=speed, split_pattern=None)]
    return np.concatenate(parts), 24000


def tts_piper(text, voice, speed):
    from piper import PiperVoice, SynthesisConfig

    key = "piper:" + voice
    if key not in _kokoro:
        _kokoro[key] = PiperVoice.load(str(MODELS / "piper" / f"{voice}.onnx"))
    v = _kokoro[key]
    cfg = SynthesisConfig(length_scale=1 / speed, noise_scale=0.6, noise_w_scale=0.7)
    chunks = [c.audio_float_array for c in v.synthesize(text, syn_config=cfg)]
    return np.concatenate(chunks), v.config.sample_rate


def tts_say(text, voice, speed):
    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / "s.aiff"
        subprocess.run(["say", "-v", voice, "-r", str(int(175 * speed)), "-o", f, text], check=True)
        g = Path(d) / "s.wav"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", f, g], check=True)
        a, sr = sf.read(g, dtype="float32")
        return a, sr


ENGINES = {"kokoro": tts_kokoro, "piper": tts_piper, "say": tts_say}


def trim(a, keep=0.04, thresh_db=-45):
    """Cut leading/trailing silence, keeping `keep` s on each side."""
    if a.ndim > 1:
        a = a.mean(axis=1)
    win = int(SR * 0.01)
    n = len(a) // win
    rms = np.sqrt(np.mean(a[: n * win].reshape(n, win) ** 2, axis=1) + 1e-12)
    loud = np.where(20 * np.log10(rms) > thresh_db)[0]
    if not len(loud):
        return a
    s = max(0, loud[0] * win - int(keep * SR))
    e = min(len(a), (loud[-1] + 1) * win + int(keep * SR))
    out = a[s:e].copy()
    fade = int(0.01 * SR)
    out[:fade] *= np.linspace(0, 1, fade)
    out[-fade:] *= np.linspace(1, 0, fade)
    return out


def longest_pause(a, thresh_db=-45):
    win = int(SR * 0.01)
    n = len(a) // win
    rms = np.sqrt(np.mean(a[: n * win].reshape(n, win) ** 2, axis=1) + 1e-12)
    quiet = 20 * np.log10(rms) <= thresh_db
    best = cur = 0
    for q in quiet:
        cur = cur + 1 if q else 0
        best = max(best, cur)
    return best * 0.01


def synth(engine, voice, speed, text):
    a, sr = ENGINES[engine](text, voice, speed)
    a = resample(np.asarray(a, dtype=np.float32), sr)
    a = trim(a)
    peak = float(np.max(np.abs(a))) or 1.0
    return a * (0.89 / peak)  # −1 dBFS peak per line; the mix sets the final level


def cmd_sample(engine, voice, out, text):
    a = synth(engine, voice, 1.0, text)
    sf.write(out, a, SR, subtype="PCM_16")
    print(f"{out}: {len(a) / SR:.2f}s")


def cmd_lines():
    spec = json.loads(LINES_IN.read_text())
    engine, voice, speed = spec["engine"], spec["voice"], spec.get("speed", 1.0)
    keys = json.loads(KEYS.read_text()) if KEYS.exists() else {}
    total = 0.0
    for line in spec["lines"]:
        key = hashlib.sha1(f"{engine}|{voice}|{speed}|{line['say']}".encode()).hexdigest()[:12]
        wav = VOICE_DIR / f"{line['id']}.wav"
        if keys.get(line["id"]) == key and wav.exists():
            a, _ = sf.read(wav, dtype="float32")
        else:
            a = synth(engine, voice, speed, line["say"])
            sf.write(wav, a, SR, subtype="PCM_16")
            keys[line["id"]] = key
            print(f"  ✓ {line['id']} {len(a) / SR:.2f}s (longest pause {longest_pause(a):.2f}s)")
        total += len(a) / SR
    KEYS.write_text(json.dumps(keys, indent=1))
    print(f"{len(spec['lines'])} lines, {total:.1f}s of speech ({engine} {voice} ×{speed}) in voice/")


def words(t):
    t = unicodedata.normalize("NFKD", t.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.findall(r"[a-z0-9ñ]+", t)


def wer(ref, hyp):
    r, h = words(ref), words(hyp)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev, d[j] = d[j], cur
    return d[len(h)], len(r)


def transcribe(f, model="mlx-community/whisper-large-v3-turbo", **kw):
    import mlx_whisper

    return mlx_whisper.transcribe(str(f), path_or_hf_repo=model, language="es", **kw)


def cmd_check():
    """Speech-to-text of every trimmed line (composition/assets/voice) against its text; numbers are compared as said."""
    spec = json.loads(LINES_IN.read_text())
    report, errs, n = [], 0, 0
    for line in spec["lines"]:
        f = HERE / "composition/assets/voice" / f"{line['id']}.wav"
        heard = transcribe(f)["text"].strip()
        e, k = wer(line["say"], heard)
        e2, _ = wer(line["text"], heard)
        e = min(e, e2)  # whisper may write numbers as digits or as words
        errs, n = errs + e, n + k
        report.append({"id": line["id"], "text": line["text"], "heard": heard, "errors": e, "words": k})
        print(f"{'OK ' if e == 0 else 'DIFF'} {line['id']}  ({e}/{k})" + ("" if e == 0 else f"\n   script: {line['text']}\n   heard:  {heard}"))
    (VOICE_DIR / "check.json").write_text(json.dumps(report, ensure_ascii=False, indent=1))
    print(f"word errors: {errs}/{n} ({100 * errs / max(n, 1):.1f}%)")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "sample":
        cmd_sample(*sys.argv[2:6])
    elif cmd == "lines":
        cmd_lines()
    elif cmd == "check":
        cmd_check()
    else:
        print(__doc__)
