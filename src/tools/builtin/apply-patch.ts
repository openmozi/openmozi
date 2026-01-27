/**
 * 内置工具 - apply_patch 差异修补工具
 * 对齐 OpenAI apply_patch 格式
 */

import { Type } from "@sinclair/typebox";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import type { Tool } from "../types.js";
import { jsonResult, textResult, readStringParam } from "../common.js";

/** 解析统一 diff 格式 */
interface PatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

interface FilePatch {
  oldPath: string;
  newPath: string;
  hunks: PatchHunk[];
  isNew: boolean;
  isDelete: boolean;
}

/** 解析 patch 字符串 */
function parsePatch(patchText: string): FilePatch[] {
  const patches: FilePatch[] = [];
  const lines = patchText.split("\n");
  let i = 0;

  while (i < lines.length) {
    // 查找 --- 行
    if (!lines[i]?.startsWith("---")) {
      i++;
      continue;
    }

    const oldPathLine = lines[i]!;
    i++;
    if (i >= lines.length || !lines[i]?.startsWith("+++")) {
      continue;
    }
    const newPathLine = lines[i]!;
    i++;

    // 提取路径
    const oldPath = oldPathLine.replace(/^---\s+/, "").replace(/^a\//, "").replace(/\t.*$/, "");
    const newPath = newPathLine.replace(/^\+\+\+\s+/, "").replace(/^b\//, "").replace(/\t.*$/, "");

    const isNew = oldPath === "/dev/null";
    const isDelete = newPath === "/dev/null";

    const hunks: PatchHunk[] = [];

    // 解析 hunks
    while (i < lines.length && lines[i]?.startsWith("@@")) {
      const hunkHeader = lines[i]!;
      const match = hunkHeader.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!match) {
        i++;
        continue;
      }

      const hunk: PatchHunk = {
        oldStart: parseInt(match[1]!, 10),
        oldCount: match[2] !== undefined ? parseInt(match[2], 10) : 1,
        newStart: parseInt(match[3]!, 10),
        newCount: match[4] !== undefined ? parseInt(match[4], 10) : 1,
        lines: [],
      };

      i++;

      // 收集 hunk 行
      while (i < lines.length) {
        const line = lines[i]!;
        if (line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++")) {
          break;
        }
        if (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line === "") {
          hunk.lines.push(line);
          i++;
        } else {
          // 可能是 diff 之间的分隔 (如 "diff --git" 行)
          break;
        }
      }

      hunks.push(hunk);
    }

    patches.push({ oldPath, newPath, hunks, isNew, isDelete });
  }

  return patches;
}

/** 应用单个 hunk */
function applyHunk(lines: string[], hunk: PatchHunk): string[] | null {
  const result = [...lines];
  let offset = hunk.oldStart - 1; // 转换为 0-indexed

  // 查找匹配位置 (允许一定的偏移)
  const contextLines = hunk.lines
    .filter((l) => l.startsWith(" ") || l.startsWith("-"))
    .map((l) => l.slice(1));

  let matchOffset = -1;
  const searchRange = 50; // 在附近搜索

  for (let delta = 0; delta <= searchRange; delta++) {
    for (const sign of [0, -1, 1]) {
      const tryOffset = offset + delta * (sign === 0 ? 0 : sign);
      if (tryOffset < 0 || tryOffset > result.length) continue;

      let matches = true;
      let ci = 0;
      for (const contextLine of contextLines) {
        if (tryOffset + ci >= result.length) {
          matches = false;
          break;
        }
        if (result[tryOffset + ci] !== contextLine) {
          matches = false;
          break;
        }
        ci++;
      }

      if (matches) {
        matchOffset = tryOffset;
        break;
      }
    }
    if (matchOffset >= 0) break;
  }

  if (matchOffset < 0) {
    return null; // 无法匹配
  }

  // 应用变更
  const newLines: string[] = [];
  let srcIdx = matchOffset;

  for (const line of hunk.lines) {
    if (line.startsWith(" ")) {
      // 上下文行 - 保留
      newLines.push(result[srcIdx]!);
      srcIdx++;
    } else if (line.startsWith("-")) {
      // 删除行 - 跳过
      srcIdx++;
    } else if (line.startsWith("+")) {
      // 添加行
      newLines.push(line.slice(1));
    }
    // 空行视为上下文
    else if (line === "") {
      if (srcIdx < result.length) {
        newLines.push(result[srcIdx]!);
        srcIdx++;
      }
    }
  }

  // 拼接: before + new + after
  const before = result.slice(0, matchOffset);
  const after = result.slice(srcIdx);

  return [...before, ...newLines, ...after];
}

/** 创建 apply_patch 工具 */
export function createApplyPatchTool(allowedPaths?: string[]): Tool {
  const allowed = allowedPaths ?? [process.cwd()];

  function isPathAllowed(filePath: string): boolean {
    const resolved = resolve(filePath);
    return allowed.some((a) => {
      const ra = resolve(a);
      return resolved === ra || resolved.startsWith(ra + "/");
    });
  }

  return {
    name: "apply_patch",
    label: "Apply Patch",
    description: `Apply a unified diff patch to one or more files. Use standard unified diff format:
--- a/path/to/file
+++ b/path/to/file
@@ -start,count +start,count @@
 context line
-removed line
+added line

For new files, use --- /dev/null as old path.
For deleting files, use +++ /dev/null as new path.`,
    parameters: Type.Object({
      patch: Type.String({ description: "The unified diff patch to apply" }),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const patchText = readStringParam(params, "patch", { required: true })!;

      try {
        const patches = parsePatch(patchText);

        if (patches.length === 0) {
          return jsonResult({
            status: "error",
            error: "No valid patches found in input",
          }, true);
        }

        const results: Array<{ file: string; status: string; error?: string }> = [];

        for (const patch of patches) {
          const targetPath = patch.isNew ? patch.newPath : patch.oldPath;
          const resolvedPath = resolve(targetPath);

          // 安全检查
          if (!isPathAllowed(resolvedPath)) {
            results.push({
              file: targetPath,
              status: "error",
              error: `Access denied: ${targetPath}`,
            });
            continue;
          }

          try {
            if (patch.isDelete) {
              // 删除文件
              if (existsSync(resolvedPath)) {
                const { unlink } = await import("fs/promises");
                await unlink(resolvedPath);
                results.push({ file: targetPath, status: "deleted" });
              } else {
                results.push({ file: targetPath, status: "skipped", error: "File not found" });
              }
              continue;
            }

            if (patch.isNew) {
              // 创建新文件
              const dir = dirname(resolvedPath);
              if (!existsSync(dir)) {
                await mkdir(dir, { recursive: true });
              }

              const newContent = patch.hunks
                .flatMap((h) =>
                  h.lines
                    .filter((l) => l.startsWith("+") || l.startsWith(" "))
                    .map((l) => l.slice(1))
                )
                .join("\n");

              await writeFile(resolvedPath, newContent, "utf-8");
              results.push({ file: targetPath, status: "created" });
              continue;
            }

            // 修改现有文件
            if (!existsSync(resolvedPath)) {
              results.push({ file: targetPath, status: "error", error: "File not found" });
              continue;
            }

            const content = await readFile(resolvedPath, "utf-8");
            let lines = content.split("\n");

            // 从后往前应用 hunks (避免行号偏移)
            const sortedHunks = [...patch.hunks].sort((a, b) => b.oldStart - a.oldStart);

            let allApplied = true;
            for (const hunk of sortedHunks) {
              const result = applyHunk(lines, hunk);
              if (result === null) {
                allApplied = false;
                results.push({
                  file: targetPath,
                  status: "error",
                  error: `Failed to apply hunk at line ${hunk.oldStart}`,
                });
                break;
              }
              lines = result;
            }

            if (allApplied) {
              await writeFile(resolvedPath, lines.join("\n"), "utf-8");
              results.push({
                file: targetPath,
                status: "applied",
              });
            }
          } catch (error) {
            results.push({
              file: targetPath,
              status: "error",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        const hasErrors = results.some((r) => r.status === "error");
        return jsonResult({
          status: hasErrors ? "partial" : "success",
          patches: results,
        }, hasErrors);
      } catch (error) {
        return jsonResult({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }, true);
      }
    },
  };
}
