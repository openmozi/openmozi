/**
 * Memory 系统 - 基于 SQLite 的向量记忆
 * 简化版实现，不依赖外部向量数据库
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import * as os from "os";
import * as crypto from "crypto";
import { getChildLogger } from "../utils/logger.js";
import type { ProviderId } from "../types/index.js";
import { getProvider } from "../providers/index.js";

const logger = getChildLogger("memory");

/** 记忆条目 */
export interface MemoryEntry {
  id: string;
  content: string;
  embedding?: number[];
  metadata: {
    type: "conversation" | "fact" | "note" | "code";
    source?: string;
    timestamp: number;
    tags?: string[];
  };
  score?: number;
}

/** 记忆存储接口 */
export interface MemoryStore {
  add(entry: Omit<MemoryEntry, "id">): Promise<string>;
  search(query: string, limit?: number): Promise<MemoryEntry[]>;
  get(id: string): Promise<MemoryEntry | undefined>;
  delete(id: string): Promise<boolean>;
  list(filter?: { type?: string; tags?: string[] }): Promise<MemoryEntry[]>;
  clear(): Promise<void>;
}

/** 嵌入提供器 */
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  dimension: number;
}

// ============== 简单的本地嵌入 (基于 TF-IDF 简化版) ==============

/** 简单的词频向量嵌入 (不需要外部 API) */
class SimpleEmbedding implements EmbeddingProvider {
  dimension = 256;
  private vocabulary = new Map<string, number>();
  private idf = new Map<string, number>();
  private docCount = 0;

  /** 分词 */
  private tokenize(text: string): string[] {
    // 简单分词: 按空格和标点分割，转小写
    return text
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fff]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0);
  }

  /** 更新词汇表 */
  private updateVocabulary(tokens: string[]): void {
    const seen = new Set<string>();
    for (const token of tokens) {
      if (!this.vocabulary.has(token)) {
        this.vocabulary.set(token, this.vocabulary.size % this.dimension);
      }
      if (!seen.has(token)) {
        seen.add(token);
        this.idf.set(token, (this.idf.get(token) ?? 0) + 1);
      }
    }
    this.docCount++;
  }

  /** 计算向量 */
  private computeVector(tokens: string[]): number[] {
    const vector = new Array(this.dimension).fill(0);
    const tf = new Map<string, number>();

    // 计算词频
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    // TF-IDF 向量
    for (const [token, count] of tf) {
      const idx = this.vocabulary.get(token) ?? (token.charCodeAt(0) % this.dimension);
      const idf = Math.log((this.docCount + 1) / (this.idf.get(token) ?? 1) + 1);
      vector[idx] += (count / tokens.length) * idf;
    }

    // 归一化
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const tokens = this.tokenize(text);
      this.updateVocabulary(tokens);
      return this.computeVector(tokens);
    });
  }
}

// ============== API 嵌入 (使用 AI 提供商) ==============

class APIEmbedding implements EmbeddingProvider {
  dimension = 1536; // OpenAI 默认
  private provider: ProviderId;
  private model: string;

  constructor(provider: ProviderId, model?: string) {
    this.provider = provider;
    this.model = model ?? "text-embedding-ada-002";
  }

  async embed(texts: string[]): Promise<number[][]> {
    const p = getProvider(this.provider);
    if (!p) {
      throw new Error(`Provider not found: ${this.provider}`);
    }

    // 使用 chat API 模拟嵌入 (大多数国内 API 不支持 embeddings)
    // 这里简化处理，实际应该调用 embeddings API
    logger.warn("API embedding not fully implemented, falling back to simple embedding");

    const simple = new SimpleEmbedding();
    return simple.embed(texts);
  }
}

// ============== JSON 文件存储 ==============

/** JSON 文件存储实现 */
export class JsonMemoryStore implements MemoryStore {
  private directory: string;
  private indexFile: string;
  private entries: Map<string, MemoryEntry> = new Map();
  private embedder: EmbeddingProvider;

  constructor(directory?: string, embedder?: EmbeddingProvider) {
    this.directory = directory ?? join(os.homedir(), ".mozi", "memory");
    this.indexFile = join(this.directory, "index.json");
    this.embedder = embedder ?? new SimpleEmbedding();
    this.ensureDirectory();
    this.loadIndex();
  }

  private ensureDirectory(): void {
    if (!existsSync(this.directory)) {
      mkdirSync(this.directory, { recursive: true });
    }
  }

  private loadIndex(): void {
    if (existsSync(this.indexFile)) {
      try {
        const data = JSON.parse(readFileSync(this.indexFile, "utf-8"));
        for (const entry of data.entries ?? []) {
          this.entries.set(entry.id, entry);
        }
        logger.debug({ count: this.entries.size }, "Memory index loaded");
      } catch (error) {
        logger.error({ error }, "Failed to load memory index");
      }
    }
  }

  private saveIndex(): void {
    try {
      const data = {
        version: 1,
        entries: Array.from(this.entries.values()),
      };
      writeFileSync(this.indexFile, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
      logger.error({ error }, "Failed to save memory index");
    }
  }

  private generateId(): string {
    return crypto.randomBytes(8).toString("hex");
  }

  /** 余弦相似度 */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
  }

  async add(entry: Omit<MemoryEntry, "id">): Promise<string> {
    const id = this.generateId();
    const [embedding] = await this.embedder.embed([entry.content]);

    const fullEntry: MemoryEntry = {
      id,
      content: entry.content,
      embedding,
      metadata: entry.metadata,
    };

    this.entries.set(id, fullEntry);
    this.saveIndex();

    logger.debug({ id, type: entry.metadata.type }, "Memory entry added");
    return id;
  }

  async search(query: string, limit = 10): Promise<MemoryEntry[]> {
    const [queryEmbedding] = await this.embedder.embed([query]);

    // 计算相似度并排序
    const results: Array<MemoryEntry & { score: number }> = [];

    for (const entry of this.entries.values()) {
      if (!entry.embedding) continue;

      const score = this.cosineSimilarity(queryEmbedding!, entry.embedding);
      results.push({ ...entry, score });
    }

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit).map(({ embedding, ...rest }) => rest);
  }

  async get(id: string): Promise<MemoryEntry | undefined> {
    const entry = this.entries.get(id);
    if (entry) {
      const { embedding, ...rest } = entry;
      return rest;
    }
    return undefined;
  }

  async delete(id: string): Promise<boolean> {
    if (this.entries.has(id)) {
      this.entries.delete(id);
      this.saveIndex();
      return true;
    }
    return false;
  }

  async list(filter?: { type?: string; tags?: string[] }): Promise<MemoryEntry[]> {
    let entries = Array.from(this.entries.values());

    if (filter?.type) {
      entries = entries.filter((e) => e.metadata.type === filter.type);
    }

    if (filter?.tags && filter.tags.length > 0) {
      entries = entries.filter((e) =>
        filter.tags!.some((tag) => e.metadata.tags?.includes(tag))
      );
    }

    return entries.map(({ embedding, ...rest }) => rest);
  }

  async clear(): Promise<void> {
    this.entries.clear();
    this.saveIndex();
  }
}

// ============== Memory Manager ==============

/** Memory 管理器 */
export class MemoryManager {
  private store: MemoryStore;
  private enabled: boolean;

  constructor(config?: {
    enabled?: boolean;
    directory?: string;
    embeddingProvider?: ProviderId;
    embeddingModel?: string;
  }) {
    this.enabled = config?.enabled ?? true;

    const embedder = config?.embeddingProvider
      ? new APIEmbedding(config.embeddingProvider, config.embeddingModel)
      : new SimpleEmbedding();

    this.store = new JsonMemoryStore(config?.directory, embedder);
  }

  /** 存储记忆 */
  async remember(
    content: string,
    metadata?: Partial<MemoryEntry["metadata"]>
  ): Promise<string | null> {
    if (!this.enabled) return null;

    return this.store.add({
      content,
      metadata: {
        type: metadata?.type ?? "note",
        source: metadata?.source,
        timestamp: metadata?.timestamp ?? Date.now(),
        tags: metadata?.tags,
      },
    });
  }

  /** 搜索记忆 */
  async recall(query: string, limit = 5): Promise<MemoryEntry[]> {
    if (!this.enabled) return [];
    return this.store.search(query, limit);
  }

  /** 获取记忆 */
  async get(id: string): Promise<MemoryEntry | undefined> {
    if (!this.enabled) return undefined;
    return this.store.get(id);
  }

  /** 删除记忆 */
  async forget(id: string): Promise<boolean> {
    if (!this.enabled) return false;
    return this.store.delete(id);
  }

  /** 列出记忆 */
  async list(filter?: { type?: string; tags?: string[] }): Promise<MemoryEntry[]> {
    if (!this.enabled) return [];
    return this.store.list(filter);
  }

  /** 清空记忆 */
  async clearAll(): Promise<void> {
    if (!this.enabled) return;
    await this.store.clear();
  }

  /** 格式化记忆为上下文 */
  formatForContext(entries: MemoryEntry[]): string {
    if (entries.length === 0) return "";

    const lines = ["## Relevant Memories", ""];
    for (const entry of entries) {
      const date = new Date(entry.metadata.timestamp).toLocaleDateString();
      const score = entry.score ? ` (relevance: ${(entry.score * 100).toFixed(0)}%)` : "";
      lines.push(`- [${entry.metadata.type}] ${entry.content.slice(0, 200)}${score} (${date})`);
    }
    return lines.join("\n");
  }
}

/** 创建 Memory 管理器 */
export function createMemoryManager(config?: {
  enabled?: boolean;
  directory?: string;
  embeddingProvider?: ProviderId;
  embeddingModel?: string;
}): MemoryManager {
  return new MemoryManager(config);
}
