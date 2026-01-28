/**
 * 配置加载与管理
 */

import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import json5 from "json5";
import yaml from "yaml";
import type { MoziConfig, ProviderId } from "../types/index.js";
import { getEnvVar } from "../utils/index.js";

// ============== Zod Schema ==============

const ProviderConfigSchema = z.object({
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  headers: z.record(z.string()).optional(),
}).passthrough();  // 允许额外字段 (如 custom-openai 和 custom-anthropic 的 id, name, models 等)

const FeishuConfigSchema = z.object({
  appId: z.string(),
  appSecret: z.string(),
  verificationToken: z.string().optional(),
  encryptKey: z.string().optional(),
  enabled: z.boolean().optional().default(true),
});

const DingtalkConfigSchema = z.object({
  appKey: z.string(),
  appSecret: z.string(),
  robotCode: z.string().optional(),
  enabled: z.boolean().optional().default(true),
});

const AgentConfigSchema = z.object({
  defaultModel: z.string().default("deepseek-chat"),
  defaultProvider: z.enum([
    "deepseek", "minimax", "kimi", "stepfun", "modelscope",
    "openai", "ollama", "openrouter", "together", "groq",
    "custom-openai", "custom-anthropic"
  ]).default("deepseek"),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  maxTokens: z.number().optional().default(4096),
});

const ServerConfigSchema = z.object({
  port: z.number().default(3000),
  host: z.string().optional().default("0.0.0.0"),
});

const LoggingConfigSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const MoziConfigSchema = z.object({
  providers: z.record(ProviderConfigSchema).optional().default({}),
  channels: z.object({
    feishu: FeishuConfigSchema.optional(),
    dingtalk: DingtalkConfigSchema.optional(),
  }).optional().default({}),
  agent: AgentConfigSchema.optional().default({}),
  server: ServerConfigSchema.optional().default({}),
  logging: LoggingConfigSchema.optional().default({}),
});

// ============== 配置加载 ==============

/** 从文件加载配置 */
function loadConfigFromFile(configPath: string): Partial<MoziConfig> {
  if (!existsSync(configPath)) {
    return {};
  }

  const content = readFileSync(configPath, "utf-8");

  if (configPath.endsWith(".json") || configPath.endsWith(".json5")) {
    return json5.parse(content);
  } else if (configPath.endsWith(".yaml") || configPath.endsWith(".yml")) {
    return yaml.parse(content);
  }

  return {};
}

/** 从环境变量加载配置 */
function loadConfigFromEnv(): Partial<MoziConfig> {
  const config: Partial<MoziConfig> = {
    providers: {},
    channels: {},
  };

  // 模型提供商
  const providers: MoziConfig["providers"] = {};

  const deepseekKey = getEnvVar("DEEPSEEK_API_KEY");
  if (deepseekKey) {
    providers.deepseek = { apiKey: deepseekKey };
  }

  const minimaxKey = getEnvVar("MINIMAX_API_KEY");
  if (minimaxKey) {
    providers.minimax = { apiKey: minimaxKey };
  }

  const kimiKey = getEnvVar("KIMI_API_KEY");
  if (kimiKey) {
    providers.kimi = { apiKey: kimiKey };
  }

  const stepfunKey = getEnvVar("STEPFUN_API_KEY");
  if (stepfunKey) {
    providers.stepfun = { apiKey: stepfunKey };
  }

  // ModelScope (支持 MODELSCOPE_API_KEY 或 DASHSCOPE_API_KEY)
  const modelscopeKey = getEnvVar("MODELSCOPE_API_KEY") || getEnvVar("DASHSCOPE_API_KEY");
  if (modelscopeKey) {
    providers.modelscope = { apiKey: modelscopeKey };
  }

  // OpenAI
  const openaiKey = getEnvVar("OPENAI_API_KEY");
  if (openaiKey) {
    providers.openai = {
      apiKey: openaiKey,
      baseUrl: getEnvVar("OPENAI_BASE_URL"),
    };
  }

  // Ollama
  const ollamaBaseUrl = getEnvVar("OLLAMA_BASE_URL");
  const ollamaModels = getEnvVar("OLLAMA_MODELS");
  if (ollamaBaseUrl || ollamaModels) {
    providers.ollama = {
      baseUrl: ollamaBaseUrl,
      models: ollamaModels?.split(",").map((m) => m.trim()),
    } as unknown as { apiKey?: string };
  }

  // OpenRouter
  const openrouterKey = getEnvVar("OPENROUTER_API_KEY");
  if (openrouterKey) {
    providers.openrouter = { apiKey: openrouterKey };
  }

  // Together AI
  const togetherKey = getEnvVar("TOGETHER_API_KEY");
  if (togetherKey) {
    providers.together = { apiKey: togetherKey };
  }

  // Groq
  const groqKey = getEnvVar("GROQ_API_KEY");
  if (groqKey) {
    providers.groq = { apiKey: groqKey };
  }

  config.providers = providers;

  // 飞书配置
  const feishuAppId = getEnvVar("FEISHU_APP_ID");
  const feishuAppSecret = getEnvVar("FEISHU_APP_SECRET");
  if (feishuAppId && feishuAppSecret) {
    config.channels = {
      ...config.channels,
      feishu: {
        appId: feishuAppId,
        appSecret: feishuAppSecret,
        verificationToken: getEnvVar("FEISHU_VERIFICATION_TOKEN"),
        encryptKey: getEnvVar("FEISHU_ENCRYPT_KEY"),
      },
    };
  }

  // 钉钉配置
  const dingtalkAppKey = getEnvVar("DINGTALK_APP_KEY");
  const dingtalkAppSecret = getEnvVar("DINGTALK_APP_SECRET");
  if (dingtalkAppKey && dingtalkAppSecret) {
    config.channels = {
      ...config.channels,
      dingtalk: {
        appKey: dingtalkAppKey,
        appSecret: dingtalkAppSecret,
        robotCode: getEnvVar("DINGTALK_ROBOT_CODE"),
      },
    };
  }

  // 服务器配置
  const port = getEnvVar("PORT");
  if (port) {
    config.server = { port: parseInt(port, 10) };
  }

  // 日志配置
  const logLevel = getEnvVar("LOG_LEVEL");
  if (logLevel && ["debug", "info", "warn", "error"].includes(logLevel)) {
    config.logging = { level: logLevel as "debug" | "info" | "warn" | "error" };
  }

  return config;
}

/** 深度合并配置 */
function mergeConfigs(...configs: Partial<MoziConfig>[]): Partial<MoziConfig> {
  const result: Partial<MoziConfig> = {};

  for (const config of configs) {
    // 合并 providers
    if (config.providers) {
      result.providers = { ...result.providers, ...config.providers };
    }

    // 合并 channels
    if (config.channels) {
      result.channels = {
        feishu: config.channels.feishu ?? result.channels?.feishu,
        dingtalk: config.channels.dingtalk ?? result.channels?.dingtalk,
      };
    }

    // 合并其他配置
    if (config.agent) {
      result.agent = { ...result.agent, ...config.agent };
    }
    if (config.server) {
      result.server = { ...result.server, ...config.server };
    }
    if (config.logging) {
      result.logging = { ...result.logging, ...config.logging };
    }
  }

  return result;
}

/** 加载配置 */
export function loadConfig(options?: { configPath?: string }): MoziConfig {
  const configPaths = options?.configPath
    ? [options.configPath]
    : [
        join(process.cwd(), "config.json5"),
        join(process.cwd(), "config.json"),
        join(process.cwd(), "config.yaml"),
        join(process.cwd(), "config.yml"),
      ];

  // 从文件加载
  let fileConfig: Partial<MoziConfig> = {};
  for (const configPath of configPaths) {
    const config = loadConfigFromFile(configPath);
    if (Object.keys(config).length > 0) {
      fileConfig = config;
      break;
    }
  }

  // 从环境变量加载
  const envConfig = loadConfigFromEnv();

  // 合并配置 (环境变量优先级更高)
  const merged = mergeConfigs(fileConfig, envConfig);

  // 验证配置
  const result = MoziConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(`Invalid configuration: ${result.error.message}`);
  }

  return result.data as MoziConfig;
}

/** 验证必需配置 */
export function validateRequiredConfig(config: MoziConfig, options?: { webOnly?: boolean }): string[] {
  const errors: string[] = [];

  // 检查是否至少配置了一个提供商
  const hasProvider = Object.values(config.providers).some((p) => p?.apiKey);
  if (!hasProvider) {
    errors.push("At least one model provider must be configured with an API key");
  }

  // 检查是否至少配置了一个通道 (webOnly 模式下可以只使用 WebChat)
  if (!options?.webOnly) {
    const hasChannel = config.channels.feishu || config.channels.dingtalk;
    if (!hasChannel) {
      errors.push("At least one channel (feishu or dingtalk) must be configured. Use --web-only to run with WebChat only.");
    }
  }

  return errors;
}

export { MoziConfigSchema };
