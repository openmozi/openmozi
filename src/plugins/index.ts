/**
 * 插件系统 - 增强版
 *
 * 参考 moltbot 的 plugins 模块实现
 * 支持插件发现、加载、注册、生命周期管理、配置校验
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
  /** 插件类型 (用于排他性槽位) */
  kind?: string;
  /** 依赖的其他插件 */
  dependencies?: string[];
}

/** 插件配置 Schema (JSON Schema 格式) */
export interface PluginConfigSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/** 插件清单 (mozi.plugin.json) */
export interface PluginManifest {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  kind?: string;
  main?: string;
  configSchema?: PluginConfigSchema;
  dependencies?: string[];
  /** 提供的工具名称列表 */
  tools?: string[];
  /** 提供的通道 ID 列表 */
  channels?: string[];
}

/** 插件 API */
export interface PluginApi {
  /** 插件 ID */
  id: string;
  /** 插件元数据 */
  meta: PluginMeta;
  /** 全局配置 */
  config: MoziConfig;
  /** 插件自身配置 */
  pluginConfig?: Record<string, unknown>;
  /** 注册工具 */
  registerTool: (tool: Tool) => void;
  /** 批量注册工具 */
  registerTools: (tools: Tool[]) => void;
  /** 注册 Hook */
  registerHook: <T extends HookEventType>(eventType: T, handler: HookHandler) => () => void;
  /** 注册 HTTP 路由 (扩展用) */
  registerHttpRoute?: (route: HttpRoute) => void;
  /** 注册服务 (后台任务) */
  registerService?: (service: PluginService) => void;
  /** 获取日志器 */
  getLogger: (name?: string) => ReturnType<typeof getChildLogger>;
  /** 获取状态目录 */
  getStateDir: () => string;
}

/** HTTP 路由 */
export interface HttpRoute {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  handler: (req: unknown, res: unknown) => void | Promise<void>;
}

/** 插件服务 (后台任务) */
export interface PluginService {
  id: string;
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
}

/** 插件定义 */
export interface PluginDefinition {
  /** 插件元数据 */
  meta: PluginMeta;
  /** 配置 Schema */
  configSchema?: PluginConfigSchema;
  /** 注册阶段 (同步) */
  register?: (api: PluginApi) => void | Promise<void>;
  /** 激活阶段 (异步) */
  activate?: (api: PluginApi) => void | Promise<void>;
  /** 清理函数 */
  cleanup?: () => void | Promise<void>;
}

/** 插件模块 (可以是对象或函数) */
export type PluginModule =
  | PluginDefinition
  | ((api: PluginApi) => void | Promise<void>);

/** 插件来源 */
export type PluginOrigin = "bundled" | "global" | "workspace" | "config";

/** 发现的插件候选 */
export interface PluginCandidate {
  /** 插件 ID (来自清单或目录名) */
  id: string;
  /** 来源 */
  origin: PluginOrigin;
  /** 清单文件路径 */
  manifestPath?: string;
  /** 入口文件路径 */
  entryPath: string;
  /** 目录路径 */
  directory: string;
  /** 清单内容 */
  manifest?: PluginManifest;
}

/** 已加载的插件 */
export interface LoadedPlugin {
  /** 插件 ID */
  id: string;
  /** 来源 */
  origin: PluginOrigin;
  /** 定义 */
  definition: PluginDefinition;
  /** 配置 */
  pluginConfig?: Record<string, unknown>;
  /** 注册的 Hook 取消函数 */
  hookUnsubscribers: Array<() => void>;
  /** 注册的服务 */
  services: PluginService[];
  /** 是否已激活 */
  activated: boolean;
  /** 加载时间 */
  loadedAt: number;
}

/** 插件启用状态配置 */
export interface PluginEnableConfig {
  /** 是否全局启用插件 */
  enabled?: boolean;
  /** 允许列表 (如果设置，只加载这些) */
  allow?: string[];
  /** 拒绝列表 (这些永远不加载) */
  deny?: string[];
  /** 额外加载路径 */
  paths?: string[];
  /** 排他性槽位配置 */
  slots?: Record<string, string>;
  /** 各插件配置 */
  entries?: Record<string, {
    enabled?: boolean;
    config?: Record<string, unknown>;
  }>;
}

/** 插件生命周期事件 */
export type PluginLifecycleEvent =
  | { type: "discovered"; candidate: PluginCandidate }
  | { type: "loaded"; plugin: LoadedPlugin }
  | { type: "activated"; pluginId: string }
  | { type: "unloaded"; pluginId: string }
  | { type: "error"; pluginId: string; error: Error };

// ============== 插件管理 ==============

/** 插件注册表 */
const pluginRegistry = new Map<string, LoadedPlugin>();

/** 注册插件 */
export async function registerPlugin(
  definition: PluginDefinition,
  config: MoziConfig,
  options?: {
    origin?: PluginOrigin;
    pluginConfig?: Record<string, unknown>;
  }
): Promise<void> {
  const { meta } = definition;
  const origin = options?.origin ?? "config";

  // 检查是否已注册
  if (pluginRegistry.has(meta.id)) {
    logger.warn({ pluginId: meta.id }, "Plugin already registered, skipping");
    return;
  }

  logger.info({ pluginId: meta.id, name: meta.name, version: meta.version }, "Registering plugin");

  const hookUnsubscribers: Array<() => void> = [];
  const services: PluginService[] = [];

  // 创建插件 API
  const api: PluginApi = {
    id: meta.id,
    meta,
    config,
    pluginConfig: options?.pluginConfig,
    registerTool: (tool) => {
      registerTool(tool);
      logger.debug({ pluginId: meta.id, toolName: tool.name }, "Plugin registered tool");
    },
    registerTools: (tools) => {
      registerTools(tools);
      logger.debug({ pluginId: meta.id, count: tools.length }, "Plugin registered tools");
    },
    registerHook: (eventType, handler) => {
      const unsubscribe = registerHook(eventType, handler);
      hookUnsubscribers.push(unsubscribe);
      logger.debug({ pluginId: meta.id, eventType }, "Plugin registered hook");
      return unsubscribe;
    },
    registerService: (service) => {
      services.push(service);
      logger.debug({ pluginId: meta.id, serviceId: service.id }, "Plugin registered service");
    },
    getLogger: (name) => getChildLogger(name ?? `plugin:${meta.id}`),
    getStateDir: () => {
      const { homedir } = require("os");
      const { join } = require("path");
      return join(homedir(), ".mozi", "plugins", meta.id);
    },
  };

  // 执行 register 阶段
  try {
    if (definition.register) {
      await definition.register(api);
    }

    const loaded: LoadedPlugin = {
      id: meta.id,
      origin,
      definition,
      pluginConfig: options?.pluginConfig,
      hookUnsubscribers,
      services,
      activated: false,
      loadedAt: Date.now(),
    };

    pluginRegistry.set(meta.id, loaded);
    logger.info({ pluginId: meta.id }, "Plugin registered successfully");
  } catch (error) {
    logger.error({ pluginId: meta.id, error }, "Failed to register plugin");
    throw error;
  }
}

/** 激活插件 */
export async function activatePlugin(pluginId: string): Promise<void> {
  const plugin = pluginRegistry.get(pluginId);
  if (!plugin) {
    throw new Error(`Plugin "${pluginId}" not found`);
  }

  if (plugin.activated) {
    logger.debug({ pluginId }, "Plugin already activated");
    return;
  }

  logger.info({ pluginId }, "Activating plugin");

  // 创建 API (简化版)
  const api: PluginApi = {
    id: plugin.id,
    meta: plugin.definition.meta,
    config: {} as MoziConfig,  // 需要从外部传入
    pluginConfig: plugin.pluginConfig,
    registerTool: (tool) => registerTool(tool),
    registerTools: (tools) => registerTools(tools),
    registerHook: (eventType, handler) => {
      const unsubscribe = registerHook(eventType, handler);
      plugin.hookUnsubscribers.push(unsubscribe);
      return unsubscribe;
    },
    getLogger: (name) => getChildLogger(name ?? `plugin:${plugin.id}`),
    getStateDir: () => {
      const { homedir } = require("os");
      const { join } = require("path");
      return join(homedir(), ".mozi", "plugins", plugin.id);
    },
  };

  // 执行 activate 阶段
  try {
    if (plugin.definition.activate) {
      await plugin.definition.activate(api);
    }

    // 启动服务
    for (const service of plugin.services) {
      await service.start();
    }

    plugin.activated = true;
    logger.info({ pluginId }, "Plugin activated successfully");
  } catch (error) {
    logger.error({ pluginId, error }, "Failed to activate plugin");
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

  // 停止服务 (逆序)
  for (const service of plugin.services.reverse()) {
    try {
      await service.stop();
    } catch (error) {
      logger.error({ pluginId, serviceId: service.id, error }, "Service stop error");
    }
  }

  // 调用清理函数
  if (plugin.definition.cleanup) {
    try {
      await plugin.definition.cleanup();
    } catch (error) {
      logger.error({ pluginId, error }, "Plugin cleanup error");
    }
  }

  // 取消所有 Hook 订阅
  for (const unsubscribe of plugin.hookUnsubscribers) {
    unsubscribe();
  }

  pluginRegistry.delete(pluginId);
  logger.info({ pluginId }, "Plugin unregistered");
}

/** 获取已加载的插件 */
export function getLoadedPlugins(): PluginMeta[] {
  return Array.from(pluginRegistry.values()).map((p) => p.definition.meta);
}

/** 获取插件详情 */
export function getPluginDetails(pluginId: string): LoadedPlugin | undefined {
  return pluginRegistry.get(pluginId);
}

/** 检查插件是否已加载 */
export function isPluginLoaded(pluginId: string): boolean {
  return pluginRegistry.has(pluginId);
}

/** 检查插件是否已激活 */
export function isPluginActivated(pluginId: string): boolean {
  return pluginRegistry.get(pluginId)?.activated ?? false;
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
  initialize: (api: PluginApi) => void | Promise<void>,
  cleanup?: () => void | Promise<void>
): PluginDefinition {
  return {
    meta,
    register: initialize,
    cleanup,
  };
}

/** 创建简单插件 (只包含工具) */
export function defineToolPlugin(
  meta: PluginMeta,
  tools: Tool[]
): PluginDefinition {
  return {
    meta,
    register: (api) => {
      api.registerTools(tools);
    },
  };
}
