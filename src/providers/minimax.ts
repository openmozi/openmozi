/**
 * MiniMax 模型提供商
 * MiniMax 使用自己的 API 格式，也支持 Anthropic 兼容接口
 */

import { BaseProvider } from "./base.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
  ProviderConfig,
  ModelDefinition,
  ChatMessage,
} from "../types/index.js";

const MINIMAX_BASE_URL = "https://api.minimax.chat/v1";

/** MiniMax 模型定义 */
const MINIMAX_MODELS: ModelDefinition[] = [
  // MiniMax M2.1 系列 (最新旗舰)
  {
    id: "MiniMax-M2.1",
    name: "MiniMax M2.1",
    provider: "minimax",
    api: "minimax-v1",
    contextWindow: 1000000,
    maxTokens: 65536,
    supportsVision: false,
    supportsReasoning: true,
    cost: {
      input: 0.8,
      output: 8,
    },
  },
  {
    id: "MiniMax-M2.1-lightning",
    name: "MiniMax M2.1 Lightning (快速)",
    provider: "minimax",
    api: "minimax-v1",
    contextWindow: 1000000,
    maxTokens: 65536,
    supportsVision: false,
    supportsReasoning: true,
    cost: {
      input: 0.8,
      output: 8,
    },
  },
  // MiniMax M1 系列
  {
    id: "MiniMax-M1",
    name: "MiniMax M1",
    provider: "minimax",
    api: "minimax-v1",
    contextWindow: 1000000,
    maxTokens: 65536,
    supportsVision: false,
    supportsReasoning: true,
    cost: {
      input: 0.8,
      output: 8,
    },
  },
  {
    id: "MiniMax-Text-01",
    name: "MiniMax Text 01",
    provider: "minimax",
    api: "minimax-v1",
    contextWindow: 1000000,
    maxTokens: 65536,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 1,
      output: 8,
    },
  },
  {
    id: "MiniMax-VL-01",
    name: "MiniMax VL 01 (Vision)",
    provider: "minimax",
    api: "minimax-v1",
    contextWindow: 1000000,
    maxTokens: 65536,
    supportsVision: true,
    supportsReasoning: false,
    cost: {
      input: 2,
      output: 8,
    },
  },
  {
    id: "abab6.5s-chat",
    name: "ABAB 6.5s Chat",
    provider: "minimax",
    api: "minimax-v1",
    contextWindow: 245760,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 1,    // ¥1/百万 token
      output: 1,
    },
  },
  {
    id: "abab6.5g-chat",
    name: "ABAB 6.5g Chat",
    provider: "minimax",
    api: "minimax-v1",
    contextWindow: 8192,
    maxTokens: 4096,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 0.5,
      output: 0.5,
    },
  },
  {
    id: "abab6.5t-chat",
    name: "ABAB 6.5t Chat (Turbo)",
    provider: "minimax",
    api: "minimax-v1",
    contextWindow: 8192,
    maxTokens: 4096,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 0.5,
      output: 0.5,
    },
  },
  {
    id: "MiniMax-Text-01",
    name: "MiniMax Text 01",
    provider: "minimax",
    api: "minimax-v1",
    contextWindow: 1000000,
    maxTokens: 65536,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 1,
      output: 8,
    },
  },
  {
    id: "MiniMax-VL-01",
    name: "MiniMax VL 01 (Vision)",
    provider: "minimax",
    api: "minimax-v1",
    contextWindow: 1000000,
    maxTokens: 65536,
    supportsVision: true,
    supportsReasoning: false,
    cost: {
      input: 2,
      output: 8,
    },
  },
];

interface MiniMaxMessage {
  sender_type: "USER" | "BOT";
  sender_name?: string;
  text: string;
}

interface MiniMaxRequest {
  model: string;
  messages: MiniMaxMessage[];
  tokens_to_generate?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  reply_constraints?: {
    sender_type: string;
    sender_name: string;
  };
  bot_setting?: Array<{
    bot_name: string;
    content: string;
  }>;
}

interface MiniMaxResponse {
  id: string;
  created: number;
  model: string;
  reply: string;
  choices: Array<{
    messages: Array<{
      sender_type: string;
      sender_name: string;
      text: string;
    }>;
    finish_reason: string;
  }>;
  usage: {
    total_tokens: number;
  };
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
}

export class MiniMaxProvider extends BaseProvider {
  private groupId?: string;

  constructor(apiKey: string, groupId?: string, customBaseUrl?: string) {
    const config: ProviderConfig = {
      id: "minimax",
      name: "MiniMax",
      baseUrl: customBaseUrl || MINIMAX_BASE_URL,
      apiKey,
      api: "minimax-v1",
      models: MINIMAX_MODELS,
    };
    super(config);
    this.groupId = groupId;
    this.logger = this.logger.child({ provider: "minimax" });
  }

  protected override getHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  /** 转换消息格式 */
  private convertMessages(messages: ChatMessage[]): {
    botSettings: Array<{ bot_name: string; content: string }>;
    messages: MiniMaxMessage[];
  } {
    const botSettings: Array<{ bot_name: string; content: string }> = [];
    const miniMaxMessages: MiniMaxMessage[] = [];

    for (const msg of messages) {
      const text = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map(c => c.type === "text" ? c.text : "[图片]").join("")
          : "";

      if (msg.role === "system") {
        botSettings.push({
          bot_name: "MM助手",
          content: text,
        });
      } else {
        miniMaxMessages.push({
          sender_type: msg.role === "user" ? "USER" : "BOT",
          sender_name: msg.role === "user" ? "用户" : "MM助手",
          text,
        });
      }
    }

    return { botSettings, messages: miniMaxMessages };
  }

  /** 聊天完成 */
  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}/text/chatcompletion_v2`;
    const { botSettings, messages } = this.convertMessages(request.messages);

    const body: MiniMaxRequest = {
      model: request.model,
      messages,
      tokens_to_generate: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      top_p: request.topP ?? 0.9,
      stream: false,
      reply_constraints: {
        sender_type: "BOT",
        sender_name: "MM助手",
      },
    };

    if (botSettings.length > 0) {
      body.bot_setting = botSettings;
    }

    this.logger.debug({ url, model: request.model }, "Sending chat request");

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

      const data = (await response.json()) as MiniMaxResponse;

      if (data.base_resp?.status_code !== 0 && data.base_resp?.status_code !== undefined) {
        throw new Error(`MiniMax API Error: ${data.base_resp.status_msg}`);
      }

      return {
        id: data.id,
        model: data.model,
        content: data.reply || data.choices[0]?.messages[0]?.text || "",
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: data.usage.total_tokens,
        },
        finishReason: "stop",
      };
    } catch (error) {
      this.handleError(error, "chat");
    }
  }

  /** 流式聊天 */
  async *chatStream(request: ChatCompletionRequest): AsyncGenerator<StreamChunk, void, unknown> {
    const url = `${this.baseUrl}/text/chatcompletion_v2`;
    const { botSettings, messages } = this.convertMessages(request.messages);

    const body: MiniMaxRequest = {
      model: request.model,
      messages,
      tokens_to_generate: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      top_p: request.topP ?? 0.9,
      stream: true,
      reply_constraints: {
        sender_type: "BOT",
        sender_name: "MM助手",
      },
    };

    if (botSettings.length > 0) {
      body.bot_setting = botSettings;
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
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body is not readable");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;

          if (trimmed.startsWith("data: ")) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              const delta = json.choices?.[0]?.messages?.[0]?.text || json.reply || "";

              if (delta) {
                yield {
                  id: json.id || "",
                  delta,
                  finishReason: json.choices?.[0]?.finish_reason,
                };
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
    } catch (error) {
      this.handleError(error, "chatStream");
    }
  }
}

/** 创建 MiniMax 提供商 */
export function createMiniMaxProvider(apiKey: string, groupId?: string, baseUrl?: string): MiniMaxProvider {
  return new MiniMaxProvider(apiKey, groupId, baseUrl);
}
