/**
 * 上下文压缩测试
 */

import { describe, it, expect, vi } from "vitest";
import {
  estimateTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  splitMessagesByTokenShare,
  chunkMessagesByMaxTokens,
  computeAdaptiveChunkRatio,
  pruneHistoryForContextShare,
  limitHistoryTurns,
} from "../src/agents/compaction.js";
import type { ChatMessage } from "../src/types/index.js";

// Mock logger
vi.mock("../src/utils/logger.js", () => ({
  getChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock providers
vi.mock("../src/providers/index.js", () => ({
  getProvider: () => null,
  findProviderForModel: () => null,
}));

describe("agents/compaction", () => {
  describe("estimateTokens", () => {
    it("should return 0 for empty string", () => {
      expect(estimateTokens("")).toBe(0);
    });

    it("should estimate tokens for English text", () => {
      // 约 4 字符/token
      const text = "Hello world, this is a test."; // 28 字符
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(5);
      expect(tokens).toBeLessThan(15);
    });

    it("should estimate tokens for Chinese text", () => {
      // 约 1.5 字符/token
      const text = "你好世界，这是一个测试。"; // 12 中文字符
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(6);
      expect(tokens).toBeLessThan(12);
    });

    it("should handle mixed language text", () => {
      const text = "Hello 你好 World 世界";
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe("estimateMessageTokens", () => {
    it("should estimate tokens for string content", () => {
      const message: ChatMessage = {
        role: "user",
        content: "Hello world",
      };
      const tokens = estimateMessageTokens(message);
      // 包含约 4 tokens 的角色开销
      expect(tokens).toBeGreaterThan(4);
    });

    it("should handle array content", () => {
      const message: ChatMessage = {
        role: "user",
        content: [
          { type: "text", text: "Hello" },
          { type: "image", url: "http://example.com/image.png" },
        ],
      };
      const tokens = estimateMessageTokens(message);
      expect(tokens).toBeGreaterThan(4);
    });

    it("should handle empty content", () => {
      const message: ChatMessage = {
        role: "user",
        content: "",
      };
      const tokens = estimateMessageTokens(message);
      // 只有角色开销
      expect(tokens).toBe(4);
    });
  });

  describe("estimateMessagesTokens", () => {
    it("should sum tokens for all messages", () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
        { role: "user", content: "How are you?" },
      ];
      const tokens = estimateMessagesTokens(messages);
      expect(tokens).toBeGreaterThan(12); // 至少 3 * 4 角色开销
    });

    it("should return 0 for empty array", () => {
      expect(estimateMessagesTokens([])).toBe(0);
    });
  });

  describe("splitMessagesByTokenShare", () => {
    it("should return empty array for empty input", () => {
      expect(splitMessagesByTokenShare([])).toEqual([]);
    });

    it("should return single chunk for single message", () => {
      const messages: ChatMessage[] = [{ role: "user", content: "Hello" }];
      const chunks = splitMessagesByTokenShare(messages, 2);
      expect(chunks).toHaveLength(1);
    });

    it("should split messages into parts", () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "Message 1 with some content" },
        { role: "assistant", content: "Response 1 with some content" },
        { role: "user", content: "Message 2 with some content" },
        { role: "assistant", content: "Response 2 with some content" },
      ];
      const chunks = splitMessagesByTokenShare(messages, 2);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks.length).toBeLessThanOrEqual(2);
    });

    it("should return all messages when parts is 1", () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];
      const chunks = splitMessagesByTokenShare(messages, 1);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toHaveLength(2);
    });
  });

  describe("chunkMessagesByMaxTokens", () => {
    it("should return empty array for empty input", () => {
      expect(chunkMessagesByMaxTokens([], 100)).toEqual([]);
    });

    it("should create single chunk when under limit", () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ];
      const chunks = chunkMessagesByMaxTokens(messages, 1000);
      expect(chunks).toHaveLength(1);
    });

    it("should split messages when over limit", () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "A".repeat(100) },
        { role: "assistant", content: "B".repeat(100) },
        { role: "user", content: "C".repeat(100) },
        { role: "assistant", content: "D".repeat(100) },
      ];
      const chunks = chunkMessagesByMaxTokens(messages, 50);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it("should handle oversized single messages", () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "A".repeat(1000) }, // 超大消息
        { role: "assistant", content: "Small" },
      ];
      const chunks = chunkMessagesByMaxTokens(messages, 50);
      expect(chunks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("computeAdaptiveChunkRatio", () => {
    it("should return base ratio for empty messages", () => {
      expect(computeAdaptiveChunkRatio([], 32000)).toBe(0.4);
    });

    it("should return base ratio for small messages", () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "Short message" },
      ];
      const ratio = computeAdaptiveChunkRatio(messages, 32000);
      expect(ratio).toBe(0.4);
    });

    it("should reduce ratio for large messages", () => {
      // 需要平均 token 比例 > 0.1 才会触发减少
      // 使用更小的 contextWindow 来测试
      const messages: ChatMessage[] = [
        { role: "user", content: "A".repeat(5000) },
      ];
      const ratio = computeAdaptiveChunkRatio(messages, 5000);
      expect(ratio).toBeLessThan(0.4);
      expect(ratio).toBeGreaterThanOrEqual(0.15);
    });
  });

  describe("pruneHistoryForContextShare", () => {
    it("should keep all messages when under budget", () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];
      const result = pruneHistoryForContextShare({
        messages,
        maxContextTokens: 10000,
      });
      expect(result.messages).toHaveLength(2);
      expect(result.droppedMessages).toBe(0);
    });

    it("should prune messages when over budget", () => {
      const messages: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i} with some additional content to increase token count`,
      })) as ChatMessage[];

      const result = pruneHistoryForContextShare({
        messages,
        maxContextTokens: 100,
        maxHistoryShare: 0.5,
      });

      expect(result.messages.length).toBeLessThan(20);
      expect(result.droppedMessages).toBeGreaterThan(0);
    });

    it("should return stats about dropped messages", () => {
      const messages: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i} content`,
      })) as ChatMessage[];

      const result = pruneHistoryForContextShare({
        messages,
        maxContextTokens: 50,
        maxHistoryShare: 0.5,
      });

      expect(result.droppedMessages).toBeGreaterThanOrEqual(0);
      expect(result.droppedTokens).toBeGreaterThanOrEqual(0);
      expect(result.keptTokens).toBeGreaterThanOrEqual(0);
    });
  });

  describe("limitHistoryTurns", () => {
    it("should return empty array for empty input", () => {
      expect(limitHistoryTurns({ messages: [], maxTurns: 5 })).toEqual([]);
    });

    it("should preserve system messages by default", () => {
      const messages: ChatMessage[] = [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ];
      const result = limitHistoryTurns({ messages, maxTurns: 1 });
      expect(result.find((m) => m.role === "system")).toBeDefined();
    });

    it("should limit to specified number of turns", () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "Turn 1" },
        { role: "assistant", content: "Response 1" },
        { role: "user", content: "Turn 2" },
        { role: "assistant", content: "Response 2" },
        { role: "user", content: "Turn 3" },
        { role: "assistant", content: "Response 3" },
      ];
      const result = limitHistoryTurns({ messages, maxTurns: 2 });
      // 应该保留最后 2 轮
      expect(result.length).toBeLessThanOrEqual(4);
    });

    it("should keep most recent turns", () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "Old message" },
        { role: "assistant", content: "Old response" },
        { role: "user", content: "Recent message" },
        { role: "assistant", content: "Recent response" },
      ];
      const result = limitHistoryTurns({ messages, maxTurns: 1 });
      expect(result.some((m) => m.content === "Recent message")).toBe(true);
    });

    it("should respect preserveSystemMessage option", () => {
      const messages: ChatMessage[] = [
        { role: "system", content: "System prompt" },
        { role: "user", content: "Hello" },
      ];
      const result = limitHistoryTurns({
        messages,
        maxTurns: 1,
        preserveSystemMessage: false,
      });
      expect(result.find((m) => m.role === "system")).toBeUndefined();
    });
  });
});
