"""Integrazione LLM via Ollama (ministral) per sintesi, coerenza e completezza."""

import json
import os
import re

import httpx

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://host.docker.internal:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "ministral-3")


def _chat_json(system: str, user: str) -> dict:
    resp = httpx.post(
        OLLAMA_BASE_URL.rstrip("/") + "/api/chat",
        json={
            "model": OLLAMA_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "format": "json",
            "stream": False,
            "options": {"temperature": 0.1, "num_ctx": 8192},
        },
        timeout=300,
    )
    if resp.status_code == 404:
        info = check_ollama()
        available = ", ".join(info.get("available_models", [])) or "nessuno"
        raise RuntimeError(
            f"Modello '{OLLAMA_MODEL}' non trovato su Ollama. "
            f"Modelli disponibili: {available}. "
            f"Imposta OLLAMA_MODEL nel .env con il nome esatto (vedi 'ollama list') "
            f"e riavvia: docker compose up -d backend"
        )
    resp.raise_for_status()
    content = resp.json()["message"]["content"]
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", content, re.DOTALL)
        if m:
            return json.loads(m.group(0))
        raise


def check_ollama() -> dict:
    try:
        r = httpx.get(OLLAMA_BASE_URL.rstrip("/") + "/api/tags", timeout=5)
        r.raise_for_status()
        models = [m["name"] for m in r.json().get("models", [])]
        return {"reachable": True, "model": OLLAMA_MODEL, "available_models": models}
    except Exception as e:
        return {"reachable": False, "model": OLLAMA_MODEL, "error": str(e)}


def coherence_check(transcript: str) -> dict:
    system = (
        "Sei un revisore di trascrizioni automatiche di telefonate di helpdesk tecnico "
        "in italiano (GDO, supporto sistemistico). Valuti se la trascrizione è coerente "
        "o se contiene punti privi di senso, parole inventate, frasi troncate o errori "
        "evidenti di riconoscimento vocale. Rispondi SOLO in JSON."
    )
    user = f"""Analizza questa trascrizione e restituisci un JSON con questa struttura:
{{
  "score": <intero 0-100, 100 = perfettamente coerente>,
  "verdetto": "<affidabile | dubbia | inaffidabile>",
  "problemi": [{{"testo": "<frammento sospetto>", "motivo": "<perché sembra un errore di trascrizione>"}}],
  "commento": "<breve valutazione complessiva>"
}}

TRASCRIZIONE:
{transcript}"""
    return _chat_json(system, user)


def summarize(transcript: str) -> dict:
    system = (
        "Sei un assistente per l'helpdesk tecnico sistemistico di una GDO. Analizzi le "
        "trascrizioni delle telefonate tra utente e operatore e ne estrai una sintesi "
        "strutturata. Rispondi SOLO in JSON, in italiano."
    )
    user = f"""Analizza questa telefonata di helpdesk e restituisci un JSON con questa struttura:
{{
  "riassunto": "<riassunto della chiamata in 3-5 frasi>",
  "problema": "<descrizione del problema segnalato>",
  "punti_chiave": ["<punto importante emerso>", ...],
  "dispositivi_sistemi": ["<dispositivi/sistemi/applicativi citati (casse, POS, stampanti, gestionale, rete...)>"],
  "sede_reparto": "<negozio/sede/reparto se citati, altrimenti null>",
  "azioni_svolte": ["<azioni fatte dall'operatore durante la chiamata>"],
  "risoluzione": "<risolto | non risolto | parzialmente risolto | escalation>",
  "followup": ["<eventuali azioni da fare dopo la chiamata>"]
}}

TRASCRIZIONE:
{transcript}"""
    return _chat_json(system, user)


def completeness_check(transcript: str, ticket: dict) -> dict:
    system = (
        "Sei un auditor di qualità per l'helpdesk tecnico di una GDO. Confronti ciò che "
        "l'operatore ha scritto sul CRM di ticketing con ciò che è realmente emerso nella "
        "telefonata, e misuri quanto è completo il ticket. Rispondi SOLO in JSON, in italiano."
    )
    user = f"""Confronta la trascrizione della telefonata con il ticket compilato dall'operatore.
Identifica le informazioni rilevanti emerse in chiamata (problema, dispositivi, sede, azioni, esito, follow-up, dettagli utili) e verifica quali sono state riportate sul ticket.

Restituisci un JSON con questa struttura:
{{
  "score": <intero 0-100, percentuale di completezza del ticket rispetto alla chiamata>,
  "presenti": ["<informazione emersa in chiamata e correttamente riportata nel ticket>"],
  "mancanti": ["<informazione rilevante emersa in chiamata ma assente nel ticket>"],
  "discrepanze": ["<informazione nel ticket che contraddice o distorce quanto detto in chiamata>"],
  "commento": "<valutazione sintetica della qualità della compilazione>"
}}

TICKET CRM COMPILATO DALL'OPERATORE:
{json.dumps(ticket, ensure_ascii=False, indent=2)}

TRASCRIZIONE DELLA TELEFONATA:
{transcript}"""
    return _chat_json(system, user)
