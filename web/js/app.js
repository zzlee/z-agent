import { ApiClient } from './api-client.js';

const api = new ApiClient();
let currentSessionId = null;
let sessions = [];
let promptData = null;
let activePromptTab = 'copyBack';
let copyBackContent = '';

const el = {
  sessionList: document.getElementById('sessionList'),
  btnNewSession: document.getElementById('btnNewSession'),
  currentSessionName: document.getElementById('currentSessionName'),
  currentWorkspacePath: document.getElementById('currentWorkspacePath'),

  promptCard: document.getElementById('promptCard'),
  btnTabSystem: document.getElementById('btnTabSystem'),
  btnTabAgents: document.getElementById('btnTabAgents'),
  btnTabSkills: document.getElementById('btnTabSkills'),
  btnTabCopyBack: document.getElementById('btnTabCopyBack'),
  tokenBadge: document.getElementById('tokenBadge'),
  promptTextarea: document.getElementById('promptTextarea'),
  btnCopyPrompt: document.getElementById('btnCopyPrompt'),

  responseCard: document.getElementById('responseCard'),
  responseTextarea: document.getElementById('responseTextarea'),
  btnSubmitResponse: document.getElementById('btnSubmitResponse'),

  historyLog: document.getElementById('historyLog'),

  connectionDot: document.getElementById('connectionDot'),
  connectionText: document.getElementById('connectionText'),
  phaseDot: document.getElementById('phaseDot'),
  phaseText: document.getElementById('phaseText'),
  statusOs: document.getElementById('statusOs'),
  statusSessionId: document.getElementById('statusSessionId'),

  newSessionModal: document.getElementById('newSessionModal'),
  inputSessionName: document.getElementById('inputSessionName'),
  inputSessionCwd: document.getElementById('inputSessionCwd'),
  btnCancelModal: document.getElementById('btnCancelModal'),
  btnConfirmModal: document.getElementById('btnConfirmModal'),
  autoCopyCheckbox: document.getElementById('autoCopyCheckbox'),
};

function connectWS() {
  api.connectWebSocket(
    () => {
      el.connectionDot.className = 'dot connected';
      el.connectionText.innerText = '已連線';
      if (currentSessionId) api.subscribe(currentSessionId);
    },
    () => {
      el.connectionDot.className = 'dot';
      el.connectionText.innerText = '斷線';
    }
  );

  api.registerWsCallback('execution_start', (sid) => {
    if (sid !== currentSessionId) return;
    updatePhase('running', '正在執行工具...');
  });

  api.registerWsCallback('execution_progress', (sid, payload) => {
    if (sid !== currentSessionId) return;
    updatePhase('running', `Stage ${payload.currentStageIndex} 執行中...`);
  });

  api.registerWsCallback('execution_end', (sid) => {
    if (sid !== currentSessionId) return;
    updatePhase('idle', '工具執行完成 ✅');
  });
}

function init() {
  el.btnNewSession.onclick = () => { el.newSessionModal.classList.remove('hidden'); el.inputSessionName.focus(); };
  el.btnCancelModal.onclick = () => el.newSessionModal.classList.add('hidden');
  el.btnConfirmModal.onclick = handleCreateSession;
  el.btnCopyPrompt.onclick = handleCopy;
  el.btnSubmitResponse.onclick = handleSubmitResponse;

  // Auto-submit on paste
  el.responseTextarea.addEventListener('paste', () => {
    // Wait for the pasted text to actually populate the textarea
    setTimeout(() => {
      handleSubmitResponse();
    }, 50);
  });

  el.btnTabSystem.onclick = () => switchTab('system');
  el.btnTabAgents.onclick = () => switchTab('agents');
  el.btnTabSkills.onclick = () => switchTab('skills');
  el.btnTabCopyBack.onclick = () => switchTab('copyBack');

  document.onkeydown = (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'C') {
      e.preventDefault();
      if (!el.promptCard.classList.contains('hidden')) handleCopy();
    }
  };

  connectWS();
  loadSessions();
}

async function loadSessions() {
  try {
    sessions = await api.getSessions();
    renderSessionList();
  } catch (e) {
    console.error('載入會話失敗:', e);
  }
}

async function handleCreateSession() {
  const name = el.inputSessionName.value.trim();
  const cwd = el.inputSessionCwd.value.trim();
  if (!cwd) { alert('請輸入工作目錄路徑！'); return; }
  try {
    const session = await api.createSession(name, cwd);
    el.newSessionModal.classList.add('hidden');
    el.inputSessionName.value = '';
    await loadSessions();
    selectSession(session.id);
  } catch (e) {
    alert('建立會話失敗: ' + e.message);
  }
}

async function selectSession(sessionId) {
  if (currentSessionId) api.unsubscribe(currentSessionId);
  currentSessionId = sessionId;
  api.subscribe(sessionId);
  el.statusSessionId.innerText = sessionId.slice(0, 12) + '…';

  document.querySelectorAll('.session-item').forEach(c => {
    c.classList.toggle('active', c.dataset.id === sessionId);
  });

  await refresh();
}

async function refresh() {
  try {
    const data = await api.getSessionDetails(currentSessionId);
    el.currentSessionName.innerText = data.session.name;
    el.currentWorkspacePath.innerText = data.session.workingDirectory;
    el.currentWorkspacePath.classList.remove('hidden');
    el.statusOs.innerText = navigator.platform;

    const msgs = data.messages;
    renderHistoryLog(msgs);

    if (msgs.length === 0) {
      // 新會話：顯示環境資訊（工作目錄、日期、OS）
      hideAllCards();
      copyBackContent = [
        `Working Directory: ${data.session.workingDirectory}`,
        `Date: ${new Date().toISOString().split('T')[0]}`,
        `OS: ${navigator.platform}`
      ].join('\n');
      activePromptTab = 'copyBack';
      await showPrompt();
      updatePhase('idle', '複製環境資訊給 LLM 後開始對話');
    } else {
      const last = msgs[msgs.length - 1];
      if (last.role === 'user' || last.role === 'tool_result') {
        if (last.role === 'tool_result') {
          // Find preceding tool results
          let results = [];
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'tool_result') {
              results.unshift(msgs[i]);
            } else {
              break;
            }
          }

          copyBackContent = results.map(r => r.content).join('\n\n');
        }
        activePromptTab = 'copyBack';
        await showPrompt();
      } else if (last.role === 'llm_response') {
        const tcs = last.parsedContent?.toolCalls || [];
        if (tcs.length > 0) {
          hideAllCards();
          const resp = await api.postLLMResponse(currentSessionId, last.rawContent);
          await executeToolCalls(resp.plan);
        } else {
          hideAllCards();
          updatePhase('idle', 'LLM 已回應（無工具呼叫）');
        }
      } else {
        hideAllCards();
        updatePhase('idle', '閒置');
      }
    }
  } catch (e) {
    console.error('重新整理失敗:', e);
  }
}


async function showPrompt() {
  hideAllCards();
  try {
    const prompt = await api.getPrompt(currentSessionId);
    promptData = prompt;
    el.promptCard.classList.remove('hidden');
    el.responseCard.classList.remove('hidden');
    // 根據是否有內容顯示或隱藏 AGENTS.md / Skills 分頁
    const sources = prompt.promptSources || {};
    el.btnTabAgents.style.display = sources.agentsMd ? '' : 'none';
    el.btnTabSkills.style.display = sources.skills ? '' : 'none';
    el.tokenBadge.innerText = `${prompt.estimatedTokens} Tokens`;
    switchTab(activePromptTab);
  } catch (e) {
    alert('取得提示詞失敗: ' + e.message);
  }
}

async function handleSubmitResponse() {
  const raw = el.responseTextarea.value.trim();
  if (!raw) { alert('請貼上 LLM 的回答！'); return; }
  el.responseTextarea.value = '';
  updatePhase('waiting', '正在解析...');

  try {
    const payload = await api.postLLMResponse(currentSessionId, raw);
    if (payload.parseErrors?.length > 0) {
      alert('解析錯誤：\n' + payload.parseErrors.join('\n'));
    }
    if (payload.toolCalls?.length > 0) {
      hideAllCards();
      await executeToolCalls(payload.plan);
    } else {
      await refresh();
    }
  } catch (e) {
    alert('提交失敗: ' + e.message);
    updatePhase('idle', '閒置');
  }
}

async function executeToolCalls(plan) {
  if (!plan) return;
  updatePhase('running', '正在執行工具...');
  try {
    const results = await api.executePlan(currentSessionId, plan);
    const formatted = results.map(r => {
      const obj = { toolCallId: r.toolCallId, status: r.isError ? 'error' : 'success', content: r.content };
      return `<tool_result>\n${JSON.stringify(obj, null, 2)}\n</tool_result>`;
    }).join('\n\n');

    copyBackContent = formatted;
    activePromptTab = 'copyBack';

    // 更新歷程
    try {
      const data = await api.getSessionDetails(currentSessionId);
      renderHistoryLog(data.messages);
    } catch (_) {}

    // 載入下一輪的提示詞
    try {
      const prompt = await api.getPrompt(currentSessionId);
      promptData = prompt;
      el.promptCard.classList.remove('hidden');
      el.responseCard.classList.remove('hidden');
      const sources = prompt.promptSources || {};
      el.btnTabAgents.style.display = sources.agentsMd ? '' : 'none';
      el.btnTabSkills.style.display = sources.skills ? '' : 'none';
      el.tokenBadge.innerText = `${prompt.estimatedTokens} Tokens`;
      switchTab(activePromptTab);
    } catch (_) {}

    updatePhase('idle', '✅ 完成 → 複製結果給 LLM');
  } catch (e) {
    alert('執行失敗: ' + e.message);
    updatePhase('idle', '閒置');
  }
}

async function copyToClipboard(text) {
  if (!text) return;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback for older browsers or insecure contexts
      const textArea = document.createElement("textarea");
      textArea.value = text;
      // Avoid scrolling to bottom
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.position = "fixed";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
      } catch (err) {
        console.error('Fallback: Oops, unable to copy', err);
      }
      document.body.removeChild(textArea);
    }
  } catch (err) {
    console.error('Failed to copy text: ', err);
  }
}

function handleCopy() {
  copyToClipboard(el.promptTextarea.value);
  flashBtn(el.btnCopyPrompt, '✅ 已複製！');
}

function flashBtn(btn, text) {
  const orig = btn.innerText;
  btn.innerText = text;
  btn.style.background = 'linear-gradient(135deg, #00e676 0%, #00b0ff 100%)';
  setTimeout(() => { btn.innerText = orig; btn.style.background = ''; }, 2000);
}

function switchTab(tab) {
  activePromptTab = tab;
  const allTabs = [el.btnTabSystem, el.btnTabAgents, el.btnTabSkills, el.btnTabCopyBack];
  allTabs.forEach(b => { b.style.borderColor = ''; b.style.color = ''; });

  const sources = promptData?.promptSources || {};
  let textToCopy = '';

  if (tab === 'system') {
    el.btnTabSystem.style.borderColor = 'var(--accent-color)';
    el.btnTabSystem.style.color = 'var(--accent-color)';
    textToCopy = sources.systemPrompt || '';
  } else if (tab === 'agents') {
    el.btnTabAgents.style.borderColor = 'var(--accent-color)';
    el.btnTabAgents.style.color = 'var(--accent-color)';
    textToCopy = sources.agentsMd || '';
  } else if (tab === 'skills') {
    el.btnTabSkills.style.borderColor = 'var(--accent-color)';
    el.btnTabSkills.style.color = 'var(--accent-color)';
    textToCopy = sources.skills || '';
  } else if (tab === 'copyBack') {
    el.btnTabCopyBack.style.borderColor = 'var(--accent-color)';
    el.btnTabCopyBack.style.color = 'var(--accent-color)';
    textToCopy = copyBackContent;
  }

  el.promptTextarea.value = textToCopy;

  if (textToCopy && el.autoCopyCheckbox.checked) {
    copyToClipboard(textToCopy);
    flashBtn(el.btnCopyPrompt, '✅ 已自動複製！');
  }
}

function renderSessionList() {
  el.sessionList.innerHTML = '';
  sessions.forEach(s => {
    const item = document.createElement('div');
    item.className = 'session-item';
    item.dataset.id = s.id;
    if (s.id === currentSessionId) item.classList.add('active');

    const info = document.createElement('div');
    info.className = 'session-info';
    const name = document.createElement('div');
    name.className = 'session-name';
    name.innerText = s.name;
    const meta = document.createElement('div');
    meta.className = 'session-meta';
    meta.innerText = `${new Date(s.updatedAt).toLocaleDateString()} | ${s.workingDirectory}`;
    info.appendChild(name);
    info.appendChild(meta);

    const del = document.createElement('button');
    del.className = 'btn-delete-session';
    del.innerHTML = '✕';
    del.title = '刪除會話';
    del.onclick = async (e) => {
      e.stopPropagation();
      if (confirm(`刪除會話「${s.name}」？`)) {
        await api.deleteSession(s.id);
        if (currentSessionId === s.id) { currentSessionId = null; resetUI(); }
        loadSessions();
      }
    };

    item.appendChild(info);
    item.appendChild(del);
    item.onclick = () => selectSession(s.id);
    el.sessionList.appendChild(item);
  });
}

function hideAllCards() {
  el.promptCard.classList.add('hidden');
  el.responseCard.classList.add('hidden');
}

function updatePhase(phase, text) {
  el.phaseText.innerText = text;
  el.phaseDot.className = 'dot';
  if (phase === 'idle') el.phaseDot.className = 'dot idle';
  else if (phase === 'waiting') el.phaseDot.className = 'dot waiting';
  else if (phase === 'running') el.phaseDot.className = 'dot running';
}

function resetUI() {
  el.currentSessionName.innerText = '選擇一個會話或建立新會話';
  el.currentWorkspacePath.classList.add('hidden');
  hideAllCards();
  updatePhase('idle', '閒置');
  el.statusSessionId.innerText = '-';
}

function renderHistoryLog(messages) {
  if (!el.historyLog) return;
  if (!messages || messages.length === 0) {
    el.historyLog.innerHTML = '<div style="color: var(--text-muted); font-size: 0.78rem; text-align: center; padding: 20px 0;">暫無歷程紀錄</div>';
    return;
  }

  let html = '';
  for (const msg of messages) {
    if (msg.role === 'user') {
      html += entryHtml('user', 'badge-user', '👤 使用者', msg.content);
    } else if (msg.role === 'tool_call') {
      const args = JSON.stringify(msg.arguments || {});
      html += entryHtml('tool-call', 'badge-tool-call', '⚡ ' + msg.toolName, args);
    } else if (msg.role === 'tool_result') {
      const label = msg.isError ? '❌ ' + msg.toolName : '✅ ' + msg.toolName;
      const badge = msg.isError ? 'badge-tool-error' : 'badge-tool-result';
      const content = msg.content ? msg.content.slice(0, 300) : '(無輸出)';
      html += entryHtml('tool-result', badge, label, content);
    } else if (msg.role === 'llm_response') {
      const tcs = msg.parsedContent?.toolCalls || [];
      const tcSummary = tcs.length > 0 ? ' [' + tcs.map(t => t.name).join(', ') + ']' : '';
      html += entryHtml('llm', 'badge-llm', '🤖 LLM 回應' + tcSummary, '');
    }
  }

  el.historyLog.innerHTML = html;

  // 自動滾到底部
  el.historyLog.scrollTop = el.historyLog.scrollHeight;
}

function entryHtml(cls, badgeCls, label, content) {
  const safeContent = escapeHtml(content || '');
  const isLong = safeContent.length > 200;
  const wrapperCls = isLong ? 'entry-content expandable' : 'entry-content';
  return '<div class="history-entry">'
    + '<div class="entry-header"><span class="badge ' + badgeCls + '">' + label + '</span></div>'
    + '<div class="' + wrapperCls + '" onclick="this.classList.toggle(\'expanded\')">' + safeContent + '</div>'
    + '</div>';
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window.onload = init;
