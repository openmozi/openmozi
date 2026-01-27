# Mozi (墨子) - 国产AI智能编程助手

## 项目简介
- **设计理念**: 参考Claude Code的优秀架构，专注于国产生态。
- **目标用户**: 国内企业和开发者
- **语言**: 中文优先
- **合规性**: 符合国内数据安全要求
- **成本优势**: 使用国产模型，如ModelScope等免费额度和高性价比模型
- **中文优化**: 针对中文场景优化，提供更准确的Token估算和分词

## 快速开始
- **安装方法**:
  - 全球安装: `npm install -g mozi`
  - 从源码安装: `git clone` -> `npm install` -> `npm run build` -> `npm link`
- **配置方式**:
  - 环境变量
  - 配置文件
- **基本用法**:
  - `mozi start`: 启动服务
  - `mozi start --web-only`: 仅启动WebChat
  - `mozi start --port 3000`: 指定端口
  - `mozi start --config ./x.yaml`: 指定配置文件
  - `mozi check`: 检查配置
  - `mozi models`: 列出可用模型
  - `mozi chat`: 命令行聊天
  - `mozi onboard`: 配置引导向导

## 项目结构
```
src/
├── agents/
├── channels/
├── commands/
├── config/
├── gateway/
├── hooks/
├── memory/
├── plugins/
├── providers/
├── tools/
├── types/
├── utils/
└── web/
```

## 功能对比
- **与Claude Code的功能对比**:
  - **原生Function Calling**: 两者都支持
  - **工具消息格式**: 两者都支持
  - **模型提供商**: Mozi支持ModelScope、DeepSeek、Kimi、Stepfun、MiniMax; Claude Code支持Anthropic、GPT
  - **通道支持**: Mozi支持WebChat、飞书、钉钉; Claude Code支持Terminal
  - **为什么选择Mozi**: 数据合规、成本优势、中文优化、企业通讯支持等

## CLI命令参考
- **常用命令**:
  - `mozi --help`: 显示帮助
  - `mozi --version`: 显示版本
  - `mozi start`: 启动服务
  - `mozi start --web-only`: 仅启动WebChat
  - `mozi start --port 3000`: 指定端口
  - `mozi start --config ./x.yaml`: 指定配置文件
  - `mozi check`: 检查配置
  - `mozi models`: 列出可用模型
  - `mozi chat`: 命令行聊天
  - `mozi onboard`: 配置引导向导

## Hook事件类型
- **事件类型**:
  - `message_received`: 收到消息
  - `message_sending`: 即将发送消息
  - `message_sent`: 消息已发送
  - `agent_start`: Agent开始处理
  - `agent_end`: Agent处理完成
  - `tool_start`: 工具开始执行
  - `tool_end`: 工具执行完成
  - `compaction_start`: 上下文压缩开始
  - `compaction_end`: 上下文压缩完成
  - `error`: 发生错误

## 插件开发
- **插件开发概述**:
  - **定义插件**: 使用`definePlugin`注册插件
  - **初始化**: 注册自定义工具和事件钩子
  - **示例代码**:
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

## 致谢
- **感谢**:
  - [Claude Code](https://github.com/anthropics/claude-code)——架构设计参考
  - [ModelScope](https://modelscope.cn/)——阿里云魔搭社区
  - [DeepSeek](https://deepseek.com/)——高性价比AI模型
  - [Moonshot AI](https://moonshot.cn/)——Kimi长上下文模型
  - [阶跃星辰](https://stepfun.com/)——多模态AI
  - [MiniMax](https://minimax.chat/)——语音和多模态AI