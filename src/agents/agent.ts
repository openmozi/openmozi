/**
 * Agent - 消息处理核心 (增强版)
 * 支持 OpenAI 原生 function calling 和 tool 消息格式
 */

import type {
  ChatMessage,
  ChatCompletionRequest,
  InboundMessageContext,
  MoziConfig,
  ProviderId,
  MessageToolCall,
  OpenAIToolDefinition,
} from "../types/index.js";
import { getProvider, findProviderForModel } from "../providers/index.js";
import { getChildLogger } from "../utils/logger.js";
import { generateId } from "../utils/index.js";
import {
  type Tool,
  type ToolCall,
  type ToolCallResult,
  registerTools,
  getAllTools,
  filterToolsByPolicy,
  executeToolCalls,
  createBuiltinTools,
} from "../tools/index.js";
import {
  estimateMessagesTokens,
  summarizeInStages,
  limitHistoryTurns,
  pruneHistoryForContextShare,
} from "./compaction.js";
import { runWithModelFallback, type FallbackAttempt } from "./model-fallback.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { createSessionStore, type SessionStore, type SessionData } from "./session-store.js";
import { initSkills, type SkillsRegistry } from "../skills/index.js";
import type { SkillsConfig } from "../skills/types.js";
import { createMemoryManager, type MemoryManager } from "../memory/index.js";
import { CronService, getCronService } from "../cron/service.js";

const logger = getChildLogger("agent");

// ============== Agent 配置 ==============

/** Agent 配置 */
export interface AgentOptions {
  /** 默认模型 */
  model: string;
  /** 默认提供商 */
  provider?: ProviderId;
  /** 系统提示 */
  systemPrompt?: string;
  /** 温度 */
  temperature?: number;
  /** 最大输出 token */
  maxTokens?: number;
  /** 最大历史消息数 */
  maxHistoryMessages?: number;
  /** 最大历史轮次 */
  maxHistoryTurns?: number;
  /** 上下文窗口大小 */
  contextWindow?: number;
  /** 是否启用工具 */
  enableTools?: boolean;
  /** 工具策略 */
  toolPolicy?: { allow?: string[]; deny?: string[] };
  /** 是否启用自动压缩 */
  enableCompaction?: boolean;
  /** 压缩阈值 (token 数) */
  compactionThreshold?: number;
  /** 模型回退列表 */
  fallbacks?: Array<{ provider: ProviderId; model: string }>;
  /** 最大工具调用轮次 */
  maxToolRounds?: number;
  /** 工作目录 */
  workingDirectory?: string;
  /** 是否启用原生 function calling */
  enableFunctionCalling?: boolean;
  /** 会话存储 */
  sessionStore?: SessionStore;
  /** MemoryManager 实例 */
  memoryManager?: MemoryManager;
  /** CronService 实例 */
  cronService?: CronService;
}

/** Agent 响应 */
export interface AgentResponse {
  content: string;
  toolCalls?: ToolCallResult[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  provider: ProviderId;
  model: string;
  fallbackAttempts?: FallbackAttempt[];
}

// ============== Agent 类 ==============

/** Agent 类 */
export class Agent {
  private options: Required<Omit<AgentOptions, "sessionStore" | "memoryManager" | "cronService">> & {
    sessionStore: SessionStore;
    memoryManager?: MemoryManager;
    cronService?: CronService;
  };
  private tools: Tool[] = [];
  private openaiTools: OpenAIToolDefinition[] = [];
  private skillsRegistry: SkillsRegistry | null = null;

  constructor(options: AgentOptions) {
    this.options = {
      model: options.model,
      provider: options.provider ?? ("deepseek" as ProviderId),
      systemPrompt: options.systemPrompt ?? "",
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 4096,
      maxHistoryMessages: options.maxHistoryMessages ?? 50,
      maxHistoryTurns: options.maxHistoryTurns ?? 20,
      contextWindow: options.contextWindow ?? 32000,
      enableTools: options.enableTools ?? true,
      toolPolicy: options.toolPolicy ?? {},
      enableCompaction: options.enableCompaction ?? true,
      compactionThreshold: options.compactionThreshold ?? 64000,
      fallbacks: options.fallbacks ?? [],
      maxToolRounds: options.maxToolRounds ?? 10,
      workingDirectory: options.workingDirectory ?? process.cwd(),
      enableFunctionCalling: options.enableFunctionCalling ?? true,
      sessionStore: options.sessionStore ?? createSessionStore(),
      memoryManager: options.memoryManager,
      cronService: options.cronService,
    };

    // 初始化工具
    if (this.options.enableTools) {
      this.initializeTools();
    }
  }

  /** 初始化工具 */
  private initializeTools(): void {
    const builtinTools = createBuiltinTools({
      filesystem: { allowedPaths: [this.options.workingDirectory] },
      bash: { allowedPaths: [this.options.workingDirectory] },
      enableBrowser: true,
      enableMemory: !!this.options.memoryManager,
      memoryManager: this.options.memoryManager,
      enableCron: !!this.options.cronService,
      cronService: this.options.cronService,
    });
    registerTools(builtinTools);
    this.tools = filterToolsByPolicy(getAllTools(), this.options.toolPolicy);

    // 转换为 OpenAI 格式
    this.openaiTools = this.tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    logger.info({ toolCount: this.tools.length }, "Tools initialized");
  }

  /** 设置 Skills 注册表 */
  setSkillsRegistry(registry: SkillsRegistry): void {
    this.skillsRegistry = registry;
  }

  /** 注册自定义工具 */
  registerTool(tool: Tool): void {
    registerTools([tool]);
    this.tools = filterToolsByPolicy(getAllTools(), this.options.toolPolicy);
    this.openaiTools = this.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /** 处理消息 */
  async processMessage(context: InboundMessageContext): Promise<AgentResponse> {
    const sessionKey = this.getSessionKey(context);
    logger.debug({ sessionKey, content: context.content.slice(0, 100) }, "Processing message");

    // 获取会话历史
    const history = this.getSessionHistory(sessionKey);

    // 添加用户消息
    history.messages.push({
      role: "user",
      content: context.content,
    });

    // 检查是否需要压缩
    if (this.options.enableCompaction) {
      await this.maybeCompactHistory(history);
    }

    // 构建请求消息
    const messages = this.buildMessages(history);

    // 执行对话 (可能包含多轮工具调用)
    const response = await this.executeWithTools(messages, history);

    // 添加助手回复到历史
    history.messages.push({
      role: "assistant",
      content: response.content,
    });

    // 更新会话
    history.lastUpdate = Date.now();
    history.totalTokensUsed += response.usage?.totalTokens ?? 0;
    this.trimHistory(history);
    this.options.sessionStore.set(sessionKey, history);

    logger.debug({ sessionKey, usage: response.usage }, "Message processed");

    return response;
  }

  /** 执行对话 (包含原生 function calling) */
  private async executeWithTools(messages: ChatMessage[], history: SessionData): Promise<AgentResponse> {
    let currentMessages = [...messages];
    const allToolCalls: ToolCallResult[] = [];
    let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let fallbackAttempts: FallbackAttempt[] | undefined;

    for (let round = 0; round < this.options.maxToolRounds; round++) {
      // 调用模型
      const result = await runWithModelFallback({
        provider: this.options.provider,
        model: this.options.model,
        fallbacks: this.options.fallbacks,
        run: async (provider, model) => {
          const p = getProvider(provider);
          if (!p) throw new Error(`Provider not found: ${provider}`);

          const request: ChatCompletionRequest = {
            model,
            messages: currentMessages,
            temperature: this.options.temperature,
            maxTokens: this.options.maxTokens,
          };

          // 添加工具定义 (如果启用原生 function calling)
          if (this.options.enableFunctionCalling && this.openaiTools.length > 0) {
            request.tools = this.openaiTools;
            request.tool_choice = "auto";
          }

          return p.chat(request);
        },
        onError: (attempt) => {
          logger.warn({ ...attempt }, "Model call failed");
        },
      });

      fallbackAttempts = result.attempts.length > 0 ? result.attempts : undefined;

      // 累计 token 使用
      if (result.result.usage) {
        totalUsage.promptTokens += result.result.usage.promptTokens;
        totalUsage.completionTokens += result.result.usage.completionTokens;
        totalUsage.totalTokens += result.result.usage.totalTokens;
      }

      // 检查是否有工具调用
      const toolCalls = result.result.toolCalls;

      if (!toolCalls || toolCalls.length === 0) {
        // 没有工具调用，返回结果
        return {
          content: result.result.content,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
          usage: totalUsage,
          provider: result.provider,
          model: result.model,
          fallbackAttempts,
        };
      }

      // 添加 assistant 消息 (包含 tool_calls)
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: result.result.content || null,
        tool_calls: toolCalls,
      };
      currentMessages.push(assistantMessage);
      history.messages.push(assistantMessage);

      // 执行工具调用
      logger.debug({ toolCount: toolCalls.length, round }, "Executing tool calls");
      const toolCallInputs: ToolCall[] = toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: this.parseToolArguments(tc.function.arguments),
      }));

      const toolResults = await executeToolCalls(toolCallInputs);
      allToolCalls.push(...toolResults);

      // 添加 tool 消息 (每个工具调用一个)
      for (const tr of toolResults) {
        const toolMessage: ChatMessage = {
          role: "tool",
          content: this.formatToolResult(tr),
          tool_call_id: tr.toolCallId,
          name: tr.name,
        };
        currentMessages.push(toolMessage);
        history.messages.push(toolMessage);
      }
    }

    throw new Error("Max tool rounds exceeded");
  }

  /** 解析工具参数 */
  private parseToolArguments(argsStr: string): Record<string, unknown> {
    // 处理空字符串或只有空白的情况 - 返回空对象
    if (!argsStr || argsStr.trim() === "" || argsStr.trim() === "{}") {
      return {};
    }

    try {
      const parsed = JSON.parse(argsStr);
      if (typeof parsed !== "object" || parsed === null) {
        logger.warn({ argsStr }, "Tool arguments is not an object");
        return {};
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      // 尝试修复常见的 JSON 格式问题
      logger.warn({ argsStr, error }, "Failed to parse tool arguments, attempting repair");

      // 尝试修复常见问题：
      // 1. 尾部多余逗号
      // 2. 单引号替换为双引号
      // 3. 未转义的换行符
      // 4. 多个 JSON 对象拼接在一起 (claude-code-router bug workaround)
      let repaired = argsStr
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]")
        .replace(/'/g, '"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");

      try {
        return JSON.parse(repaired) as Record<string, unknown>;
      } catch {
        // 检测是否是多个 JSON 对象拼接在一起（如 {...}{...}）
        // 这是 claude-code-router 的一个 bug，它会把多个工具调用的参数发送到同一个 content block
        const multiJsonMatch = repaired.match(/^(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/);
        if (multiJsonMatch && multiJsonMatch[1]) {
          const firstJson = multiJsonMatch[1];
          try {
            logger.warn(
              { original: argsStr, extracted: firstJson },
              "Detected concatenated JSON objects (claude-code-router bug), using first object"
            );
            return JSON.parse(firstJson) as Record<string, unknown>;
          } catch {
            // 继续尝试其他方法
          }
        }

        // 尝试提取第一个完整的 JSON 对象（简单的括号匹配）
        let depth = 0;
        let firstJsonEnd = -1;
        for (let i = 0; i < repaired.length; i++) {
          if (repaired[i] === "{") depth++;
          else if (repaired[i] === "}") {
            depth--;
            if (depth === 0) {
              firstJsonEnd = i;
              break;
            }
          }
        }

        if (firstJsonEnd > 0) {
          const firstJson = repaired.slice(0, firstJsonEnd + 1);
          try {
            const parsed = JSON.parse(firstJson);
            logger.warn(
              { original: argsStr, extracted: firstJson },
              "Extracted first JSON object from concatenated string"
            );
            return parsed as Record<string, unknown>;
          } catch {
            // 仍然失败
          }
        }

        logger.error({ argsStr, repaired }, "Failed to parse tool arguments after repair");
        return {};
      }
    }
  }

  /** 格式化工具结果为字符串 */
  private formatToolResult(result: ToolCallResult): string {
    const content = result.result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    if (result.isError) {
      return `Error: ${content}`;
    }
    return content;
  }

  /** 获取工具参数预览 (Claude Code 风格) */
  private getToolArgsPreview(args?: Record<string, unknown>): string {
    if (!args || Object.keys(args).length === 0) return "";

    // 常见工具的主参数提取
    const mainArg = args.path ?? args.directory ?? args.command ?? args.query ?? args.pattern ?? args.content;
    if (typeof mainArg === "string") {
      const preview = mainArg.replace(/\n/g, " ").trim();
      return preview.length > 40 ? preview.slice(0, 40) + "…" : preview;
    }

    // 其他情况显示简化的参数
    const firstKey = Object.keys(args)[0];
    if (firstKey) {
      const firstVal = args[firstKey];
      if (typeof firstVal === "string") {
        const preview = firstVal.replace(/\n/g, " ").trim();
        return preview.length > 30 ? preview.slice(0, 30) + "…" : preview;
      }
    }

    return "";
  }

  /** 获取错误信息预览 */
  private getErrorPreview(result: ToolCallResult): string {
    const content = result.result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join(" ");

    // 提取第一行错误信息
    const firstLine = content.split("\n")[0]?.trim() ?? "Unknown error";
    return firstLine.length > 50 ? firstLine.slice(0, 50) + "…" : firstLine;
  }

  /** 流式处理消息 (支持原生 function calling) */
  async *processMessageStream(
    context: InboundMessageContext
  ): AsyncGenerator<string, AgentResponse, unknown> {
    const sessionKey = this.getSessionKey(context);
    logger.debug({ sessionKey, content: context.content.slice(0, 100) }, "Processing message (stream)");

    // 获取会话历史
    const history = this.getSessionHistory(sessionKey);

    // 添加用户消息
    history.messages.push({
      role: "user",
      content: context.content,
    });

    // 检查是否需要压缩
    if (this.options.enableCompaction) {
      await this.maybeCompactHistory(history);
    }

    // 构建请求消息
    let currentMessages = this.buildMessages(history);

    // 获取提供商 (先按 provider ID 查找，再按 model ID 查找)
    const provider = (this.options.provider
      ? getProvider(this.options.provider)
      : undefined) ?? findProviderForModel(this.options.model);

    if (!provider) {
      throw new Error(`No provider found for model: ${this.options.model}`);
    }

    let fullContent = "";
    let totalTokens = 0;
    const allToolCalls: ToolCallResult[] = [];

    // 工具调用循环
    for (let round = 0; round < this.options.maxToolRounds; round++) {
      let roundContent = "";
      const pendingToolCalls: Map<string, MessageToolCall> = new Map();

      // 构建请求
      const request: ChatCompletionRequest = {
        model: this.options.model,
        messages: currentMessages,
        temperature: this.options.temperature,
        maxTokens: this.options.maxTokens,
      };

      if (this.options.enableFunctionCalling && this.openaiTools.length > 0) {
        request.tools = this.openaiTools;
        request.tool_choice = "auto";
      }

      // 流式调用
      for await (const chunk of provider.chatStream(request)) {
        // 处理文本内容
        if (chunk.delta) {
          roundContent += chunk.delta;
          yield chunk.delta;
        }

        // 处理工具调用增量
        if (chunk.toolCallDeltas) {
          for (const delta of chunk.toolCallDeltas) {
            // 使用 id 作为 key (优先)，fallback 到 index
            const key = delta.id ?? `idx_${delta.index}`;
            let tc = pendingToolCalls.get(key);
            if (!tc) {
              tc = {
                id: delta.id ?? generateId("tc"),
                type: "function",
                function: { name: "", arguments: "" },
              };
              pendingToolCalls.set(key, tc);
            }
            if (delta.id && tc.id !== delta.id) tc.id = delta.id;
            // 只在名称为空时设置，避免重复累加
            if (delta.function?.name && !tc.function.name) tc.function.name = delta.function.name;
            if (delta.function?.arguments) tc.function.arguments += delta.function.arguments;
          }
        }
      }

      fullContent += roundContent;

      // 检查是否有完整的工具调用
      const completedToolCalls = Array.from(pendingToolCalls.values()).filter(
        (tc) => tc.function.name  // 只要有函数名就认为有效，arguments 可以为空
      );

      // 调试日志
      if (pendingToolCalls.size > 0) {
        logger.debug(
          {
            pendingCount: pendingToolCalls.size,
            completedCount: completedToolCalls.length,
            toolCalls: completedToolCalls.map((tc) => ({
              name: tc.function.name,
              argsLength: tc.function.arguments.length,
              argsPreview: tc.function.arguments.slice(0, 100),
            })),
          },
          "Tool calls accumulated"
        );
      }

      if (completedToolCalls.length === 0) {
        // 没有工具调用，结束循环
        break;
      }

      // 添加 assistant 消息
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: roundContent || null,
        tool_calls: completedToolCalls,
      };
      currentMessages.push(assistantMessage);
      history.messages.push(assistantMessage);

      // 执行工具调用
      const toolCallInputs: ToolCall[] = completedToolCalls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: this.parseToolArguments(tc.function.arguments),
      }));

      const toolResults = await executeToolCalls(toolCallInputs);
      allToolCalls.push(...toolResults);

      // 添加 tool 消息并输出结果摘要 (Claude Code 风格)
      for (const tr of toolResults) {
        const toolMessage: ChatMessage = {
          role: "tool",
          content: this.formatToolResult(tr),
          tool_call_id: tr.toolCallId,
          name: tr.name,
        };
        currentMessages.push(toolMessage);
        history.messages.push(toolMessage);

        // 简洁的工具输出格式
        const argsPreview = this.getToolArgsPreview(toolCallInputs.find(t => t.id === tr.toolCallId)?.arguments);
        if (tr.isError) {
          const errorMsg = this.getErrorPreview(tr);
          yield `\n⏺ ${tr.name}(${argsPreview}) ✗ ${errorMsg}`;
        } else {
          yield `\n⏺ ${tr.name}(${argsPreview}) ✓`;
        }
      }

      yield `\n\n`;
    }

    // 估算 token
    totalTokens = estimateMessagesTokens(currentMessages) + estimateMessagesTokens([
      { role: "assistant", content: fullContent }
    ]);

    // 添加完整回复到历史
    if (!history.messages.some(m => m.role === "assistant" && m.content === fullContent)) {
      history.messages.push({
        role: "assistant",
        content: fullContent,
      });
    }

    // 更新会话
    history.lastUpdate = Date.now();
    history.totalTokensUsed += totalTokens;
    this.trimHistory(history);
    this.options.sessionStore.set(sessionKey, history);

    return {
      content: fullContent,
      toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      usage: {
        promptTokens: estimateMessagesTokens(currentMessages),
        completionTokens: estimateMessagesTokens([{ role: "assistant", content: fullContent }]),
        totalTokens,
      },
      provider: provider.id,
      model: this.options.model,
    };
  }

  /** 获取会话键 */
  private getSessionKey(context: InboundMessageContext): string {
    if (context.chatType === "group") {
      return `${context.channelId}:${context.chatId}`;
    }
    return `${context.channelId}:${context.senderId}`;
  }

  /** 获取会话历史 */
  private getSessionHistory(sessionKey: string): SessionData {
    const cached = this.options.sessionStore.get(sessionKey);
    if (cached) {
      return cached;
    }
    return {
      messages: [],
      lastUpdate: Date.now(),
      totalTokensUsed: 0,
    };
  }

  /** 构建消息列表 */
  private buildMessages(history: SessionData): ChatMessage[] {
    const messages: ChatMessage[] = [];

    // 构建系统提示
    const systemContent = buildSystemPrompt({
      basePrompt: this.options.systemPrompt,
      workingDirectory: this.options.workingDirectory,
      includeEnvironment: true,
      includeDateTime: true,
      includeToolRules: !this.options.enableFunctionCalling, // 使用原生 FC 时不需要文本规则
      tools: this.options.enableFunctionCalling ? undefined : this.tools,
      additionalContext: history.summary,
      skillsPrompt: this.skillsRegistry?.buildPrompt(),
      enableMemory: !!this.options.memoryManager,
    });

    messages.push({ role: "system", content: systemContent });

    // 验证并清理历史消息，确保 tool_calls 和 tool 消息配对
    const validatedMessages = this.validateToolCallPairs(history.messages);

    // 添加历史消息
    messages.push(...validatedMessages);

    return messages;
  }

  /** 验证 tool_calls 和 tool 消息配对，清理不完整的工具调用 */
  private validateToolCallPairs(messages: ChatMessage[]): ChatMessage[] {
    // 第一遍：处理 assistant+tool 配对，记录哪些 tool_call_id 被完整保留
    const preservedToolCallIds = new Set<string>();
    const firstPassResult: ChatMessage[] = [];
    let i = 0;

    while (i < messages.length) {
      const msg = messages[i]!;

      // 跳过 tool 消息（第二遍处理）
      if (msg.role === "tool") {
        firstPassResult.push(msg);
        i++;
        continue;
      }

      // 如果是包含 tool_calls 的 assistant 消息
      if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        const toolCallIds = new Set(msg.tool_calls.map(tc => tc.id));
        const toolResults: ChatMessage[] = [];

        // 查找后续的 tool 消息
        let j = i + 1;
        while (j < messages.length && messages[j]?.role === "tool") {
          const toolMsg = messages[j]!;
          if (toolMsg.tool_call_id && toolCallIds.has(toolMsg.tool_call_id)) {
            toolResults.push(toolMsg);
            toolCallIds.delete(toolMsg.tool_call_id);
          }
          j++;
        }

        // 检查是否所有 tool_calls 都有对应的 tool 结果
        if (toolCallIds.size === 0) {
          // 完整配对，添加 assistant 和所有 tool 消息
          firstPassResult.push(msg);
          firstPassResult.push(...toolResults);
          // 标记这些 tool_call_id 为已保留
          for (const tc of msg.tool_calls) {
            preservedToolCallIds.add(tc.id);
          }
        } else {
          // 不完整的工具调用，跳过整个 assistant 消息和相关 tool 消息
          logger.warn(
            { missingToolResults: Array.from(toolCallIds), messageIndex: i },
            "Skipping incomplete tool call sequence"
          );
          // 如果 assistant 消息有文本内容，保留文本内容但移除 tool_calls
          if (msg.content) {
            firstPassResult.push({
              role: "assistant",
              content: msg.content,
            });
          }
        }

        // 跳到 tool 消息之后
        i = j;
      } else {
        // 普通消息直接添加
        firstPassResult.push(msg);
        i++;
      }
    }

    // 第二遍：过滤掉孤立的 tool_result（对应的 assistant tool_calls 未被完整保留）
    const result: ChatMessage[] = [];
    for (const msg of firstPassResult) {
      if (msg.role === "tool") {
        if (msg.tool_call_id && preservedToolCallIds.has(msg.tool_call_id)) {
          result.push(msg);
        } else {
          logger.warn(
            { orphanToolCallId: msg.tool_call_id },
            "Skipping orphan tool_result message"
          );
        }
      } else {
        result.push(msg);
      }
    }

    return result;
  }

  /** 裁剪历史消息 */
  private trimHistory(history: SessionData): void {
    // 按轮次限制
    history.messages = limitHistoryTurns({
      messages: history.messages,
      maxTurns: this.options.maxHistoryTurns,
      preserveSystemMessage: false, // 系统消息在 buildMessages 中单独处理
    });

    // 按消息数限制
    if (history.messages.length > this.options.maxHistoryMessages) {
      history.messages = history.messages.slice(-this.options.maxHistoryMessages);
    }
  }

  /** 检查并执行上下文压缩 */
  private async maybeCompactHistory(history: SessionData): Promise<void> {
    const tokens = estimateMessagesTokens(history.messages);

    if (tokens <= this.options.compactionThreshold) {
      return;
    }

    logger.info({ tokens, threshold: this.options.compactionThreshold }, "Compacting history");

    try {
      // 分离要保留的最近消息和要压缩的旧消息
      const keepRecent = Math.min(10, Math.floor(history.messages.length / 2));
      const toCompact = history.messages.slice(0, -keepRecent);
      const toKeep = history.messages.slice(-keepRecent);

      if (toCompact.length === 0) {
        return;
      }

      // 生成摘要
      const summary = await summarizeInStages(toCompact, {
        provider: this.options.provider,
        model: this.options.model,
        previousSummary: history.summary,
        maxChunkTokens: 4000,
        contextWindow: this.options.contextWindow,
      });

      // 更新历史
      history.summary = summary;
      history.messages = toKeep;

      logger.info(
        { compacted: toCompact.length, kept: toKeep.length, summaryLength: summary.length },
        "History compacted"
      );
    } catch (error) {
      logger.error({ error }, "Failed to compact history");
      // 压缩失败，回退到简单裁剪
      const pruned = pruneHistoryForContextShare({
        messages: history.messages,
        maxContextTokens: this.options.contextWindow,
        maxHistoryShare: 0.5,
      });
      history.messages = pruned.messages;
    }
  }

  /** 清除会话 */
  clearSession(context: InboundMessageContext): void {
    const sessionKey = this.getSessionKey(context);
    this.options.sessionStore.delete(sessionKey);
    logger.debug({ sessionKey }, "Session cleared");
  }

  /** 获取会话信息 */
  getSessionInfo(context: InboundMessageContext): {
    messageCount: number;
    estimatedTokens: number;
    hasSummary: boolean;
    lastUpdate: Date;
  } | null {
    const sessionKey = this.getSessionKey(context);
    const history = this.options.sessionStore.get(sessionKey);

    if (!history) return null;

    return {
      messageCount: history.messages.length,
      estimatedTokens: estimateMessagesTokens(history.messages),
      hasSummary: !!history.summary,
      lastUpdate: new Date(history.lastUpdate),
    };
  }

  /** 恢复会话历史（从 transcript 消息重建 Agent 上下文） */
  restoreSessionFromTranscript(
    sessionKey: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>
  ): void {
    // 检查是否已有会话（如果服务没有重启，可能还在内存中）
    const existing = this.options.sessionStore.get(sessionKey);
    if (existing && existing.messages.length > 0) {
      logger.debug({ sessionKey, messageCount: existing.messages.length }, "Session already exists, skipping restore");
      return;
    }

    // 将 transcript 消息转换为 ChatMessage 格式
    const chatMessages: ChatMessage[] = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // 保存到 sessionStore
    const sessionData: SessionData = {
      messages: chatMessages,
      lastUpdate: Date.now(),
      totalTokensUsed: 0,
    };
    this.options.sessionStore.set(sessionKey, sessionData);
    logger.debug({ sessionKey, messageCount: chatMessages.length }, "Session restored from transcript");
  }
}

/** 创建 Agent */
export async function createAgent(config: MoziConfig): Promise<Agent> {
  // 初始化 MemoryManager (如果启用)
  let memoryManager: MemoryManager | undefined;
  if (config.memory?.enabled !== false && config.memory) {
    memoryManager = createMemoryManager({
      enabled: config.memory.enabled ?? true,
      directory: config.memory.directory,
      embeddingProvider: config.memory.embeddingProvider,
      embeddingModel: config.memory.embeddingModel,
    });
    logger.info({ directory: config.memory.directory }, "Memory system initialized");
  }

  // 初始化 CronService
  const cronService = getCronService({
    enabled: true,
    executeJob: async (job) => {
      // 简单的系统消息执行
      logger.info({ jobId: job.id, jobName: job.name, payload: job.payload }, "Cron job executed");
      return { status: "ok" as const };
    },
    onEvent: (event) => {
      logger.debug({ event }, "Cron event");
    },
  });
  cronService.start();
  logger.info("Cron service initialized");

  const agent = new Agent({
    model: config.agent.defaultModel,
    provider: config.agent.defaultProvider,
    systemPrompt: config.agent.systemPrompt ?? "",
    temperature: config.agent.temperature,
    maxTokens: config.agent.maxTokens,
    workingDirectory: config.agent.workingDirectory ?? process.cwd(),
    enableFunctionCalling: config.agent.enableFunctionCalling ?? true,
    sessionStore: createSessionStore(config.sessions),
    memoryManager,
    cronService,
  });

  // 加载 Skills
  if (config.skills?.enabled !== false) {
    try {
      const registry = await initSkills(config.skills);
      agent.setSkillsRegistry(registry);
      const skillCount = registry.getAll().length;
      if (skillCount > 0) {
        logger.info({ skillCount }, "Skills loaded");
      }
    } catch (error) {
      logger.warn({ error }, "Failed to load skills");
    }
  }

  return agent;
}
