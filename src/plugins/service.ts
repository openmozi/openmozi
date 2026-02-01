/**
 * 插件服务管理
 *
 * 提供统一的插件管理入口
 */

import type { MoziConfig } from "../types/index.js";
import type { PluginEnableConfig, LoadedPlugin, PluginMeta } from "./index.js";
import {
  getLoadedPlugins,
  getPluginDetails,
  unregisterPlugin,
  unregisterAllPlugins,
  isPluginLoaded,
  isPluginActivated,
} from "./index.js";
import { loadPlugins, activateAllPlugins } from "./loader.js";
import { discoverPlugins } from "./discovery.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("plugins:service");

/**
 * 插件服务
 */
export class PluginService {
  private config: MoziConfig;
  private enableConfig: PluginEnableConfig;
  private initialized: boolean = false;

  constructor(config: MoziConfig, enableConfig?: PluginEnableConfig) {
    this.config = config;
    this.enableConfig = enableConfig ?? {};
  }

  /**
   * 初始化插件服务
   */
  async initialize(): Promise<{
    loaded: string[];
    activated: string[];
    skipped: Array<{ id: string; reason: string }>;
    failed: Array<{ id: string; error: string }>;
  }> {
    if (this.initialized) {
      logger.warn("Plugin service already initialized");
      return { loaded: [], activated: [], skipped: [], failed: [] };
    }

    logger.info("Initializing plugin service");

    // 加载插件
    const loadResult = await loadPlugins(this.config, this.enableConfig);

    // 激活插件
    const activateResult = await activateAllPlugins();

    this.initialized = true;

    return {
      loaded: loadResult.loaded,
      activated: activateResult.activated,
      skipped: loadResult.skipped,
      failed: [...loadResult.failed, ...activateResult.failed],
    };
  }

  /**
   * 关闭插件服务
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    logger.info("Shutting down plugin service");
    await unregisterAllPlugins();
    this.initialized = false;
  }

  /**
   * 发现可用插件 (不加载)
   */
  async discover(): Promise<Array<{
    id: string;
    origin: string;
    manifest?: Record<string, unknown>;
    loaded: boolean;
    activated: boolean;
  }>> {
    const candidates = await discoverPlugins({
      paths: this.enableConfig.paths,
    });

    return candidates.map(c => ({
      id: c.id,
      origin: c.origin,
      manifest: c.manifest as Record<string, unknown> | undefined,
      loaded: isPluginLoaded(c.id),
      activated: isPluginActivated(c.id),
    }));
  }

  /**
   * 获取已加载的插件列表
   */
  list(): PluginMeta[] {
    return getLoadedPlugins();
  }

  /**
   * 获取插件详情
   */
  get(pluginId: string): LoadedPlugin | undefined {
    return getPluginDetails(pluginId);
  }

  /**
   * 卸载插件
   */
  async unload(pluginId: string): Promise<boolean> {
    if (!isPluginLoaded(pluginId)) {
      return false;
    }
    await unregisterPlugin(pluginId);
    return true;
  }

  /**
   * 检查插件是否已加载
   */
  isLoaded(pluginId: string): boolean {
    return isPluginLoaded(pluginId);
  }

  /**
   * 检查插件是否已激活
   */
  isActivated(pluginId: string): boolean {
    return isPluginActivated(pluginId);
  }
}

/** 默认服务实例 */
let defaultService: PluginService | null = null;

/**
 * 获取默认插件服务
 */
export function getPluginService(config?: MoziConfig, enableConfig?: PluginEnableConfig): PluginService {
  if (!defaultService && config) {
    defaultService = new PluginService(config, enableConfig);
  }
  if (!defaultService) {
    throw new Error("Plugin service not initialized. Provide config on first call.");
  }
  return defaultService;
}
