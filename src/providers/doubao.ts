/**
 * 豆包（火山引擎 ARK）模型提供商
 * 字节跳动旗下大模型平台，专注深度思考能力
 */

import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { ProviderConfig, ModelDefinition } from "../types/index.js";

const DOUBAO_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

/** 豆包深度思考模型定义 */
const DOUBAO_MODELS: ModelDefinition[] = [
  {
    id: "doubao-seed-1-8-251228",
    name: "豆包 Seed 1.8（最强多模态 Agent）",
    provider: "doubao",
    api: "openai-compatible",
    contextWindow: 262144,    // 256k
    maxTokens: 32768,         // 最大回答 32k
    supportsVision: true,     // 多模态理解
    supportsReasoning: true,  // 深度思考
    cost: {
      input: 4.0,
      output: 16.0,
    },
  },
  {
    id: "doubao-seed-1-6-lite-251015",
    name: "豆包 Seed 1.6 Lite",
    provider: "doubao",
    api: "openai-compatible",
    contextWindow: 262144,
    maxTokens: 32768,
    supportsVision: true,
    supportsReasoning: true,
    cost: {
      input: 2.0,
      output: 8.0,
    },
  },
  {
    id: "doubao-seed-1-6-flash-250828",
    name: "豆包 Seed 1.6 Flash（视觉定位）",
    provider: "doubao",
    api: "openai-compatible",
    contextWindow: 262144,
    maxTokens: 32768,
    supportsVision: true,
    supportsReasoning: true,
    cost: {
      input: 1.0,
      output: 4.0,
    },
  },
  {
    id: "doubao-seed-1-6-vision-250815",
    name: "豆包 Seed 1.6 Vision（GUI 任务）",
    provider: "doubao",
    api: "openai-compatible",
    contextWindow: 262144,
    maxTokens: 32768,
    supportsVision: true,
    supportsReasoning: true,
    cost: {
      input: 2.0,
      output: 8.0,
    },
  },
  {
    id: "doubao-seed-code-preview-251028",
    name: "豆包 Seed Code（编程增强）",
    provider: "doubao",
    api: "openai-compatible",
    contextWindow: 262144,
    maxTokens: 32768,
    supportsVision: true,
    supportsReasoning: true,
    cost: {
      input: 4.0,
      output: 16.0,
    },
  },
];

export class DoubaoProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, customBaseUrl?: string) {
    const config: ProviderConfig = {
      id: "doubao",
      name: "豆包",
      baseUrl: customBaseUrl || DOUBAO_BASE_URL,
      apiKey,
      api: "openai-compatible",
      models: DOUBAO_MODELS,
    };
    super(config);
    this.logger = this.logger.child({ provider: "doubao" });
  }

  /** 豆包使用推理接入点 ID 作为 model 参数，支持动态模型 */
  override supportsModel(modelId: string): boolean {
    // 支持预定义模型
    if (super.supportsModel(modelId)) {
      return true;
    }
    // 支持以 ep- 开头的推理接入点 ID（火山引擎 Endpoint ID 格式）
    if (modelId.startsWith("ep-")) {
      return true;
    }
    // 支持 doubao- 开头的模型（方便使用其他豆包模型）
    if (modelId.startsWith("doubao-")) {
      return true;
    }
    return false;
  }
}

/** 创建豆包提供商 */
export function createDoubaoProvider(apiKey: string, baseUrl?: string): DoubaoProvider {
  return new DoubaoProvider(apiKey, baseUrl);
}
