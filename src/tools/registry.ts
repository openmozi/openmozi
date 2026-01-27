/**
 * 工具注册表和策略过滤
 */

import type { Tool, ToolPolicy, ToolCall, ToolCallResult, ToolResult } from "./types.js";
import { TOOL_GROUPS } from "./types.js";
import { errorResult } from "./common.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("tools");

/** 工具注册表 */
const toolRegistry = new Map<string, Tool>();

/** 注册工具 */
export function registerTool(tool: Tool): void {
  toolRegistry.set(tool.name.toLowerCase(), tool);
  logger.debug({ tool: tool.name }, "Tool registered");
}

/** 批量注册工具 */
export function registerTools(tools: Tool[]): void {
  for (const tool of tools) {
    registerTool(tool);
  }
}

/** 获取工具 */
export function getTool(name: string): Tool | undefined {
  return toolRegistry.get(name.toLowerCase());
}

/** 获取所有工具 */
export function getAllTools(): Tool[] {
  return Array.from(toolRegistry.values());
}

/** 清除所有工具 */
export function clearTools(): void {
  toolRegistry.clear();
}

// ============== 策略过滤 ==============

/** 编译模式 */
type CompiledPattern =
  | { kind: "all" }
  | { kind: "exact"; value: string }
  | { kind: "regex"; value: RegExp };

/** 编译单个模式 */
function compilePattern(pattern: string): CompiledPattern {
  const normalized = pattern.toLowerCase().trim();
  if (normalized === "*") return { kind: "all" };
  if (!normalized.includes("*")) return { kind: "exact", value: normalized };

  const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped.replace(/\*/g, ".*");
  return { kind: "regex", value: new RegExp(`^${regexStr}$`) };
}

/** 编译模式列表 */
function compilePatterns(patterns?: string[]): CompiledPattern[] {
  if (!patterns || patterns.length === 0) return [];
  return patterns.map(compilePattern);
}

/** 展开工具组 */
function expandGroups(patterns?: string[]): string[] {
  if (!patterns) return [];

  const expanded: string[] = [];
  for (const pattern of patterns) {
    if (pattern.startsWith("group:") && TOOL_GROUPS[pattern]) {
      expanded.push(...TOOL_GROUPS[pattern]!);
    } else {
      expanded.push(pattern);
    }
  }
  return expanded;
}

/** 检查是否匹配任一模式 */
function matchesAny(name: string, patterns: CompiledPattern[]): boolean {
  for (const pattern of patterns) {
    switch (pattern.kind) {
      case "all":
        return true;
      case "exact":
        if (name === pattern.value) return true;
        break;
      case "regex":
        if (pattern.value.test(name)) return true;
        break;
    }
  }
  return false;
}

/** 按策略过滤工具 */
export function filterToolsByPolicy(tools: Tool[], policy?: ToolPolicy): Tool[] {
  if (!policy) return tools;

  const expandedAllow = expandGroups(policy.allow);
  const expandedDeny = expandGroups(policy.deny);

  const allowPatterns = compilePatterns(expandedAllow);
  const denyPatterns = compilePatterns(expandedDeny);

  return tools.filter((tool) => {
    const name = tool.name.toLowerCase();

    // 拒绝优先
    if (matchesAny(name, denyPatterns)) return false;

    // 如果没有允许列表，允许所有
    if (allowPatterns.length === 0) return true;

    // 必须匹配允许列表
    return matchesAny(name, allowPatterns);
  });
}

// ============== 工具执行 ==============

/** 执行单个工具调用 */
export async function executeToolCall(
  toolCall: ToolCall,
  signal?: AbortSignal
): Promise<ToolCallResult> {
  const startTime = Date.now();
  const tool = getTool(toolCall.name);

  if (!tool) {
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      result: errorResult(`Unknown tool: ${toolCall.name}`),
      isError: true,
      durationMs: Date.now() - startTime,
    };
  }

  try {
    logger.debug({ tool: toolCall.name, args: toolCall.arguments }, "Executing tool");

    const result = await tool.execute(toolCall.id, toolCall.arguments, signal);

    logger.debug(
      { tool: toolCall.name, durationMs: Date.now() - startTime },
      "Tool execution completed"
    );

    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      result,
      isError: result.isError ?? false,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ tool: toolCall.name, error }, "Tool execution failed");

    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      result: errorResult(message),
      isError: true,
      durationMs: Date.now() - startTime,
    };
  }
}

/** 批量执行工具调用 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  options?: {
    signal?: AbortSignal;
    parallel?: boolean;
  }
): Promise<ToolCallResult[]> {
  const { signal, parallel = false } = options ?? {};

  if (parallel) {
    return Promise.all(toolCalls.map((tc) => executeToolCall(tc, signal)));
  }

  const results: ToolCallResult[] = [];
  for (const toolCall of toolCalls) {
    if (signal?.aborted) {
      results.push({
        toolCallId: toolCall.id,
        name: toolCall.name,
        result: errorResult("Aborted"),
        isError: true,
        durationMs: 0,
      });
      continue;
    }
    results.push(await executeToolCall(toolCall, signal));
  }
  return results;
}

/** 将工具转换为 OpenAI 函数格式 */
export function toolsToOpenAIFunctions(tools: Tool[]): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
