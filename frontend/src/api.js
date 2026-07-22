const BASE = '/api'

async function json(res) {
  if (!res.ok) {
    let msg = res.statusText
    try { msg = (await res.json()).detail || msg } catch { /* noop */ }
    throw new Error(msg)
  }
  return res.json()
}

export const api = {
  health: () => fetch(`${BASE}/health`).then(json),
  listCalls: () => fetch(`${BASE}/calls`).then(json),
  getCall: (id) => fetch(`${BASE}/calls/${id}`).then(json),
  deleteCall: (id) => fetch(`${BASE}/calls/${id}`, { method: 'DELETE' }).then(json),
  uploadAudio: (file) => {
    const fd = new FormData()
    fd.append('audio', file, file.name || 'registrazione.webm')
    return fetch(`${BASE}/calls`, { method: 'POST', body: fd }).then(json)
  },
  saveTicket: (id, ticket) =>
    fetch(`${BASE}/calls/${id}/ticket`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ticket),
    }).then(json),
  runCompleteness: (id) => fetch(`${BASE}/calls/${id}/completeness`, { method: 'POST' }).then(json),
  reprocess: (id) => fetch(`${BASE}/calls/${id}/reprocess`, { method: 'POST' }).then(json),
  audioUrl: (id) => `${BASE}/calls/${id}/audio`,
}
