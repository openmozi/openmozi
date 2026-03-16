/**
 * 模型提供商管理 - 薄封装层，使用 model-resolver
 */

import type { ProviderId, MoziConfig } from "../types/index.js";
import {
  initModelResolver,
  resolveModel,
  getAllRegisteredModels,
  isProviderAvailable,
  getApiKeyForProvider,
} from "./model-resolver.js";
import { getChildLogger } from "../utils/logger.js";

export { resolveModel, getApiKeyForProvider, isProviderAvailable } from "./model-resolver.js";

const logger = getChildLogger("providers");

/** 从配置初始化提供商 */
export function initializeProviders(config: MoziConfig): void {
  initModelResolver(config);
  logger.info("Providers initialized via model-resolver");
}

/** 获取所有可用模型 */
export function getAllModels() {
  return getAllRegisteredModels().map((item) => ({
    provider: item.provider,
    model: {
      id: item.modelId,
      name: item.model.name,
      supportsVision: item.model.input.includes("image"),
      supportsReasoning: item.model.reasoning,
      contextWindow: item.model.contextWindow,
      maxTokens: item.model.maxTokens,
    },
  }));
}

/** 获取所有提供商 (兼容接口) */
export function getAllProviders(): Array<{ id: ProviderId; name: string }> {
  const providers = new Map<string, { id: ProviderId; name: string }>();

  for (const item of getAllRegisteredModels()) {
    if (!providers.has(item.provider)) {
      providers.set(item.provider, { id: item.provider, name: item.provider });
    }
  }

  return Array.from(providers.values());
}

/** 检查提供商是否可用 */
export function hasProvider(id: ProviderId): boolean {
  return isProviderAvailable(id);
}
