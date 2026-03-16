/**
 * Memory Search Manager
 * Core manager for memory search operations with hybrid search support
 */

import { getChildLogger } from "../utils/logger.js";
import type {
  MemoryEntry,
  MemorySearchResult,
  MemorySearchOptions,
  MemoryProviderStatus,
  MemoryEmbeddingProbeResult,
  MemorySource,
  EmbeddingProvider,
} from "./types.js";
import type { MemoryStore } from "./types.js";
import { JsonMemoryStore } from "./store.js";
import { cosineSimilarity } from "./store.js";
import { ProviderEmbedding } from "./embeddings.js";
import type { ProviderId } from "../types/index.js";

const logger = getChildLogger("memory-manager");

// ============== Memory Search Manager ==============

/**
 * Core memory search manager with hybrid search capabilities
 * Supports both vector search and full-text search
 */
export class MemorySearchManager {
  private store: MemoryStore;
  private embeddingProvider: EmbeddingProvider | undefined;
  private _enabled: boolean;
  private config: {
    maxResults: number;
    minScore: number;
    hybrid: {
      enabled: boolean;
      vectorWeight: number;
      textWeight: number;
    };
  };

  constructor(options: {
    store?: MemoryStore;
    embeddingProvider?: EmbeddingProvider | undefined;
    maxResults?: number;
    minScore?: number;
    hybridEnabled?: boolean;
    vectorWeight?: number;
    textWeight?: number;
  } = {}) {
    this._enabled = true;
    this.store = options.store ?? new JsonMemoryStore();
    this.embeddingProvider = options.embeddingProvider;
    this.config = {
      maxResults: options.maxResults ?? 10,
      minScore: options.minScore ?? 0.1,
      hybrid: {
        enabled: options.hybridEnabled ?? false,
        vectorWeight: options.vectorWeight ?? 0.7,
        textWeight: options.textWeight ?? 0.3,
      },
    };
  }

  /** Set the embedding provider */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
  }

  /** Search memories */
  async search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult[]> {
    if (!this._enabled || !query.trim()) {
      return [];
    }

    const maxResults = options?.maxResults ?? this.config.maxResults;
    const minScore = options?.minScore ?? this.config.minScore;

    try {
      // If we have vector search capability
      if (this.embeddingProvider) {
        return this.hybridSearch(query, maxResults, minScore);
      }

      // Fall back to basic search
      return this.basicSearch(query, maxResults);
    } catch (error) {
      logger.error({ error, query }, "Memory search failed");
      return [];
    }
  }

  /**
   * Hybrid search combining vector similarity and keyword matching
   */
  private async hybridSearch(
    query: string,
    maxResults: number,
    minScore: number,
  ): Promise<MemorySearchResult[]> {
    if (!this.embeddingProvider) {
      return this.basicSearch(query, maxResults);
    }

    // Get query embedding
    const [queryEmbedding] = await this.embeddingProvider.embed([query]);

    // Search store (may use vector or FTS internally)
    const entries = await this.store.search(query, maxResults * 3);

    if (entries.length === 0) {
      return [];
    }

    // Calculate similarity scores
    const results: Array<MemorySearchResult & { vectorScore: number; textScore: number }> = [];

    for (const entry of entries) {
      if (!entry.embedding || !queryEmbedding) continue;

      const emb = entry.embedding;
      const vectorScore = cosineSimilarity(queryEmbedding, emb);
      const textScore = this.computeTextScore(query, entry.content);

      results.push({
        id: entry.id,
        content: entry.content,
        score: vectorScore,
        source: "memory" as MemorySource,
        vectorScore,
        textScore,
        metadata: entry.metadata,
      });
    }

    // Apply hybrid scoring if enabled
    if (this.config.hybrid.enabled) {
      for (const result of results) {
        result.score =
          this.config.hybrid.vectorWeight * result.vectorScore +
          this.config.hybrid.textWeight * result.textScore;
      }
    }

    // Filter and sort
    const filtered = results
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    return filtered.map((r) => ({
      id: r.id,
      content: r.content,
      score: r.score,
      source: r.source,
      metadata: r.metadata,
    }));
  }

  /**
   * Basic keyword-based search
   */
  private async basicSearch(query: string, maxResults: number): Promise<MemorySearchResult[]> {
    const entries = await this.store.search(query, maxResults);

    return entries.map((entry) => ({
      id: entry.id,
      content: entry.content,
      score: entry.score ?? 0.5,
      source: "memory" as MemorySource,
      metadata: entry.metadata,
    }));
  }

  /**
   * Compute text matching score
   */
  private computeTextScore(query: string, content: string): number {
    // Support Chinese characters: use length > 1 to match 2-char Chinese words
    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    if (queryWords.length === 0) return 0;

    const contentLower = content.toLowerCase();
    let matchCount = 0;
    let positionBonus = 0;

    for (let i = 0; i < queryWords.length; i++) {
      const word = queryWords[i]!;
      const index = contentLower.indexOf(word);
      if (index !== -1) {
        matchCount++;
        // Bonus for earlier matches
        positionBonus += 1 / (index + 1);
      }
    }

    const matchRatio = matchCount / queryWords.length;
    const positionFactor = positionBonus / queryWords.length;

    return matchRatio * 0.7 + positionFactor * 0.3;
  }

  /** Add a memory entry */
  async add(
    content: string,
    metadata?: Partial<MemoryEntry["metadata"]>,
  ): Promise<string | null> {
    if (!this._enabled) return null;

    let embedding: number[] | undefined;

    // Generate embedding if provider is available
    if (this.embeddingProvider) {
      try {
        const [emb] = await this.embeddingProvider.embed([content]);
        embedding = emb;
      } catch (error) {
        logger.warn({ error }, "Failed to generate embedding");
      }
    }

    return this.store.add({
      content,
      embedding,
      metadata: {
        type: metadata?.type ?? "note",
        source: metadata?.source,
        timestamp: metadata?.timestamp ?? Date.now(),
        tags: metadata?.tags,
      },
    });
  }

  /** Get a memory entry by ID */
  async get(id: string): Promise<MemoryEntry | undefined> {
    if (!this._enabled) return undefined;
    return this.store.get(id);
  }

  /** Delete a memory entry */
  async delete(id: string): Promise<boolean> {
    if (!this._enabled) return false;
    return this.store.delete(id);
  }

  /** List memory entries */
  async list(filter?: {
    type?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
  }): Promise<MemoryEntry[]> {
    if (!this._enabled) return [];
    return this.store.list(filter);
  }

  /** Clear all memories */
  async clear(): Promise<void> {
    if (!this._enabled) return;
    await this.store.clear();
  }

  /** Get provider status */
  status(): MemoryProviderStatus {
    const storeStatus = this.store.status?.() ?? { entries: 0, backend: "json" as const };

    return {
      backend: storeStatus.backend,
      provider: this.embeddingProvider?.id ?? "simple",
      model: this.embeddingProvider?.model,
      entries: "entries" in storeStatus ? storeStatus.entries : 0,
      dirty: false,
      sources: ["memory"],
      cache: {
        enabled: false,
      },
      vector: {
        enabled: !!this.embeddingProvider,
        available: !!this.embeddingProvider,
        dims: this.embeddingProvider?.dimension,
      },
      fts: {
        enabled: false,
        available: false,
      },
    };
  }

  /** Probe embedding availability */
  async probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult> {
    if (!this.embeddingProvider) {
      return { ok: false, error: "No embedding provider configured" };
    }

    try {
      const test = await this.embeddingProvider.embed(["test"]);
      return { ok: test.length > 0 };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /** Close the manager */
  async close(): Promise<void> {
    await this.store.close?.();
  }

  /** Enable/disable the manager */
  set enabled(value: boolean) {
    this._enabled = value;
  }

  get isEnabled(): boolean {
    return this._enabled;
  }
}

// ============== Memory Manager (Legacy Wrapper) ==============

/**
 * Legacy Memory Manager for backward compatibility
 * Provides simplified API for memory operations
 */
export class MemoryManager {
  private searchManager: MemorySearchManager;

  constructor(config?: {
    enabled?: boolean;
    directory?: string;
    embeddingProvider?: ProviderId;
    embeddingModel?: string;
    provider?: {
      supportsEmbedding(): boolean;
      embed(texts: string[], model?: string): Promise<number[][]>;
    };
  }) {
    // Create embedding provider
    let embeddingProvider: EmbeddingProvider | undefined;

    if (config?.provider) {
      embeddingProvider = new ProviderEmbedding(config.provider, config.embeddingModel);
    }

    // Create store
    const store = new JsonMemoryStore({ directory: config?.directory });

    // Create search manager
    this.searchManager = new MemorySearchManager({
      store,
      embeddingProvider,
      maxResults: 10,
      minScore: 0.1,
    });

    // Set enabled state
    if (config?.enabled === false) {
      this.searchManager.enabled = false;
    }
  }

  /** Store a memory */
  async remember(
    content: string,
    metadata?: Partial<MemoryEntry["metadata"]>,
  ): Promise<string | null> {
    return this.searchManager.add(content, metadata);
  }

  /** Search memories */
  async recall(query: string, limit = 5): Promise<MemoryEntry[]> {
    const results = await this.searchManager.search(query, { maxResults: limit });
    return results.map((r) => {
      const entry: MemoryEntry = {
        id: r.id,
        content: r.content,
        embedding: undefined,
        metadata: {
          type: r.metadata?.type ?? "note",
          source: r.metadata?.source,
          timestamp: r.metadata?.timestamp ?? 0,
          tags: r.metadata?.tags,
        },
        score: r.score,
      };
      return entry;
    });
  }

  /** Get a memory by ID */
  async get(id: string): Promise<MemoryEntry | undefined> {
    return this.searchManager.get(id);
  }

  /** Delete a memory */
  async forget(id: string): Promise<boolean> {
    return this.searchManager.delete(id);
  }

  /** List memories */
  async list(filter?: { type?: string; tags?: string[] }): Promise<MemoryEntry[]> {
    return this.searchManager.list(filter);
  }

  /** Clear all memories */
  async clearAll(): Promise<void> {
    await this.searchManager.clear();
  }

  /** Format memories for context */
  formatForContext(entries: MemoryEntry[]): string {
    if (entries.length === 0) return "";

    const lines = ["## Relevant Memories", ""];
    for (const entry of entries) {
      const date = new Date(entry.metadata.timestamp).toLocaleDateString();
      const score = entry.score ? ` (relevance: ${(entry.score * 100).toFixed(0)}%)` : "";
      lines.push(
        `- [${entry.metadata.type}] ${entry.content.slice(0, 200)}${score} (${date})`,
      );
    }
    return lines.join("\n");
  }

  /** Close the manager */
  async close(): Promise<void> {
    await this.searchManager.close();
  }
}

// ============== Factory Functions ==============

/**
 * Create a Memory Manager
 */
export function createMemoryManager(config?: {
  enabled?: boolean;
  directory?: string;
  embeddingProvider?: ProviderId;
  embeddingModel?: string;
  provider?: {
    supportsEmbedding(): boolean;
    embed(texts: string[], model?: string): Promise<number[][]>;
  };
}): MemoryManager {
  return new MemoryManager(config);
}

/**
 * Create a Memory Search Manager
 */
export function createMemorySearchManager(config?: {
  store?: MemoryStore;
  embeddingProvider?: EmbeddingProvider | undefined;
  maxResults?: number;
  minScore?: number;
  hybridEnabled?: boolean;
}): MemorySearchManager {
  return new MemorySearchManager(config);
}
