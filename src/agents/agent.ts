/**
 * Agent - 消息处理核心
 * 使用 pi-agent-core 作为内部引擎
 */

import type {
  ChatMessage,
  InboundMessageContext,
  MoziConfig,
  ProviderId,
  MessageToolCall,
} from "../types/index.js";
import type { Message, UserMessage, AssistantMessage, ToolResultMessage } from "@mariozechner/pi-ai";
import { Agent as PiAgent, type AgentEvent, type AgentTool } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import { resolveModel, getApiKeyForProvider } from "../providers/model-resolver.js";
import { getChildLogger } from "../utils/logger.js";
import {
  type Tool,
  type ToolCallResult,
  registerTools,
  getAllTools,
  filterToolsByPolicy,
  createBuiltinTools,
} from "../tools/index.js";
import { toAgentTools } from "../tools/agent-tool-adapter.js";
import {
  estimateMessageTokens,
  estimateMessagesTokens,
  summarizeInStages,
  limitHistoryTurns,
  pruneHistoryForContextShare,
} from "./compaction.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { createSessionStore, type SessionStore, type SessionData } from "./session-store.js";
import { initSkills, type SkillsRegistry } from "../skills/index.js";
import type { SkillsConfig } from "../skills/types.js";
import { createMemoryManager, type MemoryManager } from "../memory/index.js";
import { CronService, getCronService } from "../cron/service.js";
import { createDefaultCronExecuteJob } from "../cron/executor.js";

const logger = getChildLogger("agent");

// ============== Agent 配置 ==============

/** Agent 配置 */
export interface AgentOptions {
  model: string;
  provider?: ProviderId;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  maxHistoryMessages?: number;
  maxHistoryTurns?: number;
  contextWindow?: number;
  enableTools?: boolean;
  toolPolicy?: { allow?: string[]; deny?: string[] };
  enableCompaction?: boolean;
  compactionThreshold?: number;
  maxToolRounds?: number;
  workingDirectory?: string;
  enableFunctionCalling?: boolean;
  sessionStore?: SessionStore;
  memoryManager?: MemoryManager;
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
}

// ============== 消息转换 ==============

/** 将 mozi ChatMessage[] 转为 pi-ai Message[] */
function moziToPiMessages(messages: ChatMessage[]): Message[] {
  const result: Message[] = [];
  const now = Date.now();

  for (const msg of messages) {
    if (msg.role === "system") continue;

    if (msg.role === "user") {
      const content = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((c) => {
              if (c.type === "text") return { type: "text" as const, text: c.text };
              if (c.type === "image") {
                if (c.base64) return { type: "image" as const, data: c.base64, mimeType: c.mediaType ?? "image/png" };
                if (c.url) return { type: "text" as const, text: `[image: ${c.url}]` };
              }
              return { type: "text" as const, text: "" };
            })
          : "";

      result.push({
        role: "user",
        content,
        timestamp: now,
      } as UserMessage);
    } else if (msg.role === "assistant") {
      const contentParts: AssistantMessage["content"] = [];

      const textContent = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("")
          : "";

      if (textContent) {
        contentParts.push({ type: "text", text: textContent });
      }

      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          try {
            const argsStr = tc.function.arguments;
            if (argsStr && typeof argsStr === "string") {
              args = JSON.parse(argsStr);
            }
          } catch { /* empty */ }
          contentParts.push({
            type: "toolCall",
            id: tc.id,
            name: tc.function.name,
            arguments: args,
          });
        }
      }

      if (contentParts.length === 0) {
        contentParts.push({ type: "text", text: "" });
      }

      result.push({
        role: "assistant",
        content: contentParts,
        api: "openai-completions",
        provider: "unknown",
        model: "unknown",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: now,
      } as AssistantMessage);
    } else if (msg.role === "tool") {
      const content = typeof msg.content === "string" ? msg.content : "";
      const isError = content.startsWith("Error:");

      result.push({
        role: "toolResult",
        toolCallId: msg.tool_call_id ?? "",
        toolName: msg.name ?? "",
        content: [{ type: "text", text: content }],
        isError,
        timestamp: now,
      } as ToolResultMessage);
    }
  }

  return result;
}

/** 将 pi-ai Message[] 转为 mozi ChatMessage[] */
function piToMoziMessages(messages: Message[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const userMsg = msg as UserMessage;
      const content = typeof userMsg.content === "string"
        ? userMsg.content
        : Array.isArray(userMsg.content)
          ? userMsg.content.map((c) => {
              if (c.type === "text") return { type: "text" as const, text: c.text };
              if (c.type === "image") return { type: "image" as const, base64: c.data, mediaType: c.mimeType };
              return { type: "text" as const, text: "" };
            })
          : "";
      result.push({ role: "user", content });
    } else if (msg.role === "assistant") {
      const assistantMsg = msg as AssistantMessage;
      let textContent = "";
      const toolCalls: MessageToolCall[] = [];

      for (const part of assistantMsg.content) {
        if (part.type === "text") {
          textContent += part.text;
        } else if (part.type === "toolCall") {
          const args = part.arguments ?? {};
          toolCalls.push({
            id: part.id,
            type: "function",
            function: {
              name: part.name,
              arguments: JSON.stringify(args),
            },
          });
        }
      }

      const chatMsg: ChatMessage = { role: "assistant", content: textContent || null };
      if (toolCalls.length > 0) chatMsg.tool_calls = toolCalls;
      result.push(chatMsg);
    } else if (msg.role === "toolResult") {
      const toolResult = msg as ToolResultMessage;
      const content = toolResult.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      result.push({
        role: "tool",
        content: toolResult.isError ? `Error: ${content}` : content,
        tool_call_id: toolResult.toolCallId,
        name: toolResult.toolName,
      });
    }
  }

  return result;
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
  private agentTools: AgentTool[] = [];
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
      maxToolRounds: options.maxToolRounds ?? 10,
      workingDirectory: options.workingDirectory ?? process.cwd(),
      enableFunctionCalling: options.enableFunctionCalling ?? true,
      sessionStore: options.sessionStore ?? createSessionStore(),
      memoryManager: options.memoryManager,
      cronService: options.cronService,
    };

    if (this.options.enableTools) {
      this.initializeTools();
    }
  }

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
    this.agentTools = toAgentTools(this.tools);
    logger.info({ toolCount: this.tools.length }, "Tools initialized");
  }

  setSkillsRegistry(registry: SkillsRegistry): void {
    this.skillsRegistry = registry;
  }

  registerTool(tool: Tool): void {
    registerTools([tool]);
    this.tools = filterToolsByPolicy(getAllTools(), this.options.toolPolicy);
    this.agentTools = toAgentTools(this.tools);
  }

  private buildSystemPromptText(history: SessionData): string {
    return buildSystemPrompt({
      basePrompt: this.options.systemPrompt,
      workingDirectory: this.options.workingDirectory,
      includeEnvironment: true,
      includeDateTime: true,
      includeToolRules: false,
      additionalContext: history.summary,
      skillsPrompt: this.skillsRegistry?.buildPrompt(),
      enableMemory: !!this.options.memoryManager,
    });
  }

  /** 创建配置好的 pi-agent-core Agent 实例 */
  private createPiAgent(history: SessionData): PiAgent {
    const model = resolveModel(this.options.provider, this.options.model);
    if (!model) {
      throw new Error(`Cannot resolve model: ${this.options.provider}/${this.options.model}`);
    }

    const contextWindow = model.contextWindow ?? this.options.contextWindow;

    const piAgent = new PiAgent({
      streamFn: ((m: any, ctx: any, opts: any) => {
        return streamSimple(m, ctx, {
          ...opts,
          apiKey: getApiKeyForProvider(this.options.provider),
          temperature: this.options.temperature,
          maxTokens: this.options.maxTokens,
        });
      }) as any,
      // 安全防线：在发给 LLM 前裁剪超大上下文
      transformContext: async (messages) => {
        // 粗略估算 token 数（每条消息的文本内容）
        let totalEstimate = 0;
        for (const msg of messages) {
          if (msg.role === "user" && typeof msg.content === "string") {
            totalEstimate += msg.content.length / 3;
          } else if (msg.role === "assistant") {
            for (const part of (msg as any).content ?? []) {
              if (part.type === "text") totalEstimate += (part.text?.length ?? 0) / 3;
            }
          } else if (msg.role === "toolResult") {
            for (const part of (msg as any).content ?? []) {
              if (part.type === "text") totalEstimate += (part.text?.length ?? 0) / 3;
            }
          }
        }

        // 如果估算 token 数超过上下文窗口的 80%，从前面丢弃消息
        const limit = contextWindow * 0.8;
        if (totalEstimate > limit && messages.length > 2) {
          logger.warn({ totalEstimate: Math.round(totalEstimate), limit: Math.round(limit), messageCount: messages.length }, "transformContext: trimming oversized context");
          // 保留最后 N 条直到 token 数低于限制
          let kept = 0;
          let keptTokens = 0;
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i]!;
            let msgTokens = 0;
            if (msg.role === "user" && typeof msg.content === "string") {
              msgTokens = msg.content.length / 3;
            } else if (msg.role === "assistant" || msg.role === "toolResult") {
              for (const part of (msg as any).content ?? []) {
                if (part.type === "text") msgTokens += (part.text?.length ?? 0) / 3;
              }
            }
            if (keptTokens + msgTokens > limit && kept >= 2) break;
            keptTokens += msgTokens;
            kept++;
          }
          return messages.slice(-kept);
        }

        return messages;
      },
    });

    piAgent.setModel(model);
    piAgent.setSystemPrompt(this.buildSystemPromptText(history));
    if (this.options.enableFunctionCalling) {
      piAgent.setTools(this.agentTools);
    }

    // Load history messages
    const piMessages = moziToPiMessages(history.messages);
    if (piMessages.length > 0) {
      piAgent.replaceMessages(piMessages);
    }

    return piAgent;
  }

  /** 处理消息 (非流式) */
  async processMessage(context: InboundMessageContext): Promise<AgentResponse> {
    const sessionKey = this.getSessionKey(context);
    logger.debug({ sessionKey, content: context.content.slice(0, 100) }, "Processing message");

    const history = this.getSessionHistory(sessionKey);
    history.messages.push({ role: "user", content: context.content });

    if (this.options.enableCompaction) {
      await this.maybeCompactHistory(history);
    }

    const piAgent = this.createPiAgent(history);

    let fullContent = "";
    let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const allToolCalls: ToolCallResult[] = [];

    piAgent.subscribe((event: AgentEvent) => {
      if (event.type === "tool_execution_end") {
        allToolCalls.push({
          toolCallId: event.toolCallId,
          name: event.toolName,
          result: {
            content: event.result?.content ?? [{ type: "text", text: "" }],
            isError: event.isError,
          },
          isError: event.isError,
          durationMs: 0,
        });
      }
    });

    await piAgent.prompt(context.content);
    await piAgent.waitForIdle();

    // Get results from state
    const agentMessages = piAgent.state.messages;
    const lastAssistant = [...agentMessages].reverse().find((m) => m.role === "assistant") as AssistantMessage | undefined;

    if (lastAssistant) {
      fullContent = lastAssistant.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("");

      if (lastAssistant.usage) {
        totalUsage = {
          promptTokens: lastAssistant.usage.input,
          completionTokens: lastAssistant.usage.output,
          totalTokens: lastAssistant.usage.totalTokens,
        };
      }
    }

    // Save messages back to session
    const newMoziMessages = piToMoziMessages(agentMessages);
    history.messages = newMoziMessages;
    history.lastUpdate = Date.now();
    history.totalTokensUsed += totalUsage.totalTokens;
    this.trimHistory(history);
    this.options.sessionStore.set(sessionKey, history);

    logger.debug({ sessionKey, usage: totalUsage }, "Message processed");

    return {
      content: fullContent,
      toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      usage: totalUsage,
      provider: this.options.provider,
      model: this.options.model,
    };
  }

  /** 流式处理消息 */
  async *processMessageStream(
    context: InboundMessageContext,
    options?: { signal?: AbortSignal }
  ): AsyncGenerator<string, AgentResponse, unknown> {
    const signal = options?.signal;
    const sessionKey = this.getSessionKey(context);
    logger.debug({ sessionKey, content: context.content.slice(0, 100) }, "Processing message (stream)");

    const history = this.getSessionHistory(sessionKey);
    history.messages.push({ role: "user", content: context.content });

    if (this.options.enableCompaction) {
      await this.maybeCompactHistory(history);
    }

    const piAgent = this.createPiAgent(history);

    let fullContent = "";
    let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const allToolCalls: ToolCallResult[] = [];

    // Event queue for bridging subscribe and async generator
    const eventQueue: Array<{ type: string; data: string }> = [];
    let resolveWait: (() => void) | null = null;
    let done = false;
    let promptError: Error | null = null;

    piAgent.subscribe((event: AgentEvent) => {
      if (event.type === "message_update") {
        const updateEvent = event as { type: "message_update"; assistantMessageEvent: { type: string; delta?: string } };
        if (updateEvent.assistantMessageEvent?.type === "text_delta" && updateEvent.assistantMessageEvent.delta) {
          eventQueue.push({ type: "text_delta", data: updateEvent.assistantMessageEvent.delta });
        }
      } else if (event.type === "tool_execution_start") {
        const toolEvent = event as { type: "tool_execution_start"; toolName: string; args: Record<string, unknown> };
        const argsPreview = (() => {
          const args = toolEvent.args;
          if (!args) return "";
          const mainArg = args.path ?? args.directory ?? args.command ?? args.query ?? args.pattern;
          if (typeof mainArg === "string") {
            const preview = mainArg.replace(/\n/g, " ").trim();
            return preview.length > 40 ? preview.slice(0, 40) + "…" : preview;
          }
          return "";
        })();
        eventQueue.push({ type: "tool_start", data: `\n⏺ ${toolEvent.toolName}(${argsPreview})` });
      } else if (event.type === "tool_execution_end") {
        const toolEvent = event as { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean };
        eventQueue.push({ type: "tool_end", data: toolEvent.isError ? " ✗" : " ✓" });

        allToolCalls.push({
          toolCallId: toolEvent.toolCallId,
          name: toolEvent.toolName,
          result: {
            content: toolEvent.result?.content ?? [{ type: "text", text: "" }],
            isError: toolEvent.isError,
          },
          isError: toolEvent.isError,
          durationMs: 0,
        });
      } else if (event.type === "agent_end") {
        done = true;
      }

      if (resolveWait) {
        resolveWait();
        resolveWait = null;
      }
    });

    // Start prompt (fire and forget)
    const promptPromise = piAgent.prompt(context.content)
      .then(() => piAgent.waitForIdle())
      .catch((err: unknown) => {
        done = true;
        if (err instanceof Error && (err.name === "AbortError" || err.message === "Aborted")) {
          promptError = err;
        } else {
          logger.error({ err }, "Agent prompt failed");
          promptError = err instanceof Error ? err : new Error(String(err));
        }
        if (resolveWait) {
          resolveWait();
          resolveWait = null;
        }
      });

    // Yield events
    try {
      while (!done) {
        if (signal?.aborted) {
          piAgent.abort();
          throw new DOMException("Aborted", "AbortError");
        }

        while (eventQueue.length > 0) {
          const event = eventQueue.shift()!;
          if (event.type === "text_delta") {
            fullContent += event.data;
            yield event.data;
          } else {
            yield event.data;
          }
        }

        if (!done) {
          await new Promise<void>((resolve) => {
            resolveWait = resolve;
            setTimeout(resolve, 100);
          });
        }
      }

      // Drain remaining events
      while (eventQueue.length > 0) {
        const event = eventQueue.shift()!;
        if (event.type === "text_delta") {
          fullContent += event.data;
          yield event.data;
        } else {
          yield event.data;
        }
      }
    } catch (err) {
      if (err instanceof Error && (err.name === "AbortError" || err.message === "Aborted")) {
        throw err;
      }
      throw err;
    }

    await promptPromise;

    if (promptError) {
      if ((promptError as Error).name === "AbortError") {
        throw promptError;
      }
    }

    // Get usage from last assistant message
    const agentMessages = piAgent.state.messages;
    const lastAssistant = [...agentMessages].reverse().find((m) => m.role === "assistant") as AssistantMessage | undefined;
    if (lastAssistant?.usage) {
      totalUsage = {
        promptTokens: lastAssistant.usage.input,
        completionTokens: lastAssistant.usage.output,
        totalTokens: lastAssistant.usage.totalTokens,
      };
    }

    // Save messages back to session
    const newMoziMessages = piToMoziMessages(agentMessages);
    history.messages = newMoziMessages;
    history.lastUpdate = Date.now();
    history.totalTokensUsed += totalUsage.totalTokens;
    this.trimHistory(history);
    this.options.sessionStore.set(sessionKey, history);

    return {
      content: fullContent,
      toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      usage: totalUsage,
      provider: this.options.provider,
      model: this.options.model,
    };
  }

  private getSessionKey(context: InboundMessageContext): string {
    if (context.chatType === "group") {
      return `${context.channelId}:${context.chatId}`;
    }
    return `${context.channelId}:${context.senderId}`;
  }

  private getSessionHistory(sessionKey: string): SessionData {
    const cached = this.options.sessionStore.get(sessionKey);
    if (cached) return cached;
    return { messages: [], lastUpdate: Date.now(), totalTokensUsed: 0 };
  }

  private trimHistory(history: SessionData): void {
    history.messages = limitHistoryTurns({
      messages: history.messages,
      maxTurns: this.options.maxHistoryTurns,
      preserveSystemMessage: false,
    });
    if (history.messages.length > this.options.maxHistoryMessages) {
      history.messages = history.messages.slice(-this.options.maxHistoryMessages);
    }
  }

  /** 截断超大消息内容，保留前后部分 */
  private truncateOversizedMessages(messages: ChatMessage[], maxTokensPerMessage: number): ChatMessage[] {
    return messages.map((msg) => {
      const tokens = estimateMessageTokens(msg);
      if (tokens <= maxTokensPerMessage) return msg;

      // 只截断 tool result 和 assistant 消息中的超大内容
      if (msg.role === "tool" && typeof msg.content === "string") {
        const maxChars = maxTokensPerMessage * 3; // 粗略估算: ~3 chars/token
        const truncated = msg.content.slice(0, maxChars) + `\n\n...[truncated: original ~${Math.round(tokens / 1000)}K tokens]`;
        logger.debug({ role: msg.role, originalTokens: tokens, maxTokens: maxTokensPerMessage }, "Truncated oversized message");
        return { ...msg, content: truncated };
      }

      if (msg.role === "assistant" && typeof msg.content === "string" && msg.content) {
        const maxChars = maxTokensPerMessage * 3;
        const truncated = msg.content.slice(0, maxChars) + `\n\n...[truncated: original ~${Math.round(tokens / 1000)}K tokens]`;
        return { ...msg, content: truncated };
      }

      return msg;
    });
  }

  private async maybeCompactHistory(history: SessionData): Promise<void> {
    // 第一步：截断超大的单条消息（如浏览器返回的 HTML）
    const maxPerMessage = Math.floor(this.options.compactionThreshold * 0.3); // 单条消息最多占阈值的 30%
    history.messages = this.truncateOversizedMessages(history.messages, maxPerMessage);

    const tokens = estimateMessagesTokens(history.messages);
    if (tokens <= this.options.compactionThreshold) return;

    logger.info({ tokens, threshold: this.options.compactionThreshold }, "Compacting history");

    try {
      const keepRecent = Math.min(10, Math.floor(history.messages.length / 2));
      const toCompact = history.messages.slice(0, -keepRecent);
      let toKeep = history.messages.slice(-keepRecent);
      if (toCompact.length === 0) {
        // 所有消息都在"保留"部分但仍超阈值 → 强制裁剪
        const pruned = pruneHistoryForContextShare({
          messages: history.messages,
          maxContextTokens: this.options.compactionThreshold,
          maxHistoryShare: 0.8,
        });
        history.messages = pruned.messages;
        logger.info({ dropped: pruned.droppedMessages, kept: pruned.messages.length }, "Force-pruned oversized kept messages");
        return;
      }

      const summary = await summarizeInStages(toCompact, {
        provider: this.options.provider,
        model: this.options.model,
        previousSummary: history.summary,
        maxChunkTokens: 4000,
        contextWindow: this.options.contextWindow,
      });

      history.summary = summary;
      history.messages = toKeep;

      // 检查保留部分是否仍然超阈值
      const keptTokens = estimateMessagesTokens(toKeep);
      if (keptTokens > this.options.compactionThreshold) {
        toKeep = this.truncateOversizedMessages(toKeep, maxPerMessage);
        const pruned = pruneHistoryForContextShare({
          messages: toKeep,
          maxContextTokens: this.options.compactionThreshold,
          maxHistoryShare: 0.8,
        });
        history.messages = pruned.messages;
        logger.info({ keptTokens, dropped: pruned.droppedMessages }, "Post-compaction pruning applied");
      }

      logger.info({ compacted: toCompact.length, kept: history.messages.length, summaryLength: summary.length }, "History compacted");
    } catch (error) {
      logger.error({ error }, "Failed to compact history");
      const pruned = pruneHistoryForContextShare({
        messages: history.messages,
        maxContextTokens: this.options.contextWindow,
        maxHistoryShare: 0.5,
      });
      history.messages = pruned.messages;
    }
  }

  clearSession(context: InboundMessageContext): void {
    const sessionKey = this.getSessionKey(context);
    this.options.sessionStore.delete(sessionKey);
    logger.debug({ sessionKey }, "Session cleared");
  }

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

  restoreSessionFromTranscript(
    sessionKey: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>
  ): void {
    const existing = this.options.sessionStore.get(sessionKey);
    if (existing && existing.messages.length > 0) {
      logger.debug({ sessionKey, messageCount: existing.messages.length }, "Session already exists, skipping restore");
      return;
    }

    const chatMessages: ChatMessage[] = messages.map((msg) => ({ role: msg.role, content: msg.content }));
    const sessionData: SessionData = { messages: chatMessages, lastUpdate: Date.now(), totalTokensUsed: 0 };
    this.options.sessionStore.set(sessionKey, sessionData);
    logger.debug({ sessionKey, messageCount: chatMessages.length }, "Session restored from transcript");
  }
}

/** 创建 Agent */
export async function createAgent(config: MoziConfig): Promise<Agent> {
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

  let agent: Agent;

  const agentExecutor = async (params: {
    message: string;
    sessionKey?: string;
    model?: string;
    timeoutSeconds?: number;
  }) => {
    if (!agent) return { success: false, output: "", error: "Agent not initialized" };
    try {
      const response = await agent.processMessage({
        channelId: "webchat",
        chatId: params.sessionKey ?? `cron-${Date.now()}`,
        chatType: "direct",
        senderId: "cron-system",
        content: params.message,
        messageId: `cron-${Date.now()}`,
        timestamp: Date.now(),
      });
      return { success: true, output: response.content };
    } catch (err) {
      return { success: false, output: "", error: err instanceof Error ? err.message : String(err) };
    }
  };

  const cronExecuteJob = createDefaultCronExecuteJob({ agentExecutor });
  const cronService = getCronService({
    enabled: true,
    executeJob: cronExecuteJob,
    onEvent: (event) => { logger.debug({ event }, "Cron event"); },
  });
  cronService.start();
  logger.info("Cron service initialized");

  agent = new Agent({
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

  if (config.skills?.enabled !== false) {
    try {
      const registry = await initSkills(config.skills);
      agent.setSkillsRegistry(registry);
      const skillCount = registry.getAll().length;
      if (skillCount > 0) logger.info({ skillCount }, "Skills loaded");
    } catch (error) {
      logger.warn({ error }, "Failed to load skills");
    }
  }

  return agent;
}
