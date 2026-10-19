'use strict';
// Camada isolada de acesso aos documentos do proprietário. Não salva tokens em disco.
window.GodoyCloud = Object.freeze({
  async request(token, path, options = {}) {
    const config = window.GODOY_SUPABASE;
    if (!config?.url || !config?.publishableKey || !token) throw Error('Sessão ou configuração ausente.');
    const response = await fetch(config.url.replace(/\/$/, '') + path, {
      ...options,
      headers: {
        'apikey': config.publishableKey,
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      cache: 'no-store'
    });
    const body = await response.text();
    let data;
    try { data = body ? JSON.parse(body) : null; } catch (_) { data = body; }
    if (!response.ok) throw Error('Supabase (' + response.status + '): ' + (data?.message || data?.error || data?.details || 'falha na solicitação'));
    return data;
  },
  async user(token) {
    return this.request(token, '/auth/v1/user');
  },
  async load(token, userId) {
    const rows = await this.request(token, '/rest/v1/owner_documents?owner_id=eq.' + encodeURIComponent(userId) + '&select=payload,revision');
    if (!Array.isArray(rows) || rows.length > 1) throw Error('Resposta de documento inválida.');
    return rows[0] || null;
  },
  async initialize(token, userId, payload) {
    return this.request(token, '/rest/v1/owner_documents', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ owner_id: userId, payload, revision: 1 })
    });
  },
  async save(token, expectedRevision, payload) {
    return this.request(token, '/rest/v1/rpc/update_owner_document', {
      method: 'POST',
      body: JSON.stringify({ expected_revision: expectedRevision, new_payload: payload })
    });
  }
});
