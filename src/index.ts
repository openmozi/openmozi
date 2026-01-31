/**
 * Mozi - 国产AI模型 + 国产通讯软件的智能助手
 *
 * 主入口文件
 */

// 类型导出
export * from "./types/index.js";

// 配置
export { loadConfig, validateRequiredConfig } from "./config/index.js";

// 模型提供商
export {
  BaseProvider,
  DeepSeekProvider,
  KimiProvider,
  StepfunProvider,
  MiniMaxProvider,
  createDeepSeekProvider,
  createKimiProvider,
  createStepfunProvider,
  createMiniMaxProvider,
  initializeProviders,
  getProvider,
  getAllProviders,
  findProviderForModel,
  getAllModels,
} from "./providers/index.js";

// 通道
export {
  BaseChannelAdapter,
  FeishuChannel,
  DingtalkChannel,
  createFeishuChannel,
  createDingtalkChannel,
  FeishuApiClient,
  DingtalkApiClient,
  registerChannel,
  getChannel,
  getAllChannels,
  setGlobalMessageHandler,
} from "./channels/index.js";

// Agent
export {
  Agent,
  createAgent,
  estimateTokens,
  estimateMessagesTokens,
  summarizeInStages,
  limitHistoryTurns,
  pruneHistoryForContextShare,
  FailoverError,
  runWithModelFallback,
} from "./agents/index.js";

// Tools
export {
  type Tool,
  type ToolCall,
  type ToolCallResult,
  type ToolResult,
  registerTool,
  registerTools,
  getTool,
  getAllTools,
  filterToolsByPolicy,
  executeToolCalls,
  toolsToOpenAIFunctions,
  createBuiltinTools,
  jsonResult,
  errorResult,
  textResult,
} from "./tools/index.js";

// Hooks
export {
  type HookEventType,
  type HookEvent,
  type HookHandler,
  registerHook,
  registerHooks,
  triggerHook,
  triggerHookSync,
  clearHooks,
  getHookCount,
  emitMessageReceived,
  emitMessageSending,
  emitAgentStart,
  emitAgentEnd,
  emitToolStart,
  emitToolEnd,
  emitError,
} from "./hooks/index.js";

// Plugins
export {
  type PluginMeta,
  type PluginApi,
  type PluginDefinition,
  registerPlugin,
  unregisterPlugin,
  getLoadedPlugins,
  isPluginLoaded,
  unregisterAllPlugins,
  definePlugin,
  defineToolPlugin,
} from "./plugins/index.js";

// Commands
export {
  type CommandContext,
  type CommandHandler,
  type CommandDefinition,
  registerCommand,
  registerCommands,
  getCommand,
  getAllCommands,
  isCommand,
  parseCommand,
  executeCommand,
  registerBuiltinCommands,
} from "./commands/index.js";

// Gateway
export { Gateway, createGateway, startGateway } from "./gateway/index.js";

// Utils
export { getLogger, createLogger, setLogger, getChildLogger } from "./utils/logger.js";
export {
  generateId,
  getEnvVar,
  requireEnvVar,
  delay,
  retry,
  truncate,
  safeJsonParse,
  deepMerge,
  computeHmacSha256,
  aesDecrypt,
} from "./utils/index.js";

// Memory
export {
  MemoryManager,
  createMemoryManager,
  JsonMemoryStore,
  ProviderEmbedding,
  type MemoryEntry,
  type MemoryStore,
  type EmbeddingProvider,
  type MemoryManagerConfig,
} from "./memory/index.js";
