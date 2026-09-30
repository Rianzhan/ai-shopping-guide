# 澄初 Cloudflare Pages 部署说明（Coze Agent API 版）

## 站点结构

- `index.html`：页面结构、样式与产品详情交互
- `chengchu-coze-adapter.js`：AI 金牌导购聊天客户端（挂载 `#coze-agent-container`）
- `chengchu-chat-demo.js`：旧演示脚本备份（未引用）
- `chengchu-hero-branded.png`：首屏品牌产品图
- `functions/api/chat.js`：Cloudflare Pages Function，服务端代理 Coze Agent API（网页聊天）
- `functions/api/_coze.js`：Coze /stream_run 公共调用模块（chat.js 与 feishu.js 共用）
- `functions/api/feishu.js`：Cloudflare Pages Function，飞书机器人回调接口（/api/feishu）

## 数据流

### 网页端

```
浏览器用户输入
  → POST /api/chat {message, session_id}
  → functions/api/chat.js 读取环境变量 COZE_API_TOKEN
  → 按扣子官方「执行智能体」格式 POST https://3fyqqwfb9j.coze.site/stream_run
  → 解析 SSE 流，仅转发 answer / error / done（tool_request、thinking 不展示）
  → 前端流式拼接 answer 实时显示
```

### 飞书端

```
飞书用户发消息给「澄初金牌导购agent」
  → 开放平台回调 POST https://chengchu.pages.dev/api/feishu
  → challenge 校验（url_verification 原样返回）/ Encrypt Key AES-256-CBC 解密（加密模式）
  → 识别 im.message.receive_v1 → 3 秒内先返回 {"code":0}，后台处理
  → 调 Coze /stream_run（session_id = feishu_<用户open_id>）
  → 用 tenant_access_token 调回复消息 API（im/v1/messages/:message_id/reply）回传回答
```

## 会话保持

- 网页端：前端将 `session_id` 存于 localStorage（key: `chengchu_coze_session_id`），同一窗口复用；「新对话」生成新 id
- 飞书端：以用户 open_id 生成固定 session_id（`feishu_<open_id>`），同一用户多轮记忆自动保留

## 凭证

- `COZE_API_TOKEN`：Coze 智能体 API Token（Cloudflare secret，前端零凭证）
- `COZE_PROJECT_ID`：Coze 智能体 Project ID（Cloudflare secret）
- `FEISHU_APP_ID`：飞书应用 App ID（在飞书开放平台「凭证与基础信息」页查看）
- `FEISHU_APP_SECRET`：飞书应用 App Secret（Cloudflare secret，仅服务端使用）
- `FEISHU_ENCRYPT_KEY`：飞书事件订阅 Encrypt Key（启用加密模式时配置，未启用可留空）
- 更新方式：`wrangler pages secret put <KEY> --project-name=chengchu`
- 本地开发：`outputs/.dev.vars`（仅本地，不部署，已加入 .gitignore）

## 部署命令

```powershell
cd outputs
wrangler pages deploy chengchu-pages --project-name=chengchu --branch=main
```

线上地址：https://chengchu.pages.dev/
