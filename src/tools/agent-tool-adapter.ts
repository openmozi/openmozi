/**
 * Tool Adapter - 将 mozi 的 Tool 转换为 pi-agent-core 的 AgentTool
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Tool } from "./types.js";

/**
 * 将 mozi Tool 转换为 pi-agent-core AgentTool
 */
export function toAgentTool(moziTool: Tool): AgentTool<typeof moziTool.parameters, Record<string, unknown>> {
  return {
    name: moziTool.name,
    label: moziTool.label ?? moziTool.name,
    description: moziTool.description,
    parameters: moziTool.parameters,
    execute: async (
      toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
      onUpdate?: (partialResult: AgentToolResult<Record<string, unknown>>) => void,
    ): Promise<AgentToolResult<Record<string, unknown>>> => {
      const result = await moziTool.execute(
        toolCallId,
        params as Record<string, unknown>,
        signal,
        onUpdate
          ? (partial) => {
              if (partial.text) {
                onUpdate({
                  content: [{ type: "text", text: partial.text }],
                  details: {},
                });
              }
            }
          : undefined,
      );

      return {
        content: result.content,
        details: (result.details as Record<string, unknown>) ?? {},
      };
    },
  };
}

/**
 * 批量转换 mozi Tool 为 pi-agent-core AgentTool
 */
export function toAgentTools(moziTools: Tool[]): AgentTool[] {
  return moziTools.map(toAgentTool);
}
