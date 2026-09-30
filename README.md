# 澄初 AI 金牌导购（Chengchu AI Shopping Guide）

一个面向个护品牌的 **AI 导购** 参考实现：顾客像和真人导购一样咨询护肤需求（肤质 / 预算 / 成分偏好），由 **Coze 智能体** 负责产品知识与推荐逻辑，**Cloudflare Pages Functions** 做安全服务端代理。

- 🌐 在线演示：https://chengchu.pages.dev/
- 💬 双渠道：网页弹窗 + 飞书机器人（同一 AI 大脑）
- 🔐 密钥全程在服务端（Cloudflare Secrets），前端与仓库源码零凭证

---

## 功能

| 能力 | 说明 |
|---|---|
| 多轮对话记忆 | 同一会话复用 Coze `session_id`，记得用户之前的需求 |
| 网页端 | 官网右下角 AI 导购弹窗，SSE 流式回答 |
| 飞书端 | 飞书机器人回调 `/api/feishu`，自动回复 |
| 安全 | Token / Secret 只存 Cloudflare Secrets，绝不下发前端 |
| 容错 | 失败显示明确错误 + 重试，不伪造回答 |

## 目录结构

```
chengchu-pages/
├── index.html                # 页面结构、样式、产品区
├── chengchu-coze-adapter.js  # 网页聊天客户端（session 保持 / 重试 / 新对话）
├── chengchu-hero-branded.png # 首屏品牌产品图
└── functions/api/
    ├── chat.js               # 网页聊天代理：转发 SSE answer
    ├── feishu.js             # 飞书回调：校验 → 调 Coze → 回复消息
    └── _coze.js              # Coze /stream_run 公共调用模块
```

## 架构与数据流

```
用户（网页 / 飞书）
   │  HTTPS
   ▼
Cloudflare Pages Functions（唯一可信后端）
   ├─ /api/chat   网页聊天（SSE 流式）
   └─ /api/feishu 飞书回调（challenge / AES 解密 → 调 Coze → 回复）
   │  读取 Cloudflare Secrets（COZE_API_TOKEN / COZE_PROJECT_ID / FEISHU_*）
   ▼
Coze Agent API（/stream_run，执行智能体）
```

## 如何自己部署

### 1. 前置条件

- [Cloudflare](https://dash.cloudflare.com/) 账号（Pages 免费额度即可）
- [Coze](https://www.coze.cn/) 账号，并创建一个「执行智能体」应用

### 2. 准备环境变量

| 变量 | 说明 | 必需 |
|---|---|---|
| `COZE_API_TOKEN` | Coze 部署页「管理 API Token」创建 | ✅ |
| `COZE_PROJECT_ID` | Coze 智能体的 Project ID | ✅ |
| `FEISHU_APP_ID` | 飞书应用 App ID（仅飞书渠道需要） | 可选 |
| `FEISHU_APP_SECRET` | 飞书应用 App Secret（仅飞书渠道需要） | 可选 |
| `FEISHU_ENCRYPT_KEY` | 飞书事件订阅 Encrypt Key（启用加密模式时） | 可选 |

> 本地开发：复制一份 `.dev.vars`（参考 `.dev.vars.example`），**不要提交真实值**。
> 线上：全部用 `wrangler pages secret put <KEY> --project-name=<你的项目>` 配置。

### 3. 部署到 Cloudflare Pages

```powershell
# 安装 wrangler 后
npx wrangler pages deploy chengchu-pages --project-name=your-project --branch=main
```

部署完成后，把 `https://<你的项目>.pages.dev/api/feishu` 填到飞书开放平台「事件与回调」→ 请求地址，并订阅 `im.message.receive_v1`。

### 4. 飞书端（可选）

1. 在[飞书开放平台](https://open.feishu.cn/)创建应用 → 添加「机器人」能力
2. 开通权限：`im:message`（获取与发送单聊、群组消息）
3. 事件与回调 → 订阅 `im.message.receive_v1`，请求地址指向你的 `/api/feishu`
4. 发布应用版本

## 安全设计

- 所有密钥（Coze Token、飞书 App Secret 等）只存在于 **Cloudflare Secrets**，运行时可读、源码不可见
- 前端代码零凭证；`Authorization` 只在服务端拼装
- `.dev.vars`（本地凭证文件）已通过 `.gitignore` 排除，**严禁提交**
- 如果你 fork 了这个仓库，请务必替换成你自己的 Coze / 飞书应用，不要复用任何线上地址

## 演示截图

（欢迎补充你自己的截图）

## License

仅供学习参考，请勿用于商业用途。
