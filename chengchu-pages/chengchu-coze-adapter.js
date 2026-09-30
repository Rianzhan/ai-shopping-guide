/*
 * 澄初 AI 金牌导购 —— 聊天客户端适配层
 * ==========================================
 * 挂载到 #coze-agent-container，通过我们自己的 /api/chat 与后端通信。
 *
 * 数据流：
 *   用户输入 → POST /api/chat {message, session_id}
 *   → Cloudflare Pages Functions 调 Coze /stream_run（SSE）
 *   → 前端流式读取 answer 片段实时显示
 *
 * 会话保持：
 *   session_id 保存在 localStorage（key: chengchu_coze_session_id），
 *   同一浏览器窗口后续请求复用同一 session_id，保留多轮上下文；
 *   点击「新对话」生成新 session_id 并清空聊天记录。
 *
 * 状态：
 *   发送中（禁用输入 + 思考占位） / 错误（提示 + 重试，不伪造回答） / 空闲
 */
(() => {
  const host = document.getElementById('coze-agent-container');
  if (!host) return;

  const SESSION_KEY = 'chengchu_coze_session_id';
  const MAX_MESSAGE = 180;

  // ---------- 会话管理 ----------
  function getSessionId() {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) || `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  function newSessionId() {
    const id = (crypto.randomUUID && crypto.randomUUID()) || `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(SESSION_KEY, id);
    return id;
  }

  // ---------- 渲染基础聊天 UI（样式复用页面内 .chat 系列） ----------
  host.innerHTML = `
    <div class="chat" aria-label="澄初导购对话">
      <div class="chat-header">
        <div><strong>澄初 AI 金牌导购</strong><small>从你现在最在意的问题开始</small></div>
        <button class="chat-new" type="button" title="清空当前对话并开启新会话">新对话</button>
      </div>
      <div class="chat-messages" aria-live="polite" aria-relevant="additions">
        <div class="message agent">你好。想找哪一类产品？也可以先说预算或香味偏好，我们慢慢聊。</div>
      </div>
      <div class="chat-start"><p>试着从一句话开始</p><div class="quick-questions">
        <button class="chip" type="button" data-demo-question="想找一支洗完不容易紧绷的洁面。">想找温和的洁面</button>
        <button class="chip" type="button" data-demo-question="预算 200，而且我不喜欢香味。">预算 200，不喜欢香味</button>
        <button class="chip" type="button" data-demo-question="最近皮肤有点刺痛，不知道该不该买精华。">皮肤有点刺痛</button>
      </div></div>
      <form class="chat-form"><label for="chat-input">向导购提问</label><input id="chat-input" name="question" type="text" maxlength="${MAX_MESSAGE}" autocomplete="off" placeholder="写下一个想法，慢慢聊"><button type="submit">发送</button></form>
    </div>`;

  const messages = host.querySelector('.chat-messages');
  const form = host.querySelector('.chat-form');
  const input = host.querySelector('#chat-input');
  const sendBtn = form.querySelector('button[type="submit"]');
  const newChatBtn = host.querySelector('.chat-new');

  let pendingMessage = null; // 失败后用于重试
  let currentAgentBubble = null; // 正在流式填充的气泡
  let busy = false;

  // ---------- DOM 辅助 ----------
  function addMessage(kind, text) {
    const message = document.createElement('div');
    message.className = `message ${kind}`;
    message.textContent = text;
    messages.append(message);
    messages.scrollTop = messages.scrollHeight;
    return message;
  }

  function setBusy(state) {
    busy = state;
    input.disabled = state;
    sendBtn.disabled = state;
    input.setAttribute('aria-busy', String(state));
  }

  function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  // ---------- 错误与重试 ----------
  function showError(text) {
    // 替换思考占位为错误提示
    if (currentAgentBubble && currentAgentBubble.classList.contains('pending')) {
      currentAgentBubble.remove();
      currentAgentBubble = null;
    }
    const err = addMessage('agent error', text);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'chat-retry';
    retry.textContent = '重试';
    retry.addEventListener('click', () => {
      if (pendingMessage && !busy) {
        sendMessage(pendingMessage);
      }
    });
    err.append(retry);
    setBusy(false);
  }

  // ---------- 流式请求 ----------
  async function sendMessage(text) {
    const question = String(text || '').trim();
    if (!question || busy) return;

    pendingMessage = question;
    setBusy(true);
    addMessage('user', question);
    input.value = '';

    // 思考占位
    const pending = document.createElement('div');
    pending.className = 'message agent pending';
    pending.textContent = '正在思考…';
    messages.append(pending);
    currentAgentBubble = pending;
    scrollToBottom();

    const sessionId = getSessionId();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, session_id: sessionId }),
      });

      if (!res.ok) {
        let detail = '';
        try {
          const j = await res.json();
          detail = j.error || '';
        } catch { /* ignore */ }
        throw new Error(detail || `请求失败（HTTP ${res.status}）`);
      }

      // 流式读取
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let received = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop();
        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          let evt;
          try {
            evt = JSON.parse(raw);
          } catch { continue; }

          if (evt.type === 'answer' && typeof evt.text === 'string') {
            received = true;
            if (currentAgentBubble && currentAgentBubble.classList.contains('pending')) {
              currentAgentBubble.classList.remove('pending');
              currentAgentBubble.textContent = '';
            }
            if (currentAgentBubble) {
              currentAgentBubble.textContent += evt.text;
              scrollToBottom();
            }
          } else if (evt.type === 'error') {
            showError(evt.message || '智能体出错了，请稍后重试');
            return;
          } else if (evt.type === 'done') {
            // 结束
          }
        }
      }

      if (!received && currentAgentBubble) {
        showError('导购暂时没有回应，请稍后重试');
        return;
      }

      // 正常收尾
      if (currentAgentBubble && currentAgentBubble.classList.contains('pending')) {
        currentAgentBubble.remove();
        currentAgentBubble = null;
      } else {
        currentAgentBubble = null;
      }
      pendingMessage = null;
      setBusy(false);
    } catch (err) {
      showError(err && err.message ? err.message : '网络异常，请稍后重试');
    }
  }

  // ---------- 事件绑定 ----------
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage(input.value);
  });

  host.querySelectorAll('[data-demo-question]').forEach((button) => {
    button.addEventListener('click', () => sendMessage(button.dataset.demoQuestion));
  });

  // 新对话：换新 session_id 并清空消息区（保留欢迎语）
  newChatBtn.addEventListener('click', () => {
    newSessionId();
    pendingMessage = null;
    messages.replaceChildren();
    addMessage('agent', '你好。想找哪一类产品？也可以先说预算或香味偏好，我们慢慢聊。');
    if (currentAgentBubble) currentAgentBubble = null;
    setBusy(false);
  });

  // 页面底部「你可以这样开始」示例问题按钮
  host.addEventListener('chengchu:ask', (event) => {
    const question = event.detail && event.detail.question;
    if (question) sendMessage(question);
  });
})();
