/**
 * 子 Agent 工具 - 支持多 Agent 路由
 */

import { Type } from "@sinclair/typebox";
import type { Tool } from "../types.js";
import { jsonResult, textResult, readStringParam } from "../common.js";
import { getChildLogger } from "../../utils/logger.js";

const logger = getChildLogger("subagent");

/** 子 Agent 定义 */
export interface SubAgentDefinition {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model?: string;
  provider?: string;
}

/** 子 Agent 运行器 */
export type SubAgentRunner = (
  agentId: string,
  prompt: string,
  context?: Record<string, unknown>
) => Promise<{ content: string; error?: string }>;

/** 子 Agent 注册表 */
const subAgentRegistry = new Map<string, SubAgentDefinition>();
let subAgentRunner: SubAgentRunner | null = null;

/** 注册子 Agent */
export function registerSubAgent(agent: SubAgentDefinition): void {
  subAgentRegistry.set(agent.id, agent);
  logger.debug({ agentId: agent.id, name: agent.name }, "Subagent registered");
}

/** 设置子 Agent 运行器 */
export function setSubAgentRunner(runner: SubAgentRunner): void {
  subAgentRunner = runner;
}

/** 获取所有子 Agent */
export function getAllSubAgents(): SubAgentDefinition[] {
  return Array.from(subAgentRegistry.values());
}

/** 获取子 Agent */
export function getSubAgent(id: string): SubAgentDefinition | undefined {
  return subAgentRegistry.get(id);
}

/** 创建子 Agent 工具 */
export function createSubAgentTool(): Tool {
  return {
    name: "subagent",
    label: "Sub-Agent",
    description: `Delegate a task to a specialized sub-agent. Use this when:
- The task requires specialized knowledge or capabilities
- You want to parallelize work across multiple agents
- The task is complex and benefits from focused attention

Available sub-agents will be listed when you call with action="list".`,
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("list"),
        Type.Literal("run"),
      ], { description: "Action to perform" }),
      agent_id: Type.Optional(Type.String({ description: "ID of the sub-agent to run (for run action)" })),
      prompt: Type.Optional(Type.String({ description: "The prompt/task to send to the sub-agent (for run action)" })),
      context: Type.Optional(Type.Object({}, { description: "Additional context to pass to the sub-agent" })),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true })!;

      if (action === "list") {
        const agents = getAllSubAgents();
        if (agents.length === 0) {
          return jsonResult({
            status: "success",
            message: "No sub-agents registered",
            agents: [],
          });
        }

        return jsonResult({
          status: "success",
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            description: a.description,
          })),
        });
      }

      if (action === "run") {
        const agentId = readStringParam(params, "agent_id");
        const prompt = readStringParam(params, "prompt");

        if (!agentId) {
          return jsonResult({
            status: "error",
            error: "agent_id is required for run action",
          }, true);
        }

        if (!prompt) {
          return jsonResult({
            status: "error",
            error: "prompt is required for run action",
          }, true);
        }

        const agent = getSubAgent(agentId);
        if (!agent) {
          return jsonResult({
            status: "error",
            error: `Sub-agent not found: ${agentId}`,
          }, true);
        }

        if (!subAgentRunner) {
          return jsonResult({
            status: "error",
            error: "Sub-agent runner not configured",
          }, true);
        }

        try {
          logger.info({ agentId, promptLength: prompt.length }, "Running sub-agent");
          const context = params.context as Record<string, unknown> | undefined;
          const result = await subAgentRunner(agentId, prompt, context);

          if (result.error) {
            return jsonResult({
              status: "error",
              error: result.error,
              partialContent: result.content,
            }, true);
          }

          return textResult(result.content, {
            agentId,
            agentName: agent.name,
          });
        } catch (error) {
          logger.error({ error, agentId }, "Sub-agent execution failed");
          return jsonResult({
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          }, true);
        }
      }

      return jsonResult({
        status: "error",
        error: `Unknown action: ${action}`,
      }, true);
    },
  };
}

/** 预定义的子 Agent */
export const PREDEFINED_SUBAGENTS: SubAgentDefinition[] = [
  {
    id: "researcher",
    name: "Research Agent",
    description: "Specialized in gathering information, reading documentation, and researching topics",
    systemPrompt: `You are a Research Agent specialized in:
- Finding and reading documentation
- Gathering information from codebases
- Summarizing findings clearly
- Providing factual, well-sourced answers

Focus on accuracy and completeness. Use available tools to read files and search.`,
  },
  {
    id: "coder",
    name: "Coding Agent",
    description: "Specialized in writing and modifying code",
    systemPrompt: `You are a Coding Agent specialized in:
- Writing clean, efficient code
- Following best practices and coding standards
- Understanding existing code patterns
- Making minimal, focused changes

Focus on code quality and maintainability.`,
  },
  {
    id: "reviewer",
    name: "Code Review Agent",
    description: "Specialized in reviewing code changes for quality, bugs, and best practices",
    systemPrompt: `You are a Code Review Agent specialized in:
- Identifying bugs and potential issues
- Checking for security vulnerabilities
- Evaluating code quality and readability
- Suggesting improvements

Be thorough but constructive in feedback.`,
  },
  {
    id: "planner",
    name: "Planning Agent",
    description: "Specialized in breaking down complex tasks into actionable steps",
    systemPrompt: `You are a Planning Agent specialized in:
- Analyzing complex requirements
- Breaking tasks into clear steps
- Identifying dependencies and risks
- Creating actionable plans

Focus on clarity and feasibility.`,
  },
];

/** 注册预定义的子 Agent */
export function registerPredefinedSubAgents(): void {
  for (const agent of PREDEFINED_SUBAGENTS) {
    registerSubAgent(agent);
  }
}
