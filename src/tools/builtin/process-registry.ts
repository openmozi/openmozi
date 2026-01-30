/**
 * 进程会话注册表 - 管理后台进程
 * 参考 moltbot 的 bash-process-registry.ts
 */

import type { ChildProcess } from "child_process";
import { spawn } from "child_process";

/** 判断是否是 Windows 平台 */
const isWindows = process.platform === "win32";

/** 跨平台终止进程 */
function killProcessCrossPlatform(child: ChildProcess, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    if (isWindows) {
      // Windows 上使用 taskkill
      if (child.pid) {
        spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { stdio: "ignore" });
      }
    } else {
      child.kill(signal);
    }
  } catch {
    // ignore
  }
}

/** 进程会话状态 */
export type SessionStatus = "running" | "completed" | "failed";

/** 进程会话 */
export interface ProcessSession {
  id: string;
  command: string;
  pid?: number;
  child?: ChildProcess;
  startedAt: number;
  endedAt?: number;
  cwd: string;
  status: SessionStatus;
  exitCode?: number | null;
  exitSignal?: string | number | null;
  stdout: string;
  stderr: string;
  aggregated: string;
  tail: string;
  truncated: boolean;
  backgrounded: boolean;
  maxOutputChars: number;
}

/** 会话注册表 */
const runningSessions = new Map<string, ProcessSession>();
const finishedSessions = new Map<string, ProcessSession>();

/** 会话 TTL (默认 30 分钟) */
let sessionTtlMs = 30 * 60 * 1000;

/** 尾部字符数 */
const TAIL_CHARS = 2000;

/** 设置会话 TTL */
export function setSessionTtlMs(ms: number): void {
  sessionTtlMs = ms;
}

/** 生成会话 ID */
export function createSessionId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/** 添加会话 */
export function addSession(session: ProcessSession): void {
  runningSessions.set(session.id, session);
}

/** 获取运行中的会话 */
export function getSession(id: string): ProcessSession | undefined {
  return runningSessions.get(id);
}

/** 获取已完成的会话 */
export function getFinishedSession(id: string): ProcessSession | undefined {
  return finishedSessions.get(id);
}

/** 列出运行中的会话 */
export function listRunningSessions(): ProcessSession[] {
  return Array.from(runningSessions.values());
}

/** 列出已完成的会话 */
export function listFinishedSessions(): ProcessSession[] {
  cleanupExpiredSessions();
  return Array.from(finishedSessions.values());
}

/** 标记为后台运行 */
export function markBackgrounded(session: ProcessSession): void {
  session.backgrounded = true;
}

/** 标记为已退出 */
export function markExited(
  session: ProcessSession,
  exitCode: number | null,
  exitSignal: string | number | null,
  status: "completed" | "failed"
): void {
  session.status = status;
  session.exitCode = exitCode;
  session.exitSignal = exitSignal;
  session.endedAt = Date.now();

  // 从运行中移到已完成
  runningSessions.delete(session.id);
  finishedSessions.set(session.id, session);
}

/** 追加输出 */
export function appendOutput(
  session: ProcessSession,
  stream: "stdout" | "stderr",
  chunk: string
): void {
  const maxChars = session.maxOutputChars;

  if (stream === "stdout") {
    session.stdout += chunk;
    if (session.stdout.length > maxChars) {
      session.stdout = session.stdout.slice(-maxChars);
      session.truncated = true;
    }
  } else {
    session.stderr += chunk;
    if (session.stderr.length > maxChars) {
      session.stderr = session.stderr.slice(-maxChars);
      session.truncated = true;
    }
  }

  // 更新聚合输出
  session.aggregated += chunk;
  if (session.aggregated.length > maxChars) {
    session.aggregated = session.aggregated.slice(-maxChars);
    session.truncated = true;
  }

  // 更新尾部
  session.tail = session.aggregated.slice(-TAIL_CHARS);
}

/** 获取并清空待处理输出 */
export function drainSession(session: ProcessSession): { stdout: string; stderr: string } {
  const stdout = session.stdout;
  const stderr = session.stderr;
  session.stdout = "";
  session.stderr = "";
  return { stdout, stderr };
}

/** 删除会话 */
export function deleteSession(id: string): boolean {
  if (finishedSessions.has(id)) {
    finishedSessions.delete(id);
    return true;
  }
  return false;
}

/** 终止会话 */
export function killSession(session: ProcessSession): void {
  if (session.child && !session.child.killed) {
    killProcessCrossPlatform(session.child, "SIGTERM");
    setTimeout(() => {
      if (session.child && !session.child.killed) {
        killProcessCrossPlatform(session.child, "SIGKILL");
      }
    }, 5000);
  }
}

/** 清理过期会话 */
function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of finishedSessions) {
    if (session.endedAt && now - session.endedAt > sessionTtlMs) {
      finishedSessions.delete(id);
    }
  }
}

/** 获取日志切片 */
export function sliceLogLines(
  content: string,
  offset?: number,
  limit?: number
): { slice: string; totalLines: number; totalChars: number } {
  const lines = content.split("\n");
  const totalLines = lines.length;
  const totalChars = content.length;

  const startIdx = Math.max(0, (offset ?? 1) - 1);
  const endIdx = limit ? Math.min(totalLines, startIdx + limit) : totalLines;

  const slice = lines.slice(startIdx, endIdx).join("\n");

  return { slice, totalLines, totalChars };
}

/** 获取尾部输出 */
export function tail(content: string, chars: number): string {
  if (content.length <= chars) return content;
  return "..." + content.slice(-chars);
}

/** 从命令推导会话名称 */
export function deriveSessionName(command: string): string {
  // 提取第一个命令
  const match = command.match(/^\s*(?:sudo\s+)?(\S+)/);
  if (match) {
    const cmd = match[1]!;
    // 去掉路径
    const basename = cmd.split("/").pop() || cmd;
    return basename.slice(0, 20);
  }
  return command.slice(0, 20);
}

/** 格式化持续时间 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h${Math.floor((ms % 3600000) / 60000)}m`;
}

/** 截断中间部分 */
export function truncateMiddle(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  const half = Math.floor((maxLen - 3) / 2);
  return str.slice(0, half) + "..." + str.slice(-half);
}
