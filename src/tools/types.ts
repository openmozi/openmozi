/**
 * 工具系统 - 类型定义
 */

import type { TSchema } from "@sinclair/typebox";

/** 工具结果内容项 */
export type ToolResultContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/** 工具执行结果 */
export interface ToolResult {
  content: ToolResultContent[];
  details?: unknown;
  isError?: boolean;
}

/** 工具更新回调 */
export type ToolUpdateCallback = (partial: { text?: string }) => void;

/** 工具定义 */
export interface Tool<TParams = Record<string, unknown>> {
  /** 工具名称 (标识符) */
  name: string;
  /** 工具标签 (显示名) */
  label?: string;
  /** 工具描述 */
  description: string;
  /** 参数 JSON Schema */
  parameters: TSchema;
  /** 执行函数 */
  execute: (
    toolCallId: string,
    args: TParams,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateCallback
  ) => Promise<ToolResult>;
}

/** 工具调用 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 工具调用结果 */
export interface ToolCallResult {
  toolCallId: string;
  name: string;
  result: ToolResult;
  isError: boolean;
  durationMs: number;
}

/** 工具策略 */
export interface ToolPolicy {
  allow?: string[];
  deny?: string[];
}

/** 工具组定义 */
export const TOOL_GROUPS: Record<string, string[]> = {
  "group:web": ["web_search", "web_fetch"],
  "group:memory": ["memory_search", "memory_store"],
  "group:media": ["image_analyze"],
  "group:system": ["current_time", "calculator"],
};
