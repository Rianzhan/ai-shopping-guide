/**
 * 澄初 AI 金牌导购 —— 飞书机器人回调接口 /api/feishu
 *
 * 链路：
 *   用户在飞书给「澄初金牌导购agent」发消息
 *   → 飞书开放平台把事件回调 POST 到本接口（https://chengchu.pages.dev/api/feishu）
 *   → 校验（challenge 验证 / Encrypt Key 解密）
 *   → 识别 im.message.receive_v1，后台处理（waitUntil，3 秒内先返回 code:0）
 *   → 调 Coze /stream_run（session_id = feishu_<open_id>，多轮记忆）
 *   → 用 tenant_access_token 调用回复消息 API 回传给用户
 *
 * 凭证（Cloudflare Pages secret，绝不下发前端）：
 *   FEISHU_APP_ID       飞书应用 App ID
 *   FEISHU_APP_SECRET   飞书应用 App Secret
 *   FEISHU_ENCRYPT_KEY  事件订阅 Encrypt Key（未启用加密模式时可不配置）
 *   COZE_API_TOKEN      Coze 智能体 API Token（已在用）
 *
 * 飞书后台需配置：
 *   开发配置 → 事件与回调 → 将事件发送至开发者服务器
 *   请求地址：https://chengchu.pages.dev/api/feishu
 *   订阅事件：im.message.receive_v1（需开通 im:message 相关权限）
 */

import { collectCozeAnswer } from './_coze.js';

const FEISHU_BASE = 'https://open.feishu.cn';

export async function onRequest(context) {
  const { request, env, waitUntil } = context;

  if (request.method !== 'POST') {
    return Response.json({ code: 1, msg: '仅支持 POST' }, { status: 405 });
  }

  let raw;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ code: 1, msg: '请求体不是合法 JSON' }, { status: 400 });
  }

  // 加密模式：先解密（若配置了 Encrypt Key 且 body 为 {encrypt: ...}）
  let data = raw;
  if (raw.encrypt) {
    if (!env.FEISHU_ENCRYPT_KEY) {
      console.error('收到加密回调但未配置 FEISHU_ENCRYPT_KEY');
      return Response.json({ code: 1, msg: 'encrypt key missing' }, { status: 500 });
    }
    try {
      data = JSON.parse(await feishuDecrypt(env.FEISHU_ENCRYPT_KEY, raw.encrypt));
    } catch (e) {
      console.error('加密回调解密失败', e);
      return Response.json({ code: 1, msg: 'decrypt failed' }, { status: 400 });
    }
  }

  // 地址校验（challenge）：1 秒内原样返回
  if (data.type === 'url_verification') {
    return Response.json({ challenge: data.challenge });
  }

  // 消息事件（兼容 v1 event_callback 与 v2 header 结构）
  const eventType = (data.header && data.header.event_type) || (data.event && data.event.type);
  if (eventType === 'im.message.receive_v1') {
    const event = data.event || {};
    const message = event.message || {};
    const sender = event.sender || {};
    const openId = (sender.sender_id && sender.sender_id.open_id) || '';
    const messageId = message.message_id || '';
    const messageType = message.message_type || '';

    if (messageType === 'text' && messageId && openId) {
      let text = '';
      try {
        text = (JSON.parse(message.content || '{}').text || '').toString();
      } catch {
        text = '';
      }
      // 去掉 @机器人 等标签
      text = text.replace(/<at[^>]*>.*?<\/at>/g, '').trim();
      if (text) {
        waitUntil(handleFeishuMessage({ text, openId, messageId }, env));
      }
    }
  }

  // 事件回调需在 3 秒内响应；业务处理已转入 waitUntil 后台
  return Response.json({ code: 0 });
}

/** 后台处理：调 Coze 获取回答 → 回复飞书消息 */
async function handleFeishuMessage({ text, openId, messageId }, env) {
  try {
    // 飞书会话：以用户 open_id 作为 session，同一用户多轮保持记忆
    const sessionId = `feishu_${openId}`;
    const answer = await collectCozeAnswer(text, sessionId, env);
    if (!answer) {
      console.error('Coze 返回空回答，未回复飞书');
      return;
    }
    await replyFeishuMessage(messageId, answer, env);
  } catch (e) {
    console.error('飞书消息处理失败:', e && e.message ? e.message : e);
  }
}

/** 回复飞书消息（应用身份） */
async function replyFeishuMessage(messageId, text, env) {
  const token = await getTenantAccessToken(env);
  const res = await fetch(`${FEISHU_BASE}/open-apis/im/v1/messages/${messageId}/reply`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      content: JSON.stringify({ text }),
      msg_type: 'text',
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j.code !== undefined && j.code !== 0)) {
    console.error('回复飞书失败:', res.status, JSON.stringify(j).slice(0, 400));
  }
}

/** 获取 tenant_access_token（应用身份） */
async function getTenantAccessToken(env) {
  const missing = [];
  if (!env.FEISHU_APP_ID) missing.push('FEISHU_APP_ID');
  if (!env.FEISHU_APP_SECRET) missing.push('FEISHU_APP_SECRET');
  if (missing.length) {
    throw new Error(`缺少飞书凭证: ${missing.join('、')}`);
  }
  const res = await fetch(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: env.FEISHU_APP_ID,
      app_secret: env.FEISHU_APP_SECRET,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (j.code !== 0 || !j.tenant_access_token) {
    throw new Error(`获取 tenant_access_token 失败: ${JSON.stringify(j).slice(0, 300)}`);
  }
  return j.tenant_access_token;
}

/**
 * 飞书回调解密（AES-256-CBC）：
 *   key = SHA256(Encrypt Key)（32 字节）
 *   body = base64(iv(16字节) + AES-CBC 密文)，PKCS#7 填充（Web Crypto 自动处理）
 */
async function feishuDecrypt(encryptKey, encryptedBase64) {
  const keyHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encryptKey));
  const key = await crypto.subtle.importKey('raw', keyHash, { name: 'AES-CBC' }, false, ['decrypt']);

  const full = base64ToBytes(encryptedBase64);
  const iv = full.slice(0, 16);
  const ciphertext = full.slice(16);

  const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
