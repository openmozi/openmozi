/**
 * 模型提供商基类
 */

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
  ProviderConfig,
  ProviderId,
  ProviderError,
} from "../types/index.js";
import { getChildLogger } from "../utils/logger.js";

export abstract class BaseProvider {
  protected config: ProviderConfig;
  protected logger = getChildLogger("provider");

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  get id(): ProviderId {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  get apiKey(): string | undefined {
    return this.config.apiKey;
  }

  /** 获取请求头 */
  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  /** 聊天完成 */
  abstract chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;

  /** 流式聊天 */
  abstract chatStream(
    request: ChatCompletionRequest
  ): AsyncGenerator<StreamChunk, void, unknown>;

  /** 检查模型是否支持 */
  supportsModel(modelId: string): boolean {
    return this.config.models.some((m) => m.id === modelId);
  }

  /** 获取模型列表 */
  getModels() {
    return this.config.models;
  }

  /** 处理错误 */
  protected handleError(error: unknown, context: string): never {
    const message = error instanceof Error ? error.message : String(error);
    const providerId = this.config.id;
    this.logger.error({ error, context }, `Provider error: ${message}`);

    class ProviderErrorImpl extends Error {
      code = "PROVIDER_ERROR";
      provider = providerId;
      constructor() {
        super(`[${context}] ${message}`);
        this.name = "ProviderError";
      }
    }

    throw new ProviderErrorImpl();
  }
}
