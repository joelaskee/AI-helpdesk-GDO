"""Riconoscimento del punto vendita (PDV) a partire dalla trascrizione.

Strategia ibrida:
1. Estrazione candidati con regex (sequenze di cifre nel testo).
2. Estrazione via LLM dei codici pronunciati a voce (numeri scritti in lettere,
   cifre separate, "codice negozio ...", ecc.), normalizzati in cifre.
3. Lookup DETERMINISTICO sull'anagrafica PDV: un match è valido solo se il codice
   esiste davvero in tabella. L'LLM non "inventa" negozi, li propone soltanto.
"""

import json
import re

from sqlalchemy import select

from ..db import SessionLocal
from ..models import Pdv
from . import llm


def _regex_candidates(text: str, lengths) -> set[str]:
    found = set()
    for m in re.findall(r"\d[\d\.\s]{2,}\d", text):
        digits = re.sub(r"\D", "", m)
        if len(digits) in lengths:
            found.add(digits)
    # anche singole run di cifre attaccate
    for m in re.findall(r"\d+", text):
        if len(m) in lengths:
            found.add(m)
    return found


def _llm_candidates(text: str) -> list[str]:
    system = (
        "Sei un estrattore di codici punto vendita da telefonate di helpdesk di una GDO. "
        "Nelle chiamate l'utente si identifica dicendo il codice del negozio, che può essere "
        "pronunciato come numero intero, cifra per cifra, o in lettere. Rispondi SOLO in JSON."
    )
    user = f"""Individua nel testo eventuali CODICI NEGOZIO / punto vendita menzionati
(di solito numeri di 4-6 cifre). Converti in cifre i numeri pronunciati a voce.
Esempi: "tre nove due sette cinque" -> "39275"; "trentanovemila duecentosettantacinque" -> "39275".

Restituisci JSON:
{{"codici": ["<solo cifre>", ...]}}
Se non ci sono codici, restituisci {{"codici": []}}.

TESTO:
{text}"""
    try:
        data = llm._chat_json(system, user)
        out = []
        for c in data.get("codici", []):
            digits = re.sub(r"\D", "", str(c))
            if digits:
                out.append(digits)
        return out
    except Exception:
        return []


def identify(transcript: str) -> dict:
    """Ritorna {codici_rilevati, matches[], ambiguo, note}."""
    if not transcript or not transcript.strip():
        return {"codici_rilevati": [], "matches": [], "ambiguo": False}

    with SessionLocal() as db:
        codici_validi = {row[0] for row in db.execute(select(Pdv.codice)).all()}

    if not codici_validi:
        return {
            "codici_rilevati": [],
            "matches": [],
            "ambiguo": False,
            "note": "Anagrafica PDV non caricata: importa l'Excel dei negozi.",
        }

    lengths = {len(c) for c in codici_validi}
    candidates = _regex_candidates(transcript, lengths)
    candidates.update(_llm_candidates(transcript))

    matched_codes = [c for c in candidates if c in codici_validi]
    matched_codes = sorted(set(matched_codes))

    matches = []
    if matched_codes:
        with SessionLocal() as db:
            for code in matched_codes:
                pdv = db.get(Pdv, code)
                if pdv:
                    matches.append(pdv.to_dict())

    return {
        "codici_rilevati": sorted(candidates),
        "matches": matches,
        "ambiguo": len(matches) > 1,
    }


def import_rows(rows: list[dict]) -> int:
    """rows: lista di dict con chiavi codice/intestazione/cognome/indirizzo/citta/tipo."""
    n = 0
    with SessionLocal() as db:
        for r in rows:
            code = str(r.get("codice") or "").strip()
            if not code:
                continue
            pdv = db.get(Pdv, code)
            if pdv is None:
                pdv = Pdv(codice=code)
                db.add(pdv)
            pdv.intestazione = r.get("intestazione")
            pdv.cognome = r.get("cognome")
            pdv.indirizzo = r.get("indirizzo")
            pdv.citta = r.get("citta")
            pdv.tipo = r.get("tipo")
            n += 1
        db.commit()
    return n


def count() -> int:
    with SessionLocal() as db:
        return db.query(Pdv).count()
