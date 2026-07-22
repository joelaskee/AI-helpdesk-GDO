"""Pipeline di elaborazione chiamata: trascrizione -> coerenza -> sintesi.

Eseguita in un worker a thread singolo (whisper su CPU: evitiamo elaborazioni parallele).
"""

import logging
import traceback
from concurrent.futures import ThreadPoolExecutor

from ..db import SessionLocal
from ..models import Call
from . import llm, pdv, transcription

log = logging.getLogger("pipeline")

_executor = ThreadPoolExecutor(max_workers=1)


def enqueue(call_id: str):
    _executor.submit(_process, call_id)


def _set(call_id: str, **fields):
    with SessionLocal() as db:
        call = db.get(Call, call_id)
        if call is None:
            return
        for k, v in fields.items():
            setattr(call, k, v)
        db.commit()


def _process(call_id: str):
    try:
        with SessionLocal() as db:
            call = db.get(Call, call_id)
            if call is None:
                return
            audio_path = call.audio_path

        # 1. Trascrizione
        _set(call_id, status="transcribing", error=None)
        result = transcription.transcribe(audio_path)
        _set(
            call_id,
            transcript_text=result["text"],
            segments=result["segments"],
            duration_sec=result.get("duration"),
            engine=result["engine"],
            status="analyzing",
        )

        transcript = result["text"]
        if not transcript.strip():
            _set(call_id, status="error", error="Trascrizione vuota: nessun parlato rilevato")
            return

        # 2. Riconoscimento punto vendita dal codice pronunciato
        try:
            store_match = pdv.identify(transcript)
        except Exception as e:
            log.warning("identificazione PDV fallita: %s", e)
            store_match = {"error": str(e)}
        _set(call_id, store_match=store_match)

        # 3. Verifica di coerenza della trascrizione
        try:
            coherence = llm.coherence_check(transcript)
        except Exception as e:
            log.warning("coherence_check fallita: %s", e)
            coherence = {"error": str(e)}
        _set(call_id, coherence=coherence)

        # 4. Sintesi e punti chiave
        try:
            summary = llm.summarize(transcript)
        except Exception as e:
            log.warning("summarize fallita: %s", e)
            summary = {"error": str(e)}
        _set(call_id, summary=summary, status="done")

    except Exception as e:
        log.error("pipeline fallita per %s: %s", call_id, traceback.format_exc())
        _set(call_id, status="error", error=str(e))


def run_completeness(call_id: str):
    """Confronto ticket CRM vs trascrizione (chiamata on-demand dalla UI)."""
    with SessionLocal() as db:
        call = db.get(Call, call_id)
        if call is None or not call.transcript_text or not call.ticket:
            return
    try:
        result = llm.completeness_check(call.transcript_text, call.ticket)
    except Exception as e:
        result = {"error": str(e)}
    _set(call_id, completeness=result)
