/**
 * ModelScope (魔搭) 模型提供商
 *
 * ModelScope 是阿里巴巴达摩院的开源模型社区
 * 支持 Qwen、GLM、Baichuan 等多种国产大模型
 *
 * API 文档: https://modelscope.cn/docs/model-service/API-Inference
 */

import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { ProviderConfig, ModelDefinition } from "../types/index.js";

// ModelScope 社区推理 API (支持 ms-xxx 格式的 token)
const MODELSCOPE_BASE_URL = "https://api-inference.modelscope.cn/v1";

/** ModelScope 模型定义 */
const MODELSCOPE_MODELS: ModelDefinition[] = [
  // Qwen 2.5 系列 (开源模型，免费使用)
  {
    id: "Qwen/Qwen2.5-72B-Instruct",
    name: "Qwen 2.5 72B Instruct",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 131072,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: { input: 0, output: 0 }, // ModelScope 社区免费
  },
  {
    id: "Qwen/Qwen2.5-32B-Instruct",
    name: "Qwen 2.5 32B Instruct",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 131072,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: { input: 0, output: 0 },
  },
  {
    id: "Qwen/Qwen2.5-14B-Instruct",
    name: "Qwen 2.5 14B Instruct",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 131072,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: { input: 0, output: 0 },
  },
  {
    id: "Qwen/Qwen2.5-7B-Instruct",
    name: "Qwen 2.5 7B Instruct",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 131072,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: { input: 0, output: 0 },
  },
  {
    id: "Qwen/Qwen2.5-3B-Instruct",
    name: "Qwen 2.5 3B Instruct",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 32768,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: { input: 0, output: 0 },
  },
  // Qwen Coder (代码模型)
  {
    id: "Qwen/Qwen2.5-Coder-32B-Instruct",
    name: "Qwen 2.5 Coder 32B",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 131072,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: { input: 0, output: 0 },
  },
  {
    id: "Qwen/Qwen2.5-Coder-14B-Instruct",
    name: "Qwen 2.5 Coder 14B",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 131072,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: { input: 0, output: 0 },
  },
  {
    id: "Qwen/Qwen2.5-Coder-7B-Instruct",
    name: "Qwen 2.5 Coder 7B",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 131072,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: { input: 0, output: 0 },
  },
  // Qwen VL 视觉模型
  {
    id: "Qwen/Qwen2-VL-72B-Instruct",
    name: "Qwen 2 VL 72B",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 32768,
    maxTokens: 2048,
    supportsVision: true,
    supportsReasoning: false,
    cost: { input: 0, output: 0 },
  },
  {
    id: "Qwen/Qwen2-VL-7B-Instruct",
    name: "Qwen 2 VL 7B",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 32768,
    maxTokens: 2048,
    supportsVision: true,
    supportsReasoning: false,
    cost: { input: 0, output: 0 },
  },
  // DeepSeek 系列
  {
    id: "deepseek-ai/DeepSeek-R1",
    name: "DeepSeek R1",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 65536,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: true,
    cost: { input: 0, output: 0 },
  },
  {
    id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
    name: "DeepSeek R1 Distill Qwen 32B",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 65536,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: true,
    cost: { input: 0, output: 0 },
  },
  {
    id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B",
    name: "DeepSeek R1 Distill Qwen 14B",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 65536,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: true,
    cost: { input: 0, output: 0 },
  },
  {
    id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
    name: "DeepSeek R1 Distill Qwen 7B",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 65536,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: true,
    cost: { input: 0, output: 0 },
  },
  {
    id: "deepseek-ai/DeepSeek-V3",
    name: "DeepSeek V3",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 65536,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: false,
    cost: { input: 0, output: 0 },
  },
  // GLM 系列 (智谱)
  {
    id: "ZhipuAI/GLM-4-9B-Chat",
    name: "GLM 4 9B Chat",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 128000,
    maxTokens: 4096,
    supportsVision: false,
    supportsReasoning: false,
    cost: { input: 0, output: 0 },
  },
  // Yi 系列 (零一万物)
  {
    id: "01ai/Yi-1.5-34B-Chat",
    name: "Yi 1.5 34B Chat",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 4096,
    maxTokens: 2048,
    supportsVision: false,
    supportsReasoning: false,
    cost: { input: 0, output: 0 },
  },
  {
    id: "01ai/Yi-1.5-9B-Chat",
    name: "Yi 1.5 9B Chat",
    provider: "modelscope",
    api: "openai-compatible",
    contextWindow: 4096,
    maxTokens: 2048,
    supportsVision: false,
    supportsReasoning: false,
    cost: { input: 0, output: 0 },
  },
];

export class ModelScopeProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, customBaseUrl?: string) {
    const config: ProviderConfig = {
      id: "modelscope",
      name: "ModelScope (魔搭)",
      baseUrl: customBaseUrl || MODELSCOPE_BASE_URL,
      apiKey,
      api: "openai-compatible",
      models: MODELSCOPE_MODELS,
    };
    super(config);
    this.logger = this.logger.child({ provider: "modelscope" });
  }
}

/** 创建 ModelScope 提供商 */
export function createModelScopeProvider(apiKey: string, baseUrl?: string): ModelScopeProvider {
  return new ModelScopeProvider(apiKey, baseUrl);
}
