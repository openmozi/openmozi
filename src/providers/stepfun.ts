/**
 * 阶跃星辰 (Stepfun) 模型提供商
 */

import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { ProviderConfig, ModelDefinition } from "../types/index.js";

const STEPFUN_BASE_URL = "https://api.stepfun.com/v1";

/** Stepfun 模型定义 */
const STEPFUN_MODELS: ModelDefinition[] = [
  {
    id: "step-1-8k",
    name: "Step 1 8K",
    provider: "stepfun",
    api: "openai-compatible",
    contextWindow: 8000,
    maxTokens: 4096,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 5,    // ¥5/百万 token
      output: 20,  // ¥20/百万 token
    },
  },
  {
    id: "step-1-32k",
    name: "Step 1 32K",
    provider: "stepfun",
    api: "openai-compatible",
    contextWindow: 32000,
    maxTokens: 16384,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 15,
      output: 70,
    },
  },
  {
    id: "step-1-128k",
    name: "Step 1 128K",
    provider: "stepfun",
    api: "openai-compatible",
    contextWindow: 128000,
    maxTokens: 65536,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 40,
      output: 200,
    },
  },
  {
    id: "step-1-256k",
    name: "Step 1 256K",
    provider: "stepfun",
    api: "openai-compatible",
    contextWindow: 256000,
    maxTokens: 65536,
    supportsVision: false,
    supportsReasoning: false,
    cost: {
      input: 95,
      output: 300,
    },
  },
  {
    id: "step-1v-8k",
    name: "Step 1V 8K (Vision)",
    provider: "stepfun",
    api: "openai-compatible",
    contextWindow: 8000,
    maxTokens: 4096,
    supportsVision: true,
    supportsReasoning: false,
    cost: {
      input: 8,
      output: 30,
    },
  },
  {
    id: "step-1v-32k",
    name: "Step 1V 32K (Vision)",
    provider: "stepfun",
    api: "openai-compatible",
    contextWindow: 32000,
    maxTokens: 16384,
    supportsVision: true,
    supportsReasoning: false,
    cost: {
      input: 24,
      output: 96,
    },
  },
  {
    id: "step-2-16k",
    name: "Step 2 16K",
    provider: "stepfun",
    api: "openai-compatible",
    contextWindow: 16000,
    maxTokens: 8192,
    supportsVision: false,
    supportsReasoning: true,
    cost: {
      input: 38,
      output: 120,
    },
  },
];

export class StepfunProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, customBaseUrl?: string) {
    const config: ProviderConfig = {
      id: "stepfun",
      name: "阶跃星辰 (Stepfun)",
      baseUrl: customBaseUrl || STEPFUN_BASE_URL,
      apiKey,
      api: "openai-compatible",
      models: STEPFUN_MODELS,
    };
    super(config);
    this.logger = this.logger.child({ provider: "stepfun" });
  }
}

/** 创建 Stepfun 提供商 */
export function createStepfunProvider(apiKey: string, baseUrl?: string): StepfunProvider {
  return new StepfunProvider(apiKey, baseUrl);
}
