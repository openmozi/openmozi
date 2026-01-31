/**
 * 工具注册表测试
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import {
  registerTool,
  registerTools,
  getTool,
  getAllTools,
  clearTools,
  filterToolsByPolicy,
  toolsToOpenAIFunctions,
} from "../src/tools/registry.js";
import type { Tool, ToolResult } from "../src/tools/types.js";

// Mock logger
vi.mock("../src/utils/logger.js", () => ({
  getChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// 创建测试工具
function createTestTool(name: string, description = "Test tool"): Tool {
  return {
    name,
    description,
    parameters: Type.Object({
      input: Type.String(),
    }),
    execute: async (): Promise<ToolResult> => ({
      content: [{ type: "text", text: "result" }],
    }),
  };
}

describe("tools/registry", () => {
  beforeEach(() => {
    clearTools();
  });

  describe("registerTool", () => {
    it("should register a tool", () => {
      const tool = createTestTool("test_tool");
      registerTool(tool);

      expect(getTool("test_tool")).toBe(tool);
    });

    it("should register tools case-insensitively", () => {
      const tool = createTestTool("Test_Tool");
      registerTool(tool);

      expect(getTool("test_tool")).toBe(tool);
      expect(getTool("TEST_TOOL")).toBe(tool);
    });

    it("should overwrite existing tool with same name", () => {
      const tool1 = createTestTool("test", "First");
      const tool2 = createTestTool("test", "Second");

      registerTool(tool1);
      registerTool(tool2);

      expect(getTool("test")?.description).toBe("Second");
    });
  });

  describe("registerTools", () => {
    it("should register multiple tools", () => {
      const tools = [
        createTestTool("tool1"),
        createTestTool("tool2"),
        createTestTool("tool3"),
      ];

      registerTools(tools);

      expect(getAllTools()).toHaveLength(3);
      expect(getTool("tool1")).toBeDefined();
      expect(getTool("tool2")).toBeDefined();
      expect(getTool("tool3")).toBeDefined();
    });
  });

  describe("getTool", () => {
    it("should return undefined for unknown tool", () => {
      expect(getTool("unknown")).toBeUndefined();
    });
  });

  describe("getAllTools", () => {
    it("should return empty array when no tools registered", () => {
      expect(getAllTools()).toEqual([]);
    });

    it("should return all registered tools", () => {
      registerTool(createTestTool("tool1"));
      registerTool(createTestTool("tool2"));

      expect(getAllTools()).toHaveLength(2);
    });
  });

  describe("clearTools", () => {
    it("should clear all registered tools", () => {
      registerTool(createTestTool("tool1"));
      registerTool(createTestTool("tool2"));

      clearTools();

      expect(getAllTools()).toEqual([]);
    });
  });

  describe("filterToolsByPolicy", () => {
    beforeEach(() => {
      registerTools([
        createTestTool("read_file"),
        createTestTool("write_file"),
        createTestTool("web_search"),
        createTestTool("web_fetch"),
        createTestTool("bash"),
      ]);
    });

    it("should return all tools when no policy", () => {
      const tools = getAllTools();
      const filtered = filterToolsByPolicy(tools);

      expect(filtered).toHaveLength(5);
    });

    it("should filter by allow list", () => {
      const tools = getAllTools();
      const filtered = filterToolsByPolicy(tools, {
        allow: ["read_file", "write_file"],
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map((t) => t.name)).toContain("read_file");
      expect(filtered.map((t) => t.name)).toContain("write_file");
    });

    it("should filter by deny list", () => {
      const tools = getAllTools();
      const filtered = filterToolsByPolicy(tools, {
        deny: ["bash"],
      });

      expect(filtered).toHaveLength(4);
      expect(filtered.map((t) => t.name)).not.toContain("bash");
    });

    it("should prioritize deny over allow", () => {
      const tools = getAllTools();
      const filtered = filterToolsByPolicy(tools, {
        allow: ["*"],
        deny: ["bash"],
      });

      expect(filtered.map((t) => t.name)).not.toContain("bash");
    });

    it("should support wildcard patterns", () => {
      const tools = getAllTools();
      const filtered = filterToolsByPolicy(tools, {
        allow: ["web_*"],
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map((t) => t.name)).toContain("web_search");
      expect(filtered.map((t) => t.name)).toContain("web_fetch");
    });

    it("should support tool groups", () => {
      const tools = getAllTools();
      const filtered = filterToolsByPolicy(tools, {
        allow: ["group:web"],
      });

      expect(filtered).toHaveLength(2);
      expect(filtered.map((t) => t.name)).toContain("web_search");
      expect(filtered.map((t) => t.name)).toContain("web_fetch");
    });

    it("should handle case-insensitive matching", () => {
      const tools = getAllTools();
      const filtered = filterToolsByPolicy(tools, {
        allow: ["READ_FILE", "WRITE_FILE"],
      });

      expect(filtered).toHaveLength(2);
    });
  });

  describe("toolsToOpenAIFunctions", () => {
    it("should convert tools to OpenAI function format", () => {
      const tool = createTestTool("test_tool", "A test tool");
      const functions = toolsToOpenAIFunctions([tool]);

      expect(functions).toHaveLength(1);
      expect(functions[0]).toEqual({
        type: "function",
        function: {
          name: "test_tool",
          description: "A test tool",
          parameters: tool.parameters,
        },
      });
    });

    it("should convert multiple tools", () => {
      const tools = [
        createTestTool("tool1", "First tool"),
        createTestTool("tool2", "Second tool"),
      ];

      const functions = toolsToOpenAIFunctions(tools);

      expect(functions).toHaveLength(2);
      expect(functions[0].function.name).toBe("tool1");
      expect(functions[1].function.name).toBe("tool2");
    });
  });
});
