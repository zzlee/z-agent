import { ApiClient } from './api-client.js';

// 初始化 API 客戶端
const api = new ApiClient();

// 全域狀態
let currentSessionId = null;
let currentPlan = null;
let sessions = [];
let messages = [];
let systemPromptText = '';
let fullPromptText = '';
let latestPromptText = '';
let activePromptTab = 'latest'; // 'system' | 'full' | 'latest'

// DOM 元素快取
const el = {
  sessionList: document.getElementById('sessionList'),
  btnNewSession: document.getElementById('btnNewSession'),
  currentSessionName: document.getElementById('currentSessionName'),
  currentWorkspacePath: document.getElementById('currentWorkspacePath'),
  btnRefreshPrompt: document.getElementById('btnRefreshPrompt'),
  btnCompactHistory: document.getElementById('btnCompactHistory'),
  btnSettings: document.getElementById('btnSettings'),
  messagesContainer: document.getElementById('messagesContainer'),
  chatInput: document.getElementById('chatInput'),
  btnSendMessage: document.getElementById('btnSendMessage'),
  
  promptCard: document.getElementById('promptCard'),
  btnPromptTabSystem: document.getElementById('btnPromptTabSystem'),
  btnPromptTabFull: document.getElementById('btnPromptTabFull'),
  btnPromptTabLatest: document.getElementById('btnPromptTabLatest'),
  promptCardDesc: document.getElementById('promptCardDesc'),
  tokenBadge: document.getElementById('tokenBadge'),
  promptTextarea: document.getElementById('promptTextarea'),
  btnCopyPrompt: document.getElementById('btnCopyPrompt'),
  
  toolResultCard: document.getElementById('toolResultCard'),
  toolResultTextarea: document.getElementById('toolResultTextarea'),
  btnCopyToolResult: document.getElementById('btnCopyToolResult'),
  
  responseCard: document.getElementById('responseCard'),
  responseTextarea: document.getElementById('responseTextarea'),
  btnSubmitResponse: document.getElementById('btnSubmitResponse'),
  
  planCard: document.getElementById('planCard'),
  planContainer: document.getElementById('planContainer'),
  btnExecutePlan: document.getElementById('btnExecutePlan'),
  
  connectionDot: document.getElementById('connectionDot'),
  connectionText: document.getElementById('connectionText'),
  agentPhase: document.getElementById('agentPhase'),
  phaseDot: document.getElementById('phaseDot'),
  phaseText: document.getElementById('phaseText'),
  statusOs: document.getElementById('statusOs'),
  statusSessionId: document.getElementById('statusSessionId'),
  
  newSessionModal: document.getElementById('newSessionModal'),
  inputSessionName: document.getElementById('inputSessionName'),
  inputSessionCwd: document.getElementById('inputSessionCwd'),
  btnCancelModal: document.getElementById('btnCancelModal'),
  btnConfirmModal: document.getElementById('btnConfirmModal'),

  settingsModal: document.getElementById('settingsModal'),
  settingsPort: document.getElementById('settingsPort'),
  settingsHost: document.getElementById('settingsHost'),
  settingsCwd: document.getElementById('settingsCwd'),
  settingsTemplate: document.getElementById('settingsTemplate'),
  settingsBlacklist: document.getElementById('settingsBlacklist'),
  btnCancelSettings: document.getElementById('btnCancelSettings'),
  btnSaveSettings: document.getElementById('btnSaveSettings'),
  
  branchModal: document.getElementById('branchModal'),
  branchSourceMsgId: document.getElementById('branchSourceMsgId'),
  inputBranchName: document.getElementById('inputBranchName'),
  btnCancelBranch: document.getElementById('btnCancelBranch'),
  btnConfirmBranch: document.getElementById('btnConfirmBranch'),
  
  compactModal: document.getElementById('compactModal'),
  compactPromptTextarea: document.getElementById('compactPromptTextarea'),
  btnCopyCompactPrompt: document.getElementById('btnCopyCompactPrompt'),
  compactSummaryTextarea: document.getElementById('compactSummaryTextarea'),
  btnCancelCompact: document.getElementById('btnCancelCompact'),
  btnSubmitCompact: document.getElementById('btnSubmitCompact'),
};

// --- 初始化連線與事件 ---
function init() {
  // 監聽按鈕與輸入
  el.btnNewSession.onclick = () => showModal(true);
  el.btnCancelModal.onclick = () => showModal(false);
  el.btnConfirmModal.onclick = handleCreateSession;
  el.btnSendMessage.onclick = handleSendMessage;
  el.chatInput.onkeydown = (e) => {
    if (e.key === 'Enter' && !el.chatInput.disabled) {
      handleSendMessage();
    }
  };
  el.btnCopyPrompt.onclick = handleCopyPrompt;
  el.btnSubmitResponse.onclick = handleSubmitResponse;
  el.btnExecutePlan.onclick = handleExecutePlan;
  el.btnRefreshPrompt.onclick = refreshPrompt;
  el.btnPromptTabSystem.onclick = () => switchPromptTab('system');
  el.btnPromptTabFull.onclick = () => switchPromptTab('full');
  el.btnPromptTabLatest.onclick = () => switchPromptTab('latest');
  el.btnCopyToolResult.onclick = handleCopyToolResult;

  // 設定視窗
  el.btnSettings.onclick = openSettings;
  el.btnCancelSettings.onclick = () => el.settingsModal.classList.add('hidden');
  el.btnSaveSettings.onclick = saveSettings;

  // 壓縮視窗
  el.btnCompactHistory.onclick = openCompactModal;
  el.btnCancelCompact.onclick = () => el.compactModal.classList.add('hidden');
  el.btnCopyCompactPrompt.onclick = copyCompactPrompt;
  el.btnSubmitCompact.onclick = submitCompact;

  // 分支視窗
  el.btnCancelBranch.onclick = () => el.branchModal.classList.add('hidden');
  el.btnConfirmBranch.onclick = confirmBranch;

  // 點選對話歷史中的分支按鈕事件委派
  el.messagesContainer.onclick = (e) => {
    if (e.target.classList.contains('btn-branch-message')) {
      const msgId = e.target.dataset.msgId;
      openBranchModal(msgId);
    }
  };

  // 全域快捷鍵
  document.onkeydown = (e) => {
    // Ctrl+N 建立新會話
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      showModal(true);
    }
    // Ctrl+Shift+C 複製提示詞
    if (e.ctrlKey && e.shiftKey && e.key === 'C') {
      e.preventDefault();
      if (!el.promptCard.classList.contains('hidden')) {
        handleCopyPrompt();
      }
    }
  };

  // WebSocket 連線與事件處理
  api.connectWebSocket(
    () => {
      // WS 連線成功
      el.connectionDot.className = 'dot connected';
      el.connectionText.innerText = '已連接伺服器';
      if (currentSessionId) {
        api.subscribe(currentSessionId);
      }
    },
    () => {
      // WS 斷線
      el.connectionDot.className = 'dot';
      el.connectionText.innerText = '斷開連線';
    }
  );

  // 註冊 WebSocket 回調事件
  api.registerWsCallback('execution_start', (sessionId, payload) => {
    if (sessionId !== currentSessionId) return;
    updatePhase('running', '正在執行工具呼叫...');
    renderPlanProgress(payload.plan, [], []);
  });

  api.registerWsCallback('execution_progress', (sessionId, payload) => {
    if (sessionId !== currentSessionId) return;
    updatePhase('running', `正在執行 Stage ${payload.currentStageIndex}...`);
    renderPlanProgress(
      currentPlan,
      payload.completedToolCallIds,
      payload.activeToolCallIds
    );
  });

  api.registerWsCallback('execution_end', (sessionId, payload) => {
    if (sessionId !== currentSessionId) return;
    updatePhase('idle', '工具執行完成');
    el.planCard.classList.add('hidden');
    refreshSessionDetails();
  });

  // 載入會話清單
  loadSessionList();
}

// --- 控制器與處理程序 ---

async function loadSessionList() {
  try {
    sessions = await api.getSessions();
    renderSessionList();
  } catch (e) {
    alert('無法載入會話清單: ' + e.message);
  }
}

function showModal(show) {
  if (show) {
    el.newSessionModal.classList.remove('hidden');
    el.inputSessionName.focus();
  } else {
    el.newSessionModal.classList.add('hidden');
    el.inputSessionName.value = '';
  }
}

async function handleCreateSession() {
  const name = el.inputSessionName.value.trim();
  const cwd = el.inputSessionCwd.value.trim();
  
  if (!cwd) {
    alert('請提供工作目錄路徑！');
    return;
  }

  try {
    const session = await api.createSession(name, cwd);
    showModal(false);
    await loadSessionList();
    selectSession(session.id);
  } catch (e) {
    alert('建立會話失敗: ' + e.message);
  }
}

async function selectSession(sessionId) {
  if (currentSessionId) {
    api.unsubscribe(currentSessionId);
  }

  currentSessionId = sessionId;
  api.subscribe(currentSessionId);
  
  el.statusSessionId.innerText = sessionId;

  // 切換選中狀態
  Array.from(el.sessionList.children).forEach(child => {
    if (child.dataset.id === sessionId) {
      child.classList.add('active');
    } else {
      child.classList.remove('active');
    }
  });

  await refreshSessionDetails();
  
  // 顯示壓縮按鈕
  el.btnCompactHistory.classList.remove('hidden');

  // 啟用輸入框
  el.chatInput.disabled = false;
  el.btnSendMessage.disabled = false;
  el.chatInput.focus();
}

async function refreshSessionDetails() {
  try {
    const data = await api.getSessionDetails(currentSessionId);
    const { session, messages: loadedMessages } = data;
    
    messages = loadedMessages;
    
    el.currentSessionName.innerText = session.name;
    el.currentWorkspacePath.innerText = session.workingDirectory;
    el.currentWorkspacePath.classList.remove('hidden');
    el.statusOs.innerText = navigator.platform;

    renderMessages();
    
    // 檢查最後一個訊息，判斷該展示哪個 Action 面板
    if (messages.length === 0) {
      // 全新會話，提示輸入
      hideActionCards();
      updatePhase('idle', '等待使用者輸入指令...');
    } else {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'user') {
        // 使用者發送了指令，需要更新提示詞複製給 LLM
        await refreshPrompt();
      } else if (lastMsg.role === 'tool_result') {
        // 工具剛跑完，也要產生新提示詞餵給 LLM
        await refreshPrompt();
      } else if (lastMsg.role === 'llm_response') {
        // 外部 LLM 回應已貼上，若包含工具呼叫，顯示執行計畫
        const toolCalls = lastMsg.parsedContent.toolCalls;
        if (toolCalls && toolCalls.length > 0) {
          hideActionCards();
          el.planCard.classList.remove('hidden');
          
          // 我們可能需要向後端發送一次 response 請求來再次計算 plan
          // 或者直接透過 API 來取得 plan。這裡為了效能，可以直接使用 response 再次請求以確保 plan 與後端一致
          const responsePayload = await api.postLLMResponse(currentSessionId, lastMsg.rawContent);
          currentPlan = responsePayload.plan;
          renderPlan(currentPlan);
        } else {
          // 沒有工具呼叫，說明已經對話完成或等待使用者輸入下一個工作步驟
          hideActionCards();
          updatePhase('idle', '任務對話完成');
        }
      } else {
        hideActionCards();
        updatePhase('idle', '閒置');
      }
    }
  } catch (e) {
    console.error('重新整理會話詳情失敗:', e);
  }
}

async function handleSendMessage() {
  const content = el.chatInput.value.trim();
  if (!content) return;

  el.chatInput.value = '';
  
  try {
    await api.postUserMessage(currentSessionId, content);
    await refreshSessionDetails();
  } catch (e) {
    alert('發送訊息失敗: ' + e.message);
  }
}

async function refreshPrompt() {
  updatePhase('waiting', '正在組裝提示詞...');
  try {
    const prompt = await api.getPrompt(currentSessionId);
    
    systemPromptText = prompt.sections.systemPrompt;
    fullPromptText = prompt.fullText;
    // 如果最新內容是空的，就 fallback 顯示完整提示詞
    latestPromptText = prompt.sections.currentRequest || prompt.fullText;
    
    // 自動判斷預設分頁：如果是多輪對話 (有歷史訊息)，預設顯示最新變更，否則顯示完整提示詞
    if (messages.length > 2) {
      activePromptTab = 'latest';
    } else {
      activePromptTab = 'full';
    }

    hideActionCards();
    el.promptCard.classList.remove('hidden');
    el.responseCard.classList.remove('hidden');
    el.btnRefreshPrompt.classList.remove('hidden');
    
    switchPromptTab(activePromptTab);
    el.tokenBadge.innerText = `${prompt.estimatedTokens} Tokens`;
  } catch (e) {
    alert('組裝提示詞失敗: ' + e.message);
    updatePhase('idle', '閒置');
  }
}

function handleCopyPrompt() {
  el.promptTextarea.select();
  document.execCommand('copy');
  
  const originalText = el.btnCopyPrompt.innerText;
  el.btnCopyPrompt.innerText = '✅ 已成功複製！';
  el.btnCopyPrompt.style.background = 'linear-gradient(135deg, #00e676 0%, #00b0ff 100%)';
  
  setTimeout(() => {
    el.btnCopyPrompt.innerText = originalText;
    el.btnCopyPrompt.style.background = '';
  }, 2000);
}

async function handleSubmitResponse() {
  const rawResponse = el.responseTextarea.value.trim();
  if (!rawResponse) {
    alert('請貼上外部 LLM 的回答內容！');
    return;
  }

  el.responseTextarea.value = '';
  updatePhase('waiting', '正在解析 LLM 回應...');

  try {
    const payload = await api.postLLMResponse(currentSessionId, rawResponse);
    
    if (payload.parseErrors && payload.parseErrors.length > 0) {
      alert('解析工具格式時發生以下錯誤，請確認貼上內容是否完整：\n' + payload.parseErrors.join('\n'));
    }

    if (payload.toolCalls && payload.toolCalls.length > 0) {
      hideActionCards();
      el.planCard.classList.remove('hidden');
      currentPlan = payload.plan;
      renderPlan(currentPlan);
    } else {
      // 僅是純對話文字回應，直接更新歷史
      hideActionCards();
      await refreshSessionDetails();
    }
  } catch (e) {
    alert('提交回應失敗: ' + e.message);
    updatePhase('idle', '閒置');
  }
}

async function handleExecutePlan() {
  if (!currentPlan) return;
  
  el.btnExecutePlan.disabled = true;
  el.btnExecutePlan.innerText = '⚙️ 執行計畫中...';
  
  try {
    const results = await api.executePlan(currentSessionId, currentPlan);
    
    // 將工具執行回覆格式化成符合 JSON 的結構
    const formatted = results.map(res => {
      const resultObj = {
        toolCallId: res.toolCallId,
        status: res.isError ? 'error' : 'success',
        content: res.content
      };
      return `<tool_result>\n${JSON.stringify(resultObj, null, 2)}\n</tool_result>`;
    }).join('\n\n');

    el.toolResultTextarea.value = formatted;
    el.toolResultCard.classList.remove('hidden');
  } catch (e) {
    alert('執行計畫失敗: ' + e.message);
  } finally {
    el.btnExecutePlan.disabled = false;
    el.btnExecutePlan.innerText = '▶ 執行確認計畫';
  }
}

// --- 渲染模組 ---

function renderSessionList() {
  el.sessionList.innerHTML = '';
  
  sessions.forEach(session => {
    const item = document.createElement('div');
    item.className = 'session-item';
    item.dataset.id = session.id;
    if (session.id === currentSessionId) {
      item.classList.add('active');
    }

    const info = document.createElement('div');
    info.className = 'session-info';
    
    const name = document.createElement('div');
    name.className = 'session-name';
    name.innerText = session.name;

    const meta = document.createElement('div');
    meta.className = 'session-meta';
    const dateStr = new Date(session.updatedAt).toLocaleDateString();
    meta.innerText = `${dateStr} | ${session.workingDirectory}`;

    info.appendChild(name);
    info.appendChild(meta);

    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn-delete-session';
    btnDelete.innerHTML = '✕';
    btnDelete.title = '刪除會話';
    btnDelete.onclick = async (e) => {
      e.stopPropagation();
      if (confirm(`確認刪除會話 "${session.name}"？此操作無法還原。`)) {
        try {
          await api.deleteSession(session.id);
          if (currentSessionId === session.id) {
            currentSessionId = null;
            el.currentSessionName.innerText = '選擇一個會話或建立新會話';
            el.currentWorkspacePath.classList.add('hidden');
            el.btnCompactHistory.classList.add('hidden');
            el.chatInput.disabled = true;
            el.btnSendMessage.disabled = true;
            el.messagesContainer.innerHTML = '';
            hideActionCards();
          }
          loadSessionList();
        } catch (err) {
          alert('刪除失敗: ' + err.message);
        }
      }
    };

    item.appendChild(info);
    item.appendChild(btnDelete);
    item.onclick = () => selectSession(session.id);

    el.sessionList.appendChild(item);
  });
}

function renderMessages() {
  el.messagesContainer.innerHTML = '';
  
  if (messages.length === 0) {
    el.messagesContainer.innerHTML = `
      <div class="message-bubble">
        <div class="message-sender">Z-Agent System</div>
        <div class="message-text">此對話尚無記錄。請在下方輸入你的任務需求（例如：「幫我建立一個 package.json 檔案，並在其中包含 express 和 vitest 依賴」），接著將產出的提示詞複製給外部 LLM。</div>
      </div>`;
    return;
  }

  messages.forEach(msg => {
    if (msg.role === 'assembled_prompt') return; // 不在對話歷史中顯示長提示詞，保持介面清爽

    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${msg.role === 'user' ? 'user' : ''}`;

    const sender = document.createElement('div');
    sender.className = `message-sender ${msg.role === 'user' ? 'user-sender' : 'assistant-sender'}`;
    
    const timeStr = new Date(msg.timestamp).toLocaleTimeString();
    
    if (msg.role === 'user') {
      sender.innerText = `👤 使用者 (${timeStr})`;
      bubble.appendChild(sender);
      
      const text = document.createElement('div');
      text.className = 'message-text';
      text.innerText = msg.content;
      bubble.appendChild(text);
    } 
    
    else if (msg.role === 'llm_response') {
      sender.innerText = `🤖 外部 LLM (${timeStr})`;
      bubble.appendChild(sender);

      const text = document.createElement('div');
      text.className = 'message-text';
      text.innerText = msg.parsedContent.textContent;
      bubble.appendChild(text);

      // 如果有工具呼叫，顯示在氣泡內部
      if (msg.parsedContent.toolCalls && msg.parsedContent.toolCalls.length > 0) {
        msg.parsedContent.toolCalls.forEach(call => {
          const callBlock = document.createElement('div');
          callBlock.className = 'tool-call-block';
          callBlock.innerHTML = `
            <strong>🔧 呼叫工具: <span class="tool-name-tag ${call.name}">${call.name}</span></strong>
            <pre style="font-family: var(--font-mono); font-size: 0.8rem; margin-top: 4px;">${JSON.stringify(call.arguments, null, 2)}</pre>
          `;
          bubble.appendChild(callBlock);
        });
      }
    } 
    
    else if (msg.role === 'tool_result') {
      sender.innerText = `🔧 工具執行結果 (${msg.toolName}) (${timeStr})`;
      bubble.appendChild(sender);

      const resultBlock = document.createElement('div');
      resultBlock.className = `tool-result-block ${msg.isError ? 'error' : ''}`;
      resultBlock.innerText = msg.content;
      bubble.appendChild(resultBlock);
    }

    else if (msg.role === 'system') {
      sender.innerText = `⚙️ 系統通知 [${msg.level.toUpperCase()}] (${timeStr})`;
      bubble.appendChild(sender);

      const text = document.createElement('div');
      text.className = 'message-text';
      text.style.color = msg.level === 'error' ? 'var(--error)' : 'var(--text-secondary)';
      text.innerText = msg.content;
      bubble.appendChild(text);
    }

    if (msg.role !== 'system') {
      const btnBranch = document.createElement('button');
      btnBranch.className = 'btn-branch-message';
      btnBranch.dataset.msgId = msg.id;
      btnBranch.innerText = '✂️ 建立分支';
      bubble.appendChild(btnBranch);
    }

    el.messagesContainer.appendChild(bubble);
  });

  // 自動捲動到底部
  setTimeout(() => {
    el.messagesContainer.scrollTop = el.messagesContainer.scrollHeight;
  }, 50);
}

function renderPlan(plan) {
  el.planContainer.innerHTML = '';
  if (!plan || !plan.stages) return;

  plan.stages.forEach(stage => {
    const card = document.createElement('div');
    card.className = 'stage-card';
    card.dataset.stageIndex = stage.stageIndex;

    const header = document.createElement('div');
    header.className = 'stage-header';
    header.innerHTML = `<span>Stage ${stage.stageIndex}</span> <span class="stage-status-text" style="font-size: 0.75rem; color: var(--text-muted);">等待中</span>`;
    card.appendChild(header);

    const callsList = document.createElement('div');
    callsList.className = 'stage-calls';

    stage.toolCalls.forEach(call => {
      const item = document.createElement('div');
      item.className = 'tool-call-item';
      item.dataset.toolCallId = call.toolCallId;
      
      const leftPart = document.createElement('div');
      leftPart.style.display = 'flex';
      leftPart.style.alignItems = 'center';
      leftPart.style.gap = '10px';

      const tag = document.createElement('span');
      tag.className = `tool-name-tag ${call.toolName}`;
      tag.innerText = call.toolName;

      const args = document.createElement('span');
      args.className = 'tool-args';
      args.innerText = JSON.stringify(call.arguments);
      args.title = JSON.stringify(call.arguments, null, 2);

      leftPart.appendChild(tag);
      leftPart.appendChild(args);

      const status = document.createElement('div');
      status.className = 'tool-status pending';
      status.innerHTML = '<span>⏳ 等待中</span>';

      item.appendChild(leftPart);
      item.appendChild(status);
      callsList.appendChild(item);
    });

    card.appendChild(callsList);
    el.planContainer.appendChild(card);
  });
}

function renderPlanProgress(plan, completedIds, activeIds) {
  if (!plan || !plan.stages) return;

  const completedSet = new Set(completedIds);
  const activeSet = new Set(activeIds);

  plan.stages.forEach(stage => {
    const stageCard = el.planContainer.querySelector(`.stage-card[data-stage-index="${stage.stageIndex}"]`);
    if (!stageCard) return;

    const statusTextEl = stageCard.querySelector('.stage-status-text');

    let allCompleted = true;
    let anyRunning = false;

    stage.toolCalls.forEach(call => {
      const item = stageCard.querySelector(`.tool-call-item[data-tool-call-id="${call.toolCallId}"]`);
      if (!item) return;

      const statusEl = item.querySelector('.tool-status');

      if (completedSet.has(call.toolCallId)) {
        statusEl.className = 'tool-status success';
        statusEl.innerHTML = '<span>✅ 成功</span>';
      } else if (activeSet.has(call.toolCallId)) {
        statusEl.className = 'tool-status running';
        statusEl.innerHTML = '<span>⚙️ 執行中</span>';
        anyRunning = true;
        allCompleted = false;
      } else {
        statusEl.className = 'tool-status pending';
        statusEl.innerHTML = '<span>⏳ 等待中</span>';
        allCompleted = false;
      }
    });

    if (allCompleted) {
      statusTextEl.innerText = '✅ 完成';
      statusTextEl.style.color = 'var(--success)';
      stageCard.style.borderColor = 'var(--success)';
    } else if (anyRunning) {
      statusTextEl.innerText = '⚙️ 執行中';
      statusTextEl.style.color = 'var(--info)';
      stageCard.style.borderColor = 'var(--info)';
    } else {
      statusTextEl.innerText = '⏳ 等待中';
      statusTextEl.style.color = 'var(--text-muted)';
      stageCard.style.borderColor = '';
    }
  });
}

// --- 輔助函數 ---

function hideActionCards() {
  el.promptCard.classList.add('hidden');
  el.responseCard.classList.add('hidden');
  el.planCard.classList.add('hidden');
  el.btnRefreshPrompt.classList.add('hidden');
  el.toolResultCard.classList.add('hidden');
}

function updatePhase(phase, text) {
  el.phaseText.innerText = `階段: ${text}`;
  
  if (phase === 'idle') {
    el.phaseDot.className = 'dot idle';
  } else if (phase === 'waiting') {
    el.phaseDot.className = 'dot waiting';
  } else if (phase === 'running') {
    el.phaseDot.className = 'dot running';
  }
}

// --- 系統設定功能 ---
async function openSettings() {
  try {
    const config = await api.getConfig();
    const templates = await api.getTemplates();

    el.settingsPort.value = config.server.port;
    el.settingsHost.value = config.server.host;
    el.settingsCwd.value = config.defaults.workingDirectory;
    el.settingsBlacklist.value = (config.security.bashBlacklist || []).join(', ');

    // 渲染模板選項
    el.settingsTemplate.innerHTML = '';
    templates.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.innerText = t;
      if (t === config.defaults.systemPromptTemplate) {
        opt.selected = true;
      }
      el.settingsTemplate.appendChild(opt);
    });

    el.settingsModal.classList.remove('hidden');
  } catch (e) {
    alert('載入系統設定失敗: ' + e.message);
  }
}

async function saveSettings() {
  try {
    const config = await api.getConfig();
    config.server.port = parseInt(el.settingsPort.value, 10) || 3000;
    config.server.host = el.settingsHost.value.trim() || 'localhost';
    config.defaults.workingDirectory = el.settingsCwd.value.trim();
    config.defaults.systemPromptTemplate = el.settingsTemplate.value;
    config.security.bashBlacklist = el.settingsBlacklist.value
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    await api.updateConfig(config);
    el.settingsModal.classList.add('hidden');
    alert('系統設定已成功儲存並套用！');
  } catch (e) {
    alert('儲存設定失敗: ' + e.message);
  }
}

// --- 分支功能 ---
function openBranchModal(msgId) {
  el.branchSourceMsgId.value = msgId;
  el.inputBranchName.value = '';
  el.branchModal.classList.remove('hidden');
}

async function confirmBranch() {
  const msgId = el.branchSourceMsgId.value;
  const name = el.inputBranchName.value.trim();
  
  try {
    const newSession = await api.branchSession(currentSessionId, msgId, name);
    el.branchModal.classList.add('hidden');
    await loadSessionList();
    selectSession(newSession.id);
  } catch (e) {
    alert('建立對話分支失敗: ' + e.message);
  }
}

// --- 對話歷程壓縮功能 ---
async function openCompactModal() {
  try {
    const data = await api.getCompactPrompt(currentSessionId);
    el.compactPromptTextarea.value = data.prompt;
    el.compactSummaryTextarea.value = '';
    el.compactModal.classList.remove('hidden');
  } catch (e) {
    alert('無法取得壓縮提示詞: ' + e.message);
  }
}

function copyCompactPrompt() {
  el.compactPromptTextarea.select();
  document.execCommand('copy');
  
  const originalText = el.btnCopyCompactPrompt.innerText;
  el.btnCopyCompactPrompt.innerText = '✅ 已成功複製壓縮提示詞！';
  setTimeout(() => {
    el.btnCopyCompactPrompt.innerText = originalText;
  }, 2000);
}

async function submitCompact() {
  const summary = el.compactSummaryTextarea.value.trim();
  if (!summary) {
    alert('請貼上 LLM 生成的壓縮摘要內容！');
    return;
  }

  try {
    await api.submitCompactSummary(currentSessionId, summary);
    el.compactModal.classList.add('hidden');
    await refreshSessionDetails();
    alert('歷史對話壓縮完成！');
  } catch (e) {
    alert('壓縮歷史歷程失敗: ' + e.message);
  }
}

// --- 提示詞分頁與工具結果複製 ---
function switchPromptTab(tab) {
  activePromptTab = tab;
  
  // 重設所有分頁按鈕的邊框與顏色樣式
  el.btnPromptTabSystem.style.borderColor = '';
  el.btnPromptTabSystem.style.color = '';
  el.btnPromptTabFull.style.borderColor = '';
  el.btnPromptTabFull.style.color = '';
  el.btnPromptTabLatest.style.borderColor = '';
  el.btnPromptTabLatest.style.color = '';

  if (tab === 'system') {
    el.btnPromptTabSystem.style.borderColor = 'var(--accent-color)';
    el.btnPromptTabSystem.style.color = 'var(--accent-color)';
    el.promptTextarea.value = systemPromptText;
    el.promptCardDesc.innerText = '複製系統說明與可用工具定義，貼至 LLM 設定做為 System Prompt：';
  } else if (tab === 'full') {
    el.btnPromptTabFull.style.borderColor = 'var(--accent-color)';
    el.btnPromptTabFull.style.color = 'var(--accent-color)';
    el.promptTextarea.value = fullPromptText;
    el.promptCardDesc.innerText = '複製完整提示詞，在新對話的第一輪貼給 LLM：';
  } else {
    el.btnPromptTabLatest.style.borderColor = 'var(--accent-color)';
    el.btnPromptTabLatest.style.color = 'var(--accent-color)';
    el.promptTextarea.value = latestPromptText;
    el.promptCardDesc.innerText = '複製最新指令或工具結果，在既有 LLM 對話中貼上即可：';
  }
}

function handleCopyToolResult() {
  el.toolResultTextarea.select();
  document.execCommand('copy');
  
  const originalText = el.btnCopyToolResult.innerText;
  el.btnCopyToolResult.innerText = '✅ 已複製工具執行結果！';
  el.btnCopyToolResult.style.background = 'linear-gradient(135deg, #00e676 0%, #00b0ff 100%)';
  
  setTimeout(() => {
    el.btnCopyToolResult.innerText = originalText;
    el.btnCopyToolResult.style.background = '';
  }, 2000);
}

// 初始化啟動
window.onload = init;
