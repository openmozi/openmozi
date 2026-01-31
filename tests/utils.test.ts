/**
 * 工具函数测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateId,
  getEnvVar,
  requireEnvVar,
  delay,
  retry,
  truncate,
  safeJsonParse,
  deepMerge,
  computeHmacSha256,
  formatTimestamp,
  isEmpty,
  removeUndefined,
} from "../src/utils/index.js";

describe("utils", () => {
  describe("generateId", () => {
    it("should generate a random hex string", () => {
      const id = generateId();
      expect(id).toMatch(/^[a-f0-9]{16}$/);
    });

    it("should generate unique IDs", () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()));
      expect(ids.size).toBe(100);
    });

    it("should add prefix when provided", () => {
      const id = generateId("msg");
      expect(id).toMatch(/^msg_[a-f0-9]{16}$/);
    });
  });

  describe("getEnvVar", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should return environment variable value", () => {
      process.env.TEST_VAR = "test_value";
      expect(getEnvVar("TEST_VAR")).toBe("test_value");
    });

    it("should return undefined for missing variable", () => {
      delete process.env.TEST_VAR;
      expect(getEnvVar("TEST_VAR")).toBeUndefined();
    });

    it("should return default value for missing variable", () => {
      delete process.env.TEST_VAR;
      expect(getEnvVar("TEST_VAR", "default")).toBe("default");
    });
  });

  describe("requireEnvVar", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should return environment variable value", () => {
      process.env.TEST_VAR = "test_value";
      expect(requireEnvVar("TEST_VAR")).toBe("test_value");
    });

    it("should throw error for missing variable", () => {
      delete process.env.TEST_VAR;
      expect(() => requireEnvVar("TEST_VAR")).toThrow(
        "Missing required environment variable: TEST_VAR"
      );
    });
  });

  describe("delay", () => {
    it("should delay execution", async () => {
      const start = Date.now();
      await delay(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });
  });

  describe("retry", () => {
    it("should return result on first success", async () => {
      const fn = vi.fn().mockResolvedValue("success");
      const result = await retry(fn);
      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry on failure", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValue("success");

      const result = await retry(fn, { delayMs: 10 });
      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should throw after max retries", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("always fail"));

      await expect(retry(fn, { maxRetries: 2, delayMs: 10 })).rejects.toThrow(
        "always fail"
      );
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should call onRetry callback", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValue("success");
      const onRetry = vi.fn();

      await retry(fn, { delayMs: 10, onRetry });
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
    });

    it("should apply exponential backoff", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValue("success");

      const start = Date.now();
      await retry(fn, { delayMs: 20, backoff: true });
      const elapsed = Date.now() - start;

      // 第一次重试等 20ms，第二次等 40ms
      expect(elapsed).toBeGreaterThanOrEqual(50);
    });
  });

  describe("truncate", () => {
    it("should not truncate short strings", () => {
      expect(truncate("hello", 10)).toBe("hello");
    });

    it("should truncate long strings", () => {
      expect(truncate("hello world", 8)).toBe("hello...");
    });

    it("should use custom suffix", () => {
      expect(truncate("hello world", 8, "…")).toBe("hello w…");
    });

    it("should handle exact length", () => {
      expect(truncate("hello", 5)).toBe("hello");
    });
  });

  describe("safeJsonParse", () => {
    it("should parse valid JSON", () => {
      expect(safeJsonParse('{"a": 1}', {})).toEqual({ a: 1 });
    });

    it("should return default for invalid JSON", () => {
      expect(safeJsonParse("invalid", { default: true })).toEqual({
        default: true,
      });
    });

    it("should parse arrays", () => {
      expect(safeJsonParse("[1, 2, 3]", [])).toEqual([1, 2, 3]);
    });
  });

  describe("deepMerge", () => {
    it("should merge flat objects", () => {
      const result = deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 });
      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it("should merge nested objects", () => {
      const target = { a: { b: 1, c: 2 }, d: 3 };
      const source = { a: { c: 4, e: 5 } };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: { b: 1, c: 4, e: 5 }, d: 3 });
    });

    it("should not merge arrays", () => {
      const result = deepMerge({ a: [1, 2] }, { a: [3, 4] });
      expect(result).toEqual({ a: [3, 4] });
    });

    it("should handle undefined values", () => {
      const result = deepMerge({ a: 1, b: 2 }, { a: undefined, c: 3 });
      expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });
  });

  describe("computeHmacSha256", () => {
    it("should compute correct HMAC-SHA256 signature", () => {
      const signature = computeHmacSha256("secret", "data");
      // 验证是否为 base64 格式
      expect(signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
      // 验证确定性
      expect(computeHmacSha256("secret", "data")).toBe(signature);
    });

    it("should produce different signatures for different data", () => {
      const sig1 = computeHmacSha256("secret", "data1");
      const sig2 = computeHmacSha256("secret", "data2");
      expect(sig1).not.toBe(sig2);
    });
  });

  describe("formatTimestamp", () => {
    it("should format timestamp to ISO string", () => {
      const ts = 1704067200000; // 2024-01-01T00:00:00.000Z
      expect(formatTimestamp(ts)).toBe("2024-01-01T00:00:00.000Z");
    });
  });

  describe("isEmpty", () => {
    it("should return true for empty object", () => {
      expect(isEmpty({})).toBe(true);
    });

    it("should return false for non-empty object", () => {
      expect(isEmpty({ a: 1 })).toBe(false);
    });
  });

  describe("removeUndefined", () => {
    it("should remove undefined values", () => {
      const obj = { a: 1, b: undefined, c: 3 };
      expect(removeUndefined(obj)).toEqual({ a: 1, c: 3 });
    });

    it("should keep null values", () => {
      const obj = { a: 1, b: null, c: undefined };
      expect(removeUndefined(obj as Record<string, unknown>)).toEqual({ a: 1, b: null });
    });

    it("should return empty object for all undefined", () => {
      const obj = { a: undefined, b: undefined };
      expect(removeUndefined(obj)).toEqual({});
    });
  });
});
