/**
 * OpenAI 兼容提供商基类
 * 用于 DeepSeek, Kimi, Stepfun 等使用 OpenAI 兼容接口的提供商
 * 支持原生 function calling (tools 参数)
 */

import { BaseProvider } from "./base.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
  ChatMessage,
  MessageToolCall,
  OpenAIToolDefinition,
} from "../types/index.js";

interface OpenAIMessage {
  role: string;
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  stop?: string[];
  tools?: OpenAIToolDefinition[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
}

interface OpenAIResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  id: string;
  choices: Array<{
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
}

interface OpenAIEmbeddingRequest {
  model: string;
  input: string | string[];
  encoding_format?: "float" | "base64";
}

interface OpenAIEmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export abstract class OpenAICompatibleProvider extends BaseProvider {
  /** 转换消息格式 */
  protected convertMessages(messages: ChatMessage[]): OpenAIMessage[] {
    return messages.map((msg) => {
      const base: OpenAIMessage = {
        role: msg.role,
        content: null,
      };

      // 处理内容
      if (typeof msg.content === "string") {
        base.content = msg.content;
      } else if (Array.isArray(msg.content)) {
        base.content = msg.content.map((part) => {
          if (part.type === "text") {
            return { type: "text", text: part.text };
          } else if (part.type === "image") {
            const url = part.url || `data:${part.mediaType || "image/jpeg"};base64,${part.base64}`;
            return { type: "image_url", image_url: { url } };
          }
          return { type: "text", text: "" };
        });
      }

      // assistant 消息的 tool_calls
      if (msg.tool_calls) {
        base.tool_calls = msg.tool_calls;
        // 部分 API (如 Anthropic) 要求所有非最终 assistant 消息必须有非空 content
        if (base.content === null || base.content === "") {
          base.content = "\u200b"; // zero-width space 作为占位符
        }
      }

      // tool 消息的 tool_call_id
      if (msg.tool_call_id) {
        base.tool_call_id = msg.tool_call_id;
        // 确保 tool 消息的 content 非空
        if (base.content === null || base.content === "") {
          base.content = "{}";
        }
      }

      // tool 消息的 name
      if (msg.name) {
        base.name = msg.name;
      }

      // 确保所有消息的 content 非空 (部分 API 如 Anthropic 要求)
      if (base.content === null || base.content === "") {
        base.content = " "; // 空格作为占位符
      }

      return base;
    });
  }

  /** 构建请求体 */
  protected buildRequest(request: ChatCompletionRequest): OpenAIRequest {
    const body: OpenAIRequest = {
      model: request.model,
      messages: this.convertMessages(request.messages),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      stream: request.stream ?? false,
      top_p: request.topP,
      stop: request.stop,
    };

    // 添加工具定义
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
      body.tool_choice = request.tool_choice ?? "auto";
    }

    return body;
  }

  /** 聊天完成 */
  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    const body = this.buildRequest(request);

    this.logger.debug({ url, model: request.model, hasTools: !!request.tools }, "Sending chat request");

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

      const data = (await response.json()) as OpenAIResponse;
      const choice = data.choices[0];

      // 解析 tool_calls
      let toolCalls: MessageToolCall[] | undefined;
      if (choice?.message.tool_calls && choice.message.tool_calls.length > 0) {
        toolCalls = choice.message.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      }

      return {
        id: data.id,
        model: data.model,
        content: choice?.message.content ?? "",
        toolCalls,
        usage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        },
        finishReason: this.mapFinishReason(choice?.finish_reason),
      };
    } catch (error) {
      this.handleError(error, "chat");
    }
  }

  /** 流式聊天 (支持 tool_calls 流式) */
  async *chatStream(request: ChatCompletionRequest): AsyncGenerator<StreamChunk, void, unknown> {
    const url = `${this.baseUrl}/chat/completions`;
    const body = this.buildRequest({ ...request, stream: true });

    this.logger.debug({ url, model: request.model, hasTools: !!request.tools }, "Sending stream chat request");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error({ httpStatus: response.status, errorText: errorText.slice(0, 500) }, "HTTP error response");
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is not readable");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let currentId = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Flush remaining buffer - 处理未以换行结尾的剩余数据
          if (buffer.trim()) {
            const remainingLines = buffer.split("\n");
            for (const line of remainingLines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed === "data: [DONE]") continue;
              if (trimmed.startsWith("data: ")) {
                try {
                  const json = JSON.parse(trimmed.slice(6)) as OpenAIStreamChunk;

                  if ((json as unknown as { error?: { message?: string } }).error) {
                    const errorObj = json as unknown as { error: { message: string; type?: string } };
                    this.logger.error({ error: errorObj.error }, "API returned error in stream (buffer flush)");
                    throw new Error(errorObj.error.message || "Unknown API error");
                  }

                  currentId = json.id;
                  const choice = json.choices[0];
                  const delta = choice?.delta?.content ?? "";
                  const finishReason = choice?.finish_reason;
                  const toolCallDeltas = choice?.delta?.tool_calls;

                  if (delta || finishReason || toolCallDeltas) {
                    yield {
                      id: currentId,
                      delta,
                      finishReason: finishReason ?? undefined,
                      toolCallDeltas: toolCallDeltas?.map((tc) => ({
                        index: tc.index,
                        id: tc.id,
                        type: tc.type,
                        function: tc.function,
                      })),
                    };
                  }
                } catch (parseError) {
                  this.logger.warn({ line: trimmed.slice(0, 200), error: parseError }, "Failed to parse SSE line (buffer flush)");
                }
              }
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;

          if (trimmed.startsWith("data: ")) {
            try {
              const json = JSON.parse(trimmed.slice(6)) as OpenAIStreamChunk;

              // Check for error in response
              if ((json as unknown as { error?: { message?: string } }).error) {
                const errorObj = json as unknown as { error: { message: string; type?: string } };
                this.logger.error({ error: errorObj.error }, "API returned error in stream");
                throw new Error(errorObj.error.message || "Unknown API error");
              }

              currentId = json.id;
              const choice = json.choices[0];
              const delta = choice?.delta?.content ?? "";
              const finishReason = choice?.finish_reason;
              const toolCallDeltas = choice?.delta?.tool_calls;

              if (delta || finishReason || toolCallDeltas) {
                yield {
                  id: currentId,
                  delta,
                  finishReason: finishReason ?? undefined,
                  toolCallDeltas: toolCallDeltas?.map((tc) => ({
                    index: tc.index,
                    id: tc.id,
                    type: tc.type,
                    function: tc.function,
                  })),
                };
              }
            } catch (parseError) {
              // 记录解析错误以便调试
              this.logger.warn({ line: trimmed.slice(0, 200), error: parseError }, "Failed to parse SSE line");
            }
          }
        }
      }
    } catch (error) {
      this.handleError(error, "chatStream");
    }
  }

  /** 映射完成原因 */
  private mapFinishReason(reason?: string): ChatCompletionResponse["finishReason"] {
    switch (reason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "content_filter":
        return "content_filter";
      case "tool_calls":
      case "function_call":
        return "tool_calls";
      default:
        return "stop";
    }
  }

  /** 是否支持 embedding */
  override supportsEmbedding(): boolean {
    return true;
  }

  /** 文本向量化 */
  override async embed(texts: string[], model?: string): Promise<number[][]> {
    const url = `${this.baseUrl}/embeddings`;
    const embeddingModel = model ?? this.getDefaultEmbeddingModel();

    this.logger.debug({ url, model: embeddingModel, count: texts.length }, "Sending embedding request");

    try {
      const body: OpenAIEmbeddingRequest = {
        model: embeddingModel,
        input: texts,
        encoding_format: "float",
      };

      const response = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as OpenAIEmbeddingResponse;

      // 按 index 排序确保顺序正确
      const sorted = data.data.sort((a, b) => a.index - b.index);
      return sorted.map((item) => item.embedding);
    } catch (error) {
      this.handleError(error, "embed");
    }
  }

  /** 获取默认 embedding 模型 */
  protected getDefaultEmbeddingModel(): string {
    return "text-embedding-3-small";
  }
}
