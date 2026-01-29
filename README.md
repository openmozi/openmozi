# Mozi (墨子)

**支持国产大模型和国产通讯软件的智能助手框架**

Mozi 是一个轻量级的 AI 助手框架，专注于国产生态。它提供统一的接口对接多种国产 AI 模型（DeepSeek、Qwen、Kimi 等），支持 OpenAI Function Calling，并能在飞书、钉钉、WebChat 等平台上运行。

## 与 Moltbot 对比

Mozi 的架构设计参考了 [Moltbot](https://github.com/moltbot/moltbot)，但专注于不同的使用场景。

| 特性 | Mozi | Moltbot |
|------|------|---------|
| **定位** | 国产生态优先的轻量框架 | 全功能个人 AI 助手 |
| **代码量** | ~16,000 行 (64 文件) | ~516,000 行 (3,137 文件) |
| **国产模型** | ✅ DeepSeek、Qwen、Kimi、阶跃星辰、MiniMax | ❌ 仅 Anthropic、OpenAI |
| **国产通讯** | ✅ 飞书、钉钉原生支持 | ❌ WhatsApp、Telegram、Slack 等海外平台 |
| **部署复杂度** | 简单，npm install 即可 | 复杂，需要配置多个系统权限 |
| **Node.js 版本** | ≥18 | ≥22 |
| **上手门槛** | 低，配置一个 API Key 即可使用 | 高，需要配置 OAuth、TCC 权限等 |
| **资源占用** | 轻量 | 较重（菜单栏应用、语音唤醒等） |
| **适用场景** | 企业内部机器人、国内团队协作 | 个人多设备助手、海外平台集成 |

> **Mozi 用 3% 的代码量实现了核心功能**，专注简洁高效，易于理解和二次开发。

### 选择 Mozi 的理由

- **国产模型一站式支持** — 无需翻墙，直接对接 DeepSeek、通义千问等国产大模型
- **飞书/钉钉开箱即用** — 原生支持国内主流办公平台，配置简单
- **轻量快速** — 专注核心功能，无冗余依赖，启动快、资源占用少
- **低门槛** — 一个 API Key + 三行配置即可运行，适合快速验证和部署
- **企业友好** — 适合国内企业内网环境，无外部依赖

### 选择 Moltbot 的理由

- 需要 WhatsApp、Telegram、Discord 等海外平台支持
- 需要语音唤醒、Live Canvas 等高级交互功能
- 需要多设备同步、macOS/iOS 深度集成
- 个人使用场景，设备控制需求

## 核心特性

- **多模型支持** — DeepSeek、ModelScope (Qwen)、Kimi、阶跃星辰、MiniMax，以及 OpenAI/Anthropic 兼容格式
- **多平台通道** — WebChat、飞书、钉钉，统一的消息处理接口
- **Function Calling** — 原生支持 OpenAI tools/tool_choice 参数
- **15+ 内置工具** — 文件读写、Bash 执行、代码搜索、网页获取等
- **会话管理** — 上下文压缩、会话持久化、Memory 向量记忆
- **可扩展** — 插件系统、Hook 事件、自定义工具

## 快速开始

### 环境要求

- Node.js >= 18
- npm / pnpm / yarn

### 1. 安装

```bash
# 克隆项目
git clone https://github.com/King-Chau/mozi.git
cd mozi

# 安装依赖
npm install

# 构建项目
npm run build
```

### 2. 配置

创建配置文件 `config.local.json5`（会被 git 忽略）：

```json5
{
  providers: {
    // 至少配置一个模型提供商
    deepseek: {
      apiKey: "sk-your-deepseek-key"
    }
  },
  agent: {
    defaultProvider: "deepseek",
    defaultModel: "deepseek-chat"
  }
}
```

或者使用环境变量：

```bash
export DEEPSEEK_API_KEY=sk-your-key
```

### 3. 启动

```bash
# 启动 WebChat（本地调试）
npm run dev -- start --web-only

# 或构建后启动
npm start -- start --web-only
```

打开浏览器访问 `http://localhost:3000` 即可开始对话。

### 4. 连接通讯平台（可选）

如需连接飞书或钉钉，添加相应配置后启动完整服务：

```bash
npm start -- start
```

## 支持的模型提供商

| 提供商 | 环境变量 | 说明 |
|--------|----------|------|
| DeepSeek | `DEEPSEEK_API_KEY` | 推理能力强、性价比高 |
| DashScope | `DASHSCOPE_API_KEY` | 阿里云灵积，通义千问商业版，稳定高并发 |
| 智谱 AI | `ZHIPU_API_KEY` | GLM-4.7/4.6/4.5 系列，清华技术团队，有免费额度 |
| ModelScope | `MODELSCOPE_API_KEY` | 阿里云魔搭社区，Qwen 系列，有免费额度 |
| Kimi | `KIMI_API_KEY` | 长上下文支持 |
| 阶跃星辰 | `STEPFUN_API_KEY` | 多模态能力 |
| MiniMax | `MINIMAX_API_KEY` | 语音、视觉能力 |
| OpenAI | `OPENAI_API_KEY` | 官方 API 或兼容接口 |
| Ollama | `OLLAMA_BASE_URL` | 本地部署 |

## 配置说明

支持 `config.local.json5`、`config.json5`、`config.yaml` 等格式，优先级从高到低。

### 模型提供商配置

所有内置提供商都支持自定义模型配置：

```json5
{
  providers: {
    // 内置提供商 - 直接配置 apiKey 即可使用预设模型
    deepseek: {
      apiKey: "sk-xxx"
    },

    // 内置提供商 + 自定义模型列表
    dashscope: {
      apiKey: "sk-xxx",
      models: [
        {
          id: "qwen-max-latest",
          name: "通义千问 Max",
          contextWindow: 32768,
          maxTokens: 8192
        },
        {
          id: "qwen-plus-latest",
          name: "通义千问 Plus",
          contextWindow: 131072,
          maxTokens: 8192
        }
      ]
    },

    // 自定义 OpenAI 兼容接口
    "custom-provider": {
      id: "my-provider",
      name: "My Provider",
      baseUrl: "https://api.example.com/v1",
      apiKey: "xxx",
      models: [
        {
          id: "model-id",
          name: "Model Name",
          contextWindow: 32768,
          maxTokens: 4096,
          supportsVision: false,
          supportsTools: true
        }
      ]
    }
  }
}
```

### 通讯平台配置

飞书和钉钉都支持两种连接模式：

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| **长连接（默认）** | WebSocket/Stream 主动连接，无需公网 IP | 内网部署、本地开发 |
| Webhook | 被动接收回调，需要公网可访问地址 | 公网服务器部署 |

```json5
{
  channels: {
    // 飞书配置
    feishu: {
      appId: "cli_xxx",
      appSecret: "xxx",
      mode: "websocket"  // "websocket"（默认）或 "webhook"
    },

    // 钉钉配置
    dingtalk: {
      appKey: "xxx",
      appSecret: "xxx",
      mode: "stream"  // "stream"（默认）或 "webhook"
    }
  }
}
```

> **推荐使用长连接模式**：无需公网 IP，无需配置回调地址，启动即可接收消息。

### 完整配置示例

```json5
{
  // 模型提供商配置
  providers: {
    deepseek: {
      apiKey: "sk-xxx"
    },
    dashscope: {
      apiKey: "sk-xxx"  // 阿里云灵积 API Key
    },
    zhipu: {
      apiKey: "xxx"  // 智谱 API Key
    },
    modelscope: {
      apiKey: "ms-xxx"
    }
  },

  // 通讯平台配置（长连接模式，无需公网）
  channels: {
    feishu: {
      appId: "cli_xxx",
      appSecret: "xxx",
      mode: "websocket"  // 默认值，可省略
    },
    dingtalk: {
      appKey: "xxx",
      appSecret: "xxx",
      mode: "stream"  // 默认值，可省略
    }
  },

  // Agent 配置
  agent: {
    defaultProvider: "deepseek",
    defaultModel: "deepseek-chat",
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: "你是墨子，一个智能助手。"
  },

  // 服务器配置
  server: {
    port: 3000,
    host: "0.0.0.0"
  },

  // 日志级别
  logging: {
    level: "info"  // debug | info | warn | error
  }
}
```

## 内置工具

| 类别 | 工具 | 说明 |
|------|------|------|
| 文件 | `read_file` | 读取文件内容 |
| | `write_file` | 写入/创建文件 |
| | `edit_file` | 精确字符串替换 |
| | `list_directory` | 列出目录内容 |
| | `glob` | 按模式搜索文件 |
| | `grep` | 按内容搜索文件 |
| | `apply_patch` | 应用 diff 补丁 |
| 命令 | `bash` | 执行 Bash 命令 |
| | `process` | 管理后台进程 |
| 网络 | `web_search` | 网络搜索 |
| | `web_fetch` | 获取网页内容 |
| 其他 | `current_time` | 获取当前时间 |
| | `calculator` | 数学计算 |

## 平台配置

### 飞书

#### 长连接模式（推荐）

无需公网 IP，适合内网部署和本地开发：

1. 登录 [飞书开放平台](https://open.feishu.cn/)，创建企业自建应用
2. 获取 App ID 和 App Secret
3. 启用「机器人」能力
4. 添加权限：`im:message`、`im:message.group_at_msg`
5. 配置完成，启动服务即可

```json5
{
  channels: {
    feishu: {
      appId: "cli_xxx",
      appSecret: "xxx"
      // mode: "websocket" 是默认值，可省略
    }
  }
}
```

#### Webhook 模式

需要公网可访问地址：

1. 完成上述步骤 1-4
2. 配置事件订阅地址：`http://your-server:3000/webhook/feishu`
3. 订阅事件：`im.message.receive_v1`

```json5
{
  channels: {
    feishu: {
      appId: "cli_xxx",
      appSecret: "xxx",
      mode: "webhook"
    }
  }
}
```

### 钉钉

#### 长连接模式（推荐）

无需公网 IP，使用官方 Stream SDK：

1. 登录 [钉钉开放平台](https://open.dingtalk.com/)，创建企业内部应用
2. 获取 AppKey 和 AppSecret
3. 添加「机器人」能力
4. 配置完成，启动服务即可

```json5
{
  channels: {
    dingtalk: {
      appKey: "xxx",
      appSecret: "xxx"
      // mode: "stream" 是默认值，可省略
    }
  }
}
```

#### Webhook 模式

需要公网可访问地址：

1. 完成上述步骤 1-3
2. 配置消息接收地址：`http://your-server:3000/webhook/dingtalk`

```json5
{
  channels: {
    dingtalk: {
      appKey: "xxx",
      appSecret: "xxx",
      mode: "webhook"
    }
  }
}
```

## CLI 命令

```bash
# 启动服务
npm start -- start              # 完整服务（含飞书/钉钉）
npm start -- start --web-only   # 仅 WebChat
npm start -- start --port 8080  # 指定端口

# 其他命令
npm start -- check              # 检查配置
npm start -- models             # 列出可用模型
npm start -- chat               # 命令行聊天
```

## 项目结构

```
src/
├── agents/        # Agent 核心（会话、上下文压缩）
├── channels/      # 通道适配器（飞书、钉钉）
├── providers/     # 模型提供商
├── tools/         # 内置工具
├── web/           # WebChat 前端
├── config/        # 配置加载
├── gateway/       # HTTP 网关
└── types/         # 类型定义
```

## API 使用

```typescript
import { loadConfig, initializeProviders, getProvider } from "mozi";

const config = loadConfig();
initializeProviders(config);

const provider = getProvider("deepseek");
const response = await provider.chat({
  model: "deepseek-chat",
  messages: [{ role: "user", content: "你好！" }],
});

console.log(response.content);
```

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=King-Chau/mozi&type=Date)](https://star-history.com/#King-Chau/mozi&Date)

## 开发

```bash
# 开发模式（自动重启）
npm run dev -- start --web-only

# 类型检查
npm run typecheck

# 构建
npm run build
```

## License

Apache 2.0
