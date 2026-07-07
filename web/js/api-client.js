export class ApiClient {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
    this.ws = null;
    this.wsCallbacks = new Map();
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const config = {
      ...options,
      headers,
    };

    if (config.body && typeof config.body === 'object') {
      config.body = JSON.stringify(config.body);
    }

    try {
      const response = await fetch(url, config);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP 錯誤: ${response.status}`);
      }
      return await response.json();
    } catch (e) {
      console.error(`API 請求失敗 [${endpoint}]:`, e);
      throw e;
    }
  }

  // --- REST APIs ---
  
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
    return this.request(`/api/sessions/${sessionId}`, {
      method: 'DELETE'
    });
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

  branchSession(sessionId, messageId, name) {
    return this.request(`/api/sessions/${sessionId}/branch`, {
      method: 'POST',
      body: { messageId, name }
    });
  }

  getTemplates() {
    return this.request('/api/templates');
  }

  getConfig() {
    return this.request('/api/config');
  }

  updateConfig(config) {
    return this.request('/api/config', {
      method: 'PUT',
      body: config
    });
  }

  getCompactPrompt(sessionId) {
    return this.request(`/api/sessions/${sessionId}/compact/prompt`, {
      method: 'POST'
    });
  }

  submitCompactSummary(sessionId, summary) {
    return this.request(`/api/sessions/${sessionId}/compact/submit`, {
      method: 'POST',
      body: { summary }
    });
  }

  // --- WebSocket Connection ---

  connectWebSocket(onOpen, onClose) {
    if (this.ws) {
      this.ws.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket 連線成功');
      if (onOpen) onOpen();
    };

    this.ws.onclose = () => {
      console.log('WebSocket 連線關閉，將於 3 秒後重試...');
      if (onClose) onClose();
      setTimeout(() => this.connectWebSocket(onOpen, onClose), 3000);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const { type, sessionId, payload } = data;
        
        const callbacks = this.wsCallbacks.get(type) || [];
        for (const cb of callbacks) {
          cb(sessionId, payload);
        }
      } catch (e) {
        console.error('解析 WS 訊息出錯:', e);
      }
    };
  }

  subscribe(sessionId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', sessionId }));
    }
  }

  unsubscribe(sessionId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'unsubscribe', sessionId }));
    }
  }

  registerWsCallback(type, callback) {
    if (!this.wsCallbacks.has(type)) {
      this.wsCallbacks.set(type, []);
    }
    this.wsCallbacks.get(type).push(callback);
  }
}
