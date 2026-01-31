/**
 * 内置工具 - 记忆系统
 * 提供 memory_search / memory_store / memory_list / memory_delete 工具
 */

import { Type } from "@sinclair/typebox";
import type { Tool } from "../types.js";
import { jsonResult, errorResult, readStringParam, readNumberParam, readStringArrayParam } from "../common.js";
import { MemoryManager } from "../../memory/index.js";
import { getChildLogger } from "../../utils/logger.js";

const logger = getChildLogger("memory-tools");

/** 记忆工具选项 */
export interface MemoryToolsOptions {
  /** MemoryManager 实例 */
  manager?: MemoryManager;
}

// 模块级别 MemoryManager，在创建工具时注入
let memoryManager: MemoryManager | null = null;

/** 设置全局 MemoryManager */
export function setMemoryManager(manager: MemoryManager): void {
  memoryManager = manager;
}

/** 获取 MemoryManager */
function getManager(): MemoryManager | null {
  return memoryManager;
}

/** 记忆搜索工具 */
export function createMemorySearchTool(): Tool {
  return {
    name: "memory_search",
    label: "Memory Search",
    description:
      "Search stored memories and past important information by semantic similarity. " +
      "Use this to recall facts, notes, code snippets, or conversation summaries that were previously stored.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query to find relevant memories" }),
      type: Type.Optional(
        Type.String({
          description: "Filter by memory type: conversation, fact, note, code",
          enum: ["conversation", "fact", "note", "code"],
        })
      ),
      tags: Type.Optional(
        Type.Array(Type.String(), { description: "Filter by tags" })
      ),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum number of results (default: 5)",
          minimum: 1,
          maximum: 20,
        })
      ),
      min_score: Type.Optional(
        Type.Number({
          description: "Minimum relevance score 0-1 (default: 0.1)",
          minimum: 0,
          maximum: 1,
        })
      ),
    }),
    execute: async (_toolCallId, args) => {
      const manager = getManager();
      if (!manager) {
        return jsonResult({
          status: "disabled",
          message: "Memory system is not enabled. Set memory.enabled=true in config.",
          results: [],
        });
      }

      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true })!;
      const type = readStringParam(params, "type");
      const tags = readStringArrayParam(params, "tags");
      const limit = readNumberParam(params, "limit", { min: 1, max: 20 }) ?? 5;
      const minScore = readNumberParam(params, "min_score", { min: 0, max: 1 }) ?? 0.1;

      try {
        let results = await manager.recall(query, limit * 2); // 多取一些用于过滤

        // 按类型过滤
        if (type) {
          results = results.filter((r) => r.metadata.type === type);
        }

        // 按标签过滤
        if (tags && tags.length > 0) {
          results = results.filter((r) =>
            tags.some((tag) => r.metadata.tags?.includes(tag))
          );
        }

        // 按分数过滤
        results = results.filter((r) => (r.score ?? 0) >= minScore);

        // 限制数量
        results = results.slice(0, limit);

        logger.debug({ query, count: results.length }, "Memory search completed");

        return jsonResult({
          status: "success",
          query,
          count: results.length,
          results: results.map((r) => ({
            id: r.id,
            content: r.content,
            type: r.metadata.type,
            tags: r.metadata.tags,
            score: r.score ? Math.round(r.score * 100) / 100 : undefined,
            date: new Date(r.metadata.timestamp).toISOString(),
          })),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ query, error: message }, "Memory search failed");
        return errorResult(`Memory search failed: ${message}`);
      }
    },
  };
}

/** 记忆存储工具 */
export function createMemoryStoreTool(): Tool {
  return {
    name: "memory_store",
    label: "Memory Store",
    description:
      "Store important information for future reference. Use this to save facts, notes, " +
      "code snippets, or conversation summaries that may be useful later. " +
      "Stored memories can be searched with memory_search.",
    parameters: Type.Object({
      content: Type.String({
        description: "The content to store in memory",
        minLength: 1,
      }),
      type: Type.Optional(
        Type.String({
          description:
            "Type of memory: fact (verified information), note (general note), code (code snippet), conversation (conversation summary). Default: note",
          enum: ["fact", "note", "code", "conversation"],
        })
      ),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description: "Tags for categorization and filtering",
        })
      ),
      source: Type.Optional(
        Type.String({ description: "Source of the information" })
      ),
    }),
    execute: async (_toolCallId, args) => {
      const manager = getManager();
      if (!manager) {
        return jsonResult({
          status: "disabled",
          message: "Memory system is not enabled. Set memory.enabled=true in config.",
        });
      }

      const params = args as Record<string, unknown>;
      const content = readStringParam(params, "content", { required: true })!;
      const type = (readStringParam(params, "type") ?? "note") as "fact" | "note" | "code" | "conversation";
      const tags = readStringArrayParam(params, "tags");
      const source = readStringParam(params, "source");

      try {
        const id = await manager.remember(content, {
          type,
          tags: tags ?? undefined,
          source: source ?? undefined,
        });

        logger.info({ id, type, tags }, "Memory stored");

        return jsonResult({
          status: "success",
          id,
          type,
          tags,
          message: "Memory stored successfully",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message }, "Memory store failed");
        return errorResult(`Memory store failed: ${message}`);
      }
    },
  };
}

/** 记忆列表工具 */
export function createMemoryListTool(): Tool {
  return {
    name: "memory_list",
    label: "Memory List",
    description:
      "List stored memories with optional filtering by type or tags. " +
      "Returns a summary of each memory entry.",
    parameters: Type.Object({
      type: Type.Optional(
        Type.String({
          description: "Filter by memory type: conversation, fact, note, code",
          enum: ["conversation", "fact", "note", "code"],
        })
      ),
      tags: Type.Optional(
        Type.Array(Type.String(), { description: "Filter by tags" })
      ),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum number of entries (default: 20)",
          minimum: 1,
          maximum: 100,
        })
      ),
    }),
    execute: async (_toolCallId, args) => {
      const manager = getManager();
      if (!manager) {
        return jsonResult({
          status: "disabled",
          message: "Memory system is not enabled.",
          entries: [],
        });
      }

      const params = args as Record<string, unknown>;
      const type = readStringParam(params, "type");
      const tags = readStringArrayParam(params, "tags");
      const limit = readNumberParam(params, "limit", { min: 1, max: 100 }) ?? 20;

      try {
        let entries = await manager.list({
          type: type ?? undefined,
          tags: tags ?? undefined,
        });

        // 按时间倒序
        entries.sort((a, b) => b.metadata.timestamp - a.metadata.timestamp);

        // 限制数量
        entries = entries.slice(0, limit);

        return jsonResult({
          status: "success",
          count: entries.length,
          entries: entries.map((e) => ({
            id: e.id,
            content: e.content.length > 200 ? e.content.slice(0, 200) + "..." : e.content,
            type: e.metadata.type,
            tags: e.metadata.tags,
            date: new Date(e.metadata.timestamp).toISOString(),
          })),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message }, "Memory list failed");
        return errorResult(`Memory list failed: ${message}`);
      }
    },
  };
}

/** 记忆删除工具 */
export function createMemoryDeleteTool(): Tool {
  return {
    name: "memory_delete",
    label: "Memory Delete",
    description: "Delete a specific memory entry by its ID.",
    parameters: Type.Object({
      id: Type.String({ description: "The memory entry ID to delete" }),
    }),
    execute: async (_toolCallId, args) => {
      const manager = getManager();
      if (!manager) {
        return jsonResult({
          status: "disabled",
          message: "Memory system is not enabled.",
        });
      }

      const params = args as Record<string, unknown>;
      const id = readStringParam(params, "id", { required: true })!;

      try {
        const deleted = await manager.forget(id);
        if (deleted) {
          logger.info({ id }, "Memory entry deleted");
          return jsonResult({ status: "success", id, message: "Memory deleted" });
        }
        return jsonResult({ status: "not_found", id, message: "Memory entry not found" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`Memory delete failed: ${message}`);
      }
    },
  };
}

/** 创建所有记忆工具 */
export function createMemoryTools(options?: MemoryToolsOptions): Tool[] {
  if (options?.manager) {
    setMemoryManager(options.manager);
  }

  return [
    createMemorySearchTool(),
    createMemoryStoreTool(),
    createMemoryListTool(),
    createMemoryDeleteTool(),
  ];
}
