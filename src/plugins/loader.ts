/**
 * 插件加载器
 *
 * 动态加载插件模块并初始化
 */

import { pathToFileURL } from "url";
import type {
  PluginCandidate,
  PluginModule,
  PluginDefinition,
  PluginEnableConfig,
  LoadedPlugin,
} from "./index.js";
import { registerPlugin, activatePlugin, getLoadedPlugins } from "./index.js";
import { discoverPlugins } from "./discovery.js";
import type { MoziConfig } from "../types/index.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("plugins:loader");

/**
 * 解析插件启用状态
 */
function resolveEnableState(
  candidate: PluginCandidate,
  enableConfig?: PluginEnableConfig
): { enabled: boolean; reason: string } {
  if (!enableConfig) {
    return { enabled: true, reason: "default" };
  }

  // 全局禁用
  if (enableConfig.enabled === false) {
    return { enabled: false, reason: "globally disabled" };
  }

  // 拒绝列表
  if (enableConfig.deny?.includes(candidate.id)) {
    return { enabled: false, reason: "in deny list" };
  }

  // 允许列表
  if (enableConfig.allow && enableConfig.allow.length > 0) {
    if (!enableConfig.allow.includes(candidate.id)) {
      return { enabled: false, reason: "not in allow list" };
    }
  }

  // 单独配置
  const entry = enableConfig.entries?.[candidate.id];
  if (entry?.enabled === false) {
    return { enabled: false, reason: "explicitly disabled" };
  }
  if (entry?.enabled === true) {
    return { enabled: true, reason: "explicitly enabled" };
  }

  // 排他性槽位检查
  if (candidate.manifest?.kind && enableConfig.slots) {
    const slotValue = enableConfig.slots[candidate.manifest.kind];
    if (slotValue && slotValue !== candidate.id) {
      return { enabled: false, reason: `slot "${candidate.manifest.kind}" assigned to "${slotValue}"` };
    }
  }

  // 默认启用非内置插件，内置插件按默认规则
  if (candidate.origin === "bundled") {
    // 可以添加内置插件的默认启用列表
    return { enabled: true, reason: "bundled default" };
  }

  return { enabled: true, reason: "default" };
}

/**
 * 加载单个插件模块
 */
async function loadPluginModule(candidate: PluginCandidate): Promise<PluginModule | null> {
  try {
    // 转换为 file:// URL
    const fileUrl = pathToFileURL(candidate.entryPath).href;

    // 动态导入
    const mod = await import(fileUrl);

    // 获取默认导出
    const defaultExport = mod.default ?? mod;

    // 验证是否是有效的插件模块
    if (typeof defaultExport === "function") {
      return defaultExport as PluginModule;
    }

    if (typeof defaultExport === "object" && defaultExport.meta) {
      return defaultExport as PluginDefinition;
    }

    logger.warn({ entryPath: candidate.entryPath }, "Invalid plugin module format");
    return null;
  } catch (error) {
    logger.error({ entryPath: candidate.entryPath, error }, "Failed to load plugin module");
    return null;
  }
}

/**
 * 将模块转换为定义
 */
function moduleToDefinition(
  mod: PluginModule,
  candidate: PluginCandidate
): PluginDefinition {
  if (typeof mod === "function") {
    return {
      meta: {
        id: candidate.id,
        name: candidate.manifest?.name || candidate.id,
        version: candidate.manifest?.version || "0.0.0",
        description: candidate.manifest?.description,
        author: candidate.manifest?.author,
        kind: candidate.manifest?.kind,
      },
      register: mod,
    };
  }

  return mod;
}

/**
 * 加载所有插件
 */
export async function loadPlugins(
  config: MoziConfig,
  enableConfig?: PluginEnableConfig
): Promise<{
  loaded: string[];
  skipped: Array<{ id: string; reason: string }>;
  failed: Array<{ id: string; error: string }>;
}> {
  const result = {
    loaded: [] as string[],
    skipped: [] as Array<{ id: string; reason: string }>,
    failed: [] as Array<{ id: string; error: string }>,
  };

  // 发现插件
  const candidates = await discoverPlugins({
    paths: enableConfig?.paths,
    includeBuiltin: true,
    includeGlobal: true,
    includeWorkspace: true,
  });

  logger.info({ count: candidates.length }, "Discovered plugins");

  // 按依赖顺序排序 (简单实现，只支持一级依赖)
  const sorted = sortByDependencies(candidates);

  for (const candidate of sorted) {
    // 检查启用状态
    const { enabled, reason } = resolveEnableState(candidate, enableConfig);
    if (!enabled) {
      result.skipped.push({ id: candidate.id, reason });
      logger.debug({ pluginId: candidate.id, reason }, "Plugin skipped");
      continue;
    }

    // 加载模块
    const mod = await loadPluginModule(candidate);
    if (!mod) {
      result.failed.push({ id: candidate.id, error: "Failed to load module" });
      continue;
    }

    // 转换为定义
    const definition = moduleToDefinition(mod, candidate);

    // 获取插件配置
    const pluginConfig = enableConfig?.entries?.[candidate.id]?.config;

    // 注册插件
    try {
      await registerPlugin(definition, config, {
        origin: candidate.origin,
        pluginConfig,
      });
      result.loaded.push(candidate.id);
    } catch (error) {
      result.failed.push({
        id: candidate.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info({
    loaded: result.loaded.length,
    skipped: result.skipped.length,
    failed: result.failed.length,
  }, "Plugin loading completed");

  return result;
}

/**
 * 激活所有已加载的插件
 */
export async function activateAllPlugins(): Promise<{
  activated: string[];
  failed: Array<{ id: string; error: string }>;
}> {
  const result = {
    activated: [] as string[],
    failed: [] as Array<{ id: string; error: string }>,
  };

  for (const meta of getLoadedPlugins()) {
    try {
      await activatePlugin(meta.id);
      result.activated.push(meta.id);
    } catch (error) {
      result.failed.push({
        id: meta.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * 按依赖顺序排序
 */
function sortByDependencies(candidates: PluginCandidate[]): PluginCandidate[] {
  const sorted: PluginCandidate[] = [];
  const visited = new Set<string>();
  const idMap = new Map(candidates.map(c => [c.id, c]));

  function visit(candidate: PluginCandidate) {
    if (visited.has(candidate.id)) return;
    visited.add(candidate.id);

    // 先处理依赖
    const deps = candidate.manifest?.dependencies || [];
    for (const depId of deps) {
      const dep = idMap.get(depId);
      if (dep) {
        visit(dep);
      }
    }

    sorted.push(candidate);
  }

  for (const candidate of candidates) {
    visit(candidate);
  }

  return sorted;
}
