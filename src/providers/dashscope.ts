/**
 * 阿里云 DashScope (灵积) 模型提供商
 *
 * DashScope 是阿里云的模型服务平台，提供通义千问等模型的商业 API
 * 相比 ModelScope 社区版，提供更稳定的服务和更高的并发能力
 *
 * API 文档: https://help.aliyun.com/zh/dashscope/developer-reference/api-details
 */

import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { ProviderConfig, ModelDefinition } from "../types/index.js";

// DashScope OpenAI 兼容接口
const DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

/** DashScope 模型定义 */
const DASHSCOPE_MODELS: ModelDefinition[] = [
  // Qwen-Max 系列 (最强能力)
  {
    id: "qwen-max",
    name: "Qwen Max",
    provider: "dashscope",
    api: "openai-compatible",
    contextWindow: 32768,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 20,   // ¥0.02/千token = ¥20/百万token
      output: 60,  // ¥0.06/千token
    },
  },
  {
    id: "qwen-max-latest",
    name: "Qwen Max Latest",
    provider: "dashscope",
    api: "openai-compatible",
    contextWindow: 32768,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 20,
      output: 60,
    },
  },
  // Qwen-Plus 系列 (平衡性能与成本)
  {
    id: "qwen-plus",
    name: "Qwen Plus",
    provider: "dashscope",
    api: "openai-compatible",
    contextWindow: 131072,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 0.8,  // ¥0.0008/千token
      output: 2,   // ¥0.002/千token
    },
  },
  {
    id: "qwen-plus-latest",
    name: "Qwen Plus Latest",
    provider: "dashscope",
    api: "openai-compatible",
    contextWindow: 131072,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 0.8,
      output: 2,
    },
  },
  // Qwen-Turbo 系列 (高性价比)
  {
    id: "qwen-turbo",
    name: "Qwen Turbo",
    provider: "dashscope",
    api: "openai-compatible",
    contextWindow: 131072,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 0.3,  // ¥0.0003/千token
      output: 0.6, // ¥0.0006/千token
    },
  },
  {
    id: "qwen-turbo-latest",
    name: "Qwen Turbo Latest",
    provider: "dashscope",
    api: "openai-compatible",
    contextWindow: 131072,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 0.3,
      output: 0.6,
    },
  },
  // Qwen-Long (超长上下文)
  {
    id: "qwen-long",
    name: "Qwen Long",
    provider: "dashscope",
    api: "openai-compatible",
    contextWindow: 10000000, // 1000万 token
    maxTokens: 6000,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 0.5,
      output: 2,
    },
  },
  // Qwen-VL 视觉模型
  {
    id: "qwen-vl-max",
    name: "Qwen VL Max",
    provider: "dashscope",
    api: "openai-compatible",
    contextWindow: 32768,
    maxTokens: 2048,
    supportsVision: true,
    supportsReasoning: false,
    cost: {
      input: 20,
      output: 60,
    },
  },
  {
    id: "qwen-vl-plus",
    name: "Qwen VL Plus",
    provider: "dashscope",
    api: "openai-compatible",
    contextWindow: 8192,
    maxTokens: 2048,
    supportsVision: true,
    supportsReasoning: false,
    cost: {
      input: 8,
      output: 8,
    },
  },
  // Qwen-Coder 代码模型
  {
    id: "qwen-coder-plus",
    name: "Qwen Coder Plus",
    provider: "dashscope",
    api: "openai-compatible",
    contextWindow: 131072,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 3.5,
      output: 7,
    },
  },
  {
    id: "qwen-coder-turbo",
    name: "Qwen Coder Turbo",
    provider: "dashscope",
    api: "openai-compatible",
    contextWindow: 131072,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 2,
      output: 6,
    },
  },
  // QwQ 推理模型
  {
    id: "qwq-plus",
    name: "QwQ Plus",
    provider: "dashscope",
    api: "openai-compatible",
    contextWindow: 131072,
    maxTokens: 16384,
    supportsVision: false,
    supportsReasoning: true,
    cost: {
      input: 1.6,
      output: 18,
    },
  },
  // DeepSeek 系列 (通过 DashScope 调用)
  {
    id: "deepseek-v3",
    name: "DeepSeek V3",
    provider: "dashscope",
    api: "openai-compatible",
    contextWindow: 65536,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 2,
      output: 8,
    },
  },
  {
    id: "deepseek-r1",
    name: "DeepSeek R1",
    provider: "dashscope",
    api: "openai-compatible",
    contextWindow: 65536,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: true,
    cost: {
      input: 4,
      output: 16,
    },
  },
];

export class DashScopeProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, customBaseUrl?: string) {
    const config: ProviderConfig = {
      id: "dashscope",
      name: "DashScope (灵积)",
      baseUrl: customBaseUrl || DASHSCOPE_BASE_URL,
      apiKey,
      api: "openai-compatible",
      models: DASHSCOPE_MODELS,
    };
    super(config);
    this.logger = this.logger.child({ provider: "dashscope" });
  }
}

/** 创建 DashScope 提供商 */
export function createDashScopeProvider(apiKey: string, baseUrl?: string): DashScopeProvider {
  return new DashScopeProvider(apiKey, baseUrl);
}
