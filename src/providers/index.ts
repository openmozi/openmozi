/**
 * 模型提供商管理
 */

import type { ProviderId, MoziConfig } from "../types/index.js";
import { BaseProvider } from "./base.js";
import { createDeepSeekProvider, DeepSeekProvider } from "./deepseek.js";
import { createKimiProvider, KimiProvider } from "./kimi.js";
import { createStepfunProvider, StepfunProvider } from "./stepfun.js";
import { createMiniMaxProvider, MiniMaxProvider } from "./minimax.js";
import { createModelScopeProvider, ModelScopeProvider } from "./modelscope.js";
import { getChildLogger } from "../utils/logger.js";

export * from "./base.js";
export * from "./deepseek.js";
export * from "./kimi.js";
export * from "./stepfun.js";
export * from "./minimax.js";
export * from "./modelscope.js";

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
  const providersConfig = config.providers;

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
