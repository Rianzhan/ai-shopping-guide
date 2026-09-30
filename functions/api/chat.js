/**
 * 澄初 AI 金牌导购 —— 聊天代理接口（服务端调用 Coze Agent API）
 *
 * 数据流：
 *   前端 POST /api/chat {message, session_id}
 *   → 本 Functions 读取环境变量 COZE_API_TOKEN
 *   → 按扣子官方「执行智能体」API 格式 POST https://3fyqqwfb9j.coze.site/stream_run
 *   → 解析 SSE 流，仅把 answer / error / done 事件转发给前端
 *     （tool_request、thinking 等内部事件一律不过滤到前端）
 *
 * 安全设计：
 *   - COZE_API_TOKEN 只存在于 Cloudflare Pages secret 中，绝不下发前端。
 *   - API 调用失败时返回明确错误，不伪造智能体回答。
 */

const COZE_ENDPOINT = 'https://3fyqqwfb9j.coze.site/stream_run';

export async function onRequest(context) {
  const { env, request } = context;

  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: '仅支持 POST' }, { status: 405 });
  }

  const apiToken = env.COZE_API_TOKEN;
  if (!apiToken) {
    return Response.json(
      {
        ok: false,
        code: 'MISSING_CONFIG',
        error:
          'Coze API Token 尚未配置：请在 Cloudflare Pages 项目设置中添加环境变量 COZE_API_TOKEN（扣子部署页「管理 API Token」创建）。',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  const projectId = env.COZE_PROJECT_ID;
  if (!projectId) {
    return Response.json(
      {
        ok: false,
        code: 'MISSING_CONFIG',
        error:
          'Coze 项目 ID 尚未配置：请在 Cloudflare Pages 项目设置中添加环境变量 COZE_PROJECT_ID。',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const message = String(body.message || '').trim();
  const sessionId = String(body.session_id || '').trim();
  if (!message) {
    return Response.json({ ok: false, error: '缺少 message 字段' }, { status: 400 });
  }
  if (!sessionId) {
    return Response.json({ ok: false, error: '缺少 session_id 字段' }, { status: 400 });
  }
  if (message.length > 2000) {
    return Response.json({ ok: false, error: '消息过长（最多 2000 字）' }, { status: 400 });
  }

  // 调用扣子「执行智能体」API（官方请求结构，勿改动）
  let upstream;
  try {
    upstream = await fetch(COZE_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: {
          query: {
            prompt: [
              {
                type: 'text',
                content: { text: message },
              },
            ],
          },
        },
        type: 'query',
        session_id: sessionId,
        project_id: Number(projectId),
      }),
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: '无法连接 Coze 智能体服务，请稍后重试' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => '');
    return Response.json(
      {
        ok: false,
        error: `Coze 智能体服务返回错误（HTTP ${upstream.status}）`,
        detail: errText.slice(0, 300),
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // 读取上游 SSE 流，仅转发 answer / error / done
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = '';
      try {
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
              continue; // 非 JSON 的 data 行直接忽略
            }
            const type = evt.type;
            const content = evt.content || {};
            if (type === 'answer') {
              const text = content.answer;
              if (typeof text === 'string' && text.length > 0) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: 'answer', text })}\n\n`
                  )
                );
              }
            } else if (type === 'error') {
              const msg = content.error;
              const display =
                typeof msg === 'string' && msg
                  ? msg
                  : '智能体执行出错，请稍后重试';
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: 'error', message: display })}\n\n`
                )
              );
            } else if (type === 'message_end') {
              const endInfo = content.message_end || {};
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: 'done', code: endInfo.code ?? '0' })}\n\n`
                )
              );
            }
            // message_start / thinking / tool_request / tool_response 等内部事件不转发
          }
        }
      } catch {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'error', message: '流式响应中断，请重试' })}\n\n`
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
