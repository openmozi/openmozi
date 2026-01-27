/**
 * 内置工具 - 网络搜索和获取
 */

import { Type } from "@sinclair/typebox";
import type { Tool } from "../types.js";
import { jsonResult, errorResult, readStringParam, readNumberParam } from "../common.js";

/** 网络搜索工具 */
export function createWebSearchTool(): Tool {
  return {
    name: "web_search",
    label: "Web Search",
    description: "Search the web for information. Returns search results with titles, snippets, and URLs.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      maxResults: Type.Optional(Type.Number({ description: "Maximum number of results (default: 5)" })),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true })!;
      const maxResults = readNumberParam(params, "maxResults", { min: 1, max: 10 }) ?? 5;

      // 这里可以集成实际的搜索 API (如 Bing, Google, SerpAPI 等)
      // 目前返回模拟结果
      return jsonResult({
        status: "success",
        query,
        message: "Web search requires API integration. Configure a search provider.",
        results: [],
        note: "Integrate with Bing Search API, Google Custom Search, or SerpAPI",
      });
    },
  };
}

/** 网页获取工具 */
export function createWebFetchTool(): Tool {
  return {
    name: "web_fetch",
    label: "Web Fetch",
    description: "Fetch content from a URL. Returns the page content as text.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch" }),
      maxLength: Type.Optional(Type.Number({ description: "Maximum content length (default: 10000)" })),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const url = readStringParam(params, "url", { required: true })!;
      const maxLength = readNumberParam(params, "maxLength", { min: 100 }) ?? 10000;

      try {
        // 验证 URL
        new URL(url);

        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; MoziBot/1.0)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });

        if (!response.ok) {
          return errorResult(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get("content-type") ?? "";
        let content = await response.text();

        // 截断过长内容
        if (content.length > maxLength) {
          content = content.slice(0, maxLength) + "\n...[truncated]";
        }

        // 简单的 HTML 清理 (移除脚本和样式)
        if (contentType.includes("text/html")) {
          content = content
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        }

        return jsonResult({
          status: "success",
          url,
          contentType,
          length: content.length,
          content,
        });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
