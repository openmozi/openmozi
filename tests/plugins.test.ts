/**
 * 插件系统测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import type { Tool, ToolResult } from "../src/tools/types.js";
import type { PluginDefinition, PluginMeta, PluginApi, PluginEnableConfig, PluginCandidate } from "../src/plugins/index.js";

// Mock logger
vi.mock("../src/utils/logger.js", () => ({
  getChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock tools/registry
vi.mock("../src/tools/registry.js", () => ({
  registerTool: vi.fn(),
  registerTools: vi.fn(),
}));

// Mock hooks
vi.mock("../src/hooks/index.js", () => ({
  registerHook: vi.fn(() => () => {}),
}));

// 因为模块有副作用，需要动态导入
async function getPluginModule() {
  return await import("../src/plugins/index.js");
}

describe("plugins/index", () => {
  let pluginModule: Awaited<ReturnType<typeof getPluginModule>>;

  beforeEach(async () => {
    vi.resetModules();
    pluginModule = await getPluginModule();
  });

  afterEach(async () => {
    if (pluginModule) {
      await pluginModule.unregisterAllPlugins();
    }
  });

  describe("registerPlugin", () => {
    it("should register a plugin", async () => {
      const definition: PluginDefinition = {
        meta: {
          id: "test-plugin",
          name: "Test Plugin",
          version: "1.0.0",
        },
      };

      await pluginModule.registerPlugin(definition, {} as any);

      expect(pluginModule.isPluginLoaded("test-plugin")).toBe(true);
    });

    it("should call register function", async () => {
      const registerFn = vi.fn();
      const definition: PluginDefinition = {
        meta: {
          id: "test-plugin",
          name: "Test Plugin",
          version: "1.0.0",
        },
        register: registerFn,
      };

      await pluginModule.registerPlugin(definition, {} as any);

      expect(registerFn).toHaveBeenCalledTimes(1);
      expect(registerFn).toHaveBeenCalledWith(expect.objectContaining({
        id: "test-plugin",
        meta: definition.meta,
      }));
    });

    it("should skip duplicate registration", async () => {
      const definition: PluginDefinition = {
        meta: {
          id: "test-plugin",
          name: "Test Plugin",
          version: "1.0.0",
        },
      };

      await pluginModule.registerPlugin(definition, {} as any);
      await pluginModule.registerPlugin(definition, {} as any);

      expect(pluginModule.getLoadedPlugins()).toHaveLength(1);
    });
  });

  describe("unregisterPlugin", () => {
    it("should unregister a plugin", async () => {
      const definition: PluginDefinition = {
        meta: {
          id: "test-plugin",
          name: "Test Plugin",
          version: "1.0.0",
        },
      };

      await pluginModule.registerPlugin(definition, {} as any);
      await pluginModule.unregisterPlugin("test-plugin");

      expect(pluginModule.isPluginLoaded("test-plugin")).toBe(false);
    });

    it("should call cleanup function", async () => {
      const cleanupFn = vi.fn();
      const definition: PluginDefinition = {
        meta: {
          id: "test-plugin",
          name: "Test Plugin",
          version: "1.0.0",
        },
        cleanup: cleanupFn,
      };

      await pluginModule.registerPlugin(definition, {} as any);
      await pluginModule.unregisterPlugin("test-plugin");

      expect(cleanupFn).toHaveBeenCalledTimes(1);
    });

    it("should unsubscribe hooks", async () => {
      const unsubscribe = vi.fn();
      const { registerHook } = await import("../src/hooks/index.js");
      (registerHook as any).mockReturnValue(unsubscribe);

      const definition: PluginDefinition = {
        meta: {
          id: "test-plugin",
          name: "Test Plugin",
          version: "1.0.0",
        },
        register: (api) => {
          api.registerHook("message_received", () => {});
        },
      };

      await pluginModule.registerPlugin(definition, {} as any);
      await pluginModule.unregisterPlugin("test-plugin");

      expect(unsubscribe).toHaveBeenCalled();
    });
  });

  describe("getLoadedPlugins", () => {
    it("should return all loaded plugin metas", async () => {
      await pluginModule.registerPlugin({
        meta: { id: "plugin-1", name: "Plugin 1", version: "1.0.0" },
      }, {} as any);
      await pluginModule.registerPlugin({
        meta: { id: "plugin-2", name: "Plugin 2", version: "2.0.0" },
      }, {} as any);

      const plugins = pluginModule.getLoadedPlugins();

      expect(plugins).toHaveLength(2);
      expect(plugins.map(p => p.id)).toContain("plugin-1");
      expect(plugins.map(p => p.id)).toContain("plugin-2");
    });
  });

  describe("getPluginDetails", () => {
    it("should return plugin details", async () => {
      const definition: PluginDefinition = {
        meta: { id: "test-plugin", name: "Test Plugin", version: "1.0.0" },
      };

      await pluginModule.registerPlugin(definition, {} as any, {
        origin: "workspace",
        pluginConfig: { foo: "bar" },
      });

      const details = pluginModule.getPluginDetails("test-plugin");

      expect(details).toBeDefined();
      expect(details?.id).toBe("test-plugin");
      expect(details?.origin).toBe("workspace");
      expect(details?.pluginConfig).toEqual({ foo: "bar" });
      expect(details?.activated).toBe(false);
    });

    it("should return undefined for unknown plugin", () => {
      const details = pluginModule.getPluginDetails("unknown");
      expect(details).toBeUndefined();
    });
  });

  describe("definePlugin", () => {
    it("should create a plugin definition", () => {
      const meta: PluginMeta = {
        id: "test",
        name: "Test",
        version: "1.0.0",
      };
      const init = vi.fn();

      const definition = pluginModule.definePlugin(meta, init);

      expect(definition.meta).toBe(meta);
      expect(definition.register).toBe(init);
    });
  });

  describe("defineToolPlugin", () => {
    it("should create a plugin that registers tools", async () => {
      const { registerTools } = await import("../src/tools/registry.js");
      const meta: PluginMeta = {
        id: "tool-plugin",
        name: "Tool Plugin",
        version: "1.0.0",
      };
      const tools: Tool[] = [
        {
          name: "test_tool",
          description: "Test tool",
          parameters: Type.Object({}),
          execute: async () => ({ content: [{ type: "text", text: "result" }] }),
        },
      ];

      const definition = pluginModule.defineToolPlugin(meta, tools);
      await pluginModule.registerPlugin(definition, {} as any);

      expect(registerTools).toHaveBeenCalledWith(tools);
    });
  });
});

describe("plugins/discovery (types)", () => {
  it("should have correct PluginCandidate structure", () => {
    const candidate: PluginCandidate = {
      id: "test-plugin",
      origin: "workspace",
      entryPath: "/path/to/plugin/index.ts",
      directory: "/path/to/plugin",
      manifest: {
        id: "test-plugin",
        name: "Test Plugin",
        version: "1.0.0",
      },
    };

    expect(candidate.id).toBe("test-plugin");
    expect(candidate.origin).toBe("workspace");
    expect(candidate.manifest?.name).toBe("Test Plugin");
  });
});

describe("plugins/loader (types)", () => {
  it("should have correct PluginEnableConfig structure", () => {
    const config: PluginEnableConfig = {
      enabled: true,
      allow: ["plugin-1", "plugin-2"],
      deny: ["plugin-3"],
      paths: ["/custom/plugins"],
      slots: {
        memory: "memory-core",
      },
      entries: {
        "plugin-1": {
          enabled: true,
          config: { setting: "value" },
        },
      },
    };

    expect(config.enabled).toBe(true);
    expect(config.allow).toContain("plugin-1");
    expect(config.deny).toContain("plugin-3");
    expect(config.slots?.memory).toBe("memory-core");
    expect(config.entries?.["plugin-1"]?.config?.setting).toBe("value");
  });
});
