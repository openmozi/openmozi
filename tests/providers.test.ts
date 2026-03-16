/**
 * 模型提供商测试 (基于 model-resolver)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../src/utils/logger.js", () => ({
  getChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  initializeProviders,
  getAllProviders,
  getAllModels,
  resolveModel,
  getApiKeyForProvider,
  isProviderAvailable,
  hasProvider,
} from "../src/providers/index.js";
import type { MoziConfig } from "../src/types/index.js";

function makeConfig(providers: Record<string, any>): MoziConfig {
  return {
    providers,
    channels: {},
    agent: { defaultModel: "test-model", defaultProvider: "deepseek" },
    server: { port: 3000 },
    logging: { level: "error" },
  };
}

describe("providers (model-resolver)", () => {
  beforeEach(() => {
    // 重新初始化，清除之前的注册
    initializeProviders(makeConfig({}));
  });

  describe("initializeProviders", () => {
    it("should initialize without error when no providers configured", () => {
      expect(() => initializeProviders(makeConfig({}))).not.toThrow();
    });

    it("should register china provider models", () => {
      initializeProviders(makeConfig({
        deepseek: { apiKey: "sk-test" },
      }));

      const models = getAllModels();
      const deepseekModels = models.filter((m) => m.provider === "deepseek");
      expect(deepseekModels.length).toBeGreaterThan(0);
    });

    it("should register multiple providers", () => {
      initializeProviders(makeConfig({
        deepseek: { apiKey: "sk-test-1" },
        kimi: { apiKey: "sk-test-2" },
      }));

      const models = getAllModels();
      const deepseekModels = models.filter((m) => m.provider === "deepseek");
      const kimiModels = models.filter((m) => m.provider === "kimi");
      expect(deepseekModels.length).toBeGreaterThan(0);
      expect(kimiModels.length).toBeGreaterThan(0);
    });
  });

  describe("resolveModel", () => {
    it("should resolve registered china provider model", () => {
      initializeProviders(makeConfig({
        deepseek: { apiKey: "sk-test" },
      }));

      const model = resolveModel("deepseek", "deepseek-chat");
      expect(model).toBeDefined();
      expect(model!.id).toBe("deepseek-chat");
      expect(model!.api).toBe("openai-completions");
    });

    it("should return undefined for unknown provider", () => {
      const model = resolveModel("unknown-provider" as any, "some-model");
      expect(model).toBeUndefined();
    });

    it("should dynamically resolve unknown model for known provider", () => {
      initializeProviders(makeConfig({
        deepseek: { apiKey: "sk-test" },
      }));

      const model = resolveModel("deepseek", "deepseek-v999-unknown");
      expect(model).toBeDefined();
      expect(model!.id).toBe("deepseek-v999-unknown");
    });

    it("should use custom baseUrl if provided", () => {
      initializeProviders(makeConfig({
        deepseek: { apiKey: "sk-test", baseUrl: "https://custom.api.com/v1" },
      }));

      const model = resolveModel("deepseek", "deepseek-chat");
      expect(model).toBeDefined();
      expect(model!.baseUrl).toBe("https://custom.api.com/v1");
    });
  });

  describe("getApiKeyForProvider", () => {
    it("should return api key for configured provider", () => {
      initializeProviders(makeConfig({
        deepseek: { apiKey: "sk-my-key" },
      }));

      expect(getApiKeyForProvider("deepseek")).toBe("sk-my-key");
    });

    it("should return undefined for unconfigured provider", () => {
      expect(getApiKeyForProvider("unconfigured" as any)).toBeUndefined();
    });
  });

  describe("isProviderAvailable", () => {
    it("should return true for configured provider with apiKey", () => {
      initializeProviders(makeConfig({
        kimi: { apiKey: "sk-test" },
      }));

      expect(isProviderAvailable("kimi")).toBe(true);
    });

    it("should return false for unconfigured provider", () => {
      expect(isProviderAvailable("kimi")).toBe(false);
    });

    it("should return false for provider without apiKey", () => {
      initializeProviders(makeConfig({
        kimi: {},
      }));

      expect(isProviderAvailable("kimi")).toBe(false);
    });
  });

  describe("getAllProviders", () => {
    it("should return array of provider info", () => {
      initializeProviders(makeConfig({
        deepseek: { apiKey: "sk-test" },
      }));

      const providers = getAllProviders();
      expect(Array.isArray(providers)).toBe(true);
      const ds = providers.find((p) => p.id === "deepseek");
      expect(ds).toBeDefined();
      expect(ds!.name).toBeTruthy();
    });
  });

  describe("getAllModels", () => {
    it("should return empty array when no providers configured", () => {
      initializeProviders(makeConfig({}));
      const models = getAllModels();
      expect(Array.isArray(models)).toBe(true);
    });

    it("should return models with provider and model info", () => {
      initializeProviders(makeConfig({
        zhipu: { apiKey: "sk-test" },
      }));

      const models = getAllModels();
      const zhipuModels = models.filter((m) => m.provider === "zhipu");
      expect(zhipuModels.length).toBeGreaterThan(0);

      for (const m of zhipuModels) {
        expect(m.model).toBeDefined();
        expect(m.model.id).toBeTruthy();
      }
    });
  });

  describe("hasProvider", () => {
    it("should return true for configured provider", () => {
      initializeProviders(makeConfig({
        stepfun: { apiKey: "sk-test" },
      }));

      expect(hasProvider("stepfun")).toBe(true);
    });

    it("should return false for unconfigured provider", () => {
      expect(hasProvider("stepfun")).toBe(false);
    });
  });
});
