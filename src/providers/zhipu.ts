/**
 * 智谱 AI (Zhipu) 模型提供商
 *
 * 智谱 AI 是清华大学技术团队创立的人工智能公司
 * 提供 GLM 系列大语言模型
 *
 * API 文档: https://open.bigmodel.cn/dev/api
 */

import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { ProviderConfig, ModelDefinition } from "../types/index.js";

// 智谱 AI OpenAI 兼容接口
const ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

/** 智谱 AI 模型定义 */
const ZHIPU_MODELS: ModelDefinition[] = [
  // GLM-4 系列
  {
    id: "glm-4-plus",
    name: "GLM-4 Plus",
    provider: "zhipu",
    api: "openai-compatible",
    contextWindow: 128000,
    maxTokens: 4096,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 50,   // ¥0.05/千token = ¥50/百万token
      output: 50,
    },
  },
  {
    id: "glm-4-0520",
    name: "GLM-4 0520",
    provider: "zhipu",
    api: "openai-compatible",
    contextWindow: 128000,
    maxTokens: 4096,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 100,
      output: 100,
    },
  },
  {
    id: "glm-4-air",
    name: "GLM-4 Air",
    provider: "zhipu",
    api: "openai-compatible",
    contextWindow: 128000,
    maxTokens: 4096,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 1,    // ¥0.001/千token
      output: 1,
    },
  },
  {
    id: "glm-4-airx",
    name: "GLM-4 AirX",
    provider: "zhipu",
    api: "openai-compatible",
    contextWindow: 8192,
    maxTokens: 4096,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 10,
      output: 10,
    },
  },
  {
    id: "glm-4-long",
    name: "GLM-4 Long",
    provider: "zhipu",
    api: "openai-compatible",
    contextWindow: 1000000, // 100万 token
    maxTokens: 4096,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 1,
      output: 1,
    },
  },
  {
    id: "glm-4-flash",
    name: "GLM-4 Flash",
    provider: "zhipu",
    api: "openai-compatible",
    contextWindow: 128000,
    maxTokens: 4096,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 0,  // 免费
      output: 0,
    },
  },
  {
    id: "glm-4-flashx",
    name: "GLM-4 FlashX",
    provider: "zhipu",
    api: "openai-compatible",
    contextWindow: 128000,
    maxTokens: 4096,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 0.1,
      output: 0.1,
    },
  },
  // GLM-4V 视觉模型
  {
    id: "glm-4v-plus",
    name: "GLM-4V Plus",
    provider: "zhipu",
    api: "openai-compatible",
    contextWindow: 8192,
    maxTokens: 1024,
    supportsVision: true,
    supportsReasoning: false,
    cost: {
      input: 10,
      output: 10,
    },
  },
  {
    id: "glm-4v",
    name: "GLM-4V",
    provider: "zhipu",
    api: "openai-compatible",
    contextWindow: 2048,
    maxTokens: 1024,
    supportsVision: true,
    supportsReasoning: false,
    cost: {
      input: 50,
      output: 50,
    },
  },
  {
    id: "glm-4v-flash",
    name: "GLM-4V Flash",
    provider: "zhipu",
    api: "openai-compatible",
    contextWindow: 8192,
    maxTokens: 1024,
    supportsVision: true,
    supportsReasoning: false,
    cost: {
      input: 0,  // 免费
      output: 0,
    },
  },
  // CodeGeeX 代码模型
  {
    id: "codegeex-4",
    name: "CodeGeeX 4",
    provider: "zhipu",
    api: "openai-compatible",
    contextWindow: 128000,
    maxTokens: 4096,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 0.1,
      output: 0.1,
    },
  },
];

export class ZhipuProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, customBaseUrl?: string) {
    const config: ProviderConfig = {
      id: "zhipu",
      name: "智谱 AI",
      baseUrl: customBaseUrl || ZHIPU_BASE_URL,
      apiKey,
      api: "openai-compatible",
      models: ZHIPU_MODELS,
    };
    super(config);
    this.logger = this.logger.child({ provider: "zhipu" });
  }
}

/** 创建智谱 AI 提供商 */
export function createZhipuProvider(apiKey: string, baseUrl?: string): ZhipuProvider {
  return new ZhipuProvider(apiKey, baseUrl);
}
