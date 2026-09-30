/**
 * Coze Agent API 公共调用模块（供 /api/chat 与 /api/feishu 复用）
 * 内部模块（下划线前缀），不会被 Pages 路由为独立接口。
 */

const COZE_ENDPOINT = 'https://3fyqqwfb9j.coze.site/stream_run';

/**
 * 调用 Coze /stream_run 并收集完整回答（非流式场景：飞书回复等）。
 * 内部过滤 tool_request / thinking 等事件，只拼接 answer。
 * @param {string} message 用户文本
 * @param {string} sessionId 多轮会话 ID
 * @param {object} env 环境变量（需含 COZE_API_TOKEN 与 COZE_PROJECT_ID）
 * @returns {Promise<string>} 完整回答文本
 */
export async function collectCozeAnswer(message, sessionId, env) {
  const apiToken = env.COZE_API_TOKEN;
  const projectId = env.COZE_PROJECT_ID;
  if (!apiToken) {
    throw new Error('COZE_API_TOKEN 未配置');
  }
  if (!projectId) {
    throw new Error('COZE_PROJECT_ID 未配置');
  }

  const upstream = await fetch(COZE_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: {
        query: {
          prompt: [{ type: 'text', content: { text: message } }],
        },
      },
      type: 'query',
      session_id: sessionId,
      project_id: Number(projectId),
    }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '');
    throw new Error(`Coze 智能体服务返回错误（HTTP ${upstream.status}）${errText.slice(0, 200)}`);
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const raw = trimmed.slice(5).trim();
      if (!raw) continue;
      let evt;
      try {
        evt = JSON.parse(raw);
      } catch {
        continue;
      }
      if (evt.type === 'answer') {
        const part = evt.content && evt.content.answer;
        if (typeof part === 'string') answer += part;
      } else if (evt.type === 'error') {
        const msg = evt.content && evt.content.error;
        throw new Error(typeof msg === 'string' && msg ? msg : '智能体执行出错');
      }
    }
  }

  return answer.trim();
}
