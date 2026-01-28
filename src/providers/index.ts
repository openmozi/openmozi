/**
 * 模型提供商管理
 */

import type { ProviderId, MoziConfig, SimpleProviderConfig } from "../types/index.js";
import { BaseProvider } from "./base.js";
import { createDeepSeekProvider, DeepSeekProvider } from "./deepseek.js";
import { createKimiProvider, KimiProvider } from "./kimi.js";
import { createStepfunProvider, StepfunProvider } from "./stepfun.js";
import { createMiniMaxProvider, MiniMaxProvider } from "./minimax.js";
import { createModelScopeProvider, ModelScopeProvider } from "./modelscope.js";
import {
  createCustomOpenAIProvider,
  createOpenAIProvider,
  createAzureOpenAIProvider,
  createOllamaProvider,
  createOpenRouterProvider,
  createTogetherProvider,
  createGroqProvider,
  type CustomOpenAIProviderConfig,
} from "./custom-openai.js";
import {
  createAnthropicCompatibleProvider,
  type CustomAnthropicProviderConfig,
} from "./anthropic-compatible.js";
import { getChildLogger } from "../utils/logger.js";

export * from "./base.js";
export * from "./deepseek.js";
export * from "./kimi.js";
export * from "./stepfun.js";
export * from "./minimax.js";
export * from "./modelscope.js";
export * from "./custom-openai.js";
export * from "./anthropic-compatible.js";

const logger = getChildLogger("providers");

/** 提供商注册表 */
const providers = new Map<ProviderId, BaseProvider>();

/** 注册提供商 */
export function registerProvider(provider: BaseProvider): void {
  providers.set(provider.id, provider);
  logger.info({ provider: provider.id }, "Provider registered");
}

/** 获取提供商 */
export function getProvider(id: ProviderId): BaseProvider | undefined {
  return providers.get(id);
}

/** 获取所有提供商 */
export function getAllProviders(): BaseProvider[] {
  return Array.from(providers.values());
}

/** 检查提供商是否可用 */
export function hasProvider(id: ProviderId): boolean {
  return providers.has(id);
}

/** 从配置初始化提供商 */
export function initializeProviders(config: MoziConfig): void {
  const providersConfig = config.providers as Record<string, SimpleProviderConfig>;

  // DeepSeek
  if (providersConfig.deepseek?.apiKey) {
    const provider = createDeepSeekProvider(
      providersConfig.deepseek.apiKey,
      providersConfig.deepseek.baseUrl
    );
    registerProvider(provider);
  }

  // Kimi
  if (providersConfig.kimi?.apiKey) {
    const provider = createKimiProvider(
      providersConfig.kimi.apiKey,
      providersConfig.kimi.baseUrl
    );
    registerProvider(provider);
  }

  // Stepfun
  if (providersConfig.stepfun?.apiKey) {
    const provider = createStepfunProvider(
      providersConfig.stepfun.apiKey,
      providersConfig.stepfun.baseUrl
    );
    registerProvider(provider);
  }

  // MiniMax
  if (providersConfig.minimax?.apiKey) {
    const minimaxConfig = providersConfig.minimax as { apiKey: string; groupId?: string; baseUrl?: string };
    const provider = createMiniMaxProvider(
      minimaxConfig.apiKey,
      minimaxConfig.groupId,
      minimaxConfig.baseUrl
    );
    registerProvider(provider);
  }

  // ModelScope (魔搭)
  if (providersConfig.modelscope?.apiKey) {
    const provider = createModelScopeProvider(
      providersConfig.modelscope.apiKey,
      providersConfig.modelscope.baseUrl
    );
    registerProvider(provider);
  }

  // OpenAI
  if (providersConfig.openai?.apiKey) {
    const provider = createOpenAIProvider(
      providersConfig.openai.apiKey,
      providersConfig.openai.baseUrl
    );
    registerProvider(provider);
  }

  // Ollama
  if (providersConfig.ollama) {
    const ollamaConfig = providersConfig.ollama as unknown as { baseUrl?: string; models?: string[] };
    const provider = createOllamaProvider(
      ollamaConfig.baseUrl,
      ollamaConfig.models
    );
    registerProvider(provider);
  }

  // OpenRouter
  if (providersConfig.openrouter?.apiKey) {
    const provider = createOpenRouterProvider(providersConfig.openrouter.apiKey);
    registerProvider(provider);
  }

  // Together AI
  if (providersConfig.together?.apiKey) {
    const provider = createTogetherProvider(providersConfig.together.apiKey);
    registerProvider(provider);
  }

  // Groq
  if (providersConfig.groq?.apiKey) {
    const provider = createGroqProvider(providersConfig.groq.apiKey);
    registerProvider(provider);
  }

  // 自定义 OpenAI 兼容提供商
  const customOpenai = config.providers["custom-openai"] as CustomOpenAIProviderConfig | undefined;
  if (customOpenai?.apiKey && customOpenai?.baseUrl && customOpenai?.models) {
    const provider = createCustomOpenAIProvider(customOpenai);
    registerProvider(provider);
  }

  // 自定义 Anthropic 兼容提供商
  const customAnthropic = config.providers["custom-anthropic"] as CustomAnthropicProviderConfig | undefined;
  if (customAnthropic?.apiKey && customAnthropic?.baseUrl && customAnthropic?.models) {
    const provider = createAnthropicCompatibleProvider(customAnthropic);
    registerProvider(provider);
  }

  logger.info({ count: providers.size }, "Providers initialized");
}

/** 根据模型 ID 查找提供商 */
export function findProviderForModel(modelId: string): BaseProvider | undefined {
  for (const provider of providers.values()) {
    if (provider.supportsModel(modelId)) {
      return provider;
    }
  }
  return undefined;
}

/** 获取所有可用模型 */
export function getAllModels() {
  const models: Array<{ provider: ProviderId; model: ReturnType<BaseProvider["getModels"]>[0] }> = [];

  for (const provider of providers.values()) {
    for (const model of provider.getModels()) {
      models.push({ provider: provider.id, model });
    }
  }

  return models;
}
