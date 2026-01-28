# Mozi (墨子)

**支持国产大模型和国产通讯软件的智能助手框架**

Mozi 是一个轻量级的 AI 助手框架，专注于国产生态。它提供统一的接口对接多种国产 AI 模型（DeepSeek、Qwen、Kimi 等），支持 OpenAI Function Calling，并能在飞书、钉钉、WebChat 等平台上运行。

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
git clone https://github.com/anthropics/mozi.git
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
| ModelScope | `MODELSCOPE_API_KEY` | 阿里云魔搭，Qwen 系列，有免费额度 |
| Kimi | `KIMI_API_KEY` | 长上下文支持 |
| 阶跃星辰 | `STEPFUN_API_KEY` | 多模态能力 |
| MiniMax | `MINIMAX_API_KEY` | 语音、视觉能力 |
| OpenAI | `OPENAI_API_KEY` | 官方 API 或兼容接口 |
| Ollama | `OLLAMA_BASE_URL` | 本地部署 |

## 配置说明

支持 `config.local.json5`、`config.json5`、`config.yaml` 等格式，优先级从高到低。

### 完整配置示例

```json5
{
  // 模型提供商配置
  providers: {
    deepseek: {
      apiKey: "sk-xxx"
    },
    modelscope: {
      apiKey: "ms-xxx"
    },
    // 自定义 OpenAI 兼容接口
    "custom-openai": {
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
          supportsVision: false
        }
      ]
    }
  },

  // 通讯平台配置
  channels: {
    feishu: {
      appId: "cli_xxx",
      appSecret: "xxx"
    },
    dingtalk: {
      appKey: "xxx",
      appSecret: "xxx"
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

1. 登录 [飞书开放平台](https://open.feishu.cn/)，创建企业自建应用
2. 获取 App ID 和 App Secret
3. 启用「机器人」能力
4. 配置事件订阅地址：`http://your-server:3000/webhook/feishu`
5. 订阅事件：`im.message.receive_v1`
6. 添加权限：`im:message`、`im:message.group_at_msg`

### 钉钉

1. 登录 [钉钉开放平台](https://open.dingtalk.com/)，创建企业内部应用
2. 获取 AppKey 和 AppSecret
3. 添加「机器人」能力
4. 配置消息接收地址：`http://your-server:3000/webhook/dingtalk`

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

## 开发

```bash
# 开发模式（自动重启）
npm run dev -- start --web-only

# 类型检查
npm run typecheck

# 构建
npm run build
```

## 与 Moltbot 对比

Mozi 的架构设计参考了 [Moltbot](https://github.com/moltbot/moltbot)，但专注于不同的使用场景。

| 特性 | Mozi | Moltbot |
|------|------|---------|
| **定位** | 国产生态优先的轻量框架 | 全功能个人 AI 助手 |
| **国产模型** | ✅ DeepSeek、Qwen、Kimi、阶跃星辰、MiniMax | ❌ 仅 Anthropic、OpenAI |
| **国产通讯** | ✅ 飞书、钉钉原生支持 | ❌ WhatsApp、Telegram、Slack 等海外平台 |
| **部署复杂度** | 简单，npm install 即可 | 复杂，需要配置多个系统权限 |
| **Node.js 版本** | ≥18 | ≥22 |
| **上手门槛** | 低，配置一个 API Key 即可使用 | 高，需要配置 OAuth、TCC 权限等 |
| **资源占用** | 轻量 | 较重（菜单栏应用、语音唤醒等） |
| **适用场景** | 企业内部机器人、国内团队协作 | 个人多设备助手、海外平台集成 |

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

## License

Apache 2.0
