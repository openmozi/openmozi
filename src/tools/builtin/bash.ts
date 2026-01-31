/**
 * 内置工具 - Bash 命令执行工具 (增强版)
 * 对齐 Claude Code 的 Bash 执行能力，支持后台执行和进程管理
 */

import { Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import { resolve, sep } from "path";
import type { Tool } from "../types.js";
import { jsonResult, textResult, readStringParam, readNumberParam, readBooleanParam } from "../common.js";
import {
  createSessionId,
  addSession,
  markBackgrounded,
  markExited,
  appendOutput,
  drainSession,
  deriveSessionName,
  formatDuration,
  truncateMiddle,
  type ProcessSession,
} from "./process-registry.js";

/** Bash 工具选项 */
export interface BashToolOptions {
  /** 允许执行命令的目录列表 */
  allowedPaths?: string[];
  /** 默认超时时间 (毫秒) */
  defaultTimeout?: number;
  /** 最大超时时间 (毫秒) */
  maxTimeout?: number;
  /** 最大输出大小 (字符数) */
  maxOutputSize?: number;
  /** 禁止的命令模式 */
  blockedCommands?: RegExp[];
  /** 是否启用 (默认 true) */
  enabled?: boolean;
}

const DEFAULT_OPTIONS: Required<BashToolOptions> = {
  allowedPaths: [process.cwd()],
  defaultTimeout: 120000, // 2 分钟
  maxTimeout: 600000, // 10 分钟
  maxOutputSize: 100000, // 100KB
  blockedCommands: [
    // 危险的删除/格式化操作
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?[\/~]/i,
    /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?[\/~]/i,
    /\bmkfs\b/i,
    /\bdd\s+.*of=\/dev/i,
    /\bformat\b.*[a-z]:/i,
    // 系统关机/重启
    /\b(poweroff|reboot|shutdown|halt)\b/i,
    // 危险的 kill 操作
    /\bkill\s+(-\d+\s+)?(-1|1)\b/,
    /\bkillall\s+-9\s+/i,
    // 直接写入磁盘设备
    />\s*\/dev\/(sda|hda|nvme|vda)/i,
    // 修改系统关键文件
    />\s*\/etc\/(passwd|shadow|sudoers)/i,
    // 链式危险命令 (通过 ; || && 连接)
    /;\s*(rm|mkfs|dd|format|poweroff|reboot|shutdown)\b/i,
    /\|\|\s*(rm|mkfs|dd|format|poweroff|reboot|shutdown)\b/i,
    /&&\s*(rm|mkfs|dd|format|poweroff|reboot|shutdown)\b/i,
    // 通过管道执行的危险命令
    /\|\s*(bash|sh|zsh)\s*$/i,
    // curl/wget 直接管道到 shell
    /\b(curl|wget)\s+.*\|\s*(bash|sh|zsh)/i,
    // 禁止 chmod 777 对根目录
    /\bchmod\s+(-[a-zA-Z]*R[a-zA-Z]*\s+)?777\s+[\/~]/i,
    // 禁止修改 /etc 下的敏感文件
    /\b(mv|cp|cat\s*>)\s+.*\/etc\/(passwd|shadow|sudoers|hosts)/i,
  ],
  enabled: true,
};

/** 检查路径是否在允许范围内 */
function isPathAllowed(path: string, allowedPaths: string[]): boolean {
  const resolved = resolve(path);
  return allowedPaths.some((allowed) => {
    const resolvedAllowed = resolve(allowed);
    return resolved === resolvedAllowed || resolved.startsWith(resolvedAllowed + sep);
  });
}

/** 检查命令是否被禁止 */
function isCommandBlocked(command: string, blockedPatterns: RegExp[]): boolean {
  return blockedPatterns.some((pattern) => pattern.test(command));
}

/** 判断是否是 Windows 平台 */
const isWindows = process.platform === "win32";

/** 获取 Shell 命令和参数 */
function getShellCommand(command: string): { shell: string; args: string[] } {
  if (isWindows) {
    return { shell: "cmd.exe", args: ["/c", command] };
  }
  return { shell: "bash", args: ["-c", command] };
}

/** 跨平台终止进程 */
function killProcess(proc: ReturnType<typeof spawn>, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    if (isWindows) {
      // Windows 上使用 taskkill
      if (proc.pid) {
        spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"], { stdio: "ignore" });
      }
    } else {
      proc.kill(signal);
    }
  } catch {
    // ignore
  }
}

/** 创建 Bash 执行工具 */
export function createBashTool(options?: BashToolOptions): Tool {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return {
    name: "bash",
    label: "Bash",
    description: `Execute a bash command with optional background execution.

Use this for:
- System operations (git, npm, docker, etc.)
- Running builds and tests
- Long-running processes (use run_in_background: true)

Parameters:
- command: The bash command to execute
- cwd: Working directory (optional)
- timeout: Timeout in ms, max 600000 (optional)
- run_in_background: Run in background and return immediately (optional)
- description: Brief description of what the command does (optional)`,
    parameters: Type.Object({
      command: Type.String({ description: "The bash command to execute" }),
      cwd: Type.Optional(Type.String({ description: "Working directory for the command" })),
      timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds (max 600000)" })),
      run_in_background: Type.Optional(Type.Boolean({ description: "Run in background and return session ID" })),
      description: Type.Optional(Type.String({ description: "Brief description of what the command does" })),
    }),
    execute: async (_toolCallId, args, signal) => {
      if (!opts.enabled) {
        return jsonResult({
          status: "error",
          error: "Bash tool is disabled",
        }, true);
      }

      const params = args as Record<string, unknown>;
      const command = readStringParam(params, "command", { required: true })!;
      const cwd = readStringParam(params, "cwd") ?? process.cwd();
      const timeout = Math.min(
        readNumberParam(params, "timeout") ?? opts.defaultTimeout,
        opts.maxTimeout
      );
      const runInBackground = readBooleanParam(params, "run_in_background");
      const description = readStringParam(params, "description");

      // 安全检查: 工作目录
      if (!isPathAllowed(cwd, opts.allowedPaths)) {
        return jsonResult({
          status: "error",
          error: `Access denied: working directory '${cwd}' is not allowed`,
        }, true);
      }

      // 安全检查: 禁止的命令
      if (isCommandBlocked(command, opts.blockedCommands)) {
        return jsonResult({
          status: "error",
          error: "Command blocked for security reasons",
        }, true);
      }

      // 创建会话
      const sessionId = createSessionId();
      const session: ProcessSession = {
        id: sessionId,
        command: truncateMiddle(command, 200),
        startedAt: Date.now(),
        cwd,
        status: "running",
        stdout: "",
        stderr: "",
        aggregated: "",
        tail: "",
        truncated: false,
        backgrounded: runInBackground ?? false,
        maxOutputChars: opts.maxOutputSize,
      };

      // 启动进程
      const { shell, args: shellArgs } = getShellCommand(command);
      const proc = spawn(shell, shellArgs, {
        cwd,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      session.child = proc;
      session.pid = proc.pid;
      addSession(session);

      // 输出处理
      proc.stdout?.on("data", (data) => {
        appendOutput(session, "stdout", data.toString());
      });

      proc.stderr?.on("data", (data) => {
        appendOutput(session, "stderr", data.toString());
      });

      // 进程结束处理
      proc.on("close", (code, sig) => {
        markExited(session, code, sig, code === 0 ? "completed" : "failed");
      });

      proc.on("error", (error) => {
        appendOutput(session, "stderr", `Process error: ${error.message}`);
        markExited(session, null, null, "failed");
      });

      // 后台执行模式
      if (runInBackground) {
        markBackgrounded(session);
        return jsonResult({
          status: "backgrounded",
          session_id: sessionId,
          pid: proc.pid,
          command: session.command,
          description: description ?? deriveSessionName(command),
          message: `Process started in background. Use process tool with session_id "${sessionId}" to check status.`,
        });
      }

      // 前台执行模式 - 等待完成
      return new Promise((resolvePromise) => {
        let killed = false;

        // 超时处理
        const timeoutId = setTimeout(() => {
          killed = true;
          killProcess(proc, "SIGTERM");
          setTimeout(() => {
            if (!proc.killed) killProcess(proc, "SIGKILL");
          }, 5000);
        }, timeout);

        // 中止信号处理
        signal?.addEventListener("abort", () => {
          killed = true;
          killProcess(proc, "SIGTERM");
        });

        proc.on("close", (code) => {
          clearTimeout(timeoutId);

          // 获取输出
          const { stdout, stderr } = drainSession(session);

          if (killed) {
            resolvePromise(
              jsonResult({
                status: "killed",
                reason: signal?.aborted ? "aborted" : "timeout",
                session_id: sessionId,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                duration: formatDuration(Date.now() - session.startedAt),
              }, true)
            );
            return;
          }

          // 合并输出
          let output = "";
          if (stdout.trim()) {
            output += stdout.trim();
          }
          if (stderr.trim()) {
            if (output) output += "\n\n[stderr]\n";
            output += stderr.trim();
          }

          if (code === 0) {
            resolvePromise(
              textResult(output || "(no output)", {
                exitCode: code,
                command: session.command,
                session_id: sessionId,
                duration: formatDuration(Date.now() - session.startedAt),
              })
            );
          } else {
            resolvePromise(
              jsonResult({
                status: "error",
                exitCode: code,
                session_id: sessionId,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                duration: formatDuration(Date.now() - session.startedAt),
              }, true)
            );
          }
        });
      });
    },
  };
}

/** 创建所有 Bash 相关工具 */
export function createBashTools(options?: BashToolOptions): Tool[] {
  return [createBashTool(options)];
}
