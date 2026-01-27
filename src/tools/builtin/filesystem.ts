/**
 * 内置工具 - 文件系统工具
 * 对齐 Claude Code 的文件操作能力
 */

import { Type } from "@sinclair/typebox";
import { readFile, writeFile, stat, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, relative, basename, dirname, extname } from "path";
import { glob } from "glob";
import type { Tool } from "../types.js";
import { jsonResult, textResult, readStringParam, readNumberParam, readBooleanParam } from "../common.js";

/** 文件系统工具选项 */
export interface FilesystemToolsOptions {
  /** 允许访问的根目录列表 */
  allowedPaths?: string[];
  /** 最大文件大小 (字节) */
  maxFileSize?: number;
  /** 最大读取行数 */
  maxLines?: number;
}

const DEFAULT_OPTIONS: Required<FilesystemToolsOptions> = {
  allowedPaths: [process.cwd()],
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxLines: 2000,
};

/** 检查路径是否在允许范围内 */
function isPathAllowed(filePath: string, allowedPaths: string[]): boolean {
  const resolved = resolve(filePath);
  return allowedPaths.some((allowed) => {
    const resolvedAllowed = resolve(allowed);
    return resolved === resolvedAllowed || resolved.startsWith(resolvedAllowed + "/");
  });
}

/** 创建读取文件工具 */
export function createReadFileTool(options?: FilesystemToolsOptions): Tool {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return {
    name: "read_file",
    label: "Read File",
    description: "Read the contents of a file. Supports text files with optional line range.",
    parameters: Type.Object({
      path: Type.String({ description: "Absolute or relative path to the file" }),
      offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-based)" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const filePath = readStringParam(params, "path", { required: true })!;
      const offset = readNumberParam(params, "offset", { min: 1 }) ?? 1;
      const limit = readNumberParam(params, "limit", { min: 1 }) ?? opts.maxLines;

      const resolved = resolve(filePath);

      // 安全检查
      if (!isPathAllowed(resolved, opts.allowedPaths)) {
        return jsonResult({
          status: "error",
          error: `Access denied: path '${filePath}' is not in allowed directories`,
        }, true);
      }

      if (!existsSync(resolved)) {
        return jsonResult({
          status: "error",
          error: `File not found: ${filePath}`,
        }, true);
      }

      try {
        const stats = await stat(resolved);

        if (stats.isDirectory()) {
          return jsonResult({
            status: "error",
            error: `Path is a directory, not a file: ${filePath}`,
          }, true);
        }

        if (stats.size > opts.maxFileSize) {
          return jsonResult({
            status: "error",
            error: `File too large: ${stats.size} bytes (max: ${opts.maxFileSize})`,
          }, true);
        }

        const content = await readFile(resolved, "utf-8");
        const lines = content.split("\n");
        const totalLines = lines.length;

        // 应用偏移和限制
        const startIdx = Math.max(0, offset - 1);
        const endIdx = Math.min(totalLines, startIdx + limit);
        const selectedLines = lines.slice(startIdx, endIdx);

        // 添加行号 (类似 cat -n 格式)
        const numberedContent = selectedLines
          .map((line, i) => {
            const lineNum = startIdx + i + 1;
            const padding = String(totalLines).length;
            return `${String(lineNum).padStart(padding)}→${line}`;
          })
          .join("\n");

        return textResult(numberedContent, {
          path: resolved,
          totalLines,
          startLine: startIdx + 1,
          endLine: endIdx,
          truncated: endIdx < totalLines,
        });
      } catch (error) {
        return jsonResult({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }, true);
      }
    },
  };
}

/** 创建写入文件工具 */
export function createWriteFileTool(options?: FilesystemToolsOptions): Tool {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return {
    name: "write_file",
    label: "Write File",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
    parameters: Type.Object({
      path: Type.String({ description: "Absolute or relative path to the file" }),
      content: Type.String({ description: "Content to write to the file" }),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const filePath = readStringParam(params, "path", { required: true })!;
      const content = readStringParam(params, "content", { required: true })!;

      const resolved = resolve(filePath);

      if (!isPathAllowed(resolved, opts.allowedPaths)) {
        return jsonResult({
          status: "error",
          error: `Access denied: path '${filePath}' is not in allowed directories`,
        }, true);
      }

      try {
        await writeFile(resolved, content, "utf-8");
        const stats = await stat(resolved);

        return jsonResult({
          status: "success",
          path: resolved,
          size: stats.size,
          lines: content.split("\n").length,
        });
      } catch (error) {
        return jsonResult({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }, true);
      }
    },
  };
}

/** 创建编辑文件工具 */
export function createEditFileTool(options?: FilesystemToolsOptions): Tool {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return {
    name: "edit_file",
    label: "Edit File",
    description: "Edit a file by replacing a specific string with another. The old_string must be unique in the file.",
    parameters: Type.Object({
      path: Type.String({ description: "Absolute or relative path to the file" }),
      old_string: Type.String({ description: "The exact string to find and replace" }),
      new_string: Type.String({ description: "The string to replace it with" }),
      replace_all: Type.Optional(Type.Boolean({ description: "Replace all occurrences (default: false)" })),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const filePath = readStringParam(params, "path", { required: true })!;
      const oldString = readStringParam(params, "old_string", { required: true })!;
      const newString = readStringParam(params, "new_string", { required: true })!;
      const replaceAll = readBooleanParam(params, "replace_all") ?? false;

      const resolved = resolve(filePath);

      if (!isPathAllowed(resolved, opts.allowedPaths)) {
        return jsonResult({
          status: "error",
          error: `Access denied: path '${filePath}' is not in allowed directories`,
        }, true);
      }

      if (!existsSync(resolved)) {
        return jsonResult({
          status: "error",
          error: `File not found: ${filePath}`,
        }, true);
      }

      try {
        const content = await readFile(resolved, "utf-8");

        // 检查 old_string 是否存在
        const occurrences = content.split(oldString).length - 1;

        if (occurrences === 0) {
          return jsonResult({
            status: "error",
            error: `String not found in file: "${oldString.slice(0, 100)}..."`,
          }, true);
        }

        if (!replaceAll && occurrences > 1) {
          return jsonResult({
            status: "error",
            error: `String appears ${occurrences} times. Use replace_all=true or provide more context to make it unique.`,
          }, true);
        }

        // 执行替换
        const newContent = replaceAll
          ? content.split(oldString).join(newString)
          : content.replace(oldString, newString);

        await writeFile(resolved, newContent, "utf-8");

        return jsonResult({
          status: "success",
          path: resolved,
          replacements: replaceAll ? occurrences : 1,
        });
      } catch (error) {
        return jsonResult({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }, true);
      }
    },
  };
}

/** 创建列出目录工具 */
export function createListDirectoryTool(options?: FilesystemToolsOptions): Tool {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return {
    name: "list_directory",
    label: "List Directory",
    description: "List the contents of a directory with file details.",
    parameters: Type.Object({
      path: Type.String({ description: "Path to the directory" }),
      recursive: Type.Optional(Type.Boolean({ description: "List recursively (default: false)" })),
      max_depth: Type.Optional(Type.Number({ description: "Maximum depth for recursive listing (default: 3)" })),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const dirPath = readStringParam(params, "path", { required: true })!;
      const recursive = readBooleanParam(params, "recursive") ?? false;
      const maxDepth = readNumberParam(params, "max_depth", { min: 1, max: 10 }) ?? 3;

      const resolved = resolve(dirPath);

      if (!isPathAllowed(resolved, opts.allowedPaths)) {
        return jsonResult({
          status: "error",
          error: `Access denied: path '${dirPath}' is not in allowed directories`,
        }, true);
      }

      if (!existsSync(resolved)) {
        return jsonResult({
          status: "error",
          error: `Directory not found: ${dirPath}`,
        }, true);
      }

      try {
        const stats = await stat(resolved);
        if (!stats.isDirectory()) {
          return jsonResult({
            status: "error",
            error: `Path is not a directory: ${dirPath}`,
          }, true);
        }

        const entries: string[] = [];

        async function listDir(dir: string, depth: number, prefix: string): Promise<void> {
          if (depth > maxDepth) return;

          const items = await readdir(dir, { withFileTypes: true });
          items.sort((a, b) => {
            // 目录优先
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name);
          });

          for (const item of items) {
            const itemPath = join(dir, item.name);
            const relPath = relative(resolved, itemPath);

            if (item.isDirectory()) {
              entries.push(`${prefix}${item.name}/`);
              if (recursive) {
                await listDir(itemPath, depth + 1, prefix + "  ");
              }
            } else {
              try {
                const itemStats = await stat(itemPath);
                const size = formatSize(itemStats.size);
                entries.push(`${prefix}${item.name} (${size})`);
              } catch {
                entries.push(`${prefix}${item.name}`);
              }
            }
          }
        }

        await listDir(resolved, 1, "");

        return textResult(entries.join("\n"), {
          path: resolved,
          totalEntries: entries.length,
          recursive,
        });
      } catch (error) {
        return jsonResult({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }, true);
      }
    },
  };
}

/** 创建 Glob 搜索工具 */
export function createGlobTool(options?: FilesystemToolsOptions): Tool {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return {
    name: "glob",
    label: "Glob Search",
    description: "Find files matching a glob pattern (e.g., '**/*.ts', 'src/**/*.js').",
    parameters: Type.Object({
      pattern: Type.String({ description: "Glob pattern to match files" }),
      path: Type.Optional(Type.String({ description: "Base directory to search in (default: cwd)" })),
      max_results: Type.Optional(Type.Number({ description: "Maximum number of results (default: 100)" })),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const pattern = readStringParam(params, "pattern", { required: true })!;
      const basePath = readStringParam(params, "path") ?? process.cwd();
      const maxResults = readNumberParam(params, "max_results", { min: 1, max: 1000 }) ?? 100;

      const resolved = resolve(basePath);

      if (!isPathAllowed(resolved, opts.allowedPaths)) {
        return jsonResult({
          status: "error",
          error: `Access denied: path '${basePath}' is not in allowed directories`,
        }, true);
      }

      try {
        const matches = await glob(pattern, {
          cwd: resolved,
          nodir: false,
          ignore: ["**/node_modules/**", "**/.git/**"],
          maxDepth: 20,
        });

        const limited = matches.slice(0, maxResults);
        const results = limited.map((m: string) => join(resolved, m));

        return jsonResult({
          status: "success",
          pattern,
          basePath: resolved,
          matches: results,
          total: matches.length,
          truncated: matches.length > maxResults,
        });
      } catch (error) {
        return jsonResult({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }, true);
      }
    },
  };
}

/** 创建 Grep 搜索工具 */
export function createGrepTool(options?: FilesystemToolsOptions): Tool {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return {
    name: "grep",
    label: "Grep Search",
    description: "Search for a pattern in files. Returns matching lines with context.",
    parameters: Type.Object({
      pattern: Type.String({ description: "Regular expression pattern to search for" }),
      path: Type.Optional(Type.String({ description: "File or directory to search in (default: cwd)" })),
      glob_pattern: Type.Optional(Type.String({ description: "Glob pattern to filter files (e.g., '*.ts')" })),
      context: Type.Optional(Type.Number({ description: "Number of context lines before and after (default: 0)" })),
      max_results: Type.Optional(Type.Number({ description: "Maximum number of matches (default: 50)" })),
      case_insensitive: Type.Optional(Type.Boolean({ description: "Case insensitive search (default: false)" })),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const pattern = readStringParam(params, "pattern", { required: true })!;
      const searchPath = readStringParam(params, "path") ?? process.cwd();
      const globPattern = readStringParam(params, "glob_pattern") ?? "**/*";
      const context = readNumberParam(params, "context", { min: 0, max: 10 }) ?? 0;
      const maxResults = readNumberParam(params, "max_results", { min: 1, max: 500 }) ?? 50;
      const caseInsensitive = readBooleanParam(params, "case_insensitive") ?? false;

      const resolved = resolve(searchPath);

      if (!isPathAllowed(resolved, opts.allowedPaths)) {
        return jsonResult({
          status: "error",
          error: `Access denied: path '${searchPath}' is not in allowed directories`,
        }, true);
      }

      try {
        const regex = new RegExp(pattern, caseInsensitive ? "gi" : "g");

        // 获取要搜索的文件
        let files: string[];
        const stats = await stat(resolved);

        if (stats.isFile()) {
          files = [resolved];
        } else {
          const matches = await glob(globPattern, {
            cwd: resolved,
            nodir: true,
            ignore: ["**/node_modules/**", "**/.git/**", "**/*.min.js", "**/*.map"],
          });
          files = matches.map((m: string) => join(resolved, m));
        }

        interface GrepMatch {
          file: string;
          line: number;
          content: string;
          context_before?: string[];
          context_after?: string[];
        }

        const results: GrepMatch[] = [];
        let totalMatches = 0;

        for (const file of files) {
          if (results.length >= maxResults) break;

          try {
            const fileStats = await stat(file);
            if (fileStats.size > opts.maxFileSize) continue;

            const content = await readFile(file, "utf-8");
            const lines = content.split("\n");

            for (let i = 0; i < lines.length; i++) {
              if (results.length >= maxResults) break;

              const line = lines[i]!;
              if (regex.test(line)) {
                totalMatches++;
                regex.lastIndex = 0; // Reset regex state

                const match: GrepMatch = {
                  file: relative(resolved, file),
                  line: i + 1,
                  content: line.trim(),
                };

                if (context > 0) {
                  match.context_before = lines
                    .slice(Math.max(0, i - context), i)
                    .map((l) => l.trim());
                  match.context_after = lines
                    .slice(i + 1, Math.min(lines.length, i + 1 + context))
                    .map((l) => l.trim());
                }

                results.push(match);
              }
            }
          } catch {
            // 跳过无法读取的文件
          }
        }

        // 格式化输出
        const output = results
          .map((r) => {
            let text = `${r.file}:${r.line}: ${r.content}`;
            if (r.context_before?.length) {
              text = r.context_before.map((l) => `  ${l}`).join("\n") + "\n" + text;
            }
            if (r.context_after?.length) {
              text = text + "\n" + r.context_after.map((l) => `  ${l}`).join("\n");
            }
            return text;
          })
          .join("\n---\n");

        return textResult(output || "No matches found", {
          pattern,
          totalMatches,
          filesSearched: files.length,
          truncated: totalMatches > maxResults,
        });
      } catch (error) {
        return jsonResult({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }, true);
      }
    },
  };
}

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

/** 创建所有文件系统工具 */
export function createFilesystemTools(options?: FilesystemToolsOptions): Tool[] {
  return [
    createReadFileTool(options),
    createWriteFileTool(options),
    createEditFileTool(options),
    createListDirectoryTool(options),
    createGlobTool(options),
    createGrepTool(options),
  ];
}
