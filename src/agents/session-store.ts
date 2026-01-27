/**
 * 会话存储 - 支持内存和文件系统持久化
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from "fs";
import { join, resolve } from "path";
import * as os from "os";
import type { ChatMessage, SessionStoreConfig } from "../types/index.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("session-store");

/** 会话数据 */
export interface SessionData {
  messages: ChatMessage[];
  summary?: string;
  lastUpdate: number;
  totalTokensUsed: number;
  metadata?: Record<string, unknown>;
}

/** 会话存储接口 */
export interface SessionStore {
  get(key: string): SessionData | undefined;
  set(key: string, data: SessionData): void;
  delete(key: string): boolean;
  has(key: string): boolean;
  keys(): string[];
  clear(): void;
}

// ============== 内存存储 ==============

export class MemorySessionStore implements SessionStore {
  private store = new Map<string, SessionData>();
  private ttlMs: number;

  constructor(ttlMs = 3600_000) {
    this.ttlMs = ttlMs;
    // 定期清理过期会话
    setInterval(() => this.cleanup(), 600_000);
  }

  get(key: string): SessionData | undefined {
    const data = this.store.get(key);
    if (data && Date.now() - data.lastUpdate > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return data;
  }

  set(key: string, data: SessionData): void {
    this.store.set(key, data);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  keys(): string[] {
    this.cleanup();
    return Array.from(this.store.keys());
  }

  clear(): void {
    this.store.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, data] of this.store) {
      if (now - data.lastUpdate > this.ttlMs) {
        this.store.delete(key);
      }
    }
  }
}

// ============== 文件存储 ==============

/** 序列化安全的消息格式 (去除不可序列化的字段) */
interface SerializableMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

export class FileSessionStore implements SessionStore {
  private directory: string;
  private ttlMs: number;
  private cache = new Map<string, { data: SessionData; loadedAt: number }>();
  private cacheMaxAge = 60_000; // 缓存 1 分钟

  constructor(directory?: string, ttlMs = 3600_000) {
    this.directory = directory ?? join(os.homedir(), ".mozi", "sessions");
    this.ttlMs = ttlMs;
    this.ensureDirectory();

    // 定期清理
    setInterval(() => this.cleanup(), 600_000);
  }

  private ensureDirectory(): void {
    if (!existsSync(this.directory)) {
      mkdirSync(this.directory, { recursive: true });
      logger.info({ directory: this.directory }, "Session directory created");
    }
  }

  private keyToFilename(key: string): string {
    // 安全的文件名
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.directory, `${safe}.json`);
  }

  get(key: string): SessionData | undefined {
    // 先检查缓存
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.loadedAt < this.cacheMaxAge) {
      if (Date.now() - cached.data.lastUpdate > this.ttlMs) {
        this.cache.delete(key);
        this.deleteFile(key);
        return undefined;
      }
      return cached.data;
    }

    // 从文件读取
    const filepath = this.keyToFilename(key);
    if (!existsSync(filepath)) return undefined;

    try {
      const raw = readFileSync(filepath, "utf-8");
      const data = JSON.parse(raw) as SessionData;

      // 检查过期
      if (Date.now() - data.lastUpdate > this.ttlMs) {
        this.deleteFile(key);
        return undefined;
      }

      // 更新缓存
      this.cache.set(key, { data, loadedAt: Date.now() });
      return data;
    } catch (error) {
      logger.error({ error, key }, "Failed to read session file");
      return undefined;
    }
  }

  set(key: string, data: SessionData): void {
    const filepath = this.keyToFilename(key);

    // 序列化消息（去除不可序列化的字段）
    const serializable = {
      ...data,
      messages: data.messages.map((msg): SerializableMessage => {
        const sm: SerializableMessage = {
          role: msg.role,
          content: typeof msg.content === "string" ? msg.content : (msg.content ? JSON.stringify(msg.content) : null),
        };
        if (msg.tool_calls) sm.tool_calls = msg.tool_calls;
        if (msg.tool_call_id) sm.tool_call_id = msg.tool_call_id;
        if (msg.name) sm.name = msg.name;
        return sm;
      }),
    };

    try {
      writeFileSync(filepath, JSON.stringify(serializable, null, 2), "utf-8");
      this.cache.set(key, { data, loadedAt: Date.now() });
    } catch (error) {
      logger.error({ error, key }, "Failed to write session file");
    }
  }

  delete(key: string): boolean {
    this.cache.delete(key);
    return this.deleteFile(key);
  }

  private deleteFile(key: string): boolean {
    const filepath = this.keyToFilename(key);
    if (existsSync(filepath)) {
      try {
        unlinkSync(filepath);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  keys(): string[] {
    this.ensureDirectory();
    try {
      return readdirSync(this.directory)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(".json", "").replace(/_/g, ":"));
    } catch {
      return [];
    }
  }

  clear(): void {
    this.cache.clear();
    this.ensureDirectory();
    try {
      const files = readdirSync(this.directory).filter((f) => f.endsWith(".json"));
      for (const f of files) {
        unlinkSync(join(this.directory, f));
      }
    } catch (error) {
      logger.error({ error }, "Failed to clear session directory");
    }
  }

  private cleanup(): void {
    this.ensureDirectory();
    const now = Date.now();

    // 清理内存缓存
    for (const [key, cached] of this.cache) {
      if (now - cached.data.lastUpdate > this.ttlMs) {
        this.cache.delete(key);
      }
    }

    // 清理文件
    try {
      const files = readdirSync(this.directory).filter((f) => f.endsWith(".json"));
      for (const f of files) {
        const filepath = join(this.directory, f);
        try {
          const stat = statSync(filepath);
          if (now - stat.mtimeMs > this.ttlMs) {
            unlinkSync(filepath);
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }
}

// ============== 工厂函数 ==============

/** 创建会话存储 */
export function createSessionStore(config?: SessionStoreConfig): SessionStore {
  const type = config?.type ?? "memory";
  const ttlMs = config?.ttlMs ?? 3600_000;

  if (type === "file") {
    return new FileSessionStore(config?.directory, ttlMs);
  }

  return new MemorySessionStore(ttlMs);
}
