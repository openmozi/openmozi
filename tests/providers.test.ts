/**
 * 模型提供商测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger
vi.mock("../src/utils/logger.js", () => ({
  getChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// 需要在 mock 之后导入
import {
  registerProvider,
  getProvider,
  getAllProviders,
  hasProvider,
  findProviderForModel,
  getAllModels,
  BaseProvider,
} from "../src/providers/index.js";
import type { ProviderConfig, ChatCompletionRequest, ChatCompletionResponse, StreamChunk } from "../src/types/index.js";

// 创建一个测试用的 Provider 实现
class TestProvider extends BaseProvider {
  async chat(_request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return {
      id: "test-id",
      model: this.config.models[0]?.id ?? "test-model",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Test response" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    };
  }

  async *chatStream(_request: ChatCompletionRequest): AsyncGenerator<StreamChunk, void, unknown> {
    yield { type: "content", content: "Test " };
    yield { type: "content", content: "response" };
    yield { type: "done", finish_reason: "stop" };
  }
}

describe("providers", () => {
  // 保存原始状态
  let originalProviders: Map<string, BaseProvider>;

  beforeEach(() => {
    // 清空 providers（通过私有访问）
    // 由于 providers 是模块级别的 Map，我们需要通过注册来测试
  });

  describe("registerProvider", () => {
    it("should register a provider", () => {
      const config: ProviderConfig = {
        id: "test-provider-1",
        name: "Test Provider 1",
        baseUrl: "https://api.test.com",
        apiKey: "test-key",
        models: [
          { id: "model-1", name: "Model 1", contextWindow: 4096 },
        ],
      };

      const provider = new TestProvider(config);
      registerProvider(provider);

      expect(hasProvider("test-provider-1")).toBe(true);
      expect(getProvider("test-provider-1")).toBe(provider);
    });

    it("should overwrite existing provider with same id", () => {
      const config1: ProviderConfig = {
        id: "test-provider-2",
        name: "Test Provider 2",
        baseUrl: "https://api.test.com",
        apiKey: "key-1",
        models: [{ id: "model-1", name: "Model 1", contextWindow: 4096 }],
      };

      const config2: ProviderConfig = {
        id: "test-provider-2",
        name: "Test Provider 2 Updated",
        baseUrl: "https://api.test.com",
        apiKey: "key-2",
        models: [{ id: "model-2", name: "Model 2", contextWindow: 8192 }],
      };

      const provider1 = new TestProvider(config1);
      const provider2 = new TestProvider(config2);

      registerProvider(provider1);
      registerProvider(provider2);

      const result = getProvider("test-provider-2");
      expect(result?.name).toBe("Test Provider 2 Updated");
    });
  });

  describe("getProvider", () => {
    it("should return undefined for non-existent provider", () => {
      expect(getProvider("non-existent-provider")).toBeUndefined();
    });

    it("should return registered provider", () => {
      const config: ProviderConfig = {
        id: "test-provider-3",
        name: "Test Provider 3",
        baseUrl: "https://api.test.com",
        apiKey: "test-key",
        models: [{ id: "model-1", name: "Model 1", contextWindow: 4096 }],
      };

      const provider = new TestProvider(config);
      registerProvider(provider);

      expect(getProvider("test-provider-3")).toBe(provider);
    });
  });

  describe("hasProvider", () => {
    it("should return false for non-existent provider", () => {
      expect(hasProvider("definitely-not-exists")).toBe(false);
    });

    it("should return true for registered provider", () => {
      const config: ProviderConfig = {
        id: "test-provider-4",
        name: "Test Provider 4",
        baseUrl: "https://api.test.com",
        apiKey: "test-key",
        models: [{ id: "model-1", name: "Model 1", contextWindow: 4096 }],
      };

      const provider = new TestProvider(config);
      registerProvider(provider);

      expect(hasProvider("test-provider-4")).toBe(true);
    });
  });

  describe("getAllProviders", () => {
    it("should return array of providers", () => {
      const providers = getAllProviders();
      expect(Array.isArray(providers)).toBe(true);
    });
  });

  describe("findProviderForModel", () => {
    it("should find provider that supports model", () => {
      const config: ProviderConfig = {
        id: "test-provider-5",
        name: "Test Provider 5",
        baseUrl: "https://api.test.com",
        apiKey: "test-key",
        models: [
          { id: "special-model-xyz", name: "Special Model", contextWindow: 4096 },
        ],
      };

      const provider = new TestProvider(config);
      registerProvider(provider);

      const found = findProviderForModel("special-model-xyz");
      expect(found).toBe(provider);
    });

    it("should return undefined for unknown model", () => {
      const found = findProviderForModel("unknown-model-abc-123");
      expect(found).toBeUndefined();
    });
  });

  describe("getAllModels", () => {
    it("should return array of models with provider info", () => {
      const config: ProviderConfig = {
        id: "test-provider-6",
        name: "Test Provider 6",
        baseUrl: "https://api.test.com",
        apiKey: "test-key",
        models: [
          { id: "model-a", name: "Model A", contextWindow: 4096 },
          { id: "model-b", name: "Model B", contextWindow: 8192 },
        ],
      };

      const provider = new TestProvider(config);
      registerProvider(provider);

      const models = getAllModels();
      expect(Array.isArray(models)).toBe(true);

      const modelA = models.find((m) => m.model.id === "model-a");
      expect(modelA).toBeDefined();
      expect(modelA?.provider).toBe("test-provider-6");
    });
  });
});

describe("BaseProvider", () => {
  describe("properties", () => {
    it("should expose id, name, baseUrl, apiKey", () => {
      const config: ProviderConfig = {
        id: "base-test",
        name: "Base Test Provider",
        baseUrl: "https://api.base.test",
        apiKey: "base-api-key",
        models: [{ id: "model-1", name: "Model 1", contextWindow: 4096 }],
      };

      const provider = new TestProvider(config);

      expect(provider.id).toBe("base-test");
      expect(provider.name).toBe("Base Test Provider");
      expect(provider.baseUrl).toBe("https://api.base.test");
      expect(provider.apiKey).toBe("base-api-key");
    });

    it("should handle undefined apiKey", () => {
      const config: ProviderConfig = {
        id: "no-key-test",
        name: "No Key Provider",
        baseUrl: "https://api.nokey.test",
        models: [{ id: "model-1", name: "Model 1", contextWindow: 4096 }],
      };

      const provider = new TestProvider(config);
      expect(provider.apiKey).toBeUndefined();
    });
  });

  describe("supportsModel", () => {
    it("should return true for supported model", () => {
      const config: ProviderConfig = {
        id: "model-support-test",
        name: "Model Support Test",
        baseUrl: "https://api.test.com",
        models: [
          { id: "supported-model", name: "Supported", contextWindow: 4096 },
        ],
      };

      const provider = new TestProvider(config);
      expect(provider.supportsModel("supported-model")).toBe(true);
    });

    it("should return false for unsupported model", () => {
      const config: ProviderConfig = {
        id: "model-support-test-2",
        name: "Model Support Test 2",
        baseUrl: "https://api.test.com",
        models: [
          { id: "only-this-model", name: "Only Model", contextWindow: 4096 },
        ],
      };

      const provider = new TestProvider(config);
      expect(provider.supportsModel("other-model")).toBe(false);
    });
  });

  describe("getModels", () => {
    it("should return configured models", () => {
      const config: ProviderConfig = {
        id: "get-models-test",
        name: "Get Models Test",
        baseUrl: "https://api.test.com",
        models: [
          { id: "model-1", name: "Model 1", contextWindow: 4096 },
          { id: "model-2", name: "Model 2", contextWindow: 8192 },
        ],
      };

      const provider = new TestProvider(config);
      const models = provider.getModels();

      expect(models).toHaveLength(2);
      expect(models[0]?.id).toBe("model-1");
      expect(models[1]?.id).toBe("model-2");
    });
  });

  describe("supportsEmbedding", () => {
    it("should return false by default", () => {
      const config: ProviderConfig = {
        id: "embedding-test",
        name: "Embedding Test",
        baseUrl: "https://api.test.com",
        models: [{ id: "model-1", name: "Model 1", contextWindow: 4096 }],
      };

      const provider = new TestProvider(config);
      expect(provider.supportsEmbedding()).toBe(false);
    });
  });

  describe("embed", () => {
    it("should throw error by default", async () => {
      const config: ProviderConfig = {
        id: "embed-test",
        name: "Embed Test",
        baseUrl: "https://api.test.com",
        models: [{ id: "model-1", name: "Model 1", contextWindow: 4096 }],
      };

      const provider = new TestProvider(config);
      await expect(provider.embed(["text"])).rejects.toThrow("Embedding not supported");
    });
  });

  describe("chat", () => {
    it("should return chat response", async () => {
      const config: ProviderConfig = {
        id: "chat-test",
        name: "Chat Test",
        baseUrl: "https://api.test.com",
        models: [{ id: "chat-model", name: "Chat Model", contextWindow: 4096 }],
      };

      const provider = new TestProvider(config);
      const response = await provider.chat({
        model: "chat-model",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(response.id).toBe("test-id");
      expect(response.choices[0]?.message.content).toBe("Test response");
    });
  });

  describe("chatStream", () => {
    it("should yield stream chunks", async () => {
      const config: ProviderConfig = {
        id: "stream-test",
        name: "Stream Test",
        baseUrl: "https://api.test.com",
        models: [{ id: "stream-model", name: "Stream Model", contextWindow: 4096 }],
      };

      const provider = new TestProvider(config);
      const chunks: StreamChunk[] = [];

      for await (const chunk of provider.chatStream({
        model: "stream-model",
        messages: [{ role: "user", content: "Hello" }],
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual({ type: "content", content: "Test " });
      expect(chunks[1]).toEqual({ type: "content", content: "response" });
      expect(chunks[2]).toEqual({ type: "done", finish_reason: "stop" });
    });
  });
});
