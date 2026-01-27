/**
 * DeepSeek 模型提供商
 */

import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { ProviderConfig, ModelDefinition } from "../types/index.js";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/** DeepSeek 模型定义 */
const DEEPSEEK_MODELS: ModelDefinition[] = [
  {
    id: "deepseek-chat",
    name: "DeepSeek Chat",
    provider: "deepseek",
    api: "openai-compatible",
    contextWindow: 64000,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 0.14,  // ¥0.14/百万 token (缓存命中 ¥0.014)
      output: 0.28, // ¥0.28/百万 token
      cacheRead: 0.014,
    },
  },
  {
    id: "deepseek-reasoner",
    name: "DeepSeek Reasoner (R1)",
    provider: "deepseek",
    api: "openai-compatible",
    contextWindow: 64000,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: true,
    cost: {
      input: 0.55,  // ¥0.55/百万 token
      output: 2.19, // ¥2.19/百万 token
      cacheRead: 0.14,
    },
  },
];

export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, customBaseUrl?: string) {
    const config: ProviderConfig = {
      id: "deepseek",
      name: "DeepSeek",
      baseUrl: customBaseUrl || DEEPSEEK_BASE_URL,
      apiKey,
      api: "openai-compatible",
      models: DEEPSEEK_MODELS,
    };
    super(config);
    this.logger = this.logger.child({ provider: "deepseek" });
  }
}

/** 创建 DeepSeek 提供商 */
export function createDeepSeekProvider(apiKey: string, baseUrl?: string): DeepSeekProvider {
  return new DeepSeekProvider(apiKey, baseUrl);
}
