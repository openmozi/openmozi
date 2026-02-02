/**
 * 模型故障转移测试
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

// Mock delay 使测试更快
vi.mock("../src/utils/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/utils/index.js")>();
  return {
    ...original,
    delay: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  isInCooldown,
  setCooldown,
  clearCooldown,
  clearAllCooldowns,
  runWithModelFallback,
  runWithRetry,
} from "../src/agents/model-fallback.js";
import {
  FailoverError,
  isFailoverError,
  isTimeoutError,
  resolveFailoverReasonFromError,
  describeFailoverError,
  coerceToFailoverError,
  resolveFailoverStatus,
} from "../src/agents/failover-error.js";

describe("failover-error", () => {
  describe("FailoverError", () => {
    it("should create error with all properties", () => {
      const error = new FailoverError("Test error", {
        reason: "rate_limit",
        provider: "test-provider",
        model: "test-model",
        status: 429,
        code: "RATE_LIMITED",
      });

      expect(error.message).toBe("Test error");
      expect(error.name).toBe("FailoverError");
      expect(error.reason).toBe("rate_limit");
      expect(error.provider).toBe("test-provider");
      expect(error.model).toBe("test-model");
      expect(error.status).toBe(429);
      expect(error.code).toBe("RATE_LIMITED");
    });

    it("should create error with minimal properties", () => {
      const error = new FailoverError("Minimal error", {
        reason: "unknown",
      });

      expect(error.message).toBe("Minimal error");
      expect(error.reason).toBe("unknown");
      expect(error.provider).toBeUndefined();
      expect(error.model).toBeUndefined();
    });

    it("should support cause", () => {
      const cause = new Error("Original error");
      const error = new FailoverError("Wrapped error", {
        reason: "timeout",
        cause,
      });

      expect(error.cause).toBe(cause);
    });
  });

  describe("isFailoverError", () => {
    it("should return true for FailoverError", () => {
      const error = new FailoverError("Test", { reason: "billing" });
      expect(isFailoverError(error)).toBe(true);
    });

    it("should return false for regular Error", () => {
      const error = new Error("Regular error");
      expect(isFailoverError(error)).toBe(false);
    });

    it("should return false for non-error objects", () => {
      expect(isFailoverError("string")).toBe(false);
      expect(isFailoverError(null)).toBe(false);
      expect(isFailoverError(undefined)).toBe(false);
      expect(isFailoverError({})).toBe(false);
    });
  });

  describe("isTimeoutError", () => {
    it("should detect TimeoutError by name", () => {
      const error = new Error("Something");
      (error as Error & { name: string }).name = "TimeoutError";
      expect(isTimeoutError(error)).toBe(true);
    });

    it("should detect timeout in message", () => {
      expect(isTimeoutError(new Error("Connection timeout"))).toBe(true);
      expect(isTimeoutError(new Error("Request timed out"))).toBe(true);
      expect(isTimeoutError(new Error("Deadline exceeded"))).toBe(true);
    });

    it("should detect AbortError with timeout message", () => {
      const error = new Error("The request was aborted");
      (error as Error & { name: string }).name = "AbortError";
      expect(isTimeoutError(error)).toBe(true);
    });

    it("should return false for regular errors", () => {
      expect(isTimeoutError(new Error("Regular error"))).toBe(false);
      expect(isTimeoutError(new Error("Network failed"))).toBe(false);
    });

    it("should check cause recursively", () => {
      const cause = new Error("Connection timeout");
      const error = new Error("Wrapper", { cause });
      expect(isTimeoutError(error)).toBe(true);
    });

    it("should handle non-error inputs", () => {
      expect(isTimeoutError(null)).toBe(false);
      expect(isTimeoutError(undefined)).toBe(false);
      expect(isTimeoutError("timeout")).toBe(false);
    });
  });

  describe("resolveFailoverReasonFromError", () => {
    it("should return reason from FailoverError", () => {
      const error = new FailoverError("Test", { reason: "billing" });
      expect(resolveFailoverReasonFromError(error)).toBe("billing");
    });

    it("should detect billing from status 402", () => {
      const error = { status: 402, message: "Payment required" };
      expect(resolveFailoverReasonFromError(error)).toBe("billing");
    });

    it("should detect rate_limit from status 429", () => {
      const error = { status: 429, message: "Too many requests" };
      expect(resolveFailoverReasonFromError(error)).toBe("rate_limit");
    });

    it("should detect auth from status 401", () => {
      const error = { status: 401, message: "Unauthorized" };
      expect(resolveFailoverReasonFromError(error)).toBe("auth");
    });

    it("should detect auth from status 403", () => {
      const error = { status: 403, message: "Forbidden" };
      expect(resolveFailoverReasonFromError(error)).toBe("auth");
    });

    it("should detect timeout from status 408", () => {
      const error = { status: 408, message: "Request timeout" };
      expect(resolveFailoverReasonFromError(error)).toBe("timeout");
    });

    it("should detect format from status 400", () => {
      const error = { status: 400, message: "Bad request" };
      expect(resolveFailoverReasonFromError(error)).toBe("format");
    });

    it("should detect unavailable from status 503", () => {
      const error = { status: 503, message: "Service unavailable" };
      expect(resolveFailoverReasonFromError(error)).toBe("unavailable");
    });

    it("should detect timeout from error code", () => {
      const error = { code: "ETIMEDOUT", message: "Connection timed out" };
      expect(resolveFailoverReasonFromError(error)).toBe("timeout");
    });

    it("should detect from message content", () => {
      expect(resolveFailoverReasonFromError(new Error("Billing quota exceeded"))).toBe("billing");
      expect(resolveFailoverReasonFromError(new Error("Rate limit reached"))).toBe("rate_limit");
      expect(resolveFailoverReasonFromError(new Error("Invalid API key"))).toBe("auth");
      expect(resolveFailoverReasonFromError(new Error("Service overloaded"))).toBe("unavailable");
    });

    it("should return null for unknown errors", () => {
      expect(resolveFailoverReasonFromError(new Error("Something went wrong"))).toBeNull();
    });
  });

  describe("describeFailoverError", () => {
    it("should describe FailoverError", () => {
      const error = new FailoverError("Test error", {
        reason: "billing",
        status: 402,
        code: "BILLING_ERROR",
      });

      const desc = describeFailoverError(error);
      expect(desc.message).toBe("Test error");
      expect(desc.reason).toBe("billing");
      expect(desc.status).toBe(402);
      expect(desc.code).toBe("BILLING_ERROR");
    });

    it("should describe regular error", () => {
      const error = { status: 429, message: "Too many requests", code: "RATE_LIMITED" };
      const desc = describeFailoverError(error);

      expect(desc.message).toBe("Too many requests");
      expect(desc.reason).toBe("rate_limit");
      expect(desc.status).toBe(429);
      expect(desc.code).toBe("RATE_LIMITED");
    });

    it("should handle string error", () => {
      const desc = describeFailoverError("String error");
      expect(desc.message).toBe("String error");
    });
  });

  describe("coerceToFailoverError", () => {
    it("should return existing FailoverError", () => {
      const error = new FailoverError("Test", { reason: "auth" });
      expect(coerceToFailoverError(error)).toBe(error);
    });

    it("should convert recognizable error", () => {
      const error = { status: 429, message: "Rate limited" };
      const converted = coerceToFailoverError(error, { provider: "test" });

      expect(converted).toBeInstanceOf(FailoverError);
      expect(converted?.reason).toBe("rate_limit");
      expect(converted?.provider).toBe("test");
    });

    it("should return null for unknown error", () => {
      const error = new Error("Unknown error");
      expect(coerceToFailoverError(error)).toBeNull();
    });

    it("should include context", () => {
      const error = { status: 401, message: "Unauthorized" };
      const converted = coerceToFailoverError(error, {
        provider: "my-provider",
        model: "my-model",
      });

      expect(converted?.provider).toBe("my-provider");
      expect(converted?.model).toBe("my-model");
    });
  });

  describe("resolveFailoverStatus", () => {
    it("should return correct status for each reason", () => {
      expect(resolveFailoverStatus("billing")).toBe(402);
      expect(resolveFailoverStatus("rate_limit")).toBe(429);
      expect(resolveFailoverStatus("auth")).toBe(401);
      expect(resolveFailoverStatus("timeout")).toBe(408);
      expect(resolveFailoverStatus("format")).toBe(400);
      expect(resolveFailoverStatus("unavailable")).toBe(503);
      expect(resolveFailoverStatus("unknown")).toBeUndefined();
    });
  });
});

describe("model-fallback", () => {
  beforeEach(() => {
    clearAllCooldowns();
  });

  afterEach(() => {
    clearAllCooldowns();
  });

  describe("cooldown management", () => {
    describe("isInCooldown", () => {
      it("should return false when no cooldown set", () => {
        expect(isInCooldown("provider-1")).toBe(false);
        expect(isInCooldown("provider-1", "model-1")).toBe(false);
      });

      it("should return true after setCooldown", () => {
        setCooldown("provider-2", "rate_limit");
        expect(isInCooldown("provider-2")).toBe(true);
      });

      it("should handle model-specific cooldown", () => {
        setCooldown("provider-3", "rate_limit", "model-a");
        expect(isInCooldown("provider-3", "model-a")).toBe(true);
        expect(isInCooldown("provider-3", "model-b")).toBe(false);
        expect(isInCooldown("provider-3")).toBe(false);
      });
    });

    describe("clearCooldown", () => {
      it("should clear specific cooldown", () => {
        setCooldown("provider-4", "rate_limit");
        expect(isInCooldown("provider-4")).toBe(true);

        clearCooldown("provider-4");
        expect(isInCooldown("provider-4")).toBe(false);
      });

      it("should clear model-specific cooldown", () => {
        setCooldown("provider-5", "rate_limit", "model-x");
        expect(isInCooldown("provider-5", "model-x")).toBe(true);

        clearCooldown("provider-5", "model-x");
        expect(isInCooldown("provider-5", "model-x")).toBe(false);
      });
    });

    describe("clearAllCooldowns", () => {
      it("should clear all cooldowns", () => {
        setCooldown("p1", "rate_limit");
        setCooldown("p2", "billing");
        setCooldown("p3", "timeout", "m1");

        expect(isInCooldown("p1")).toBe(true);
        expect(isInCooldown("p2")).toBe(true);
        expect(isInCooldown("p3", "m1")).toBe(true);

        clearAllCooldowns();

        expect(isInCooldown("p1")).toBe(false);
        expect(isInCooldown("p2")).toBe(false);
        expect(isInCooldown("p3", "m1")).toBe(false);
      });
    });

    describe("setCooldown duration", () => {
      it("should not set cooldown for format reason (0 duration)", () => {
        setCooldown("provider-6", "format");
        expect(isInCooldown("provider-6")).toBe(false);
      });
    });
  });

  describe("runWithRetry", () => {
    it("should return result on first success", async () => {
      const fn = vi.fn().mockResolvedValue("success");
      const result = await runWithRetry(fn);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry on failure", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new FailoverError("fail", { reason: "rate_limit" }))
        .mockResolvedValue("success");

      const result = await runWithRetry(fn, { maxRetries: 3 });

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should call onError callback", async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error("first fail"))
        .mockResolvedValue("success");
      const onError = vi.fn();

      await runWithRetry(fn, { maxRetries: 3, onError });

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(expect.any(Error), 1);
    });

    it("should throw after max retries", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("always fail"));

      await expect(runWithRetry(fn, { maxRetries: 2 })).rejects.toThrow("always fail");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should rethrow AbortError immediately", async () => {
      const abortError = new Error("Aborted");
      abortError.name = "AbortError";

      const fn = vi.fn().mockRejectedValue(abortError);

      await expect(runWithRetry(fn, { maxRetries: 3 })).rejects.toThrow("Aborted");
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
