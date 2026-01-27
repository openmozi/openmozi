# 🐼 Mozi (墨子) — 国产 AI 智能助手

<p align="center">
  <strong>支持国产模型和国产通讯软件的智能编程助手</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18-green?style=for-the-badge" alt="Node.js">
  <img src="https://img.shields.io/badge/TypeScript-5.x-blue?style=for-the-badge" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="MIT License">
</p>

**Mozi (墨子)** 是一个支持国产大模型和国产通讯软件的智能编程助手框架。它提供统一的接口来对接多种国产 AI 模型，支持原生 OpenAI Function Calling，并能够在飞书、钉钉、WebChat 等平台上运行。

> 💡 **设计理念**: 参考 [Clawdbot](https://github.com/moltbot/moltbot) 的优秀架构，专注于国产生态，让国内开发者也能享受到顶级的 AI 编程助手体验。

## ✨ 特性

### 🤖 支持的国产模型

| 提供商 | 模型 | 特性 |
|--------|------|------|
| **ModelScope** | Qwen2.5-Coder-32B, Qwen3-235B-A22B, QwQ-32B 等 | 阿里云魔搭社区，免费额度，推理能力强 |
| **DeepSeek** | deepseek-chat, deepseek-reasoner | 推理能力强、性价比高 |
| **Kimi (Moonshot)** | moonshot-v1-8k/32k/128k, kimi-latest | 长上下文、视觉能力 |
| **阶跃星辰 (Stepfun)** | step-1-8k/32k/128k/256k, step-1v, step-2 | 超长上下文、多模态 |
| **MiniMax** | abab6.5s/g/t-chat, MiniMax-Text-01, MiniMax-VL-01 | 语音、视觉能力 |

### 📱 支持的通讯平台

| 平台 | 功能 |
|------|------|
| **WebChat** | 实时流式对话、WebSocket 连接、本地调试 |
| **飞书 (Feishu/Lark)** | 单聊、群聊、@回复、富文本消息 |
| **钉钉 (DingTalk)** | 单聊、群聊、@回复、Webhook 回复 |

### 🛠️ 核心功能

- **原生 Function Calling** — 支持 OpenAI tools/tool_choice 参数，工具结果使用 tool role 消息格式
- **15+ 内置工具** — 文件读写、Bash 执行、代码搜索、网页获取、图片分析、apply_patch 差异修补等
- **上下文压缩** — 智能压缩长对话，支持中文 Token 估算，自动生成摘要
- **模型回退** — 自动故障转移和冷却重试机制
- **会话持久化** — 支持内存和文件存储，会话可跨重启恢复
- **Memory 系统** — 基于 TF-IDF 的向量记忆，支持长期记忆搜索
- **多 Agent 路由** — 子 Agent 委托，支持 researcher/coder/reviewer/planner 等专业角色
- **Hook 系统** — 事件钩子，可扩展处理流程
- **插件系统** — 支持自定义插件扩展功能
- **命令系统** — 支持 `/help`、`/clear`、`/status` 等斜杠命令

## 🚀 快速开始

### 安装

**要求**: Node.js >= 18

```bash
# 全局安装
npm install -g mozi

# 或使用 pnpm
pnpm add -g mozi

# 或使用 yarn
yarn global add mozi
```

### 从源码安装

```bash
git clone https://github.com/anthropics/mozi.git
cd mozi

npm install
npm run build

# 链接到全局
npm link
```

### 快速体验 (推荐)

使用 ModelScope 免费 API 快速体验：

```bash
# 1. 获取 ModelScope API Key: https://modelscope.cn/my/myaccesstoken
# 2. 启动 WebChat
MODELSCOPE_API_KEY=your-key mozi start --web-only

# 3. 打开浏览器访问 http://localhost:3000
```

### 配置引导

```bash
# 运行配置向导 (推荐)
mozi onboard

# 检查配置是否正确
mozi check

# 查看可用模型
mozi models
```

### 启动服务

```bash
# 启动 Gateway 服务器 (包含飞书/钉钉 Webhook)
mozi start

# 仅启动 WebChat (本地调试)
mozi start --web-only

# 指定端口
mozi start --port 3000

# 使用自定义配置文件
mozi start --config ./my-config.yaml
```

### 测试聊天

```bash
# 命令行聊天测试
mozi chat

# 指定模型和提供商
mozi chat --model Qwen2.5-Coder-32B-Instruct --provider modelscope
```

## ⚙️ 配置

### 方式一：环境变量 (推荐)

创建 `.env` 文件：

```bash
# 模型提供商 API Keys (至少配置一个)
MODELSCOPE_API_KEY=ms-xxx           # 推荐，免费额度
DEEPSEEK_API_KEY=sk-xxx
KIMI_API_KEY=sk-xxx
STEPFUN_API_KEY=ak-xxx
MINIMAX_API_KEY=xxx
MINIMAX_GROUP_ID=xxx

# 飞书配置 (可选)
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_ENCRYPT_KEY=xxx
FEISHU_VERIFICATION_TOKEN=xxx

# 钉钉配置 (可选)
DINGTALK_APP_KEY=xxx
DINGTALK_APP_SECRET=xxx
DINGTALK_ROBOT_CODE=xxx

# Agent 配置
MOZI_DEFAULT_MODEL=Qwen2.5-Coder-32B-Instruct
MOZI_DEFAULT_PROVIDER=modelscope

# 服务器配置
MOZI_PORT=3000
MOZI_HOST=0.0.0.0
```

### 方式二：配置文件

支持 `mozi.yaml`、`config.json5` 或 `config.json`：

```yaml
providers:
  modelscope:
    apiKey: ${MODELSCOPE_API_KEY}
  deepseek:
    apiKey: ${DEEPSEEK_API_KEY}
  kimi:
    apiKey: ${KIMI_API_KEY}
  stepfun:
    apiKey: ${STEPFUN_API_KEY}
  minimax:
    apiKey: ${MINIMAX_API_KEY}
    groupId: ${MINIMAX_GROUP_ID}

channels:
  feishu:
    appId: ${FEISHU_APP_ID}
    appSecret: ${FEISHU_APP_SECRET}
    encryptKey: ${FEISHU_ENCRYPT_KEY}
    verificationToken: ${FEISHU_VERIFICATION_TOKEN}
  dingtalk:
    appKey: ${DINGTALK_APP_KEY}
    appSecret: ${DINGTALK_APP_SECRET}
    robotCode: ${DINGTALK_ROBOT_CODE}

agent:
  defaultModel: Qwen2.5-Coder-32B-Instruct
  defaultProvider: modelscope
  systemPrompt: |
    你是墨子，一个智能编程助手。请用中文回答问题，代码使用英文。
  temperature: 0.7
  maxTokens: 4096
  enableFunctionCalling: true
  workingDirectory: /path/to/your/project

# 会话存储配置
sessions:
  type: file  # memory | file
  directory: ~/.mozi/sessions
  ttlMs: 86400000  # 24小时

# Memory 配置
memory:
  enabled: true
  directory: ~/.mozi/memory

server:
  port: 3000
  host: 0.0.0.0

logging:
  level: info
```

## 🔧 内置工具

Mozi 提供 15+ 内置工具，支持完整的编程助手功能：

### 文件操作
| 工具 | 说明 |
|------|------|
| `read_file` | 读取文件内容，支持分页读取大文件 |
| `write_file` | 写入/创建文件 |
| `edit_file` | 精确字符串替换编辑 |
| `list_directory` | 列出目录内容 |
| `glob` | 按模式搜索文件 |
| `grep` | 按内容搜索文件 |
| `apply_patch` | 应用统一 diff 格式补丁 |

### 命令执行
| 工具 | 说明 |
|------|------|
| `bash` | 执行 Bash 命令，支持后台运行 |
| `process` | 管理后台进程 (poll/kill) |

### 网络与媒体
| 工具 | 说明 |
|------|------|
| `web_search` | 网络搜索 |
| `web_fetch` | 获取网页内容 |
| `browser` | Playwright 浏览器控制 (可选) |
| `image_analyze` | 图片分析 (多模态模型) |

### 系统工具
| 工具 | 说明 |
|------|------|
| `current_time` | 获取当前时间 |
| `calculator` | 数学计算 |
| `delay` | 延时等待 |

## 📱 平台配置指南

### WebChat (本地调试)

无需配置，直接启动：

```bash
MODELSCOPE_API_KEY=your-key mozi start --web-only
# 访问 http://localhost:3000
```

### 飞书配置

1. 登录 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 获取 App ID 和 App Secret
4. 启用「机器人」能力
5. 配置事件订阅：
   - 请求网址: `http://your-server:3000/webhook/feishu`
   - 订阅事件: `im.message.receive_v1`
6. 添加权限：
   - `im:message` - 获取与发送消息
   - `im:message.group_at_msg` - 接收群聊@消息
   - `contact:user.base:readonly` - 获取用户信息

### 钉钉配置

1. 登录 [钉钉开放平台](https://open.dingtalk.com/)
2. 创建企业内部应用
3. 获取 AppKey 和 AppSecret
4. 添加「机器人」能力
5. 配置消息接收：
   - 模式: HTTP 模式
   - 地址: `http://your-server:3000/webhook/dingtalk`
6. 添加权限：
   - 企业内机器人发送消息
   - 通讯录个人信息读权限

## 🔌 API 使用

```typescript
import {
  loadConfig,
  initializeProviders,
  createAgent,
  startGateway,
  getProvider,
} from "mozi";

// 使用配置文件
const config = loadConfig();
initializeProviders(config);
const agent = createAgent(config);

// 或直接使用提供商
const provider = getProvider("modelscope");
const response = await provider.chat({
  model: "Qwen2.5-Coder-32B-Instruct",
  messages: [{ role: "user", content: "你好！" }],
  tools: [...],  // OpenAI 工具定义
  tool_choice: "auto",
});
console.log(response.content);
console.log(response.toolCalls);  // 工具调用

// 流式响应
for await (const chunk of provider.chatStream({
  model: "Qwen2.5-Coder-32B-Instruct",
  messages: [{ role: "user", content: "讲个故事" }],
})) {
  process.stdout.write(chunk.delta);
  if (chunk.toolCallDeltas) {
    // 处理工具调用增量
  }
}
```

## 📁 项目结构

```
src/
├── agents/              # Agent 核心
│   ├── agent.ts         # 主 Agent 类 (支持原生 function calling)
│   ├── compaction.ts    # 上下文压缩
│   ├── system-prompt.ts # 系统提示构建
│   ├── session-store.ts # 会话持久化
│   └── model-fallback.ts
├── channels/            # 通道适配器
│   ├── feishu/          # 飞书
│   └── dingtalk/        # 钉钉
├── commands/            # 命令系统
├── config/              # 配置加载
├── gateway/             # HTTP 网关
├── hooks/               # 事件钩子
├── memory/              # Memory 向量记忆系统
│   └── index.ts         # TF-IDF 嵌入 + JSON 存储
├── plugins/             # 插件系统
├── providers/           # 模型提供商
│   ├── modelscope.ts    # ModelScope (Qwen 系列)
│   ├── deepseek.ts
│   ├── kimi.ts
│   ├── stepfun.ts
│   └── minimax.ts
├── tools/               # 工具系统
│   ├── builtin/         # 内置工具
│   │   ├── filesystem.ts
│   │   ├── bash.ts
│   │   ├── apply-patch.ts
│   │   ├── subagent.ts
│   │   └── ...
│   └── registry.ts
├── types/               # 类型定义
├── utils/               # 工具函数
└── web/                 # WebChat 前端
```

## 🆚 与 Clawdbot 功能对比

Mozi 的设计参考了 [Clawdbot](https://github.com/moltbot/moltbot) 的优秀架构，专注于国产生态。

### 定位对比

| 维度 | Mozi (墨子) | Clawdbot |
|-----|-------------|----------|
| **目标用户** | 国内企业和开发者 | 海外个人用户 |
| **语言** | 中文优先 | 英文优先 |
| **合规性** | 符合国内数据安全要求 | 依赖海外服务 |
| **安装** | `npm install -g mozi` | `npm install -g @anthropic-ai/clawdbot` |

### 模型支持对比

| 模型 | Mozi | Clawdbot |
|-----|------|----------|
| ModelScope (Qwen 系列) | ✅ | ❌ |
| DeepSeek | ✅ | ❌ |
| Kimi (Moonshot) | ✅ | ❌ |
| 阶跃星辰 (Stepfun) | ✅ | ❌ |
| MiniMax | ✅ | ❌ |
| Claude (Anthropic) | ❌ | ✅ |
| GPT (OpenAI) | ❌ | ✅ |
| Gemini (Google) | ❌ | ✅ |
| Ollama (本地) | 🔜 计划中 | ✅ |

### 通道支持对比

**Mozi 支持的渠道 (3个)**:
| 通道 | 说明 |
|-----|------|
| WebChat | 实时流式对话、WebSocket 连接、本地调试 |
| 飞书 (Feishu/Lark) | 单聊、群聊、@回复、富文本消息 |
| 钉钉 (DingTalk) | 单聊、群聊、@回复、Webhook 回复 |
| 企业微信 | 🔜 计划中 |

**Clawdbot 支持的渠道 (19个)**:
| 通道 | 说明 |
|-----|------|
| Terminal | 命令行交互 |
| WhatsApp | 即时通讯 |
| Telegram | 即时通讯 |
| Discord | 社区聊天 |
| Slack | 企业协作 |
| Google Chat | Google 办公套件 |
| Mattermost | 开源团队协作 |
| Signal | 加密通讯 |
| BlueBubbles | iMessage 桥接 |
| iMessage | Apple 消息 |
| Microsoft Teams | 微软办公协作 |
| LINE | 日韩流行通讯 |
| Nextcloud Talk | 开源协作 |
| Matrix | 去中心化通讯 |
| Nostr | 去中心化社交 |
| Tlon | 去中心化平台 |
| Twitch | 直播互动 |
| Zalo | 越南流行通讯 |
| Zalo Personal | Zalo 个人版 |

**对比总结**:
| 维度 | Mozi | Clawdbot |
|-----|------|----------|
| 国内企业通讯 (飞书/钉钉) | ✅ 原生支持 | ❌ 不支持 |
| 海外即时通讯 | ❌ | ✅ 19个渠道 |
| WebChat/本地调试 | ✅ | ✅ (Terminal) |

### 核心功能对比

| 功能 | Mozi | Clawdbot | 说明 |
|-----|------|----------|------|
| 原生 Function Calling | ✅ | ✅ | tools/tool_choice 参数 |
| Tool 消息格式 | ✅ | ✅ | role: "tool" + tool_call_id |
| 文件读写工具 | ✅ | ✅ | read_file, write_file, edit_file |
| Bash 执行 | ✅ | ✅ | 后台进程支持 |
| apply_patch | ✅ | ✅ | 统一 diff 格式 |
| 代码搜索 | ✅ | ✅ | glob, grep |
| 上下文压缩 | ✅ | ✅ | 长对话自动摘要 |
| 模型回退 | ✅ | ✅ | 故障自动切换 |
| 会话持久化 | ✅ | ✅ | 内存/文件存储 |
| Memory/RAG | ✅ | ✅ | 向量记忆 |
| 多 Agent 路由 | ✅ | ✅ | 子 Agent 委托 |
| Hook 系统 | ✅ | ✅ | 事件钩子 |
| 插件系统 | ✅ | ✅ | 可扩展插件 |
| 命令系统 | ✅ | ✅ | 斜杠命令 |
| 图片分析 | ✅ | ✅ | 多模态视觉 |
| 浏览器控制 | ✅ | ✅ | Playwright |
| 语音对话 | 🔜 计划中 | ✅ | TTS/STT |
| Canvas 画布 | ❌ | ✅ | 可视化工作区 |

### 为什么选择 Mozi?

1. **数据合规** — 使用国产模型，数据不出境，符合国内企业数据安全要求
2. **成本优势** — ModelScope 免费额度 + DeepSeek 等高性价比模型
3. **中文优化** — 针对中文场景优化，Token 估算、分词更准确
4. **企业通讯** — 原生支持飞书、钉钉等企业级通讯平台
5. **简单部署** — 轻量级设计，无需复杂依赖

## 🗺️ 路线图

- [x] 核心 Agent 功能 (原生 function calling)
- [x] 模型提供商 (ModelScope, DeepSeek, Kimi, Stepfun, MiniMax)
- [x] 通道适配器 (WebChat, 飞书, 钉钉)
- [x] 15+ 内置工具 (文件、Bash、搜索、apply_patch 等)
- [x] 上下文压缩
- [x] 模型回退
- [x] 会话持久化
- [x] Memory 向量记忆系统
- [x] 多 Agent 路由
- [x] Hook 系统
- [x] 插件系统
- [x] 命令系统
- [ ] MCP (Model Context Protocol) 支持
- [ ] 企业微信支持
- [ ] VS Code 扩展
- [ ] Ollama 本地模型支持

## 🧩 插件开发

```typescript
import { definePlugin, type PluginDefinition } from 'mozi';

const myPlugin: PluginDefinition = {
  meta: {
    id: 'my-plugin',
    name: 'My Plugin',
    version: '1.0.0',
    description: '自定义插件示例'
  },
  initialize: (api) => {
    // 注册自定义工具
    api.registerTool({
      name: 'my_tool',
      description: '自定义工具',
      parameters: Type.Object({
        query: Type.String({ description: '查询参数' })
      }),
      execute: async (toolCallId, args) => ({
        content: [{ type: 'text', text: `结果: ${args.query}` }]
      })
    });

    // 注册事件钩子
    api.registerHook('message_received', (event) => {
      api.getLogger().info('收到消息:', event.context.content);
    });
  },
  cleanup: () => {
    // 清理资源
  }
};

export default myPlugin;
```

## 🔧 CLI 命令参考

```bash
mozi --help                  # 显示帮助
mozi --version               # 显示版本

mozi start                   # 启动服务
mozi start --web-only        # 仅启动 WebChat
mozi start --port 3000       # 指定端口
mozi start --config ./x.yaml # 指定配置文件

mozi check                   # 检查配置
mozi models                  # 列出可用模型
mozi chat                    # 命令行聊天
mozi onboard                 # 配置引导向导
```

## 🪝 Hook 事件类型

| 事件 | 说明 |
|------|------|
| `message_received` | 收到消息 |
| `message_sending` | 即将发送消息 |
| `message_sent` | 消息已发送 |
| `agent_start` | Agent 开始处理 |
| `agent_end` | Agent 处理完成 |
| `tool_start` | 工具开始执行 |
| `tool_end` | 工具执行完成 |
| `compaction_start` | 上下文压缩开始 |
| `compaction_end` | 上下文压缩完成 |
| `error` | 发生错误 |

## 🤝 贡献

欢迎贡献代码！请查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解详情。

## 📄 License

MIT License - 详见 [LICENSE](LICENSE) 文件。

## 🙏 致谢

- [Clawdbot](https://github.com/moltbot/moltbot) — 架构设计参考
- [ModelScope](https://modelscope.cn/) — 阿里云魔搭社区
- [DeepSeek](https://deepseek.com/) — 高性价比 AI 模型
- [Moonshot AI](https://moonshot.cn/) — Kimi 长上下文模型
- [阶跃星辰](https://stepfun.com/) — 多模态 AI
- [MiniMax](https://minimax.chat/) — 语音和多模态 AI

---

<p align="center">
  <sub>墨子 — 兼爱非攻，智慧助人</sub>
</p>
