/**
 * Kimi (Moonshot) 模型提供商
 */

import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { ProviderConfig, ModelDefinition } from "../types/index.js";

const KIMI_BASE_URL = "https://api.moonshot.cn/v1";

/** Kimi 模型定义 */
const KIMI_MODELS: ModelDefinition[] = [
  {
    id: "moonshot-v1-8k",
    name: "Moonshot V1 8K",
    provider: "kimi",
    api: "openai-compatible",
    contextWindow: 8000,
    maxTokens: 4096,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 12,   // ¥12/百万 token
      output: 12,
    },
  },
  {
    id: "moonshot-v1-32k",
    name: "Moonshot V1 32K",
    provider: "kimi",
    api: "openai-compatible",
    contextWindow: 32000,
    maxTokens: 16384,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 24,   // ¥24/百万 token
      output: 24,
    },
  },
  {
    id: "moonshot-v1-128k",
    name: "Moonshot V1 128K",
    provider: "kimi",
    api: "openai-compatible",
    contextWindow: 128000,
    maxTokens: 65536,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 60,   // ¥60/百万 token
      output: 60,
    },
  },
  {
    id: "kimi-latest",
    name: "Kimi Latest",
    provider: "kimi",
    api: "openai-compatible",
    contextWindow: 128000,
    maxTokens: 65536,
    supportsVision: true,
    supportsReasoning: false,
    cost: {
      input: 60,
      output: 60,
    },
  },
];

export class KimiProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, customBaseUrl?: string) {
    const config: ProviderConfig = {
      id: "kimi",
      name: "Kimi (Moonshot)",
      baseUrl: customBaseUrl || KIMI_BASE_URL,
      apiKey,
      api: "openai-compatible",
      models: KIMI_MODELS,
    };
    super(config);
    this.logger = this.logger.child({ provider: "kimi" });
  }
}

/** 创建 Kimi 提供商 */
export function createKimiProvider(apiKey: string, baseUrl?: string): KimiProvider {
  return new KimiProvider(apiKey, baseUrl);
}
