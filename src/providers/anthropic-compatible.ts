/**
 * Anthropic 兼容提供商
 * 支持 Anthropic 原生 API 格式，可配置 API 地址、模型和 API Key
 */

import { BaseProvider } from "./base.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
  ProviderConfig,
  ModelDefinition,
  ChatMessage,
  MessageToolCall,
  OpenAIToolDefinition,
  ProviderId,
  ModelApi,
} from "../types/index.js";

/** Anthropic 消息格式 */
interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result";
  text?: string;
  source?: {
    type: "base64";
    media_type: string;
    data: string;
  };
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: { type: "auto" | "any" | "tool"; name?: string };
}

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use";
  stop_sequence?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicStreamEvent {
  type: string;
  message?: AnthropicResponse;
  index?: number;
  content_block?: AnthropicContentBlock;
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

/** 自定义 Anthropic 兼容提供商配置 */
export interface CustomAnthropicProviderConfig {
  /** 提供商 ID */
  id: string;
  /** 提供商名称 */
  name: string;
  /** API 基础 URL */
  baseUrl: string;
  /** API Key */
  apiKey: string;
  /** 可用模型列表 */
  models: Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    supportsVision?: boolean;
  }>;
  /** 自定义请求头 */
  headers?: Record<string, string>;
  /** Anthropic API 版本 */
  apiVersion?: string;
}

export class AnthropicCompatibleProvider extends BaseProvider {
  private customHeaders: Record<string, string>;
  private apiVersion: string;

  constructor(config: CustomAnthropicProviderConfig) {
    const models: ModelDefinition[] = config.models.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      provider: config.id as ProviderId,
      api: "anthropic" as ModelApi,
      contextWindow: m.contextWindow ?? 200000,
      maxTokens: m.maxTokens ?? 8192,
      supportsVision: m.supportsVision ?? false,
      supportsReasoning: false,
    }));

    const providerConfig: ProviderConfig = {
      id: config.id as ProviderId,
      name: config.name,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      api: "anthropic" as ModelApi,
      models,
    };

    super(providerConfig);
    this.customHeaders = config.headers ?? {};
    this.apiVersion = config.apiVersion ?? "2023-06-01";
    this.logger = this.logger.child({ provider: config.id });
  }

  protected override getHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey ?? "",
      "anthropic-version": this.apiVersion,
      ...this.customHeaders,
    };
  }

  /** 安全解析工具参数（处理拼接 JSON 的情况） */
  private safeParseArguments(argsStr: string | undefined): Record<string, unknown> {
    if (!argsStr || argsStr.trim() === "" || argsStr.trim() === "{}") {
      return {};
    }
    try {
      return JSON.parse(argsStr) as Record<string, unknown>;
    } catch {
      // 尝试提取第一个完整的 JSON 对象（括号匹配）
      let depth = 0;
      for (let i = 0; i < argsStr.length; i++) {
        if (argsStr[i] === "{") depth++;
        else if (argsStr[i] === "}") {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(argsStr.slice(0, i + 1)) as Record<string, unknown>;
            } catch {
              break;
            }
          }
        }
      }
      return {};
    }
  }

  /** 转换消息格式 */
  private convertMessages(messages: ChatMessage[]): {
    system?: string;
    messages: AnthropicMessage[];
  } {
    let system: string | undefined;
    const anthropicMessages: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        // 系统消息单独处理
        system = typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.filter((p) => p.type === "text").map((p) => p.text).join("\n")
            : "";
        continue;
      }

      if (msg.role === "tool") {
        // 工具结果消息转换为 tool_result
        const toolResult: AnthropicContentBlock = {
          type: "tool_result",
          tool_use_id: msg.tool_call_id!,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        };
        anthropicMessages.push({
          role: "user",
          content: [toolResult],
        });
        continue;
      }

      const role = msg.role === "assistant" ? "assistant" : "user";
      let content: string | AnthropicContentBlock[];

      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content.map((part) => {
          if (part.type === "text") {
            return { type: "text" as const, text: part.text };
          } else if (part.type === "image") {
            return {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: part.mediaType ?? "image/jpeg",
                data: part.base64!,
              },
            };
          }
          return { type: "text" as const, text: "" };
        });
      } else {
        content = "";
      }

      // 如果是 assistant 消息且有 tool_calls，添加 tool_use 块
      if (msg.role === "assistant" && msg.tool_calls) {
        const blocks: AnthropicContentBlock[] = [];
        if (typeof content === "string" && content) {
          blocks.push({ type: "text", text: content });
        } else if (Array.isArray(content)) {
          blocks.push(...content);
        }

        for (const tc of msg.tool_calls) {
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input: this.safeParseArguments(tc.function.arguments),
          });
        }

        anthropicMessages.push({ role: "assistant", content: blocks });
      } else {
        anthropicMessages.push({ role, content });
      }
    }

    return { system, messages: anthropicMessages };
  }

  /** 转换工具定义 */
  private convertTools(tools?: OpenAIToolDefinition[]): AnthropicTool[] | undefined {
    if (!tools || tools.length === 0) return undefined;

    return tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description ?? "",
      input_schema: tool.function.parameters as AnthropicTool["input_schema"],
    }));
  }

  /** 聊天完成 */
  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}/messages`;
    const { system, messages } = this.convertMessages(request.messages);

    const body: AnthropicRequest = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature,
      top_p: request.topP,
      stream: false,
    };

    if (system) {
      body.system = system;
    }

    const tools = this.convertTools(request.tools);
    if (tools) {
      body.tools = tools;
      if (request.tool_choice === "auto") {
        body.tool_choice = { type: "auto" };
      } else if (request.tool_choice === "none") {
        // Anthropic 不支持 none，不设置 tool_choice
      } else if (typeof request.tool_choice === "object") {
        body.tool_choice = { type: "tool", name: request.tool_choice.function.name };
      }
    }

    this.logger.debug({ url, model: request.model, hasTools: !!tools }, "Sending chat request");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as AnthropicResponse;

      // 提取文本内容
      let textContent = "";
      const toolCalls: MessageToolCall[] = [];

      for (const block of data.content) {
        if (block.type === "text") {
          textContent += block.text ?? "";
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id!,
            type: "function",
            function: {
              name: block.name!,
              arguments: JSON.stringify(block.input ?? {}),
            },
          });
        }
      }

      return {
        id: data.id,
        model: data.model,
        content: textContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: data.usage.input_tokens + data.usage.output_tokens,
        },
        finishReason: data.stop_reason === "tool_use" ? "tool_calls" : "stop",
      };
    } catch (error) {
      this.handleError(error, "chat");
    }
  }

  /** 流式聊天 */
  async *chatStream(request: ChatCompletionRequest): AsyncGenerator<StreamChunk, void, unknown> {
    const url = `${this.baseUrl}/messages`;
    const { system, messages } = this.convertMessages(request.messages);

    const body: AnthropicRequest = {
      model: request.model,
      messages,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature,
      top_p: request.topP,
      stream: true,
    };

    if (system) {
      body.system = system;
    }

    const tools = this.convertTools(request.tools);
    if (tools) {
      body.tools = tools;
      if (request.tool_choice === "auto") {
        body.tool_choice = { type: "auto" };
      }
    }

    this.logger.debug({ url, model: request.model }, "Sending stream chat request");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error({ httpStatus: response.status, errorText: errorText.slice(0, 500) }, "Anthropic HTTP error");
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is not readable");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let currentId = "";
      // 使用 tool_use id 作为 key，而非 index (更可靠)
      const toolCallsInProgress: Map<string, { id: string; name: string; arguments: string; index: number }> = new Map();
      let currentToolCallId = "";  // 跟踪当前正在处理的 tool call
      // 跟踪 usage 统计
      let inputTokens = 0;
      let outputTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          try {
            const event = JSON.parse(trimmed.slice(6)) as AnthropicStreamEvent;

            if (event.type === "message_start" && event.message) {
              currentId = event.message.id;
              // 记录初始 input tokens
              if (event.message.usage) {
                inputTokens = event.message.usage.input_tokens;
              }
            } else if (event.type === "message_delta" && event.usage) {
              // Anthropic 在 message_delta 中发送最终 output_tokens
              outputTokens = event.usage.output_tokens ?? 0;
            } else if (event.type === "content_block_start" && event.content_block) {
              // 重置当前工具调用 ID（每次新 content block 开始时）
              currentToolCallId = "";

              if (event.content_block.type === "tool_use") {
                const toolId = event.content_block.id!;
                currentToolCallId = toolId;
                toolCallsInProgress.set(toolId, {
                  id: toolId,
                  name: event.content_block.name!,
                  arguments: "",
                  index: event.index ?? toolCallsInProgress.size,
                });
              }
            } else if (event.type === "content_block_delta" && event.delta) {
              if (event.delta.type === "text_delta" && event.delta.text) {
                yield {
                  id: currentId,
                  delta: event.delta.text,
                };
              } else if (event.delta.type === "input_json_delta") {
                // Handle tool call argument deltas (even empty ones for tools with no params)
                const tc = toolCallsInProgress.get(currentToolCallId);
                if (tc) {
                  if (event.delta.partial_json) {
                    tc.arguments += event.delta.partial_json;
                  }

                  yield {
                    id: currentId,
                    delta: "",
                    toolCallDeltas: [{
                      index: tc.index,
                      id: tc.id,
                      type: "function",
                      function: {
                        name: tc.name,
                        arguments: event.delta.partial_json ?? "",
                      },
                    }],
                  };
                }
              }
            } else if (event.type === "content_block_stop") {
              // content block 结束，重置 currentToolCallId
              currentToolCallId = "";
            } else if (event.type === "message_stop") {
              yield {
                id: currentId,
                delta: "",
                finishReason: toolCallsInProgress.size > 0 ? "tool_calls" : "stop",
                usage: inputTokens > 0 || outputTokens > 0 ? {
                  promptTokens: inputTokens,
                  completionTokens: outputTokens,
                  totalTokens: inputTokens + outputTokens,
                } : undefined,
              };
            }
          } catch (parseErr) {
            // 记录解析错误
            this.logger.warn({ line: trimmed.slice(0, 200), error: parseErr }, "Failed to parse Anthropic SSE line");
          }
        }
      }
    } catch (error) {
      this.handleError(error, "chatStream");
    }
  }
}

/** 创建自定义 Anthropic 兼容提供商 */
export function createAnthropicCompatibleProvider(
  config: CustomAnthropicProviderConfig
): AnthropicCompatibleProvider {
  return new AnthropicCompatibleProvider(config);
}
