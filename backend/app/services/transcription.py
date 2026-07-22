"""Trascrizione audio.

Due motori, selezionabili con TRANSCRIBE_ENGINE:
- faster-whisper (default): locale, su CPU
- voxtral: endpoint OpenAI-compatible (vLLM) via VOXTRAL_BASE_URL
"""

import os
import threading

import httpx

ENGINE = os.environ.get("TRANSCRIBE_ENGINE", "faster-whisper")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "medium")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
VOXTRAL_BASE_URL = os.environ.get("VOXTRAL_BASE_URL", "")
VOXTRAL_MODEL = os.environ.get("VOXTRAL_MODEL", "")
LANGUAGE = os.environ.get("LANGUAGE", "it")

_model = None
_model_lock = threading.Lock()


def _get_whisper_model():
    global _model
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel

            _model = WhisperModel(
                WHISPER_MODEL, device="cpu", compute_type=WHISPER_COMPUTE_TYPE
            )
        return _model


def _transcribe_whisper(audio_path: str):
    model = _get_whisper_model()
    seg_iter, info = model.transcribe(
        audio_path,
        language=LANGUAGE,
        vad_filter=True,
        beam_size=5,
    )
    segments = []
    parts = []
    for s in seg_iter:
        text = s.text.strip()
        segments.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": text})
        parts.append(text)
    return {
        "text": " ".join(parts),
        "segments": segments,
        "duration": round(info.duration, 2),
        "engine": f"faster-whisper:{WHISPER_MODEL}",
    }


def _transcribe_voxtral(audio_path: str):
    if not VOXTRAL_BASE_URL:
        raise RuntimeError("VOXTRAL_BASE_URL non configurato")
    url = VOXTRAL_BASE_URL.rstrip("/") + "/audio/transcriptions"
    with open(audio_path, "rb") as f:
        resp = httpx.post(
            url,
            data={"model": VOXTRAL_MODEL, "language": LANGUAGE},
            files={"file": (os.path.basename(audio_path), f)},
            timeout=600,
        )
    resp.raise_for_status()
    data = resp.json()
    return {
        "text": data.get("text", ""),
        "segments": data.get("segments") or [],
        "duration": data.get("duration"),
        "engine": f"voxtral:{VOXTRAL_MODEL}",
    }


def transcribe(audio_path: str) -> dict:
    if ENGINE == "voxtral":
        return _transcribe_voxtral(audio_path)
    return _transcribe_whisper(audio_path)
