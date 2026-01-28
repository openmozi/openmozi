/**
 * 自定义 OpenAI 兼容提供商
 * 允许用户配置自定义的 API 地址、模型和 API Key
 * 可用于 OpenAI、Azure OpenAI、本地 LLM (Ollama, vLLM 等) 或其他兼容 API
 */

import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { ProviderConfig, ModelDefinition, ProviderId, ModelApi } from "../types/index.js";

/** 自定义 OpenAI 兼容提供商配置 */
export interface CustomOpenAIProviderConfig {
  /** 提供商 ID (唯一标识) */
  id: string;
  /** 提供商名称 (显示名称) */
  name: string;
  /** API 基础 URL (例如: https://api.openai.com/v1) */
  baseUrl: string;
  /** API Key */
  apiKey: string;
  /** 可用模型列表 */
  models: Array<{
    /** 模型 ID */
    id: string;
    /** 模型名称 (可选，默认使用 id) */
    name?: string;
    /** 上下文窗口大小 (可选，默认 128000) */
    contextWindow?: number;
    /** 最大输出 token 数 (可选，默认 4096) */
    maxTokens?: number;
    /** 是否支持视觉 (可选，默认 false) */
    supportsVision?: boolean;
    /** 是否支持推理 (可选，默认 false) */
    supportsReasoning?: boolean;
    /** 成本配置 (可选) */
    cost?: {
      input: number;
      output: number;
    };
  }>;
  /** 自定义请求头 (可选) */
  headers?: Record<string, string>;
}

export class CustomOpenAIProvider extends OpenAICompatibleProvider {
  private customHeaders: Record<string, string>;

  constructor(config: CustomOpenAIProviderConfig) {
    const models: ModelDefinition[] = config.models.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      provider: config.id as ProviderId,
      api: "openai" as ModelApi,
      contextWindow: m.contextWindow ?? 128000,
      maxTokens: m.maxTokens ?? 4096,
      supportsVision: m.supportsVision ?? false,
      supportsReasoning: m.supportsReasoning ?? false,
      cost: m.cost,
    }));

    const providerConfig: ProviderConfig = {
      id: config.id as ProviderId,
      name: config.name,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      api: "openai" as ModelApi,
      models,
    };

    super(providerConfig);
    this.customHeaders = config.headers ?? {};
    this.logger = this.logger.child({ provider: config.id });
  }

  protected override getHeaders(): Record<string, string> {
    return {
      ...super.getHeaders(),
      ...this.customHeaders,
    };
  }
}

/** 创建自定义 OpenAI 兼容提供商 */
export function createCustomOpenAIProvider(config: CustomOpenAIProviderConfig): CustomOpenAIProvider {
  return new CustomOpenAIProvider(config);
}

/** 预设配置：OpenAI 官方 */
export function createOpenAIProvider(apiKey: string, baseUrl?: string): CustomOpenAIProvider {
  return createCustomOpenAIProvider({
    id: "openai",
    name: "OpenAI",
    baseUrl: baseUrl ?? "https://api.openai.com/v1",
    apiKey,
    models: [
      {
        id: "gpt-4o",
        name: "GPT-4o",
        contextWindow: 128000,
        maxTokens: 16384,
        supportsVision: true,
        cost: { input: 2.5, output: 10 },
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        contextWindow: 128000,
        maxTokens: 16384,
        supportsVision: true,
        cost: { input: 0.15, output: 0.6 },
      },
      {
        id: "gpt-4-turbo",
        name: "GPT-4 Turbo",
        contextWindow: 128000,
        maxTokens: 4096,
        supportsVision: true,
        cost: { input: 10, output: 30 },
      },
      {
        id: "gpt-3.5-turbo",
        name: "GPT-3.5 Turbo",
        contextWindow: 16385,
        maxTokens: 4096,
        cost: { input: 0.5, output: 1.5 },
      },
      {
        id: "o1",
        name: "o1",
        contextWindow: 200000,
        maxTokens: 100000,
        supportsReasoning: true,
        cost: { input: 15, output: 60 },
      },
      {
        id: "o1-mini",
        name: "o1 Mini",
        contextWindow: 128000,
        maxTokens: 65536,
        supportsReasoning: true,
        cost: { input: 3, output: 12 },
      },
    ],
  });
}

/** 预设配置：Azure OpenAI */
export function createAzureOpenAIProvider(config: {
  endpoint: string;
  apiKey: string;
  deploymentId: string;
  apiVersion?: string;
}): CustomOpenAIProvider {
  return createCustomOpenAIProvider({
    id: "azure-openai",
    name: "Azure OpenAI",
    baseUrl: `${config.endpoint}/openai/deployments/${config.deploymentId}`,
    apiKey: config.apiKey,
    headers: {
      "api-key": config.apiKey,
    },
    models: [
      {
        id: config.deploymentId,
        name: config.deploymentId,
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
  });
}

/** 预设配置：Ollama 本地模型 */
export function createOllamaProvider(baseUrl?: string, models?: string[]): CustomOpenAIProvider {
  const defaultModels = models ?? ["llama3.2", "qwen2.5-coder", "deepseek-r1"];

  return createCustomOpenAIProvider({
    id: "ollama",
    name: "Ollama",
    baseUrl: baseUrl ?? "http://localhost:11434/v1",
    apiKey: "ollama", // Ollama 不需要 API Key，但字段必填
    models: defaultModels.map((id) => ({
      id,
      name: id,
      contextWindow: 32768,
      maxTokens: 4096,
    })),
  });
}

/** 预设配置：vLLM */
export function createVLLMProvider(baseUrl: string, models: string[]): CustomOpenAIProvider {
  return createCustomOpenAIProvider({
    id: "vllm",
    name: "vLLM",
    baseUrl,
    apiKey: "vllm", // vLLM 通常不需要 API Key
    models: models.map((id) => ({
      id,
      name: id,
      contextWindow: 32768,
      maxTokens: 4096,
    })),
  });
}

/** 预设配置：OpenRouter */
export function createOpenRouterProvider(apiKey: string): CustomOpenAIProvider {
  return createCustomOpenAIProvider({
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey,
    headers: {
      "HTTP-Referer": "https://github.com/anthropics/mozi",
      "X-Title": "Mozi",
    },
    models: [
      {
        id: "anthropic/claude-3.5-sonnet",
        name: "Claude 3.5 Sonnet",
        contextWindow: 200000,
        maxTokens: 8192,
        supportsVision: true,
      },
      {
        id: "openai/gpt-4o",
        name: "GPT-4o",
        contextWindow: 128000,
        maxTokens: 16384,
        supportsVision: true,
      },
      {
        id: "google/gemini-pro-1.5",
        name: "Gemini Pro 1.5",
        contextWindow: 1000000,
        maxTokens: 8192,
        supportsVision: true,
      },
      {
        id: "deepseek/deepseek-chat",
        name: "DeepSeek Chat",
        contextWindow: 64000,
        maxTokens: 4096,
      },
    ],
  });
}

/** 预设配置：Together AI */
export function createTogetherProvider(apiKey: string): CustomOpenAIProvider {
  return createCustomOpenAIProvider({
    id: "together",
    name: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    apiKey,
    models: [
      {
        id: "meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo",
        name: "Llama 3.2 90B Vision",
        contextWindow: 131072,
        maxTokens: 4096,
        supportsVision: true,
      },
      {
        id: "Qwen/Qwen2.5-72B-Instruct-Turbo",
        name: "Qwen 2.5 72B",
        contextWindow: 131072,
        maxTokens: 4096,
      },
      {
        id: "deepseek-ai/DeepSeek-R1",
        name: "DeepSeek R1",
        contextWindow: 64000,
        maxTokens: 4096,
        supportsReasoning: true,
      },
    ],
  });
}

/** 预设配置：Groq */
export function createGroqProvider(apiKey: string): CustomOpenAIProvider {
  return createCustomOpenAIProvider({
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey,
    models: [
      {
        id: "llama-3.3-70b-versatile",
        name: "Llama 3.3 70B",
        contextWindow: 128000,
        maxTokens: 32768,
      },
      {
        id: "llama-3.1-8b-instant",
        name: "Llama 3.1 8B",
        contextWindow: 128000,
        maxTokens: 8192,
      },
      {
        id: "mixtral-8x7b-32768",
        name: "Mixtral 8x7B",
        contextWindow: 32768,
        maxTokens: 32768,
      },
    ],
  });
}
