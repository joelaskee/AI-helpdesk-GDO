# Helpdesk Call Intelligence — Prototipo

Prototipo per l'analisi delle telefonate dell'helpdesk tecnico (GDO, fonia Asterisk):

1. **Trascrizione** della conversazione (faster-whisper su CPU; predisposto per Voxtral+vLLM)
2. **Verifica qualità trascrizione**: un LLM segnala punti incoerenti o privi di senso
3. **Sintesi** con riassunto e punti chiave emersi
4. **CRM ticketing simulato** + **percentuale di completezza**: confronto tra quanto scritto dall'operatore e quanto emerso in chiamata
5. **Riconoscimento punto vendita (PDV)**: dal codice negozio pronunciato nella chiamata, identifica il negozio confrontandolo con l'anagrafica importata da Excel

## Riconoscimento punto vendita

Nelle chiamate l'utente si identifica con il codice del proprio negozio. Il sistema lo riconosce con approccio **ibrido**:

1. estrazione dei codici dal testo con regex (cifre, anche pronunciate spaziate: "3 9 2 7 2");
2. estrazione via LLM dei numeri detti a voce ("tre nove due sette cinque" → "39275");
3. **lookup deterministico** sull'anagrafica: un negozio è confermato solo se il codice esiste davvero in tabella (l'LLM propone, non inventa).

Carica l'anagrafica dalla UI (**🏬 Carica anagrafica PDV**) con l'Excel dei negozi. Colonne attese: `Nome Pdv` (codice), `Intestazione PDV`, `Cognome`, `Via indirizzo postale`, `Città indirizzo postale`, `Tipo PDV`. Per le chiamate già trascritte prima del caricamento, usa 🔄 sulla card "Punto vendita" per ri-riconoscere.

## Architettura

| Servizio  | Tecnologia              | Porta host |
|-----------|-------------------------|------------|
| frontend  | React + Vite + nginx    | **47180**  |
| backend   | FastAPI + faster-whisper| **47181**  |
| db        | Postgres 16             | **47182**  |

L'LLM gira **fuori da Docker**: Ollama sul Mac host, raggiunto via `host.docker.internal:11434`.

## Prerequisiti

- Docker Desktop
- Ollama attivo sul Mac con il modello configurato:

```bash
ollama pull ministral-3     # oppure il nome esatto che hai (vedi: ollama list)
```

> Se il nome del modello nel tuo Ollama è diverso (es. `ministral-8b`, `mistral`),
> imposta `OLLAMA_MODEL` nel file `.env`.

## Avvio

```bash
cd helpdesk-ai
cp .env.example .env        # opzionale, per personalizzare
docker compose up --build
```

Poi apri **http://localhost:47180**

Al primo avvio il backend scarica il modello Whisper `medium` (~1.5 GB, cache persistente in volume Docker).

## Uso

1. Clicca **🎙️ Registra dal microfono** e simula una chiamata utente↔operatore (o carica un file audio, es. registrazione MixMonitor di Asterisk)
2. Il sistema trascrive → verifica coerenza → genera la sintesi (aggiornamento automatico)
3. Compila il **ticket CRM simulato** come farebbe l'operatore e salva
4. Clicca **📊 Verifica completezza**: ottieni percentuale, info mancanti e discrepanze

Nota: il microfono nel browser funziona su `http://localhost` (contesto sicuro). Se accedi da un altro host serve HTTPS.

## Passaggio a Voxtral (altro PC con vLLM)

Nel `.env`:

```bash
TRANSCRIBE_ENGINE=voxtral
VOXTRAL_BASE_URL=http://host.docker.internal:8000/v1
VOXTRAL_MODEL=mistralai/Voxtral-Small-24B-2507
```

Il campo `engine` salvato su ogni chiamata permette di confrontare la qualità dei due motori sulla stessa conversazione (ricarica lo stesso audio con motore diverso).

## Variabili principali (`.env`)

| Variabile              | Default                              | Note                          |
|------------------------|--------------------------------------|-------------------------------|
| `OLLAMA_MODEL`         | `ministral-3`                        | modello per sintesi/analisi   |
| `WHISPER_MODEL`        | `medium`                             | `small`/`medium`/`large-v3`   |
| `WHISPER_COMPUTE_TYPE` | `int8`                               | quantizzazione su CPU         |
| `TRANSCRIBE_ENGINE`    | `faster-whisper`                     | oppure `voxtral`              |

## API principali

- `POST /api/calls` — upload audio, avvia la pipeline
- `GET /api/calls/{id}` — stato + trascrizione + coerenza + sintesi + ticket + completezza
- `PUT /api/calls/{id}/ticket` — salva il ticket CRM
- `POST /api/calls/{id}/completeness` — confronto ticket vs conversazione
- `POST /api/calls/{id}/reprocess` — rielabora l'audio (utile per confronto motori)
- `GET /api/health` — stato backend + raggiungibilità Ollama
