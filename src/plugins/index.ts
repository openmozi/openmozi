/**
 * 插件系统
 */

import type { Tool } from "../tools/types.js";
import type { MoziConfig, ProviderId } from "../types/index.js";
import { registerTool, registerTools } from "../tools/registry.js";
import { registerHook, type HookEventType, type HookHandler } from "../hooks/index.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("plugins");

// ============== 插件类型 ==============

/** 插件元数据 */
export interface PluginMeta {
  /** 插件 ID */
  id: string;
  /** 插件名称 */
  name: string;
  /** 插件版本 */
  version: string;
  /** 插件描述 */
  description?: string;
  /** 作者 */
  author?: string;
}

/** 插件 API */
export interface PluginApi {
  /** 插件元数据 */
  meta: PluginMeta;
  /** 配置 */
  config: MoziConfig;
  /** 注册工具 */
  registerTool: (tool: Tool) => void;
  /** 注册 Hook */
  registerHook: <T extends HookEventType>(eventType: T, handler: HookHandler) => () => void;
  /** 获取日志器 */
  getLogger: (name?: string) => ReturnType<typeof getChildLogger>;
}

/** 插件定义 */
export interface PluginDefinition {
  /** 插件元数据 */
  meta: PluginMeta;
  /** 初始化函数 */
  initialize: (api: PluginApi) => void | Promise<void>;
  /** 清理函数 */
  cleanup?: () => void | Promise<void>;
}

/** 已加载的插件 */
interface LoadedPlugin {
  definition: PluginDefinition;
  unsubscribers: Array<() => void>;
}

// ============== 插件管理 ==============

/** 插件注册表 */
const pluginRegistry = new Map<string, LoadedPlugin>();

/** 注册插件 */
export async function registerPlugin(
  definition: PluginDefinition,
  config: MoziConfig
): Promise<void> {
  const { meta } = definition;

  // 检查是否已注册
  if (pluginRegistry.has(meta.id)) {
    logger.warn({ pluginId: meta.id }, "Plugin already registered, skipping");
    return;
  }

  logger.info({ pluginId: meta.id, name: meta.name, version: meta.version }, "Registering plugin");

  const unsubscribers: Array<() => void> = [];

  // 创建插件 API
  const api: PluginApi = {
    meta,
    config,
    registerTool: (tool) => {
      registerTool(tool);
      logger.debug({ pluginId: meta.id, toolName: tool.name }, "Plugin registered tool");
    },
    registerHook: (eventType, handler) => {
      const unsubscribe = registerHook(eventType, handler);
      unsubscribers.push(unsubscribe);
      logger.debug({ pluginId: meta.id, eventType }, "Plugin registered hook");
      return unsubscribe;
    },
    getLogger: (name) => getChildLogger(name ?? `plugin:${meta.id}`),
  };

  // 初始化插件
  try {
    await definition.initialize(api);
    pluginRegistry.set(meta.id, { definition, unsubscribers });
    logger.info({ pluginId: meta.id }, "Plugin registered successfully");
  } catch (error) {
    logger.error({ pluginId: meta.id, error }, "Failed to initialize plugin");
    throw error;
  }
}

/** 注销插件 */
export async function unregisterPlugin(pluginId: string): Promise<void> {
  const plugin = pluginRegistry.get(pluginId);
  if (!plugin) {
    logger.warn({ pluginId }, "Plugin not found");
    return;
  }

  logger.info({ pluginId }, "Unregistering plugin");

  // 调用清理函数
  if (plugin.definition.cleanup) {
    try {
      await plugin.definition.cleanup();
    } catch (error) {
      logger.error({ pluginId, error }, "Plugin cleanup error");
    }
  }

  // 取消所有 Hook 订阅
  for (const unsubscribe of plugin.unsubscribers) {
    unsubscribe();
  }

  pluginRegistry.delete(pluginId);
  logger.info({ pluginId }, "Plugin unregistered");
}

/** 获取已加载的插件 */
export function getLoadedPlugins(): PluginMeta[] {
  return Array.from(pluginRegistry.values()).map((p) => p.definition.meta);
}

/** 检查插件是否已加载 */
export function isPluginLoaded(pluginId: string): boolean {
  return pluginRegistry.has(pluginId);
}

/** 注销所有插件 */
export async function unregisterAllPlugins(): Promise<void> {
  const pluginIds = Array.from(pluginRegistry.keys());
  for (const pluginId of pluginIds) {
    await unregisterPlugin(pluginId);
  }
}

// ============== 便捷创建函数 ==============

/** 创建插件 */
export function definePlugin(
  meta: PluginMeta,
  initialize: PluginDefinition["initialize"],
  cleanup?: PluginDefinition["cleanup"]
): PluginDefinition {
  return { meta, initialize, cleanup };
}

/** 创建简单插件 (只包含工具) */
export function defineToolPlugin(
  meta: PluginMeta,
  tools: Tool[]
): PluginDefinition {
  return {
    meta,
    initialize: (api) => {
      for (const tool of tools) {
        api.registerTool(tool);
      }
    },
  };
}
