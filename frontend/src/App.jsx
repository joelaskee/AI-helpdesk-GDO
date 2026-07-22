import React, { useEffect, useRef, useState, useCallback } from 'react'
import { api } from './api.js'

const EMPTY_TICKET = {
  categoria: 'Hardware',
  priorita: 'Media',
  negozio_sede: '',
  chiamante: '',
  oggetto: '',
  descrizione_problema: '',
  azioni_svolte: '',
  esito: 'Risolto',
  note: '',
}

const STATUS_LABEL = {
  uploaded: 'In coda',
  transcribing: 'Trascrizione…',
  analyzing: 'Analisi LLM…',
  done: 'Completata',
  error: 'Errore',
}

function fmtTime(s) {
  if (s == null) return ''
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

function scoreColor(score) {
  if (score == null) return 'var(--muted)'
  if (score >= 80) return 'var(--green)'
  if (score >= 50) return 'var(--yellow)'
  return 'var(--red)'
}

/* ---------- Registrazione microfono ---------- */
function Recorder({ onDone }) {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const mediaRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(
        (t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)
      )
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const type = rec.mimeType || 'audio/webm'
        const ext = type.includes('mp4') ? 'mp4' : 'webm'
        const blob = new Blob(chunksRef.current, { type })
        const file = new File([blob], `chiamata-${Date.now()}.${ext}`, { type })
        onDone(file)
      }
      mediaRef.current = rec
      rec.start()
      setElapsed(0)
      setRecording(true)
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
    } catch (err) {
      alert('Microfono non disponibile: ' + err.message)
    }
  }

  const stop = () => {
    clearInterval(timerRef.current)
    setRecording(false)
    mediaRef.current?.stop()
  }

  return (
    <div className="recorder">
      {!recording ? (
        <button className="btn primary" onClick={start}>🎙️ Registra dal microfono</button>
      ) : (
        <button className="btn danger" onClick={stop}>
          ⏹ Ferma ({fmtTime(elapsed)})
        </button>
      )}
    </div>
  )
}

/* ---------- Lista chiamate ---------- */
function CallList({ calls, selectedId, onSelect, onDelete }) {
  if (!calls.length) return <p className="muted small">Nessuna chiamata. Registra o carica un audio.</p>
  return (
    <ul className="call-list">
      {calls.map((c) => (
        <li
          key={c.id}
          className={c.id === selectedId ? 'selected' : ''}
          onClick={() => onSelect(c.id)}
        >
          <div className="call-row">
            <span className={`dot ${c.status}`} title={STATUS_LABEL[c.status]} />
            <div className="call-info">
              <span className="call-name">{c.original_filename || c.id.slice(0, 8)}</span>
              <span className="muted small">
                {new Date(c.created_at).toLocaleString('it-IT')}
                {c.duration_sec ? ` · ${fmtTime(c.duration_sec)}` : ''}
              </span>
            </div>
            {c.completeness_score != null && (
              <span className="badge" style={{ background: scoreColor(c.completeness_score) }}>
                {c.completeness_score}%
              </span>
            )}
            <button
              className="icon-btn"
              title="Elimina"
              onClick={(e) => { e.stopPropagation(); onDelete(c.id) }}
            >✕</button>
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ---------- Pannello analisi (trascrizione, coerenza, sintesi) ---------- */
function AnalysisPanel({ call, onChanged }) {
  const [tab, setTab] = useState('transcript')
  if (!call) return <div className="panel empty">Seleziona una chiamata</div>

  const reprocess = async () => {
    try { await api.reprocess(call.id); onChanged() }
    catch (e) { alert(e.message) }
  }

  const s = call.summary || {}
  const coh = call.coherence || {}

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Chiamata {call.original_filename || call.id.slice(0, 8)}</h2>
        <span className={`status-pill ${call.status}`}>{STATUS_LABEL[call.status]}</span>
        {call.engine && <span className="muted small">motore: {call.engine}</span>}
      </div>

      {call.status === 'error' && (
        <div className="alert red">
          {call.error}
          <button className="btn" style={{ width: 'auto', marginLeft: 10, padding: '4px 10px' }} onClick={reprocess}>
            🔄 Rielabora
          </button>
        </div>
      )}
      {call.status === 'done' && (
        <button className="icon-btn" style={{ fontSize: 12 }} onClick={reprocess} title="Riesegui trascrizione e analisi">
          🔄 Rielabora
        </button>
      )}
      {['uploaded', 'transcribing', 'analyzing'].includes(call.status) && (
        <div className="alert info">Elaborazione in corso… la pagina si aggiorna da sola.</div>
      )}

      <audio controls src={api.audioUrl(call.id)} className="audio-player" />

      <div className="tabs">
        <button className={tab === 'transcript' ? 'active' : ''} onClick={() => setTab('transcript')}>
          Trascrizione
        </button>
        <button className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>
          Sintesi
        </button>
        <button className={tab === 'coherence' ? 'active' : ''} onClick={() => setTab('coherence')}>
          Qualità trascrizione
          {coh.score != null && (
            <span className="badge" style={{ background: scoreColor(coh.score) }}>{coh.score}</span>
          )}
        </button>
      </div>

      {tab === 'transcript' && (
        <div className="tab-body">
          {call.segments?.length ? (
            call.segments.map((seg, i) => (
              <p key={i} className="segment">
                <span className="ts">{fmtTime(seg.start)}</span> {seg.text}
              </p>
            ))
          ) : call.transcript_text ? (
            <p>{call.transcript_text}</p>
          ) : (
            <p className="muted">Trascrizione non ancora disponibile.</p>
          )}
        </div>
      )}

      {tab === 'summary' && (
        <div className="tab-body">
          {s.riassunto ? (
            <>
              <h3>Riassunto</h3>
              <p>{s.riassunto}</p>
              {s.problema && (<><h3>Problema</h3><p>{s.problema}</p></>)}
              {s.punti_chiave?.length > 0 && (
                <>
                  <h3>Punti chiave</h3>
                  <ul>{s.punti_chiave.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </>
              )}
              {s.dispositivi_sistemi?.length > 0 && (
                <>
                  <h3>Dispositivi / sistemi citati</h3>
                  <p>{s.dispositivi_sistemi.join(', ')}</p>
                </>
              )}
              {s.sede_reparto && (<><h3>Sede / reparto</h3><p>{s.sede_reparto}</p></>)}
              {s.azioni_svolte?.length > 0 && (
                <>
                  <h3>Azioni svolte</h3>
                  <ul>{s.azioni_svolte.map((a, i) => <li key={i}>{a}</li>)}</ul>
                </>
              )}
              {s.risoluzione && (<><h3>Esito</h3><p>{s.risoluzione}</p></>)}
              {s.followup?.length > 0 && (
                <>
                  <h3>Follow-up</h3>
                  <ul>{s.followup.map((f, i) => <li key={i}>{f}</li>)}</ul>
                </>
              )}
            </>
          ) : s.error ? (
            <div className="alert red">Errore LLM: {s.error}</div>
          ) : (
            <p className="muted">Sintesi non ancora disponibile.</p>
          )}
        </div>
      )}

      {tab === 'coherence' && (
        <div className="tab-body">
          {coh.score != null ? (
            <>
              <p>
                Coerenza: <strong style={{ color: scoreColor(coh.score) }}>{coh.score}/100</strong>
                {coh.verdetto && <> — verdetto: <strong>{coh.verdetto}</strong></>}
              </p>
              {coh.commento && <p>{coh.commento}</p>}
              {coh.problemi?.length > 0 && (
                <>
                  <h3>Punti sospetti</h3>
                  <ul>
                    {coh.problemi.map((p, i) => (
                      <li key={i}><em>"{p.testo}"</em> — {p.motivo}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : coh.error ? (
            <div className="alert red">Errore LLM: {coh.error}</div>
          ) : (
            <p className="muted">Verifica non ancora disponibile.</p>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- CRM simulato + completezza ---------- */
function TicketPanel({ call, onSaved }) {
  const [ticket, setTicket] = useState(EMPTY_TICKET)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    setTicket(call?.ticket || EMPTY_TICKET)
  }, [call?.id, call?.ticket])

  if (!call) return null
  const comp = call.completeness

  const set = (k) => (e) => setTicket({ ...ticket, [k]: e.target.value })

  const save = async () => {
    setSaving(true)
    try {
      await api.saveTicket(call.id, ticket)
      onSaved()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) { alert('Salvataggio fallito: ' + e.message) }
    finally { setSaving(false) }
  }

  const check = async () => {
    setChecking(true)
    try { await api.runCompleteness(call.id); onSaved() }
    catch (e) { alert(e.message) }
    finally { setChecking(false) }
  }

  return (
    <div className="panel crm">
      <div className="panel-head">
        <h2>🎫 CRM Ticketing (simulato)</h2>
      </div>
      <p className="muted small">
        Compila come farebbe l'operatore a fine chiamata, poi verifica la completezza rispetto alla conversazione.
      </p>

      <div className="form-grid">
        <label>Categoria
          <select value={ticket.categoria} onChange={set('categoria')}>
            {['Hardware', 'Software', 'Rete', 'Casse/POS', 'Stampanti', 'Gestionale', 'Utenze/Accessi', 'Altro'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>Priorità
          <select value={ticket.priorita} onChange={set('priorita')}>
            {['Bassa', 'Media', 'Alta', 'Critica'].map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label>Negozio / sede
          <input value={ticket.negozio_sede} onChange={set('negozio_sede')} placeholder="es. PdV 042 Milano" />
        </label>
        <label>Chiamante
          <input value={ticket.chiamante} onChange={set('chiamante')} placeholder="es. Capo reparto casse" />
        </label>
        <label className="full">Oggetto
          <input value={ticket.oggetto} onChange={set('oggetto')} placeholder="Sintesi breve del problema" />
        </label>
        <label className="full">Descrizione problema
          <textarea rows={3} value={ticket.descrizione_problema} onChange={set('descrizione_problema')} />
        </label>
        <label className="full">Azioni svolte
          <textarea rows={3} value={ticket.azioni_svolte} onChange={set('azioni_svolte')} />
        </label>
        <label>Esito
          <select value={ticket.esito} onChange={set('esito')}>
            {['Risolto', 'Non risolto', 'Parzialmente risolto', 'Escalation'].map((e) => <option key={e}>{e}</option>)}
          </select>
        </label>
        <label>Note
          <input value={ticket.note} onChange={set('note')} />
        </label>
      </div>

      <div className="actions">
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? 'Salvataggio…' : saved ? '✓ Salvato' : '💾 Salva ticket'}
        </button>
        <button
          className="btn primary"
          onClick={check}
          disabled={checking || !call.ticket || !call.transcript_text}
          title={!call.ticket ? 'Salva prima il ticket' : !call.transcript_text ? 'Attendi la trascrizione' : ''}
        >
          {checking ? 'Analisi in corso…' : '📊 Verifica completezza'}
        </button>
      </div>

      {comp && (
        <div className="completeness">
          {comp.error ? (
            <div className="alert red">Errore LLM: {comp.error}</div>
          ) : (
            <>
              <div className="score-ring" style={{ borderColor: scoreColor(comp.score) }}>
                <span style={{ color: scoreColor(comp.score) }}>{comp.score}%</span>
                <small>completezza</small>
              </div>
              {comp.commento && <p>{comp.commento}</p>}
              {comp.presenti?.length > 0 && (
                <>
                  <h3 style={{ color: 'var(--green)' }}>✓ Riportate nel ticket</h3>
                  <ul>{comp.presenti.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </>
              )}
              {comp.mancanti?.length > 0 && (
                <>
                  <h3 style={{ color: 'var(--red)' }}>✗ Mancanti nel ticket</h3>
                  <ul>{comp.mancanti.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </>
              )}
              {comp.discrepanze?.length > 0 && (
                <>
                  <h3 style={{ color: 'var(--yellow)' }}>⚠ Discrepanze</h3>
                  <ul>{comp.discrepanze.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- App ---------- */
export default function App() {
  const [health, setHealth] = useState(null)
  const [calls, setCalls] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [call, setCall] = useState(null)
  const fileRef = useRef(null)

  const refreshList = useCallback(() => {
    api.listCalls().then(setCalls).catch(() => {})
  }, [])

  const refreshCall = useCallback(() => {
    if (selectedId) api.getCall(selectedId).then(setCall).catch(() => setCall(null))
    else setCall(null)
  }, [selectedId])

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null))
    refreshList()
  }, [refreshList])

  useEffect(() => { refreshCall() }, [refreshCall])

  // polling finché la chiamata selezionata è in elaborazione
  useEffect(() => {
    const busy = call && ['uploaded', 'transcribing', 'analyzing'].includes(call.status)
    if (!busy) return
    const t = setInterval(() => { refreshCall(); refreshList() }, 3000)
    return () => clearInterval(t)
  }, [call, refreshCall, refreshList])

  const upload = async (file) => {
    try {
      const res = await api.uploadAudio(file)
      refreshList()
      setSelectedId(res.id)
    } catch (e) {
      alert('Upload fallito: ' + e.message)
    }
  }

  const del = async (id) => {
    if (!confirm('Eliminare la chiamata?')) return
    await api.deleteCall(id)
    if (id === selectedId) setSelectedId(null)
    refreshList()
  }

  const ollamaOk = health?.ollama?.reachable
  const ollamaModel = health?.ollama?.model
  const availableModels = health?.ollama?.available_models || []
  const modelFound =
    !ollamaOk ||
    availableModels.some((m) => m === ollamaModel || m.startsWith(ollamaModel + ':'))

  return (
    <div className="app">
      <header>
        <h1>📞 Helpdesk Call Intelligence</h1>
        <div className="health">
          <span>{health ? `STT: ${health.transcribe_engine} (${health.whisper_model})` : 'backend…'}</span>
          <span className={`dot ${ollamaOk ? 'done' : 'error'}`} />
          <span>
            {ollamaOk
              ? `Ollama: ${health.ollama.model}`
              : 'Ollama non raggiungibile'}
          </span>
        </div>
      </header>

      {ollamaOk && !modelFound && (
        <div className="alert red" style={{ margin: '10px 16px 0' }}>
          ⚠ Il modello "{ollamaModel}" non esiste su Ollama.
          Modelli disponibili: {availableModels.join(', ') || 'nessuno'}.
          Imposta <code>OLLAMA_MODEL</code> nel file <code>.env</code> e riavvia il backend
          (<code>docker compose up -d backend</code>).
        </div>
      )}

      <div className="layout">
        <aside>
          <Recorder onDone={upload} />
          <button className="btn" onClick={() => fileRef.current.click()}>
            📁 Carica file audio
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm"
            hidden
            onChange={(e) => { if (e.target.files[0]) upload(e.target.files[0]); e.target.value = '' }}
          />
          <h2>Chiamate</h2>
          <CallList calls={calls} selectedId={selectedId} onSelect={setSelectedId} onDelete={del} />
        </aside>

        <main>
          <AnalysisPanel call={call} onChanged={() => { refreshCall(); refreshList() }} />
          <TicketPanel call={call} onSaved={() => { refreshCall(); refreshList() }} />
        </main>
      </div>
    </div>
  )
}
