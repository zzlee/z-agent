export class ApiClient {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
    this.ws = null;
    this.wsCallbacks = new Map();
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    const config = { ...options, headers };
    if (config.body && typeof config.body === 'object') {
      config.body = JSON.stringify(config.body);
    }
    try {
      const res = await fetch(url, config);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      console.error(`API 請求失敗 [${endpoint}]:`, e);
      throw e;
    }
  }

  // ─── REST API（僅保留轉發循環所需） ──────────────────

  getSessions() {
    return this.request('/api/sessions');
  }

  createSession(name, workingDirectory, settings = {}) {
    return this.request('/api/sessions', {
      method: 'POST',
      body: { name, workingDirectory, settings }
    });
  }

  getSessionDetails(sessionId) {
    return this.request(`/api/sessions/${sessionId}`);
  }

  deleteSession(sessionId) {
    return this.request(`/api/sessions/${sessionId}`, { method: 'DELETE' });
  }

  getPrompt(sessionId) {
    return this.request(`/api/sessions/${sessionId}/prompt`);
  }

  postUserMessage(sessionId, content) {
    return this.request(`/api/sessions/${sessionId}/message`, {
      method: 'POST',
      body: { content }
    });
  }

  postLLMResponse(sessionId, rawResponse) {
    return this.request(`/api/sessions/${sessionId}/response`, {
      method: 'POST',
      body: { rawResponse }
    });
  }

  executePlan(sessionId, plan) {
    return this.request(`/api/sessions/${sessionId}/execute`, {
      method: 'POST',
      body: { plan }
    });
  }

  // ─── WebSocket ─────────────────────────────────────

  connectWebSocket(onOpen, onClose) {
    if (this.ws) this.ws.close();
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => { console.log('WS 連線成功'); if (onOpen) onOpen(); };
    this.ws.onclose = () => {
      console.log('WS 斷線，3 秒後重連...');
      if (onClose) onClose();
      setTimeout(() => this.connectWebSocket(onOpen, onClose), 3000);
    };
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const cbs = this.wsCallbacks.get(data.type) || [];
        cbs.forEach(cb => cb(data.sessionId, data.payload));
      } catch (e) { console.error('WS 訊息解析錯誤:', e); }
    };
  }

  subscribe(sessionId) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', sessionId }));
    }
  }

  unsubscribe(sessionId) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'unsubscribe', sessionId }));
    }
  }

  registerWsCallback(type, callback) {
    if (!this.wsCallbacks.has(type)) this.wsCallbacks.set(type, []);
    this.wsCallbacks.get(type).push(callback);
  }
}
